// The Foxfire Terrace and Wen Yao, the Thousand-Body Fox, headless (ADR-147): the REAL Player,
// ThousandFox, Hud, GameFlow, AudioEngine and Lab (+ real LightPool, GlyphParticles, FireField,
// CameraRig, Events) wired like src/main.js for `?level=fox`; the world is a light mock on the real
// Colliders, filled by the level's set (world/foxTerrace.js), or the real set with its breakables.
// A bot drives the input. The harness is asc.mjs's (its build, bots, helpers).
// usage: node fox.mjs <repoRoot> [scenario]   (env: GCD_SEED=n reseeds the AI)
//   scenario: levels | data | timing | clones | pearl | mantle | phase | flow | pace | win | training | looks | all
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
const { TELL, RESULT, POSTURE, DEFENSE: DEF } = await imp('src/combat/rules.js');
const { LEVELS, getLevel, levelFromSearch, applyLevel } = await imp('src/levels/index.js');
const { createFoxTerrace, TERRACE } = await imp('src/world/foxTerrace.js');
const { Destructibles } = await imp('src/world/destructibles.js');
const { Scars } = await imp('src/world/scars.js');
const { Player } = await imp('src/entities/player/player.js');
const { ThousandFox } = await imp('src/entities/enemies/thousandFox/fox.js');
const { MOVES, MOVE_NAMES, CLIP, TRANSITIONS, realise } = await imp('src/entities/enemies/thousandFox/moves.js');
const { TUNING } = await imp('src/entities/enemies/thousandFox/tuning.js');
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
const LVL = getLevel('fox');
const errors = [];
console.error = (...a) => { errors.push(a.map((x) => (x?.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x))).join(' ')); };
console.warn = (...a) => { errors.push('WARN ' + a.map(String).join(' ')); };
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
let fails = 0;
const assert = (c, m) => { if (!c) { fails++; out('FAIL', m); } else out('ok  ', m); };
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SEED = Number(process.env.GCD_SEED ?? 4242);
const DT = 1 / 60;
// a PLAIN parry's press (ADR-227): the perfect window is 0.20 s of the parry's 0.22, so a test that means
// a plain parry presses in that sliver (a `left <= lead` check lands the press one step inside it: 13 / 60 s)
const PLAIN_LEAD = (DEF.perfectParryWindow + DEF.parryWindow) / 2 + DT / 2;
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
  const set = createFoxTerrace(createSharedUniforms(), c);
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
  const set = real ? createFoxTerrace(U, colliders) : null;
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
    if (![d.position.x, d.position.y, d.position.z, d.hp, d.yaw, d.posture, d.maxPosture].every(Number.isFinite)) throw new Error('fox NaN');
    if (![d._tip.x, d._tip.y, d._tip.z, d._hilt.x].every(Number.isFinite)) throw new Error('fox blade NaN');
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
  d.clones.popAll('test');
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
const quiet = (d) => d.mode === 'foot' && !d.fx.crescentsAlive && !d.pearl.flying && !d.clones.packLive;
/** A per-phase value (tuning.js perPhase). */
const perPhaseT = (v, ph) => (Array.isArray(v) ? v[Math.min(v.length, Math.max(1, ph)) - 1] : v);

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

// ================================================================== scenario: smoke
async function scenarioSmoke() {
  out('\n== scenario SMOKE (he fights a defender for 60 s in each phase) ==');
  for (let ph = 1; ph <= 3; ph++) {
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon;
    duel(G, { dist: 3, ai: true, form: ph });
    game.player.debug.god = true;
    G.defend = makeDefender(G);
    const moves = {};
    let maxLive = 0;
    G.watch = (n, e) => { if (n === 'dragon:windup') moves[e.name] = (moves[e.name] || 0) + 1; };
    run(G, 60, () => { G.defend.act(); game.mouseGround.set(d.position.x, 0, d.position.z); maxLive = Math.max(maxLive, d.clones.live); });
    out(`   P${d.phase}: ${JSON.stringify(moves)} · selves at most ${maxLive} · flashes ${G.defend.stats.flashes} · hits ${G.hits.length}`);
    out(`   (the bot's ripostes may push him on: phase ${d.phase})`);
  }
}

// ================================================================== helpers of this suite
const P_OF = (name) => MOVES[name]?.phase ?? 1;
/** The live selves' indices. */
const liveSelves = (d) => d.clones.list.filter((c) => c.alive);
/** Pose the selves and the boss once (no time passes): their spheres are fresh. */
const fresh = (G) => G.tick(1e-4);

// ================================================================== scenario: levels
async function scenarioLevels() {
  out('\n== scenario LEVELS (the registry, the URL, the lines, the reward, the boss slot) ==');
  assert(LEVELS.includes(LVL) && LVL.id === 'fox' && LEVELS.indexOf(LVL) === LEVELS.length - 1 || LEVELS.includes(LVL), `levels: ${LEVELS.map((l) => l.id).join(', ')}`);
  assert(['?level=fox', '?lab&level=FOX', '?level=foxfire', '?level=terrace', '?level=shrine', '?level=thousand', '?level=wenyao'].every((q) => levelFromSearch(q) === LVL), '?level=fox / foxfire / terrace / shrine / thousand / wenyao pick the level (case-insensitive)');
  assert(getLevel('hollow') !== LVL, "'hollow' stays Cinderwood's");
  for (const k of ['arrive', 'stir', 'phase2', 'phase3', 'victory', 'fallen', 'restReset', 'again', 'rise']) assert(!!LVL.text[k], `the level has its ${k} line`);
  assert(LVL.name === 'The Foxfire Terrace' && LVL.text.victory === 'THE FOX IS UNMASKED', `${LVL.name}: ${LVL.sub}`);
  const R = LVL.reward;
  assert(R && R.id === 'paperDouble' && R.name === 'Paper Double' && typeof R.line === 'string' && R.usable === false, 'its fixed reward is recorded and not usable yet (ADR-148)');
  assert(CONFIG.world.dragonBound === 12.2 && CONFIG.world.arenaRadius === 14.5 && CONFIG.world.bossTriggerZ === 14.6, 'applyLevel merged the terrace\'s layout into CONFIG.world');
  const G = build();
  const d = G.game.dragon;
  assert(d instanceof ThousandFox && d.kind === 'duelist' && d.name === TUNING.name && d.kit.id === 'thousandFox', `the boss is his own duelist: ${d.name}`);
  assert(d.maxHp === TUNING.hp && TUNING.phaseAt.length === 3 && !d.lives, 'one health bar, three phases');
  assert(d.clones.list.length === TUNING.clones.pool && d.clones.live === 0 && d.clones.list.every((c) => c.root.parent === G.game.scene), `${TUNING.clones.pool} paper selves built with him, none alive`);
  assert(d.mode === 'sleep' && d.brain.clip === d.brain.C.meditate && d.phase === 1 && d.clones.list.filter((c) => c.root.visible).length === 4, 'he waits seated (meditate) among four seated selves');
  run(G, 0.3);
  G.game.flow.debug.toState('explore');
  run(G, 0.3);
  assert(d.mode === 'sleep', 'exploring, far off: he does not stir');
  d.startIntro();
  run(G, 4, null, () => d.mode === 'foot');
  assert(G.counts['dragon:wake'] === 1 && G.counts['dragon:introDone'] === 1 && d.mode === 'foot', 'woken: he rises into his guard');
  assert(!d.clones.seated && d.clones.list.every((c) => !c.root.visible) && (G.counts['dragon:clone'] ?? 0) === 4, 'the seated selves tore into paper one by one as he rose');
}

// ================================================================== scenario: data (the move rules)
async function scenarioData() {
  out('\n== scenario DATA (move data rules in every phase a move is used in, both ends of every roll) ==');
  let checked = 0;
  // (the quick blows, ADR-223: checked with their switch on; exempt from minFirstWindup, never under flashLead)
  const { setLook: setQuick } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  setQuick('foxQuick', 'a');
  const CAP = { [TELL.NORMAL]: 26, [TELL.BLUE]: 26, [TELL.RED]: 30, [TELL.BLACK]: 44 };
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    const phases = phasesOf(name);
    if (!phases.length) assert(false, `${name}: used in at least one phase`);
    if (!def.transition && !def.counter && !def.hidden && !(Array.isArray(def.weight) && def.weight.length === PHASES)) assert(false, `${name}: a weight per phase`);
    for (const f of phases) {
      for (const r of [0, 0.5, 0.999]) {
        const A = realise(name, f, () => r, name === 'foxRing' ? { selves: 2 + Math.floor(r * 3.99) } : null);
        const real = A.beats.filter((b) => !b.feint);
        const tag = `${name} P${f} r${r}`;
        if (!real.every((b) => [TELL.NORMAL, TELL.BLUE, TELL.RED, TELL.BLACK].includes(b.def.tell))) assert(false, `${tag}: a tell on every real hit`);
        if (!A.beats.filter((b) => b.feint).every((b) => b.def.tell === undefined && !b.def.zone && !b.def.damage)) assert(false, `${tag}: a feint says nothing (no tell, no zone, no damage)`);
        const first = real[0];
        if (!def.transition && first && !(first.impact - first.tellAt >= (def.quick ? TUNING.flashLead : TUNING.minFirstWindup) - 1e-6)) assert(false, `${tag}: first real windup ${(first.impact - first.tellAt).toFixed(3)} >= ${TUNING.minFirstWindup}`);
        for (let i = 1; i < real.length; i++) if (!(real[i].impact - real[i - 1].impact >= TUNING.minHitGap - 1e-6)) assert(false, `${tag}: hits ${i - 1}→${i} ${(real[i].impact - real[i - 1].impact).toFixed(3)} s apart >= ${TUNING.minHitGap}`);
        for (const b of real) if (!(b.flash >= b.tellAt - 1e-6)) assert(false, `${tag}: hit ${b.hit} flashes after its tell`);
        for (const b of real) if (!(b.def.zone || b.def.release || b.def.cast)) assert(false, `${tag}: hit ${b.hit} has a zone, a release or a cast`);
        for (const b of real) if (b.def.tell === TELL.RED && b.def.zone?.kind === 'ring' && !b.def.ring) assert(false, `${tag}: a red ring has its \`ring\``);
        for (const b of real) if (!def.transition && b.def.damage > CAP[b.def.tell]) assert(false, `${tag}: hit ${b.hit} ${b.def.damage} damage over the cap`);
        if (!(A.end > A.recoveryStart && Math.abs(A.clip.dur - A.end) < 1e-9)) assert(false, `${tag}: clip spans the move`);
        checked++;
      }
    }
  }
  assert(checked > 60, `${checked} realisations obey the rules (a tell per hit, feints silent, first windup >= ${TUNING.minFirstWindup} s, hits >= ${TUNING.minHitGap} s apart)`);
  {
    // the quick blows (ADR-223): one white hit each, fixed, never under flashLead (the glint as it starts), light; off by default
    const quick = MOVE_NAMES.filter((n) => MOVES[n].quick);
    const ok = quick.every((n) => { const a = realise(n, 3, () => 0.5); const r = a.beats.filter((b) => !b.feint); return r.length === 1 && r[0].def.tell === TELL.NORMAL && r[0].def.fixed && r[0].impact - r[0].tellAt >= TUNING.flashLead - 1e-6 && r[0].impact - r[0].tellAt < TUNING.minFirstWindup && r[0].def.damage <= 12; });
    setQuick('foxQuick', '0');
    const off = quick.every((n) => [1, 2, 3].every((f) => !((Array.isArray(MOVES[n].weight) ? MOVES[n].weight[f - 1] : MOVES[n].weight) > 0)));
    assert(quick.length > 0 && ok && off, `the quick blows (${quick.join(', ')}): one white hit, fixed, windup in [flashLead, minFirstWindup), light; weight 0 with ?foxQuick=0`);
    setQuick('foxQuick', null);
  }
  // the plan's table: windups, damage, bands, weights
  const W = (n, i = 0) => MOVES[n].beats.filter((b) => !b.feint)[i];
  assert(W('foxBite').windup === 0.5 && W('foxBite').damage === 18 && W('foxBite').dash.max === 4.5, 'Fox Bite: N 0.50, 18, a dash of up to 4.5 m');
  assert(W('brushstrokes', 2).tell === TELL.BLUE && W('brushstrokes', 2).flare, 'Three Paws ends on a parry moment');
  assert(W('moonLadder').lock && W('moonLadder').tell === TELL.BLUE, 'Ladder to the Moon: a blue flare that locks');
  assert(W('sweepingBrush').tell === TELL.RED && W('sweepingBrush').knockdown, 'Sweeping Tail: red, knockdown');
  assert(W('changingPlaces').swap && MOVES.changingPlaces.gapCloser, 'Changing Places trades places');
  assert(!MOVES.scatter && !MOVES.springboard && !MOVES.paperCut, 'no ambient selves: Scattered Leaves, the old springboard and the token\'s cut are gone');
  assert(!MOVE_NAMES.some((n) => MOVES[n].clonesFight || MOVES[n].needs || MOVES[n].beats.some((b) => b.scatter || b.round)), 'no move tears selves off to stand about (no scatter, no round slots, no clonesFight)');
  assert(W('foxPearl').pearl === 'drive' && W('foxPearl').tell === TELL.RED && W('foxPearl').dash && W('foxPearl').part === 'palms' && W('foxPearl').pack?.feed, 'the Pearl: shaped in his palm while a pack harries (feeding it), driven home on a dash (red)');
  assert(perPhaseT(MOVES.foxPearl.weight, 1) >= 1.8, 'the Pearl is picked more in phase 1 (weight >= 1.8)');
  assert(W('twinPearl').twin && W('twinPearl').tell === TELL.RED, 'the Twin Pearls: a twin drives a second Pearl (one red cue)');
  assert(W('pearlRain').cast?.kind === 'pearl' && W('pearlRain').cast.selfCue && W('pearlRain').tell === TELL.RED && MOVES.pearlRain.phase === 2, 'Pearl Rain: three pearls flung (a red cast that cues itself), phase 2');
  assert(W('buryingLeaves').spring === 'pile' && W('buryingLeaves').leap && W('buryingLeaves').tell === TELL.RED && MOVES.buryingLeaves.beats[0].pack?.mode === 'together' && MOVES.buryingLeaves.beats[0].pack.tell === TELL.RED, 'the Burial: a red together pack, then off the pile into a leap (red)');
  assert(MOVE_NAMES.every((n) => MOVES[n].beats.every((b) => b.feint || ['fistR', 'fistL', 'palms', 'footR', 'footL', 'kneeR', 'kneeL', 'elbowR', 'elbowL', 'feet', 'shoulder'].includes(b.part ?? 'fistR'))), 'bare-handed: every blow names the limb that strikes');
  assert(MOVES.relay.beats.filter((b) => b.swap).length === 2 && MOVES.relay.phase === 2, 'Hand to Hand: two swaps, phase 2');
  assert(W('greatPearl').tell === TELL.BLACK && W('greatPearl').damage === 44 && W('greatPearl').leap && W('greatPearl').lift === true, 'Moon-Swallowing Pearl: black, 44, two selves lift it, a leap down');
  for (const n of ['paperDive', 'paperCross', 'paperUpkick', 'paperSlam']) assert(MOVES[n]?.hidden && !MOVES[n].weight.some((w) => w > 0), `${n}: a hidden self-move, never picked`);
  assert(MOVES.riposte.copy && perPhaseT(MOVES.riposte.copy, 1) === 0 && perPhaseT(MOVES.riposte.copy, 2) > 0, 'It was a copy: his counter from phase 2');
  for (const [ph, mv] of Object.entries(TRANSITIONS)) {
    const b = MOVES[mv].beats[0];
    assert(MOVES[mv]?.transition && MOVES[mv].phase === Number(ph) && b.tell === TELL.RED && b.windup === 1.6 && b.fixed && b.damage === 10 && b.zone.r === 6 && b.knockback === 6, `phase ${ph} begins with ${mv} (red, 1.6 s fixed, 10, ring 6, knockdown 6)`);
  }
  // every pack's schedule (both ends of every roll, every phase it is used in): its bodies' windups,
  // the cues of the move (his blows and the pack's) at least minHitGap apart, a red cue after a guard's
  // at least guard.sep + margin later, every pack within the pool
  const G0 = TUNING.pressure.guard, SEP = G0.sep + G0.margin, CL = TUNING.clones;
  let packs = 0;
  const askGuard = (t) => t === TELL.NORMAL || t === TELL.BLUE;
  for (const name of MOVE_NAMES) {
    if (!MOVES[name].beats.some((b) => b.pack)) continue;
    for (const f of phasesOf(name)) {
      for (const r of [0, 0.5, 0.999]) {
        const A = realise(name, f, () => r, name === 'foxRing' ? { selves: perPhaseT(MOVES.foxRing.beats[0].pack.n, f) } : null);
        const cues = [];
        for (const b of A.beats) if (!b.feint) cues.push({ t: b.impact, tell: b.def.tell, who: `his ${b.hit}` });
        for (const b of A.beats) {
          const P = b.def.pack;
          if (!P) continue;
          let n = perPhaseT(P.n, f);
          if (!(n > 0)) continue;
          const wind = CL.blows[P.blow];
          const call = (P.at ?? 1) >= 1 ? b.impact : b.start + (P.at ?? 1) * (b.impact - b.start);
          if (b.def.pearl === 'drive') {
            const left = b.impact - call - SEP - 0.06 - P.from;
            n = Math.min(n, left < 0 ? 0 : 1 + Math.floor(left / Math.max(0.32, P.gap)));
          }
          const tag = `${name} P${f} r${r}`;
          if (!(wind >= TUNING.minFirstWindup && P.from >= wind + 0.05)) assert(false, `${tag}: a body shows ${wind} s before its blow (>= ${TUNING.minFirstWindup}), the first ${P.from} s after the call`);
          if (!(n <= CL.pool - (b.def.pearl === 'drive' ? 1 : 0))) assert(false, `${tag}: ${n} bodies fit the pool`);
          if (P.mode === 'together') cues.push({ t: call + P.from, tell: P.tell, who: 'pack' });
          else for (let k = 0; k < n; k++) cues.push({ t: call + P.from + P.gap * k, tell: P.tell, who: `pack ${k}` });
          packs++;
        }
        cues.sort((a, b) => a.t - b.t);
        const tag = `${name} P${f} r${r}`;
        for (let i = 1; i < cues.length; i++) {
          const a = cues[i - 1], c = cues[i], gap = c.t - a.t;
          if (!(gap >= TUNING.minHitGap - 1e-6)) assert(false, `${tag}: ${a.who} → ${c.who} ${gap.toFixed(3)} s apart (>= ${TUNING.minHitGap})`);
          if (askGuard(a.tell) !== askGuard(c.tell) && !(gap >= SEP - 1e-6)) assert(false, `${tag}: ${a.who} → ${c.who} ask different answers ${gap.toFixed(3)} s apart (>= ${SEP})`);
        }
      }
    }
  }
  assert(packs >= 30, `${packs} pack schedules: bodies show >= ${TUNING.minFirstWindup} s before their blows, the move's cues >= ${TUNING.minHitGap} s apart, a red after a guard's >= ${SEP} s`);
  // the Round's palm lands a gap after the last of its pack's blows, for every n
  const { roundBeats, ROUND_PACK } = await imp('src/entities/enemies/thousandFox/moves.js');
  for (let n = 1; n <= TUNING.clones.pool; n++) {
    const A = realise('foxRing', 2, () => 0.5, { selves: n });
    const call = A.beats[0], his = A.beats[1];
    const last = call.impact + ROUND_PACK.from + ROUND_PACK.gap * (n - 1);
    assert(roundBeats(n).length === 2 && his.impact - last >= ROUND_PACK.gap - 1e-3, `the Round with ${n} selves: his palm ${(his.impact - last).toFixed(2)} s after their last blow`);
  }
  assert(TUNING.windupScale[2] >= TUNING.windupScale[1] && TUNING.recoveryScale[2] >= TUNING.recoveryScale[1], 'phase 3 winds up and recovers no faster than phase 2');
}

// ================================================================== scenario: timing (flash → contact)
async function scenarioTiming() {
  out('\n== scenario TIMING (every move from inside its band: each glint is a blow, on time) ==');
  let worst = 0, moves = 0;
  const only = process.env.GCD_TMOVE;
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    if (def.transition || def.hidden || def.verdict) continue;
    if (only && name !== only) continue;
    const f = Math.max(P_OF(name), 1);
    const G = build();
    const d = G.game.dragon;
    const [lo, hi] = def.band;
    const at = def.counter ? 2.2 : Math.max(1.6, Math.min(hi - 0.4, lo + (Math.min(hi, 12) - lo) * 0.4));
    duel(G, { dist: at, form: f });
    G.game.player.debug.god = true;
    const flashes = [], contacts = [];
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon') flashes.push(G.game.time); };
    const h0 = G.hits.length;
    if (!d.debug.trigger(name)) { assert(false, `${name} P${f}: starts`); continue; }
    run(G, 9, null, () => quiet(d) && d.mode === 'foot');
    for (const h of G.hits.slice(h0)) if (h.r !== RESULT.IGNORED) { contacts.push(h.t); if (only) out(`       ${h.t.toFixed(3)} contact ${h.attack} ${h.r}`); }
    let w = 0;
    for (const c of contacts) {
      const fl = flashes.filter((t) => t <= c + 1e-6).pop();
      w = Math.max(w, fl === undefined ? Infinity : Math.abs(c - fl - TUNING.flashLead));
    }
    worst = Math.max(worst, Number.isFinite(w) ? w : 9);
    moves++;
    if (!(contacts.length >= 1) || !(w <= 0.09)) assert(false, `${name} P${f} from ${at.toFixed(1)} m: ${flashes.length} flashes, ${contacts.length} contacts, worst ${(w * 1000).toFixed(0)} ms`);
    else out(`     ${name.padEnd(15)} P${f} from ${at.toFixed(1)} m: ${flashes.length} flashes, ${contacts.length} contacts, worst ${(w * 1000).toFixed(0)} ms`);
  }
  if (only) return;
  assert(moves >= 16 && worst <= 0.09, `${moves} moves: every contact within ${(worst * 1000).toFixed(0)} ms of its flash + ${TUNING.flashLead} s, and every move lands`);
}

// ================================================================== scenario: clones (the paper selves: packs)
async function scenarioClones() {
  out('\n== scenario CLONES (packs only: booked with the ledger, one hit pops, the cleave, together is one cue and one result, the parry, the guard, the break, reset) ==');
  const C = TUNING.clones;
  const sph = (d) => d.hurtSpheres.filter((h) => typeof h.part === 'string' && h.part.startsWith('clone'));
  const ledgerN = (d) => d.brain.ledger.exp.filter((e) => e.alive).length;
  // no self lives outside a pack (or helping him): his fight, 60 s a phase, every frame
  for (let ph = 1; ph <= 3; ph++) {
    const G = build(SEED + ph, true);
    const d = G.game.dragon;
    duel(G, { dist: 3, ai: true, form: ph });
    G.game.player.debug.god = true;
    G.defend = makeDefender(G);
    let stray = 0, packs = 0, maxLive = 0;
    const HELP = new Set(['pack', 'assist', 'lifting', 'twin', 'swapped']);
    G.watch = (n, e) => { if (n === 'dragon:clone' && e.kind === 'spawn' && !['assist', 'lift', 'twin', 'swap'].includes(e.by)) packs++; };
    run(G, 60, () => {
      G.defend.act();
      G.game.mouseGround.set(d.position.x, 0, d.position.z);
      for (const c of d.clones.list) if (c.alive && (!HELP.has(c.state) || (c.state === 'pack' && !c.pack?.on))) stray++;
      maxLive = Math.max(maxLive, d.clones.live);
    });
    G.watch = null;
    d.debug.setAI(false);
    run(G, 4);
    assert(stray === 0 && d.clones.live === 0 && !d.clones.packLive, `phase ${ph}: every self out was in a pack or helping him (${stray} strays), ${packs} pack bodies, at most ${maxLive} at once; none left after`);
  }
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist: 4, form: 3 });
  p.debug.god = true;
  // a pack books every cue with the ledger as it is called: sequence n cues, together one
  {
    const l0 = ledgerN(d);
    const P = d.debug.pack('twinFall');
    assert(P && P.bodies.length === 2 && ledgerN(d) - l0 === 2 && d.clones.live === 0, `Two Leaves Fall: 2 bodies booked, 2 cues told to the ledger (${ledgerN(d) - l0}), none out yet`);
    run(G, 3, null, () => !d.clones.packLive);
    const l1 = ledgerN(d);
    const Q = d.debug.pack('allAtOnce');
    assert(Q && Q.bodies.length === 5 && ledgerN(d) - l1 === 1, `A Thousand at Once (phase 3): 5 bodies, ONE cue in the ledger (${ledgerN(d) - l1})`);
    run(G, 3, null, () => !d.clones.packLive);
  }
  // they appear in the air, already attacking
  {
    d.clones.popAll('test');
    run(G, 0.3);
    let y0 = -1, tells = 0;
    G.watch = (n, e) => { if (n === 'combat:tell' && e.attack === 'twinFall') tells++; };
    d.debug.pack('twinFall');
    run(G, 2, null, () => {
      const c = d.clones.list.find((x) => x.alive);
      if (c && y0 < 0) y0 = c.y;
      return y0 >= 0;
    });
    G.watch = null;
    assert(y0 >= C.drop.h - 0.3 && tells === 1, `a diving body appears ${y0.toFixed(1)} m up (drop ${C.drop.h}), its tell as it shows`);
    run(G, 3, null, () => !d.clones.packLive);
  }
  // one hit pops: a cut on a body's sphere (0 damage to him, + his posture); popped, its blow never lands
  {
    d.clones.popAll('test');
    run(G, 0.3);
    const h0 = G.hits.length;
    d.debug.pack({ n: 2, mode: 'sequence', gap: 0.5, form: 'ring', blow: 'cross', tell: TELL.NORMAL, from: 1.2 }, { attack: 'testPack' });
    run(G, 2, null, () => d.clones.live >= 1);
    fresh(G);
    const s0 = sph(d)[0], i0 = Number(s0.part.slice(5));
    const post0 = d.posture, hp0 = d.hp, l0 = ledgerN(d);
    const dmg = d.takeHit({ damage: 30, part: s0.part, point: { x: s0.x, y: s0.y, z: s0.z }, swing: true });
    assert(dmg === 0 && !d.clones.alive(i0) && d.hp === hp0 && d.posture >= post0 + C.popPosture - 1e-6 && ledgerN(d) === l0 - 1, `one cut pops it: 0 damage to him, +${C.popPosture} posture, its cue gone from the ledger`);
    run(G, 3, null, () => !d.clones.packLive);
    const mine = G.hits.slice(h0).filter((h) => h.attack === 'testPack');
    assert(mine.length === 1, `the popped body's blow never lands; the other's does (${mine.length} contact)`);
  }
  // the cleave: a heavy cut pops the body beside it too
  {
    d.clones.popAll('test');
    run(G, 0.3);
    d.debug.pack({ n: 5, mode: 'together', form: 'ring', blow: 'cross', tell: TELL.NORMAL, from: 1.6 }, { attack: 'testPack' });
    run(G, 2, null, () => d.clones.live >= 5 && d.clones.packs.some((P) => P.locked));
    fresh(G);
    const L = d.clones.list.filter((c) => c.alive);
    const a0 = sph(d).find((h) => h.part === `clone${L[0].i}`);
    const near = L.filter((c) => c !== L[0] && Math.hypot(c.x - a0.x, c.z - a0.z) <= C.cleaveHeavy).length;
    d.takeHit({ damage: 30, part: a0.part, point: { x: a0.x, y: a0.y, z: a0.z }, swing: true, heavy: true });
    assert(near >= 1 && near < 4 && d.clones.live === 4 - near, `the cleave: a heavy cut pops the ${near} selves within ${C.cleaveHeavy} m of it too, not the far ones (${d.clones.live} left)`);
    d.clones.popAll('test');
    assert(!d.clones.packLive && ledgerN(d) === 0, 'every body popped: the pack and its one cue are gone');
  }
  // together: ONE flash, ONE result; one parry bursts them all and pays his posture
  const together = (GG, how) => {
    const g = GG.game, dd = g.dragon, pp = g.player;
    dd.clones.popAll('test');
    run(GG, 0.4);
    pp.debug.teleport(0, 4);
    dd.position.set(0, 0, -6);
    let flashes = 0, tells = 0, parryAt = 0;
    GG.watch = (n, e) => {
      if (n === 'combat:flash' && e.attack === 'allAtOnce') { flashes++; parryAt = g.time + TUNING.flashLead - 0.1; }
      if (n === 'combat:tell' && e.attack === 'allAtOnce') tells++;
    };
    const h0 = GG.hits.length, post0 = dd.posture;
    const P = dd.debug.pack('allAtOnce');
    const n = P?.bodies.length ?? 0;
    let popped = 0;
    const w0 = GG.watch;
    GG.watch = (nm, e) => { w0(nm, e); if (nm === 'dragon:clone' && e.kind === 'pop' && e.by === 'parry') popped++; };
    run(GG, 3, () => {
      if (how === 'parry' && parryAt && g.time >= parryAt) { GG.input.click(1); parryAt = 0; }
      if (how === 'guard') GG.input.press(1);
    }, () => !dd.clones.packLive);
    GG.input.up(1);
    GG.watch = null;
    return { n, flashes, tells, popped, mine: GG.hits.slice(h0).filter((h) => h.attack === 'allAtOnce'), dpost: dd.posture - post0 };
  };
  {
    const G2 = build();
    duel(G2, { dist: 4, form: 3 });
    G2.game.player.debug.god = true;
    const R = together(G2, 'none');
    assert(R.n === 5 && R.flashes === 1 && R.tells === 1 && R.mine.length === 1 && R.mine[0].r === RESULT.HIT && R.mine[0].around, `A Thousand at Once: 5 bodies, ${R.flashes} flash, ${R.tells} tell, ${R.mine.length} result (${R.mine.map((h) => h.r)}), met from any side`);
    const P = together(G2, 'parry');
    assert(P.mine.length === 1 && P.mine[0].r === RESULT.PARRIED && P.popped === 5 && P.dpost >= C.popPosture * 5 + C.together.parryPosture - 1e-6, `one parry bursts all five (${P.popped}) and pays his posture (+${P.dpost.toFixed(0)} >= ${C.popPosture * 5 + C.together.parryPosture})`);
    const Q = together(G2, 'guard');
    assert(Q.mine.length === 1 && Q.mine[0].r === RESULT.BLOCKED, `a held guard pays ONE blow (${Q.mine.map((h) => h.r)})`);
    // a roll out of the ring as they lock on clears it
    const g = G2.game;
    g.dragon.clones.popAll('test');
    run(G2, 0.4);
    g.player.debug.teleport(0, 4);
    const h0 = G2.hits.length;
    const PK = g.dragon.debug.pack('allAtOnce');
    run(G2, 3, () => {
      if (PK.locked && !G2.rolled) { G2.rolled = true; G2.input.axis = { x: 1, y: 0 }; G2.input.tap('Space'); }
    }, () => !g.dragon.clones.packLive);
    G2.input.axis = { x: 0, y: 0 };
    const mine = G2.hits.slice(h0).filter((h) => h.attack === 'allAtOnce');
    assert(G2.rolled && mine.every((h) => h.r !== RESULT.HIT), `a roll out of the ring clears it (${mine.map((h) => h.r).join(',') || 'missed'})`);
  }
  // a sequence pack's blows are each their own cue, gap apart, from different sides
  {
    const G3 = build();
    duel(G3, { dist: 4, form: 3 });
    const d3 = G3.game.dragon;
    G3.game.player.debug.god = true;
    const fl = [];
    G3.watch = (n, e) => { if (n === 'combat:flash' && e.attack === 'foxRing') fl.push([G3.game.time, e.x, e.z]); };
    d3.debug.pack('foxRing');
    run(G3, 4, null, () => !d3.clones.packLive);
    G3.watch = null;
    let gmin = Infinity;
    for (let i = 1; i < fl.length; i++) gmin = Math.min(gmin, fl[i][0] - fl[i - 1][0]);
    const p3 = G3.game.player.position, sides = new Set(fl.map((f) => Math.round(Math.atan2(f[1] - p3.x, f[2] - p3.z) / 1.0)));
    assert(fl.length === 5 && gmin >= TUNING.minHitGap - 0.02 && sides.size >= 3, `the Round's pack: ${fl.length} flashes at least ${gmin.toFixed(2)} s apart, from ${sides.size} sides`);
  }
  // the whole Round parried (five selves and his palm): the full deflect
  {
    const G4 = build();
    duel(G4, { dist: 3, form: 3 });
    const d4 = G4.game.dragon, g4 = G4.game;
    g4.player.debug.god = true;
    G4.defend = makeDefender(G4, { style: 'parry', early: PLAIN_LEAD }); // plain parries: perfect ones break him first
    let deflected = 0;
    G4.watch = (n) => { if (n === 'dragon:deflected') deflected++; };
    d4.debug.trigger('foxRing');
    run(G4, 7, () => { G4.defend.act(); g4.mouseGround.set(d4.position.x, 0, d4.position.z); }, () => deflected > 0 || (d4.mode === 'foot' && !d4.clones.packLive));
    G4.watch = null;
    G4.defend = null;
    assert(deflected === 1, `the Round parried whole (5 selves + his palm): the full deflect (${deflected})`);
  }
  // his posture break pops them all and calls off what is still to come; a reset mid-pack leaves nothing
  {
    const G5 = build();
    const d5 = G5.game.dragon;
    duel(G5, { dist: 4, form: 3 });
    d5.debug.pack('foxRing');
    run(G5, 1.2);
    const out0 = d5.clones.live;
    d5.debug.postureBreak();
    run(G5, 2);
    assert(out0 >= 1 && d5.broken !== undefined && d5.clones.live === 0 && !d5.clones.packLive && ledgerN(d5) === 0, `a posture break pops all and calls off the rest (${out0} out → ${d5.clones.live}, packs ${d5.clones.packLive})`);
    G5.game.flow.debug.toState('boss');
    d5.debug.setAI(false);
    run(G5, 0.5);
    d5.enterPhase(3);
    d5.debug.pack('allAtOnce');
    run(G5, 0.9);
    const mid = d5.clones.live;
    d5.reset();
    fresh(G5);
    assert(mid >= 1 && d5.clones.live === 0 && !d5.clones.packLive && !d5.hurtSpheres.some((h) => String(h.part).startsWith('clone')) && d5.clones.list.filter((x) => x.root.visible).length === 4 && d5.clones.seated, `reset mid-pack (${mid} out): no live self, no pack, no sphere left; he sits among four seated selves again`);
    const h0 = G5.hits.length;
    run(G5, 2);
    assert(G5.hits.slice(h0).filter((h) => h.attack === 'allAtOnce').length === 0, 'and the reset pack never strikes');
  }
  // the selves are not him: no body circle, no shadow
  assert(d.bodyCircles.length === 1 && d.bodyCircles[0] === d._bc, 'no body circle of theirs: the hero walks through paper');
  assert(!d.clones.list.some((c) => c.root.userData?.caster), 'not shadow casters');
}

// ================================================================== scenario: pearl
async function scenarioPearl() {
  out('\n== scenario PEARL (the charge, the threads, the burst by live selves, a roll, a guard, the interrupt, the ledger, the world) ==');
  const T = TUNING.pearl;
  const play = (G, { defend = null, hits = 0, heavy = false, dist = 4.5, move = 'foxPearl', form = 2, pop = false } = {}) => {
    const { game } = G;
    const d = game.dragon, p = game.player;
    duel(G, { dist, form });
    p.debug.god = true;
    const threads = [];
    const ft = d.fx.pearlThread;
    let thr = 0, frameThr = 0;
    d.fx.pearlThread = (...a) => { thr++; return ft.apply(d.fx, a); };
    let bursts = 0, r = 0;
    const fb = d.fx.pearlBurst;
    d.fx.pearlBurst = (x, z, rr) => { bursts++; r = rr; return fb.call(d.fx, x, z, rr); };
    assert(d.debug.trigger(move), `${move} starts`);
    let ledgerSaw = false, struck = 0, selves = 0, popped = 0;
    const hit0 = G.hits.length;
    run(G, 6, () => {
      if (d.pearl.charging) {
        selves = d.pearl.selves;
        // (pop: every harrying body cut down as it shows, the helper beside him too)
        if (pop) for (const c of d.clones.list) if (c.alive && c.state !== 'assist') popped += d.clones.popAt(c.i, NaN, 0, NaN, false, 'cut');
        threads.push(thr - frameThr);
        frameThr = thr;
        if (!ledgerSaw) ledgerSaw = d.brain.ledger.pending?.(2, 4) ?? false;
        if (hits && struck < hits && d.pearl.u > 0.3 && d.pearl.u < 0.9 && ((game.realTime * 60) | 0) % 10 === 0) {
          struck++;
          d.takeHit({ damage: 20, part: 'body', heavy, point: { x: d.position.x, y: 1.2, z: d.position.z }, swing: true });
        }
      }
      defend?.(G);
    }, () => d.mode === 'foot' && !d.pearl.flying && !d.pearl.charging);
    d.fx.pearlThread = ft;
    d.fx.pearlBurst = fb;
    if (process.env.DBG) out('   hits ' + JSON.stringify(G.hits.slice(hit0).map((h) => [h.t.toFixed(2), h.attack, h.r])) + ' dist ' + Math.hypot(d.position.x - p.position.x, d.position.z - p.position.z).toFixed(2) + ' stats ' + JSON.stringify(d.brain.stats));
    const mine = G.hits.slice(hit0).filter((h) => h.attack === move);
    return { d, threads, bursts, r, mine, ledgerSaw, selves, popped };
  };
  // the burst grows with the selves that fed it: the one shaping it, and every harrying body that struck
  for (const form of [1, 2]) {
    const G = build();
    const R = play(G, { form });
    const want = Math.min(T.rMax, T.r0 + T.perClone * R.selves);
    const n = perPhaseT(MOVES.foxPearl.beats[1].pack.n, form);
    assert(R.bursts === 1 && Math.abs(R.r - want) < 1e-6 && R.selves >= 2 && R.selves <= 1 + n, `phase ${form}: ${R.selves} selves fed it (the helper + up to ${n} that struck): the drive bursts r ${R.r.toFixed(2)} (want ${want.toFixed(2)})`);
    assert(R.mine.length === 1 && Math.abs(R.mine[0].damage - (T.damage + T.perCloneDamage * R.selves) * TUNING.damageScale) < 1e-6, `phase ${form}: its blow ${R.mine[0]?.damage?.toFixed?.(1) ?? '-'} (fed by them)`);
    assert(Math.max(0, ...R.threads) >= 1, 'a thread from each self out to the Pearl');
  }
  {
    const G = build();
    const R = play(G, { form: 2, pop: true });
    assert(R.popped >= 1 && R.selves === 1, `the harrying bodies popped as they show: only the helper feeds it (${R.selves})`);
  }
  // Pearl Rain (phase 2): three pearls thrown in a row
  {
    const G = build();
    const R = play(G, { move: 'pearlRain', dist: 7 });
    assert(R.bursts === T.count[1], `Pearl Rain: ${R.bursts} pearls burst (${T.count[1]})`);
  }
  // the ledger knows it from the charge (the volley: told as it is shaped)
  {
    const G = build();
    const R = play(G, { move: 'pearlRain', dist: 7 });
    assert(R.ledgerSaw, 'the ledger is told of the volley\'s landing while it is shaped');
  }
  {
    const G = build();
    const R = play(G, {});
    assert(R.mine.length === 1 && R.mine[0].r === RESULT.HIT && R.mine[0].tell === TELL.RED, `standing still: it hits once, red (${R.mine.map((h) => h.r).join(',')})`);
  }
  // a guard fails; a roll dodges
  {
    const G = build();
    const R = play(G, { defend: (GG) => GG.input.press(1) });
    assert(R.mine.length === 1 && R.mine[0].r === RESULT.HIT, `a guard does not hold it (${R.mine.map((h) => h.r)})`);
  }
  {
    const G = build();
    let rolled = false;
    G.defend = makeDefender(G);
    const R = play(G, { defend: (GG) => { const due = GG.defend.act(); rolled = rolled || GG.game.player.state === 'roll'; return due; } });
    assert(rolled && R.mine.every((h) => h.r !== RESULT.HIT), `a roll at its cue dodges it (${R.mine.map((h) => h.r).join(',') || 'missed'})`);
  }
  // two cuts on him while he charges burst it in his hand: he reels
  {
    const G = build();
    let reeled = false, stag = 0;
    G.watch = (n) => { if (n === 'dragon:stagger') stag++; };
    const R = play(G, { hits: 2, defend: (GG) => { reeled = reeled || GG.game.dragon.brain.react?.kind === T.interrupt.react; } });
    G.watch = null;
    assert(R.d.pearl.interrupts === 1 && reeled && stag >= 1 && R.bursts === 0 && R.mine.length === 0, `two cuts while he charges: it bursts in his hand, he reels (${R.d.pearl.interrupts} interrupts, ${R.bursts} bursts)`);
  }
  {
    const G = build();
    const R = play(G, { hits: 1, heavy: true });
    assert(R.d.pearl.interrupts === 1, 'one heavy cut does it too');
  }
  // his guard is down through the charge
  {
    const G = build();
    const d = G.game.dragon;
    duel(G, { dist: 5, form: 1 });
    d.debug.trigger('foxPearl');
    run(G, 0.6);
    assert(d.pearl.charging && !d.guarding, 'his guard is down while he charges');
  }
  // the world: it chips what it lands on (the real set)
  {
    const G = build(SEED, true);
    const { game } = G;
    let calls = 0;
    const imp0 = game.world.impact;
    game.world.impact = (...a) => { calls++; return imp0(...a); };
    const D = game.world.destructibles;
    const worn0 = D.list.filter((b) => b.wear > 0 || b.state !== 0).length;
    const R = play(G, { dist: 8 });
    const worn1 = D.list.filter((b) => b.wear > 0 || b.state !== 0).length;
    assert(R.bursts >= 1 && calls >= R.bursts && worn1 > worn0, `world.impact on each burst (${calls}), the floor chipped (${worn0} → ${worn1} pieces worn)`);
  }
  // a reset in the middle of the charge and with pearls in the air leaves nothing behind
  {
    const G = build();
    const d = G.game.dragon;
    duel(G, { dist: 6, form: 2 });
    d.debug.trigger('foxPearl');
    run(G, 1.0);
    const was = d.pearl.charging;
    d.debug.reset();
    fresh(G);
    assert(was && !d.pearl.charging && !d.pearl.flying && d.clones.live === 0 && d.mode === 'sleep', 'a reset mid-charge: no pearl, no self, he sits again');
    G.game.flow.debug.toState('boss');
    d.debug.setAI(false);
    run(G, 0.5);
    d.enterPhase(2); // (Pearl Rain is phase 2's; the reset put him back in phase 1)
    d.debug.trigger('pearlRain');
    run(G, 3, null, () => d.pearl.flying);
    const fl = d.pearl.flying;
    d.debug.reset();
    run(G, 1);
    assert(fl && !d.pearl.flying && G.hits.filter((h) => h.attack === 'pearlRain').length === 0, 'a reset with pearls in the air: they are gone and hit nothing');
  }
}

// ================================================================== scenario: mantle
async function scenarioMantle() {
  out('\n== scenario MANTLE (phase 3 only, it lights the wood) ==');
  const G = build(SEED, true);
  const { game } = G;
  const d = game.dragon;
  let ign = 0;
  const ig0 = game.world.ignite;
  game.world.ignite = (...a) => { ign++; return ig0?.(...a); };
  duel(G, { dist: 4, form: 2 });
  run(G, 3);
  assert(d.mantleK === 0 && ign === 0, 'phase 2: no mantle, nothing lit');
  d.brain.forcePhase(3);
  run(G, 5, null, () => d.phase === 3 && d.mode === 'foot');
  run(G, 2);
  assert(d.mantleK > 0.9 && ign >= 2, `phase 3: the mantle is on (${d.mantleK.toFixed(2)}), world.ignite where he stands (${ign})`);
  // a charm post catches (the set's wood, 16.5 m out: past his bound, 12.2): he fights at the rim and
  // the tail's sweep throws its flame past the cut
  const D = game.world.destructibles;
  const post = D?.list.find((b) => b.kind === 'charmPost');
  assert(!!post, 'the set has charm posts');
  if (post) {
    d.debug.setAI(false);
    run(G, 4, null, () => d.mode === 'foot');
    const a = Math.atan2(post.x, post.z), B = d.bound;
    d.position.set(Math.sin(a) * B, 0, Math.cos(a) * B);
    game.player.debug.teleport(Math.sin(a + 0.13) * B, Math.cos(a + 0.13) * B); // (beside him along the rim: his step-in keeps him at it)
    run(G, 0.3);
    const ig1 = game.world.ignite, calls = [];
    game.world.ignite = (x, z, r, k, gr) => { calls.push(`r${Math.hypot(x, z).toFixed(1)}+${r.toFixed(1)} k${k.toFixed(2)} d${Math.hypot(x - post.x, z - post.z).toFixed(2)}`); return ig1(x, z, r, k, gr); };
    d.debug.trigger('burningBrush');
    run(G, 4, null, () => post.burn > 0 || post.burnt);
    game.world.ignite = ig1;
    out(`     ignites: ${calls.join(' · ')}; post at ${post.x.toFixed(1)}, ${post.z.toFixed(1)} r ${post.r}; burns ${post.burns}`);
    assert(post.burn > 0 || post.burnt, `Burning Brush at the rim: a charm post ${Math.hypot(post.x, post.z).toFixed(1)} m out catches (burn ${post.burn?.toFixed?.(1)})`);
  }
  d.debug.kill();
  run(G, 4);
  assert(d.mantleK < 0.5, 'dying, the mantle goes out');
  game.world.ignite = ig0;
}

// ================================================================== scenario: phase
async function scenarioPhase() {
  out('\n== scenario PHASE (the gates, both transitions, the selves taken back) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon;
  duel(G, { dist: 4, ai: true });
  game.player.debug.god = true;
  const gate = d.maxHp * TUNING.phaseAt[1];
  d.debug.pack({ n: 2, mode: 'sequence', gap: 0.4, form: 'ring', blow: 'cross', tell: TELL.NORMAL, from: 2.5 }, { attack: 'testPack' });
  d.hp = gate + 20;
  d.mode = 'foot';
  d.brain.act = null;
  d.takeHit({ damage: 400, part: 'body', heavy: true, poise: 5, exact: true });
  assert(d.hp === gate && d.brain.pendingPhase === 2, `damage stops at the gate (${d.hp} = ${gate})`);
  let p2 = 0;
  G.watch = (n) => { if (n === 'dragon:phase2') p2++; };
  run(G, 1, null, () => d.brain.act?.name === 'thousandBodies');
  assert(d.brain.act?.name === 'thousandBodies' && d.phase === 2 && p2 === 1 && d.clones.live === 0, 'A Thousand Bodies: phase 2, dragon:phase2, his selves popped');
  run(G, 4, null, () => d.mode === 'foot');
  assert(d.clones.live === 0 && !d.clones.packLive, `its ring goes out: no self stands about after it (${d.clones.live})`);
  assert(game.flow._text('phase2') === 'ONE BECOMES A THOUSAND', 'the level\'s phase-2 banner');
  settle(G, 8);
  const gate3 = d.maxHp * TUNING.phaseAt[2];
  d.hp = gate3 + 20;
  d.mode = 'foot';
  d.brain.act = null;
  d.takeHit({ damage: 400, part: 'body', heavy: true, poise: 5, exact: true });
  let p3 = 0, burned = 0;
  G.watch = (n, e) => { if (n === 'dragon:phase3') p3++; if (n === 'dragon:clone' && e.by === 'mantle') burned++; };
  const had = d.clones.live;
  run(G, 3, null, () => d.brain.act?.name === 'foxMantle');
  assert(d.brain.act?.name === 'foxMantle' && d.phase === 3 && p3 === 1 && d.clones.live === 0 && burned <= had, `The Fox-Fire Mantle: phase 3, the ${burned} selves out burn up into him (${d.brain.act?.name}, phase ${d.phase})`);
  run(G, 4, null, () => d.mode === 'foot');
  G.watch = null;
  assert(d.clones.live === 0 && d.mantleK > 0, `then the mantle, and no self stands about (${d.clones.live})`);
  assert(game.flow._text('phase3') === 'THE FOX WEARS ITS FIRE', 'the level\'s phase-3 banner');
  // (a sample, not one roll: the director weighs the Moon-Swallowing Pearl at about 1 % of a pick at 6 m
  // here (14 s cooldown, the sameCat / density factors), so 300 rounds missed it about one seed in 30;
  // the sounds' own random stream (ADR-165) moved this seed onto such a miss. 3000 rounds: a miss
  // about once in 10^14.)
  const picks = new Set();
  for (let i = 0; i < 3000; i++) {
    d.brain.cooldowns = {};
    d.brain.last = [null, null];
    for (const dist of [2, 6]) { const n = d.brain._choose(dist); if (n) picks.add(n); }
  }
  assert(['burningBrush', 'foxPounce', 'greatPearl'].every((n) => picks.has(n)), `phase-3 moves join the pool (${[...picks].join(', ')})`);
}

// ================================================================== scenario: flow
async function scenarioFlow() {
  out('\n== scenario FLOW (title → the terrace → he rises → the duel → victory; a death and a reset) ==');
  const G = build();
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  run(G, 0.3);
  input.tap('Enter');
  run(G, 0.5);
  if (game.state !== 'explore') game.flow.debug.toState('explore');
  run(G, 0.3);
  assert(game.state === 'explore' && d.mode === 'sleep', 'exploring; he sits');
  p.debug.teleport(0, CONFIG.world.bossTriggerZ + 2.5);
  run(G, 0.2);
  run(G, 4, () => { input.axis = { x: 0, y: 1 }; }, () => d.mode !== 'sleep');
  input.axis = { x: 0, y: 0 };
  assert(d.mode === 'intro' && game.state === 'bossIntro', `onto the terrace: he stirs (hero at z ${p.position.z.toFixed(1)}, ${game.state})`);
  run(G, 8, null, () => d.mode === 'foot' || d.mode === 'act');
  run(G, 0.2);
  assert(G.counts['dragon:introDone'] === 1 && game.state === 'boss', `the intro ends in the duel (${game.state})`);
  p.debug.god = false;
  p.hp = 1;
  d.debug.setAI(true);
  run(G, 25, null, () => game.state === 'dead');
  assert(game.state === 'dead', 'he can kill the hero');
  run(G, 12, () => { if (((game.realTime * 60) | 0) % 30 === 0) input.tap('Enter'); }, () => game.state === 'explore');
  assert(game.state === 'explore' && d.mode === 'sleep' && d.phase === 1 && d.clones.live === 0, `after the death he sits again, no self left (${game.state}, ${d.mode})`);
  game.flow.debug.toState('boss');
  run(G, 0.5);
  d.debug.kill();
  run(G, 8, null, () => game.state === 'victory');
  assert(game.state === 'victory' && game.flow._text('victory') === 'THE FOX IS UNMASKED', `killed: victory (${game.state})`);
}

// ================================================================== scenario: pace (copied from duel.mjs PACE)
// ================================================================== scenario: pace (the director's meter)
// A god-mode defender that never attacks, driven by combat:flash (his thrown things send no tell):
// the guard held through a normal / blue blow, a roll 0.28 s before a red / black one (out of a
// hazard's ring: away from its centre). The hero roams between standoffs (2.5 / 5 / 9 m, a new one
// every 4 s), on the REAL terrace. Per seed and per phase (every phase
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
          const k = Math.hypot(gx, gz) > 11 ? 11 / Math.hypot(gx, gz) : 1;
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
        if (d.fx.crescentsAlive || d.terrain?.busy) busy++;
        if (d.moveFx?.alive) burnF++;
        // (the Howl, summoned to burnt out, and his kneel after it (the hero's punish) are not empty gaps:
        // counted as a black blow's charge is, as asc.mjs counts Tian Lei's great beam)
        if (frames % 6 === 0 && (d.howl?.busy || (d.mode === 'act' && d.brain.act?.def?.verdict))) busyT.push(game.time);
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
  out('\n== scenario WIN (a fencing bot in god mode, three seeds: parries, rolls, cuts the selves in reach, cuts him in his openings) ==');
  const SEEDS = (process.env.GCD_WSEEDS ?? '4242,7,99').split(',').map(Number);
  for (const seed of SEEDS) {
    const G = build(seed);
    const MK = attachMarks(G.game); // (the floor marks the fight leaves: they change nothing in it)
    const { game } = G;
    const d = game.dragon;
    duel(G, { dist: 3, ai: true });
    G.defend = makeDefender(G);
    const phAt = [0];
    let pops = 0;
    G.watch = (n, e) => { if (/^dragon:phase[23]$/.test(n)) phAt.push(game.time); if (n === 'dragon:clone' && e.kind === 'pop' && e.by === 'cut') pops++; };
    const t0 = game.time;
    const won = run(G, 420, () => fencer(G), () => d.mode === 'dead' || d.state === 'dead' || game.state === 'victory');
    const T = game.time - t0;
    const taken = G.hits.filter((h) => h.r === RESULT.HIT).length;
    out(`     seed ${seed}: ${won ? 'won' : 'NOT won'} in ${T.toFixed(0)} s: phases at ${phAt.map((t) => (t - t0 > 0 ? (t - t0).toFixed(0) : '0')).join(' / ')} s, ${pops} selves cut down, ${taken} hits taken (god mode); phase ${d.phase}, hp ${Math.round(d.hp)}`);
    marksCheck(MK, 'fox', out, assert);
    assert(won && d.phase === 3, `seed ${seed}: the fencing bot wins through all three phases`);
    assert(T > 30 && T < 360, `seed ${seed}: the fight takes ${T.toFixed(0)} s`);
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
  assert(kinds.has('fox') && !kinds.has('ash') && !kinds.has('lord') && !kinds.has('asc') && kinds.has('duel'), `his own boss kind (${[...kinds].join(', ')})`);
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
  const G2 = build();
  duel(G2, { dist: 5 });
  const d2 = G2.game.dragon;
  const ok2 = d2.debug.phase2();
  run(G2, 5, null, () => d2.mode === 'foot');
  const ok3 = d2.debug.phase3();
  run(G2, 5, null, () => d2.mode === 'foot');
  assert(ok2 && ok3 && d2.phase === 3 && G2.counts['dragon:phase2'] === 1 && G2.counts['dragon:phase3'] === 1, 'the Lab\'s phase buttons: Phase 2, then Phase 3, each its transition');
  // the Lab's own buttons for him
  const G3 = build();
  duel(G3, { dist: 5, form: 2 });
  const d3 = G3.game.dragon;
  const made = d3.debug.pack('allAtOnce');
  const madeN = made?.bodies.length ?? 0;
  run(G3, 0.5);
  const out3 = d3.clones.live;
  const popped = d3.debug.popAll();
  const pearl = d3.debug.pearl();
  run(G3, 0.2);
  assert(madeN === 4 && out3 >= 1 && popped === out3 && !d3.clones.packLive && pearl && d3.brain.act?.name === 'foxPearl', `the Lab: a pack (${madeN} bodies), Pop all (${popped}), Pearl`);
  d3.debug.mantle(true);
  run(G3, 1.2);
  assert(d3.mantleK > 0.9, 'the Lab: Mantle on');
  d3.debug.mantle(false);
  run(G3, 1.2);
  assert(d3.mantleK === 0, 'the Lab: Mantle off');
}

// ================================================================== scenario: looks
async function scenarioLooks() {
  out('\n== scenario LOOKS (each ?foxLook= builds; the default h1 is ink-line, bright, with its selves; his letters follow his size and no other boss\'s do) ==');
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const PICK = LS.PICKED ?? {};
  assert(!('foxLook' in PICK) && !('foxfire' in PICK) && !('clones' in PICK) && !('foxLetters' in PICK), 'his switches are not in PICKED (the owner has not picked)');
  const { isDragonLook } = await imp('src/entities/enemies/ashDisciple/bodyArt.js');
  const { FOX_INK } = await imp('src/entities/enemies/thousandFox/bodyArt.js');
  const { foxLookNow } = await imp('src/entities/enemies/thousandFox/look.js');
  const selvesOf = (d) => d.clones?.list ?? [];
  /** The materials his rig draws with (each one a draw call of the rigid batch). */
  // (not the rigid batch's shadow mesh: its proxy material is never drawn in the world pass)
  const matsOf = (d) => { const s = new Set(); d.rig.root.traverse((o) => { if (o.isMesh && o.visible !== false && o.material?.uniforms) s.add(o.material); }); return s.size; };
  const INK = new Set(['d', 'h1', 'h2', 'h3']);
  for (const v of ['a', 'b', 'c', 'd', 'h1', 'h2', 'h3']) {
    LS.setLook('foxLook', v);
    let ok = true, meshes = 0, mats = 0, art = null;
    try {
      const G = build();
      const d = G.game.dragon;
      d.rig.root.traverse((o) => { if (o.isMesh) meshes++; });
      mats = matsOf(d);
      art = isDragonLook(d.rig.materials) && selvesOf(d).every((c) => isDragonLook(c.rig.materials));
      if (!INK.has(v)) art = art === true;
      else art = !isDragonLook(d.rig.materials) && selvesOf(d).every((c) => !isDragonLook(c.rig.materials));
      run(G, 0.3);
    } catch (e) { ok = false; out(`     ${v}: ${e.message}`); }
    assert(ok && meshes > 20 && meshes <= 70, `?foxLook=${v} builds (${meshes} meshes, ${mats} materials)`);
    assert(art, `?foxLook=${v}: he and his selves are drawn ${INK.has(v) ? 'in the ink-line art' : 'through the wyrm\'s art path (FLAG.ART)'}`);
  }
  LS.setLook('foxLook', 'zz');
  assert(foxLookNow().id === 'h1', 'an unknown ?foxLook= draws the default (h1)');
  LS.setLook('foxLook', null);
  // the default: h1, the ink-line Wild Fox, his fills written on him and on every self
  {
    const G = build();
    const d = G.game.dragon;
    const L = foxLookNow();
    assert(L.id === 'h1' && !L.art, `the default ?foxLook= is h1, the ink-line art (${L.id})`);
    const fillOf = (M, k) => M[k]?.uniforms?.uArtFill?.value?.toArray().map((x) => +x.toFixed(3));
    const want = FOX_INK.h1.coat.map((x) => +x.toFixed(3));
    const rigs = [d.rig, ...selvesOf(d).map((c) => c.rig)];
    assert(rigs.every((r) => JSON.stringify(fillOf(r.materials, 'coat')) === JSON.stringify(want)), `his jacket and every self's are the h1 amber (${JSON.stringify(want)})`);
    // bright: the jacket and the scarf are saturated fills past 1 (the pass lifts those, ADR-130's dark cloth does not)
    const lit = (c) => Math.max(...c) > 1 && (Math.max(...c) - Math.min(...c)) / Math.max(...c) > 0.6;
    assert(lit(FOX_INK.h1.coat) && lit(FOX_INK.h1.facing), 'h1: the jacket and the scarf are bright saturated fills');
    // lean: every rig of him (him and the pool) draws with at most ten materials
    assert(matsOf(d) <= 10, `h1 draws with ${matsOf(d)} materials a rig (<= 10)`);
  }
  // his letters follow his size (?foxLetters=b, the default): the bosses' ink-line cell is set from
  // his depth by the hero's rule; off, and for any other boss, the uniforms are setSize's own
  {
    const { Pipeline } = await imp('src/render/pipeline.js');
    const G = build();
    const { game } = G;
    const renderer = {
      extensions: { has: () => true }, autoClear: true, _dpr: 1,
      setRenderTarget() {}, setClearColor() {}, getClearColor() {}, getClearAlpha: () => 0, clear() {}, render() {},
      setPixelRatio(dp) { this._dpr = dp; }, getPixelRatio() { return this._dpr; }, setSize() {},
    };
    const cam = game.camera;
    const pipe = new Pipeline(renderer, game.scene, game.fxScene ?? new THREE.Scene(), cam, game.U);
    cam.fov = CONFIG.camera.fov;
    cam.updateProjectionMatrix();
    pipe.setSize(2560, 1440, 1);
    const u = pipe.asciiMat.uniforms, bs = game.U.uBossScreen.value, ps = new THREE.Vector4();
    const base = { cell: u.uHeroCell.value, x: pipe.heroCell.x, art: u.tHeroArt.value, px: u.uHeroPx.value.x };
    const frame = (n = 3) => { for (let i = 0; i < n; i++) pipe._updateBossLetters(bs); };
    const same = () => u.uHeroCell.value === pipe.heroCell && u.uHeroCell.value.x === base.x && u.tHeroArt.value === base.art && u.uHeroPx.value.x === base.px;
    bs.set(0.5, 0.5, 30, 1);
    pipe.bossLetters = false;
    frame();
    assert(same(), `off (a boss whose kit does not ask): the bosses' cell, atlas and line width are setSize's (${base.x} px)`);
    pipe.bossLetters = true;
    frame();
    ps.set(0.5, 0.5, 30, 0);
    pipe.selfCell.set(0, 0);
    for (let i = 0; i < 3; i++) pipe._updateHeroLetters(ps);
    const boss = u.uHeroCell.value.x, hero = pipe.selfCell.x;
    assert(boss === hero && boss > base.x && u.tHeroArt.value !== base.art && u.uHeroPx.value.x >= base.px, `on, at 1440p and 30 m his cell is the hero's at that depth (${boss} px = ${hero} px > the fixed ${base.x} px)`);
    bs.set(0.5, 0.5, 4, 1);
    frame(6);
    assert(u.uHeroCell.value.x === base.x, `on, close up (4 m) his cell goes back to the fixed one (${u.uHeroCell.value.x} px)`);
    bs.set(0.5, 0.5, NaN, 1);
    frame();
    assert(Number.isFinite(u.uHeroCell.value.x) && u.uHeroCell.value.x >= base.x, 'a NaN depth keeps a finite cell');
    pipe.bossLetters = false;
    frame();
    assert(same(), 'turned off, every uniform is given back exactly');
    pipe.setSize(1280, 720, 1);
    pipe.bossLetters = true;
    bs.set(0.5, 0.5, 30, 1);
    frame();
    assert(u.uHeroPx.value.x >= 1 && u.tHeroArt.value != null, 'after a resize his cell is written again');
    // the gate (main.js): only a kit that asks has it, and ?foxLetters=a turns it off
    const kits = await Promise.all([
      ['ashDisciple/disciple.js', 'ASH_KIT'], ['sheathed/sheathed.js', 'SHEATHED_KIT'], ['starlessLord/lord.js', 'LORD_KIT'],
    ].map(async ([f, k]) => (await imp(`src/entities/enemies/${f}`))[k]));
    // (Tian Lei's kit asks too, ADR-155: a getter on his `?ascLetters=a`, the owner's pick)
    const tian = (await imp('src/entities/enemies/ascendant/ascendant.js')).ASC_KIT;
    assert(kits.every((k) => k && !k.letters) && game.dragon.kit.letters === true && tian.letters === true, 'only his kit and Tian Lei\'s ask for letters that follow their size (Shen Hui, Lu Wusheng, Varr Nihil: no)');
    const main = fs.readFileSync(`${ROOT}/src/main.js`, 'utf8');
    assert(/pipeline\.bossLetters\s*=\s*!!game\.dragon\?\.kit\?\.letters\s*&&\s*lookOf\('foxLetters', 'b'\) === 'b'/.test(main), 'main.js sets the pipeline\'s bossLetters from the kit and ?foxLetters each frame');
    LS.setLook('foxLetters', 'a');
    assert(LS.lookOf('foxLetters', 'b') === 'a', '?foxLetters=a reads off');
    LS.setLook('foxLetters', null);
  }
  for (const v of ['a', 'b']) {
    LS.setLook('clones', v);
    const G = build();
    assert(G.game.dragon.clones.list.length === TUNING.clones.pool, `?clones=${v} builds`);
  }
  LS.setLook('clones', null);
  for (const v of ['a', 'b', 'c']) {
    LS.setLook('foxfire', v);
    const G = build();
    assert(G.game.dragon.fx.look === v, `?foxfire=${v}`);
  }
  LS.setLook('foxfire', null);
}

// ================================================================== scenario: cost (opt-in: the selves' CPU)
async function scenarioCost() {
  out('\n== scenario COST (opt-in: what a pack of five paper selves costs the frame on the CPU) ==');
  const G = build();
  const d = G.game.dragon;
  duel(G, { dist: 4, form: 3 });
  G.game.player.debug.god = true;
  const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) G.tick(DT); return (performance.now() - t0) / n; };
  time(60);
  const none = time(300);
  const again = () => { if (!d.clones.packLive) d.debug.pack({ n: 5, mode: 'sequence', gap: 0.4, form: 'ring', blow: 'cross', tell: TELL.NORMAL, from: 2.4 }, { attack: 'costPack' }); };
  const T0 = G.tick;
  G.tick = (dt) => { again(); T0(dt); };
  time(60);
  let poseT = 0;
  const pose = d.clones.pose.bind(d.clones);
  d.clones.pose = (dt) => { const t0 = performance.now(); pose(dt); poseT += performance.now() - t0; };
  const C0 = d.clones.list[0];
  const T = { anim: 0, mw: 0, gs: 0 };
  for (const c of d.clones.list) {
    const au = c.anim.update.bind(c.anim);
    c.anim.update = (dt) => { const t0 = performance.now(); au(dt); T.anim += performance.now() - t0; };
    const um = c.root.updateMatrixWorld.bind(c.root);
    c.root.updateMatrixWorld = (f) => { const t0 = performance.now(); um(f); T.mw += performance.now() - t0; };
  }
  const five = time(300);
  out(`     anim.update ${(T.anim / 300).toFixed(2)} ms, updateMatrixWorld ${(T.mw / 300).toFixed(2)} ms a frame (5 selves)`);
  const au = d.anim.update.bind(d.anim);
  let ba = 0;
  d.anim.update = (dt) => { const t0 = performance.now(); au(dt); ba += performance.now() - t0; };
  time(120);
  out(`     his own anim.update ${(ba / 120).toFixed(2)} ms a frame`);
  out(`     a frame: ${none.toFixed(2)} ms with no self, ${five.toFixed(2)} ms with a pack of five cycling; their poses ${(poseT / 300).toFixed(2)} ms a frame`);
}

// ================================================================== scenario: beam (the Howl)
/** The Howl from a set-up: phase 3, him at (0, -2), the hero `dist` m from him at `ang` (AI off). Plays
 *  it to the end (busy off and him on his feet) and returns what happened. `step(I)` runs before every
 *  tick (the hero's input). */
function howlPlay(G, { dist = 6, ang = 0, god = false, step = null, max = 14, until = null } = {}) {
  const { game, input } = G;
  const d = game.dragon, p = game.player, H = d.howl;
  d.debug.setAI(false);
  settle(G, 4);
  d.position.set(0, 0, -2);
  d.yaw = 0;
  place(G, dist, ang);
  p.debug.god = god;
  run(G, 0.2);
  input.axis = { x: 0, y: 0 };
  const I = {
    flashT: null, fixedAt: null, fixedYaw: null, litYaw: null, hits: [], hp0: p.hp, guard0: p.guard, minGuard: p.guard,
    start: { x: p.position.x, z: p.position.z }, hidden0: !H.spirit.visible && H.spirit.root.visible === false,
    seen: 0, peakFire: 0, phases: new Set(), states: new Set(), dimMax: 0, heldMax: 0, flashes: 0, tells: [],
  };
  const h0 = G.hits.length;
  G.watch = (n, e) => {
    if (n === 'combat:flash' && e?.source === 'dragon') {
      I.flashes++;
      if (e.attack === 'foxVerdict' && I.flashT === null) { I.flashT = game.time; I.flashTell = e.tell; I.flashY = e.y; }
    }
    if (n === 'combat:tell' && e?.source === 'dragon') I.tells.push(e.tell);
    if (n === 'combat:charge' && e?.attack === 'foxVerdict') I.charge = true;
  };
  if (!d.debug.howl()) return null;
  for (let i = 0, n = Math.round(max / DT); i < n; i++) {
    step?.(I);
    G.tick(DT);
    const B = H.B;
    I.phases.add(H.phase);
    I.states.add(p.state);
    if (B.fixed && I.fixedAt === null) { I.fixedAt = B.fixedAt; I.fixedYaw = B.yaw; }
    if (B.on && I.litYaw === null) I.litYaw = B.yaw;
    if (H.spirit.visible) I.seen++;
    I.peakFire = Math.max(I.peakFire, game.fx.fire.count);
    I.dimMax = Math.max(I.dimMax, game.world.forest?.light?.state?.dim ?? 0);
    I.heldMax = Math.max(I.heldMax, game.cameraRig.held ?? 0);
    I.minGuard = Math.min(I.minGuard, p.guard);
    if (until?.(I)) break;
    if (i > 30 && !H.busy && d.mode === 'foot') break;
  }
  G.watch = null;
  input.axis = { x: 0, y: 0 };
  input.up(1);
  I.hits = G.hits.slice(h0).filter((h) => h.attack === 'foxVerdict');
  I.lost = I.hp0 - p.hp;
  I.moved = Math.hypot(p.position.x - I.start.x, p.position.z - I.start.z);
  I.hiddenAfter = !H.spirit.visible && H.spirit.root.visible === false && !H.busy;
  // (a tick touched the hero: its parts land at one instant; the first contact is the first of them)
  const times = [...new Set(I.hits.filter((h) => h.r === RESULT.HIT || h.r === RESULT.BLOCKED).map((h) => h.t.toFixed(4)))];
  I.touches = times.length;
  return I;
}

async function scenarioBeam() {
  out('\n== scenario BEAM (Heaven-Devouring Howl: the line fixed at the cue, a roll through it, three ticks, the guard, the world, the fox, resets, when) ==');
  const VT = TUNING.verdict;
  const G = build(SEED, true);
  const { game, input } = G;
  const d = game.dragon, p = game.player, H = d.howl;
  duel(G, { dist: 6, form: 3 });
  // ---- the data: one red beat (the summoning + the charge), sustained, dealt by beam.js; the kneel
  const A = realise('foxVerdict', 3, () => 0.5);
  const real = A.beats.filter((b) => !b.feint), bb = real[0];
  assert(real.length === 1 && bb.def.tell === TELL.RED && bb.def.selfHit && bb.def.sustain && Math.abs(bb.impact - bb.start - (VT.summon + VT.charge)) < 1e-6 && Math.abs(bb.end - bb.impact - VT.lit) < 1e-6,
    `the Howl: a flit, then ONE red beat (${(bb.impact - bb.start).toFixed(2)} s windup: the summoning + the charge), lit ${(bb.end - bb.impact).toFixed(2)} s (sustain, selfHit)`);
  assert(MOVES.foxVerdict.recoverOpen === 1 && Math.abs(A.end - A.recoveryStart - VT.kneel) < 1e-6, `then he kneels ${(A.end - A.recoveryStart).toFixed(2)} s, his guard down all of it`);
  // ---- 1. standing in it (god): the line fixed at the cue, the first contact, at most three ticks
  // (once it has lit and he is up again, the hero is put back in its strip every frame: the ticks)
  const st = howlPlay(G, { dist: 6, god: true, step: () => {
    const B = H.B;
    if (!B.on || B.t < 0.3 || B.taken < 0 || p.state === 'knockdown') return;
    p.debug.teleport(B.ox + B.dx * 10, B.oz + B.dz * 10);
  } });
  assert(!!st && st.hidden0, 'the fox is hidden before the Howl');
  assert(st.charge && st.tells.includes(TELL.RED) && st.flashTell === TELL.RED && st.flashY > 4, `the summoning: the darkness of a charge (combat:charge), the cue red, its flare at the jaws (${st.flashY?.toFixed(1)} m up)`);
  assert(st.flashT !== null && st.fixedAt !== null && st.fixedAt <= st.flashT + DT * 1.5 && st.fixedAt >= st.flashT - 0.05 && Math.abs(wrapA(st.litYaw - st.fixedYaw)) < 1e-6,
    `the line is FIXED at the cue (fixed ${((st.fixedAt - st.flashT) * 1000).toFixed(0)} ms from the flare) and fires as fixed`);
  const first = st.hits.find((h) => h.r === RESULT.HIT);
  const dmgScale = TUNING.damageScale ?? 1;
  assert(!!first && Math.abs(first.damage - VT.first.damage * dmgScale) < 1e-6 && st.states.has('knockdown') && st.touches === 1 + VT.maxTicks && H.stats.thrown >= 1, `standing in it: the first contact (${first?.damage?.toFixed(1)}, knocked down), then ticks: ${st.touches - 1} (at most ${VT.maxTicks}, the last throws him clear)`);
  assert(st.seen > 100 && st.hiddenAfter && st.phases.has('summon') && st.phases.has('charge') && st.phases.has('lit') && st.phases.has('end'), `the fox stands ${(st.seen * DT).toFixed(1)} s (summon → charge → lit → end), hidden after`);
  assert(st.dimMax > VT.dim * 0.8 && st.heldMax > 2, `the terrace's light dropped (to ${st.dimMax.toFixed(2)}), the camera pulled back (${st.heldMax.toFixed(1)} m)`);
  out(`     the fire field's peak through the Howl: ${st.peakFire} blobs alive (holds 6000)`);
  assert(st.peakFire < 3000, `the fire field stays under 3000 blobs through it (${st.peakFire})`);
  assert((game.world.forest.light?.state?.dim ?? 0) < 0.05, 'the light comes back');
  // ---- 2. rolled through: at the cue out of the line, then back through the sweep as it comes
  settle(G, 4);
  let rolls = 0;
  const rl = howlPlay(G, { dist: 7, step: (I) => {
    const B = H.B;
    if (p.state === 'roll' || !B.fixed) return;
    const q = p.position, ox = q.x - B.ox, oz = q.z - B.oz, across = -ox * B.dz + oz * B.dx, along = ox * B.dx + oz * B.dz;
    const sx = -B.dz, sz = B.dx; // the line's +across side
    // at the cue: out of the line to its side
    if (I.flashT !== null && !I.r0 && game.time >= I.flashT + TUNING.flashLead - 0.12) {
      I.r0 = true;
      const sd = across >= 0 ? 1 : -1;
      input.axis = { x: sx * sd, y: -sz * sd };
      input.tap('Space');
      rolls++;
      return;
    }
    // the sweep coming: roll back through it toward its other side when its near edge is close
    if (B.on && B.sign && I.r0 && !I.r1 && along > 0) {
      const toward = B.sign > 0 ? -1 : 1; // (the side the line turns to: across < 0 for +sign)
      const sd = across >= 0 ? 1 : -1;
      const gap = Math.abs(across) - B.w / 2 - 0.45;
      if (sd === toward && gap < 0.9) {
        I.r1 = true;
        input.axis = { x: -sx * sd, y: sz * sd };
        input.tap('Space');
        rolls++;
      }
    }
  } });
  assert(!!rl && rl.lost === 0 && rolls >= 1, `rolled out at the cue and back through the sweep (${rolls} rolls): ${rl?.lost?.toFixed?.(1)} HP lost, hits ${rl?.hits.map((h) => h.r).join(',')}`);
  // ---- 3. a held guard facing it: guard per tick, never health, and a slide along it
  settle(G, 4);
  p.guard = 100;
  const gd = howlPlay(G, { dist: 7, step: () => { input.press(1); game.mouseGround.set(d.position.x, 0, d.position.z); } });
  const gh = gd?.hits ?? [];
  assert(!!gd && gd.lost === 0 && gh.some((h) => h.r === RESULT.BLOCKED) && gd.guard0 - gd.minGuard > VT.guard.cost && H.stats.blocked > 0, `a held guard: ${gd?.lost?.toFixed?.(1)} HP lost, guard ${Math.round(gd?.guard0)} → ${Math.round(gd?.minGuard)}`);
  assert(gd.moved > 1.5, `... and slid ${gd.moved.toFixed(2)} m along it (then out of its side)`);
  // ---- 4. the world breaks along it (the real set): a sweep, a trench of impacts, fire past the kerb
  {
    const G2 = build(SEED, true);
    const g2 = G2.game, d2 = g2.dragon, W = g2.world;
    const calls = { sweep: 0, impact: 0, ignite: 0 };
    const sw = W.destructibles.sweep.bind(W.destructibles), im = W.impact, ig = W.ignite;
    W.destructibles.sweep = (...a) => { calls.sweep++; return sw(...a); };
    W.impact = (...a) => { calls.impact++; return im(...a); };
    W.ignite = (...a) => { calls.ignite++; return ig(...a); };
    duel(G2, { dist: 6, form: 3 });
    const before = W.destructibles.list.filter((b) => !b.floor && b.state === 0).length;
    const wr = howlPlay(G2, { dist: 9, ang: 0.4, god: true });
    const after = W.destructibles.list.filter((b) => !b.floor && b.state === 0).length;
    assert(!!wr && calls.sweep >= 8 && calls.impact >= 10 && calls.ignite >= 1, `the world: ${calls.sweep} sweeps, ${calls.impact} impacts (the trench), ${calls.ignite} fires past the kerb; standing pieces ${before} → ${after}`);
  }
  // ---- 5. a reset mid-charge and mid-beam leaves nothing
  for (const at of ['charge', 'lit']) {
    const G3 = build(SEED, true);
    const g3 = G3.game, d3 = g3.dragon, H3 = d3.howl, U = g3.U;
    duel(G3, { dist: 6, form: 3 });
    g3.player.debug.god = true;
    run(G3, 1);
    const moon0 = U.uMoonColor.value.clone(), amb0 = U.uAmbient.value.clone();
    d3.debug.setAI(false);
    d3.debug.howl();
    run(G3, 8, null, () => H3.phase === at && (at !== 'lit' || H3.B.t > 0.6));
    const was = H3.phase;
    d3.debug.reset();
    run(G3, 0.05);
    const clean = !H3.busy && !H3.spirit.visible && H3.spirit.root.visible === false && !H3.B.on && (g3.world.forest.light?.state?.dim ?? 0) === 0 && U.uMoonColor.value.equals(moon0) && U.uAmbient.value.equals(amb0);
    run(G3, 2.5);
    const fire = g3.fx.fire.count, held = g3.cameraRig.held;
    assert(was === at && clean && fire === 0 && held < 0.2, `a reset mid-${at}: nothing lit, the fox hidden, the light back at once, no heat after (${fire} blobs), the camera back (${held.toFixed(3)} m)`);
  }
  // ---- 6. when: not before T.start s into phase 3; forced once under T.forceAt
  {
    const G4 = build(SEED, true);
    const g4 = G4.game, d4 = g4.dragon, H4 = d4.howl;
    duel(G4, { dist: 6, form: 3 });
    g4.player.debug.god = true;
    let early = 0;
    for (let i = 0; i < 300; i++) {
      d4.brain.cooldowns = {};
      d4.brain.last = [null, null];
      for (const dist of [2, 6, 10]) if (d4.brain._choose(dist) === 'foxVerdict') early++;
    }
    const w0 = d4.weigh('foxVerdict', MOVES.foxVerdict, 1);
    run(G4, VT.start + 0.5, () => { d4.debug.setAI(false); });
    const w1 = d4.weigh('foxVerdict', MOVES.foxVerdict, 1);
    let late = 0;
    for (let i = 0; i < 300; i++) {
      d4.brain.cooldowns = {};
      d4.brain.last = [null, null];
      for (const dist of [2, 6, 10]) if (d4.brain._choose(dist) === 'foxVerdict') late++;
    }
    assert(early === 0 && w0 === 0 && w1 > 0 && late > 0, `not picked before ${VT.start} s into phase 3 (${early} of 900 picks; weight ${w0}), picked after (${late} of 900; weight ${w1})`);
    // forced: the first time his bar is under T.forceAt (before T.start: the weigh would say no)
    const G5 = build(SEED, true);
    const g5 = G5.game, d5 = g5.dragon, H5 = d5.howl;
    duel(G5, { dist: 6, form: 3 });
    g5.player.debug.god = true;
    d5.debug.setAI(true);
    d5.hp = d5.maxHp * (VT.forceAt - 0.02);
    run(G5, 6, null, () => d5.brain.act?.name === 'foxVerdict');
    const forcedNow = d5.brain.act?.name === 'foxVerdict';
    run(G5, 14, null, () => !H5.busy && d5.mode === 'foot');
    assert(forcedNow && H5.used && H5.forced() === null, `under ${VT.forceAt * 100} % in phase 3 it is forced at once (${forcedNow}), once (then forced() → ${H5.forced()})`);
  }
  // ---- 7. the paper selves in its strip pop (a self set on the line before it fires)
  {
    const G6 = build(SEED, true);
    const g6 = G6.game, d6 = g6.dragon, H6 = d6.howl;
    duel(G6, { dist: 6, form: 3 });
    g6.player.debug.god = true;
    d6.debug.setAI(false);
    d6.debug.howl();
    run(G6, 8, null, () => H6.B.on);
    let popped = 0;
    G6.watch = (n, e) => { if (n === 'dragon:clone' && e?.by === 'beam') popped++; };
    // (a self torn free and set on the line by hand: whatever moves the selves, one in its strip pops)
    const C6 = d6.clones;
    // (a self that stands where it is put: the one he leaves behind when he trades places, held 5 s)
    const c = C6.list.find((o) => o.state === 'dead');
    if (c) {
      C6._show(c, H6.B.ox + H6.B.dx * 8, 0, H6.B.oz + H6.B.dz * 8, 0);
      c.state = 'swapped';
      c.until = C6.clock + 5;
    }
    run(G6, 0.3);
    G6.watch = null;
    assert(H6.stats.popped >= 1 || popped >= 1, `a paper self in its strip pops (${H6.stats.popped})`);
  }
}
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ================================================================== scenario: motion (ADR-223: held tells, the feet, the quick blows)
/** With `?foxMotion=a` every blue / red blow that is not a draw, a cast or a long charge holds its cock
 *  >= 0.12 s, in a pose that is coloured (blue taller, red lower than as authored); its windup is HELD.hold
 *  longer, the strike from the cock and the cue as before; '0' plays the authored keys exactly; no foot
 *  jumps more than 0.3 m in a frame (the release ease). */
async function scenarioMotion() {
  out('\n== scenario MOTION (ADR-223: the held blue / red windups, the released feet, the quick blows) ==');
  const { makeAudit } = await import(pathToFileURL(`${ROOT}/tests/integration/motionAudit.mjs`).href);
  const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const { HELD } = await imp('src/entities/enemies/duelist/heldTells.js');
  // 1. the data: off = authored; on = the same strike, HELD.hold more at the cock
  {
    let n = 0;
    const bad = [];
    for (const name of MOVE_NAMES) {
      const def = MOVES[name];
      if (def.transition || def.hidden || def.manual) continue;
      const ph = Math.max(1, def.phase ?? 1);
      setLook('foxMotion', '0');
      const A0 = realise(name, ph, () => 0.5);
      setLook('foxMotion', 'a');
      const A1 = realise(name, ph, () => 0.5);
      setLook('foxMotion', null);
      if (!A0 || !A1 || A0.beats.length !== A1.beats.length) { bad.push(`${name}: beats differ`); continue; }
      A0.beats.forEach((b0, i) => {
        const b1 = A1.beats[i], D = b0.def;
        const held = !b0.feint && (D.tell === TELL.BLUE || D.tell === TELL.RED) && !D.draw && !D.cast && !D.pack && D.windup < HELD.longer;
        const dW = (b1.impact - b1.start) - (b0.impact - b0.start);
        if (held) n++;
        if (Math.abs(dW - (held ? HELD.hold : 0)) > 1e-6) bad.push(`${name} b${i}: windup +${dW.toFixed(3)}`);
        if (Math.abs((b1.impact - b1.flash) - (b0.impact - b0.flash)) > 1e-6) bad.push(`${name} b${i}: cue moved`);
      });
    }
    assert(n >= 6 && !bad.length, `?foxMotion=a: ${n} blue / red blows wind up ${HELD.hold} s longer at the cock, every other beat and every cue as authored (${bad.slice(0, 4).join(' | ')})`);
  }
  // 2. on the rig: the held blows hold, coloured; the feet do not jump
  const rows = {};
  for (const mode of ['0', 'a']) {
    setLook('foxMotion', mode);
    for (const [name, ph, dist] of [['moonLadder', 1, 3], ['sweepingBrush', 1, 2.4], ['riposte', 1, 2.4], ['brushstrokes', 1, 2.4]]) {
      const G = build();
      duel(G, { dist: 4, form: ph });
      const A = makeAudit({ THREE, G, DT, place });
      rows[mode + name] = A.measure(name, { dist, phase: ph });
    }
  }
  setLook('foxMotion', null);
  for (const [name] of [['moonLadder', 1, 3], ['sweepingBrush', 1, 2.4], ['riposte', 1, 2.4], ['brushstrokes', 1, 2.4]]) {
    const r0 = rows['0' + name], r1 = rows['a' + name];
    const k0 = r0.beats.find((b) => b.tell === TELL.BLUE || b.tell === TELL.RED), k1 = r1.beats.find((b) => b.tell === TELL.BLUE || b.tell === TELL.RED);
    if (name === 'brushstrokes') { assert(r1.pop <= 0.3, `${name}: the jab's lifted foot no longer jumps (${r0.pop.toFixed(2)} ${r0.popK} -> ${r1.pop.toFixed(2)} ${r1.popK} m in a frame)`); continue; }
    if (!k0 || !k1) { assert(false, `${name}: a blue / red beat measured`); continue; }
    const taller = k1.tell === TELL.BLUE ? k1.cock.pel > k0.cock.pel + 0.01 : k1.cock.pel < k0.cock.pel - 0.03;
    assert(k1.held >= 0.12 && k1.held > k0.held && taller, `${name} (${k1.tell}): held ${k0.held.toFixed(2)} -> ${k1.held.toFixed(2)} s (>= 0.12), the cock's pelvis ${k0.cock.pel} -> ${k1.cock.pel} m (${k1.tell === TELL.BLUE ? 'taller' : 'lower'})`);
    if (true) assert(r1.pop <= 0.3, `${name}: no joint jumps more than 0.3 m in a frame (${r0.pop.toFixed(2)} ${r0.popK} -> ${r1.pop.toFixed(2)} ${r1.popK})`);
  }
  // 2b. every move, as shipped: no joint jumps more than 0.3 m in a frame (ADR-249: Hand to Hand's jab lifted
  // a lead foot the planner was still stepping and it jumped 0.43 m: anim.js liftFromStep)
  {
    const bad = [];
    let n = 0;
    for (const name of MOVE_NAMES) {
      const def = MOVES[name];
      if (def.hidden || def.transition || def.verdict) continue;
      const ph = Math.max(1, def.phase ?? 1);
      const G = build();
      duel(G, { dist: 4, form: ph });
      const A = makeAudit({ THREE, G, DT, place });
      const band = def.band ?? [0, 4];
      const r = A.measure(name, { dist: Math.max(2.0, Math.min(6, (band[0] + Math.min(band[1], 8)) / 2)), phase: ph });
      if (r.fail) { bad.push(`${name} ${r.fail}`); continue; }
      n++;
      if (r.pop > 0.3) bad.push(`${name} ${r.pop.toFixed(2)} ${r.popK}@${r.popAt}`);
    }
    assert(n >= 18 && !bad.length, `every move (${n}): no joint jumps more than 0.3 m in a frame (${bad.join(' | ') || 'ok'})`);
  }
  // 3. the limbs at the contact (ADR-249, ?foxLimbs=a, the default): a straight blow lands on an open arm,
  // a kick on a straight leg (the sweep through its turn), a bent blow keeps its bend; '0' as before
  {
    const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
    const CASES = [['foxBite', 1, 2.4], ['brushstrokes', 1, 2.0], ['riposte', 1, 2.0], ['foxPearl', 1, 4], ['sweepingBrush', 1, 1.6], ['changingPlaces', 1, 6], ['paperUpkick', 1, 1.6], ['relay', 2, 2.0], ['kiteString', 2, 4], ['foxPounce', 3, 6]];
    const rows = {};
    for (const mode of ['0', 'a']) {
      setLook('foxLimbs', mode);
      for (const [name, ph, dist] of CASES) {
        const G = build();
        duel(G, { dist: 4, form: ph });
        rows[mode + name] = anatomyOf(G, name, { dist, phase: ph });
      }
    }
    setLook('foxLimbs', null);
    const straight = [], kicks = [], bent = [];
    for (const [name] of CASES) {
      const r1 = rows['a' + name], r0 = rows['0' + name];
      if (r1.fail || r0.fail) { assert(false, `${name}: measured (${r1.fail ?? r0.fail})`); continue; }
      r1.beats.forEach((b, i) => {
        const was = r0.beats[i] ?? {};
        if (b.kick != null && b.part.startsWith('foot')) kicks.push([`${name}#${i}`, was.kick, b.kick]);
        else if (b.elbow) {
          const m = MOVES[name], beat = m.beats.filter((x) => !x.feint)[i], kind = beat?.mo?.kind ?? (beat?.pearl === 'drive' ? 'palm' : '?');
          if (['jab', 'cross', 'palm', 'double'].includes(kind)) straight.push([`${name}#${i}`, was.elbow?.[0], b.elbow[0]]);
          if (['hook', 'uppercut'].includes(kind)) bent.push([`${name}#${i}`, was.elbow?.[0], b.elbow[0]]);
        }
      });
    }
    const fmt = (L) => L.map(([n, a, b]) => `${n} ${a}->${b}`).join(', ');
    assert(straight.length >= 6 && straight.every(([, , e]) => e >= 155), `?foxLimbs=a: every straight blow lands on an open arm, elbow >= 155 deg (${fmt(straight)})`);
    assert(kicks.length >= 4 && kicks.every(([, , k]) => k >= 155), `?foxLimbs=a: every kick lands on a straight leg, knee >= 155 deg (${fmt(kicks)})`);
    assert(bent.length >= 2 && bent.every(([, , e]) => e >= 95 && e <= 130), `?foxLimbs=a: a hook / an uppercut keeps its bend, elbow 95 - 130 deg (${fmt(bent)})`);
    assert(straight.every(([, a]) => a < 150) && kicks.some(([, a]) => a < 140), `?foxLimbs=0: the limbs as before (bent at the contact)`);
  }
}

// ================================================================== scenario: audit (opt-in: every move's motion, printed)
/** Every move measured on the rig (motionAudit.mjs): a table for the eye, no assertions. GCD_MOVES=a,b to pick. */
async function scenarioAudit() {
  out('== scenario AUDIT (every move as motion: hand speed, pops, sliding feet, the held windup per tell, facing) ==');
  const { makeAudit } = await import(pathToFileURL(`${ROOT}/tests/integration/motionAudit.mjs`).href);
  // (GCD_LOOKS='sheathMotion=a,...': switches set for the run)
  { const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js'); for (const kv of (process.env.GCD_LOOKS || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); setLook(k, v); } }
  const names = process.env.GCD_MOVES ? process.env.GCD_MOVES.split(',') : MOVE_NAMES.filter((n) => !MOVES[n].hidden && !MOVES[n].transition && !MOVES[n].verdict);
  const rows = [];
  for (const name of names) {
    const def = MOVES[name];
    const phase = Math.max(1, def.phase ?? 1);
    const G = build();
    duel(G, { dist: 4, form: phase });
    const A = makeAudit({ THREE, G, DT, place });
    const band = def.band ?? [0, 4];
    const dist = Math.max(2.0, Math.min(6, (band[0] + Math.min(band[1], 8)) / 2));
    const r = A.measure(name, { dist, phase });
    rows.push(r);
    A.print(out, r);
  }
  if (process.env.GCD_AUDIT_OUT) fs.writeFileSync(process.env.GCD_AUDIT_OUT, JSON.stringify(rows, null, 1));
}

// ================================================================== scenario: anatomy (ADR-249: the limbs at the contact)
/** Every blow's limbs at its contact, on the rig (the paper selves' blows too: the hidden self-moves are
 *  the clips they play): the striking leg's knee and the support knee (interior angle, 180 = straight),
 *  the striking arm's elbow, and how far the striking wrist sits off the shoulder → target line. Printed
 *  per beat; `GCD_ANAT_OUT` writes the rows as JSON. Asserted bars live in `motion`. */
function anatomyOf(G, name, { dist = 2.4, phase = 1, maxFrames = 900 } = {}) {
  const { game } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  place(G, dist);
  for (let i = 0; i < 30; i++) { place(G, dist); G.tick(DT); }
  if (!d.debug.trigger(name)) return { name, fail: 'trigger' };
  const V = () => new THREE.Vector3();
  const tmp = V();
  // (in the rig's own frame: the drawn lean and scale sit on the root)
  const inv = new THREE.Matrix4();
  const at = (o, x = 0, y = 0, z = 0) => tmp.set(x, y, z).applyMatrix4(o.matrixWorld).applyMatrix4(inv).clone();
  const ang = (a, b, c) => { const u = V().subVectors(a, b).normalize(), w = V().subVectors(c, b).normalize(); return (Math.acos(Math.max(-1, Math.min(1, u.dot(w)))) * 180) / Math.PI; };
  const frames = [];
  let beats = null;
  for (let i = 0; i < maxFrames; i++) {
    G.tick(DT);
    p.debug.heal();
    const a = d.brain.act;
    if (!a || a.name !== name) break;
    beats ??= a.beats.map((b) => ({ impact: b.impact, active: b.def.active ?? 0.08, feint: !!b.def.feint, tell: b.def.tell ?? null, part: b.def.part ?? '-' }));
    const R = d.rig;
    R.root.updateMatrixWorld(true);
    inv.copy(R.root.matrixWorld).invert();
    const leg = (s) => { const L = R.legs[s]; const h = at(L.thigh), k = at(L.shin), f = at(L.foot); return { knee: ang(h, k, f), foot: f, hip: h }; };
    const arm = (s) => { const A = R.arms[s]; const sh = at(A.upper), el = at(A.fore), wr = s === 'R' ? at(A.fore, 0, -0.26, 0) : at(A.wrist); return { elbow: ang(sh, el, wr), sh, wr }; };
    frames.push({ t: a.t, R: leg('R'), L: leg('L'), aR: arm('R'), aL: arm('L'), hero: p.position.clone(), inv: inv.clone() });
    if (process.env.GCD_ANAT_TRACE) { const f = frames[frames.length - 1], P = d.anim.cur; out(`    t ${a.t.toFixed(3)} kneeR ${f.R.knee.toFixed(0)} kneeL ${f.L.knee.toFixed(0)} elR ${f.aR.elbow.toFixed(0)} elL ${f.aL.elbow.toFixed(0)} footR ${f.R.foot.x.toFixed(2)},${f.R.foot.y.toFixed(2)},${f.R.foot.z.toFixed(2)} hipR ${f.R.hip.y.toFixed(2)} d ${f.R.foot.distanceTo(f.R.hip).toFixed(2)} tgt ${[31,32,33,3,4,1].map((i) => P?.[i]?.toFixed(2)).join(',')}`); }
  }
  if (!beats) return { name, fail: 'short' };
  const per = [];
  for (const b of beats) {
    if (b.feint) continue;
    const i0 = frames.findIndex((f) => f.t >= b.impact - 1e-6);
    if (i0 < 0) continue;
    const i1 = Math.min(frames.length - 1, frames.findIndex((f) => f.t >= b.impact + b.active - 1e-6) >>> 0 || i0);
    const seg = frames.slice(i0, Math.max(i0 + 1, i1 + 1));
    const side = /R$/.test(b.part) ? 'R' : /L$/.test(b.part) ? 'L' : null;
    const isLeg = /^foot|^knee/.test(b.part), isArm = /^fist/.test(b.part) || b.part === 'palms';
    const row = { tell: b.tell, part: b.part };
    if (isLeg && side) {
      const sup = side === 'R' ? 'L' : 'R';
      row.kick = Math.round(Math.max(...seg.map((f) => f[side].knee)));
      row.support = Math.round(seg[0][sup].knee);
      row.footY = +seg[0][side].foot.y.toFixed(2);
    }
    if (isArm) {
      const sides = side ? [side] : ['R', 'L'];
      row.elbow = sides.map((s) => Math.round(Math.max(...seg.map((f) => f['a' + s].elbow))));
      // the wrist's distance off the line shoulder → the hero's chest (m)
      row.off = sides.map((s) => {
        const f = seg[0], A = f['a' + s], tgt = V().set(f.hero.x, 1.1, f.hero.z).applyMatrix4(f.inv);
        const dir = V().subVectors(tgt, A.sh).normalize(), w = V().subVectors(A.wr, A.sh);
        return +w.addScaledVector(dir, -w.dot(dir)).length().toFixed(2);
      });
    }
    per.push(row);
  }
  return { name, beats: per };
}
async function scenarioAnatomy() {
  out('\n== scenario ANATOMY (opt-in: every blow\'s limbs at its contact: kick knee / support knee, elbow, the wrist off the line) ==');
  { const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js'); for (const kv of (process.env.GCD_LOOKS || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); setLook(k, v); } }
  const names = process.env.GCD_MOVES ? process.env.GCD_MOVES.split(',') : MOVE_NAMES.filter((n) => !MOVES[n].transition && !MOVES[n].verdict);
  const rows = [];
  for (const name of names) {
    const def = MOVES[name];
    const phase = Math.max(1, def.phase ?? 1);
    const G = build();
    duel(G, { dist: 4, form: phase });
    const band = def.band ?? [0, 4];
    const r = anatomyOf(G, name, { dist: process.env.GCD_ANAT_DIST ? +process.env.GCD_ANAT_DIST : Math.max(1.6, Math.min(5, (band[0] + Math.min(band[1], 6)) / 2)), phase });
    rows.push(r);
    if (r.fail) { out(`  ${name.padEnd(16)} FAIL ${r.fail}`); continue; }
    for (const b of r.beats) out(`  ${name.padEnd(16)} ${String(b.tell ?? '-').padEnd(6)} ${b.part.padEnd(6)} ${b.kick != null ? `kick knee ${b.kick}° support ${b.support}° foot y ${b.footY}` : ''}${b.elbow ? `elbow ${b.elbow.join('/')}° off ${b.off.join('/')} m` : ''}`);
  }
  if (process.env.GCD_ANAT_OUT) fs.writeFileSync(process.env.GCD_ANAT_OUT, JSON.stringify(rows, null, 1));
}

const S = {
  anatomy: scenarioAnatomy,
  audit: scenarioAudit,
  motion: scenarioMotion,
  cost: scenarioCost,
  levels: scenarioLevels,
  data: scenarioData,
  timing: scenarioTiming,
  clones: scenarioClones,
  pearl: scenarioPearl,
  mantle: scenarioMantle,
  phase: scenarioPhase,
  flow: scenarioFlow,
  pace: scenarioPace,
  win: scenarioWin,
  training: scenarioTraining,
  looks: scenarioLooks,
  smoke: scenarioSmoke,
  beam: scenarioBeam,
};
// (one parry, ADR-279: ?parry=one, the default, makes every parry perfect. These scenarios press a PLAIN parry on purpose
// (a perfect one would lock the blades, break him, or send a shot back): they run with ?parry=two)
{
  const RULES = await imp('src/combat/rules.js');
  for (const k of ['clones']) {
    const f = S[k];
    if (typeof f !== 'function') continue;
    S[k] = async () => {
      const m0 = RULES.PARRY_KIND.mode;
      RULES.setParryKind('two');
      try {
        return await f();
      } finally {
        RULES.setParryKind(m0);
      }
    };
  }
}
// (smoke is opt-in: a minute per phase of a fight, for a quick look)
const OPT_IN = new Set(['smoke', 'cost', 'audit', 'anatomy']);
const list = SCEN === 'all' ? Object.keys(S).filter((k) => !OPT_IN.has(k)) : SCEN.split(',');
for (const k of list) {
  if (!S[k]) { out(`unknown scenario ${k}`); process.exit(2); }
  await S[k]();
}
const notCat = [...EMITTED].filter((n) => !CATALOGUE.has(n) && n !== 'state');
assert(!notCat.length, `every event this level emits is in the catalogue ${JSON.stringify(notCat)}`);
out(`\n\nconsole errors/warnings: ${errors.length}${errors.length ? '\n  ' + [...new Set(errors)].slice(0, 12).join('\n  ') : ''}`);
if (errors.length) fails++;
out(fails ? `\nFOX: ${fails} FAILED` : '\nFOX: ALL PASSED');
process.exit(fails ? 1 : 0);
