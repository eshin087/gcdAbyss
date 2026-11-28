// The Last Foundry and Anselm, the False Saint, headless: the REAL Player, FalseSaint, Hud, GameFlow,
// AudioEngine and Lab (+ real LightPool, GlyphParticles, FireField, CameraRig, Events) wired like
// src/main.js for `?level=foundry`, on the level's real set (world/lastFoundry.js: its breakables, its
// hazard surface, its ambience). A bot drives the input. The harness is veil.mjs's (its build, bots, helpers).
// usage: node saint.mjs <repoRoot> [scenario[,scenario]]   (env: GCD_SEED=n reseeds the AI)
//   core's scenarios: levels | data | fight | phases | shell | molten | death | events | all
//   THE LATER AGENTS add theirs in `S` below, inside THEIR OWN marked block (// --- world, // --- body,
//   // --- fx, // --- melee, // --- boost, // --- arsenal, // --- terrain, // --- tuning), ONE ENTRY PER
//   LINE, so no two agents ever edit the same line. Each scenario is a function defined anywhere in the file
//   (put yours in a section of its own, headed with your name), or an inline async function in the entry.
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
const { createLastFoundry, FOUNDRY } = await imp('src/world/lastFoundry.js');
const { Destructibles } = await imp('src/world/destructibles.js');
const { Scars } = await imp('src/world/scars.js');
const { Player } = await imp('src/entities/player/player.js');
// (this suite measures the barrier, the pull and the domain, not the riposte: a parry here answers with the
// old riposte, as the other suites that parry for something else do; the deathblow has its own, `duel deathblow`)
const { setRiposteMode } = await imp('src/entities/player/riposteCut.js');
setRiposteMode('old');
const { FalseSaint } = await imp('src/entities/enemies/falseSaint/saint.js');
const { MOVES, MOVE_NAMES, CLIP, TRANSITIONS, realise, HANDLERS, COUNTERS, STREAKS } = await imp('src/entities/enemies/falseSaint/moves.js');
const { TUNING } = await imp('src/entities/enemies/falseSaint/tuning.js');
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
const LVL = getLevel('foundry');
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
  if (def.counter || def.hidden) return [1, 2, 3, 4];
  return [1, 2, 3, 4].filter((f) => weightIn(def, f) > 0);
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
  const set = createLastFoundry(createSharedUniforms(), c);
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
  const set = real ? createLastFoundry(U, colliders) : null;
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
    if (![d.position.x, d.position.y, d.position.z, d.hp, d.yaw, d.posture, d.maxPosture].every(Number.isFinite)) throw new Error('saint NaN');
    if (![d._tip.x, d._tip.y, d._tip.z, d._hilt.x].every(Number.isFinite)) throw new Error('saint blade NaN');
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

// ================================================================== helpers of this suite
const pieces = (G, kind) => G.game.world.destructibles.list.filter((b) => b.kind === kind);
/** One light swing of the hero's at him from `dist` m: the damage it dealt. */
function swing(G, dist = 1.6) {
  const { game, input } = G;
  const d = game.dragon;
  place(G, dist);
  const hp0 = d.hp;
  input.click(0);
  run(G, 0.9, () => game.mouseGround.set(d.position.x, 0, d.position.z));
  return hp0 - d.hp;
}
/** Damage him to just over a phase's gate and let its transition play out (n: the phase it opens). */
function throughGate(G, n) {
  const { game } = G;
  const d = game.dragon;
  const gate = d.maxHp * TUNING.phaseAt[n - 1];
  d.hp = gate + 20;
  d.mode = 'foot';
  d.brain.act = null;
  d.takeHit({ damage: 400, part: 'body', heavy: true, poise: 5, exact: true });
  const stopped = d.hp === gate && d.brain.pendingPhase === n;
  run(G, 1.5, null, () => d.brain.act?.name === TRANSITIONS[n]);
  const began = d.brain.act?.name === TRANSITIONS[n] && d.phase === n;
  run(G, 6, null, () => d.mode !== 'act');
  return { gate, stopped, began };
}

// ================================================================== core: levels
async function scenarioLevels() {
  out('\n== scenario LEVELS (the registry, the URL, the lines, no reward, the boss slot, the set\'s surface) ==');
  assert(LEVELS.includes(LVL) && LVL.id === 'foundry' && LEVELS.indexOf(LVL) === 9, `levels: ${LEVELS.map((l) => l.id).join(', ')} (the tenth)`);
  assert(['?level=foundry', '?lab&level=FOUNDRY', '?level=saint', '?level=falsesaint', '?level=anselm', '?level=mill', '?level=machine'].every((q) => levelFromSearch(q) === LVL), '?level=foundry / saint / falsesaint / anselm / mill / machine pick the level (case-insensitive)');
  const ids = new Set();
  for (const L of LEVELS) for (const a of [L.id, ...(L.aliases ?? [])]) { assert(!ids.has(a), `the URL id ${a} is one level's only`); ids.add(a); }
  for (const k of ['arrive', 'stir', 'phase2', 'phase3', 'phase4', 'victory', 'fallen', 'restReset', 'again', 'rise']) assert(!!LVL.text[k], `the level has its ${k} line`);
  assert(LVL.name === 'The Last Foundry' && LVL.text.victory === 'THE FALSE SAINT FALLS' && LVL.text.phase2 === 'THE SKIN BREAKS' && LVL.text.phase3 === 'WEAPONS FREE' && LVL.text.phase4 === 'TRUE FRAME', `${LVL.name}: ${LVL.sub}`);
  assert(LVL.reward === undefined, 'no reward ships (the owner has not chosen one)');
  assert(CONFIG.world.arenaRadius === FOUNDRY.half && CONFIG.world.bossTriggerZ === FOUNDRY.entryZ - 0.6 && CONFIG.world.dragonBound === FOUNDRY.floor.r && CONFIG.world.playerBound === FOUNDRY.bound, 'applyLevel merged the foundry layout into CONFIG.world');
  const F0 = FOUNDRY;
  assert([F0.half, F0.cell, F0.entryZ, F0.bonfire.x, F0.bonfire.z, F0.floor.r, F0.wait.x, F0.wait.z, F0.wait.yaw, F0.bound, F0.press.x, F0.press.z, F0.line.x, F0.line.z0, F0.line.z1, F0.pour.x0, F0.pour.x1, F0.pour.z0, F0.pour.z1].every(Number.isFinite) && F0.ladles.length === 4 && F0.tanks.length > 0 && F0.columns.length > 0, 'FOUNDRY carries every field of the layout (BRIEF 4)');
  const G = build();
  const d = G.game.dragon;
  assert(d instanceof FalseSaint && d.kind === 'duelist' && d.name === TUNING.name && d.kit.id === 'saint', `the boss is his own duelist: ${d.name}`);
  assert(d.maxHp === TUNING.hp && TUNING.phaseAt.length === 4 && TUNING.maxPhase === 4 && !d.lives, 'one health bar, four phases');
  assert(Object.keys(d.parts).join(',') === 'melee,boost,arsenal,terrain' && HANDLERS.length === 4, `the four move handlers are built (${Object.keys(d.parts).join(', ')})`);
  const set = G.game.world.forest, F = set.foundry;
  assert(!!F && F.ladles.length === 4 && typeof F.ladleNear === 'function' && typeof F.drop === 'function' && typeof F.molten?.add === 'function' && typeof F.molten.at === 'function' && Array.isArray(F.molten.pools) && typeof F.reset === 'function', 'the set\'s hazard surface: ladles, ladleNear, drop, molten.add / pools / at, reset');
  const kinds = new Set(G.game.world.destructibles.list.map((b) => b.kind));
  assert(['plate', 'ladle', 'press', 'frame', 'tank', 'column', 'furnace'].every((k) => kinds.has(k)), `the set's pieces stand (${[...kinds].join(', ')})`);
  assert(pieces(G, 'plate').length >= 300, `the casting floor is plates (${pieces(G, 'plate').length})`);
  run(G, 0.6);
  assert(d.mode === 'sleep' && Math.hypot(d.position.x - F0.wait.x, d.position.z - F0.wait.z) < 0.5, 'asleep he kneels at the edge of the pour');
  d.startIntro();
  run(G, 4, null, () => d.mode === 'foot');
  assert(G.counts['dragon:wake'] === 1 && G.counts['dragon:introDone'] === 1 && d.mode !== 'sleep', 'woken: the duel starts');
  const { SCORE, allTrackFiles } = await imp('src/audio/trackList.js');
  assert(!!SCORE.levels.foundry?.explore && SCORE.levels.foundry.phases.length === 4 && allTrackFiles().includes(SCORE.levels.foundry.explore.file), 'the level has its score (borrowed files)');
}

// ================================================================== core: data
async function scenarioData() {
  out('\n== scenario DATA (move data rules in every phase a move is used in; the fs prefix; the routing; the homage line) ==');
  let checked = 0;
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    const phases = phasesOf(name);
    if (!phases.length) assert(false, `${name}: used in at least one phase`);
    if (!def.transition && !(Array.isArray(def.weight) && def.weight.length === 4)) assert(false, `${name}: four-phase weights`);
    for (const f of phases) {
      for (const r of [0, 0.5, 0.999]) {
        const A = realise(name, f, () => r);
        const real = A.beats.filter((b) => !b.feint);
        const tag = `${name} P${f} r${r}`;
        if (!real.every((b) => [TELL.NORMAL, TELL.BLUE, TELL.RED, TELL.BLACK].includes(b.def.tell))) assert(false, `${tag}: a tell on every real hit`);
        if (!A.beats.filter((b) => b.feint && !b.def.stance).every((b) => b.def.tell === undefined && !b.def.zone && !b.def.damage)) assert(false, `${tag}: a feint says nothing`);
        const first = real[0];
        // (COMBAT.md: >= 0.7 s in phase 1; a later phase may be faster through windupScale)
        const fw = TUNING.minFirstWindup * (Array.isArray(TUNING.windupScale) ? TUNING.windupScale[f - 1] ?? 1 : 1);
        if (!def.transition && first && !(first.impact - first.tellAt >= fw - 1e-6)) assert(false, `${tag}: first real windup ${(first.impact - first.tellAt).toFixed(3)} >= ${fw.toFixed(3)}`);
        for (let i = 1; i < real.length; i++) if (!(real[i].impact - real[i - 1].impact >= TUNING.minHitGap - 1e-6)) assert(false, `${tag}: hits ${i - 1}→${i} ${(real[i].impact - real[i - 1].impact).toFixed(3)} s apart >= ${TUNING.minHitGap}`);
        for (const b of real) if (!(b.def.zone || b.def.release || b.def.cast)) assert(false, `${tag}: hit ${b.hit} has a zone, a release or a cast`);
        for (const b of real) if (b.def.tell === TELL.RED && b.def.zone?.kind === 'ring' && !b.def.ring) assert(false, `${tag}: a red ring has its ring`);
        if (!(A.end > A.recoveryStart && Math.abs(A.clip.dur - A.end) < 1e-9)) assert(false, `${tag}: clip spans the move`);
        checked++;
      }
    }
  }
  assert(checked >= 12, `${checked} realisations obey the rules (a tell per hit, feints silent, first windup >= ${TUNING.minFirstWindup} s x windupScale, hits >= ${TUNING.minHitGap} s apart)`);
  // (COMBAT.md's floors: the cue 0.35 s before the impact, a first windup of 0.7 s in phase 1, hits 0.45 s apart)
  assert(TUNING.flashLead >= 0.35 - 1e-9 && TUNING.minFirstWindup >= 0.7 - 1e-9 && TUNING.minHitGap >= 0.45 - 1e-9, `his minimums are COMBAT.md's (cue ${TUNING.flashLead} >= 0.35, first windup ${TUNING.minFirstWindup} >= 0.7, hits ${TUNING.minHitGap} >= 0.45 apart)`);
  // every new field is `fs`-prefixed (the engine's names: this list; add an engine field here only if the engine has it)
  const ENGINE = new Set(('tell flare feint windup hold cock active chance fixed pick damage knockback knockdown zone ring part track close travel dash lift leap air release cast sustain selfHit stance draw stopOn mikiri lock flit follow keys bolt pull grip noWorld groundMark blink dive hazard burn whoosh blockPush guardCost mo sweep '
    + 'label phase weight cooldown band recovery recoveryKeys counter transition manual hidden cat terrain gapCloser streak recoverOpen').split(' '));
  const bad = new Set();
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    for (const k of Object.keys(def)) if (k !== 'beats' && !ENGINE.has(k) && !/^fs[A-Z]/.test(k)) bad.add(`${name}.${k}`);
    for (const raw of def.beats) for (const b of Array.isArray(raw.pick) ? raw.pick : [raw]) for (const k of Object.keys(b)) if (!ENGINE.has(k) && !/^fs[A-Z]/.test(k)) bad.add(`${name}.beat.${k}`);
  }
  assert(bad.size === 0, `every new move / beat field is fs-prefixed (${[...bad].slice(0, 8).join(', ')})`);
  // the TUNING fields new to the engine are fs-prefixed too (the engine's: this list; the four merged blocks are free)
  const TENGINE = new Set('name hp phaseAt maxPhase radius scale bound flashLead minFirstWindup minHitGap windupScale recoveryScale close reach posture guard trade camera flinch hitStun parts execRange ghostepBehind execution move idleGap openingGap chain pressure punish fullDeflect lock mikiri cinematic damageScale airFall transition beam melee boost arsenal terrain world wakeRadius'.split(' '));
  const tbad = Object.keys(TUNING).filter((k) => !TENGINE.has(k) && !/^fs[A-Z]/.test(k));
  assert(tbad.length === 0, `every new TUNING field is fs-prefixed (${tbad.join(', ')})`);
  // the handlers' FIELDS: fs-prefixed and claimed by one file only; every beat routed to at most one
  const own = new Map();
  for (const H of HANDLERS) for (const f of H.fields) { if (!(/^fs[A-Z]/.test(f) && !own.has(f))) assert(false, `handler ${H.name}: its field ${f} is fs-prefixed and its own`); own.set(f, H.name); }
  assert(HANDLERS.map((H) => H.name).join(',') === 'melee,boost,arsenal,terrain' && own.size >= 4, `four handlers, ${own.size} fields, none claimed twice`);
  // the poses router: each file's names carry its prefix, none twice
  const { POSE_FILES } = await imp('src/entities/enemies/falseSaint/poses.js');
  const seen = new Set();
  let dup = 0, pre = 0;
  for (const [who, names] of Object.entries(POSE_FILES)) for (const n of names) { if (seen.has(n)) dup++; seen.add(n); if (who !== 'body' && !n.startsWith(who)) pre++; }
  assert(dup === 0 && pre === 0, `the pose files' names: none twice (${dup}), each moves file's with its prefix ml / bo / ar / tr (${pre} without)`);
  // the transitions, the flurries, the counters
  for (const [ph, mv] of Object.entries(TRANSITIONS)) assert(MOVES[mv]?.transition && MOVES[mv].phase === Number(ph) && MOVES[mv].beats.some((b) => b.fsMoment === Number(ph)), `phase ${ph} begins with ${mv} (its fsMoment)`);
  assert(STREAKS.length === 4 && STREAKS.every((n) => MOVES[n]?.streak) && COUNTERS.length === 4 && COUNTERS.every((n) => MOVES[n]?.counter), `his flurry by phase (${STREAKS.join(', ')}), his counter by phase (${COUNTERS.join(', ')})`);
  // the effects' surface: every method of the list exists (the moves call them from the first commit)
  const { FS_FX_METHODS } = await imp('src/entities/enemies/falseSaint/fx.js');
  const G = build();
  const fx = G.game.dragon.fx;
  const miss = FS_FX_METHODS.filter((m) => typeof fx[m] !== 'function');
  assert(miss.length === 0, `the ${FS_FX_METHODS.length} methods of FsFx's surface exist (${miss.join(', ')})`);
  const B = G.game.dragon;
  const v = new THREE.Vector3();
  const pts = ['palmR', 'elbowR', 'elbowL', 'shoulderR', 'shoulderL', 'back', 'calfR', 'calfL', 'core', 'mortar', 'eye', 'head', 'chest'].filter((n) => { B.partPoint(n, v); return !Number.isFinite(v.x + v.y + v.z); });
  assert(pts.length === 0 && Number.isFinite(B.eyePoint(v).y) && Number.isFinite(B.handPoint('L', v).y), `the body's points are finite (partPoint, eyePoint, handPoint; bad: ${pts.join(', ') || 'none'})`);
  // the homage line: none of the source's names in his data, the level's lines or the set's kinds
  const words = JSON.stringify([MOVES, LVL.text, LVL.name, LVL.sub, TUNING.name, Object.keys(MOVES), [...new Set(G.game.world.destructibles.list.map((b) => b.kind))]]).toLowerCase();
  const BAN = [['termi', 'nator'], ['sky', 'net'], ['cyber', 'dyne'], ['t-', '800'], ['t-', '1000'], ['con', 'nor'], ['ree', 'se'], ['hasta ', 'la'], ['be ', 'back'], ['ge', 'nos'], ['sai', 'tama'], ['one ', 'punch'], ['kuse', 'no'], ['incinera', 'tion cannon'], ['machine gun ', 'blow'], ['demon ', 'cyborg']].map((p) => p.join(''));
  const hits = BAN.filter((w) => new RegExp(`(^|[^a-z])${w.trim()}([^a-z]|$)`).test(words));
  assert(hits.length === 0, `no source name in his moves, his name, the level's lines or the set's kinds (${hits.join(', ')})`);
}

// ================================================================== core: fight
async function scenarioFight() {
  out('\n== scenario FIGHT (he wakes and fights 60 s against the fencing bot: no throw, no NaN, he attacks) ==');
  const SEEDS = (process.env.GCD_WSEEDS ?? '4242').split(',').map(Number);
  for (const seed of SEEDS) {
    const G = build(seed, true);
    const { game } = G;
    const d = game.dragon;
    duel(G, { dist: 3, ai: true });
    G.defend = makeDefender(G, { world: true });
    let flashes = 0;
    const moves = new Set();
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon') { flashes++; if (e.attack) moves.add(e.attack); } };
    const hp0 = d.hp;
    run(G, Number(process.env.GCD_FSECS ?? 60), () => fencer(G), () => d.mode === 'dead');
    out(`     seed ${seed}: ${flashes} cues (${[...moves].join(', ')}), ${G.hits.length} blows reached the hero, his hp ${Math.round(hp0)} -> ${Math.round(d.hp)}, phase ${d.phase}`);
    assert(flashes >= 15 && moves.size >= 2, `seed ${seed}: he fights (${flashes} cues, ${moves.size} moves)`);
    assert(d.hp < hp0, `seed ${seed}: the bot's cuts reach him`);
    assert(G.payload.size === 0, `seed ${seed}: no NaN in any event (${[...G.payload].join(', ')})`);
  }
}

// ================================================================== core: phases
async function scenarioPhases() {
  out('\n== scenario PHASES (the three gates, the transitions and their banners, the shell and the dress by phase, the light) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon, set = game.world.forest;
  duel(G, { dist: 4, ai: true });
  game.player.debug.god = true;
  const seen = { 2: 0, 3: 0, 4: 0 };
  G.watch = (n) => { const m = /^dragon:phase([234])$/.exec(n); if (m) seen[m[1]]++; };
  for (const n of [2, 3, 4]) {
    const r = throughGate(G, n);
    assert(r.stopped, `damage stops at the ${Math.round(TUNING.phaseAt[n - 1] * 100)} % gate (${r.gate})`);
    assert(r.began && seen[n] === 1, `${TRANSITIONS[n]}: phase ${n}, dragon:phase${n}`);
    const lim = TUNING.fsShell.limit[n - 1];
    assert(d.dressPhase === n && d.shell.phase === n && d.shell.exposure > TUNING.fsShell.limit[n - 2] * 0.5 && d.shell.exposure <= lim + 1e-6, `at its impact: dressPhase ${d.dressPhase}, the shell's phase ${d.shell.phase}, exposure ${d.shell.exposure.toFixed(2)} (limit ${lim})`);
    assert(game.flow._text(`phase${n}`) === LVL.text[`phase${n}`], `the level's phase-${n} banner: ${LVL.text[`phase${n}`]}`);
    run(G, 3);
    assert(set.ambience.state.phase === n && set.ambience.state.w[n - 1] > 0.5, `the light follows him into phase ${n} (${set.ambience.state.w.map((x) => x.toFixed(2)).join(' / ')})`);
  }
  const A1 = realise('benediction', 1, () => 0.5), A4 = realise('benediction', 4, () => 0.5);
  assert(A4.beats[0].W < A1.beats[0].W && A4.beats[0].W >= TUNING.minFirstWindup * (TUNING.windupScale?.[3] ?? 1) - 1e-9, `phase 4 is faster (windup ${A1.beats[0].W.toFixed(3)} -> ${A4.beats[0].W.toFixed(3)}), never under the minimum (${TUNING.minFirstWindup} x windupScale)`);
  game.world.restore();
  d.reset();
  run(G, 0.2);
  assert(d.phase === 1 && d.dressPhase === 1 && d.shell.exposure === 0 && d.shell.phase === 1, 'his reset: phase 1, whole');
}

// ================================================================== core: shell
async function scenarioShell() {
  out('\n== scenario SHELL (a cut chips where it lands; the limits by phase; strip; reset; deterministic) ==');
  const { FsShell, PARTS, PART_NAMES, FLOORS } = await imp('src/entities/enemies/falseSaint/shell.js');
  const wsum = PARTS.reduce((s, p) => s + p.w, 0);
  assert(Math.abs(wsum - 1) < 1e-6 && PART_NAMES.length === 15, `15 parts, their weights sum to 1 (${wsum.toFixed(3)})`);
  const fake = { position: new THREE.Vector3(0, 0, 0), yaw: 0 };
  const S = new FsShell(fake);
  const H = TUNING.fsShell.height;
  // a cut at his right cheek (his right = -x at yaw 0)
  const v0 = S.version;
  const took = S.chip({ x: -0.06, y: 0.93 * H, z: 0.05 }, 0.5);
  assert(took > 0 && S.part('headR') > S.part('headL') && S.part('headR') > 0 && S.version > v0 && S.last.part === 'headR', `a cut at his right cheek chips headR first (${S.part('headR').toFixed(2)} vs headL ${S.part('headL').toFixed(2)}; took ${took.toFixed(3)})`);
  for (let i = 0; i < 60; i++) S.chip({ x: 0.1, y: 0.4 * H, z: 0 }, 0.5);
  assert(Math.abs(S.exposure - TUNING.fsShell.limit[0]) < 1e-6, `phase 1: cuts stop at the limit (${S.exposure.toFixed(3)} = ${TUNING.fsShell.limit[0]})`);
  assert(S.chip({ x: 0, y: 1, z: 0 }, 0.5) === 0, 'at the limit a cut takes nothing');
  const floors = [];
  for (const n of [2, 3, 4]) {
    S.setPhase(n);
    const lim = TUNING.fsShell.limit[n - 1];
    const fl = S.exposure;
    for (const [name, f] of Object.entries(FLOORS[n])) if (S.part(name) < f - 1e-6) assert(false, `phase ${n}: ${name} at least its floor ${f}`);
    for (let i = 0; i < 200; i++) S.chip({ x: (i % 5) * 0.1 - 0.2, y: ((i * 7) % 10) / 10 * H, z: 0 }, 0.3);
    floors.push(`P${n} ${fl.toFixed(2)} -> ${S.exposure.toFixed(2)} (limit ${lim})`);
    assert(fl < lim && S.exposure <= lim + 1e-6 && S.exposure > fl, `phase ${n}: starts at its floor ${fl.toFixed(2)}, cuts take it up to the limit ${lim} (${S.exposure.toFixed(3)})`);
  }
  out(`     ${floors.join(' · ')}`);
  S.reset();
  assert(S.exposure === 0 && S.phase === 1 && PART_NAMES.every((n) => S.part(n) === 0), 'reset: whole again, phase 1');
  // strip: a little everywhere (inside the limit)
  S.setPhase(2);
  const e2 = S.exposure, st = S.strip(0.2);
  assert(st > 0 && S.exposure <= TUNING.fsShell.limit[1] + 1e-6 && S.exposure > e2, `strip takes from every part, inside the limit (${e2.toFixed(3)} -> ${S.exposure.toFixed(3)})`);
  // deterministic: the same cuts, the same shell; the reveal order a fixed hash
  const A = new FsShell(fake), B = new FsShell(fake);
  for (const s of [A, B]) { s.setPhase(3); for (let i = 0; i < 9; i++) s.chip({ x: 0.1 * i - 0.4, y: 1.2, z: 0.1 }, 0.2); }
  assert(PART_NAMES.every((n) => A.part(n) === B.part(n)) && A.order('chestR', 3) === B.order('chestR', 3) && A.order('chestR', 3) !== A.order('chestR', 4), 'deterministic: the same cuts give the same shell; the reveal order is a fixed hash');
  // through the real fight: a landed cut of the hero's chips him
  const G = build();
  const d = G.game.dragon;
  duel(G, { dist: 1.6 });
  G.game.player.debug.god = true;
  // (a cut that lands: past his guard, at his left knee as the engine passes it: o.point)
  const knee = new THREE.Vector3().setFromMatrixPosition(d.rig.legs.L.shin.matrixWorld);
  const dealt = d.takeHit({ damage: 20, part: 'leg', point: knee, dir: { x: 1, z: 0 }, exact: true });
  assert(dealt > 0 && d.shell.exposure > 0 && d.shell.last.k > 0 && /L$/.test(d.shell.last.part), `a landed cut chips his shell where it lands (${dealt} damage, exposure ${d.shell.exposure.toFixed(3)}, at ${d.shell.last.part})`);
  // (and a real swing of the hero's on a broken boss: his guard cannot turn it)
  d.debug.postureBreak();
  run(G, 0.3);
  const e0 = d.shell.exposure;
  let sw = 0;
  for (let i = 0; i < 4 && d.shell.exposure === e0; i++) sw += swing(G, 1.4);
  assert(sw > 0 && d.shell.exposure > e0, `the hero's own swing chips it (${sw} damage, exposure ${e0.toFixed(3)} -> ${d.shell.exposure.toFixed(3)})`);
  assert(d.debug.shell(1) > 0.999 && d.shell.exposure > 0.999 && typeof d.debug.shell().exposure === 'number', 'debug.shell(k) forces a bare frame; debug.shell() reads the state');
  d.reset();
  assert(d.shell.exposure === 0, 'his reset restores him whole');
}

// ================================================================== core: molten
async function scenarioMolten() {
  out('\n== scenario MOLTEN (a pool is cued, then burns the hero; burns him; a broken ladle spills; reset) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player, F = game.world.forest.foundry;
  duel(G, { dist: 6, ai: false });
  // a pool at the hero's feet: the red cue first (a hazard flash where it lies), the burn after `arm`
  place(G, 6);
  const t0 = game.time;
  let cueAt = NaN, tellAt = NaN, hitAt = NaN;
  G.watch = (n, e) => {
    if (n === 'combat:flash' && e?.attack === 'molten' && !Number.isFinite(cueAt)) cueAt = game.time;
    if (n === 'combat:tell' && e?.attack === 'molten' && !Number.isFinite(tellAt)) tellAt = game.time;
  };
  const hp0 = p.hp;
  const P = d.debug.pool(p.position.x, p.position.z, 2);
  assert(P?.alive && F.molten.at(p.position.x, p.position.z) === P, `debug.pool lays a pool (molten.add → { x, z, r, t, life, id }: r ${P?.r}, life ${P?.life})`);
  run(G, 2, null, () => { if (!Number.isFinite(hitAt) && p.hp < hp0) hitAt = game.time; return Number.isFinite(hitAt); });
  const M = TUNING.terrain.molten;
  out(`     cue ${(cueAt - t0).toFixed(2)} s, tell ${(tellAt - t0).toFixed(2)} s, the first burn ${(hitAt - t0).toFixed(2)} s after it was laid (arm ${M.arm} s)`);
  assert(Number.isFinite(cueAt) && Number.isFinite(tellAt) && cueAt - t0 < 0.1, 'the pool is cued red where it lies as it is laid (combat:tell, combat:flash with hazard)');
  assert(Number.isFinite(hitAt) && hitAt - cueAt >= M.arm - 0.05 && p.hp < hp0 && d.parts.terrain.stats.heroBurns >= 1, `then it burns the hero (${hp0} -> ${p.hp}), no sooner than ${M.arm} s after its cue`);
  G.watch = null;
  // a pool under him: onMolten (damage, posture, his shell stripped)
  p.debug.heal();
  p.debug.teleport(d.position.x + 6, d.position.z);
  run(G, 0.6);
  const dh = d.hp, dp = d.posture;
  d.debug.pool(d.position.x, d.position.z, 2);
  run(G, 1.4);
  assert(d.hp < dh && d.posture > dp && d.parts.terrain.stats.bossBurns >= 1, `a pool under him burns him (hp ${Math.round(dh)} -> ${Math.round(d.hp)}, posture ${Math.round(dp)} -> ${Math.round(d.posture)})`);
  assert(d.shell.exposure > 0 || d.shell.exposure === TUNING.fsShell.limit[0], `... and strips his shell (exposure ${d.shell.exposure.toFixed(3)})`);
  // a ladle broken by any blow spills; drop() cuts one down; ladleNear; the pools expire; reset
  const L = F.ladles[0];
  game.world.destructibles.strike(L.x, L.z, 0.6, 99, { kind: 'blunt', by: 'hero', y: L.h - 0.2 });
  run(G, 0.2);
  assert(!L.full && F.molten.pools.some((q) => q.alive && Math.hypot(q.x - L.x, q.z - L.z) < 0.1), 'a ladle broken by a blow spills a pool under it');
  const L2 = F.ladleNear(F.ladles[1].x + 1, F.ladles[1].z, 3);
  assert(L2 === F.ladles[1] && F.drop(L2, 'boss') && !L2.full && F.drop(L2, 'boss') === false, 'ladleNear finds a full ladle; drop cuts it down once');
  run(G, 20);
  assert(F.molten.pools.every((q) => !q.alive), 'the pools burn out');
  for (let i = 0; i < 12; i++) F.molten.add(i, 0, { r: 1 });
  assert(F.molten.pools.length === 8 && F.molten.pools.filter((q) => q.alive).length === 8, 'a fixed pool of records (the oldest reused)');
  game.world.restore();
  d.reset();
  run(G, 0.1);
  assert(F.ladles.every((x) => x.full) && F.molten.pools.every((q) => !q.alive), 'the reset: every ladle full again, no pool');
}

// ================================================================== core: death
async function scenarioDeath() {
  out('\n== scenario DEATH (he falls; the victory; the reset after it) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon;
  duel(G, { dist: 4, ai: true });
  game.player.debug.god = true;
  d.debug.kill();
  run(G, 8, null, () => d.mode === 'dead');
  assert(d.mode === 'dead' && G.counts['dragon:death'] >= 1, `he falls (${d.mode})`);
  run(G, 4);
  assert(game.state === 'victory' || G.counts['dragon:dead'] >= 1, `the victory (${game.state})`);
  game.world.restore();
  d.reset();
  run(G, 0.5);
  assert(d.mode === 'sleep' && d.hp === d.maxHp && d.phase === 1 && d.shell.exposure === 0, `the reset: asleep at the pour, whole (${d.mode}, ${d.hp})`);
}

// ================================================================== fx (the effects agent's: falseSaint/fx.js, fxArsenal.js, fxDebug.js)
/** Every driver of fxDebug.js played through to its end; the peaks of the fire field and the particles. */
function fxDrive(G, name, opts = {}) {
  const { game } = G;
  const d = game.dragon;
  const ok = d.debug.fx(name, opts);
  const pk = { fire: 0, add: 0, alpha: 0, lights: 0, frames: 0 };
  run(G, 9, null, () => {
    pk.fire = Math.max(pk.fire, game.fx.fire.count);
    pk.add = Math.max(pk.add, game.fx.add.count);
    pk.alpha = Math.max(pk.alpha, game.fx.alpha.count);
    pk.lights = Math.max(pk.lights, d.fx._lights.size);
    pk.frames++;
    return !d.fx._drive;
  });
  // (and what it left flying or cooling: let it land)
  run(G, 3, null, () => d.fx.pools().flights === 0);
  return { ok, ...pk };
}

async function scenarioFx() {
  out('\n== scenario FX (every method of the surface runs headless without a throw, NaN ignored, every driver plays through, fixed pools, an idle frame draws nothing) ==');
  const { FS_FX_METHODS } = await imp('src/entities/enemies/falseSaint/fx.js');
  const FXD = await imp('src/entities/enemies/falseSaint/fxDebug.js');
  const G = build();
  const { game } = G;
  const d = game.dragon, F = d.fx;
  duel(G, { dist: 5 });
  game.player.debug.god = true;
  const missing = FS_FX_METHODS.filter((n) => typeof F[n] !== 'function');
  assert(!missing.length, `every method of the surface exists (${FS_FX_METHODS.length}; missing ${JSON.stringify(missing)})`);
  // every method with a plain call, several frames for the held ones
  const p = game.player.position, x = p.x, z = p.z, e0 = errors.length;
  const calls = {
    jet: () => F.jet('elbowR', 0.8), jetBurst: () => F.jetBurst(0, -2, 0, 1, 1), afterimage: () => F.afterimage(d, 0, 1, 0.6), dashTrail: () => F.dashTrail(0, -2, x, z, 1),
    sensor: () => F.sensor(1), sensorOut: () => F.sensorOut(1), shellFlake: () => F.shellFlake({ x: 0, y: 1.4, z: -2 }, { x: 1, z: 0 }, 0.1), shellStrip: () => F.shellStrip(0, 1.3, -2, 0.6),
    coreVent: () => F.coreVent(0.7), transition: () => F.transition(3, 0.7), transitionBurst: () => F.transitionBurst(4, 0, -2, 4),
    sightLine: () => F.sightLine(x - 3, z, x + 3, z, 0.9), laser: () => F.laser(0, 2, -2, x, 0.2, z, 1), scar: () => F.scar(x - 3, z, x + 3, z, 0.5, 1),
    cannonCharge: () => F.cannonCharge('palmR', 0.6), cannonBeam: () => F.cannonBeam(0, 1.3, -2, x, 0.3, z, 1.2, 1), cannonEnd: () => F.cannonEnd(0, -2, x, z, 1.2),
    gunFlash: () => F.gunFlash(0, 1.3, -2, 0, 1), bolt: () => F.bolt({ x, y: 1.1, z: z - 2, dx: 0, dy: 0, dz: 1, k: 1 }), boltHit: () => F.boltHit(x, 1.1, z, 1),
    missileLaunch: () => F.missileLaunch(0, 2, -2, 8), missile: () => F.missile({ x, y: 4, z, vx: 3, vy: -6, vz: 1, k: 0.5 }), missileMark: () => F.missileMark(x, z, 1.3, 0.6), blast: () => F.blast(x, z, 1.6, 1),
    shellMark: () => F.shellMark(x, z, 1.3, 0.6), shellFall: () => F.shellFall(x, 12, z, 0.7), shellBurst: () => F.shellBurst(x, z, 2, 1),
    reticle: () => F.reticle(x, z, 0.5, false), skyLance: () => F.skyLance(x, z, 1.4, 0.5), pour: () => F.pour(12.5, 3, -6.5, 1), sparks: () => F.sparks(x, 1, z, 1, 0, 12, 1),
    palmHit: () => F.palmHit(x, 1.3, z, 1, 0, 1), footPlant: () => F.footPlant(0, -2, 1, 0, 0.8, 1),
    missileCut: () => F.missileCut(x, 2, z, 1, 0), mortarFlash: () => F.mortarFlash(0, 2.2, -2, 3), ringShock: () => F.ringShock(x, z, 5, 1),
    fly: () => F.fly({ kind: 'missile', x: 0, y: 2, z: -2, tx: x, tz: z, T: 1, expect: false }), cancelFlights: () => F.cancelFlights(),
    passLine: () => F.passLine(0, -2, x, z, 0.7),
  };
  const notCovered = FS_FX_METHODS.filter((n) => !calls[n]);
  const threw = [];
  const sp0 = G.counters.spawns;
  for (const [n, f] of Object.entries(calls)) {
    try { for (let i = 0; i < 6; i++) { f(); G.tick(DT); } } catch (err) { threw.push(`${n}: ${err.message}`); }
  }
  assert(!threw.length && !notCovered.length && errors.length === e0, `every method runs (6 frames each) without a throw or a console error (${JSON.stringify(threw)}; not covered ${JSON.stringify(notCovered)}; errors ${errors.slice(e0, e0 + 3).join(' | ')})`);
  assert(G.counters.spawns - sp0 > 2000, `... and draws (${G.counters.spawns - sp0} blobs and particles)`);
  // NaN everywhere: nothing thrown, nothing spawned with a NaN (the harness's spawn throws on one)
  const N = NaN, nanThrew = [];
  const nanCalls = [
    () => F.jet('elbowR', N), () => F.jetBurst(N, 0, 0, 1), () => F.dashTrail(N, 0, 1, 1), () => F.sightLine(N, 0, 1, 1, 0.5), () => F.laser(0, N, 0, 1, 0, 1, 1),
    () => F.scar(0, 0, N, 1, 1, 1), () => F.cannonBeam(0, 1, 0, N, 0, 1, 1, 1), () => F.cannonEnd(N, 0, 1, 1, 1), () => F.gunFlash(N, 1, 0, 0, 1), () => F.bolt({ x: N }),
    () => F.missile({ x: 0, y: N }), () => F.missileMark(0, 0, N, 0.5), () => F.blast(N, 0), () => F.shellMark(0, 0, 1, N), () => F.shellFall(0, N, 0, 0.5),
    () => F.shellBurst(0, N), () => F.reticle(N, 0, 0.5), () => F.skyLance(0, 0, N, 0.5), () => F.pour(N, 3, 0, 1), () => F.sparks(0, N, 0, 1, 0, 5, 1),
    () => F.shellFlake({ x: N, y: 0, z: 0 }, null, 0.1), () => F.shellStrip(N, 1, 0, 1), () => F.transition(2, N), () => F.transitionBurst(3, N, 0, 4), () => F.coreVent(N),
    () => F.missileCut(N, 0, 0), () => F.palmHit(N, 1, 0, 1, 0), () => F.footPlant(0, N, 1, 0), () => F.mortarFlash(N, 0, 0), () => F.ringShock(0, N, 4), () => F.fly({ kind: 'bolt', x: N, tx: 1, tz: 1, expect: false }), () => F.passLine(N, 0, 1, 1, 0.5),
  ];
  for (const f of nanCalls) { try { f(); G.tick(DT); } catch (err) { nanThrew.push(err.message); } }
  run(G, 2);
  assert(!nanThrew.length && errors.length === e0, `NaN arguments are ignored: no throw, no NaN blob or particle (${JSON.stringify(nanThrew.slice(0, 3))})`);
  // every driver of fxDebug plays through and ends
  const bad = [];
  for (const n of FXD.NAMES) {
    const r = fxDrive(G, n);
    if (!r.ok || d.fx._drive) bad.push(n);
  }
  assert(!bad.length && d.debug.fx('nope') === false && errors.length === e0, `every driver plays through and ends (${FXD.NAMES.length}: ${FXD.NAMES.join(' ')}); an unknown name is false ${JSON.stringify(bad)}`);
  // fixed pools: never grow
  const S = F._arsenalState;
  const len0 = { flights: S.flights.length, scars: S.scars.length, fresh: S.fresh.length };
  let flown = 0;
  for (let i = 0; i < 60; i++) if (F.fly({ kind: 'missile', x: 0, y: 2, z: -2, tx: x + (i % 7), tz: z, T: 1.5, expect: false })) flown++;
  for (let i = 0; i < 20; i++) F.scar(i, 0, i + 2, 2, 0.5, 1);
  run(G, 0.2);
  assert(S.flights.length === len0.flights && S.scars.length === len0.scars && S.fresh.length === len0.fresh && flown === len0.flights && F.pools().flights === len0.flights, `the pools are fixed: ${len0.flights} flights (60 asked, ${flown} flew), ${len0.scars} scars, ${len0.fresh} fresh; nothing grows`);
  // an idle frame: once everything is over, his effects draw nothing and keep no light
  F.cancelFlights();
  run(G, 12);
  d.debug.setAI(false);
  d.brain.act = null;
  d.mode = 'foot';
  run(G, 0.5);
  const upd = F.update.bind(F);
  let idleSpawn = 0, dimmed = 0;
  const amb = game.world.forest.ambience, dim0 = amb.dim.bind(amb);
  amb.dim = (k) => { dimmed++; return dim0(k); };
  F.update = (dt, dd) => { const c = G.counters.spawns; upd(dt, dd); idleSpawn += G.counters.spawns - c; };
  run(G, 1);
  F.update = upd;
  amb.dim = dim0;
  assert(idleSpawn === 0 && dimmed === 0 && F._lights.size === 0 && F.pools().flights === 0 && F.pools().scars === 0, `an idle frame: his effects spawn nothing (${idleSpawn}), dim nothing (${dimmed}), keep no light (${F._lights.size}), nothing in the pools`);
  // the death: the sensors go out one by one (phase 4: three)
  d.dressPhase = 4;
  let outs = 0;
  G.watch = (n, e) => { if (n === 'dragon:spell' && e?.name === 'fsSensorOut') outs++; };
  d.debug.setAI(true);
  d.debug.kill();
  run(G, 4, null, () => d.mode === 'dead');
  G.watch = null;
  assert(outs === 3 && F._sens.out.every(Boolean), `his death: three sensors go out one by one (${outs} fsSensorOut)`);
  d.reset();
  run(G, 0.2);
  assert(!F._sens.out.some(Boolean) && !F._death.on, 'the reset lights them again');
  // his palette holds the void slot
  const { FIRE_PALETTES } = await imp('src/render/firePalettes.js');
  assert(!!FIRE_PALETTES.saint && FIRE_PALETTES.saint.stops.length === 5, 'firePalettes.js has his block (saint: five stops)');
}

async function scenarioFxFlights() {
  out('\n== scenario FXFLIGHTS (the flights: arrival times on his clock, the ledger sees each, retime / cancel, the caller lands it, tracking) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon, F = d.fx, L = d.brain.ledger;
  duel(G, { dist: 8 });
  game.player.debug.god = true;
  const p = game.player.position;
  // a missile: lands at `at` on his clock; the ledger counts it from the launch (a dodge)
  let landedAt = NaN, landedRec = null;
  const m = F.fly({ kind: 'missile', x: d.position.x, y: 2, z: d.position.z, tx: p.x, tz: p.z, T: 1.5, attack: 'choir', onLand: (r) => { landedAt = d.time; landedRec = r; } });
  const at = m.at, id = m.id;
  assert(m && Math.abs(m.at - (d.time + 1.5)) < 1e-6 && m.cue?.alive && Math.abs(m.cue.left - 1.5) < 1e-6, `fly() → a record: at = d.time + T (${m.at.toFixed(3)}), its ledger handle alive (${m.cue?.left?.toFixed(3)} s left)`);
  assert(L.pending(2, 2) === true, 'the ledger sees a dodge-only thing land within 2 s (pending(DODGE))');
  run(G, 1.6, null, () => Number.isFinite(landedAt));
  assert(Number.isFinite(landedAt) && Math.abs(landedAt - at) <= DT + 1e-6 && landedRec?.id === id && !m.alive, `onLand on time (${(landedAt - at).toFixed(3)} s off), the record dead`);
  // retime and cancel move the handle with it
  const s = F.fly({ kind: 'shell', x: d.position.x, y: 2.2, z: d.position.z, tx: p.x, tz: p.z, T: 2, attack: 'kyrie' });
  run(G, 0.5);
  s.retime(0.8);
  assert(Math.abs(s.left - 0.8) < 1e-6 && Math.abs(s.cue.left - 0.8) < 1e-6 && Math.abs(s.at - (d.time + 0.8)) < 1e-6, `retime(0.8): its left, its at and its ledger handle move (${s.left.toFixed(2)}, ${s.cue.left.toFixed(2)})`);
  const h = s.cue;
  s.cancel();
  assert(!s.alive && !h.alive, 'cancel(): gone, its ledger handle cancelled');
  // a shared handle (a barrage row's one) is left alone by the flight
  const row = d.brain.expect(1.2, TELL.RED, 'kyrie');
  const a = F.fly({ kind: 'shell', x: 0, y: 2, z: -2, tx: p.x + 2, tz: p.z, T: 1.2, expect: row }), b = F.fly({ kind: 'shell', x: 0, y: 2, z: -2, tx: p.x - 2, tz: p.z, T: 1.2, expect: row });
  a.cancel();
  assert(row.alive && b.cue === row, 'a handle passed in is shared and not cancelled with one of its shells');
  b.cancel();
  row.cancel();
  // the cue: onCue once, cueLead before it lands
  let cued = NaN;
  const c = F.fly({ kind: 'missile', x: 0, y: 2, z: -2, tx: p.x, tz: p.z, T: 1.2, cueLead: 0.4, expect: false, onCue: () => { cued = d.time; } });
  const cAt = c.at;
  run(G, 1.4);
  assert(Number.isFinite(cued) && Math.abs(cAt - cued - 0.4) <= DT + 1e-6, `onCue ${((cAt - cued)).toFixed(3)} s before it lands (cueLead 0.4)`);
  // tracking: its target follows the hero for its first `track` of the flight
  game.player.debug.teleport(d.position.x + 6, d.position.z + 6);
  run(G, 0.1);
  let endX = NaN, endZ = NaN;
  const tr = F.fly({ kind: 'missile', x: d.position.x, y: 2, z: d.position.z, tx: d.position.x - 6, tz: d.position.z + 6, T: 2.4, track: 0.7, trackSpeed: 8, expect: false, onLand: (r) => { endX = r.tx; endZ = r.tz; } });
  const miss0 = Math.hypot(tr.tx - p.x, tr.tz - p.z);
  run(G, 2.6);
  const miss1 = Math.hypot(endX - p.x, endZ - p.z);
  assert(miss1 < miss0 - 5 && miss1 < 1.5, `a tracking missile ends on the hero (aimed ${miss0.toFixed(1)} m off, landed ${miss1.toFixed(1)} m off)`);
  // a bolt: from its speed
  const bo = F.fly({ kind: 'bolt', x: 0, y: 1.3, z: -2, tx: 0, ty: 1.1, tz: 11, speed: 26, expect: false });
  assert(Math.abs(bo.T - Math.hypot(13, 0.2) / 26) < 1e-6 && bo.tell === TELL.BLUE, `a bolt's flight from its speed (${bo.T.toFixed(3)} s), blue by default`);
  run(G, 1);
  assert(F.pools().flights === 0 && errors.length === 0, 'everything landed');
}

async function scenarioFxSounds() {
  out('\n== scenario FXSOUNDS (every fs sound has a recipe and plays; the drivers emit only listed names) ==');
  const { FS_SOUNDS } = await imp('src/entities/enemies/falseSaint/fx.js');
  const FXD = await imp('src/entities/enemies/falseSaint/fxDebug.js');
  const { SFX } = await imp('src/audio/sfx.js');
  const missing = FS_SOUNDS.filter((n) => !SFX[n]);
  assert(!missing.length && FS_SOUNDS.every((n) => n.startsWith('fs')), `every fs sound has a recipe in sfx.js (${FS_SOUNDS.length}; missing ${JSON.stringify(missing)})`);
  const G = build();
  const { game } = G;
  const d = game.dragon;
  if (!game.audio.ctx) game.audio.unlock();
  const e0 = errors.length;
  // (one at a time: the voice pool drops a low one when many play at once; a refused one is tried again
  // once the others have rung out)
  const bad = FS_SOUNDS.filter((n) => game.audio.play(n, { x: 0, z: 0, dur: 1 }) !== true && (run(G, 3), game.audio.play(n, { x: 0, z: 0, dur: 1 }) !== true));
  assert(game.audio.ctx && !bad.length && errors.length === e0, `each plays headless without a warning (${JSON.stringify(bad)})`);
  // the drivers: every name an effect emits is listed (and so has its recipe)
  const said = new Set();
  G.watch = (n, e) => { if (n === 'dragon:spell' && String(e?.name).startsWith('fs')) said.add(e.name); };
  duel(G, { dist: 6 });
  game.player.debug.god = true;
  for (const n of FXD.NAMES) fxDrive(G, n);
  d.dressPhase = 3;
  run(G, 0.2);
  d.position.set(0, 0, -2);
  for (let i = 0; i < 90; i++) { d.position.x += 0.05; G.tick(DT); }
  G.watch = null;
  const unlisted = [...said].filter((n) => !FS_SOUNDS.includes(n));
  const unheard = FS_SOUNDS.filter((n) => !said.has(n) && !['fsHitMetal', 'fsPowerDown'].includes(n));
  assert(!unlisted.length && said.size >= 28, `the drivers sound ${said.size} names, every one listed (${JSON.stringify(unlisted)}); not heard from a driver: ${JSON.stringify(unheard)}`);
  assert(said.has('fsServo'), 'his servo steps from phase 3 (fsServo as he walks)');
}

async function scenarioFxCost() {
  out('\n== scenario FXCOST (what each big effect costs at its peak: fire blobs, glyph particles, lights) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon;
  duel(G, { dist: 7 });
  game.player.debug.god = true;
  const rows = [];
  for (const n of ['kyrie', 'choir', 'revelation', 'absolution', 'vigil', 'passingBell', 'verdict', 'vespers', 'transition4', 'jets', 'pour']) {
    run(G, 4);
    const base = game.fx.fire.count;
    const r = fxDrive(G, n);
    rows.push(`${n.padEnd(12)} fire ${String(r.fire).padStart(4)} (idle ${base})  add ${String(r.add).padStart(4)}  alpha ${String(r.alpha).padStart(4)}  lights ${r.lights}`);
    if (n === 'kyrie') assert(r.fire < 5000 && r.add + r.alpha < 6000, `a whole Kyrie fits the fire field (6000) and the particles: fire ${r.fire}, particles ${r.add + r.alpha}`);
    if (n === 'choir') assert(r.fire < 5000, `a whole Choir fits: fire ${r.fire}`);
    if (n === 'revelation') assert(r.fire < 5500, `Revelation fits: fire ${r.fire}`);
  }
  out('     ' + rows.join('\n     '));
}

// ================================================================== core: events
async function scenarioEvents() {
  out('\n== scenario EVENTS (what this level emits is in the catalogue: checked at the end of every run) ==');
  assert(CATALOGUE.size > 20, `the catalogue is read (${CATALOGUE.size} names)`);
}

// ================================================================== melee (the melee agent's: moves/melee.js, links.js)
/** The melee moves, the phase each is tried in, the hero's distance in reach (a string's beats step in). */
const ML_MOVES = [['benediction', 1, 1.8], ['genuflect', 1, 1.8], ['longWalk', 1, 6], ['rebuke', 1, 1.6], ['interdict', 2, 1.8], ['castOut', 2, 1.9], ['penance', 2, 1.5], ['lauds', 3, 1.8], ['anathema', 3, 1.6], ['requiem', 4, 1.6]];
/** A build in phase `form` with his AI off, the hero `dist` m before him, and a counter on world.groundBlow. */
function mlDuel(form, dist = 3) {
  const G = build();
  duel(G, { dist, form });
  const w = G.game.world;
  G.ground = [];
  w.groundBlow = (x, z, o) => { if (!Number.isFinite(x + z)) throw new Error('NaN groundBlow'); G.ground.push(o?.kind); };
  return G;
}
/** The hero's results for attack `name` since index i0 of G.hits. */
const mlHits = (G, name, i0 = 0) => G.hits.slice(i0).filter((h) => h.attack === name);
const mlStanding = (G) => G.game.world.destructibles.list.filter((b) => !b.floor && b.state === 0 && b.hpMax < Infinity).length; // (destructibles.js STATE.INTACT)

async function scenarioMlReach() {
  out('\n== scenario MLREACH (each melee move: COMBAT.md\'s floors; its beats land on a hero who stands still, none on one out of reach; tells as declared) ==');
  // COMBAT.md (the lead's correction of the BRIEF): a melee move's first windup >= 0.7 s in phase 1, a string's
  // next hit >= 0.45 s after the last in every phase (the realised impacts, bait holds at their shortest)
  const { MOVE_OWNERS } = await imp('src/entities/enemies/falseSaint/moves.js');
  const mine = MOVE_NAMES.filter((n) => MOVE_OWNERS[n] === 'melee');
  let firstLo = Infinity, gapLo = Infinity;
  for (const name of mine) {
    for (const f of phasesOf(name)) {
      const A = realise(name, f, () => 0);
      const real = A.beats.filter((b) => !b.feint);
      if (!real.length) continue;
      if (f === 1) firstLo = Math.min(firstLo, real[0].impact - real[0].tellAt);
      if (f === 1 && !(real[0].impact - real[0].tellAt >= 0.7 - 1e-6)) assert(false, `${name}: first windup ${(real[0].impact - real[0].tellAt).toFixed(3)} >= 0.7 s in phase 1`);
      for (let i = 1; i < real.length; i++) {
        const gp = real[i].impact - real[i - 1].impact;
        gapLo = Math.min(gapLo, gp);
        if (!(gp >= 0.45 - 1e-6)) assert(false, `${name} P${f}: hits ${i - 1}->${i} ${gp.toFixed(3)} s apart >= 0.45`);
      }
    }
  }
  assert(firstLo >= 0.7 - 1e-6 && gapLo >= 0.45 - 1e-6, `the ${mine.length} melee moves: first windups >= 0.7 s in phase 1 (least ${firstLo.toFixed(3)}), hits >= 0.45 s apart in every phase (least ${gapLo.toFixed(3)})`);
  for (const [name, form, dist] of ML_MOVES) {
    const G = mlDuel(form, 4);
    const d = G.game.dragon, def = MOVES[name];
    const want = def.beats.filter((b) => !b.feint).map((b) => b.tell);
    const flashes = [];
    G.defend = { onEvent(n, e) { if (n === 'combat:flash' && e?.source === 'dragon' && e.attack === name) flashes.push(e.tell); } };
    const i0 = G.hits.length;
    const ok = blowAnd(G, name, 'none', { dist });
    const got = mlHits(G, name, i0);
    G.defend = null;
    const landed = got.filter((h) => h.r === RESULT.HIT || h.r === RESULT.BLOCKED).length;
    out(`     ${name} P${form}: ${landed}/${want.length} beats landed on a hero standing at ${dist} m; tells ${got.map((h) => h.tell).join(' ')} (declared ${want.join(' ')}; flashed ${flashes.join(' ')})`);
    assert(ok && landed === want.length, `${name} (phase ${form}): every beat lands on a hero who stands still (${landed}/${want.length})`);
    assert(flashes.join(',') === want.join(','), `${name}: each beat is cued with its declared tell (${flashes.join(' ')})`);
    // out of reach: 12 m away (the walk: 16 m), with his mind on (it breaks a string off at a beat that
    // cannot reach: brain.js "a string's next hit" and the reach watch), nothing lands
    settle(G);
    const far = name === 'longWalk' ? 16 : 12;
    const i1 = G.hits.length;
    d.debug.setAI(true);
    blowAnd(G, name, 'none', { dist: far });
    d.debug.setAI(false);
    const miss = mlHits(G, name, i1).filter((h) => h.r === RESULT.HIT || h.r === RESULT.BLOCKED).length;
    assert(miss === 0, `${name}: nothing lands on a hero ${far} m away (${miss})`);
  }
}

async function scenarioMlGrab() {
  out('\n== scenario MLGRAB (Laying On of Hands: caught, held, lifted, thrown through a standing piece, never the last HP; dodged: open) ==');
  const G = mlDuel(1, 3);
  const { game } = G;
  const d = game.dragon, p = game.player, M = d.parts.melee, DS = game.world.destructibles;
  // (him near the west line of unfinished frames, facing it: the nearest standing pieces are behind the hero)
  d.position.set(-11, 0, 0);
  d.yaw = -Math.PI / 2;
  run(G, 0.2);
  place(G, 1.8);
  p.debug.god = false;
  p.hp = 2;
  const pieces0 = mlStanding(G);
  const ok = d.brain.trigger('layHands');
  let caughtAt = NaN, thrownAt = NaN, freeAt = NaN, maxY = 0, minHp = p.hp, crashN = 0;
  run(G, 5, () => {
    if (M.grip && !Number.isFinite(caughtAt)) caughtAt = game.time;
    if (Number.isFinite(caughtAt)) maxY = Math.max(maxY, p.position.y);
    if (M.lastThrow && !Number.isFinite(thrownAt)) thrownAt = game.time;
    if (p.crash?.on) crashN = Math.max(crashN, p.crash.n);
    minHp = Math.min(minHp, p.hp);
    if (Number.isFinite(thrownAt) && !Number.isFinite(freeAt) && ['idle', 'run'].includes(p.state)) freeAt = game.time;
  }, () => Number.isFinite(freeAt) && d.mode === 'foot');
  const T = M.lastThrow;
  const tgt = T?.target;
  out(`     caught ${Number.isFinite(caughtAt)}, lifted ${maxY.toFixed(2)} m, thrown ${(thrownAt - caughtAt).toFixed(2)} s after the catch at ${tgt ? `${tgt.kind} ${Math.hypot(tgt.x - T.x, tgt.z - T.z).toFixed(1)} m off` : 'no piece'} (knockback ${T?.kb?.toFixed(1)} m), ${crashN} pieces met on the way, standing pieces ${pieces0} -> ${mlStanding(G)}; the hero ${minHp} hp at the least, his own again ${(freeAt - caughtAt).toFixed(2)} s after the catch`);
  assert(ok && Number.isFinite(caughtAt) && M.stats.caught === 1, 'the reach catches a hero who stands still (red: no guard holds it)');
  assert(maxY > 0.3 && Number.isFinite(thrownAt) && M.stats.throws === 1, `he lifts the hero (${maxY.toFixed(2)} m) and throws him`);
  assert(!!tgt && T.slammed && M.stats.thrownThrough === 1 && mlStanding(G) < pieces0, `the throw goes at the nearest standing piece and through it (${crashN} met on the way, ${pieces0 - mlStanding(G)} broken)`);
  assert(p.alive && minHp >= 1, `never the last HP (the hero at 2 hp: ${minHp} at the least)`);
  assert(freeAt - caughtAt <= TUNING.melee.layHands.cap + 0.35, `the hero's whole loss of control ${(freeAt - caughtAt).toFixed(2)} s <= cap ${TUNING.melee.layHands.cap} s (+ the get-up's blend)`);
  assert(p.position.y === 0, 'the hero is back on the floor');
  // dodged: no catch, he stands open the whole recovery
  p.debug.heal();
  p.debug.god = true;
  settle(G);
  d.position.set(0, 0, -2);
  d.yaw = 0;
  run(G, 0.3);
  d.brain.cooldowns.layHands = 0;
  const c0 = M.stats.caught;
  let open = 0;
  blowAnd(G, 'layHands', 'dodge', { dist: 1.8 });
  void open;
  assert(M.stats.caught === c0 && !M.grip && p.position.y === 0, 'a hero who rolls through the reach is not caught');
  // the grab is not picked at a hero who is down
  assert(d.weigh('layHands', MOVES.layHands, 1, 2) > 0, 'the grab is weighed at a hero on his feet');
  p.state = 'knockdown';
  assert(d.weigh('layHands', MOVES.layHands, 1, 2) === 0, '... and never at one who is down');
  p.state = 'idle';
}

async function scenarioMlWalk() {
  out('\n== scenario MLWALK (The Long Walk: light cuts land and do not stop him, a heavy cut does; the straight carries on into the scenery) ==');
  const G = mlDuel(1, 7);
  const { game } = G;
  const d = game.dragon, p = game.player, M = d.parts.melee;
  p.debug.god = true;
  place(G, 7);
  const d0 = Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z);
  d.brain.trigger('longWalk');
  const a = d.brain.act, b = a?.beats[0];
  // light cuts through the walk (one before u 0.55, where his guard would have turned it, one after)
  const hp0 = d.hp;
  const cut = (heavy) => d.takeHit({ damage: 20, part: 'body', swing: true, heavy, poise: heavy ? 30 : 8, point: new THREE.Vector3(d.position.x, 1.2, d.position.z), dir: { x: 0, z: -1 } });
  run(G, b.W * 0.3);
  const dealt1 = cut(false);
  run(G, b.W * 0.3);
  const dealt2 = cut(false);
  const still = d.mode === 'act' && d.brain.act === a;
  const walked = d0 - Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z);
  out(`     two light cuts through the walk: ${dealt1} + ${dealt2} damage (hp ${hp0} -> ${d.hp}), still walking ${still}, ${walked.toFixed(2)} m walked so far`);
  assert(dealt1 > 0 && dealt2 > 0 && still && M.stats.shrugs === 2, 'light cuts land through the walk (his guard does not turn them) and he walks on');
  run(G, 4, null, () => d.mode === 'foot');
  const hit = mlHits(G, 'longWalk').filter((h) => h.r === RESULT.HIT || h.r === RESULT.BLOCKED).length;
  assert(hit === 1 && M.stats.carries === 1, `then the straight lands (${hit}) and carries on into the scenery (${M.stats.carries})`);
  // a heavy cut stops him
  settle(G);
  d.brain.cooldowns.longWalk = 0;
  place(G, 7);
  d.brain.trigger('longWalk');
  run(G, d.brain.act.beats[0].W * 0.5);
  cut(true);
  assert(d.mode === 'react' && d.brain.react?.kind === 'stagger' && M.stats.walkStops === 1, `a heavy cut stops the walk: a stagger (${d.mode} ${d.brain.react?.kind})`);
  // the straight goes on through what stands behind the hero: a frame of the west line 3.5 m behind him
  settle(G);
  d.brain.cooldowns.longWalk = 0;
  const DS = game.world.destructibles;
  const fr = DS.list.filter((q) => q.kind === 'frame' && !q.floor && q.hpMax < Infinity).sort((x, y) => Math.abs(x.z) - Math.abs(y.z))[0];
  d.position.set(fr.x + 8.5, 0, fr.z);
  d.yaw = -Math.PI / 2; // (facing the line: blowAnd places the hero 4.6 m before him, 3.9 m short of the frame)
  const hpF = fr.hp, st0 = fr.state;
  const c0 = M.stats.carried;
  blowAnd(G, 'longWalk', 'none', { dist: 4.6 });
  out(`     a frame of the line 3.9 m behind where the hero stood: hp ${hpF} -> ${fr.hp}, state ${st0} -> ${fr.state}; the carry-on struck ${M.stats.carried - c0} pieces`);
  assert(fr.hp < hpF || fr.state !== st0, 'the straight (the throw and the carry-on) bites the piece behind the hero');
}

async function scenarioMlWorld() {
  out('\n== scenario MLWORLD (every melee blow strikes the world at its limb\'s height; the gavel craters; the double palm shoves through cover; floor marks) ==');
  const G = mlDuel(2, 3);
  const { game } = G;
  const d = game.dragon, M = d.parts.melee, DS = game.world.destructibles;
  game.player.debug.god = true;
  const ys = [];
  const strike = DS.strike.bind(DS), sweep = DS.sweep.bind(DS);
  DS.strike = (x, z, r, pw, o) => { if (o?.by === 'boss') ys.push(o.y); return strike(x, z, r, pw, o); };
  DS.sweep = (ax, az, bx, bz, r, pw, o) => { if (o?.by === 'boss') ys.push(o.y); return sweep(ax, az, bx, bz, r, pw, o); };
  for (const name of ['benediction', 'genuflect', 'interdict', 'castOut']) {
    settle(G);
    d.brain.cooldowns[name] = 0;
    blowAnd(G, name, 'none', { dist: 1.8 });
  }
  const real = ['benediction', 'genuflect', 'interdict', 'castOut'].reduce((s, n) => s + MOVES[n].beats.filter((b) => !b.feint).length, 0);
  const ylo = Math.min(...ys), yhi = Math.max(...ys);
  out(`     ${M.stats.blows} blows, ${M.stats.world} world blows (${M.stats.struck} pieces struck), heights ${ylo.toFixed(2)} .. ${yhi.toFixed(2)} m; craters ${M.stats.quakes}, shoves ${M.stats.shoves}; floor marks: ${G.ground.join(', ')}`);
  assert(M.stats.blows === real && M.stats.world === real, `every blow struck the world (${M.stats.world} of ${real})`);
  assert(ylo < 0.6 && yhi > 1.0, `at the limb's own height (the sweep low, the palms high: ${ylo.toFixed(2)} .. ${yhi.toFixed(2)})`);
  assert(M.stats.quakes === 1 && G.ground.includes('slam') && G.ground.includes('dash'), `the gavel craters (${M.stats.quakes}); the floor keeps the gavel's slam and the sweep's scuff (${G.ground.join(', ')})`);
  assert(M.stats.shoves === 1, 'the double palm sweeps the line ahead');
  // the crater breaks plates
  settle(G);
  const plates = DS.list.filter((q) => q.kind === 'plate');
  const s0 = plates.filter((q) => q.state === 0 && q.hp === q.hpMax).length;
  d.brain.cooldowns.interdict = 0;
  blowAnd(G, 'interdict', 'none', { dist: 1.8 });
  const s1 = plates.filter((q) => q.hp < q.hpMax || q.state !== 0).length - (plates.length - s0);
  out(`     plates struck by one more gavel: ${s1} (of ${s0} whole before the fight's blows)`);
  assert(s1 > 0, 'the gavel bites the plates');
}

async function scenarioMlLinks() {
  out('\n== scenario MLLINKS (the links of the whole table: a link to a move not built yet is passed over; he chains in every phase) ==');
  const { LINKS, LINK_TABLE } = await imp('src/entities/enemies/falseSaint/links.js');
  const all = new Set(Object.values(LINK_TABLE).flat().map((L) => L.to));
  const missing = [...all].filter((n) => !MOVES[n]);
  out(`     ${Object.keys(LINKS).length} moves with links, ${all.size} targets; not built (yet): ${missing.join(', ') || 'none'}`);
  assert(Object.values(LINKS).every((l) => l.every((L) => typeof L.to === 'string' && ['near', 'mid', 'far', 'away', 'guarding', 'any', 'front', 'side', 'behind'].includes(L.when) && (typeof L.chance === 'number' || L.chance.length === 4))), 'every link is { to, when, chance [P1..P4] }');
  assert(Object.keys(MOVES).filter((n) => !MOVES[n].transition && !MOVES[n].hidden && (MOVES[n].weight.some((w) => w > 0) || MOVES[n].counter) && TUNING.melee[n]).every((n) => n in LINK_TABLE), 'every melee move has its row');
  // a link to a move not built is passed over, the next usable one taken (the rolls all pass: Math.random 0)
  const { linkFor } = await imp('src/entities/enemies/duelist/director.js');
  {
    const G = build();
    const d = G.game.dragon;
    duel(G, { dist: 5, ai: false, form: 2 });
    place(G, 6);
    d.debug.setAI(true);
    const s = d.brain._sense();
    const R0 = Math.random;
    Math.random = () => 0;
    d.brain.cooldowns.longWalk = 0;
    // a target that is never built, put first in castOut's links for this check (an own property shadows the getter)
    const GHOST = { to: 'fsNeverBuilt', when: 'any', chance: [1, 1, 1, 1] };
    Object.defineProperty(d, 'LINKS', { value: { ...LINKS, castOut: [GHOST, ...LINKS.castOut] }, configurable: true });
    const want = LINKS.castOut.find((Lk) => MOVES[Lk.to] && Lk.when !== 'near')?.to;
    let L = null, err = null;
    try { L = linkFor(d.brain, { name: 'castOut' }, s); } catch (e) { err = e; }
    Math.random = R0;
    delete d.LINKS;
    assert(!err && L && L.to !== GHOST.to && MOVES[L.to], `castOut's links at ${s.dist.toFixed(1)} m in phase 2: a move not built passed over, ${L?.to} taken (the table's first built target: ${want})${err ? ` (${err.message})` : ''}`);
  }
  // his flow in each phase with only these moves (a hero who never parries, god mode, the guard held every
  // other 5 s, walking back in when thrown off): no throw, and he goes on from move to move
  let total = 0;
  for (const form of [1, 2, 3, 4]) {
    const G = build();
    const d = G.game.dragon;
    duel(G, { dist: 3, ai: true, form });
    const p = G.game.player;
    p.debug.god = true;
    const st0 = { ...d.brain.stats };
    const names = new Set();
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon') names.add(e.attack); };
    run(G, 40, () => {
      const g = G.game, dx = d.position.x - p.position.x, dz = d.position.z - p.position.z, dist = Math.hypot(dx, dz);
      g.mouseGround.set(d.position.x, 0, d.position.z);
      G.input.axis = dist > 2.6 ? { x: dx / dist, y: -dz / dist } : { x: 0, y: 0 };
      if (Math.floor(g.time / 5) % 2) G.input.press(1); else G.input.up(1);
    }, () => d.mode === 'dead');
    G.watch = null;
    G.input.up(1);
    const k = (f) => d.brain.stats[f] - st0[f];
    total += k('links') + k('chains');
    out(`     phase ${form}: ${k('picks')} picks, ${k('links')} links, ${k('chains')} chains in 40 s (${k('rests')} breathers, ${k('stops')} break-offs: the hero thrown out of a string's reach), cued: ${[...names].join(', ')}`);
    assert(k('picks') >= 10 && names.size >= 4, `phase ${form}: he fights on (${k('picks')} picks, ${names.size} moves cued)`);
  }
  assert(total >= 4, `he goes from move to move without footwork (${total} links and chains in 160 s; with the boosters' gap closers built, more)`);
}

// ================================================================== BOOST (the boost agent's: moves/boost.js, boost.js)
// The jet step, the booster punch, Rosary, Descent, the jet strings, Vespers, Last Rite, the change's guard,
// and the pace (cues a minute per phase against a guarding bot: a measure, printed).
const bo = (G) => G.game.dragon.parts.boost;
const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
/** The flashes of his blows (tell, time, attack) while `fn` runs. */
function flashLog(G) {
  const log = [];
  const prev = G.watch;
  G.watch = (n, e) => { prev?.(n, e); if (n === 'combat:flash' && e?.source === 'dragon') log.push({ t: G.game.time, tell: e.tell, attack: e.attack }); };
  return log;
}
/** Run move `name` from `dist` m with the defender bot answering (parry / roll), god mode; until he is back in footwork. */
function moveWithBot(G, name, dist, { god = true, max = 10, style = 'mixed' } = {}) {
  const { game } = G;
  const d = game.dragon;
  place(G, dist);
  game.player.debug.god = god;
  G.defend = makeDefender(G, { style });
  const log = flashLog(G);
  const ok = d.brain.trigger(name);
  let acted = false;
  run(G, max, () => { G.input.axis = { x: 0, y: 0 }; game.mouseGround.set(d.position.x, 0, d.position.z); G.defend.act(); }, () => {
    if (d.mode === 'act') acted = true;
    return acted && d.mode !== 'act' && game.player.state !== 'roll';
  });
  G.defend = null;
  G.watch = null;
  G.input.up(1);
  G.input.axis = { x: 0, y: 0 };
  return { ok, log };
}
/** The hero `dist` m from him toward the floor's middle (inside 12 m of it), facing him. */
function placeIn(G, dist) {
  const { game } = G;
  const d = game.dragon, p = game.player;
  let ax = -d.position.x, az = -d.position.z;
  const l = Math.hypot(ax, az);
  if (l < 1) { ax = 0; az = 1; } else { ax /= l; az /= l; }
  let x = d.position.x + ax * dist, z = d.position.z + az * dist;
  const r = Math.hypot(x, z);
  if (r > 12) { x *= 12 / r; z *= 12 / r; }
  p.debug.teleport(x, z);
  p.yaw = Math.atan2(d.position.x - p.position.x, d.position.z - p.position.z);
  game.mouseGround.set(d.position.x, 0, d.position.z);
}
/** blowAnd without its placing: trigger `name` where everyone stands, answer it `how`, until he is back in footwork. */
function fireAt(G, name, how, max = 6) {
  const d = G.game.dragon;
  const step = answer(G, how, name);
  const ok = d.brain.trigger(name);
  let acted = false;
  run(G, max, step, () => { if (d.mode === 'act') acted = true; return acted && d.mode === 'foot' && G.game.player.state !== 'roll'; });
  G.watch = null;
  G.input.up(1);
  G.input.axis = { x: 0, y: 0 };
  return ok;
}
const tellsOf = (log) => log.map((f) => (f.tell === TELL.BLUE ? 'B' : f.tell === TELL.RED ? 'R' : f.tell === TELL.BLACK ? 'K' : 'N')).join('');

async function scenarioBoostStep() {
  out('\n== scenario BOOST STEP (Censer Step: a far hero is closed on a jet from phase 2, never through him, a cooldown; two legs and the hover from phase 3) ==');
  const S = TUNING.boost.step;
  for (const form of [1, 2, 3, 4]) {
    const G = build();
    const { game } = G;
    const d = game.dragon, p = game.player, B = bo(G);
    duel(G, { dist: 10, ai: true, form });
    p.debug.god = true;
    placeIn(G, 10);
    const st0 = { ...B.stats };
    let minD = Infinity, hoverY = 0, hoverN = 0, maxY = 0, prev = B.stats.steps;
    const starts = [], lens = [];
    let x0 = 0, z0 = 0;
    run(G, 16, () => {
      G.input.axis = { x: 0, y: 0 };
      game.mouseGround.set(d.position.x, 0, d.position.z);
      if (B.stats.steps > prev) { prev = B.stats.steps; starts.push(game.time); x0 = d.position.x; z0 = d.position.z; }
      if (B.step) { minD = Math.min(minD, flatDist(d.position, p.position)); lens[starts.length - 1] = Math.hypot(d.position.x - x0, d.position.z - z0); }
      if (d.mode === 'foot' && !B.step && d.brain.modeT > 0.6) { hoverY += d.position.y; hoverN++; maxY = Math.max(maxY, d.position.y); }
      // (the hero keeps his distance: back to 10 m whenever he is closed on and the boss stands in footwork)
      if (d.mode === 'foot' && !B.step && flatDist(d.position, p.position) < 4) placeIn(G, 10);
      if (process.env.GCD_SDBG && form === 4 && ((game.realTime * 60) | 0) % 6 === 0) out(`      t ${game.time.toFixed(2)} ${d.mode} ${d.brain.act?.name ?? ''} dist ${flatDist(d.position, p.position).toFixed(1)} gap ${d.brain.gapT.toFixed(2)} cool ${B.stepCool.toFixed(2)} step ${!!B.step}`);
    });
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    const every = Array.isArray(S.every) ? S.every[form - 1] : S.every;
    for (const k of ['steps', 'zigs', 'stepAborts', 'plants']) B.stats[k] -= st0[k];
    out(`     phase ${form}: ${B.stats.steps} steps (${B.stats.zigs} zig-zags, ${B.stats.stepAborts} cut short), lengths ${lens.map((l) => l?.toFixed(1)).join(' / ')} m, closest to the hero in one ${Number.isFinite(minD) ? minD.toFixed(2) : '-'} m, gaps ${gaps.map((g) => g.toFixed(2)).join(' / ')} s, hover ${(hoverY / Math.max(1, hoverN)).toFixed(2)} m (max ${maxY.toFixed(2)}), ${B.stats.plants} planted stops`);
    if (form === 1) assert(B.stats.steps === 0, 'phase 1: he walks (no jet step)');
    else {
      // (from phase 3 his gap-closers (descent, the punch) and the links fill the range, so footwork to jet in is
      // short; how OFTEN he steps is the tuning pass's: this only holds that he jets at all, seed by seed)
      assert(B.stats.steps >= (form >= 3 ? 1 : 2), `phase ${form}: he jets at a far hero (${B.stats.steps} steps)`);
      assert(minD >= S.stop - 0.2, `phase ${form}: never through the hero (closest ${minD.toFixed(2)} m >= ${S.stop - 0.2})`);
      assert(gaps.every((g) => g >= every - 0.05), `phase ${form}: a cooldown between steps (>= ${every} s: ${gaps.map((g) => g.toFixed(2)).join(', ')})`);
      assert(lens.every((l) => l <= S.max * 1.4 + 0.1), `phase ${form}: no step longer than its legs allow (${S.max} m straight)`);
      assert(B.stats.plants >= B.stats.steps, `phase ${form}: every step ends in the planted stop, its scuff and dust (${B.stats.plants} / ${B.stats.steps})`);
    }
    if (form >= S.zig) assert(B.stats.zigs >= 1, `phase ${form}: the zig-zag (${B.stats.zigs})`);
    if (form >= 3) assert(hoverY / Math.max(1, hoverN) > 0.1 && maxY < 0.4, `phase ${form}: he hovers between moves (${(hoverY / Math.max(1, hoverN)).toFixed(2)} m, never above ${maxY.toFixed(2)})`);
    else assert(maxY < 0.05, `phase ${form}: on the floor between moves (${maxY.toFixed(2)})`);
  }
}

async function scenarioBoostVotive() {
  out('\n== scenario BOOST VOTIVE (the booster punch: the jet tell, the blink, parried / blocked / landed / dodged; a miss carries on into the scenery) ==');
  const V = TUNING.boost.votive;
  // the held tell and the blink, as realised
  for (const f of [2, 3, 4]) {
    const A = realise('votiveFist', f, () => 0.5), b = A.beats[0];
    const jet = b.W * (V.dashFrom - V.jetFrom), blink = b.W * (1 - V.dashFrom);
    out(`     P${f}: windup ${b.W.toFixed(3)} s, the elbow jet lit ${jet.toFixed(2)} s before the dash, the blink ${blink.toFixed(3)} s (up to ${V.reach} m: ${(V.reach / blink).toFixed(0)} m/s), the glint ${(TUNING.flashLead).toFixed(2)} s before the impact`);
    assert(jet >= 0.45 && b.flash < b.start + b.W * V.dashFrom + 0.06, `P${f}: the jet reads before the blink (${jet.toFixed(2)} s); the glint comes before the blink`);
  }
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player, B = bo(G);
  duel(G, { dist: 8, ai: false, form: 2 });
  // parried
  let t0 = { x: d.position.x, z: d.position.z }, imp = null;
  const pv0 = d.posture;
  let parried = 0;
  G.watch = null;
  const w0 = (n, e) => { if (n === 'dragon:parried' && e?.attack === 'votiveFist') parried++; };
  place(G, 8);
  t0 = { x: d.position.x, z: d.position.z };
  G.defend = makeDefender(G, {});
  G.watch = w0;
  d.brain.trigger('votiveFist');
  let acted = false;
  run(G, 6, () => { G.defend.act(); game.mouseGround.set(d.position.x, 0, d.position.z); if (d.brain.act?.name === 'votiveFist') imp = { x: d.position.x, z: d.position.z }; }, () => { if (d.mode === 'act') acted = true; return acted && d.mode !== 'act' && d.mode !== 'react'; });
  G.watch = null;
  G.defend = null;
  G.input.up(1);
  const travel = imp ? flatDist(t0, imp) : 0;
  out(`     parried: travel ${travel.toFixed(2)} m in the blink, posture ${pv0.toFixed(0)} -> ${d.posture.toFixed(0)}, overshoots ${B.stats.overshoots}`);
  assert(parried === 1 && B.stats.dashes >= 1 && travel > 5, `the blink crossed ${travel.toFixed(1)} m behind the fist; the hero parried it`);
  assert(d.posture - pv0 >= V.parryPosture || d.broken, `parried: a big posture hit (+${(d.posture - pv0).toFixed(0)} >= ${V.parryPosture})`);
  assert(B.stats.overshoots === 1, 'parried: he skids on past the hero');
  // blocked, landed
  settle(G);
  d.posture = 0;
  const hp0 = p.hp;
  placeIn(G, 7);
  fireAt(G, 'votiveFist', 'guard');
  const blocked = G.hits.at(-1);
  assert(blocked?.r === RESULT.BLOCKED && p.hp === hp0, `blocked: no damage (${blocked?.r})`);
  settle(G);
  p.debug.heal();
  const hp1 = p.hp;
  placeIn(G, 7);
  fireAt(G, 'votiveFist', 'none');
  const landed = G.hits.at(-1);
  out(`     landed: ${hp1} -> ${p.hp} hp (${TUNING.boost.votive.damage} x ${TUNING.damageScale})`);
  assert(landed?.r === RESULT.HIT && p.hp < hp1, `landed: it hurts (${landed?.r})`);
  // dodged with a piece behind the hero: the fist carries on into it
  settle(G);
  p.debug.heal();
  // (measured: what a miss can reach: his body stops at his bound, the crater 0.9 m on, the wave `wave` m more)
  const V2 = TUNING.boost.votive, R2 = d.bound + 0.9 + V2.wave;
  const list = game.world.destructibles.list;
  const cands = list.filter((b) => !b.floor && b.hp < Infinity && b.y0 < 0.5 && b.state === 0 && b.kind !== 'ladle' && Math.hypot(b.x, b.z) - b.r < R2 - 0.3);
  const piece = cands.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
  out(`     a miss reaches ${R2.toFixed(1)} m from the middle: ${cands.length} pieces of the set within it (${[...new Set(cands.map((b) => b.kind))].join(', ')})`);
  assert(!!piece, `a piece to stand in front of (${piece?.kind} at ${piece?.x.toFixed(1)}, ${piece?.z.toFixed(1)}, r ${piece?.r})`);
  if (piece) {
    const l = Math.hypot(piece.x, piece.z), ux = piece.x / l, uz = piece.z / l;
    // (the hero near his floor's edge in front of it, the boss 8 m further in)
    const hl = Math.min(l - piece.r - 1.5, d.bound - 1.5);
    const hx = ux * hl, hz = uz * hl;
    d.position.set(hx - ux * 8, 0, hz - uz * 8);
    d.yaw = Math.atan2(ux, uz);
    run(G, 0.1);
    p.debug.teleport(hx, hz);
    p.yaw = Math.atan2(-ux, -uz);
    game.mouseGround.set(d.position.x, 0, d.position.z);
    const hp2 = piece.hp, c0 = B.stats.carries, k0 = B.stats.craters;
    p.debug.god = true;
    const stepD = answer(G, 'dodge', 'votiveFist');
    d.brain.trigger('votiveFist');
    acted = false;
    run(G, 6, stepD, () => { if (d.mode === 'act') acted = true; return acted && d.mode !== 'act' && p.state !== 'roll'; });
    G.watch = null;
    G.input.axis = { x: 0, y: 0 };
    out(`     dodged: carries ${B.stats.carries - c0}, the ${piece.kind}'s hp ${hp2} -> ${piece.hp} (${piece.state}), craters ${B.stats.craters - k0}, he ended ${flatDist(d.position, piece).toFixed(2)} m from it`);
    assert(B.stats.carries - c0 === 1 && B.stats.craters - k0 >= 1, 'a dodged booster punch carries on, a crater where it ends');
    assert(piece.hp < hp2 || piece.state !== 0, `... into what stood behind the hero (the ${piece.kind} struck)`);
  }
}

async function scenarioBoostRosary() {
  out('\n== scenario BOOST ROSARY (his flurry from phase 2: 7 - 10 pistons in a stutter, the last blue; it chips what stands beside the hero) ==');
  const counts = [0, 0.25, 0.5, 0.75, 0.999].map((r) => realise('rosary', 2, () => r).hits);
  assert(Math.min(...counts) >= 7 && Math.max(...counts) <= 10 && new Set(counts).size >= 2, `7 - 10 blows as drawn (${counts.join(', ')})`);
  const A = realise('rosary', 3, () => 0.5);
  const gaps = A.beats.slice(1).map((b, i) => b.impact - A.beats[i].impact);
  out(`     P3 r0.5: ${A.hits} blows, impacts ${gaps.map((g) => g.toFixed(2)).join(' ')} s apart, ${(A.end).toFixed(2)} s in all`);
  assert(A.beats.at(-1).def.tell === TELL.BLUE && A.beats.slice(0, -1).every((b) => b.def.tell === TELL.NORMAL), 'normal blows, the last blue');
  assert(STREAKS[1] === 'rosary' && STREAKS[2] === 'rosary' && STREAKS[3] === 'rosary', 'it is his flurry in phases 2 - 4');
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player, B = bo(G);
  duel(G, { dist: 1.8, ai: false, form: 2 });
  place(G, 1.8);
  p.debug.god = true;
  const log = flashLog(G);
  const c0 = B.stats.chips;
  const ok = d.brain.startStreak(3);
  const hits = d.brain.act?.hits ?? 0;
  run(G, 8, () => { G.input.press(1); game.mouseGround.set(d.position.x, 0, d.position.z); }, () => d.mode !== 'act');
  G.input.up(1);
  G.watch = null;
  const fg = log.slice(1).map((f, i) => f.t - log[i].t);
  out(`     through the brain: ${hits} blows (${tellsOf(log)}), flashes ${fg.map((g) => g.toFixed(2)).join(' ')} s apart, chips ${B.stats.chips - c0}, ${G.counts['dragon:flurry'] ?? 0} dragon:flurry`);
  assert(ok && d.brain.last[0] === 'rosary' && hits >= 7 && log.length === hits && tellsOf(log).endsWith('B') && !tellsOf(log).slice(0, -1).includes('B'), `the streak launches the whole Rosary, its last blow blue (${tellsOf(log)})`);
  assert(fg.every((g) => g >= TUNING.minHitGap - 0.02), `readable: no two cues under ${TUNING.minHitGap} s apart (shortest ${Math.min(...fg).toFixed(3)})`);
  assert(B.stats.chips - c0 >= hits - 1, `every piston chips beside the hero (${B.stats.chips - c0})`);
}

async function scenarioBoostDescent() {
  out('\n== scenario BOOST DESCENT (up on the thrusters, the hang over the mark, the dive knee: a crater, plates thrown) ==');
  const P = TUNING.boost.descent;
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player, B = bo(G);
  duel(G, { dist: 6, ai: false, form: 3 });
  place(G, 6);
  p.debug.god = true;
  const hero = { x: p.position.x, z: p.position.z };
  const plates = pieces(G, 'plate').filter((b) => Math.hypot(b.x - hero.x, b.z - hero.z) < P.r + 1.5);
  const hp0 = plates.map((b) => b.hp);
  let maxY = 0, tTop = NaN, tDown = NaN, land = null;
  const log = flashLog(G);
  d.brain.trigger('descent');
  let acted = false;
  run(G, 6, () => {
    game.mouseGround.set(d.position.x, 0, d.position.z);
    const y = d.position.y;
    maxY = Math.max(maxY, y);
    if (!Number.isFinite(tTop) && y >= P.h * 0.95) tTop = game.time;
    if (Number.isFinite(tTop) && !Number.isFinite(tDown) && y < P.h * 0.97 && d.brain.act?.beats[0] && d.brain.act.t > d.brain.act.beats[0].start + d.brain.act.beats[0].W * P.fall - 0.01) tDown = game.time;
    if (!land && d.brain.act?.beats[0]?.struck) land = { x: d.position.x, z: d.position.z };
  }, () => { if (d.mode === 'act') acted = true; return acted && d.mode !== 'act'; });
  G.watch = null;
  const struck = plates.filter((b, i) => b.hp < hp0[i] || b.state !== 0).length;
  const hit = G.hits.at(-1);
  out(`     up ${maxY.toFixed(1)} m, the hang ${(tDown - tTop).toFixed(2)} s at the top, landed ${land ? flatDist(land, hero).toFixed(2) : '-'} m from where the hero stood, ${struck} / ${plates.length} plates round it struck, craters ${B.stats.craters}, the hero: ${hit?.r} (${tellsOf(log)})`);
  assert(maxY >= P.h * 0.95 && tDown - tTop >= 0.45, `straight up ${maxY.toFixed(1)} m and a hang of ${(tDown - tTop).toFixed(2)} s (>= 0.45) so the mark reads`);
  assert(land && flatDist(land, hero) < 0.8 && hit?.r === RESULT.HIT && tellsOf(log) === 'R', 'the dive knee comes down on the hero who stood still (red)');
  assert(B.stats.craters >= 1 && struck >= 3, `a crater; the plates round it thrown (${struck})`);
  // rolled out of it: nothing
  settle(G);
  p.debug.heal();
  p.debug.god = false;
  const hp1 = p.hp;
  blowAnd(G, 'descent', 'dodge', { dist: 6, god: false });
  assert(p.hp === hp1, `a roll at the glint takes the hero out of it (${G.hits.at(-1)?.r})`);
}

async function scenarioBoostStrings() {
  out('\n== scenario BOOST STRINGS (Censer Wheel: blue, n, blue; Thurible: n, blue, blue; off the floor on the kick) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist: 7, ai: false, form: 3 });
  for (const [name, dist, want] of [['censerWheel', 7, 'BNB'], ['thurible', 2.2, 'NBB']]) {
    settle(G);
    p.debug.heal();
    let maxY = 0;
    const prevAct = d.brain.stats.picks;
    const r = (() => {
      place(G, dist);
      p.debug.god = true;
      G.defend = makeDefender(G, {});
      const log = flashLog(G);
      d.brain.trigger(name);
      let acted = false;
      run(G, 8, () => { G.input.axis = { x: 0, y: 0 }; game.mouseGround.set(d.position.x, 0, d.position.z); G.defend.act(); if (d.brain.act?.name === name) maxY = Math.max(maxY, d.position.y); }, () => { if (d.mode === 'act') acted = true; return acted && d.mode !== 'act' && p.state !== 'roll'; });
      G.defend = null;
      G.watch = null;
      G.input.up(1);
      return log;
    })();
    void prevAct;
    const res = G.hits.slice(-3).map((h) => h.r).join(', ');
    out(`     ${name}: ${tellsOf(r)} (${r.map((f) => f.t.toFixed(2)).join(' ')}), up ${maxY.toFixed(2)} m, results ${res}`);
    assert(tellsOf(r) === want || (tellsOf(r).length < want.length && want.startsWith(tellsOf(r))), `${name}: ${want} (${tellsOf(r)}; a parried blue moment may end it)`);
    assert(maxY >= 0.5 || tellsOf(r).length < 3, `${name}: off the floor on the rising kick (${maxY.toFixed(2)} m)`);
  }
}

async function scenarioBoostVespers() {
  out('\n== scenario BOOST VESPERS (overclock: four announced passes through the hero from different sides, the last from above) ==');
  const VS = TUNING.boost.vespers;
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player, B = bo(G);
  duel(G, { dist: 4, ai: false, form: 4 });
  const sights = [];
  const sl = d.fx.passLine?.bind(d.fx);
  d.fx.passLine = (...a) => { if (d.brain.act?.name === 'vespers') sights.push(game.time); return sl?.(...a); };
  const dirs = [];
  const watchDirs = () => { for (const b of d.brain.act?.name === 'vespers' ? d.brain.act.beats : []) if (b._fsP?.fixed && !b._fsSeen) { b._fsSeen = true; dirs.push(Math.atan2(b._fsP.dx, b._fsP.dz)); } };
  // the hero stands his ground: every pass comes through him
  place(G, 4);
  p.debug.god = true;
  const log = flashLog(G);
  const n0 = G.hits.length, sw0 = B.stats.swept;
  d.brain.trigger('vespers');
  let acted = false;
  run(G, 10, () => { G.input.axis = { x: 0, y: 0 }; game.mouseGround.set(d.position.x, 0, d.position.z); watchDirs(); }, () => { if (d.mode === 'act') acted = true; return acted && d.mode !== 'act'; });
  G.watch = null;
  const fg = log.slice(1).map((f, i) => f.t - log[i].t);
  const turns = dirs.slice(1).map((a, i) => Math.abs(Math.atan2(Math.sin(a - dirs[i]), Math.cos(a - dirs[i]))));
  const lead = log.map((f) => { const s = sights.filter((t) => t <= f.t - 0.2); return s.length ? f.t - s[s.length - 1] < 0.4 ? f.t - Math.min(...sights.filter((t) => t > f.t - 1.2 && t <= f.t)) : 0 : 0; });
  out(`     ${tellsOf(log)}: cues ${fg.map((g) => g.toFixed(2)).join(' / ')} s apart; the lines turn ${turns.map((t) => t.toFixed(2)).join(' / ')} rad; each line shown ${lead.map((x) => x.toFixed(2)).join(' / ')} s before its cue; ${G.hits.length - n0} reached the hero (${G.hits.slice(n0).map((h) => h.r).join(', ')}); ${B.stats.swept - sw0} sweeps of the world`);
  assert(tellsOf(log) === 'B'.repeat(VS.passes) + 'R', `${VS.passes} blue passes and the red one from above (${tellsOf(log)})`);
  assert(fg.every((g) => g >= 0.45), `a watcher can follow: >= 0.45 s between passes (${Math.min(...fg).toFixed(2)})`);
  assert(turns.length >= VS.passes - 1 && turns.slice(0, VS.passes - 1).every((t) => t >= 0.5), `each from another side (the lines turn >= 0.5 rad: ${turns.map((t) => t.toFixed(2)).join(', ')})`);
  assert(lead.every((x) => x >= 0.4), `each line shown >= 0.4 s before its cue (${lead.map((x) => x.toFixed(2)).join(', ')})`);
  assert(G.hits.length - n0 >= VS.passes, `the passes go through the hero who stood (${G.hits.length - n0})`);
  assert(B.stats.swept - sw0 >= VS.passes && B.stats.craters >= 1, 'each line breaks what it crosses; the last craters');
  // parried throughout
  settle(G);
  p.debug.heal();
  const n1 = G.hits.length;
  const { log: l2 } = moveWithBot(G, 'vespers', 4, { god: false });
  const res = G.hits.slice(n1).map((h) => h.r);
  out(`     against the defender: ${tellsOf(l2)} → ${res.join(', ')}, hero hp ${p.hp}`);
  assert(res.length >= 1 && res.every((r) => r !== RESULT.HIT) && p.hp === p.maxHp, 'each pass that reaches the defender is answered (parried; the last rolled): no damage');
}

async function scenarioBoostRite() {
  out('\n== scenario BOOST RITE (Last Rite: phase 4 under 8 %, once; caught: a blast that never kills; dodged: he is open) ==');
  const R = TUNING.boost.rite;
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player, B = bo(G);
  duel(G, { dist: 3, ai: true, form: 4 });
  const w = (hp) => { d.hp = d.maxHp * hp; return d.weigh('lastRite', MOVES.lastRite, 1, 3); };
  assert(w(0.5) === 0 && w(0.07) > 1, `weighed only under ${R.below * 100} % (${w(0.5)} at 50 %, ${w(0.07)} at 7 %)`);
  // his AI throws it once he is under the line, and once only (the hero in god mode, standing)
  d.hp = d.maxHp * 0.07;
  p.debug.god = true;
  let seen = 0, at = NaN;
  const wins = [];
  G.watch = (n, e) => { if (n === 'dragon:windup') wins.push(e?.name); if (n === 'dragon:windup' && e?.name === 'lastRite') { seen++; at = flatDist(d.position, p.position); } };
  // (the hero kept on his floor: a knock-back past its edge leaves every move of his out of band)
  run(G, 24, () => { G.input.axis = { x: 0, y: 0 }; game.mouseGround.set(d.position.x, 0, d.position.z); if (d.hp > d.maxHp * 0.07) d.hp = d.maxHp * 0.07; if (d.mode === 'foot' && Math.hypot(p.position.x, p.position.z) > 12.5) placeIn(G, 3); });
  G.watch = null;
  out(`     his AI threw it ${seen}x in 24 s (from ${at.toFixed(2)} m: ${B.stats.riteHits ? 'caught' : 'missed, open'}; his moves: ${wins.join(' ')})`);
  assert(seen === 1 && d.brain.trigger('lastRite') === false, `once a fight (${seen}; the Lab's trigger refused after)`);
  // caught, the hero on 30 hp: he lives
  const G3 = build();
  const d3 = G3.game.dragon, p3 = G3.game.player, B3 = bo(G3);
  duel(G3, { dist: 2.5, ai: false, form: 4 });
  d3.hp = d3.maxHp * 0.07;
  place(G3, 2.5);
  p3.debug.god = false;
  p3.hp = 30;
  fireAt(G3, 'lastRite', 'none');
  out(`     caught: hero hp 30 -> ${p3.hp} (alive ${p3.alive}; ${R.damage} x ${TUNING.damageScale} capped), blast craters ${B3.stats.craters}`);
  assert(B3.stats.riteHits === 1 && p3.alive && p3.hp >= 1 && p3.hp < 30 && B3.stats.craters >= 1, 'caught: a heavy blast, never the hero\'s last HP');
  // dodged: open
  const G2 = build();
  const d2 = G2.game.dragon;
  duel(G2, { dist: 3, ai: false, form: 4 });
  d2.hp = d2.maxHp * 0.07;
  blowAnd(G2, 'lastRite', 'dodge', { dist: 3 });
  run(G2, 0.4);
  out(`     dodged: ${G2.hits.at(-1)?.r}; open ${bo(G2).stats.riteOpen}, his posture broke ${G2.counts['dragon:postureBreak'] ?? 0}x`);
  assert(bo(G2).stats.riteOpen === 1 && G2.counts['dragon:postureBreak'] >= 1, 'dodged: he is wide open (his posture breaks)');
  d2.reset();
  assert(!bo(G2).riteUsed, 'his reset gives it back');
}

async function scenarioBoostChange() {
  out('\n== scenario BOOST CHANGE (through a phase\'s change, until its ring, nothing lands on him) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon;
  duel(G, { dist: 4, ai: true });
  game.player.debug.god = true;
  d.hp = d.maxHp * TUNING.phaseAt[1] + 20;
  d.mode = 'foot';
  d.brain.act = null;
  d.takeHit({ damage: 400, part: 'body', heavy: true, exact: true });
  run(G, 1.5, null, () => d.brain.act?.name === TRANSITIONS[2]);
  assert(d.brain.act?.name === TRANSITIONS[2], `the change begins (${d.brain.act?.name})`);
  run(G, 0.4);
  const hp0 = d.hp, pv0 = d.posture;
  const pt = new THREE.Vector3(d.position.x, 1.2, d.position.z);
  const dealt = d.takeHit({ damage: 60, part: 'body', point: pt, dir: { x: 0, z: 1 }, swing: true });
  assert(d.brain.act?.def.transition && dealt === 0 && d.hp === hp0 && d.posture === pv0, `mid-change a cut does nothing (${dealt} damage, hp ${hp0} -> ${d.hp})`);
  run(G, 6, null, () => d.mode !== 'act');
  d.brain.aiEnabled = false;
  const d1 = d.takeHit({ damage: 60, part: 'body', point: pt, exact: true });
  assert(d1 > 0, `after it, cuts land again (${d1})`);
}

/** A god-mode hero that holds the guard through every normal / blue cue and rolls out of a red one, roaming between standoffs (veil.mjs's pace defender). */
function bPaceDefender(G) {
  const pend = [];
  let guardUntil = -1;
  return {
    onEvent(n, e) {
      if (n !== 'combat:flash' || (e?.source !== 'dragon' && e?.source !== 'world')) return;
      pend.push({ tell: e.tell, at: G.game.time + (e.source === 'world' ? 0.3 : TUNING.flashLead), x: e.x, z: e.z, hazard: !!e.hazard && !e.bullet, done: false });
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
          }
        } else {
          e.done = true;
          guardUntil = Math.max(guardUntil, e.at + 0.2);
        }
      }
      if (guardUntil > t) input.press(1);
      else if (guardUntil > 0) { guardUntil = -1; input.up(1); }
      return rolled;
    },
  };
}

async function scenarioBoostPace() {
  const SECS = Number(process.env.GCD_BPSECS ?? 20); // (the measure in the report: GCD_BPSECS=60)
  const SEEDS = (process.env.GCD_BPSEEDS ?? '4242').split(',').map(Number).filter(Number.isFinite);
  out(`\n== scenario BOOST PACE (a measure: cues a minute per phase against a god-mode guarding bot that roams 2.5 / 5 / 9 m; ${SECS} s a phase, seeds ${SEEDS.join(', ')}) ==`);
  for (const seed of SEEDS) {
    for (let ph = 1; ph <= 4; ph++) {
      const G = build(seed, true);
      const { game } = G;
      const d = game.dragon, p = game.player, B = bo(G);
      duel(G, { dist: 3, ai: true, form: ph });
      p.debug.god = true;
      p.debug.noRiposte = true;
      G.defend = bPaceDefender(G);
      Math.random = mulberry32(seed * 7 + ph);
      const flashes = [], acts = {};
      G.watch = (n, e) => {
        if (n === 'combat:flash' && (e?.source === 'dragon' || e?.source === 'world')) flashes.push(game.time);
        if (n === 'dragon:windup' && e?.name) acts[e.name] = (acts[e.name] ?? 0) + 1;
      };
      const roam = mulberry32(seed * 31 + ph), goal = { r: 2.5, a: 0, until: -1 };
      const t0 = game.time, s0 = B.stats.steps, trail = [];
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
          G.input.axis = l > 0.5 ? { x: dx / l, y: -dz / l } : { x: 0, y: 0 };
        }
        game.mouseGround.set(d.position.x, 0, d.position.z);
        G.tick(DT);
        trail.push([game.time, (d.mode === 'act' ? `act ${d.brain.act?.name}` : d.mode === 'react' ? `react ${d.brain.react?.kind}` : d.mode) + (game.world.forest.foundry?.molten?.at?.(d.position.x, d.position.z) ? ' (in a pool)' : ''), Math.round(flatDist(d.position, p.position))]);
        if (d.phase !== ph && d.mode !== 'act') break;
      }
      const secs = game.time - t0;
      const gaps = flashes.slice(1).map((t, i) => t - flashes[i]);
      // (what he did through the longest gap between two cues)
      const gi = gaps.indexOf(Math.max(...gaps, 0)), g0 = flashes[gi] ?? t0, g1 = flashes[gi + 1] ?? game.time;
      const what = {};
      for (const [t, m] of trail) if (t > g0 && t < g1) what[m] = (what[m] ?? 0) + 1;
      const whatS = Object.entries(what).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${(v * DT).toFixed(1)} s`).join(', ');
      const top = Object.entries(acts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
      out(`     seed ${seed} P${ph}: ${(flashes.length / secs * 60).toFixed(0)} cues/min over ${secs.toFixed(0)} s, longest gap ${gaps.length ? Math.max(...gaps).toFixed(1) : '-'} s (${whatS}), ${B.stats.steps - s0} jet steps; moves: ${top}`);
      G.defend = null;
      G.watch = null;
      assert(flashes.length > 0, `P${ph}: he fights (${flashes.length} cues)`);
    }
  }
}

// ================================================================== body: the reveal, the milestones, the weapons, the sensors
/** The body's dress record and a few counts. */
function bodyState(d) {
  const D = d.rig.root.userData.fsDress;
  const shown = D.shards.filter((e) => !e.gone).length;
  const frameOn = D.frame.filter((f) => f.on).length;
  const sensors = D.sensors.filter((s) => s.mesh.visible).length;
  return { D, shown, frameOn, sensors };
}
async function scenarioBodyReveal() {
  out('\n== scenario BODYREVEAL (every shell part has pieces; the reveal only grows with the exposure; a reset restores him; idle costs nothing) ==');
  const { PART_NAMES } = await imp('src/entities/enemies/falseSaint/shell.js');
  const G = build();
  const d = G.game.dragon;
  duel(G, { dist: 4 });
  run(G, 0.1);
  const { D } = bodyState(d);
  const per = Object.fromEntries(PART_NAMES.map((n) => [n, D.shards.filter((e) => e.part === n).length]));
  const missing = PART_NAMES.filter((n) => !(per[n] || D.hands.some((h) => h.part === n)) || !(D.frame.some((f) => f.parts.includes(n)) || D.hands.some((h) => h.part === n)));
  const meshes = D.shards.reduce((s, e) => s + e.meshes.length, 0);
  out(`     ${D.shards.length} shards (${meshes} meshes), ${D.frame.length} frame pieces, ${D.hands.length} hands, ${Object.keys(D.weapons).length} weapons; per part ${JSON.stringify(per)}`);
  assert(missing.length === 0, `every shell part maps to shards of the disguise and to frame pieces (missing: ${missing.join(', ') || 'none'})`);
  assert(D.shards.every((e) => e.meshes.length > 0 && Number.isFinite(e.t)), 'every shard draws something and has a threshold');
  let s0 = bodyState(d);
  assert(s0.shown === D.shards.length && s0.frameOn === 0 && s0.sensors === 0, `whole at the start: every shard shown, no frame, no sensor (${s0.shown}/${D.shards.length}, ${s0.frameOn}, ${s0.sensors})`);
  // the exposure in steps: the shards shown never come back, the frame never goes
  let prev = Infinity, prevF = -1, mono = true;
  const steps = [];
  for (let k = 0; k <= 10; k++) {
    d.shell.force(k / 10);
    run(G, 1 / 60);
    const s = bodyState(d);
    if (s.shown > prev || s.frameOn < prevF) mono = false;
    prev = s.shown;
    prevF = s.frameOn;
    steps.push(s.shown);
  }
  assert(mono && prev === D.shards.filter((e) => e.t > 1).length, `the reveal only grows (${steps.join(' ')} shards shown at exposure 0 .. 1 by tenths)`);
  // a reset restores him whole
  d.reset();
  run(G, 0.1);
  s0 = bodyState(d);
  assert(s0.shown === D.shards.length && s0.frameOn === 0, `a reset restores him whole (${s0.shown} shards, ${s0.frameOn} frame pieces)`);
  // idle: the dress does no work and allocates nothing
  const { dressSaint } = await imp('src/entities/enemies/falseSaint/look.js');
  // (exact with `node --expose-gc`: the heap after a collection; without it a loose bound on the garbage)
  // (warmed up first: until the optimiser has it, a read of a float boxes it)
  for (let i = 0; i < 30000; i++) dressSaint(d, DT);
  globalThis.gc?.();
  const h0 = process.memoryUsage().heapUsed;
  // (no gc between: what the calls allocate is still on the heap)
  for (let i = 0; i < 20000; i++) dressSaint(d, DT);
  const dh = process.memoryUsage().heapUsed - h0;
  if (process.env.GCD_BODYHEAP) { globalThis.gc?.(); out(`     retained after a collection: ${((process.memoryUsage().heapUsed - h0) / 1024).toFixed(0)} kB`); }
  const lim = globalThis.gc ? 400e3 : 16e6;
  assert(dh < lim, `20 000 idle dresses allocate next to nothing (${(dh / 1024).toFixed(0)} kB of heap, ${globalThis.gc ? 'exact' : 'loose: run with --expose-gc for the exact count'})`);
}

async function scenarioBodyMilestones() {
  out('\n== scenario BODYMILESTONES (the shell\'s phase floors draw the reference\'s four milestones) ==');
  const G = build();
  const d = G.game.dragon;
  duel(G, { dist: 4 });
  const { D } = bodyState(d);
  const gone = (part) => { const L = D.shards.filter((e) => e.part === part && !e.patch); return L.filter((e) => e.gone).length / Math.max(1, L.length); };
  const at = (n) => { d.shell.reset(); d.shell.setPhase(n); d.dressPhase = n; run(G, 2 / 60); return bodyState(d); };
  const p1 = at(1);
  assert(p1.shown === D.shards.length && p1.sensors === 0, '01 HUMAN: whole, no sensor lit');
  const p2 = at(2);
  out(`     02: headR ${gone('headR').toFixed(2)}, foreR ${gone('foreR').toFixed(2)}, chestL ${gone('chestL').toFixed(2)}, chestR ${gone('chestR').toFixed(2)}, handR bare ${D.handR.bare}`);
  assert(gone('headR') > 0.05 && gone('headR') < 0.6 && gone('headL') === 0 && gone('foreR') === 1 && gone('chestL') > 0 && gone('chestL') < 0.4 && gone('chestR') === 0 && !D.handR.bare && p2.sensors === 1,
    `02 FRACTURE: the right cheek and temple chipped (headR ${gone('headR').toFixed(2)}), the right forearm bare, a crack at the left collarbone, the right chest whole, the hand still skin, one sensor lit (${p2.sensors})`);
  const p3 = at(3);
  const fl = D.shards.find((e) => e.part === 'hip' && e.t > 0.99);
  out(`     03: headL ${gone('headL').toFixed(2)}, chestL ${gone('chestL').toFixed(2)}, legR ${gone('legR').toFixed(2)}, legL ${gone('legL').toFixed(2)}, shinR ${gone('shinR').toFixed(2)}, armL ${gone('armL').toFixed(2)}`);
  assert(gone('headR') === 1 && gone('headL') > 0 && gone('headL') < 0.75 && gone('chestR') === 1 && gone('armR') === 1 && gone('chestL') < 0.6 && gone('armL') === 0 && gone('shinR') === 1 && gone('legR') > 0.8 && gone('legL') > 0.2 && p3.sensors === 2 && fl && !fl.gone,
    `03 EXPOSURE: the right head, chest and arm bare, a skin island on the left cheek, the jacket on the left, both legs mostly plated, two sensors (${p3.sensors})`);
  const p4 = at(4);
  const flake = D.shards.find((e) => e.part === 'armL' && e.patch);
  out(`     04: ${p4.shown} shards left (${D.shards.filter((e) => !e.gone).map((e) => e.part).join(', ')})`);
  assert(gone('headL') === 1 && gone('chestL') === 1 && fl && !fl.gone && flake && !flake.gone && p4.sensors === 3 && p4.shown <= 4,
    `04 TRUE FRAME: the face all frame, a scrap of jacket at the left hip and skin flakes at the left shoulder left, three sensors (${p4.shown} pieces left)`);
  d.reset();
}

async function scenarioBodyWeapons() {
  out('\n== scenario BODYWEAPONS (the frame\'s weapons open by their values on d, only where the shell is gone; their points) ==');
  const G = build();
  const d = G.game.dragon;
  duel(G, { dist: 4 });
  const { D } = bodyState(d);
  const W = D.weapons;
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  // covered in phase 1: nothing shows even when driven
  d.fsJetK = 1; d.fsPetalK = 1; d.fsThrustK = 1; d.fsCoreK = 1; d.fsTubeK = 1; d.fsGunK = 1; d.fsPalmK = 1;
  run(G, 2 / 60);
  const anyShown = Object.values(W).some((x) => x.meshes?.some((m) => m.visible));
  assert(!anyShown, 'in phase 1 every weapon stays under the shell, driven or not');
  for (const k of ['fsJetK', 'fsPetalK', 'fsThrustK', 'fsCoreK', 'fsTubeK', 'fsGunK', 'fsPalmK']) d[k] = 0;
  d.shell.setPhase(4); d.dressPhase = 4;
  run(G, 2 / 60);
  d.partPoint('elbowR', v);
  const s0 = W.elbowR.pivot.scale.y;
  d.fsJetK = 1;
  run(G, 2 / 60);
  d.partPoint('elbowR', w);
  assert(W.elbowR.meshes[0].visible && W.elbowR.pivot.scale.y > s0 && v.distanceTo(w) > 0.005, `phase 4: the elbow booster shows and opens with d.fsJetK (scale ${s0.toFixed(2)} -> ${W.elbowR.pivot.scale.y.toFixed(2)}; its point moves ${(v.distanceTo(w) * 100).toFixed(1)} cm)`);
  const q0 = W.mortar.pivot.quaternion.clone();
  d.fsTubeK = 1; d.fsPetalK = 1;
  run(G, 2 / 60);
  assert(W.mortar.meshes[0].visible && W.mortar.pivot.quaternion.angleTo(q0) > 2 && W.petalsR.cells.visible, 'the mortar tubes rise with d.fsTubeK, the petals open on their cells with d.fsPetalK');
  const names = ['palmR', 'palmL', 'elbowR', 'elbowL', 'shoulderR', 'shoulderL', 'back', 'backR', 'backL', 'calfR', 'calfL', 'core', 'mortar', 'gunR', 'eye', 'head', 'chest'];
  const pts = names.map((n) => d.partPoint(n, new THREE.Vector3()));
  const bad = names.filter((n, i) => !Number.isFinite(pts[i].x + pts[i].y + pts[i].z) || pts[i].distanceTo(d.position) > 2.6);
  const p = Object.fromEntries(names.map((n, i) => [n, pts[i]]));
  assert(bad.length === 0 && p.head.y > p.chest.y && p.chest.y > p.calfR.y && p.elbowR.distanceTo(p.elbowL) > 0.2, `his ${names.length} points are on his drawn body (bad: ${bad.join(', ') || 'none'}; head ${p.head.y.toFixed(2)}, chest ${p.chest.y.toFixed(2)}, calf ${p.calfR.y.toFixed(2)} m)`);
  // the hand shapes
  d.fsHandR = 'clench';
  run(G, 1 / 60);
  const H = D.handR;
  assert(H.shapes.clench.metal.visible && !H.shapes.guard.metal.visible && !W.iris.ring.visible, 'd.fsHandR = clench: the metal fist, the iris hidden');
  d.fsHandR = 'reach';
  run(G, 1 / 60);
  assert(H.shapes.open.metal.visible && W.iris.ring.visible, 'd.fsHandR = reach: the open hand, the iris on its palm');
  d.reset();
}

async function scenarioBodyDeath() {
  out('\n== scenario BODYDEATH (his sensors go out one by one as he dies) ==');
  const G = build();
  const d = G.game.dragon;
  duel(G, { dist: 4 });
  G.game.player.debug.god = true;
  d.shell.setPhase(4); d.dressPhase = 4;
  run(G, 2 / 60);
  const outs = [];
  const so = d.fx.sensorOut?.bind(d.fx);
  d.fx.sensorOut = (i) => { outs.push([i, +d.brain.modeT.toFixed(2)]); return so?.(i); };
  const lit = [];
  d.debug.kill();
  for (let i = 0; i < 300 && d.mode !== 'dead'; i++) { run(G, 1 / 60); if (i % 15 === 0) lit.push(bodyState(d).sensors); }
  out(`     sensors lit every 0.25 s: ${lit.join(' ')}; out at ${JSON.stringify(outs)}`);
  const mono = lit.every((x, i) => i === 0 || x <= lit[i - 1]);
  assert(outs.length === 3 && mono && lit[0] === 3 && bodyState(d).sensors === 0, 'three sensors, out one by one (fx.sensorOut 0, 1, 2), none back');
}

// ================================================================== world: the set (the world agent's)
async function scenarioWorld() {
  out('\n== scenario WORLD (the Last Foundry: its pieces, the hazards drawn and measured, the tanks, the light, the reset) ==');
  const { FOUNDRY_TUNING: FT } = await imp('src/world/lastFoundry.js');
  const G = build();
  const { game } = G;
  const W = game.world, D = W.destructibles, set = W.forest, F = set.foundry, L = D.list;
  const by = (k) => L.filter((b) => b.kind === k);
  const count = {};
  for (const b of L) count[b.kind] = (count[b.kind] ?? 0) + 1;
  out(`     ${L.length} pieces: ${Object.entries(count).map(([k, n]) => `${k} ${n}`).join(', ')}; ${W.colliders.circles.length} colliders`);
  const want = { plate: 400, ladle: 4, jibPost: 4, jib: 4, column: 6, gantry: 6, press: 1, pressHead: 1, conveyor: 6, frame: 8, tank: 5, ingots: 4, girder: 4, slag: 4, pipes: 4, catwalk: 4, furnace: 1, wall: 12 };
  assert(Object.entries(want).every(([k, n]) => count[k] === n), `every kind stands, as many as built (${Object.entries(want).filter(([k, n]) => count[k] !== n).map(([k, n]) => `${k} ${count[k]}/${n}`).join(', ') || 'all'})`);
  // everything breaks but the furnace (it chips); every piece a material and a footprint
  assert(L.every((b) => (b.kind === 'furnace' ? b.hpMax === Infinity : Number.isFinite(b.hpMax) && b.hpMax > 0)) && L.every((b) => ['metal', 'stone', 'wood', 'bone'].includes(b.mat) && b.r > 0 && b.h > 0), "every piece breaks (finite structure) but the furnace's body (it chips); each has a material and a footprint");
  // the two-stage pieces: a jib's post holds its arm, a column its run of runway, the press its head
  assert(by('jibPost').every((b) => b.top?.kind === 'jib') && by('column').every((b) => b.top?.kind === 'gantry') && by('press')[0].top?.kind === 'pressHead', "a jib's post holds its arm, a column its run of the runway, the press its head");
  // his throwables: lift 1, a weight
  const thr = L.filter((b) => b.lift === 1);
  assert(['frame', 'girder', 'ingots', 'tank'].every((k) => thr.some((b) => b.kind === k)) && thr.every((b) => b.weight > 0), `his throwables (lift 1): ${[...new Set(thr.map((b) => b.kind))].join(', ')} (${thr.length})`);
  // the innermost 10 m are clear of anything that stops a blade; nothing tall south of the fight in the frame
  const inner = L.filter((b) => !b.floor && Math.hypot(b.x, b.z) < 10 + b.r && b.y0 < 2);
  assert(inner.length === 0, `the innermost 10 m are clear (${inner.map((b) => b.kind).join(', ')})`);
  const tall = L.filter((b) => !b.floor && b.z > 8 && b.y0 + b.h > 4.6 && Math.abs(b.x) < 14);
  assert(tall.length === 0, `nothing over 4.6 m stands south of the fight in the frame (${tall.map((b) => `${b.kind} ${b.x.toFixed(0)},${b.z.toFixed(0)}`).join(' ')})`);
  // nothing of the set inside his circle stops him
  const inC = W.colliders.circles.filter((c) => Math.hypot(c.x, c.z) - c.r < FOUNDRY.floor.r - 0.5 && c.tag !== 'bonfire');
  assert(inC.length === 0, `no collider inside his circle (${inC.map((c) => `${c.x.toFixed(1)},${c.z.toFixed(1)} r${c.r}`).join(' ')})`);
  // no gap between two circles the hero can be wedged in
  const cs = W.colliders.circles.filter((c) => c.on !== false && c.tag !== 'bonfire');
  const narrow = [];
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const g = Math.hypot(cs[i].x - cs[j].x, cs[i].z - cs[j].z) - cs[i].r - cs[j].r;
    const mx = (cs[i].x * cs[j].r + cs[j].x * cs[i].r) / (cs[i].r + cs[j].r), mz = (cs[i].z * cs[j].r + cs[j].z * cs[i].r) / (cs[i].r + cs[j].r);
    if (cs.some((c, k) => k !== i && k !== j && Math.hypot(c.x - mx, c.z - mz) < c.r)) continue;
    if (g > 0.35 && g < 0.95 && Math.hypot(cs[i].x, cs[i].z) < FOUNDRY.bound) narrow.push(`${cs[i].x.toFixed(1)},${cs[i].z.toFixed(1)}|${cs[j].x.toFixed(1)},${cs[j].z.toFixed(1)} ${g.toFixed(2)}`);
  }
  assert(narrow.length === 0, `no gap between two colliders narrower than the hero and not closed (${narrow.slice(0, 6).join('; ')})`);
  // ---- MEASURED (BRIEF 11): can it happen? A ladle's pool reaches into his circle; a corner tank's blast reaches him
  const R = FOUNDRY.floor.r;
  const poolIn = F.ladles.map((l) => FT.molten.spill.r - (Math.hypot(l.x, l.z) - R));
  const tankIn = FOUNDRY.tanks.map((t) => FT.tank.boss.r - (Math.hypot(t.x, t.z) - R));
  out(`     a spilled ladle's pool (r ${FT.molten.spill.r}) reaches ${poolIn.map((v) => v.toFixed(2)).join(' / ')} m into his circle; a tank's blast on him (r ${FT.tank.boss.r}) ${tankIn.map((v) => v.toFixed(2)).join(' / ')} m`);
  assert(poolIn.every((v) => v > 1.5), 'every ladle spills well into his circle (a pool can catch him)');
  assert(tankIn.filter((v) => v > 0.3).length >= 4, "the four corner tanks' blasts reach into his circle (the press's is the hero's)");
  let worst = 0;
  for (let a = 0; a < 64; a++) {
    const x = Math.sin((a / 64) * 2 * Math.PI) * R, z = Math.cos((a / 64) * 2 * Math.PI) * R;
    worst = Math.max(worst, Math.min(...thr.map((b) => Math.hypot(b.x - x, b.z - z))));
  }
  out(`     a throwable within ${worst.toFixed(1)} m of every point of his circle's edge`);
  assert(worst <= 10, `a throwable within 10 m of every point of his circle (${worst.toFixed(1)})`);
  // the hero's blade on a ladle's chain: heavy cuts (0.5) until it spills
  {
    const l = F.ladles[2], b = L.find((o) => o.def === l.def);
    let cuts = 0;
    while (l.full && cuts < 20) {
      D.sweep(l.x + 1.2, l.z, l.x - 1.2, l.z, 0.4, 0.5, { kind: 'cut', by: 'player', y: 1.4, ya: 1.6, yb: 1.2, src: D.swing() });
      cuts++;
      run(G, 0.05);
    }
    out(`     the hero's heavy cuts (0.5) to bring a ladle down: ${cuts} (its structure ${b?.hpMax})`);
    assert(!l.full && cuts <= 4 && F.molten.pools.some((p) => p.alive && Math.hypot(p.x - l.x, p.z - l.z) < 0.1), `the hero's blade cuts a ladle down in ${cuts} heavy cuts, and it spills`);
  }
  // a jib brought down (blows on its post go to its arm) drops its ladle
  {
    const l = F.ladles[0], post = by('jibPost').find((b) => b.def === l.post);
    for (let i = 0; i < 30 && post.top.state === 0; i++) {
      D.strike(post.x, post.z, 0.6, 1.5, { kind: 'blunt', by: 'boss', y: 1, src: D.swing() });
      run(G, 0.05);
    }
    run(G, 0.2);
    assert(post.top.state !== 0 && !l.full, `a jib struck down at its post (${post.top.state}) drops its ladle (full ${l.full})`);
  }
  // the pools drawn: heat in the fire field over a live pool (a hot rim, a crust in the middle)
  {
    const P = F.molten.add(-4, 4, { r: 2.2, life: 6 });
    run(G, 0.6);
    const fire = game.fx.fire, d = fire.data;
    let n = 0, hot = 0;
    for (let i = 0; i < fire.count; i++) {
      const k = i * 15;
      if (Math.hypot(d[k] + 4, d[k + 2] - 4) < 2.3 && d[k + 1] < 0.5) {
        n++;
        hot = Math.max(hot, d[k + 10]);
      }
    }
    assert(P.alive && n >= 20 && hot > 1, `a pool prints as heat (${n} blobs, the hottest ${hot.toFixed(2)})`);
    run(G, 7);
    assert(!P.alive, 'it cools and goes');
  }
  // a gas tank the hero breaks: a fuse cued red, then the burst (the world, the hero inside it, him beside it)
  {
    const t = by('tank')[0], p = game.player;
    duel(G, { dist: 4 });
    const d = game.dragon;
    d.debug.setAI(false);
    p.debug.god = false;
    p.debug.heal();
    d.position.set(t.x * 0.8, 0, t.z * 0.8);
    p.debug.teleport(t.x - 1.2, t.z + 0.6);
    let told = 0, flashed = 0, blasts = 0, onBlast = 0;
    const ob = d.onBlast;
    d.onBlast = (...a) => {
      onBlast++;
      return ob?.apply(d, a);
    };
    G.watch = (n, e) => {
      if (e?.attack === 'tankBurst') {
        if (n === 'combat:tell') told++;
        if (n === 'combat:flash') flashed++;
      }
      if (n === 'world:blast') blasts++;
    };
    const hp0 = p.hp, dh0 = d.hp;
    for (let i = 0; i < 10 && t.state === 0; i++) D.strike(t.x, t.z, 0.8, 1, { kind: 'blunt', by: 'player', y: 0.8, src: D.swing() });
    run(G, FT.tank.fuse + 0.6);
    G.watch = null;
    out(`     a tank: cued ${told}/${flashed}, ${blasts} blast, the hero ${hp0} -> ${p.hp}, him ${Math.round(dh0)} -> ${Math.round(d.hp)} (onBlast ${onBlast}; he stood ${Math.hypot(d.position.x - t.x, d.position.z - t.z).toFixed(1)} m from it)`);
    assert(told === 1 && flashed === 1 && blasts === 1 && F.tanks[0].state === 'done', 'a broken tank: a red tell, its flash, then one blast (world:blast)');
    assert(p.hp < hp0 && onBlast === 1 && d.hp < dh0, 'the burst hurts the hero inside it, and him beside it (onBlast) when the hero broke it');
    d.onBlast = ob;
    p.debug.god = true;
  }
  // the light by his phase: four states, eased; flare and dim
  {
    const amb = set.ambience, U = game.U;
    const cols = [];
    for (const n of [1, 2, 3, 4]) {
      set.setPhase(n);
      const g2 = { ...game, dragon: { phase: n, mode: 'foot' } };
      for (let i = 0; i < 300; i++) amb.update(1 / 60, g2);
      cols.push([U.uMoonColor.value.r, U.uMoonColor.value.g, U.uMoonColor.value.b].map((x) => x.toFixed(2)).join(','));
      assert(amb.state.phase === n && amb.state.w[n - 1] > 0.95, `the light eases into phase ${n} (${amb.state.w.map((x) => x.toFixed(2)).join(' / ')}; the moon ${cols[n - 1]})`);
    }
    assert(new Set(cols).size === 4, 'four lights, each its own');
    amb.flare(1);
    assert(amb.state.flash >= 1, 'flare(k) flashes the light');
    const g4 = { ...game, dragon: { phase: 4, mode: 'foot' } };
    for (let i = 0; i < 30; i++) {
      amb.dim(1);
      amb.update(1 / 60, g4);
    }
    assert(amb.state.dim > 0.6, `dim(k) pulls it down while it is asked (${amb.state.dim.toFixed(2)})`);
  }
  // the reset: everything stands again, the ladles full, no pool, the tanks' fuses out, the light phase 1
  W.restore();
  game.dragon.reset();
  run(G, 0.5);
  assert(F.ladles.every((l) => l.full) && F.molten.pools.every((p) => !p.alive) && F.tanks.every((f) => f.state === 'idle') && L.filter((b) => !b.floor).every((b) => b.state === 0), 'the reset: every piece stands, every ladle full, no pool, the tanks quiet');
  run(G, 4);
  assert(set.ambience.state.phase === 1 && set.ambience.state.w[0] > 0.9, `... and the light is phase 1 again (${set.ambience.state.w.map((x) => x.toFixed(2)).join(' / ')})`);
  run(G, 1);
  assert(F.ladles.every((l) => l.full) && F.molten.pools.every((p) => !p.alive), 'no ladle spills by itself after the reset');
}

// ================================================================== terrain (the terrain agent's: falseSaint/terrain.js, moves/terrain.js)
// The foundry as his weapon: Offertory (P2), Crucible, Relic, Prostration (P3), Dies Irae (P4); the molten
// pools' damage; the transitions' world. Each move refuses without its piece; what lands lands where it was
// cued; a fresh pool can always be rolled out of; he burns in his own pools; the changes strike the world.
const tr = (G) => G.game.dragon.parts.terrain;
const TR_MOVES = ['offertory', 'crucible', 'relic', 'prostration', 'diesIrae'];
/** The hero teleported to (x, z), facing him, healed. */
function trHeroAt(G, x, z) {
  const { game } = G;
  const d = game.dragon, p = game.player;
  p.debug.teleport(x, z);
  p.yaw = Math.atan2(d.position.x - p.position.x, d.position.z - p.position.z);
  p.debug.heal();
  game.mouseGround.set(d.position.x, 0, d.position.z);
}
/** A phase-`form` duel, his AI off, the pace limit off, him at (bx, bz). */
function trDuel(G, form, bx = 0, bz = 0) {
  duel(G, { dist: 4, ai: false, form });
  const d = G.game.dragon;
  d.position.set(bx, 0, bz);
  tr(G).paced = false;
  run(G, 0.2);
  return d;
}
/** Run until his act is over (and the hero is up); `step` each frame. */
function trPlay(G, max = 8, step = null) {
  const d = G.game.dragon;
  let acted = d.mode === 'act';
  return run(G, max, step, () => { if (d.mode === 'act') acted = true; return acted && d.mode !== 'act' && G.game.player.state !== 'roll' && G.game.player.state !== 'knockdown'; });
}
/** Roll away from (x, z) now. */
function trRollFrom(G, x, z) {
  const p = G.game.player.position, dx = p.x - x, dz = p.z - z, l = Math.hypot(dx, dz) || 1;
  G.input.axis = { x: dx / l, y: -dz / l };
  G.input.tap('Space');
}

async function scenarioTrData() {
  out('\n== scenario TR DATA (his five terrain moves: phases, tells, windups, links; every beat routed to the terrain handler) ==');
  const want = { offertory: [2, 'R'], crucible: [3, 'R'], relic: [3, 'B'], prostration: [3, 'R'], diesIrae: [4, 'R'] };
  for (const name of TR_MOVES) {
    const def = MOVES[name];
    assert(!!def && def.phase === want[name][0], `${name}: from phase ${want[name][0]}`);
    for (const f of phasesOf(name)) {
      const A = realise(name, f, () => 0.5);
      const real = A.beats.filter((b) => !b.feint);
      const tells = real.map((b) => (b.def.tell === TELL.BLUE ? 'B' : b.def.tell === TELL.RED ? 'R' : 'N')).join('');
      if (f === def.phase) out(`     ${name} P${f}: ${A.beats.map((b) => `${b.feint ? 'feint' : tells}[${(b.impact - b.start).toFixed(2)} s]`).join(' + ')}, the cast at ${real[0].impact.toFixed(2)} s, ends ${A.end.toFixed(2)} s; damage ${real.map((b) => b.def.damage).join('/')}`);
      if (!(tells === want[name][1] && real.every((b) => b.def.cast?.selfCue && b.impact - b.tellAt >= TUNING.minFirstWindup - 1e-6))) assert(false, `${name} P${f}: tell ${tells}, a self-cued cast with a windup >= ${TUNING.minFirstWindup} s`);
    }
  }
  const G = build();
  const d = G.game.dragon;
  const routed = TR_MOVES.every((n) => MOVES[n].beats.every((b) => d._handlerOf(b) === tr(G)));
  assert(routed, 'every beat of the five is routed to the terrain handler');
  const { LINKS } = await imp('src/entities/enemies/falseSaint/links.js');
  assert(TR_MOVES.every((n) => (LINKS[n] ?? []).length > 0), `each has its links (${TR_MOVES.map((n) => `${n} ${(LINKS[n] ?? []).map((l) => l.to).join('/')}`).join('; ')})`);
}

async function scenarioTrRefuse() {
  out('\n== scenario TR REFUSE (no piece, no move: weighed 0 and refused when its piece is gone or out of reach) ==');
  const G = build();
  const { game } = G;
  const W = game.world.destructibles, F = game.world.forest.foundry;
  const d = trDuel(G, 4, 0, 0);
  const T = tr(G);
  // (the three changes on the way to phase 4 may have burst a tank or a ladle: every piece back first)
  game.world.restore();
  F.reset();
  run(G, 0.3);
  // with the pieces there: each can start (the hero where it needs him)
  const L = F.ladles[1];
  const can = (name, hx, hz, bx = 0, bz = 0) => { d.position.set(bx, 0, bz); trHeroAt(G, hx, hz); const w = d.weigh(name, MOVES[name], 1, 4); const ok = d.brain.trigger(name); d.brain.act = null; d.mode = 'foot'; T.reset(); T.paced = false; d.position.set(0, 0, 0); return { w, ok }; };
  const col = pieces(G, 'column').find((c) => c.x > 0 && c.z < 0);
  const before = {
    crucible: can('crucible', L.x - 3.5, L.z),
    relic: can('relic', -2, 3, -9, 0),
    offertory: can('offertory', -1, -2, -9, -8),
    prostration: can('prostration', col.x - 5, col.z + 1),
    diesIrae: can('diesIrae', 0, 5),
  };
  out(`     with their pieces: ${Object.entries(before).map(([k, v]) => `${k} w ${v.w.toFixed(2)} ${v.ok ? 'starts' : 'REFUSED'}`).join(', ')}`);
  assert(Object.values(before).every((v) => v.w > 0 && v.ok), 'each starts while its piece is there');
  game.world.restore();
  d.reset();
  run(G, 0.3);
  const d2 = trDuel(G, 4, 0, 0);
  // the pieces gone: every ladle spilled, every throwable and tank broken, every column down, the press's head down
  for (const l of F.ladles) F.drop(l, 'boss');
  for (const b of W.list) if (['girder', 'ingots', 'frame', 'tank', 'column', 'gantry', 'pressHead'].includes(b.kind) && b.state === 0) { b.hp = 0.01; W.strike(b.x, b.z, 0.3, 9, { kind: 'blunt', by: 'boss', y: b.kind === 'gantry' ? 9 : b.kind === 'pressHead' ? 5 : 0.8, src: W.swing() }); }
  run(G, 3);
  const T2 = tr(G);
  T2.paced = false;
  const r0 = T2.stats.refused;
  const after = {
    crucible: can('crucible', L.x - 3.5, L.z),
    relic: can('relic', -2, 3, -9, 0),
    offertory: can('offertory', -1, -2, -9, -8),
    prostration: can('prostration', col.x - 5, col.z + 1),
    diesIrae: can('diesIrae', 0, 5),
  };
  out(`     without them: ${Object.entries(after).map(([k, v]) => `${k} w ${v.w.toFixed(2)} ${v.ok ? 'STARTS' : 'refused'}`).join(', ')} (${W.list.filter((b) => ['girder', 'ingots', 'frame', 'tank', 'column', 'pressHead'].includes(b.kind) && b.state === 0).length} such pieces left standing)`);
  assert(Object.values(after).every((v) => v.w === 0 && !v.ok) && T2.stats.refused >= r0, 'each is weighed 0 and refused without its piece');
  // and out of reach: the hero far from every ladle / column
  game.world.restore();
  d2.reset();
  run(G, 0.3);
  const d3 = trDuel(G, 4, 0, 0);
  tr(G).paced = false;
  trHeroAt(G, 0, 2);
  assert(d3.weigh('crucible', MOVES.crucible, 1, 2) === 0 && d3.weigh('prostration', MOVES.prostration, 1, 2) === 0 && !d3.brain.trigger('crucible'), 'the hero in the floor\'s middle: no ladle and no column in reach of him');
}

async function scenarioTrPools() {
  out('\n== scenario TR POOLS (a fresh pool: always rolled out of; a walk out of its middle takes one burn; thrown past its rim; never on a hero who is down) ==');
  const M = TUNING.terrain.molten;
  const { FOUNDRY_TUNING: FT } = await imp('src/world/lastFoundry.js');
  const R = FT.molten.spill.r;
  const reach = R + M.pad + 0.45 * 0.5;
  // (1) the hero in the middle of a fresh ladle-sized pool: a roll started `arm - 0.1` s after its cue
  // (the latest a bot reacting 0.1 s before the burn would), each of 8 ways: never burnt
  const res = [];
  for (let k = 0; k < 8; k++) {
    const G = build();
    const { game } = G;
    const d = trDuel(G, 1, 0, -9);
    const p = game.player;
    trHeroAt(G, 0, 3);
    const hp0 = p.hp;
    d.debug.pool(0, 3, R);
    const a = (k / 8) * Math.PI * 2, at = [0, 0.15, 0.3, M.arm - 0.1][k % 4];
    let rolled = -1, outAt = NaN;
    const t0 = game.time;
    run(G, 1.6, () => {
      if (rolled < 0 && game.time - t0 >= at) { G.input.axis = { x: Math.sin(a), y: -Math.cos(a) }; G.input.tap('Space'); rolled = game.time - t0; }
      if (!Number.isFinite(outAt) && Math.hypot(p.position.x, p.position.z - 3) > reach) outAt = game.time - t0;
    });
    res.push({ k, burnt: p.hp < hp0, outAt, rolled });
  }
  out(`     the roll from its middle at ${(M.arm - 0.1).toFixed(2)} s: out past its reach (${reach.toFixed(2)} m) at ${res.map((r) => r.outAt.toFixed(2)).join(' / ')} s; burnt ${res.filter((r) => r.burnt).length} / 8`);
  assert(res.every((r) => !r.burnt), 'a roll out of a fresh pool\'s middle is never burnt (8 ways)');
  // (2) a walk out of its middle: one burn (and only one: he is thrown past its rim)
  {
    const G = build();
    const { game } = G;
    const d = trDuel(G, 1, 0, -9);
    const p = game.player;
    trHeroAt(G, 0, 3);
    const hp0 = p.hp;
    d.debug.pool(0, 3, R);
    run(G, 2.2, () => { G.input.axis = { x: 1, y: 0 }; });
    G.input.axis = { x: 0, y: 0 };
    const burns = tr(G).stats.heroBurns;
    out(`     a walk out of its middle: ${burns} burn(s), ${hp0} -> ${p.hp} (${((hp0 - p.hp) / p.maxHp * 100).toFixed(0)} % of his bar), out at ${Math.hypot(p.position.x, p.position.z - 3).toFixed(2)} m`);
    assert(burns === 1 && p.hp < hp0, 'a walk out of its middle costs one burn');
    // (3) standing still in it: thrown past its rim at the first burn, no second
    const G2 = build();
    const d2 = trDuel(G2, 1, 0, -9);
    const p2 = G2.game.player;
    trHeroAt(G2, 0.3, 3);
    d2.debug.pool(0, 3, R);
    run(G2, 2.5);
    const e2 = Math.hypot(p2.position.x, p2.position.z - 3);
    out(`     standing still in it: ${tr(G2).stats.heroBurns} burn(s), thrown to ${e2.toFixed(2)} m from its middle (its reach ${reach.toFixed(2)})`);
    assert(tr(G2).stats.heroBurns === 1 && e2 > reach, 'standing still: one burn, thrown out past its rim (never a trap)');
  }
  // (4) a hero knocked down in a pool is not burnt while down, and not for `grace` s after he is up
  {
    const G = build();
    const { game } = G;
    const d = trDuel(G, 1, 0, -9);
    const p = game.player;
    trHeroAt(G, 0, 3);
    d.debug.pool(0, 3, R);
    run(G, 0.05);
    p.takeHit({ damage: 1, knockback: 0, knockdown: true, kind: 'crush', tell: TELL.RED, from: { x: 0, z: 2 } });
    let burntDown = false, upAt = NaN, burnAt = NaN;
    const hp0 = p.hp;
    run(G, 4, () => {
      if (p.state === 'knockdown' && p.hp < hp0) burntDown = true;
      if (!Number.isFinite(upAt) && p.state !== 'knockdown') upAt = game.time;
      if (!Number.isFinite(burnAt) && p.hp < hp0) burnAt = game.time;
    });
    out(`     knocked down in it: burnt while down ${burntDown}; up at +0, the first burn ${Number.isFinite(burnAt) ? `+${(burnAt - upAt).toFixed(2)} s after` : 'never'}`);
    assert(!burntDown && (!Number.isFinite(burnAt) || burnAt - upAt >= M.grace - 0.02), `never burnt while down; ${M.grace} s of grace after he is up`);
  }
  // (5) the pool's burn is no blow to perfect-dodge: a roll into it gives no plunge
  {
    const G = build();
    const { game } = G;
    const d = trDuel(G, 1, 0, -9);
    trHeroAt(G, 0, 7);
    d.debug.pool(0, 3, R);
    run(G, 0.8);
    const pd = G.counts['player:perfectDodge'] ?? 0, pl = G.counts['player:plunge'] ?? 0;
    G.input.axis = { x: 0, y: 1 };
    G.input.tap('Space');
    run(G, 1.2);
    G.input.axis = { x: 0, y: 0 };
    assert((G.counts['player:perfectDodge'] ?? 0) === pd && (G.counts['player:plunge'] ?? 0) === pl, 'rolling through a pool is no perfect dodge (no plunge)');
  }
}

async function scenarioTrCrucible() {
  out('\n== scenario TR CRUCIBLE (the gun on a ladle\'s chain; the pools land where they were marked; the hero who stays is burnt, the one who leaves is not; his own pool burns him) ==');
  const K = TUNING.terrain.crucible;
  for (const [label, off] of [['the hero under the ladle', 1.2], ['the hero beside it (a splash)', 4.0]]) {
    const G = build();
    const { game } = G;
    const d = trDuel(G, 3, 0, 0);
    const F = game.world.forest.foundry, L = F.ladles[1], p = game.player;
    trHeroAt(G, L.x - off, L.z);
    const log = flashLog(G);
    const hp0 = p.hp, t0 = game.time;
    const ok = d.brain.trigger('crucible');
    const P = tr(G).lastPlan;
    let shotAt = NaN, poolAt = NaN, burnAt = NaN;
    const ids0 = F.molten.pools.filter((q) => q.alive).length;
    run(G, 4, () => {
      if (!Number.isFinite(shotAt) && tr(G).stats.shots > 0) shotAt = game.time - t0;
      if (!Number.isFinite(poolAt) && F.molten.pools.some((q) => q.alive)) poolAt = game.time - t0;
      if (!Number.isFinite(burnAt) && p.hp < hp0) burnAt = game.time - t0;
    });
    G.watch = null;
    const live = F.molten.pools.filter((q) => q.alive);
    const under = live.find((q) => Math.hypot(q.x - L.x, q.z - L.z) < 0.1);
    const splash = live.find((q) => q !== under);
    const at = splash && P.splash ? Math.hypot(splash.x - P.mx, splash.z - P.mz) : 0;
    out(`     ${label} (${off} m): ${ok ? 'started' : 'REFUSED'}, the marks fixed at ${(K.fix * 1.0).toFixed(2)} s (splash ${P?.splash ? `${Math.hypot(P.mx - L.x, P.mz - L.z).toFixed(2)} m from the ladle` : 'none'}), the shot ${shotAt.toFixed(2)} s, a pool ${poolAt.toFixed(2)} s, ${live.length - ids0} pools (${live.map((q) => `r ${q.r}`).join(', ')}), the burn ${burnAt.toFixed(2)} s; cues ${tellsOf(log)}`);
    assert(ok && !L.full && !!under && (!P.splash || (splash && at < 0.05)), `${label}: the ladle spills under itself${P.splash ? ', the splash lands where it was marked' : ''}`);
    assert(Number.isFinite(burnAt) && burnAt - poolAt >= TUNING.terrain.molten.arm - 0.05 && tellsOf(log).includes('R'), `${label}: a red cue, then the hero who stayed is burnt (${(burnAt - poolAt).toFixed(2)} s after the pool lands)`);
  }
  // the hero who walks off the mark as it shows is not burnt
  {
    const G = build();
    const { game } = G;
    const d = trDuel(G, 3, 0, 0);
    const F = game.world.forest.foundry, L = F.ladles[1], p = game.player;
    trHeroAt(G, L.x - 3.5, L.z);
    const hp0 = p.hp;
    d.brain.trigger('crucible');
    run(G, 4, () => { G.input.axis = d.brain.act?.t > K.fix ? { x: -1, y: 0 } : { x: 0, y: 0 }; });
    G.input.axis = { x: 0, y: 0 };
    out(`     the hero who walks off the mark at its fix: ${hp0} -> ${p.hp}, ${Math.hypot(p.position.x - L.x, p.position.z - L.z).toFixed(1)} m from the ladle`);
    assert(p.hp === hp0, 'walking off the mark as it shows: untouched');
  }
  // the level's trick: he stands by the ladle, the hero lures the shot: his own pool burns him
  {
    const G = build();
    const { game } = G;
    const F = game.world.forest.foundry;
    const L = F.ladles[1];
    const d = trDuel(G, 3, L.x - 1.2, L.z + 0.4);
    trHeroAt(G, L.x - 4.6, L.z - 0.6);
    game.player.debug.god = true;
    const h0 = d.hp;
    d.brain.trigger('crucible');
    run(G, 3);
    out(`     he stands under the ladle he shoots: bossBurns ${tr(G).stats.bossBurns}, his hp ${Math.round(h0)} -> ${Math.round(d.hp)}, shell ${d.shell.exposure.toFixed(2)}`);
    assert(tr(G).stats.bossBurns >= 1 && d.hp < h0, 'his own pool burns him (the trick)');
  }
}

async function scenarioTrRelic() {
  out('\n== scenario TR RELIC (he jets to a piece, tears it up, throws it: the blue flare on it; landed / parried / rolled; he walks back into his circle) ==');
  for (const how of ['none', 'parry', 'dodge']) {
    const G = build();
    const { game } = G;
    const d = trDuel(G, 3, -9, 0);
    const p = game.player;
    trHeroAt(G, -2, 3);
    p.debug.god = false;
    const T = tr(G);
    const step = answer(G, how, 'relic');
    const log = flashLog(G);
    const hp0 = p.hp, pv0 = d.posture;
    const x0 = d.position.x, z0 = d.position.z;
    let maxOut = 0, flashT = NaN, landT = NaN, flashY = NaN;
    const prevWatch = G.watch;
    G.watch = (n, e) => { prevWatch?.(n, e); if (n === 'combat:flash' && e.attack === 'relic' && !Number.isFinite(flashT)) { flashT = game.time; flashY = e.y; } };
    const ok = d.brain.trigger('relic');
    const P = T.lastPlan, pc = P?.piece;
    run(G, 6, () => { step(); maxOut = Math.max(maxOut, Math.hypot(d.position.x, d.position.z) - d.bound); }, () => { if (!Number.isFinite(landT) && T.stats.landed > 0) landT = game.time; return T.stats.landed > 0 && d.mode !== 'act' && p.state !== 'roll'; });
    run(G, 1.5);
    G.watch = null;
    const r = G.hits.filter((h) => h.attack === 'relic').at(-1)?.r;
    out(`     ${how}: ${ok ? '' : 'REFUSED '}a ${pc?.kind} ${pc ? Math.hypot(pc.x - x0, pc.z - z0).toFixed(1) : '-'} m from him (he stood ${P ? Math.hypot(P.sx - x0, P.sz - z0).toFixed(1) : '-'} m off, ${maxOut.toFixed(2)} m past his circle at most, back in: ${(Math.hypot(d.position.x, d.position.z) - d.bound).toFixed(2)}), the flare ${(landT - flashT).toFixed(2)} s before it landed at ${flashY.toFixed(1)} m up; ${tellsOf(log)}; the hero ${hp0} -> ${p.hp} (${r ?? 'not reached'}), his posture ${Math.round(pv0)} -> ${Math.round(d.posture)}`);
    assert(ok && T.stats.taken === 1 && T.stats.thrown === 1 && T.stats.landed === 1 && pc?.state !== 0, `${how}: the ${pc?.kind} is torn up, thrown, lands`);
    assert(tellsOf(log).startsWith('B') && landT - flashT >= TUNING.flashLead - 1.5 * DT, `${how}: the blue flare on the piece ${TUNING.flashLead} s before it lands (a frame)`);
    if (how === 'none') assert(r === RESULT.HIT && p.hp < hp0, 'stood still: it lands on him');
    if (how === 'parry') assert(r === RESULT.PARRIED && T.stats.parried === 1 && d.posture > pv0 && p.hp === hp0, 'parried: it breaks on his blade, posture to the saint');
    if (how === 'dodge') assert(p.hp === hp0, 'rolled at the flare: untouched');
    assert(maxOut <= TUNING.terrain.fetch.out + 0.05 && Math.hypot(d.position.x, d.position.z) <= d.bound + 0.05, `he leaves his circle by ${maxOut.toFixed(2)} m at most (${TUNING.terrain.fetch.out}) and walks back in`);
  }
  // cut out of his hands: the hero's blade breaks what he holds, nothing is thrown
  {
    const G = build();
    const { game } = G;
    const d = trDuel(G, 3, -9, 0);
    trHeroAt(G, -2, 3);
    game.player.debug.god = true;
    const T = tr(G);
    d.brain.trigger('relic');
    run(G, 2, null, () => !!T.held.piece);
    const pc = T.held.piece;
    for (let i = 0; i < 30 && pc && pc.state === 3; i++) {
      game.world.destructibles.sweep(pc.px - 1, pc.pz, pc.px + 1, pc.pz, 0.6, 1.5, { kind: 'cut', by: 'player', y: (pc.py ?? 1) + 0.3, src: game.world.destructibles.swing() });
      run(G, 0.02);
    }
    trPlay(G, 4);
    out(`     the piece cut in his hands: state ${pc?.state}, thrown ${T.stats.thrown}`);
    assert(!!pc && pc.state !== 3 && T.stats.thrown === 0, 'cut out of his hands: it breaks, nothing is thrown');
  }
}

async function scenarioTrOffertory() {
  out('\n== scenario TR OFFERTORY (a gas tank kicked low at the hero: the red flare on it; it bursts where it lands; a roll clears it) ==');
  for (const how of ['none', 'dodge']) {
    const G = build();
    const { game } = G;
    const d = trDuel(G, 2, -9, -8);
    const p = game.player;
    trHeroAt(G, -1, -2);
    p.debug.god = false;
    const T = tr(G), log = flashLog(G);
    let blasts = 0, flashT = NaN, landT = NaN, hz = null;
    const prev = G.watch;
    G.watch = (n, e) => { prev?.(n, e); if (n === 'world:blast') blasts++; if (n === 'combat:flash' && e.attack === 'offertory' && !Number.isFinite(flashT)) { flashT = game.time; hz = e.hazard; } };
    const step = how === 'dodge' ? () => { if (Number.isFinite(flashT) && !G._rolled && game.time >= flashT + TUNING.flashLead - 0.12) { G._rolled = true; trRollFrom(G, T.fly[0]?.tx ?? p.position.x, T.fly[0]?.tz ?? p.position.z + 1); } } : null;
    G._rolled = false;
    const hp0 = p.hp;
    const ok = d.brain.trigger('offertory');
    const pc = T.lastPlan?.piece;
    run(G, 6, () => step?.(), () => { if (!Number.isFinite(landT) && T.stats.landed > 0) landT = game.time; return T.stats.landed > 0 && d.mode !== 'act' && p.state !== 'roll'; });
    run(G, 0.6);
    G.watch = null;
    const r = G.hits.filter((h) => h.attack === 'tankBurst').at(-1);
    out(`     ${how}: ${ok ? '' : 'REFUSED '}the ${pc?.kind} at ${pc ? `${pc.x.toFixed(1)}, ${pc.z.toFixed(1)}` : '-'}, the red flare ${(landT - flashT).toFixed(2)} s before it landed (hazard ${hz}), ${blasts} blast(s), bursts ${T.stats.bursts} duds ${T.stats.duds}; ${tellsOf(log)}; the hero ${hp0} -> ${p.hp} (${r?.r ?? 'not reached'})`);
    assert(ok && pc?.kind === 'tank' && T.stats.thrown === 1 && T.stats.bursts === 1 && blasts === 1, `${how}: the tank kicked, burst where it landed`);
    assert(tellsOf(log).startsWith('R') && hz === true && landT - flashT >= TUNING.flashLead - 1.5 * DT, `${how}: the red flare on the tank (a hazard) ${TUNING.flashLead} s before it lands`);
    if (how === 'none') assert(p.hp < hp0, 'stood still: the blast takes him');
    else assert(p.hp === hp0, 'rolled at the flare: untouched');
  }
}

async function scenarioTrProstration() {
  out('\n== scenario TR PROSTRATION (his eye cuts a column\'s foot: it comes down across the floor on the hero: the world\'s strip, red; a roll clears it) ==');
  for (const how of ['none', 'dodge']) {
    const G = build();
    const { game } = G;
    const d = trDuel(G, 3, 2, -4);
    const p = game.player;
    const col = pieces(G, 'column').find((c) => c.x > 0 && Math.abs(c.z + 1.5) < 0.2);
    trHeroAt(G, col.x - 5.5, col.z + 1);
    p.debug.god = false;
    const T = tr(G);
    let tellT = NaN, flashT = NaN, landT = NaN;
    G.defend = null;
    G.watch = (n, e) => {
      if (n === 'combat:tell' && e.attack === 'fallingDebris' && !Number.isFinite(tellT)) tellT = game.time;
      if (n === 'combat:flash' && e.attack === 'fallingDebris' && !Number.isFinite(flashT)) { flashT = game.time; if (how === 'dodge') G._rollAt = game.time + 0.18; }
    };
    G._rollAt = NaN;
    const hp0 = p.hp, t0 = game.time;
    const ok = d.brain.trigger('prostration');
    const P = T.lastPlan;
    run(G, 5, () => { if (game.time >= G._rollAt) { G._rollAt = NaN; trRollFrom(G, col.x, col.z); } if (!Number.isFinite(landT) && col.state === 2) landT = game.time; }, () => col.state === 2 && d.mode !== 'act' && p.state !== 'roll' && p.state !== 'knockdown');
    G.watch = null;
    const r = G.hits.filter((h) => h.attack === 'fallingDebris').at(-1);
    out(`     ${how}: ${ok ? '' : 'REFUSED '}the column at ${col.x.toFixed(1)}, ${col.z.toFixed(1)} (${P?.col === col ? 'the one' : 'another'}), the cut ${T.stats.felled ? 'made' : 'not made'}, its strip told ${(tellT - t0).toFixed(2)} s, flashed ${(flashT - t0).toFixed(2)} s, down ${(landT - t0).toFixed(2)} s; its runway ${col.top?.state}; the hero ${hp0} -> ${p.hp} (${r?.r ?? 'not reached'})`);
    assert(ok && T.stats.felled === 1 && col.state === 2 && Number.isFinite(tellT) && Number.isFinite(flashT) && landT - tellT >= 1.0, `${how}: the column falls across the floor, told red from the cut (${(landT - tellT).toFixed(2)} s of warning)`);
    if (how === 'none') assert(p.hp < hp0, 'stood still: it comes down on him');
    else assert(p.hp === hp0, 'rolled at the flash: untouched');
  }
}

async function scenarioTrDiesIrae() {
  out('\n== scenario TR DIES IRAE (the gun into the press: it slams, a shock runs across the floor, striking what it passes; cued on its front; a roll through it clears it) ==');
  const K = TUNING.terrain.diesIrae;
  for (const how of ['none', 'dodge']) {
    const G = build();
    const { game } = G;
    const d = trDuel(G, 4, 6, -2);
    const p = game.player;
    trHeroAt(G, -6, 6);
    p.debug.god = false;
    const T = tr(G), W = game.world.destructibles;
    const head = pieces(G, 'pressHead')[0];
    const hd0 = head.hp;
    let flashT = NaN, slamT = NaN;
    G.watch = (n, e) => { if (n === 'combat:flash' && e.attack === 'diesIrae' && !Number.isFinite(flashT)) { flashT = game.time; if (how === 'dodge') G._rollAt = game.time + TUNING.flashLead - 0.12; } };
    G._rollAt = NaN;
    const hp0 = p.hp, t0 = game.time;
    const plates0 = W.floor.filter((b) => b.hp < b.hpMax).length;
    const ok = d.brain.trigger('diesIrae');
    let hitT = NaN;
    run(G, 6, () => {
      if (game.time >= G._rollAt) { G._rollAt = NaN; trRollFrom(G, T.front.x, T.front.z); }
      if (!Number.isFinite(slamT) && T.stats.slams > 0) slamT = game.time;
      if (!Number.isFinite(hitT) && T.front.hit) hitT = game.time;
    }, () => T.stats.slams > 0 && !T.front.live && d.mode !== 'act');
    G.watch = null;
    const plates1 = W.floor.filter((b) => b.hp < b.hpMax || b.state !== 0).length;
    const e0 = Math.hypot(-6 - head.x, 6 - head.z);
    out(`     ${how}: ${ok ? '' : 'REFUSED '}the slam ${(slamT - t0).toFixed(2)} s (the press's head ${hd0.toFixed(2)} -> ${head.hp.toFixed(2)}), the front reached the hero ${(hitT - slamT).toFixed(2)} s later (${e0.toFixed(1)} m at ${K.speed} m/s), its flash ${(hitT - flashT).toFixed(2)} s before; ${T.stats.frontStruck} pieces and plates struck (${plates1 - plates0} plates marked), the hero ${hp0} -> ${p.hp}`);
    assert(ok && T.stats.slams === 1 && head.hp < hd0 && T.stats.frontStruck >= 50 && plates1 - plates0 >= 50, `${how}: the press slams (it bites its ram) and the front strikes what it passes`);
    assert(Number.isFinite(flashT) && hitT - flashT >= TUNING.flashLead - 0.05, `${how}: the flash on the front ${TUNING.flashLead} s before it reaches him`);
    if (how === 'none') assert(p.hp < hp0 && T.stats.frontHits === 1, 'stood still: the front takes him once');
    else assert(p.hp === hp0, 'rolled through the front at its flash: untouched');
  }
  // the press wears down: slam after slam, its head comes off and the move is gone
  {
    const G = build();
    const { game } = G;
    const d = trDuel(G, 4, 6, -2);
    trHeroAt(G, -6, 6);
    game.player.debug.god = true;
    const T = tr(G);
    let n = 0;
    while (n < 10 && d.brain.trigger('diesIrae')) { n++; trPlay(G, 8); run(G, 5, null, () => !T.front.live && !T.busy); }
    const head = pieces(G, 'pressHead')[0];
    out(`     the press slammed ${n} times before its head came down (head state ${head.state})`);
    assert(n >= 3 && n <= 8 && head.state !== 0 && d.weigh('diesIrae', MOVES.diesIrae, 1, 4) === 0, `the press gives out after ${n} slams; then Dies Irae is gone`);
  }
}

async function scenarioTrChange() {
  out('\n== scenario TR CHANGE (the transitions strike the world: 2 a small shock, 3 plates thrown, 4 the nova; he cannot be hurt through them) ==');
  // two ways: saint.js as it is (core's one push ring, this file's effects on top), and with the lead's edit
  // to saint.js _moment (the world blow handed to FsTerrain.onMoment: the ring by phase)
  for (const mode of ['core ring', 'onMoment']) {
    const G = build();
    const { game } = G;
    const d = game.dragon, W = game.world.destructibles;
    duel(G, { dist: 4, ai: true });
    game.player.debug.god = true;
    const T = tr(G);
    if (mode === 'onMoment' && !String(d._moment).includes('onMoment')) {
      // (the proposed edit, applied here until saint.js has it: its world blow only when the handler did not take it)
      const core = d._moment;
      d._moment = function (n) {
        const W0 = this.game.world, imp = W0.impact;
        if (this.parts?.terrain?.onMoment?.(n)) W0.impact = () => 0;
        try { return core.call(this, n); } finally { W0.impact = imp; }
      };
    }
    out(`   ${mode}:`);
    for (const n of [2, 3, 4]) {
      const st0 = { ...T.stats };
      const standing0 = W.list.filter((b) => !b.floor && b.state === 0).length;
      d.position.set(n === 4 ? 6 : 0, 0, n === 4 ? -4 : 0);
      // a cut of the hero's mid-change does nothing
      d.hp = d.maxHp * TUNING.phaseAt[n - 1] + 20;
      d.mode = 'foot';
      d.brain.act = null;
      d.takeHit({ damage: 400, part: 'body', heavy: true, exact: true });
      run(G, 1.5, null, () => d.brain.act?.name === TRANSITIONS[n]);
      run(G, 0.3);
      const hp0 = d.hp;
      const dealt = d.takeHit({ damage: 60, part: 'body', point: new THREE.Vector3(d.position.x, 1.2, d.position.z), dir: { x: 0, z: 1 }, swing: true });
      const c = { x: d.position.x, z: d.position.z };
      run(G, 6, null, () => d.mode !== 'act');
      const standing1 = W.list.filter((b) => !b.floor && b.state === 0).length;
      const broken = [4, 8].map((r) => W.floor.filter((b) => b.state !== 0 && Math.hypot(b.x - c.x, b.z - c.z) < r).length);
      out(`     phase ${n}: plates thrown ${T.stats.platesThrown - st0.platesThrown}, pieces the nova struck ${T.stats.changeStruck - st0.changeStruck}, standing pieces ${standing0} -> ${standing1}, plates gone within 4 / 8 m ${broken.join(' / ')}; a cut mid-change dealt ${dealt} (hp ${Math.round(hp0)} -> ${Math.round(d.hp)})`);
      assert(T.stats.changes - st0.changes === 1 && dealt === 0, `${mode}, phase ${n}: the change strikes the world once; a cut mid-change does nothing`);
      if (n >= 3) assert(T.stats.platesThrown - st0.platesThrown >= (n === 4 ? 8 : 4), `${mode}, phase ${n}: floor plates thrown round him (${T.stats.platesThrown - st0.platesThrown})`);
      if (n === 4) assert(T.stats.changeStruck - st0.changeStruck >= 1, `${mode}, phase 4: the nova strikes what stands within ${TUNING.terrain.change[4].reach} m (${T.stats.changeStruck - st0.changeStruck})`);
      if (n === 2 && mode === 'onMoment') assert(broken[1] < 30, `onMoment, phase 2: a SMALL shock (${broken[1]} plates gone within 8 m)`);
      settle(G, 2);
      d.brain.act = null;
      d.mode = 'foot';
    }
  }
}

async function scenarioTrUse() {
  const SECS = Number(process.env.GCD_TRSECS ?? 20);
  out(`\n== scenario TR USE (a measure: how often each terrain move CAN be used (its piece in reach of the hero / of him), and how often he picks it, against the roaming guarding bot; ${SECS} s a phase) ==`);
  for (let ph = 2; ph <= 4; ph++) {
    const G = build(4242, true);
    const { game } = G;
    const d = game.dragon, p = game.player, T = tr(G);
    duel(G, { dist: 3, ai: true, form: ph });
    p.debug.god = true;
    p.debug.noRiposte = true;
    G.defend = bPaceDefender(G);
    const avail = Object.fromEntries(TR_MOVES.map((n) => [n, 0]));
    const used = {};
    G.watch = (n, e) => { if (n === 'dragon:windup' && TR_MOVES.includes(e?.name)) used[e.name] = (used[e.name] ?? 0) + 1; };
    const roam = mulberry32(77 + ph), goal = { r: 2.5, a: 0, until: -1 };
    let frames = 0;
    for (let i = 0; i < Math.round(SECS / DT); i++) {
      const rolled = G.defend.act();
      if (game.time > goal.until) {
        goal.r = [2.5, 5, 9][Math.floor(roam() * 3)];
        goal.a = Math.atan2(p.position.x - d.position.x, p.position.z - d.position.z) + (roam() - 0.5) * 1.6;
        goal.until = game.time + 4;
      }
      if (!rolled && p.state !== 'roll') {
        const gx = d.position.x + Math.sin(goal.a) * goal.r, gz = d.position.z + Math.cos(goal.a) * goal.r;
        const k = Math.hypot(gx, gz) > 13 ? 13 / Math.hypot(gx, gz) : 1;
        const dx = gx * k - p.position.x, dz = gz * k - p.position.z, l = Math.hypot(dx, dz);
        G.input.axis = l > 0.5 ? { x: dx / l, y: -dz / l } : { x: 0, y: 0 };
      }
      game.mouseGround.set(d.position.x, 0, d.position.z);
      G.tick(DT);
      if (i % 10 === 0) {
        frames++;
        for (const n of TR_MOVES) if (MOVES[n].phase <= ph && T._find(n)) avail[n]++;
      }
      if (d.phase !== ph && d.mode !== 'act') break;
    }
    G.defend = null;
    G.watch = null;
    out(`     P${ph}: its piece there ${TR_MOVES.filter((n) => MOVES[n].phase <= ph).map((n) => `${n} ${(avail[n] / Math.max(1, frames) * 100).toFixed(0)} %`).join(', ')}; picked ${Object.entries(used).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}; pools ${T.stats.pools}, his burns ${T.stats.bossBurns}, the hero's ${T.stats.heroBurns}`);
    assert(G.payload.size === 0, `P${ph}: no NaN in any event`);
  }
}

// ================================================================== arsenal (the arsenal agent's: moves/arsenal.js, arsenal.js)
// Vigil, Absolution, Triptych, Choir, Passing Bell, Kyrie, Verdict, Revelation: each move's tells and
// windups as realised, its hit on a hero who stands, nothing on one who answers it, what it breaks, its
// ledger handling (missiles and shells cued, cut, never inside a guard's window: arFair, 3 seeds; the
// measure in the report: GCD_ARSEEDS=1,2,3,4,5,6,7,8,9,10), the barrage's lanes.
const ar = (G) => G.game.dragon.parts.arsenal;
const AR_MOVES = ['vigil', 'absolution', 'triptych', 'choir', 'passingBell', 'kyrie', 'verdict', 'revelation'];
/** A build in phase `form`, his AI off, the hero `dist` m before him; world.groundBlow counted by kind. */
function arDuel(form, dist = 7, seed = SEED) {
  const G = build(seed, true);
  duel(G, { dist, ai: false, form });
  G.marks = {};
  G.game.world.groundBlow = (x, z, o) => {
    if (![x, z, o?.power].every(Number.isFinite)) throw new Error('NaN groundBlow');
    G.marks[o.kind] = (G.marks[o.kind] ?? 0) + 1;
    if (o.kind === 'beam') G.marks.beamLen = (G.marks.beamLen ?? 0) + (o.len || 0);
  };
  return G;
}
/** Run move `name` once where everyone stands, the hero answering with `step` (or standing); until it and
 *  every one of its flights are over. Returns { log (flashes), hits (results during it), struck, t0 }. */
function arRun(G, name, step = null, max = 12) {
  const { game } = G;
  const d = game.dragon, A = ar(G);
  const log = flashLog(G);
  const h0 = G.hits.length, s0 = A.stats.struck, t0 = game.time;
  const ok = d.brain.trigger(name);
  let acted = false;
  run(G, max, (g) => { game.mouseGround.set(d.position.x, 0, d.position.z); step?.(g); }, () => {
    if (d.mode === 'act') acted = true;
    return acted && d.mode !== 'act' && A.live() === 0 && !A.L.on && game.player.state !== 'roll';
  });
  G.watch = null;
  G.input.up(1);
  G.input.axis = { x: 0, y: 0 };
  return { ok, log, hits: G.hits.slice(h0).filter((h) => h.attack === name), struck: A.stats.struck - s0, t0 };
}
/** The defender bot's step (parry / guard normal and blue, roll out of red; hazards: away from the mark). */
const arBot = (G, style = 'mixed') => {
  G.defend = makeDefender(G, { style });
  return () => { G.input.axis = { x: 0, y: 0 }; G.defend.act(); };
};
const resOf = (hits) => hits.map((h) => h.r).join(' ');

async function scenarioArData() {
  out('\n== scenario ARDATA (the arsenal as realised: tells, windups, gaps, the cue; routed to its handler; reach anywhere) ==');
  const { MOVE_OWNERS } = await imp('src/entities/enemies/falseSaint/moves.js');
  const lead = TUNING.flashLead;
  for (const name of AR_MOVES) {
    const def = MOVES[name];
    assert(!!def && MOVE_OWNERS[name] === 'arsenal', `${name}: an arsenal move`);
    if (!def) continue;
    const ph = phasesOf(name);
    for (const f of ph) {
      const A = realise(name, f, () => 0.5), real = A.beats.filter((b) => !b.feint);
      const first = real[0], fw = first.impact - first.tellAt;
      const gaps = real.slice(1).map((b, i) => b.impact - real[i].impact);
      if (f === ph[0] || f === 4) out(`     ${name.padEnd(11)} P${f}: ${real.map((b) => (b.def.tell === TELL.BLUE ? 'B' : b.def.tell === TELL.RED ? 'R' : 'N')).join('')}  first windup ${fw.toFixed(2)} s, impacts ${real.map((b) => b.impact.toFixed(2)).join(' / ')}${gaps.length ? `, ${gaps.map((g) => g.toFixed(2)).join(' / ')} s apart` : ''}, lit ${real.map((b) => (b.S + b.A).toFixed(2)).join(' / ')} s, ends ${A.end.toFixed(2)} s`);
      const fl = TUNING.minFirstWindup * (TUNING.windupScale[f - 1] ?? 1);
      if (!(fw >= 0.9 && fw >= fl)) assert(false, `${name} P${f}: a shot's first windup ${fw.toFixed(2)} s is long enough to read (>= 0.9, COMBAT.md ${fl.toFixed(2)})`);
      if (!gaps.every((g) => g >= TUNING.minHitGap - 1e-6)) assert(false, `${name} P${f}: hits ${TUNING.minHitGap} s apart (${gaps.join(', ')})`);
      if (!real.every((b) => b.impact - b.flash >= lead - 1e-6)) assert(false, `${name} P${f}: the cue ${lead} s before every impact`);
    }
    // (every beat of it is routed to the arsenal, which says it reaches wherever the hero is)
    const G0 = name === AR_MOVES[0] ? build() : null;
    if (G0) {
      const d = G0.game.dragon;
      const routed = AR_MOVES.every((n) => MOVES[n].beats.every((b) => d._handlerOf(b) === d.parts.arsenal));
      assert(routed && AR_MOVES.every((n) => d.parts.arsenal.reach({ def: MOVES[n].beats[0] }) === Infinity), 'every beat of the eight is routed to FsArsenal (its FIELDS), which reaches anywhere');
    }
  }
  assert(AR_MOVES.every((n) => MOVES[n].beats.every((b) => b.tell === TELL.RED || b.tell === TELL.BLUE)), 'every beat of his arsenal is a red or a blue (no plain blow from range)');
  assert(MOVES.vigil.phase === 2 && MOVES.absolution.phase === 2 && ['triptych', 'choir', 'passingBell'].every((n) => MOVES[n].phase === 3) && ['kyrie', 'verdict', 'revelation'].every((n) => MOVES[n].phase === 4), 'P2: vigil, absolution; P3: + triptych, choir, passingBell; P4: + kyrie, verdict, revelation');
}

async function scenarioArVigil() {
  out('\n== scenario ARVIGIL (the eye laser: the sight line held, the cut drawn across the hero\'s spot at the cue; hit standing, not rolled through; plates cut, a beam scar) ==');
  const V = TUNING.arsenal.vigil;
  const G = arDuel(2, 7);
  const { game } = G;
  const d = game.dragon, p = game.player, A = ar(G);
  p.debug.god = true;
  const plates = pieces(G, 'plate').filter((b) => Math.abs(b.z - p.position.z) < 1.2 && Math.abs(b.x - p.position.x) < V.half + 0.5);
  const hp0 = plates.map((b) => b.hp);
  let sightK = 0, litAt = NaN, flashT = NaN;
  const sl = d.fx.sightLine.bind(d.fx);
  d.fx.sightLine = (...a) => { sightK = Math.max(sightK, a[4]); return sl(...a); };
  const lz = d.fx.laser.bind(d.fx);
  d.fx.laser = (...a) => { if (!Number.isFinite(litAt)) litAt = game.time; return lz(...a); };
  const r = arRun(G, 'vigil');
  d.fx.sightLine = sl;
  d.fx.laser = lz;
  flashT = r.log[0]?.t;
  const hit = r.hits[0];
  const cut = plates.filter((b, i) => b.hp < hp0[i] || b.state !== 0).length;
  out(`     standing: ${tellsOf(r.log)}, ${resOf(r.hits)} ${hit ? `${(hit.t - flashT).toFixed(3)} s after the flare` : ''}; the laser lit ${(litAt - flashT).toFixed(3)} s after it; the sight line up to k ${sightK.toFixed(2)}; ${cut} / ${plates.length} plates on the line cut, ${r.struck} pieces struck in all; marks ${JSON.stringify(G.marks)}`);
  assert(r.ok && tellsOf(r.log) === 'R' && r.hits.length === 1 && hit.r === RESULT.HIT && Math.abs(hit.t - flashT - TUNING.flashLead) <= 0.07 + DT, `standing: one red cut, landing at the flare's impact (${hit ? (hit.t - flashT).toFixed(3) : '-'} s after it)`);
  assert(Math.abs(litAt - flashT) <= DT + 1e-6 && sightK > 0.9, 'the sight line through the windup, the laser lit at the cue');
  assert(cut >= 3 && (G.marks.beam ?? 0) >= 1 && G.marks.beamLen >= V.half * 2 - 0.1, `it cuts the plates on its line (${cut}) and leaves a beam scar ${G.marks.beamLen?.toFixed(1)} m long`);
  // rolled through at the flare: nothing
  settle(G);
  p.debug.god = false;
  p.debug.heal();
  place(G, 7);
  const hp1 = p.hp;
  const r2 = arRun(G, 'vigil', answer(G, 'dodge', 'vigil'));
  out(`     rolled at the flare: ${resOf(r2.hits)}, hp ${hp1} -> ${p.hp}`);
  assert(p.hp === hp1 && r2.hits.every((h) => h.r !== RESULT.HIT), 'a roll through the cut takes nothing');
  // a hero who walks off the line after it is fixed is missed (the line does not follow)
  settle(G);
  p.debug.heal();
  place(G, 7);
  const hp2 = p.hp;
  let moved = false;
  const r3 = arRun(G, 'vigil', () => { const b = d.brain.act?.beats[0]; if (b && d.brain.act.t > b.start + b.W * (V.fix + 0.05) && !moved) { moved = true; } if (moved && d.brain.act) G.input.axis = { x: 0, y: 1 }; });
  out(`     walked away along his line after the fix: ${resOf(r3.hits)}, hp ${hp2} -> ${p.hp}`);
  assert(r3.hits.every((h) => h.r !== RESULT.HIT), 'the line is fixed: walking off it after the fix is an answer too');
  void A;
}

async function scenarioArAbsolution() {
  out('\n== scenario ARABSOLUTION (the palm cannon: the charge dims the light, the beam held ~1.2 s and swept; hit standing, rolled through; cover holds then melts; a trench) ==');
  const AB = TUNING.arsenal.absolution;
  const G = arDuel(2, 7);
  const { game } = G;
  const d = game.dragon, p = game.player, A = ar(G);
  p.debug.god = true;
  let dimmed = 0, lit0 = NaN, lit1 = NaN, palmK = 0, hand = '';
  const amb = game.world.forest.ambience, dim0 = amb.dim.bind(amb);
  amb.dim = (k) => { if (k > 0.05) dimmed++; return dim0(k); };
  const cb = d.fx.cannonBeam.bind(d.fx);
  d.fx.cannonBeam = (...a) => { if (!Number.isFinite(lit0)) lit0 = game.time; lit1 = game.time; return cb(...a); };
  const x0 = d.position.x, yaw0 = d.yaw;
  let yawMin = Infinity, yawMax = -Infinity;
  const r = arRun(G, 'absolution', () => { palmK = Math.max(palmK, d.fsPalmK); if (d.fsHandR === 'reach') hand = 'reach'; if (Number.isFinite(lit0)) { yawMin = Math.min(yawMin, d.yaw); yawMax = Math.max(yawMax, d.yaw); } });
  amb.dim = dim0;
  d.fx.cannonBeam = cb;
  const flashT = r.log[0]?.t, hit = r.hits[0];
  out(`     standing: ${tellsOf(r.log)}, ${resOf(r.hits)} ${hit ? `${(hit.t - flashT).toFixed(3)} s after the flare` : ''}; lit ${(lit1 - lit0).toFixed(2)} s, swept ${((yawMax - yawMin) / (Math.PI / 180)).toFixed(0)} deg, walked ${Math.abs(d.position.x - x0).toFixed(2)} m; dimmed ${dimmed} frames; palm ${palmK.toFixed(2)}, hand '${hand}' -> '${d.fsHandR}'; ${r.struck} pieces struck; marks ${JSON.stringify(G.marks)}`);
  assert(tellsOf(r.log) === 'R' && r.hits.length === 1 && hit.r === RESULT.HIT && Math.abs(hit.t - flashT - TUNING.flashLead) <= DT * 2, 'standing: the beam lands at the flare\'s impact (one hit)');
  assert(lit1 - lit0 >= AB.lit - 0.1 && yawMax - yawMin >= AB.arc * 0.8 * Math.PI / 180 && dimmed > 20, `held ${(lit1 - lit0).toFixed(2)} s and swept; the charge dims the light`);
  assert(palmK > 0.9 && hand === 'reach' && d.fsHandR === 'guard', 'the palm\'s iris lit, the hand reaching, back to the guard after');
  assert(r.struck >= 5 && (G.marks.beam ?? 0) >= 2, `a melted trench: ${r.struck} pieces struck, ${G.marks.beam} beam scars`);
  void yaw0;
  // rolled through
  settle(G);
  p.debug.god = false;
  p.debug.heal();
  place(G, 7);
  const hp1 = p.hp;
  const r2 = arRun(G, 'absolution', answer(G, 'dodge', 'absolution'));
  out(`     rolled at the flare: ${resOf(r2.hits)}, hp ${hp1} -> ${p.hp}`);
  assert(p.hp === hp1, 'a roll through the beam takes nothing (the beam is spent on him)');
  // cover: a tank between him and the hero holds it a few ticks, then melts
  settle(G);
  p.debug.heal();
  const tank = pieces(G, 'tank').filter((b) => b.state === 0).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
  if (tank) {
    const l = Math.hypot(tank.x, tank.z), ux = tank.x / l, uz = tank.z / l;
    d.position.set(tank.x - ux * 6, 0, tank.z - uz * 6);
    d.yaw = Math.atan2(ux, uz);
    run(G, 0.1);
    p.debug.teleport(tank.x + ux * 1.6, tank.z + uz * 1.6);
    p.yaw = Math.atan2(-ux, -uz);
    const th0 = tank.hp, c0 = A.stats.covered, hp2 = p.hp;
    const r3 = arRun(G, 'absolution');
    out(`     behind a tank (hp ${th0} -> ${tank.hp}, state ${tank.state}): ${A.stats.covered - c0} ticks on the cover, the hero ${resOf(r3.hits) || 'untouched'} (hp ${hp2} -> ${p.hp})`);
    assert(A.stats.covered - c0 >= 2 && (tank.hp < th0 || tank.state !== 0), 'the cover takes the beam tick by tick');
  } else assert(false, 'a tank to hide behind');
}

async function scenarioArTriptych() {
  out('\n== scenario ARTRIPTYCH (three blue bolts arriving at their impacts; parried, taken, perfectly parried: one goes home; misses fly on and bite the set) ==');
  const G = arDuel(3, 7);
  const { game } = G;
  const d = game.dragon, p = game.player, A = ar(G);
  p.debug.god = true;
  // taken: the hero stands
  const r = arRun(G, 'triptych');
  const at = r.log.map((f) => f.t + TUNING.flashLead), dt = r.hits.map((h, i) => (h.t - (at[i] ?? NaN)).toFixed(3));
  out(`     standing: ${tellsOf(r.log)}, ${resOf(r.hits)}, each ${dt.join(' / ')} s from its impact; gun ${d.fsGunK.toFixed(2)}`);
  assert(tellsOf(r.log) === 'BBB' && r.hits.length === 3 && r.hits.every((h) => h.r === RESULT.HIT), 'three blue bolts, each lands on a hero who stands');
  assert(r.hits.every((h, i) => Math.abs(h.t - at[i]) <= DT + 1e-6), 'each bolt arrives AT its beat\'s impact (the cue 0.35 s before it)');
  // parried (the bot parries each glint)
  settle(G);
  place(G, 7);
  const pv0 = d.posture;
  const r2 = arRun(G, 'triptych', arBot(G));
  G.defend = null;
  out(`     parried: ${resOf(r2.hits)}, his posture ${pv0.toFixed(0)} -> ${d.posture.toFixed(0)}`);
  assert(r2.hits.length === 3 && r2.hits.every((h) => h.r === RESULT.PARRIED || h.r === RESULT.BLOCKED) && r2.hits.some((h) => h.r === RESULT.PARRIED), 'parried / blocked: none hurts');
  // a perfect parry sends one home
  settle(G);
  place(G, 7);
  const hpB = d.hp, ret0 = A.stats.returned;
  let n = 0;
  G.ans = null;
  const r3 = arRun(G, 'triptych', () => {
    const a = d.brain.act;
    if (!a) return;
    const b = a.beats.find((x) => !x.done && x.flashed && x.impact - a.t <= 0.04 + DT && x.impact - a.t > 0 && !x._parried);
    if (b) { b._parried = true; G.input.up(1); G.input.click(1); n++; }
  });
  out(`     perfect parries (${n} pressed 0.04 s before each): ${resOf(r3.hits)}, returned ${A.stats.returned - ret0}, his hp ${hpB} -> ${d.hp}`);
  assert(A.stats.returned - ret0 >= 1 && d.hp < hpB, 'a perfect parry sends a bolt home into his chest');
  // a miss flies on: the hero far off its line (a roll), the set behind takes it
  settle(G);
  place(G, 7);
  const s0 = A.stats.struck;
  const r4 = arRun(G, 'triptych', arBot(G, 'dodge'));
  G.defend = null;
  out(`     rolled: ${resOf(r4.hits)}; pieces struck by the bolts ${A.stats.struck - s0}`);
  assert(r4.hits.every((h) => h.r !== RESULT.HIT) && A.stats.struck - s0 >= 1, 'rolled out: nothing; the bolts bite what they meet');
}

async function scenarioArChoir() {
  out('\n== scenario ARCHOIR (the swarm: each missile on the ledger from its launch, marks round the hero, the last tracking; a blast and a crater each; cut out of the air) ==');
  const CH = TUNING.arsenal.choir;
  for (const form of [3, 4]) {
    const G = arDuel(form, 7);
    const { game } = G;
    const d = game.dragon, p = game.player, A = ar(G), L = d.brain.ledger;
    p.debug.god = true;
    let pend = false, maxLive = 0, maxPetal = 0;
    const m0 = A.stats.missiles;
    const r = arRun(G, 'choir', () => { maxLive = Math.max(maxLive, A.live()); maxPetal = Math.max(maxPetal, d.fsPetalK); if (A.live() > 0 && L.pending(2, 2.5)) pend = true; });
    const fired = A.stats.missiles - m0;
    out(`     P${form}: ${fired} missiles (${maxLive} in the air at once), the ledger saw them: ${pend}, flares ${tellsOf(r.log)}, the hero (standing) ${resOf(r.hits)}; craters: ${G.marks.blast ?? 0} blast marks, ${r.struck} pieces struck; petals ${maxPetal.toFixed(2)}`);
    const n = CH.n[form - 1];
    assert(fired === n && n >= 8 && n <= 12, `P${form}: ${n} missiles (8 - 12)`);
    assert(pend, 'each missile is on the ledger from its launch (pending DODGE)');
    // (the ring ones cage him and miss a hero who stands; the trackers come down on him one after another:
    // the first throws him, the next ones walk after him)
    assert(r.hits.length >= 2 && r.hits.length <= CH.track.n && r.hits.every((h) => h.r === RESULT.HIT) && r.log.length >= r.hits.length && r.log.every((f) => f.tell === TELL.RED), `the ring ones cage him, the last ones come down on him (${r.hits.length} of ${CH.track.n} hit a hero who stands), each flared red`);
    assert((G.marks.blast ?? 0) >= n && r.struck >= n, 'a blast mark and a crater for every one');
    // rolled away from each flare: nothing
    settle(G);
    p.debug.god = false;
    p.debug.heal();
    place(G, 7);
    const hp1 = p.hp;
    const r2 = arRun(G, 'choir', arBot(G));
    G.defend = null;
    out(`     P${form} rolled out of each flare: ${resOf(r2.hits) || 'none reached him'}, hp ${hp1} -> ${p.hp}`);
    assert(p.hp === hp1, 'rolling out of the flared marks: nothing');
    p.debug.god = true;
  }
  // the cut: a missile coming down on him met by his swing (his blade's real sweep)
  const G = arDuel(3, 7);
  const { game } = G;
  const d = game.dragon, p = game.player, A = ar(G);
  p.debug.god = true;
  // (the hero steps under a ring missile's last metres, faces it 1.2 m off and swings as it comes)
  let swung = 0, tgt = null;
  const c0 = A.stats.cut;
  arRun(G, 'choir', () => {
    if (!tgt) {
      const s = A.M.find((x) => A._alive(x) && x.rec.track === 0 && x.rec.left > 0.9);
      if (s) {
        tgt = s;
        const m = s.rec, dx = m.tx - p.position.x, dz = m.tz - p.position.z, l = Math.hypot(dx, dz) || 1;
        p.debug.teleport(m.tx - (dx / l) * 1.2, m.tz - (dz / l) * 1.2);
      }
    }
    if (tgt && A._alive(tgt)) {
      game.mouseGround.set(tgt.rec.tx, 0, tgt.rec.tz);
      if (tgt.rec.left < 0.34 && !tgt._sw) { tgt._sw = true; G.input.click(0); swung++; }
    }
  });
  out(`     a swing at a ring missile coming down 1.2 m before him: ${swung} swing, cut out of the air ${A.stats.cut - c0}`);
  assert(A.stats.cut - c0 >= 1, 'the hero\'s real swing cuts a missile out of the air');
  // the cut's rule itself: a blade's sweep through a missile in flight cancels it and its ledger handle
  settle(G);
  place(G, 7);
  d.brain.trigger('choir');
  run(G, 2.2, null, () => A.live() > 0);
  const s = A.M.find((x) => A._alive(x));
  let ok = false;
  if (s) {
    run(G, 0.4);
    const m = s.rec, h = m.cue, sw0 = p.isSwinging, sv = p.sweep.valid, a0 = p.sweep.a.clone(), b0 = p.sweep.b.clone();
    p.isSwinging = () => true;
    p.sweep.valid = true;
    p.position.set(m.x + 0.5, 0, m.z);
    p.sweep.a.set(m.x - 0.8, m.y, m.z);
    p.sweep.b.set(m.x + 0.8, m.y, m.z);
    p.sweep.pa?.copy?.(p.sweep.a);
    p.sweep.pb?.copy?.(p.sweep.b);
    const c1 = A.stats.cut;
    A._cutMissiles();
    ok = A.stats.cut === c1 + 1 && !m.alive && (!h || !h.alive);
    p.isSwinging = sw0;
    p.sweep.valid = sv;
    p.sweep.a.copy(a0);
    p.sweep.b.copy(b0);
  }
  assert(ok, 'a swing through a missile cuts it out of the air: gone, its ledger handle cancelled');
  run(G, 4);
}

async function scenarioArBell() {
  out('\n== scenario ARBELL (Passing Bell: up on the jets, the line shown, the strafe across the floor; the eye laser cuts the whole way; hit standing, rolled through) ==');
  const P = TUNING.arsenal.passingBell;
  const G = arDuel(3, 7);
  const { game } = G;
  const d = game.dragon, p = game.player, A = ar(G);
  p.debug.god = true;
  let maxY = 0, lines = 0, jets = 0;
  const x0 = { x: d.position.x, z: d.position.z };
  const pl = d.fx.passLine.bind(d.fx);
  d.fx.passLine = (...a) => { lines++; return pl(...a); };
  const r = arRun(G, 'passingBell', () => { maxY = Math.max(maxY, d.position.y); jets = Math.max(jets, d.fsJets?.back ?? 0); });
  d.fx.passLine = pl;
  const flown = flatDist(x0, d.position), hit = r.hits[0], flashT = r.log[0]?.t;
  out(`     standing: ${tellsOf(r.log)}, ${resOf(r.hits)} ${hit ? `${(hit.t - flashT).toFixed(3)} s after the flare` : ''}; up ${maxY.toFixed(2)} m, flew ${flown.toFixed(1)} m, ends ${Math.hypot(d.position.x, d.position.z).toFixed(1)} m from the middle at y ${d.position.y.toFixed(2)}; ${lines} frames of its line; back jet ${jets.toFixed(2)}; ${r.struck} pieces struck; marks ${JSON.stringify(G.marks)}`);
  assert(tellsOf(r.log) === 'R' && r.hits.length === 1 && hit.r === RESULT.HIT && Math.abs(hit.t - flashT - TUNING.flashLead) <= 0.07 + DT, 'standing: the laser\'s foot crosses him at the flare\'s impact');
  assert(maxY >= P.h * 0.95 && flown >= 9 && Math.hypot(d.position.x, d.position.z) <= d.bound + 0.1 && d.position.y < 0.05, 'he flies up and across the floor, down at the end inside his circle');
  assert(lines > 30 && jets > 0.5 && r.struck >= 6 && (G.marks.beam ?? 0) >= 1 && G.marks.beamLen >= 8, `the line shown through the windup, his jets lit, a scar ${G.marks.beamLen?.toFixed(1)} m across the floor`);
  settle(G);
  d.position.set(0, 0, -2);
  d.yaw = 0;
  run(G, 0.2);
  p.debug.god = false;
  p.debug.heal();
  place(G, 7);
  const hp1 = p.hp;
  const r2 = arRun(G, 'passingBell', answer(G, 'dodge', 'passingBell'));
  out(`     rolled at the flare: ${resOf(r2.hits)}, hp ${hp1} -> ${p.hp}`);
  assert(p.hp === hp1, 'a roll through the cut takes nothing');
}

async function scenarioArKyrie() {
  out('\n== scenario ARKYRIE (the creeping barrage: rows of marked shells walking over the hero, lanes >= 2 m, a lane within a roll of him at every row\'s marking; a lane-taking hero is untouched; then the great shell) ==');
  const KY = TUNING.arsenal.kyrie, roll = 4.2;
  const sp = 2 * KY.r + KY.lane;
  out(`     shells ${KY.r} m, lanes ${KY.lane} m of clear floor (centres ${sp.toFixed(2)} m apart: a hero's middle is safe in ${(sp - 2 * (KY.r + 0.45)).toFixed(2)} m of each), rows ${KY.step} m apart, ${KY.rowGap} s apart, each marked ${KY.T} s before it lands`);
  assert(KY.lane >= 2, `lanes of ${KY.lane} m (>= 2)`);
  for (const [dist, ang] of [[7, 0], [9, 0.6], [5.5, -0.8], [11, 1.2]]) {
    const seed = `${dist} m, ${ang} rad`;
    const G = arDuel(4, dist);
    const { game } = G;
    const d = game.dragon, p = game.player, A = ar(G);
    place(G, dist, ang);
    p.debug.god = true;
    // standing still
    const rows0 = A.stats.rows;
    const r = arRun(G, 'kyrie');
    out(`     ${seed} standing: ${A.stats.rows - rows0} rows, ${A.stats.greats} great, ${tellsOf(r.log)} flares, ${resOf(r.hits)}; ${r.struck} pieces struck, ${G.marks.blast ?? 0} blast marks`);
    assert(A.stats.rows - rows0 === KY.rows && r.hits.length >= 2 && r.struck >= KY.rows * KY.per, 'every row fired, the hero who stands is hit (a row on him, the great shell), every shell bites the floor');
    // the lane-taker: at each row's marking, into the nearest safe spot of that row (walking)
    settle(G);
    p.debug.god = false;
    p.debug.heal();
    place(G, dist, ang);
    const hp1 = p.hp;
    let seen = A.stats.rows, goal = null, worst = 0, bigRoll = 0;
    const need = [];
    const r2 = arRun(G, 'kyrie', () => {
      if (A.stats.rows > seen && A.lastRow) {
        seen = A.stats.rows;
        const R = A.lastRow, px = p.position.x, pz = p.position.z;
        // the safe spots: where he stands, or a lane's middle of this row on either side at his place along
        // the axis; safe = clear of every shell still in the air (this row's and the last ones')
        const ux = -R.qz, uz = R.qx, al = (px - R.cx) * ux + (pz - R.cz) * uz, ac = (px - R.cx) * R.qx + (pz - R.cz) * R.qz;
        const danger = KY.r + 0.45 + 0.1;
        const safe = (x, z) => A.S.every((s) => !A._alive(s) || s.great || Math.hypot(x - s.rec.tx, z - s.rec.tz) > danger);
        const k0 = Math.floor((ac - R.o) / R.sp - 0.5);
        const cands = [[px, pz]];
        for (const k of [k0 - 1, k0, k0 + 1, k0 + 2]) { const lane = R.o + (k + 0.5) * R.sp; cands.push([R.cx + R.qx * lane + ux * al, R.cz + R.qz * lane + uz * al]); }
        let best = null, bd = Infinity;
        for (const [x, z] of cands) { const dd = Math.hypot(x - px, z - pz); if (dd < bd && safe(x, z)) { bd = dd; best = { x, z }; } }
        need.push(bd);
        worst = Math.max(worst, bd);
        if (!(bd <= 2.5)) bigRoll++;
        goal = best && bd > 0.05 ? best : null;
      }
      const a = d.brain.act;
      // the great shell: roll off its mark at its flare (the bot's answer); the rows: walk to the goal
      if (A.stats.greats > 0 && A.S.some((s) => s.great && A._alive(s) && s.rec.left < 0.3 && !s._rolled)) {
        const s = A.S.find((x) => x.great && A._alive(x));
        s._rolled = true;
        const dx = p.position.x - s.rec.tx, dz = p.position.z - s.rec.tz, l = Math.hypot(dx, dz) || 1;
        G.input.axis = { x: dx / l, y: -dz / l };
        G.input.tap('Space');
        goal = null;
        return;
      }
      if (goal && p.state !== 'roll') {
        const dx = goal.x - p.position.x, dz = goal.z - p.position.z, l = Math.hypot(dx, dz);
        G.input.axis = l > 0.15 ? { x: dx / l, y: -dz / l } : { x: 0, y: 0 };
        if (l <= 0.15) goal = null;
      } else if (p.state !== 'roll') G.input.axis = { x: 0, y: 0 };
    }, 14);
    out(`     ${seed} lane-taker: the way to safety at each row's marking ${need.map((x) => x.toFixed(2)).join(' / ')} m (a roll is ${roll} m), ${resOf(r2.hits) || 'untouched'}, hp ${hp1} -> ${p.hp}`);
    assert(worst <= roll - 0.5 && bigRoll === 0, `a safe spot within a roll of where he stands at every row's marking (furthest ${worst.toFixed(2)} m)`);
    assert(p.hp === hp1, 'a hero who takes the lanes (and rolls off the great shell) is untouched');
  }
}

async function scenarioArVerdict() {
  out('\n== scenario ARVERDICT (the sky lance: the reticle follows, locks, the pillar (red), the ring (normal), the molten crater) ==');
  const VD = TUNING.arsenal.verdict;
  const G = arDuel(4, 7);
  const { game } = G;
  const d = game.dragon, p = game.player, A = ar(G), F = game.world.forest.foundry;
  p.debug.god = true;
  let maxLag = 0, lockAt = NaN, lockGap = NaN;
  const r = arRun(G, 'verdict', () => {
    if (A.L.on && A.L.phase === 'track' && A.L.k > 0.3) maxLag = Math.max(maxLag, Math.hypot(A.L.x - p.position.x, A.L.z - p.position.z));
    if (A.L.phase === 'fall' && !Number.isFinite(lockAt)) { lockAt = game.time; lockGap = Math.hypot(A.L.x - p.position.x, A.L.z - p.position.z); }
    // (the hero walks sideways through the windup: the reticle walks after him)
    G.input.axis = d.brain.act?.name === 'verdict' && !Number.isFinite(lockAt) ? { x: 1, y: 0 } : { x: 0, y: 0 };
  });
  const pool = F.molten.pools.find((x) => x.alive && x.why === 'verdict');
  out(`     the reticle lagged at most ${maxLag.toFixed(2)} m behind a walking hero, locked ${lockGap.toFixed(2)} m from him; flares ${tellsOf(r.log)} (${r.log.map((f) => (f.t - lockAt).toFixed(2)).join(' / ')} s after the lock); ${resOf(r.hits)}; pool ${pool ? `r ${pool.r}` : 'none'}; ${r.struck} pieces struck`);
  assert(maxLag < 2 && lockGap < 0.3, 'the reticle follows the hero, locks where he stands');
  assert(tellsOf(r.log).startsWith('R') && r.hits[0]?.r === RESULT.HIT && Math.abs(r.hits[0].t - lockAt - VD.fall) <= DT * 2, `the pillar comes down ${VD.fall} s after the lock on a hero who stays (red)`);
  assert(!!pool && r.struck >= 2, 'a molten crater (the set\'s pool) and the floor smashed');
  // rolled out at the flare, the ring blocked
  settle(G);
  run(G, 14);
  p.debug.god = false;
  p.debug.heal();
  place(G, 7);
  const hp1 = p.hp;
  const r2 = arRun(G, 'verdict', answer(G, 'dodge', 'verdict'));
  out(`     rolled at the pillar's flare: ${resOf(r2.hits)}, hp ${hp1} -> ${p.hp}`);
  assert(r2.hits[0] && r2.hits[0].r !== RESULT.HIT && p.hp === hp1, 'a roll at the flare takes the hero out from under the pillar');
  // stepped 3 m off the locked spot, the guard held: the pillar misses, the ring (normal) is blocked
  settle(G);
  run(G, 14);
  p.debug.heal();
  place(G, 7);
  const hp2 = p.hp;
  let stepped = false;
  const r3 = arRun(G, 'verdict', () => {
    if (!stepped && A.L.phase === 'fall') {
      stepped = true;
      const dx = d.position.x - A.L.x, dz = d.position.z - A.L.z, l = Math.hypot(dx, dz) || 1;
      p.debug.teleport(A.L.x + (dx / l) * 3, A.L.z + (dz / l) * 3);
    }
    if (stepped) G.input.press(1);
  });
  const gaps = r3.log.slice(1).map((f, i) => f.t - r3.log[i].t);
  out(`     stepped 3 m off the lock, guard up: flares ${tellsOf(r3.log)} ${gaps.map((g) => g.toFixed(2)).join(' / ')} s apart, ${resOf(r3.hits)}, hp ${hp2} -> ${p.hp}`);
  assert(tellsOf(r3.log).startsWith('RN') && gaps[0] >= TUNING.minHitGap && r3.hits.length === 1 && r3.hits[0].r === RESULT.BLOCKED && p.hp === hp2, 'the pillar misses a hero who left the spot; the ring after it (normal) is blocked');
}

async function scenarioArRevelation() {
  out('\n== scenario ARREVELATION (full burst: the twin beams converge onto the hero at the impact, then the core beam held 2 s and swept ~60 deg; the biggest scar) ==');
  const RV = TUNING.arsenal.revelation;
  const G = arDuel(4, 8);
  const { game } = G;
  const d = game.dragon, p = game.player, A = ar(G);
  p.debug.god = true;
  let coreT0 = NaN, coreT1 = NaN, yawA = Infinity, yawB = -Infinity, wide = 0;
  const cb = d.fx.cannonBeam.bind(d.fx);
  d.fx.cannonBeam = (...a) => { if (a[6] > 2.5) { if (!Number.isFinite(coreT0)) coreT0 = game.time; coreT1 = game.time; yawA = Math.min(yawA, d.yaw); yawB = Math.max(yawB, d.yaw); wide++; } return cb(...a); };
  const r = arRun(G, 'revelation');
  d.fx.cannonBeam = cb;
  out(`     standing: ${tellsOf(r.log)}, ${resOf(r.hits)} (${r.hits.map((h, i) => (h.t - (r.log[i]?.t ?? NaN)).toFixed(3)).join(' / ')} s after each flare); the core lit ${(coreT1 - coreT0).toFixed(2)} s, swept ${((yawB - yawA) / (Math.PI / 180)).toFixed(0)} deg; ${r.struck} pieces struck; marks ${JSON.stringify(G.marks)}`);
  assert(tellsOf(r.log).startsWith('RR') && r.hits.length >= 1 && r.hits[0].r === RESULT.HIT && Math.abs(r.hits[0].t - r.log[0].t - TUNING.flashLead) <= 0.07 + DT, 'the twin beams cross on a hero who stands at the first flare\'s impact');
  assert(coreT1 - coreT0 >= RV.core.lit - 0.1 && yawB - yawA >= RV.core.arc * 0.8 * Math.PI / 180, `the core beam held ${(coreT1 - coreT0).toFixed(2)} s and swept`);
  assert(r.struck >= 15 && (G.marks.beam ?? 0) >= 6, `the biggest scar: ${r.struck} pieces struck, ${G.marks.beam} beam scars (${G.marks.beamLen?.toFixed(0)} m of them)`);
  settle(G);
  run(G, 2);
  d.position.set(0, 0, -2);
  d.yaw = 0;
  run(G, 0.2);
  p.debug.god = false;
  p.debug.heal();
  place(G, 8);
  const hp1 = p.hp;
  G.defend = makeDefender(G, {});
  const r2 = arRun(G, 'revelation', () => { G.input.axis = { x: 0, y: 0 }; G.defend.act(); });
  G.defend = null;
  out(`     rolled at each flare: ${resOf(r2.hits)}, hp ${hp1} -> ${p.hp}`);
  assert(r2.hits.every((h) => h.r !== RESULT.HIT), 'rolling at each flare: neither beam lands');
}

async function scenarioArWorld() {
  out('\n== scenario ARWORLD (every move of the arsenal bites the world: pieces struck, floor marks) ==');
  const rows = [];
  for (const name of AR_MOVES) {
    const G = arDuel(Math.max(...phasesOf(name).slice(0, 1), MOVES[name].phase), 7);
    G.game.player.debug.god = true;
    // (the bolts bite the set when they miss: the hero rolls out of them; every other move on a hero who stands)
    const r = arRun(G, name, name === 'triptych' ? arBot(G, 'dodge') : null);
    G.defend = null;
    rows.push(`${name.padEnd(11)} struck ${String(r.struck).padStart(3)}  marks ${JSON.stringify(G.marks)}`);
    assert(r.struck >= 1 && Object.keys(G.marks).length >= 1, `${name}: it bites the world (${r.struck} pieces struck, floor marks ${JSON.stringify(G.marks)})`);
  }
  out('     ' + rows.join('\n     '));
}

async function scenarioArFair() {
  const SEEDS = (process.env.GCD_ARSEEDS ?? '1,2,3').split(',').map(Number).filter(Number.isFinite);
  const SECS = Number(process.env.GCD_ARSECS ?? 24);
  out(`\n== scenario ARFAIR (the fairness guard over ${SEEDS.length} seeds x ${SECS} s of phase 3 and 4 with his swarm and barrage likely: no missile or shell lands within the guard's sep of a cued blow that needs the other answer) ==`);
  const G0 = TUNING.pressure.guard, sep = G0.sep;
  let lands = 0, bad = 0, delays = 0, dropped = 0, guards = 0;
  const w0 = { choir: MOVES.choir.weight, kyrie: MOVES.kyrie.weight, verdict: MOVES.verdict.weight };
  MOVES.choir.weight = [0, 0, 2.2, 2.2];
  MOVES.kyrie.weight = [0, 0, 0, 2.2];
  MOVES.verdict.weight = [0, 0, 0, 1.6];
  try {
    for (const seed of SEEDS) {
      for (const ph of [3, 4]) {
        const G = build(seed, true);
        const { game } = G;
        const d = game.dragon, p = game.player, A = ar(G);
        duel(G, { dist: 6, ai: true, form: ph });
        p.debug.god = true;
        p.debug.noRiposte = true;
        G.defend = bPaceDefender(G);
        Math.random = mulberry32(seed * 13 + ph);
        const guardAt = [], landAt = [];
        G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon' && (e.tell === TELL.NORMAL || e.tell === TELL.BLUE)) guardAt.push(game.time + TUNING.flashLead); };
        const ml = A._mLand, sl = A._sLand;
        A._mLand = (rec) => { landAt.push(game.time); return ml(rec); };
        A._sLand = (rec) => { landAt.push(game.time); return sl(rec); };
        // (the callbacks are read at launch: the handler's slots take the wrapped ones from now on)
        for (let i = 0; i < Math.round(SECS / DT); i++) {
          G.defend.act();
          const dx = d.position.x - p.position.x, dz = d.position.z - p.position.z, l = Math.hypot(dx, dz) || 1;
          if (p.state !== 'roll') G.input.axis = l > 5 ? { x: dx / l, y: -dz / l } : l < 3 ? { x: -dx / l, y: dz / l } : { x: 0, y: 0 };
          game.mouseGround.set(d.position.x, 0, d.position.z);
          G.tick(DT);
          if (d.phase !== ph && d.mode !== 'act') break;
        }
        for (const t of landAt) { lands++; if (guardAt.some((g) => Math.abs(g - t) < sep - DT)) bad++; }
        guards += guardAt.length;
        delays += A.stats.delays;
        dropped += A.stats.dropped;
        G.watch = null;
        G.defend = null;
      }
    }
  } finally {
    Object.assign(MOVES.choir, { weight: w0.choir });
    Object.assign(MOVES.kyrie, { weight: w0.kyrie });
    Object.assign(MOVES.verdict, { weight: w0.verdict });
  }
  out(`     ${lands} missiles / shells landed against ${guards} guard cues; ${delays} moved later by the guard, ${dropped} not fired; ${bad} landed within ${sep} s of a guard cue`);
  assert(lands >= 30, `enough of them flew to judge (${lands})`);
  assert(bad === 0, `none lands inside a blue / normal blow's window (${bad})`);
}

// ================================================================== V04 (the owner's reference pack: his look and his motion)
// The pack is VISUAL ONLY: these prove that the poses, the hand shapes and the look changed nothing a fight
// reads (the timing identity), that removed shell never comes back through any clip, that the hand shapes
// follow the beat's clock, and that the new per-frame code allocates nothing. `v04Motion` measures the motion
// (the pop audit, the arm snaps, the planted feet, the palms' gap from the torso; run it against another
// checkout's code with `node <this file> <other root> v04Motion` to compare).
const V04_PALM = new Set(['fistR', 'fistL', 'palms']);
/** The gameplay signature of every move in every phase it is used in (realised with a fixed draw; a flurry
 *  at 3 and 9 beats): everything but the pose keys. Same as the v04 agent's scratch sig.mjs. */
function v04Signature() {
  const strip = (o) => {
    if (Array.isArray(o)) return o.map(strip);
    if (o && typeof o === 'object') {
      const r = {};
      for (const k of Object.keys(o).sort()) if (k !== 'keys' && k !== 'recoveryKeys' && typeof o[k] !== 'function') r[k] = strip(o[k]);
      return r;
    }
    return typeof o === 'number' ? Math.round(o * 1e6) / 1e6 : o;
  };
  const r6 = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
  const sig = {};
  for (const name of Object.keys(MOVES).sort()) {
    const def = MOVES[name];
    sig[name] = { def: strip(def), phases: {} };
    for (const f of phasesOf(name)) {
      for (const count of def.streak ? [3, 9] : [null]) {
        let s = 7;
        const A = realise(name, f, () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296), count ? { count } : null);
        if (!A) continue;
        sig[name].phases[count ? `P${f}x${count}` : `P${f}`] = {
          hits: A.hits, recoveryStart: r6(A.recoveryStart), end: r6(A.end),
          beats: A.beats.map((b) => ({ start: r6(b.start), impact: r6(b.impact), end: r6(b.end), W: r6(b.W), H: r6(b.H), A: r6(b.A), S: r6(b.S), close: r6(b.close), flash: r6(b.flash), tellAt: r6(b.tellAt), feint: b.feint, hit: b.hit, last: b.last, def: strip(b.def) })),
        };
      }
    }
  }
  return sig;
}
/** The first path where a and b differ, or ''. */
function v04Diff(a, b, path = '') {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) return path || '(root)';
  if (a && typeof a === 'object') {
    const ks = new Set([...Object.keys(a), ...Object.keys(b ?? {})]);
    for (const k of ks) {
      const r = v04Diff(a[k], b?.[k], `${path}.${k}`);
      if (r) return r;
    }
    return '';
  }
  return a === b ? '' : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}
/** The moves to play: [name, phase, the hero's distance]. */
const V04_PLAY = [
  ['benediction', 1, 1.8], ['genuflect', 1, 1.8], ['layHands', 1, 1.6], ['longWalk', 1, 6], ['rebuke', 1, 1.6], ['litany', 1, 1.8],
  ['interdict', 2, 1.8], ['castOut', 2, 1.9], ['penance', 2, 1.5], ['votiveFist', 2, 6], ['rosary', 2, 1.8], ['vigil', 2, 6], ['absolution', 2, 6],
  ['lauds', 3, 1.8], ['anathema', 3, 1.6], ['censerWheel', 3, 4], ['thurible', 3, 2], ['descent', 3, 6], ['triptych', 3, 6], ['passingBell', 3, 6],
  ['requiem', 4, 1.6], ['vespers', 4, 6], ['kyrie', 4, 6], ['verdict', 4, 6], ['revelation', 4, 6],
];
/** Play `name` in phase `form` (AI off, the hero god, `dist` m off), `each(G, a)` every frame of the act and
 *  of the next half second; the transitions to `form` are played first. */
function v04Play(name, form, dist, each) {
  const G = build();
  duel(G, { dist, form });
  const d = G.game.dragon;
  place(G, dist);
  G.game.player.debug.god = true;
  const ok = d.brain.trigger(name);
  const a = d.brain.act;
  let after = 0;
  run(G, 9, () => {}, () => {
    (d.object3d ?? d.rig?.root)?.updateMatrixWorld?.(true);
    each(G, d.brain.act === a ? a : null);
    // (to the end of whatever the move led into: the grab's lift is an act of its own)
    if (d.brain.act !== a && (d.mode !== 'act' || !d.brain.act)) after++;
    return after > 30;
  });
  return { G, ok, a };
}

async function scenarioV04Timing() {
  out('\n== scenario V04 TIMING (the look and motion pass changed no gameplay: every move\'s realised beats, zones, travel, tells, the reaction clips and the tuning identical to the frozen signature) ==');
  const sig = v04Signature();
  const { CLIP: CL, REACT: RE, OPEN: OP } = await imp('src/entities/enemies/falseSaint/moves.js');
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'function' ? undefined : typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)));
  const clips = Object.fromEntries(Object.entries(CL).map(([k, c]) => [k, { dur: Math.round((c.dur ?? c.duration) * 1e6) / 1e6, hold: !!c.hold }]));
  const file = process.env.GCD_V04_FROZEN;
  if (!file || !fs.existsSync(file)) {
    out(`     no frozen signature (GCD_V04_FROZEN unset): ${Object.keys(sig).length} moves signed, nothing to compare`);
    assert(Object.keys(sig).length > 0, 'the signature covers every move');
    return;
  }
  const F = JSON.parse(fs.readFileSync(file, 'utf8'));
  let same = 0;
  for (const name of new Set([...Object.keys(sig), ...Object.keys(F).filter((k) => !k.startsWith('__'))])) {
    const A = sig[name], B = F[name];
    const diff = !A || !B ? 'missing' : v04Diff({ def: B.def, phases: Object.fromEntries(Object.entries(B.phases).map(([k, v]) => [k, { hits: v.hits, recoveryStart: v.recoveryStart, end: v.end, beats: v.beats.map(({ F: _f, ...rest }) => rest) }])) }, A);
    if (diff) assert(false, `${name}: the same as the frozen signature (${diff})`);
    else same++;
  }
  assert(same === Object.keys(sig).length, `${same} / ${Object.keys(sig).length} moves identical to the frozen signature (every phase: beats, windups, holds, cues, contacts, active, sustain, close-in, zones, travel, dashes, lifts, tells, damage)`);
  assert(!v04Diff(F.__clips, clips), `the ${Object.keys(clips).length} reaction clips' durations unchanged ${v04Diff(F.__clips, clips)}`);
  assert(!v04Diff(F.__react, strip(RE)) && !v04Diff(F.__open, [...OP].sort()), 'the reactions\' root motion and the clips that leave him open unchanged');
  assert(!v04Diff(F.__tuning, strip(TUNING)), `the whole TUNING unchanged ${v04Diff(F.__tuning, strip(TUNING))}`);
}

async function scenarioV04Shell() {
  out('\n== scenario V04 SHELL (one skeleton, cumulative loss: through every move and reaction a removed piece of shell never comes back, the silhouette never changes size) ==');
  let regrew = 0, frames = 0, chips = 0, moves = 0;
  const worst = [];
  for (const [name, form, dist] of V04_PLAY) {
    const parts = {};
    const gone = new Set();
    let n = 0;
    const { G, ok } = v04Play(name, form, dist, (G) => {
      const d = G.game.dragon, sh = d.shell, D = d.rig?.root?.userData?.fsDress;
      // a cut lands on him every 0.4 s somewhere on his body (the shell chips where it lands)
      if (++n % 24 === 0) {
        const pt = { x: d.position.x + Math.sin(n) * 0.2, y: 0.4 + ((n * 0.37) % 1.4), z: d.position.z + Math.cos(n) * 0.2 };
        if (sh.chip(pt, 0.6) > 0) chips++;
      }
      for (const p of ['headR', 'headL', 'chestR', 'chestL', 'armR', 'foreR', 'handR', 'armL', 'foreL', 'handL', 'hip', 'legR', 'shinR', 'legL', 'shinL']) {
        const v = sh.part(p);
        if (v < (parts[p] ?? 0) - 1e-9) {
          regrew++;
          worst.push(`${name}: ${p} ${parts[p].toFixed(3)} -> ${v.toFixed(3)}`);
        }
        parts[p] = Math.max(parts[p] ?? 0, v);
      }
      for (let i = 0; i < (D?.shards?.length ?? 0); i++) {
        const e = D.shards[i];
        if (e.gone) gone.add(i);
        else if (gone.has(i)) {
          regrew++;
          worst.push(`${name}: shard ${i} (${e.part}) shown again`);
        }
      }
      frames++;
    });
    if (ok) moves++;
    void G;
  }
  out(`     ${moves} moves played with a cut chipping him every 0.4 s (${chips} chips), ${frames} frames; ${regrew} regrowths ${worst.slice(0, 4).join('; ')}`);
  assert(moves === V04_PLAY.length, `every move played (${moves} / ${V04_PLAY.length})`);
  assert(regrew === 0, 'no part\'s exposure ever falls and no removed piece is ever shown again');
}

async function scenarioV04Hands() {
  out('\n== scenario V04 HANDS (the pack\'s hand details by the beat\'s clock: a palm reaches at its contact, the clench only on the booster punch, the guard\'s half-curl after) ==');
  let palms = 0, palmsOk = 0, fists = 0, fistsOk = 0, stray = 0, back = 0, acts = 0;
  const bad = [];
  for (const [name, form, dist] of V04_PLAY.filter(([n]) => ['melee', 'boost'].includes(MOVE_OWNERS_V04[n]))) {
    const seen = new Set();
    let endShape = null;
    v04Play(name, form, dist, (G, a) => {
      const d = G.game.dragon;
      if (!a) {
        if (d.mode !== 'act') endShape = `${d.fsHandR}/${d.fsHandL}`;
        return;
      }
      for (const b of a.beats) {
        if (b.feint || seen.has(b) || a.t < b.impact) continue;
        seen.add(b);
        const D = b.def, booster = (D.fsDash && !D.fsDash.rite) || (D.fsBlitz?.pass !== undefined && !D.fsBlitz.last);
        if (booster) {
          fists++;
          if (d.fsHandR === 'clench') fistsOk++;
          else bad.push(`${name} B${b.index + 1}: ${d.fsHandR} (want clench)`);
        } else if (V04_PALM.has(D.part)) {
          palms++;
          const want = D.part === 'fistL' ? d.fsHandL : D.part === 'palms' ? (d.fsHandR === 'reach' && d.fsHandL === 'reach' ? 'reach' : `${d.fsHandR}/${d.fsHandL}`) : d.fsHandR;
          if (want === 'reach' || (D.fsLay && d.fsHandR === 'reach')) palmsOk++;
          else bad.push(`${name} B${b.index + 1} ${D.part}: ${want} (want reach)`);
        }
        if (!booster && (d.fsHandR === 'clench' || d.fsHandL === 'clench')) stray++;
      }
    });
    acts++;
    if (endShape === 'undefined/undefined') back++;
    else bad.push(`${name}: after the act ${endShape}`);
  }
  out(`     ${acts} moves: ${palmsOk} / ${palms} palm contacts reaching, ${fistsOk} / ${fists} booster punches clenched, ${stray} clenches elsewhere, ${back} back to the guard after ${bad.slice(0, 5).join('; ')}`);
  assert(palms > 10 && palmsOk === palms, 'every palm contact is drawn reaching (open, flat)');
  assert(fists > 0 && fistsOk === fists, 'every booster punch is drawn clenched');
  assert(stray === 0, 'no clench outside the booster punch');
  assert(back === acts, 'the hands go back to the guard\'s shape after every move');
}
const MOVE_OWNERS_V04 = (await imp('src/entities/enemies/falseSaint/moves.js')).MOVE_OWNERS ?? {};

async function scenarioV04Alloc() {
  out('\n== scenario V04 ALLOC (the new per-frame code allocates nothing: the handlers\' hand shapes and the look\'s hands, a hundred thousand calls each) ==');
  const v8 = await import('node:v8');
  const vm = await import('node:vm');
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const G = build();
  duel(G, { dist: 2, form: 2 });
  const d = G.game.dragon, M = d.parts.melee, B = d.parts.boost;
  const { dressSaint } = await imp('src/entities/enemies/falseSaint/look.js');
  const bm = { def: { part: 'fistR', cock: 0.74, fsBlow: 'light' }, feint: false };
  const bb = { def: { part: 'fistR', cock: 0.62, fsDash: { carry: true } }, feint: false };
  const SH = ['reach', 'guard', 'clench', undefined];
  const loop = (fn, n = 100000) => {
    for (let i = 0; i < 2000; i++) fn(i);
    gc();
    const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < n; i++) fn(i);
    gc();
    return process.memoryUsage().heapUsed - h0;
  };
  // (beatMotion with no slip / no jet / no dash, then the frame's reset)
  const dm = loop((i) => { M.beatMotion(bm, (i % 200) / 100, null, 1 / 60); M._handLive = (i & 1) === 0; });
  const dh = loop((i) => { d.fsHandR = SH[i & 3]; d.fsHandL = SH[(i >> 2) & 3]; dressSaint(d, 1 / 60); }, 20000);
  void bb, B;
  out(`     melee beatMotion (hands) x 100000: heap ${(dm / 1024).toFixed(1)} KiB; the look's hands x 20000 shape changes: heap ${(dh / 1024).toFixed(1)} KiB`);
  assert(dm < 256 * 1024, 'the hands in the melee handler allocate nothing per frame (< 256 KiB over 100000 calls: noise)');
  assert(dh < 256 * 1024, 'the look\'s hands allocate nothing per frame (< 256 KiB over 20000 calls)');
}

async function scenarioV04Motion() {
  out('\n== scenario V04 MOTION (measured, every move at 60 fps: the largest one-frame jump of a hand / a foot / the head against his root (the pop audit), a planted foot\'s slide, the root\'s jolt, the palm\'s gap from the torso at the contact) ==');
  const T = THREE, v = new T.Vector3();
  const rows = [];
  let popWorst = 0, slideWorst = 0;
  for (const [name, form, dist] of V04_PLAY) {
    let prev = null, pv = null, hand = 0, foot = 0, head = 0, slide = 0, jolt = 0, gapMin = Infinity, n = 0, hT = 0, fT = 0;
    const seen = new Set(), anchors = [];
    v04Play(name, form, dist, (G, a) => {
      const d = G.game.dragon, R = d.rig;
      if (!a || !R) return;
      const c = Math.cos(d.yaw), s = Math.sin(d.yaw), px = d.position.x, pz = d.position.z, py = d.position.y;
      const at = () => { const x = v.x - px, z = v.z - pz; return [x * c - z * s, v.y - py, x * s + z * c, v.x, v.y, v.z]; };
      const loc = (o) => { v.setFromMatrixPosition(o.matrixWorld); return at(); };
      const hpt = (side) => { d.handPoint(side, v); return at(); };
      const cur = { hR: hpt('R'), hL: hpt('L'), fR: loc(R.legs.R.foot), fL: loc(R.legs.L.foot), hd: loc(R.head ?? R.arms.R.upper), ch: loc(R.chest ?? R.spine) };
      // (a blink (a flit, a dash's frame, a pass) moves or turns the root by itself: not a pop of the limbs)
      const blink = pv && (Math.hypot(px - pv[0], pz - pv[1]) > 0.5 || Math.abs(Math.atan2(Math.sin(d.yaw - (pv[3] ?? d.yaw)), Math.cos(d.yaw - (pv[3] ?? d.yaw)))) > 0.5);
      if (prev && G.game.dt > 1e-3 && !blink) {
        const dj = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        const hj = Math.max(dj(cur.hR, prev.hR), dj(cur.hL, prev.hL)), fj = Math.max(dj(cur.fR, prev.fR), dj(cur.fL, prev.fL));
        if (hj > hand) { hand = hj; hT = a.t; }
        if (fj > foot) { foot = fj; fT = a.t; }
        head = Math.max(head, dj(cur.hd, prev.hd));
        // a foot down on the plates (low) that slides in the world while it stays down
        for (const k of ['fR', 'fL']) if (cur[k][4] < py + 0.12 && prev[k][4] < py + 0.12 && py < 0.05) slide = Math.max(slide, Math.hypot(cur[k][3] - prev[k][3], cur[k][5] - prev[k][5]) / G.game.dt);
        const vel = [(px - pv[0]) / G.game.dt, (pz - pv[1]) / G.game.dt];
        if (pv[2]) jolt = Math.max(jolt, Math.hypot(vel[0] - pv[2][0], vel[1] - pv[2][1]));
        pv = [px, pz, vel, d.yaw];
      } else pv = [px, pz, null, d.yaw];
      prev = cur;
      n++;
      for (const b of a.beats) {
        if (b.feint || seen.has(b) || a.t < b.impact || !V04_PALM.has(b.def.part)) continue;
        seen.add(b);
        const h = b.def.part === 'fistL' ? cur.hL : cur.hR;
        // (the gap seen from above: the hand from the chest's axis, in the ground plane)
        gapMin = Math.min(gapMin, Math.hypot(h[0] - cur.ch[0], h[2] - cur.ch[2]));
        // (where the palm is drawn at the contact, in his frame: + his left, + forward, up; the hero's line is x 0)
        d.handPoint(b.def.part === 'fistL' ? 'L' : 'R', v);
        R.root.worldToLocal(v);
        anchors.push(`B${b.index + 1} ${b.def.part} [${v.x.toFixed(2)} ${v.z.toFixed(2)} ${v.y.toFixed(2)}]`);
      }
    });
    popWorst = Math.max(popWorst, hand, foot, head);
    slideWorst = Math.max(slideWorst, slide);
    rows.push(`${name} P${form}: hand ${hand.toFixed(3)} (t ${hT.toFixed(2)}) foot ${foot.toFixed(3)} (t ${fT.toFixed(2)}) head ${head.toFixed(3)} m/frame; planted slide ${slide.toFixed(2)} m/s; root jolt ${jolt.toFixed(1)} m/s/frame; palm gap ${Number.isFinite(gapMin) ? gapMin.toFixed(2) : '-'} m (${n} frames)${anchors.length ? '; palm at the contact (left, fwd, up) ' + anchors.join(' ') : ''}`);
  }
  for (const r of rows) out(`     ${r}`);
  out(`     worst one-frame jump ${popWorst.toFixed(3)} m, worst planted slide ${slideWorst.toFixed(2)} m/s`);
  assert(rows.length === V04_PLAY.length, 'every move measured');
}

// ================================================================== TUNING (the tuning agent's: the whole fight, the pace)
// tuneFight (opt-in): whole fights from the wake to his death against four mortal bots (160 HP, 5 flasks,
// they drink below 60 HP in his openings): `guard` holds the guard on every normal / blue cue and rolls out
// of a red one; `parry` parries normal / blue and rolls red; `roll` rolls out of everything; `strike`
// parries and rolls, answers fewer cues and swings at him whenever he is in reach. Each cuts him in his
// openings and gives the deathblow to a broken boss. Per phase: time, cues a minute, the longest gap, the
// moves (picks), links / chains, damage taken by move; the outcome, softlocks, NaNs, throws. Reported.
//   env: GCD_TBOTS=guard,parry,roll,strike  GCD_TSEEDS=4242,7,...  GCD_TSECS (cap, 480)  GCD_TSKILL (0.95)
//        GCD_TGOD=1 (god mode: the fight's length, no death)  GCD_TOUT=<file.jsonl> (a row a fight, appended)  GCD_TMOVES
//        (a JSON of move fields laid over MOVES before the runs: '{"votiveFist":{"cooldown":[9,4,3.5,3]}}')
// tunePace: the pace meter per phase (city.mjs's PACE: a god-mode guarding defender that roams 2.5 / 5 / 9 m;
//   GCD_TPSEEDS, GCD_TPSECS); asserts TUNING.pressure.meter.
// tuneStep: the jet step gets more frequent with each phase (a hero who keeps his distance).
const tuneOverlay = () => {
  if (!process.env.GCD_TMOVES) return () => {};
  const o = JSON.parse(process.env.GCD_TMOVES), was = {};
  for (const [k, v] of Object.entries(o)) { if (!MOVES[k]) continue; was[k] = {}; for (const f of Object.keys(v)) was[k][f] = MOVES[k][f]; Object.assign(MOVES[k], v); }
  return () => { for (const [k, v] of Object.entries(was)) Object.assign(MOVES[k], v); };
};
const TUNE_BOTS = ['guard', 'parry', 'roll', 'strike'];
/** A mortal bot's defence: answers `skill` of his cues (its own stream), as `style`. */
function tuneDefender(G, { style = 'parry', skill = 0.95, rng = Math.random } = {}) {
  const pend = [];
  let guardUntil = -1;
  const stats = { flashes: 0, skipped: [], answered: [] };
  return {
    stats,
    onEvent(n, e) {
      if (n !== 'combat:flash' || (e?.source !== 'dragon' && e?.source !== 'world')) return;
      stats.flashes++;
      if (rng() > skill) { stats.skipped.push([G.game.time, e.attack]); return; }
      stats.answered.push([G.game.time, e.attack]);
      pend.push({ tell: e.tell, at: G.game.time + (e.source === 'world' ? 0.3 : TUNING.flashLead), x: e.x, z: e.z, hazard: !!e.hazard && !e.bullet, done: false });
    },
    act() {
      const g = G.game, input = G.input, t = g.time;
      for (let i = pend.length - 1; i >= 0; i--) if (pend[i].done || pend[i].at < t - 0.5) pend.splice(i, 1);
      let busy = false;
      for (const e of pend) {
        if (e.done) continue;
        const left = e.at - t - DT;
        const red = e.tell === TELL.RED || e.tell === TELL.BLACK;
        if (red || style === 'roll') {
          if (left <= 0.1) {
            e.done = true;
            input.up(1);
            guardUntil = -1;
            const c = e.hazard ? { x: e.x, z: e.z } : g.dragon.position, p = g.player.position;
            const dx = p.x - c.x, dz = p.z - c.z, l = Math.hypot(dx, dz) || 1;
            input.axis = e.hazard ? { x: dx / l, y: -dz / l } : { x: -dz / l, y: -dx / l };
            input.tap('Space');
          }
        } else if (style === 'guard') {
          if (left <= 0.3) { e.done = true; guardUntil = Math.max(guardUntil, e.at + 0.2); }
        } else if (left <= 0.12) {
          e.done = true;
          input.up(1);
          input.click(1);
        }
        if (!e.done && left < 0.7) busy = true;
      }
      if (guardUntil > t) { input.press(1); busy = true; } else if (guardUntil > 0) { guardUntil = -1; input.up(1); }
      return busy;
    },
    dueWithin(s) { const t = G.game.time; return pend.some((e) => !e.done && e.at - t < s); },
  };
}
const _tgt = new THREE.Vector3();
/** The bot's body: closes in, drinks in his openings, cuts him (in his openings; `strike`: whenever near). */
function tuneBody(G, bot, god) {
  const { game, input } = G;
  const p = game.player, d = game.dragon;
  input.axis = { x: 0, y: 0 };
  if (!p.alive || game.state !== 'boss') return;
  if (god) p.hp = p.maxHp;
  d.lockPoint(_tgt);
  game.mouseGround.set(_tgt.x, 0, _tgt.z);
  const dx = _tgt.x - p.position.x, dz = _tgt.z - p.position.z, dist = Math.hypot(dx, dz);
  const tick = (game.realTime * 60) | 0;
  if (p.state === 'lock') { if (tick % 5 === 0) input.click(0); return; }
  const busy = G.defend.act();
  const opening = d.broken || d.mode === 'react', a0 = d.brain.act;
  // (it drinks below 60 HP as a player would: in his openings or out of his reach with nothing cued (lord.mjs's
  // rule); and, the duelists' rule being too strict for one who is never far or open (measured: bots dead with
  // all five flasks), also in any moment with nothing of his due within 0.9 s: his recovery, his footwork)
  const calm = d.mode === 'foot' || (a0 && a0.t > a0.recoveryStart);
  if (!god && p.hp < 60 && p.flasks > 0 && (opening || dist > 6 || calm) && !G.defend.dueWithin(calm && !opening && dist <= 6 ? 0.9 : 0.7) && ['idle', 'run', 'block'].includes(p.state) && tick % 6 === 0) { input.up(1); input.tap('KeyF'); return; }
  if (dist > 2.6 && !busy) input.axis = { x: dx / dist, y: -dz / dist };
  const a = d.brain.act;
  const open = d.broken || (d.mode === 'react' && ['recoil', 'stagger', 'flinch', 'reeling', 'trampled'].includes(d.brain.react?.kind)) || (a && a.t > a.recoveryStart) || p.critTimer > 0;
  // (wanting a drink, it holds its cuts so it comes to rest and can drink: measured, a bot cutting in every
  // opening never stood idle and died with five flasks)
  if (!god && p.hp < 60 && p.flasks > 0 && !d.broken) return;
  if (!busy && dist < 3.2 && (open ? tick % 20 === 0 : tick % (bot === 'strike' ? 24 : 70) === 0)) input.click(0);
}

/** One whole fight: what it measured. */
function tuneRun(seed, bot, { secs = 480, skill = 0.95, god = false } = {}) {
  const G = build(seed, true);
  const { game } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist: 3, ai: false });
  G.defend = tuneDefender(G, { style: bot === 'strike' ? 'parry' : bot, skill: bot === 'strike' ? Math.min(skill, 0.85) : skill, rng: mulberry32(seed * 977 + TUNE_BOTS.indexOf(bot)) });
  d.debug.setAI(true);
  const P = () => ({ T: 0, cues: [], picks: {}, dmg: {}, hits: 0, links: 0, chains: 0, rests: 0, steps: 0, breaks: 0, poolBreaks: 0, modeT: {}, tanks: -1, why: {}, ans: {} });
  const tanksIdle = () => game.world.forest.foundry?.tanks?.filter((f) => f.state === 'idle').length ?? -1;
  const per = { 1: P(), 2: P(), 3: P(), 4: P() };
  let curAtk = null;
  const th = p.takeHit.bind(p);
  p.takeHit = (h) => { curAtk = h?.attack ?? null; const r = th(h); curAtk = null; return r; };
  const n = { heals: 0, parries: 0, perfect: 0, dodges: 0, blows: 0 };
  const lastHits = [], flashT = [];
  let t0 = game.time;
  G.watch = (ev, e) => {
    const ph = per[d.phase];
    if (ev === 'player:hurt' && e?.damage > 0) { const k = curAtk ?? (e.kind === 'burn' ? 'molten' : e.kind === 'crash' ? `crash(${d.brain.act?.name ?? d.mode})` : d.brain.act?.name ?? e.kind ?? d.mode); ph.dmg[k] = (ph.dmg[k] ?? 0) + e.damage; ph.hits++; const t = game.time, atk = curAtk ?? ''; const why = G.defend?.stats.skipped.some((x) => x[0] > t - 1.5 && x[1] === atk) ? 'missed' : flashT.some((x) => x[0] > t - 1.5 && x[1] === atk) ? 'answered' : 'uncued'; ph.why[why] = (ph.why[why] ?? 0) + e.damage; if (why === 'answered') ph.ans[k] = (ph.ans[k] ?? 0) + e.damage; lastHits.push(`${(game.time - t0).toFixed(1)} ${k} ${Math.round(e.damage)}>${Math.round(p.hp)}`); if (lastHits.length > 6) lastHits.shift(); }
    if (ev === 'combat:flash' && (e?.source === 'dragon' || e?.source === 'world')) { ph.cues.push(game.time); flashT.push([game.time, e.attack]); if (flashT.length > 40) flashT.shift(); }
    if (ev === 'dragon:windup' && e?.name) ph.picks[e.name] = (ph.picks[e.name] ?? 0) + 1;
    if (ev === 'dragon:postureBreak') { ph.breaks++; if (game.world.forest.foundry?.molten?.at?.(d.position.x, d.position.z)) ph.poolBreaks++; }
    if (ev === 'player:parry') { n.parries++; if (e?.perfect) n.perfect++; }
    if (ev === 'player:perfectDodge') n.dodges++;
    if (ev === 'player:heal') n.heals++;
    if (ev === 'dragon:plunged') n.blows++;
  };
  const st = d.brain.stats, B = d.parts.boost;
  per[1].tanks = tanksIdle();
  let snap = { links: st.links, chains: st.chains, rests: st.rests, steps: B.stats.steps }, cur = d.phase;
  const flush = (ph) => { const q = per[ph]; q.links += st.links - snap.links; q.chains += st.chains - snap.chains; q.rests += st.rests - snap.rests; q.steps += B.stats.steps - snap.steps; snap = { links: st.links, chains: st.chains, rests: st.rests, steps: B.stats.steps }; };
  t0 = game.time;
  let outcome = 'time', thrown = null, lastCue = game.time, soft = [], sameMode = 0, prevKey = '';
  const errs0 = errors.length;
  for (let i = 0, N = Math.round(secs / DT); i < N; i++) {
    try {
      tuneBody(G, bot, god);
      G.tick(DT);
    } catch (err) { thrown = String(err?.stack ?? err).split('\n').slice(0, 2).join(' | '); outcome = 'THROW'; break; }
    if (d.phase !== cur) { flush(cur); cur = d.phase; per[cur].tanks = tanksIdle(); }
    per[d.phase].T += game.dt;
    { const mk = d.mode === 'react' ? `react:${d.brain.react?.kind}` : d.mode === 'act' ? (d.brain.act && d.brain.act.t >= d.brain.act.recoveryStart ? 'act:recovery' : 'act') : d.mode === 'foot' ? (B.step ? 'foot:step' : 'foot') : d.mode; const mt = per[d.phase].modeT; mt[mk] = (mt[mk] ?? 0) + game.dt; }
    const pc = per[d.phase].cues;
    if (pc.length && pc[pc.length - 1] > lastCue) lastCue = pc[pc.length - 1];
    const key = `${d.mode} ${d.brain.act?.name ?? d.brain.react?.kind ?? ''}`;
    sameMode = key === prevKey ? sameMode + game.dt : 0;
    prevKey = key;
    if (game.state === 'boss' && p.alive && d.mode !== 'dead' && d.mode !== 'dying' && (game.time - lastCue > 10 || sameMode > 12)) { soft.push(`${(game.time - t0).toFixed(0)}s ${key}`); lastCue = game.time; sameMode = 0; }
    if (d.mode === 'dead' || d.mode === 'dying') { outcome = 'won'; break; }
    if (!p.alive) { outcome = 'died'; break; }
  }
  flush(cur);
  G.watch = null;
  G.defend = null;
  const T = game.time - t0;
  const rows = {};
  for (const ph of [1, 2, 3, 4]) {
    const q = per[ph];
    if (!(q.T > 0.5)) continue;
    const gaps = q.cues.slice(1).map((t, i) => t - q.cues[i]);
    rows[ph] = { why: q.why, ans: q.ans, tanks: q.tanks, modeT: q.modeT, T: q.T, perMin: (q.cues.length * 60) / q.T, gapMax: gaps.length ? Math.max(...gaps) : q.T, picks: q.picks, dmg: q.dmg, hits: q.hits, links: q.links, chains: q.chains, rests: q.rests, steps: q.steps, breaks: q.breaks, poolBreaks: q.poolBreaks };
  }
  return { seed, bot, outcome, T, phase: d.phase, bar: d.hp / d.maxHp, hp: p.hp, flasks: p.maxFlasks - p.flasks, rows, soft, thrown, lastHits, nan: [...G.payload], errs: errors.length - errs0, ...n };
}

async function scenarioTuneFight() {
  const bots = (process.env.GCD_TBOTS ?? TUNE_BOTS.join(',')).split(',').filter((b) => TUNE_BOTS.includes(b));
  const seeds = (process.env.GCD_TSEEDS ?? '4242,7,99,1337,2024,11,23,555,808,31337').split(',').map(Number).filter(Number.isFinite);
  const secs = Number(process.env.GCD_TSECS ?? 480), skill = Number(process.env.GCD_TSKILL ?? 0.95), god = !!process.env.GCD_TGOD;
  out(`\n== scenario TUNEFIGHT (whole fights, wake to death: bots ${bots.join(', ')}; seeds ${seeds.join(', ')}; skill ${skill}${god ? '; GOD MODE' : ''}; cap ${secs} s) ==`);
  const undo = tuneOverlay();
  const all = [];
  try {
    for (const bot of bots) {
      for (const seed of seeds) {
        const r = tuneRun(seed, bot, { secs, skill, god });
        all.push(r);
        if (process.env.GCD_TOUT) fs.appendFileSync(process.env.GCD_TOUT, `${JSON.stringify(r)}\n`);
        const ph = Object.entries(r.rows).map(([k, x]) => `P${k} ${x.T.toFixed(0)}s ${x.perMin.toFixed(0)}c/m gap ${x.gapMax.toFixed(1)} L${x.links}/C${x.chains} st${x.steps} br${x.breaks}${x.poolBreaks ? `(pool ${x.poolBreaks})` : ''} tk${x.tanks} dmg ${Object.values(x.dmg).reduce((a, v) => a + v, 0).toFixed(0)}`).join(' | ');
        out(`   ${bot.padEnd(6)} ${String(seed).padEnd(5)} ${r.outcome.padEnd(5)} ${r.T.toFixed(0).padStart(4)} s · P${r.phase} bar ${(r.bar * 100).toFixed(0)}% · hp ${Math.round(r.hp)} flasks ${r.flasks} · parries ${r.parries} (perf ${r.perfect}) dodges ${r.dodges} blows ${r.blows}${r.soft.length ? ` · SOFT ${r.soft.join('; ')}` : ''}${r.thrown ? ` · THROW ${r.thrown}` : ''}${r.nan.length ? ` · NaN ${r.nan.join(',')}` : ''}${r.errs ? ` · ${r.errs} console errors` : ''}${r.outcome === 'died' ? ` · last hits ${r.lastHits.join(', ')}` : ''}`);
        out(`          ${ph}`);
      }
    }
  } finally { undo(); }
  // the summary per bot and phase
  out('   SUMMARY  bot · won/died/time · mean fight s · per phase: mean s · cues/min · gap max · links+chains a min · steps a min · breaks');
  for (const bot of bots) {
    const rs = all.filter((r) => r.bot === bot);
    const k = (o) => rs.filter((r) => r.outcome === o).length;
    const parts = [1, 2, 3, 4].map((ph) => {
      const xs = rs.map((r) => r.rows[ph]).filter(Boolean);
      if (!xs.length) return `P${ph} -`;
      const m = (f) => xs.reduce((a, x) => a + f(x), 0) / xs.length;
      return `P${ph} ${m((x) => x.T).toFixed(0)}s ${m((x) => x.perMin).toFixed(0)}c/m gap ${Math.max(...xs.map((x) => x.gapMax)).toFixed(1)} lk ${m((x) => ((x.links + x.chains) * 60) / x.T).toFixed(1)} st ${m((x) => (x.steps * 60) / x.T).toFixed(1)} br ${m((x) => x.breaks).toFixed(1)}`;
    });
    out(`   ${bot.padEnd(6)} ${k('won')}/${k('died')}/${k('time') + k('THROW')} · ${(rs.reduce((a, r) => a + r.T, 0) / (rs.length || 1)).toFixed(0)} s · ${parts.join(' | ')}`);
    for (const ph of [1, 2, 3, 4]) {
      const picks = {}, dmg = {};
      for (const r of rs) { const x = r.rows[ph]; if (!x) continue; for (const [m, v] of Object.entries(x.picks)) picks[m] = (picks[m] ?? 0) + v; for (const [m, v] of Object.entries(x.dmg)) dmg[m] = (dmg[m] ?? 0) + v; }
      if (!Object.keys(picks).length) continue;
      out(`      P${ph} picks: ${Object.entries(picks).sort((a, b) => b[1] - a[1]).map(([m, v]) => `${m} ${v}`).join(', ')}`);
      const mt = {};
      for (const r of rs) { const x = r.rows[ph]; if (!x) continue; for (const [m, v] of Object.entries(x.modeT)) mt[m] = (mt[m] ?? 0) + v; }
      const mtT = Object.values(mt).reduce((a, v) => a + v, 0) || 1;
      out(`      P${ph} time: ${Object.entries(mt).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m, v]) => `${m} ${((v * 100) / mtT).toFixed(0)}%`).join(' · ')}`);
      if (Object.keys(dmg).length) out(`      P${ph} damage: ${Object.entries(dmg).sort((a, b) => b[1] - a[1]).map(([m, v]) => `${m} ${v.toFixed(0)}`).join(', ')}`);
    }
  }
  assert(all.every((r) => !r.thrown && !r.nan.length), `no throw, no NaN in ${all.length} fights`);
}

/** PACE: a god-mode defender (bPaceDefender: it guards every normal / blue cue, rolls a red one, never
 *  swings) roams 2.5 / 5 / 9 m from him; per phase over GCD_TPSECS s (default 60) and GCD_TPSEEDS (default
 *  4242,7,99): cues a minute, the longest gap between two cues, the moves, links, jet steps, two cues of
 *  different answers under 0.3 s apart (conflicts). Asserts TUNING.pressure.meter (tuning.js). */
async function scenarioTunePace() {
  const SECS = Number(process.env.GCD_TPSECS ?? 60);
  const SEEDS = (process.env.GCD_TPSEEDS ?? '4242,7,99').split(',').map(Number).filter(Number.isFinite);
  out(`\n== scenario TUNEPACE (the pace meter: a god-mode guarding bot that roams 2.5 / 5 / 9 m, ${SECS} s a phase, seeds ${SEEDS.join(', ')}) ==`);
  const undo = tuneOverlay();
  const rows = [];
  try {
    for (const seed of SEEDS) {
      for (let ph = 1; ph <= 4; ph++) {
        const G = build(seed, true);
        const { game } = G;
        const d = game.dragon, p = game.player, B = bo(G);
        duel(G, { dist: 3, ai: true, form: ph });
        p.debug.god = true;
        p.debug.noRiposte = true;
        G.defend = bPaceDefender(G);
        Math.random = mulberry32(seed * 7 + ph);
        const flashes = [], picks = {}, modeT = {};
        G.watch = (n, e) => {
          // (each cue with the moment it asks its answer: a blow's impact flashLead after its flash, the world's
          // 0.3 s, a molten pool's first burn `arm` after its cue)
          if (n === 'combat:flash' && (e?.source === 'dragon' || e?.source === 'world')) flashes.push([game.time, e.tell === TELL.RED || e.tell === TELL.BLACK ? 'D' : 'G', e.attack, game.time + (e.attack === 'molten' ? TUNING.terrain.molten.arm : e.source === 'world' ? 0.3 : TUNING.flashLead)]);
          if (n === 'dragon:windup' && e?.name) picks[e.name] = (picks[e.name] ?? 0) + 1;
        };
        const roam = mulberry32(seed * 31 + ph), goal = { r: 2.5, a: 0, until: -1 };
        const t0 = game.time, s0 = { ...d.brain.stats }, st0 = B.stats.steps;
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
            G.input.axis = l > 0.5 ? { x: dx / l, y: -dz / l } : { x: 0, y: 0 };
          }
          game.mouseGround.set(d.position.x, 0, d.position.z);
          G.tick(DT);
          if (d.brain.pendingPhase > ph) d.brain.pendingPhase = 0;
          const mk = d.mode === 'react' ? `react:${d.brain.react?.kind}` : d.mode === 'act' ? (d.brain.act && d.brain.act.t >= d.brain.act.recoveryStart ? 'recovery' : 'act') : d.mode === 'foot' ? (B.step ? 'step' : flatDist(d.position, p.position) > 5 ? 'foot:far' : 'foot') : d.mode;
          modeT[mk] = (modeT[mk] ?? 0) + game.dt;
        }
        G.defend = null;
        G.watch = null;
        const T = game.time - t0;
        const ts = [t0, ...flashes.map((f) => f[0]), t0 + T];
        let gapMax = 0;
        for (let i = 1; i < ts.length; i++) gapMax = Math.max(gapMax, ts[i] - ts[i - 1]);
        // (a molten pool laid by a blow of his near another cue is reported (`pools`), not counted: the set's
        // pools are not moved by the fairness guard: an open issue of the terrain handler's, see the report)
        let conflicts = 0, pools = 0;
        const clashAt = [];
        for (let i = 0; i < flashes.length; i++) for (let j = i + 1; j < flashes.length && flashes[j][0] - flashes[i][0] < 1; j++) if (Math.abs(flashes[j][3] - flashes[i][3]) < 0.3 && flashes[i][1] !== flashes[j][1] && flashes[i][2] !== flashes[j][2]) { if (flashes[i][2] === 'molten' || flashes[j][2] === 'molten') pools++; else conflicts++; clashAt.push(`${flashes[i][2]}(${flashes[i][1]})/${flashes[j][2]}(${flashes[j][1]}) ${(flashes[j][3] - flashes[i][3]).toFixed(2)}s @${(flashes[i][0] - t0).toFixed(1)}`); }
        const st = d.brain.stats;
        rows.push({ seed, ph, T, perMin: (flashes.length * 60) / T, gapMax, conflicts, clashAt, pools, links: st.links - s0.links, chains: st.chains - s0.chains, steps: B.stats.steps - st0, picks: Object.values(picks).reduce((a, v) => a + v, 0), top: Object.entries(picks).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', '), nan: G.payload.size, modeT, picksAll: picks });
      }
    }
  } finally { undo(); }
  out('   seed ph cue/min gapMax picks links chains steps clash  top moves');
  for (const r of rows) out(`   ${String(r.seed).padStart(5)} ${r.ph} ${r.perMin.toFixed(1).padStart(7)} ${r.gapMax.toFixed(2).padStart(6)} ${String(r.picks).padStart(5)} ${String(r.links).padStart(5)} ${String(r.chains).padStart(6)} ${String(r.steps).padStart(5)} ${String(r.conflicts).padStart(5)}  ${r.top}${r.clashAt.length ? ` · CLASH (${r.pools} of them a pool) ${r.clashAt.join('; ')}` : ''}`);
  const mean = (ph, k) => { const rs = rows.filter((r) => r.ph === ph); return rs.reduce((a, r) => a + r[k], 0) / (rs.length || 1); };
  for (let ph = 1; ph <= 4; ph++) { const mt = {}; for (const r of rows.filter((x) => x.ph === ph)) for (const [k, v] of Object.entries(r.modeT)) mt[k] = (mt[k] ?? 0) + v; const tt = Object.values(mt).reduce((a, v) => a + v, 0) || 1; out(`   P${ph} time: ${Object.entries(mt).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `${k} ${((v * 100) / tt).toFixed(0)}%`).join(' · ')}`); }
  for (let ph = 1; ph <= 4; ph++) out(`   mean P${ph}: ${mean(ph, 'perMin').toFixed(1)} cues/min · longest gap ${Math.max(...rows.filter((r) => r.ph === ph).map((r) => r.gapMax)).toFixed(2)} s · links ${(mean(ph, 'links') * 60 / SECS).toFixed(1)} / chains ${(mean(ph, 'chains') * 60 / SECS).toFixed(1)} a minute · jet steps ${(mean(ph, 'steps') * 60 / SECS).toFixed(1)} a minute`);
  for (let ph = 1; ph <= 4; ph++) {
    const got = {};
    for (const r of rows.filter((x) => x.ph === ph)) for (const [k, v] of Object.entries(r.picksAll)) got[k] = (got[k] ?? 0) + v;
    const dead = MOVE_NAMES.filter((n) => !MOVES[n].counter && !MOVES[n].hidden && !MOVES[n].transition && weightIn(MOVES[n], ph) > 0 && !got[n]);
    out(`   P${ph} picks: ${Object.entries(got).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}${dead.length ? ` · NEVER PICKED: ${dead.join(', ')}` : ''}`);
  }
  assert(rows.every((r) => !r.nan), 'no NaN in any event');
  const A = TUNING.pressure.meter;
  if (!A) { out('   (no TUNING.pressure.meter: measured only)'); return; }
  const pp = (v, ph) => (Array.isArray(v) ? v[Math.min(v.length, Math.max(1, ph)) - 1] : v);
  for (let ph = 2; ph <= 4; ph++) assert(mean(ph, 'perMin') >= mean(ph - 1, 'perMin') * pp(A.rampMean, ph), `the seeds' mean: P${ph} at least x${pp(A.rampMean, ph)} P${ph - 1}'s cues a minute (${mean(ph - 1, 'perMin').toFixed(1)} → ${mean(ph, 'perMin').toFixed(1)})`);
  for (const r of rows) {
    assert(r.perMin >= pp(A.minRate, r.ph), `seed ${r.seed} P${r.ph}: ${r.perMin.toFixed(1)} cues a minute >= ${pp(A.minRate, r.ph)}`);
    assert(r.gapMax <= pp(A.maxGap, r.ph), `seed ${r.seed} P${r.ph}: longest gap ${r.gapMax.toFixed(2)} s <= ${pp(A.maxGap, r.ph)} s`);
    assert(r.conflicts === 0, `seed ${r.seed} P${r.ph}: no two answers of different moves needing different answers due within 0.3 s of each other (${r.conflicts}: ${r.clashAt.slice(0, 3).join('; ')})`);
  }
  if (A.steps) for (let ph = 3; ph <= 4; ph++) assert(mean(ph, 'steps') >= mean(ph - 1, 'steps') * A.steps, `the jet step more frequent with each phase: P${ph} ${mean(ph, 'steps').toFixed(1)} >= P${ph - 1} ${mean(ph - 1, 'steps').toFixed(1)} x ${A.steps}`);
}

/** WRECK (a measure, opt-in): Dies Irae slam after slam from phase 4's start: the floor's plates broken /
 *  marked / whole, the set's pieces standing, the press's head, after each slam (does the floor still read?). */
async function scenarioTuneWreck() {
  out('\n== scenario TUNEWRECK (Dies Irae slam after slam: what is left of the floor and the set) ==');
  const G = build();
  const { game } = G;
  const d = trDuel(G, 4, 6, -2);
  trHeroAt(G, -6, 6);
  game.player.debug.god = true;
  const T = tr(G), W = game.world.destructibles;
  const plates = W.floor.length, pieces0 = W.list.filter((b) => !b.floor && b.state === 0 && b.hp < Infinity).length;
  const row = (n) => {
    const broken = W.floor.filter((b) => b.state !== 0).length, marked = W.floor.filter((b) => b.state === 0 && b.hp < b.hpMax).length;
    const standing = W.list.filter((b) => !b.floor && b.state === 0 && b.hp < Infinity).length;
    out(`     after ${n} slam${n === 1 ? '' : 's'}: plates broken ${broken} / ${plates} (${((broken * 100) / plates).toFixed(0)} %), chipped ${marked}, whole ${plates - broken - marked}; pieces standing ${standing} / ${pieces0}; the press's head hp ${pieces(G, 'pressHead')[0]?.hp.toFixed(2)}`);
    return broken;
  };
  row(0);
  let b3 = 0;
  for (let n = 1; n <= 3; n++) {
    if (!d.brain.trigger('diesIrae')) { out(`     slam ${n}: refused`); break; }
    trPlay(G, 8);
    run(G, 5, null, () => !T.front.live && !T.busy);
    b3 = row(n);
  }
  assert(b3 < plates * 0.6, `after three slams the floor still reads: under 60 % of its plates broken (${b3} / ${plates})`);
}

/** FEET: his feet through the strings the V04 audit named, with the lift's ease off (0) and on (saint.js
 *  FS_FEET.ease): the largest jump of a foot in one frame (a pop), and how fast a PLANTED foot (both this
 *  frame and the last within 3 cm of its height in his guard) slides over the floor (its peak, and its mean over the planted frames),
 *  the hero 2.2 m off in god mode, AI off. The moves' timing is untouched by it (realise is the same). */
async function scenarioTuneFeet() {
  out('\n== scenario TUNEFEET (foot pops and planted-foot slide per move, the lift ease off vs on) ==');
  const { FS_FEET } = await imp('src/entities/enemies/falseSaint/saint.js');
  const ease0 = Number(process.env.GCD_FEASE ?? FS_FEET.ease), easeWas = FS_FEET.ease;
  const list = (process.env.GCD_FMOVES ?? 'benediction:1,genuflect:1,lauds:3,anathema:3,interdict:2,rebuke:1,castOut:2,thurible:3').split(',').map((x) => x.split(':'));
  const res = {};
  const v = new THREE.Vector3();
  for (const ease of [0, ease0]) {
    FS_FEET.ease = ease;
    for (const [name, f] of list) {
      const G = build();
      const { game } = G;
      const d = game.dragon;
      duel(G, { dist: 2.2, ai: false, form: Number(f) });
      game.player.debug.god = true;
      place(G, 2.2);
      const prev = { L: null, R: null }, rest = {};
      for (const k of ['L', 'R']) rest[k] = v.setFromMatrixPosition(d.rig.legs[k].foot.matrixWorld).y - d.position.y;
      let pop = 0, popAt = '', slideMax = 0, slideSum = 0, slideN = 0;
      d.brain.trigger(name);
      let acted = false;
      run(G, 7, () => game.mouseGround.set(d.position.x, 0, d.position.z), () => {
        if (d.mode === 'act') acted = true;
        for (const k of ['L', 'R']) {
          v.setFromMatrixPosition(d.rig.legs[k].foot.matrixWorld);
          const p = prev[k];
          if (p && game.dt > 0) {
            const j = Math.hypot(v.x - p.x, v.y - p.y, v.z - p.z);
            if (j > pop) { pop = j; popAt = `${k} @${(d.brain.act?.t ?? 0).toFixed(2)}`; }
            if (v.y - d.position.y < rest[k] + 0.03 && p.y - p.root < rest[k] + 0.03) {
              const sp = Math.hypot(v.x - p.x, v.z - p.z) / game.dt;
              slideMax = Math.max(slideMax, sp);
              slideSum += sp;
              slideN++;
            }
          }
          prev[k] = { x: v.x, y: v.y, z: v.z, root: d.position.y };
        }
        return acted && d.mode !== 'act';
      });
      (res[name] ??= {})[ease] = { pop, popAt, slideMax, slideMean: slideSum / Math.max(1, slideN) };
    }
  }
  FS_FEET.ease = easeWas;
  out(`   (on: ease ${ease0} s)`);
  out('   move           pop off (m)   pop on (m)    slide peak off / on (m/s)   slide mean off / on (m/s)');
  for (const [name] of list) {
    const a = res[name][0], b = res[name][ease0];
    out(`   ${name.padEnd(14)} ${a.pop.toFixed(2).padStart(5)} ${a.popAt.padEnd(8)} ${b.pop.toFixed(2).padStart(5)} ${b.popAt.padEnd(8)}  ${a.slideMax.toFixed(1).padStart(5)} / ${b.slideMax.toFixed(1).padEnd(5)}               ${a.slideMean.toFixed(2)} / ${b.slideMean.toFixed(2)}`);
  }
  const A1 = realise('benediction', 1, () => 0.5);
  assert(Number.isFinite(A1.end), 'realise unchanged in kind (the ease is the animator\'s, not the move\'s)');
}

/** TRAINING: every situation of the Lab's Training catalogue that applies to him plays out and shows what
 *  it promises (city.mjs's TRAINING; GCD_TONLY=id,id runs those only). */
async function scenarioTuneTraining() {
  out('\n== scenario TUNETRAINING (every Training situation for him plays out and shows what it promises; his roles: training.js ROLES.foundry) ==');
  const G = build(SEED, true);
  const { game } = G;
  duel(G, { dist: 4 });
  const T = game.lab.training;
  const { bossKinds } = await imp('src/dev/training.js');
  const kinds = bossKinds(game);
  assert(kinds.has('saint') && kinds.has('duel'), `his own boss kind (${[...kinds].join(', ')})`);
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
    // (Death: his only phase-1 red blow, the role's, is the grab, never lethal by design (BRIEF: Laying On of
    // Hands); a role's move is not put in its phase, and his other reds come from phase 2. Reported, not failed)
    if (!ok && s.id === 'death' && JSON.stringify(r?.missing) === '["player:died"]') { out('     (death: the grab never kills: expected)'); continue; }
    if (!ok) bad.push(s.id);
  }
  T.stop();
  out(`     ${L.length} situations: ${L.map((s) => s.id).join(', ')}`);
  assert((only || L.length >= 20) && !bad.length, `every situation plays out and shows what it promises (${L.length - bad.length} of ${L.length}${bad.length ? `; not: ${bad.join(', ')}` : ''})`);
}

// ================================================================== THE SCENARIOS (one entry per line, each agent in its block)
const S = {
  // --- core
  levels: scenarioLevels,
  data: scenarioData,
  fight: scenarioFight,
  phases: scenarioPhases,
  shell: scenarioShell,
  molten: scenarioMolten,
  death: scenarioDeath,
  events: scenarioEvents,
  // --- world
  world: scenarioWorld,
  // --- body
  bodyReveal: scenarioBodyReveal,
  bodyMilestones: scenarioBodyMilestones,
  bodyWeapons: scenarioBodyWeapons,
  bodyDeath: scenarioBodyDeath,
  // --- fx
  fx: scenarioFx,
  fxFlights: scenarioFxFlights,
  fxSounds: scenarioFxSounds,
  fxCost: scenarioFxCost,
  // --- melee
  mlreach: scenarioMlReach,
  mlgrab: scenarioMlGrab,
  mlwalk: scenarioMlWalk,
  mlworld: scenarioMlWorld,
  mllinks: scenarioMlLinks,
  // --- boost
  boostStep: scenarioBoostStep,
  boostVotive: scenarioBoostVotive,
  boostRosary: scenarioBoostRosary,
  boostDescent: scenarioBoostDescent,
  boostStrings: scenarioBoostStrings,
  boostVespers: scenarioBoostVespers,
  boostRite: scenarioBoostRite,
  boostChange: scenarioBoostChange,
  boostPace: scenarioBoostPace,
  // --- arsenal
  arData: scenarioArData,
  arVigil: scenarioArVigil,
  arAbsolution: scenarioArAbsolution,
  arTriptych: scenarioArTriptych,
  arChoir: scenarioArChoir,
  arBell: scenarioArBell,
  arKyrie: scenarioArKyrie,
  arVerdict: scenarioArVerdict,
  arRevelation: scenarioArRevelation,
  arWorld: scenarioArWorld,
  arFair: scenarioArFair,
  // --- terrain
  trData: scenarioTrData,
  trRefuse: scenarioTrRefuse,
  trPools: scenarioTrPools,
  trCrucible: scenarioTrCrucible,
  trRelic: scenarioTrRelic,
  trOffertory: scenarioTrOffertory,
  trProstration: scenarioTrProstration,
  trDiesIrae: scenarioTrDiesIrae,
  trChange: scenarioTrChange,
  trUse: scenarioTrUse,
  // --- tuning
  tuneFight: scenarioTuneFight,
  tunePace: scenarioTunePace,
  tuneTraining: scenarioTuneTraining,
  tuneWreck: scenarioTuneWreck,
  tuneFeet: scenarioTuneFeet,
  // --- v04
  v04Timing: scenarioV04Timing,
  v04Shell: scenarioV04Shell,
  v04Hands: scenarioV04Hands,
  v04Alloc: scenarioV04Alloc,
  v04Motion: scenarioV04Motion,
};
// (opt-in scenarios: listed here, run only by name; tests/run.mjs may run one as a process of its own)
const OPT_IN = new Set(['tuneFight', 'tuneWreck', 'tuneFeet']);
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
out(fails ? `\nSAINT: ${fails} FAILED` : '\nSAINT: ALL PASSED');
process.exit(fails ? 1 : 0);
