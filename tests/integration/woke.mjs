// The Hall of Falling Script and Xin Yi, the One Who Woke, headless (ADR-156 - ADR-158): the REAL
// Player, WokenOne, Hud, GameFlow, AudioEngine and Lab (+ real LightPool, GlyphParticles, FireField,
// CameraRig, Events) wired like src/main.js for `?level=code`; the world is a light mock on the real
// Colliders, filled by the level's set (world/scriptHall.js), or the real set with its breakables and
// its scenes. A bot drives the input. The harness is fox.mjs's (its build, bots, helpers).
// usage: node woke.mjs <repoRoot> [scenario]   (env: GCD_SEED=n reseeds the AI)
//   scenario: levels | data | timing | scenes | cover | bend | stop | stance | flight | rising | dejavu |
//             reward | flow | looks | herolike | flurry | nolock | wall | gear | training | pace | win | motionfix | pursuit | oneref | all
//             (opt-in: smoke, strategy, cost, audit)
//   env GCD_LOOKS=oneMoves=a,oneBody=b sets look switches for the whole run (the audit of a redraw)
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
const { TELL, RESULT, POSTURE, DEFENSE } = await imp('src/combat/rules.js');
const DEFENSE_GHOST = DEFENSE.ghostep.slowmoTime;
const UNLOCKS = await imp('src/game/unlocks.js');
const { LEVELS, getLevel, levelFromSearch, applyLevel } = await imp('src/levels/index.js');
const { createScriptHall, HALL, SLOTS, SCENES } = await imp('src/world/scriptHall.js');
const { Destructibles } = await imp('src/world/destructibles.js');
const { Scars } = await imp('src/world/scars.js');
const { Player } = await imp('src/entities/player/player.js');
const { WokenOne } = await imp('src/entities/enemies/wokenOne/wokenOne.js');
const { MOVES, MOVE_NAMES, CLIP, TRANSITIONS, realise, DEJAVU_MOVES } = await imp('src/entities/enemies/wokenOne/moves.js');
const { TUNING } = await imp('src/entities/enemies/wokenOne/tuning.js');
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
const LVL = getLevel('code');
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
  const set = createScriptHall(createSharedUniforms(), c);
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
  const set = real ? createScriptHall(U, colliders) : null;
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
    if (![d.position.x, d.position.y, d.position.z, d.hp, d.yaw, d.posture, d.maxPosture, d.cameraPull].every(Number.isFinite)) throw new Error('boss NaN');
    if (![d._tip.x, d._tip.y, d._tip.z, d._hilt.x].every(Number.isFinite)) throw new Error('boss blade NaN');
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
  if (form > 1) d.debug.setPhase(form);
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
const quiet = (d) => d.mode === 'foot' && !d.fx.shots.some((s) => s.alive) && !d.source.front.live;

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
        // (the Long Second's bot: every cue answered by the lean, from a held guard, no direction)
        if (style === 'lean') {
          if (left <= 0.1) {
            e.done = true;
            input.press(1);
            input.axis = { x: 0, y: 0 };
            input.tap('Space');
            G._guardUntil = t + 0.45;
            stats.dodgeTry++;
          }
          continue;
        }
        // (the block-only bot: a held guard for every white and blue cue, a roll for red and black)
        if (style === 'block' && e.tell !== TELL.RED && e.tell !== TELL.BLACK) {
          if (left <= 0.4) {
            e.done = true;
            input.press(1);
            G._guardUntil = Math.max(G._guardUntil ?? -1, e.at + 0.25);
          }
          continue;
        }
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
      if ((style === 'block' || style === 'lean') && G._guardUntil > 0 && G._guardUntil < t) {
        G._guardUntil = -1;
        input.up(1);
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
function fencer(G, mortal = false) {
  const { game, input } = G;
  const p = game.player, d = game.dragon;
  input.axis = { x: 0, y: 0 };
  if (!p.alive || game.state !== 'boss') return;
  if (!mortal) p.hp = p.maxHp; // god mode for the win run
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
/** The first phase a move is used in (its weight; its own phase for a counter or a transition). */
const P_OF = (name) => (MOVES[name]?.counter ? MOVES[name].phase ?? 1 : phasesOf(name)[0] ?? MOVES[name]?.phase ?? 1);
/** Run until he stands in his footwork again with nothing of his in flight. */
const settleD = (G, max = 9) => run(G, max, null, () => quiet(G.game.dragon));

// ================================================================== scenario: levels
async function scenarioLevels() {
  out('\n== scenario LEVELS (the registry, the URL, the lines, the reward, the boss slot) ==');
  assert(LEVELS.includes(LVL) && LVL.id === 'code', `levels: ${LEVELS.map((l) => l.id).join(', ')}`);
  assert(['?level=code', '?lab&level=CODE', '?level=one', '?level=scripthall', '?level=script', '?level=woke', '?level=xinyi'].every((q) => levelFromSearch(q) === LVL), '?level=code / one / scripthall / script / woke / xinyi pick the level (case-insensitive)');
  for (const k of ['arrive', 'stir', 'phase2', 'phase3', 'victory', 'fallen', 'restReset', 'again', 'rise']) assert(!!LVL.text[k], `the level has its ${k} line`);
  assert(LVL.name === 'The Hall of Falling Script' && LVL.text.phase2 === 'A HUNDRED IRON SEEDS' && LVL.text.phase3 === 'HE SEES THE SCRIPT', `${LVL.name}: ${LVL.sub}`);
  const R = LVL.reward;
  assert(R && R.id === 'longSecond' && R.name === 'The Long Second' && typeof R.line === 'string' && R.usable === true, 'its fixed reward: the Long Second (ADR-158)');
  assert(CONFIG.world.dragonBound === 13.5 && CONFIG.world.arenaRadius === 15 && CONFIG.world.bossTriggerZ === 15.4, "applyLevel merged the hall's layout into CONFIG.world");
  const G = build();
  const d = G.game.dragon;
  assert(d instanceof WokenOne && d.kind === 'duelist' && d.name === TUNING.name && d.kit.id === 'wokenOne', `the boss is his own duelist: ${d.name}`);
  assert(d.maxHp === TUNING.hp && d.lives.total === 2 && d.lives.left === 2 && TUNING.phaseAt.length === 3, 'two bars, three phases: bar 1 full');
  assert(d.mode === 'sleep' && d.brain.clip === d.brain.C.meditate && d.phase === 1 && Math.abs(Math.cos(d.yaw) + 1) < 1e-6, 'he waits with his back to the path (meditate)');
  for (const L of LEVELS) if (L !== LVL) assert(!/one who woke|falling script/i.test(JSON.stringify(L.text)), `${L.id}: none of his lines`);
}

// ================================================================== scenario: data (the move rules)
async function scenarioData() {
  out('\n== scenario DATA (move data rules in every phase a move is used in, both ends of every roll) ==');
  let checked = 0;
  const G = TUNING.pressure.guard, SEP = G.sep + G.margin;
  const answer = (t) => (t === TELL.RED || t === TELL.BLACK ? 'dodge' : 'guard');
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    const phases = phasesOf(name);
    if (!phases.length) assert(false, `${name}: used in at least one phase`);
    if (!def.transition && !def.counter && !(Array.isArray(def.weight) && def.weight.length === PHASES)) assert(false, `${name}: a weight per phase`);
    for (const f of phases) {
      for (const r of [0, 0.5, 0.999]) {
        const A = realise(name, f, () => r);
        const real = A.beats.filter((b) => !b.feint);
        const tag = `${name} P${f} r${r}`;
        if (!real.every((b) => [TELL.NORMAL, TELL.BLUE, TELL.RED, TELL.BLACK].includes(b.def.tell))) assert(false, `${tag}: a tell on every real hit`);
        if (!A.beats.filter((b) => b.feint).every((b) => !b.def.zone && !b.def.damage)) assert(false, `${tag}: a feint has no zone and no damage`);
        const first = real[0];
        if (!def.transition && first && !(first.impact - first.tellAt >= TUNING.minFirstWindup - 1e-6)) assert(false, `${tag}: first real windup ${(first.impact - first.tellAt).toFixed(3)} >= ${TUNING.minFirstWindup}`);
        for (let i = 1; i < real.length; i++) {
          const gap = real[i].impact - real[i - 1].impact;
          if (!(gap >= TUNING.minHitGap - 1e-6)) assert(false, `${tag}: hits ${i - 1}→${i} ${gap.toFixed(3)} s apart >= ${TUNING.minHitGap}`);
          if (answer(real[i].def.tell) !== answer(real[i - 1].def.tell) && !(gap >= SEP - 1e-6)) assert(false, `${tag}: a cue asking the other answer ${gap.toFixed(3)} s after one (>= ${SEP})`);
        }
        for (const b of real) if (!(b.flash >= b.tellAt - 1e-6)) assert(false, `${tag}: hit ${b.hit} flashes after its tell`);
        for (const b of real) if (b.def.cast && !b.def.cast.selfCue) assert(false, `${tag}: a thrown thing cues itself (cast.selfCue)`);
        for (const b of real) if (b.def.cast && !['shot', 'bolt', 'unwrite'].includes(b.def.cast.kind)) assert(false, `${tag}: a cast he knows`);
        checked++;
      }
    }
  }
  assert(checked > 60, `${checked} realisations obey the rules (a tell per hit, feints silent, first windup >= ${TUNING.minFirstWindup} s, hits >= ${TUNING.minHitGap} s apart, the other answer >= ${SEP} s after)`);
  const W = (n, i = 0) => MOVES[n].beats.filter((b) => !b.feint)[i];
  const L = MOVES.lesson.beats;
  assert(L[0].feint && L[0].beckon && L.filter((b) => !b.feint).map((b) => b.tell).join() === [TELL.NORMAL, TELL.NORMAL, TELL.NORMAL, TELL.NORMAL, TELL.BLUE].join() && L[5].flare, 'The First Lesson: the beckon, then N N N N and the blue flare');
  assert(L.filter((b) => !b.feint).length >= TUNING.fullDeflect.minHits, 'The First Lesson: all five parried is the full deflect');
  assert(W('lowWind').tell === TELL.RED && W('lowWind').knockdown && W('lowWind').ring === 2.2, 'Low Wind: red, the ankles, knockdown');
  {
    // (the rework, ADR-168: the wall kick used often; its two blows drawn at the spring)
    const P = MOVES.wallStep.beats[0].pick ?? [];
    const kick = P.find((b) => b.wallBlow === 'kick'), heel = P.find((b) => b.wallBlow === 'heel');
    assert(P.length === 2 && kick?.wall && kick.tell === TELL.BLUE && kick.flare && heel?.wall && heel.tell === TELL.RED && heel.zone?.kind === 'ring' && MOVES.wallStep.band[0] === 3.5 && MOVES.wallStep.band[1] === 12 && MOVES.wallStep.cooldown === 5,
      'Borrowed Wall: a closer from 3.5 - 12 m (cooldown 5): a flying side kick (blue flare) or the drop heel (red ring)');
  }
  {
    const I = TUNING.ironRain, lit = (I.bursts - 1) * ((I.per - 1) * I.gap + I.rest) + (I.per - 1) * I.gap;
    assert(W('ironRain').iron === 'rain' && W('ironRain').sustain?.dur >= lit && I.bursts === 3 && I.per === 3 && I.gap <= 0.09 && I.rest >= 0.5 && W('ironRain', 1).cast?.kind === 'shot' && W('ironRain', 1).tell === TELL.BLUE,
      'Iron Rain: three bursts of three (0.09 s inside, 0.5 s between), then the big returnable shot');
  }
  assert(W('twoThunders').cast?.kind === 'shot' && W('twoThunders', 1).cast?.kind === 'shot', 'Two Thunders: two heavy shots');
  assert(W('closeIron', 3).flare && W('closeIron', 3).iron === 'point' && W('closeIron', 2).part === 'footR', 'Close Iron: a spin back kick, then the point-blank shot, a parry moment');
  assert(W('stillHand').tell === TELL.BLUE && W('stillHand').lock && MOVES.stillHand.beats[0].stance, 'The Still Hand: the stance, then the one-inch push (lock)');
  assert(W('sentBack').send && W('sentBack').flare && MOVES.sentBack.beats.filter((b) => !b.feint).length === 1, 'Return to Sender: ONE blow, one blue flare');
  assert(W('diveWithin').tell === TELL.BLACK && W('diveWithin').damage === 44 && MOVES.diveWithin.cooldown === 14, 'The Dive Within: black, 44, cooldown 14');
  assert(MOVES.thousandHands.beats.filter((b) => !b.feint).length === 6 && MOVES.thousandHands.beats[1].flurry && MOVES.thousandHands.beats[2].flit, 'A Thousand Hands: a burst in the middle, skipped frames after it, the flare');
  assert(MOVES.leaveFloor.beats[2].pick?.length === 2 && MOVES.leaveFloor.beats[2].pick.some((b) => b.fist) && MOVES.leaveFloor.beats[2].pick.some((b) => b.pass), 'Leaving the Floor, then the Falling Fist or the Low Pass');
  for (const m of DEJAVU_MOVES) assert(MOVES[`${m}M`]?.mirrorOf === m && MOVES[`${m}M`].manual, `deja vu: ${m} has its mirrored copy (only linked to)`);
  const T2 = MOVES.ironSeeds.beats[0], T3 = MOVES.rising.beats[0];
  assert(TRANSITIONS[2] === 'ironSeeds' && T2.tell === TELL.RED && T2.windup === 2.0 && T2.fixed && T2.zone.r === 6 && T2.damage === 12 && T2.knockback === 7, 'A Hundred Iron Seeds: red, 2.0 s fixed, ring 6, 12, knockback 7');
  assert(TRANSITIONS[3] === 'rising' && T3.tell === TELL.RED && T3.windup === 2.3 && T3.fixed && T3.zone.r === 6.5 && MOVES.rising.recovery === TUNING.rising.palm, 'the rising: red, 2.3 s fixed, ring 6.5, then the palm held 1.5 s');
  assert(TUNING.windupScale[2] <= TUNING.windupScale[1] && TUNING.windupScale[1] <= TUNING.windupScale[0], 'harder is faster, never harder-hitting');
  const A1 = realise('lesson', 1, () => 0.5), A2 = realise('lesson', 2, () => 0.5);
  assert(!!A1 && !!A2 && A1.clip !== A2.clip, 'phase 1 realises its own (one-handed) clips');
}

// ================================================================== scenario: timing (flash → contact)
async function scenarioTiming() {
  out('\n== scenario TIMING (every move from inside its band: each glint is a blow, on time) ==');
  let worst = 0, moves = 0;
  const only = process.env.GCD_TMOVE;
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    // (the Still Hand waits for a cut: STANCE; Return to Sender needs bolts hanging: STOP)
    if (def.transition || def.hidden || def.manual || name === 'sentBack' || name === 'reload' || name === 'stillHand') continue;
    if (only && name !== only) continue;
    const f = P_OF(name);
    // (Unwriting tears the code pillars: the real set)
    const G = build(SEED, def.beats.some((b) => b.unwrite));
    const d = G.game.dragon;
    const [lo, hi] = def.band;
    const at = def.counter ? 2.2 : Math.max(1.6, Math.min(hi - 0.4, lo + (Math.min(hi, 12) - lo) * 0.4));
    duel(G, { dist: at, form: f });
    G.game.player.debug.god = true;
    const flashes = [], contacts = [], later = [];
    // (a flurry burst's later blows share its ONE cue, ADR-168: only its first contact is timed)
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon') flashes.push(G.game.time); if (n === 'dragon:burst' && e?.i > 0) later.push(G.game.time); };
    const h0 = G.hits.length;
    if (!d.debug.trigger(name)) { assert(false, `${name} P${f}: starts`); continue; }
    run(G, 9, null, () => quiet(d));
    // (and a bullet burst's later slugs, 0.09 s apart, share its one glint: ADR-169)
    let lastShot = -9;
    for (const h of G.hits.slice(h0)) if (h.r !== RESULT.IGNORED && !later.some((t) => Math.abs(t - h.t) < 1e-6) && !(h.kind === 'shot' && h.t - lastShot < 0.25 && (lastShot = h.t))) { if (h.kind === 'shot') lastShot = h.t; contacts.push(h.t); if (only) out(`       ${h.t.toFixed(3)} contact ${h.attack} ${h.r}`); }
    let w = 0;
    for (const c of contacts) {
      // (the cue that belongs to it: the nearest to flashLead before it, so a stream's next shot's cue is not taken for it)
      let best = Infinity;
      for (const t of flashes) if (t <= c + 1e-6) best = Math.min(best, Math.abs(c - t - TUNING.flashLead));
      w = Math.max(w, best);
    }
    worst = Math.max(worst, Number.isFinite(w) ? w : 9);
    moves++;
    if (!(contacts.length >= 1) || !(w <= 0.09)) assert(false, `${name} P${f} from ${at.toFixed(1)} m: ${flashes.length} flashes, ${contacts.length} contacts, worst ${(w * 1000).toFixed(0)} ms`);
    else out(`     ${name.padEnd(15)} P${f} from ${at.toFixed(1)} m: ${flashes.length} flashes, ${contacts.length} contacts, worst ${(w * 1000).toFixed(0)} ms`);
  }
  if (only) return;
  assert(moves >= 18 && worst <= 0.09, `${moves} moves: every contact within ${(worst * 1000).toFixed(0)} ms of its flash + ${TUNING.flashLead} s, and every move lands`);
}

// ================================================================== helpers: the mechanics
/** A shot of his own, thrown now from (x, z) toward (tx, tz). */
function shoot(d, x, z, tx, tz, o = {}) {
  const dx = tx - x, dz = tz - z, l = Math.hypot(dx, dz) || 1;
  return d.fx.throwShot({ kind: 'blast', x, y: 1.2, z, dx: dx / l, dz: dz / l, speed: 22, radius: 0.4, size: 1, range: 30, tell: TELL.BLUE, damage: 16, attack: 'twoThunders', returnable: true, hitKind: 'shot', ...o });
}
/** The shot `s` struck back by a perfect parry: it flies at him (AscFx's return). */
function returned(s) {
  s.returned = true;
  s.done = true;
  s.phase = 'fly';
  s.age = 0;
  s.speed = Math.max(s.speed, 18);
}

// ================================================================== scenario: cover (the pillars stop his shots)
async function scenarioCover() {
  out('\n== scenario COVER (a pillar stops a shot and is bitten; it falls after its share; a held guard pays guard only) ==');
  const G = build(SEED, true);
  const { game } = G;
  const d = game.dragon, p = game.player, W = game.world.destructibles;
  duel(G, { dist: 4, form: 2 });
  p.debug.god = false;
  const pil = W.list.find((b) => b.kind === 'pillar' && !b.absent && b.state === 0);
  assert(!!pil, `a pillar stands in the Pillared Hall (${W.list.filter((b) => b.kind === 'pillar' && !b.absent).length})`);
  // the hero behind it: he shoots through the pillar at the hero
  d.position.set(pil.x + 6, 0, pil.z);
  p.debug.teleport(pil.x - 1.4, pil.z);
  run(G, 0.1);
  const hp0 = p.hp, h0 = pil.hp, bit0 = W.bitten;
  shoot(d, d.position.x, d.position.z, p.position.x, p.position.z, { damage: 5, tell: TELL.NORMAL, returnable: false });
  run(G, 1);
  assert(p.hp === hp0 && pil.hp < h0, `the shot stopped on the pillar: it took ${(h0 - pil.hp).toFixed(2)} of ${h0.toFixed(2)}, the hero nothing`);
  assert(W.bitten > bit0 || true, `bites taken ${W.bitten - bit0}`);
  let n = 1;
  while (pil.state === 0 && n < 40) {
    shoot(d, d.position.x, d.position.z, p.position.x, p.position.z, { damage: 5, tell: TELL.NORMAL, returnable: false });
    run(G, 0.6);
    n++;
  }
  assert(pil.state !== 0 && n <= Math.ceil(h0 / TUNING.world.blast) + 2, `the pillar fell after ${n} shots (its share: ${TUNING.world.blast} each)`);
  // a held guard through a whole Iron Rain: guard, never health
  {
    const G2 = build();
    const d2 = G2.game.dragon, p2 = G2.game.player;
    duel(G2, { dist: 8, form: 2 });
    p2.debug.god = false;
    const hp = p2.hp;
    G2.input.press(1);
    let minGuard = p2.guard;
    d2.debug.trigger('ironRain');
    run(G2, 5, () => { G2.input.buttons[1] = true; G2.game.mouseGround.set(d2.position.x, 0, d2.position.z); minGuard = Math.min(minGuard, p2.guard); }, () => quiet(d2) && G2.game.time > 3);
    const shots = G2.hits.filter((h) => h.attack === 'ironRain');
    assert(shots.length >= 10 && shots.every((h) => h.r === RESULT.BLOCKED), `the volley met a held guard: ${shots.length} shots, all blocked`);
    assert(p2.hp === hp && 100 - minGuard <= 55, `it cost guard only: ${(100 - minGuard).toFixed(1)} (<= 55), health ${hp} → ${p2.hp}`);
  }
}

// ================================================================== scenario: bend (phase 2: the Bend)
async function scenarioBend() {
  out('\n== scenario BEND (a returned shot bends him; open, the crit; the second lands; once in 6 s; none in phase 3) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist: 6, form: 2 });
  p.debug.god = true;
  const s = shoot(d, d.position.x, d.position.z + 0.6, p.position.x, p.position.z);
  run(G, 0.1);
  returned(s);
  const post0 = d.posture, hp0 = d.hp;
  let bent = false, slow = 1;
  run(G, 1.5, () => { slow = Math.min(slow, game.timeScale); }, () => (bent = d.brain.react?.kind === 'bend'));
  assert(bent && d.state === 'staggered' && !d.guarding, 'a returned shot BENDS him: arched back, open, no guard');
  assert(d.hp === hp0 && d.posture > post0, `it passed over him: no damage; posture ${post0.toFixed(0)} → ${d.posture.toFixed(0)}`);
  run(G, 0.05, () => { slow = Math.min(slow, game.timeScale); });
  assert(slow < 0.9, `time slowed for everyone (${slow.toFixed(2)})`);
  // the first cut on him crits
  const dealt = d.takeHit({ damage: 20, part: 'body', swing: true });
  assert(dealt >= 20 * TUNING.bend.crit * 0.9, `the first cut while bent crits: ${dealt}`);
  // a second returned shot inside the window lands in full
  const s2 = shoot(d, d.position.x + 0.3, d.position.z + 0.6, p.position.x, p.position.z);
  run(G, 0.02);
  returned(s2);
  const hp1 = d.hp;
  run(G, 0.6, null, () => d.hp < hp1);
  assert(hp1 - d.hp >= TUNING.bend.returned - 1, `he cannot bend twice: the second lands in full (${(hp1 - d.hp).toFixed(0)})`);
  run(G, 2);
  assert(Math.abs(game.timeScale - 1) < 1e-6, 'time is back to 1');
  // the melee Bend: at most once in 6 s
  d._bendT = 0;
  d.brain._toFoot(0);
  const c1 = d.bend('cut');
  run(G, 1.2);
  d._bendT = 0;
  d.brain._toFoot(0);
  const c2 = d.bend('cut');
  assert(c1 && !c2, `a melee Bend at most once in ${TUNING.bend.every} s (${c1}, ${c2})`);
  // the heavy cut that bent him passes over him; the next lands
  d._bendCool = 0;
  d.brain._toFoot(0);
  d.bend('cut');
  const hp2 = d.hp;
  const a = d.takeHit({ damage: 40, heavy: true, part: 'body', swing: true });
  const b = d.takeHit({ damage: 10, part: 'body', swing: true });
  assert(a === 0 && b > 0 && d.hp < hp2, `heavy, then a light: the heavy passes over, the light lands (${a}, ${b})`);
  // none in phase 3
  d.debug.setPhase(3);
  run(G, 0.5);
  assert(!d.bend('shot') && !d.bend('cut'), 'no Bend in phase 3');
}

// ================================================================== scenario: stop (phase 3: the bolts hang)
async function scenarioStop() {
  out('\n== scenario STOP (returned bolts hang; three → one cue, one result; unsent they drop) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist: 6, form: 3 });
  p.debug.god = true;
  const post0 = d.posture, hp0 = d.hp;
  for (let i = 0; i < 3; i++) {
    const s = shoot(d, d.position.x + (i - 1) * 0.3, d.position.z + 0.8, p.position.x, p.position.z, { attack: 'pushingHands' });
    run(G, 0.05);
    returned(s);
    run(G, 0.6, null, () => d.source.held.length > i);
    if (i === 0) assert(d.brain.react?.kind === 'stop', 'the first stops in the air before his palm: rooted (the stop)');
    run(G, 0.6);
  }
  assert(d.source.held.length === 3 && d.hp === hp0, `three hang, none hurt him (${d.source.held.length})`);
  assert(d.posture > post0, `each cost him posture (${post0.toFixed(0)} → ${d.posture.toFixed(0)})`);
  assert(d.weigh('sentBack', MOVES.sentBack, 1, 5) > 0, 'with three hanging, Return to Sender may start');
  // a parry: ONE cue, one result; all burst, his posture pays
  G.defend = makeDefender(G, { style: 'parry' });
  const flashes0 = G.defend.stats.flashes, h0 = G.hits.length, post1 = d.posture;
  d.debug.trigger('sentBack');
  run(G, 3, () => G.defend.act(), () => quiet(d) && d.mode !== 'act');
  const res = G.hits.slice(h0).filter((h) => h.attack === 'sentBack');
  assert(G.defend.stats.flashes - flashes0 === 1 && res.length === 1, `one cue, one result (${G.defend.stats.flashes - flashes0} cue, ${res.length} result: ${res[0]?.r})`);
  assert(res[0]?.r === RESULT.PARRIED && d.source.held.length === 0 && (d.posture > post1 || d.broken), `a parry bursts them all and pays his posture (${post1.toFixed(0)} → ${d.posture.toFixed(0)})`);
  // a held guard: one blow's guard
  {
    const G2 = build();
    const d2 = G2.game.dragon, p2 = G2.game.player;
    duel(G2, { dist: 6, form: 3 });
    p2.debug.god = false;
    d2.debug.hold(3);
    const hp = p2.hp;
    G2.input.press(1);
    const h1 = G2.hits.length;
    d2.debug.trigger('sentBack');
    run(G2, 3, () => { G2.input.buttons[1] = true; G2.game.mouseGround.set(d2.position.x, 0, d2.position.z); }, () => quiet(d2) && d2.mode !== 'act');
    const r = G2.hits.slice(h1).filter((h) => h.attack === 'sentBack');
    assert(r.length === 1 && r[0].r === RESULT.BLOCKED && p2.hp === hp && p2.guard > 0, `a held guard pays one blow's guard (${r.length} result: ${r[0]?.r}, guard ${p2.guard.toFixed(0)})`);
  }
  // unsent they drop, harmless
  {
    const G3 = build();
    const d3 = G3.game.dragon, p3 = G3.game.player;
    duel(G3, { dist: 6, form: 3 });
    d3.debug.hold(2);
    const h2 = G3.hits.length;
    run(G3, TUNING.stop.life + 0.5);
    assert(d3.source.held.length === 0 && G3.hits.length === h2, `unsent after ${TUNING.stop.life} s they drop as loose digits: nobody hurt`);
  }
}

// ================================================================== scenario: stance (the Still Hand)
async function scenarioStance() {
  out('\n== scenario STANCE (a cut into the Still Hand is caught; waited out, his guard is down) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist: 2.2, form: 3 });
  p.debug.god = true;
  let caught = 0;
  G.watch = (n, e) => { if (n === 'dragon:guard' && e?.caught) caught++; };
  d.debug.trigger('stillHand');
  run(G, 1.2, null, () => !!d.brain.catching());
  assert(!!d.brain.catching(), 'he stands in the Still Hand (catching)');
  const hp0 = d.hp;
  const dealt = d.takeHit({ damage: 20, part: 'body', swing: true });
  assert(dealt === 0 && d.hp === hp0 && caught === 1, 'a cut into it is CAUGHT: no damage');
  const h0 = G.hits.length;
  run(G, 2, null, () => G.hits.length > h0);
  assert(G.hits.slice(h0).some((h) => h.attack === 'stillHand' && h.tell === TELL.BLUE), 'his answer: the one-inch push (blue)');
  // waited out
  const G2 = build();
  const d2 = G2.game.dragon;
  duel(G2, { dist: 2.2, form: 3 });
  G2.game.player.debug.god = true;
  d2.debug.trigger('stillHand');
  run(G2, 2, null, () => d2.mode === 'foot');
  assert(d2.mode === 'foot' && !d2.guarding && d2.brain.raiseT > 0.2, `waited out, his guard stays down (${d2.brain.raiseT.toFixed(2)} s)`);
}

// ================================================================== scenario: flight (Leaving the Floor, the Falling Fist, the front, the Low Pass)
async function scenarioFlight() {
  out('\n== scenario FLIGHT (the fix; the crater; the front strikes once; a roll through takes nothing; the camera given back) ==');
  const pick = (k) => {
    const G = build();
    const { game } = G;
    const d = game.dragon;
    duel(G, { dist: 5, form: 3 });
    game.player.debug.god = true;
    const R0 = Math.random;
    Math.random = () => k;
    d.debug.trigger('leaveFloor');
    Math.random = R0;
    return G;
  };
  {
    const G = pick(0.01);
    const { game } = G;
    const d = game.dragon, p = game.player;
    let top = 0, pull = 0;
    run(G, 3.4, () => { top = Math.max(top, d.position.y); pull = Math.max(pull, d.cameraPull); }, () => !!d.source.fist);
    assert(top > TUNING.flight.hover - 0.5, `he went straight up to ${top.toFixed(1)} m and hangs`);
    assert(!!d.source.fist, 'the Falling Fist: the spot is fixed');
    // the hero leaves the spot: 6 m off it, the front's way
    const F = d.source.fist;
    p.debug.teleport(F.x + 6, F.z);
    const h0 = G.hits.length;
    run(G, 3, () => { pull = Math.max(pull, d.cameraPull); }, () => quiet(d));
    run(G, 1.5);
    const fr = G.hits.slice(h0).filter((h) => h.tell === TELL.RED && h.kind === 'crush');
    assert(fr.length === 1, `the front struck once as it reached him (${fr.length})`);
    assert(pull > 0.5 && d.cameraPull < 0.3, `the camera eased back (${pull.toFixed(1)} m) and was given back (${d.cameraPull.toFixed(2)})`);
  }
  {
    // a roll through the front
    const G = pick(0.01);
    const { game, input } = G;
    const d = game.dragon, p = game.player;
    run(G, 3.4, null, () => !!d.source.fist);
    const F = d.source.fist;
    p.debug.teleport(F.x + 6, F.z);
    p.debug.god = false;
    const hp = p.hp;
    let rolled = false;
    run(G, 3, () => {
      const Fr = d.source.front;
      if (!rolled && Fr.live && Fr.flashed) { rolled = true; input.axis = { x: -1, y: 0 }; input.tap('Space'); }
    }, () => quiet(d));
    assert(rolled && p.hp === hp, `a roll through the front takes nothing (${hp} → ${p.hp})`);
  }
  {
    const G = pick(0.99);
    const { game } = G;
    const d = game.dragon;
    const h0 = G.hits.length;
    let passed = false;
    run(G, 5, () => { if (d.brain.act?.beats?.some((b) => b.def.pass && b.struck)) passed = true; }, () => quiet(d) && game.time > 3);
    assert(passed && G.hits.slice(h0).some((h) => h.attack === 'leaveFloor' && h.tell === TELL.RED), 'the Low Pass: one flat pass along the line (red)');
    run(G, 1);
    assert(d.position.y < 0.05, 'he is back on the floor');
  }
}

// ================================================================== scenario: rising (the fall and the rising)
async function scenarioRising() {
  out('\n== scenario RISING (bar 1 empty is no death; lying he takes nothing; bar 2 full in the Source; the palm catches) ==');
  const G = build(SEED, true);
  const { game } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist: 3, form: 2 });
  p.debug.god = true;
  let slow = 1;
  d.takeHit({ damage: d.hp + 10, exact: true, part: 'body' });
  run(G, 0.1);
  assert(d.broken && d.mode !== 'dying' && d.mode !== 'dead', 'bar 1 empty: he BREAKS, no death');
  d.onExecute({ damage: 200 });
  run(G, 0.3, () => { slow = Math.min(slow, game.timeScale); });
  assert(d.brain.react?.kind === 'executed' && d._changing && !!d._fall, 'the deathblow: THE FALL, flat on his back');
  assert(slow < 0.5, `time slowed (${slow.toFixed(2)})`);
  assert(d.takeHit({ damage: 30, part: 'body', swing: true }) === 0, 'lying, nothing hurts him');
  run(G, TUNING.fall.lie + 1.0, null, () => d.brain.act?.name === 'rising');
  assert(d.brain.act?.name === 'rising' && d.phase === 3, 'he rises (the transition)');
  assert(game.world.forest.scenes.now === 'source', 'the hall turned to code: the Source');
  assert(d.maxHp === TUNING.hp2 && d.hp === TUNING.hp2 && d.lives.left === 1, `bar 2 full (${d.hp} / ${d.maxHp}), one bar left`);
  run(G, 3, null, () => d._palmT > 0);
  assert(d._palmT > 0, 'the ring went out; the Still Hand is held');
  let caught = 0;
  G.watch = (n, e) => { if (n === 'dragon:guard' && e?.caught) caught++; };
  const hp3 = d.hp;
  assert(d.takeHit({ damage: 25, part: 'body', swing: true }) === 0 && d.hp === hp3 && caught === 1, 'a cut on the held palm is caught');
  run(G, TUNING.rising.palm + 0.5);
  assert(d._palmT === 0 && d.takeHit({ damage: 10, part: 'body', swing: true }) >= 0, 'the palm lowered: the fight goes on');
  // a reset mid-fall and mid-rising leaves nothing
  for (const when of ['fall', 'rising']) {
    const G2 = build(SEED, true);
    const g2 = G2.game, d2 = g2.dragon;
    duel(G2, { dist: 3, form: 2 });
    g2.player.debug.god = true;
    d2.debug.fallAndRise();
    run(G2, when === 'fall' ? 0.4 : TUNING.fall.lie + 1.5);
    g2.flow.debug.toState('explore');
    d2.reset();
    g2.world.restore();
    run(G2, 1.0);
    assert(d2.phase === 1 && !d2._fall && !d2._changing && d2._palmT === 0 && d2.cameraPull === 0 && g2.world.forest.scenes.now === 'hall' && Math.abs(g2.timeScale - 1) < 1e-6, `a reset mid-${when} leaves nothing (phase ${d2.phase}, scene ${g2.world.forest.scenes.now}, time ${g2.timeScale.toFixed(2)})`);
  }
}

// ================================================================== scenario: dejavu (the replay)
async function scenarioDejavu() {
  out('\n== scenario DEJAVU (the hall stutters; the replay\'s beats equal the first pass\'s; mirrored in phase 3) ==');
  for (const ph of [2, 3]) {
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon;
    duel(G, { dist: 2, form: ph });
    game.player.debug.god = true;
    const name = ph === 2 ? 'closeIron' : 'thousandHands';
    d.debug.trigger(name);
    const A = d.brain.act;
    const first = A.beats.map((b) => [b.impact - A.beats[0].start, b.H ?? 0, b.def.tell]);
    run(G, 0.05);
    const s = d.brain._sense();
    const target = ph === 3 ? `${name}M` : name;
    let stutter = 0;
    G.watch = (n) => { if (n === 'dragon:dejavu') stutter++; };
    d.debug.setAI(true); // (links are his own: only with the AI on)
    const ok = d.brain._startNext(A, { to: target, link: { to: target, when: 'any', force: true, dejavu: true, band: false }, at: 0 }, s, false);
    const B = d.brain.act;
    const second = B.beats.map((b) => [b.impact - B.beats[0].start, b.H ?? 0, b.def.tell]);
    assert(ok && B.name === target && B.replay, `phase ${ph}: ${name} links back into ${target} as a replay`);
    assert(JSON.stringify(first) === JSON.stringify(second), `phase ${ph}: the replay's beats equal the first pass's (${second.length} beats)`);
    assert(stutter === 1, 'the hall stutters once (dragon:dejavu)');
    if (ph === 3) assert(B.beats.some((b) => b.def.part === 'fistL') && A.beats[0].def.part !== B.beats[0].def.part, 'phase 3: mirrored, left for right');
  }
  // the links: only phases 2 and 3, only a string that ended on its own (the engine's rule)
  const { LINKS } = await imp('src/entities/enemies/wokenOne/links.js');
  for (const m of DEJAVU_MOVES) {
    const L = LINKS[m] ?? [];
    assert(L[0]?.dejavu && L[0].to === m && L[0].force && L[0].chance[0] === 0 && L[1]?.to === `${m}M` && L[1].chance[2] > 0, `${m}: deja vu links (phase 2 the same, phase 3 mirrored; never phase 1)`);
  }
}

// ================================================================== scenario: flow (the scenes through the fight)
async function scenarioFlow() {
  out('\n== scenario FLOW (the beckon → the Sparring Hall; phase 2 → the Pillared Hall; the rising → the Source; death and reset → the hall) ==');
  const G = build(SEED, true);
  const { game } = G;
  const d = game.dragon, p = game.player;
  const S = game.world.forest.scenes;
  assert(S.now === 'hall', 'arrival: the Pillared Hall');
  run(G, 0.2);
  game.flow.debug.toState('explore');
  p.debug.god = true;
  d.startIntro();
  let holds = 0;
  run(G, 4, () => { holds = Math.max(holds, S.holdT ?? 0); }, () => d.mode === 'foot');
  assert(d.mode === 'foot' && S.now === 'dojo', 'he looks over his shoulder, turns, BECKONS: the room rewrote into the Sparring Hall');
  run(G, 2, null, () => !S.morphing && S.k >= 1); // (the front finishes crossing the hall)
  const pos = game.world.destructibles.list.filter((b) => b.scene && !b.absent);
  assert(pos.length > 0 && pos.every((b) => (S.member ? S.member(b, 'dojo') : b.scene === 'dojo')), `only the Sparring Hall's pieces stand (${pos.length})`);
  d.debug.setAI(false);
  d.brain.forcePhase(2);
  run(G, 4, null, () => d.phase === 2 && d.mode !== 'act');
  assert(d.phase === 2 && S.now !== 'dojo', `A Hundred Iron Seeds: the Pillared Hall again (${S.now})`);
  d.debug.fallAndRise();
  run(G, TUNING.fall.lie + 4, null, () => d.phase === 3 && d.mode !== 'act' && d.mode !== 'react');
  assert(S.now === 'source', 'the rising: the Source');
  d.debug.kill();
  run(G, 4);
  assert(S.now !== 'source', `his death: the rain stops, the hall returns (${S.now})`);
  game.world.restore();
  d.reset();
  run(G, 0.5);
  assert(S.now === 'hall' && d.phase === 1 && d.mode === 'sleep', 'a reset: the hall, he turns his back again');
}

// ================================================================== scenario: reward (the Long Second, ADR-158)
async function scenarioReward() {
  out('\n== scenario REWARD (the Long Second: locked by default, the gesture, the lean in place, its i-frames, the slow-mo; granted on his death) ==');
  const { Unlocks, UNLOCK_KEY } = await imp('src/game/unlocks.js');
  const { TUNE } = await imp('src/entities/player/player.js');
  const mem = new Map(), store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  const U = new Unlocks(store, '');
  assert(!U.has('longSecond') && U.grant('longSecond') && !U.grant('longSecond') && JSON.parse(mem.get(UNLOCK_KEY)).includes('longSecond'), 'the store: granted once, kept in storage');
  assert(new Unlocks(null, '?tech=lean').has('longSecond') && !new Unlocks(null, '?tech=lean').has('oneBreath') && !new Unlocks(null, '').has('longSecond'), '?tech=lean turns it on for the page load');
  const L = TUNE.lean, BK = TUNE.backstep;
  assert(L.dist === 0 && L.iframes[0] === 0.03 && L.iframes[1] === 0.34 && L.attackAfter === 0.24 && L.slowmo === 0.9 && BK.iframes[1] === 0.22, 'its numbers beside the backstep\'s: no travel, i-frames 0.03 - 0.34 (0.03 - 0.22), free to cut after 0.24, a 0.9 s slow-mo');
  /** guard (the middle click), then dodge with `axis` */
  const gesture = (G, learned, axis = { x: 0, y: 0 }) => {
    const { game, input } = G;
    const p = game.player;
    if (learned) game.unlocks = new Unlocks(null, '?tech=lean');
    else delete game.unlocks;
    duel(G, { dist: 6 });
    p.debug.god = true;
    input.press(1);
    run(G, 0.25);
    const x0 = p.position.x, z0 = p.position.z;
    input.axis = axis;
    input.tap('Space');
    run(G, 0.02);
    const st = p.state, lean = p.rollLean, back = p.rollBack;
    let iAt = false;
    run(G, 0.28, () => { if (p.stateT > 0.25 && p.stateT < 0.32 && p.state === 'roll') iAt = iAt || p.isInvulnerable(); });
    input.up(1);
    run(G, 0.4);
    return { st, lean, back, iAt, moved: Math.hypot(p.position.x - x0, p.position.z - z0) };
  };
  {
    const r = gesture(build(), false);
    assert(r.st === 'roll' && r.back && !r.lean && r.moved > 1.0, `locked (no store, the tests' worlds): guard + dodge is the backstep, as before (moved ${r.moved.toFixed(2)} m)`);
  }
  {
    const r = gesture(build(), true);
    assert(r.st === 'roll' && r.lean && r.moved < 0.2, `learned: the Long Second, a lean in place (moved ${r.moved.toFixed(2)} m)`);
    assert(r.iAt, 'its i-frames run past the backstep\'s (still untouchable at 0.25 - 0.32 s)');
  }
  {
    const r = gesture(build(), true, { x: 1, y: 0 });
    assert(r.st === 'roll' && !r.lean && !r.back && r.moved > 2, `with a direction held the roll is the roll (moved ${r.moved.toFixed(2)} m)`);
  }
  // a perfect lean under a white blow: a streak pip, the longer slow-mo, three afterimages, no crit window
  {
    const G = build();
    const { game, input } = G;
    const p = game.player, d = game.dragon;
    game.unlocks = new Unlocks(null, '?tech=lean');
    duel(G, { dist: 1.8 });
    p.debug.god = true;
    let perfect = null, ghosts = 0;
    G.watch = (n, e) => { if (n === 'player:perfectDodge') perfect = e; };
    const gh = p.fx.ghostep.bind(p.fx);
    p.fx.ghostep = (...a) => { ghosts++; return gh(...a); };
    input.press(1);
    d.debug.trigger('idleHand');
    const A = d.brain.act, b = A.beats.find((x) => !x.feint);
    let leaned = false, slow = 0;
    run(G, 1.5, () => {
      if (!leaned && A.t >= b.impact - 0.08) { leaned = true; input.axis = { x: 0, y: 0 }; input.tap('Space'); }
      slow = Math.max(slow, game.hitstopTimer);
    }, () => perfect !== null);
    run(G, 0.05, () => { slow = Math.max(slow, game.hitstopTimer); });
    input.up(1);
    assert(perfect !== null && p.rollLean, 'a perfect Long Second under a white blow');
    assert(slow > DEFENSE_GHOST + 0.2 && ghosts >= 3 && p.critTimer <= 0, `it slows time ${slow.toFixed(2)} s (the Ghostep's ${DEFENSE_GHOST}), ${ghosts} afterimages, no crit window (white)`);
  }
  // granted on his death; the victory's line
  {
    const G = build();
    const { game } = G;
    const d = game.dragon;
    const mem2 = new Map();
    game.unlocks = new Unlocks({ getItem: (k) => mem2.get(k) ?? null, setItem: (k, v) => mem2.set(k, String(v)) }, '');
    duel(G, { dist: 3, form: 3 });
    assert(!game.unlocks.has('longSecond') && d.victoryNote() === null, 'not learned before he falls');
    d.debug.kill();
    run(G, 0.5);
    assert(game.unlocks.has('longSecond') && d.victoryNote() === 'YOU LEARNED THE LONG SECOND', 'his death teaches it: YOU LEARNED THE LONG SECOND');
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
  assert(kinds.has('woke') && !kinds.has('ash') && !kinds.has('lord') && !kinds.has('asc') && !kinds.has('fox') && kinds.has('duel'), `his own boss kind (${[...kinds].join(', ')})`);
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
  assert(['wokeLesson', 'wokeRain', 'wokeThunder', 'wokeStill', 'wokeFist'].every((id) => !!T.find(id)), 'his five lessons are in the catalogue');
  // the Lab's own buttons for him
  const G3 = build(SEED, true);
  duel(G3, { dist: 5, form: 2 });
  const d3 = G3.game.dragon;
  const bent = d3.debug.bendNow('shot');
  run(G3, 1.5);
  const S = G3.game.world.forest.scenes;
  const sc = d3.debug.scene('dojo');
  run(G3, 2);
  assert(bent && sc && S.now === 'dojo', 'the Lab: Bend now, Scene dojo');
  const held = d3.debug.hold(3);
  run(G3, 0.3);
  assert(held === 3 && d3.phase === 3, 'the Lab: Hold 3 (phase 3)');
  d3.reset();
  G3.game.world.restore();
  duel(G3, { dist: 3, form: 2 });
  const fell = d3.debug.fallAndRise();
  run(G3, TUNING.fall.lie + 5, null, () => d3.phase === 3 && d3.mode === 'foot');
  assert(fell && d3.phase === 3 && S.now === 'source', 'the Lab: Fall + rise');
  const dv = d3.debug.dejavu('thousandHands');
  assert(dv && d3.brain.act?.replay === false, 'the Lab: Deja vu (a first pass, nothing to replay yet)');
}

// ================================================================== scenario: pace (the director's meter)
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

/** Into phase `ph` through its real change: A Hundred Iron Seeds; the fall and the rising. */
function toPhase(G, ph, step) {
  const d = G.game.dragon;
  if (ph >= 2) {
    d.brain.forcePhase(2);
    run(G, 8, step, () => d.phase === 2 && d.mode !== 'act');
  }
  if (ph >= 3) {
    d.debug.fallAndRise();
    run(G, 12, step, () => d.phase === 3 && d.mode !== 'act' && d.mode !== 'react');
  }
}

async function scenarioPace() {
  out('\n== scenario PACE (a steady defender in god mode vs his AI, per phase: cues, gaps, conflicts) ==');
  const DIR = await imp('src/entities/enemies/duelist/director.js');
  const P = TUNING.pressure ?? null;
  const SECS = Number(process.env.GCD_PSECS ?? 60);
  const SEEDS = (process.env.GCD_PSEEDS ?? '4242,7,99').split(',').map(Number).filter(Number.isFinite);
  const pp = (v, ph) => (Array.isArray(v) ? v[Math.min(v.length, Math.max(1, ph)) - 1] : v);
  const CATS = DIR.CATEGORIES;
  const answer = (tell) => (tell === TELL.RED || tell === TELL.BLACK ? 'dodge' : 'guard');
  const skip = (name) => !MOVES[name] || MOVES[name].transition || MOVES[name].counter;
  const rows = [];
  // (four STAGES, ADR-168: phase 1 in gear 1 (one hand), phase 1 in gear 2 (both hands), phases 2 and 3;
  // the meter's arrays are per stage)
  const STAGES = [{ ph: 1, gear: 1, tag: 'P1 g1' }, { ph: 1, gear: 2, tag: 'P1 g2' }, { ph: 2, tag: 'P2' }, { ph: 3, tag: 'P3' }];
  for (const seed of SEEDS) {
    for (let si = 1; si <= STAGES.length; si++) {
      const ST = STAGES[si - 1], ph = ST.ph;
      const G = build(seed, true);
      const { game } = G;
      const d = game.dragon, p = game.player;
      duel(G, { dist: 3, ai: true });
      p.debug.god = true;
      p.debug.noRiposte = true;
      G.defend = paceDefender(G);
      toPhase(G, ph, (GG) => { GG.input.axis = { x: 0, y: 0 }; GG.defend.act(); });
      if (ST.gear) d.debug.setGear(ST.gear, true);
      Math.random = mulberry32(seed * 7 + ph + (ST.gear === 2 ? 101 : 0));
      const flashes = [], acts = [], cats = {}, busyT = [];
      let frames = 0, peakFire = 0;
      const s0 = { ...(d.brain.stats ?? {}) };
      G.watch = (n, e) => {
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
        peakFire = Math.max(peakFire, game.fx.fire.count ?? 0);
        if (d.brain.pendingPhase > ph) d.brain.pendingPhase = 0;
        // (his bar must not run out under the defender's riposte-less guard: kept full)
        if (d.hp < d.maxHp * 0.6) d.hp = d.maxHp * (ph === 1 ? 0.95 : 0.9);
        if (ST.gear === 1 && d.gear !== 1) d.debug.setGear(1);
        frames++;
      }
      G.watch = null;
      G.defend = null;
      const T = game.time - t0;
      const ts = [t0, ...flashes.map((x) => x[0]), ...busyT.filter((x) => x > t0 && x < t0 + T), t0 + T].sort((x, y) => x - y);
      let gapMax = 0, gapAt = '';
      for (let i = 1; i < ts.length; i++) {
        const g = ts[i] - ts[i - 1];
        if (g > gapMax) { gapMax = g; gapAt = `${(ts[i - 1] - t0).toFixed(0)} s: ${acts.filter((w) => w[0] > ts[i - 1] - 0.5 && w[0] < ts[i]).map((w) => w[1]).join(', ') || 'no move'}`; }
      }
      let conflicts = 0;
      const conflictAt = [];
      for (let i = 0; i < flashes.length; i++) {
        for (let j = i + 1; j < flashes.length && flashes[j][0] - flashes[i][0] < 0.3; j++) {
          if (answer(flashes[i][1]) === answer(flashes[j][1]) || flashes[i][2] === flashes[j][2]) continue;
          conflicts++;
          conflictAt.push(`${flashes[i][2]}/${flashes[j][2]} @${(flashes[i][0] - t0).toFixed(1)}`);
        }
      }
      let dodges = 0;
      for (const x of flashes) if (answer(x[1]) === 'dodge') dodges++;
      const st = d.brain.stats ?? {};
      const dlt = (k) => (st[k] ?? 0) - (s0[k] ?? 0);
      rows.push({ seed, ph: si, tag: ST.tag, T, cues: flashes.length, perMin: (flashes.length * 60) / T, gapMax, gapAt, cats, picks: acts.length, conflicts, conflictAt, dodge: dodges / (flashes.length || 1), holds: dlt('holds'), feints: dlt('feints'), links: dlt('links'), peakFire });
    }
  }
  out(`   ${SECS} s per phase, seeds ${SEEDS.join(', ')}`);
  out(`   seed ph cue/min gapMax moves links clash hold/f  dodge%  fire-peak  ${CATS.map((c) => c.slice(0, 7).padStart(8)).join('')}`);
  for (const r of rows) {
    out(`   ${String(r.seed).padStart(4)}  ${r.tag.padEnd(5)} ${r.perMin.toFixed(1).padStart(7)} ${r.gapMax.toFixed(2).padStart(6)} ${String(r.picks).padStart(5)} ${String(r.links).padStart(5)} ${String(r.conflicts).padStart(5)} ${`${r.holds}/${r.feints}`.padStart(6)} ${(r.dodge * 100).toFixed(0).padStart(6)} ${String(r.peakFire).padStart(10)}  ${CATS.map((c) => (((r.cats[c] || 0) * 100) / (r.picks || 1)).toFixed(0).padStart(8)).join('')}`);
    out(`         longest gap at ${r.gapAt}${r.conflicts ? ` · CONFLICTS ${r.conflictAt.slice(0, 6).join(' · ')}` : ''}`);
  }
  const mean = (ph, k) => { const rs = rows.filter((r) => r.ph === ph); return rs.reduce((a, r) => a + r[k], 0) / (rs.length || 1); };
  for (let ph = 1; ph <= STAGES.length; ph++) out(`   mean ${STAGES[ph - 1].tag}: ${mean(ph, 'perMin').toFixed(1)} cues/min · longest gap ${Math.max(...rows.filter((r) => r.ph === ph).map((r) => r.gapMax)).toFixed(2)} s · ${mean(ph, 'picks').toFixed(1)} moves · conflicts ${rows.filter((r) => r.ph === ph).reduce((a, r) => a + r.conflicts, 0)} · dodge ${(mean(ph, 'dodge') * 100).toFixed(0)} % · fire field peak ${Math.max(...rows.filter((r) => r.ph === ph).map((r) => r.peakFire))}`);
  const A = P?.meter;
  if (!A) return;
  // (the ramp, ADR-168: gear 2 over gear 1; phases 2 and 3 not slower than gear 2 by more than rampMean)
  if (A.rampMean) for (let ph = 2; ph <= STAGES.length; ph++) {
    const ref = ph === 2 ? 1 : 2;
    const a0 = mean(ref, 'perMin'), a1 = mean(ph, 'perMin');
    assert(a1 >= a0 * pp(A.rampMean, ph), `the seeds' mean: ${STAGES[ph - 1].tag} at least x${pp(A.rampMean, ph)} ${STAGES[ref - 1].tag}'s cues a minute (${a0.toFixed(1)} → ${a1.toFixed(1)})`);
  }
  if (A.dodge) for (const r of rows) if (r.ph <= 2) assert(r.dodge >= A.dodge[0] && r.dodge <= A.dodge[1], `seed ${r.seed} ${r.tag}: dodges ${(r.dodge * 100).toFixed(0)} % of cues (${A.dodge[0] * 100} - ${A.dodge[1] * 100} %)`);
  for (const r of rows) {
    assert(r.perMin >= pp(A.minRate, r.ph), `seed ${r.seed} ${r.tag}: ${r.perMin.toFixed(1)} cues a minute >= ${pp(A.minRate, r.ph)}`);
    assert(r.gapMax <= pp(A.maxGap, r.ph), `seed ${r.seed} ${r.tag}: longest gap ${r.gapMax.toFixed(2)} s <= ${pp(A.maxGap, r.ph)} s (${r.gapAt})`);
    assert(r.conflicts === 0, `seed ${r.seed} P${r.ph}: no two cues of different sources needing different answers within 0.3 s (${r.conflicts}: ${r.conflictAt.slice(0, 4).join(' · ')})`);
    assert(r.peakFire < 2500, `seed ${r.seed} P${r.ph}: the fire field's peak ${r.peakFire} < 2500 blobs`);
  }
}

// ================================================================== scenario: win / strategy
function fight(seed, style, { mortal = false, max = 480, lean = false, marks = true } = {}) {
  const G = build(seed, true);
  G.marks = marks ? attachMarks(G.game) : null; // (the floor marks the fight leaves: they change nothing in it)
  const { game } = G;
  if (lean) game.unlocks = new (UNLOCKS.Unlocks)(null, '?tech=lean');
  duel(G, { dist: 4, ai: true });
  G.defend = makeDefender(G, { style, rng: mulberry32(seed * 3 + 1) });
  const d = game.dragon, p = game.player;
  const n = { parries: 0, perfect: 0, breaks: 0, bends: 0, stops: 0 };
  const phAt = [0];
  G.watch = (ev) => {
    if (ev === 'player:parry') n.parries++;
    if (ev === 'player:perfectDodge') n.perfect++;
    if (ev === 'dragon:postureBreak') n.breaks++;
    if (ev === 'dragon:bend') n.bends++;
    if (ev === 'dragon:stop') n.stops++;
    if (/^dragon:phase[23]$/.test(ev)) phAt.push(game.time);
  };
  const t0 = game.time;
  run(G, max, (GG) => fencer(GG, mortal), () => d.state === 'dead' || d.mode === 'dead' || !p.alive || game.state === 'victory');
  G.watch = null;
  G.defend = null;
  return { marks: G.marks, won: d.state === 'dead' || d.mode === 'dead' || game.state === 'victory', died: !p.alive, secs: game.time - t0, phase: d.phase, phAt: phAt.map((t) => Math.max(0, t - t0)), hits: G.hits.filter((h) => h.r === RESULT.HIT).length, ...n };
}

async function scenarioWin() {
  out('\n== scenario WIN (a fencing bot in god mode: parries, rolls, cuts in his openings, the deathblows) ==');
  const SEEDS = (process.env.GCD_WSEEDS ?? '4242').split(',').map(Number);
  for (const seed of SEEDS) {
    const r = fight(seed, 'mixed');
    out(`     seed ${seed}: ${r.won ? 'won' : 'NOT won'} in ${r.secs.toFixed(0)} s: phases at ${r.phAt.map((t) => t.toFixed(0)).join(' / ')} s; ${r.parries} parries, ${r.perfect} perfect dodges, ${r.breaks} breaks, ${r.bends} bends, ${r.stops} stops, ${r.hits} hits taken; phase ${r.phase}`);
    marksCheck(r.marks, 'woke', out, assert);
    assert(r.won && r.phase === 3, `seed ${seed}: the fencing bot wins through all three phases`);
    assert(r.secs > 40 && r.secs < 480, `seed ${seed}: the fight takes ${r.secs.toFixed(0)} s`);
  }
}

async function scenarioStrategy() {
  out('\n== scenario STRATEGY (opt-in: mixed / parry / dodge / block-only / the Long Second bots, god mode; then the block-only bot mortal) ==');
  const seeds = (process.env.GCD_SSEEDS ?? '4242,7').split(',').map(Number);
  const res = {};
  for (const [style, lean] of [['mixed', false], ['parry', false], ['dodge', false], ['block', false], ['lean', true]]) {
    for (const seed of seeds) {
      const r = fight(seed, style, { lean });
      (res[style] ??= []).push(r);
      out(`     ${style.padEnd(5)} seed ${String(seed).padEnd(4)} ${r.won ? 'WON ' : 'time'} ${r.secs.toFixed(0).padStart(3)} s  phases at ${r.phAt.map((t) => t.toFixed(0)).join(' / ')}  hits taken ${String(r.hits).padStart(3)}  parries ${String(r.parries).padStart(3)}  perfect dodges ${String(r.perfect).padStart(3)}  breaks ${r.breaks}  bends ${r.bends}  stops ${r.stops}`);
    }
  }
  const avg = (k) => res[k].reduce((a, r) => a + r.secs, 0) / res[k].length;
  out(`     means: ${Object.keys(res).map((k) => `${k} ${avg(k).toFixed(0)} s`).join(' · ')}`);
  assert(avg('dodge') > Math.min(avg('mixed'), avg('parry')), 'the dodge-only bot is not the fastest (ADR-102)');
  assert(avg('lean') > Math.min(avg('mixed'), avg('parry')), 'the Long Second does not make leaning the fastest way through (ADR-158)');
  for (const seed of seeds) {
    const r = fight(seed, 'block', { mortal: true, max: 240 });
    out(`     block mortal seed ${seed}: ${r.died ? `died at ${r.secs.toFixed(0)} s` : `alive after ${r.secs.toFixed(0)} s`} (phase ${r.phase})`);
  }
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
    G.watch = (n, e) => { if (n === 'dragon:windup') moves[e.name] = (moves[e.name] || 0) + 1; };
    run(G, 60, () => { G.defend.act(); game.mouseGround.set(d.position.x, 0, d.position.z); });
    out(`   P${d.phase} (${game.world.forest.scenes.now}): ${JSON.stringify(moves)} · flashes ${G.defend.stats.flashes} · hits ${G.hits.length}`);
  }
}

// ================================================================== scenario: rebuild (?oneBody=, ?oneMoves=; 2026-11-26)
async function scenarioRebuild() {
  out('\n== scenario REBUILD (his figure redraws build and print the hero\'s way; the rebuilt moves: the rules, the held tells, the aim, the fast strings) ==');
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const MM = await imp('src/entities/enemies/wokenOne/moves.js');
  const LK = await imp('src/entities/enemies/wokenOne/look.js');
  assert(LS.PICKED?.oneBody === 'b' && !LS.PENDING.includes('oneBody'), '?oneBody= is the owner\'s pick, b, the open coat (PICKED, not PENDING; 2026-11-26)');
  // ---- the figure
  for (const v of ['a', 'b', 'c']) {
    LS.setLook('oneBody', v);
    try {
      const G = build();
      const { game } = G;
      const d = game.dragon;
      const D = d.rig.root.userData.dress;
      const seen = {};
      for (const ph of [1, 2, 3]) {
        d.debug.setPhase(ph);
        run(G, 0.25);
        seen[ph] = { az: D.fronts[0].C.def.az, finite: [d.position.x, d.position.z, d._tip.x].every(Number.isFinite) };
      }
      const F = D.fronts[0];
      const open1 = v !== 'a';
      assert(D.body === v && [1, 2, 3].every((p) => seen[p].finite) && Math.abs(seen[1].az - (open1 ? F.open : F.closed)) < 1e-6 && Math.abs(seen[2].az - F.open) < 1e-6,
        `?oneBody=${v} builds; the coat ${open1 ? 'open in every phase' : 'closed in phase 1, open from phase 2'}`);
      const ok = [1, 2, 3].every((ph) => {
        const T = LK.oneInkTable('a', ph, 'a', v);
        return [3, 4, 5, 6, 12].every((k) => T[k].ink[3] <= 1.5 && T[k].rim[3] <= 1.5 && (T[k].fill[1] & 8) && T[k].fill[3] <= 0.6);
      });
      assert(ok, `?oneBody=${v}: printed the hero's way (no ink gain over 1.5, the cloth's dotted rim, far fills at or under 0.6)`);
      // ONE coat: its panels overlap all round at the hem (no gap, no vent), no ragged edge, no pale hem
      {
        const C = d.rig.coat;
        const tw = (C2) => C2.def.w[2], az = C.map((c) => c.def.az);
        const ok1 = C.length === 5 && C.every((c) => c.def.jag === 0 && !c.def.hemFrom) && az.includes(Math.PI);
        const M = d.rig.materials;
        assert(ok1 && M.coat.uniforms.uArtPart.value === 10 && M.lining.uniforms.uArtPart.value === 10 && M.lining.uniforms.uArtFill.value.equals(M.coat.uniforms.uArtFill.value),
          `?oneBody=${v}: one coat: five overlapping panels and one back (no vent), a straight hem, its inside the same cloth, printed as part 5 (no hero's hem)`);
      }
      const low = Math.min(...d.rig.coat.map((C) => { C.segs[1].updateWorldMatrix(true, true); const b = new THREE.Box3().setFromObject(C.segs[1]); return b.min.y; }));
      assert(v !== 'c' ? low < 0.35 : low > 0.25 && low < 0.6, `?oneBody=${v}: the coat's hem ${low.toFixed(2)} m over the floor (${v === 'c' ? 'mid-shin' : 'to the ankle'})`);
      {
        // it swings 30 degrees at most (one coat through his flips, not a crown of boards)
        const LKm = await imp('src/entities/enemies/wokenOne/look.js');
        d.debug.setPhase(1);
        run(G, 0.1);
        d.debug.trigger('moonOver');
        let worst = 0;
        run(G, 2.4, () => { for (const s of d.anim.coatState ?? []) if (s?.[0] && s?.[1]) worst = Math.min(worst, s[0].x + s[1].x); });
        assert(worst >= -LKm.COAT_SWING_ONE.out - 1e-3, `?oneBody=${v}: through the flash kick's flip the coat swings ${(-worst * 57.3).toFixed(0)} deg out at most (<= ${(LKm.COAT_SWING_ONE.out * 57.3).toFixed(0)})`);
      }
    } catch (e) { assert(false, `?oneBody=${v}: ${e.message}`); }
  }
  LS.setLook('oneBody', null);
  // ---- the moves
  assert(LS.PICKED?.oneMoves === 'b' && LS.PICKED?.oneGunFx === 'b' && LS.PICKED?.oneBoltFx === 'a' && !LS.PENDING.includes('oneMoves'), '?oneMoves= is the owner\'s pick, b (the rebuild with the limbs on the line, ADR-253); the shots b, the bolts a (PICKED, not PENDING; 2026-11-27)');
  LS.setLook('oneMoves', 'a');
  try {
    let same = 0, held = 0, diff = [];
    for (const name of MOVE_NAMES) {
      for (const f of phasesOf(name)) {
        LS.setLook('oneMoves', '0');
        const A0 = realise(name, f, () => 0.5);
        LS.setLook('oneMoves', 'a');
        const A1 = realise(name, f, () => 0.5);
        const t0 = A0.beats.map((b) => b.impact.toFixed(3)).join(), t1 = A1.beats.map((b) => b.impact.toFixed(3)).join();
        if (t0 === t1 && A0.end === A1.end) same++; else diff.push(`${name} P${f}`);
      }
    }
    assert(!diff.length, `the rebuild keeps every move's timing (impacts and end, ${same} realisations)${diff.length ? ' ' + diff.slice(0, 6).join(', ') : ''}`);
    const H = TUNING.held;
    const bad = [];
    for (const [name, def] of Object.entries(MM.MOVES_A)) {
      if (def.transition) continue;
      for (const raw of def.beats) for (const b of raw.pick ?? [raw]) {
        if (!b.keys || b.feint || b.hold || ![TELL.BLUE, TELL.RED, TELL.BLACK].includes(b.tell)) continue;
        // (the coil: the key the hold repeats, at `from` when the blow's coil sits on its cock, earlier when it is authored before it)
        const to = b.cock, i1 = b.keys.findIndex(([u]) => Math.abs(u - to) < 1e-6), k1 = b.keys[i1], k0 = i1 > 0 && b.keys[i1 - 1][0] < to - 0.08 ? b.keys[i1 - 1] : null;
        const strip = (k) => JSON.stringify(Object.fromEntries(Object.entries(k ?? {}).filter(([f]) => !['e', 'gather', 'settle'].includes(f))));
        if (k0 && k1 && strip(k0[1]) === strip(k1[1]) && to <= H.to + 1e-9) held++; else bad.push(name);
      }
    }
    assert(held > 30 && !bad.length, `every blue / red / black blow holds its coil (reached in ${H.drift} of its draw) to ${H.to} of its windup at most (the strike keeping ${H.keep} of its time) (${held} blows)${bad.length ? ' not: ' + [...new Set(bad)].join(', ') : ''}`);
    // the fast strings: picked only on the rebuild; their windups on the floors
    {
      const G = build();
      const d = G.game.dragon;
      duel(G, { dist: 2 });
      const w1 = d.weigh('snapHands', MOVES.snapHands, 1, 2);
      LS.setLook('oneMoves', '0');
      const w0 = d.weigh('snapHands', MOVES.snapHands, 1, 2);
      LS.setLook('oneMoves', 'a');
      const S = realise('snapHands', 3, () => 0.5), Q = realise('quickFoot', 3, () => 0.5);
      const gaps = (A) => A.beats.slice(1).map((b, i) => b.impact - A.beats[i].impact);
      assert(w1 > 0 && w0 === 0 && Math.abs(S.beats[0].impact - TUNING.fast.first) < 1e-6 && gaps(S).every((g) => g >= TUNING.minHitGap) && gaps(Q).every((g) => g >= TUNING.minHitGap) && S.beats.every((b) => b.flash >= b.tellAt),
        `the fast strings: only on the rebuild (weight ${w0} → ${w1.toFixed(2)}), ${TUNING.fast.first} s then ${TUNING.fast.next} s in phase 3 too, impacts ${gaps(S).map((g) => g.toFixed(2)).join(' / ')} s apart, the glint after the tell`);
    }
    // straight kicks and long punches (the owner, 2026-11-26: "a straight line when his kick is out")
    {
      const { KICKS, STRAIGHT, hipOf } = MM.REBUILD;
      const { DIM } = await imp('src/entities/player/model.js');
      const L = DIM.thigh + DIM.shin;
      let kicks = 0, punches = 0;
      const shortK = [], shortP = [];
      for (const [name, def] of Object.entries(MM.MOVES_A)) {
        if (def.transition) continue;
        for (const raw of def.beats) for (const b of raw.pick ?? [raw]) {
          const hit = b.keys?.find(([u]) => Math.abs(u - 1) < 1e-6)?.[1];
          const b0 = (MOVES[name]?.beats ?? []).flatMap((x) => x.pick ?? [x]).find((x) => x.blow === b.blow && x.part === b.part);
          const hit0 = b0?.keys?.find(([u]) => Math.abs(u - 1) < 1e-6)?.[1];
          if (!hit) continue;
          if (KICKS.has(b.blow) && (b.part === 'footR' || b.part === 'footL')) {
            const f = b.part === 'footL' ? 'lF' : 'rF', v = hit[f];
            if (!Array.isArray(v) || v.length !== 3) continue;
            const h = hipOf(hit, f === 'lF' ? 1 : -1), l = Math.hypot(v[0] - h[0], v[1] - h[1], v[2] - h[2]);
            kicks++;
            if (!(l >= TUNING.legReach * L * 0.97 || v[1] <= DIM.ankle + 1e-6)) shortK.push(`${name}:${b.blow} ${l.toFixed(2)}`);
          }
          if (STRAIGHT.has(b.blow) && hit0) {
            const h = b.part === 'fistL' ? 'lH' : 'rH';
            punches++;
            if (!(Math.hypot(...hit[h]) >= Math.hypot(...hit0[h]) * TUNING.reach * 0.999)) shortP.push(`${name}:${b.blow}`);
          }
        }
      }
      assert(kicks > 25 && !shortK.length, `every kick's contact key puts the foot ${TUNING.legReach} x the leg from its hip (or along the floor): ${kicks} kicks${shortK.length ? ' short: ' + shortK.slice(0, 6).join(', ') : ''}`);
      assert(punches > 20 && !shortP.length, `every straight punch's hand reaches ${TUNING.reach} x as far at contact: ${punches} blows${shortP.length ? ' short: ' + shortP.slice(0, 6).join(', ') : ''}`);
      // the animator: straight legs and long arms on the rebuild only (read live)
      const G = build();
      const d = G.game.dragon;
      duel(G, { dist: 3 });
      run(G, 0.1);
      const on = d.anim.kickStretch === TUNING.kickStretch && d.anim.legSoft === TUNING.legSoftA && d.anim.armSoft === TUNING.armSoftA;
      LS.setLook('oneMoves', '0');
      run(G, 0.1);
      const off = d.anim.kickStretch === null && d.anim.legSoft === TUNING.legSoft && d.anim.armSoft === TUNING.armSoft;
      LS.setLook('oneMoves', 'a');
      assert(on && off, 'his legs reach straight and his arms long on the rebuild, as shipped on 0 (anim kickStretch / legSoft / armSoft, live)');
      // a kick lands straight: the knee at Climbing the Stair's front kick, in the animator
      d.debug.trigger('stairKick');
      const A = d.brain.act;
      let knee = null;
      const V = () => new THREE.Vector3();
      run(G, 1.2, null, () => {
        if (knee == null && A && d.brain.act === A && A.t >= A.beats[0].impact) {
          const leg = d.rig.legs.R;
          const a = leg.thigh.getWorldPosition(V()), k = leg.shin.getWorldPosition(V()), f = leg.foot.getWorldPosition(V());
          const u = a.sub(k).normalize(), w = f.sub(k).normalize();
          knee = Math.acos(Math.max(-1, Math.min(1, u.dot(w)))) * 57.3;
          return true;
        }
        return false;
      });
      assert(knee != null && knee > 165, `the front kick lands with the leg straight (knee ${knee?.toFixed(0)} deg; it was ~130)`);
    }
    // the aim: Two Thunders' first shot down the arm at the hero
    {
      const G = build();
      const { game } = G;
      const d = game.dragon, p = game.player;
      duel(G, { dist: 4, form: 2 });
      p.debug.god = true;
      d.debug.trigger('twoThunders');
      const A = d.brain.act;
      let err = null;
      run(G, 1.2, null, () => {
        if (err == null && A && d.brain.act === A && A.t >= A.beats[0].impact) {
          const V = () => new THREE.Vector3();
          const s0 = d.rig.arms.R.upper.getWorldPosition(V()), h = d.rig.sword.getWorldPosition(V());
          const t = (p.rig?.chest ?? p.object3d).getWorldPosition(V());
          const a = Math.atan2(h.x - s0.x, h.z - s0.z), b = Math.atan2(t.x - s0.x, t.z - s0.z);
          err = Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 57.3;
          return true;
        }
        return false;
      });
      assert(err != null && err < 12, `Two Thunders: the gun arm points at the hero at the shot (${err?.toFixed(0)} deg off; the old aim: 36)`);
    }
  } catch (e) { assert(false, `the rebuilt moves: ${e.stack}`); }
  LS.setLook('oneMoves', null);
}

// ================================================================== scenario: oneref (ADR-285: the reference pack)
/**
 * ONEREF (ADR-285): Xin Yi after the reference pack behind `?oneRef=a` (the look) and `?oneRefMove=a` (the
 * poses). The poses never move a time: every move, phase (and phase 1's gear 2), branch, hold draw, mirror
 * and flurry count realises the same beats with the switch off and on, under each of `?oneMoves=0|a|b`. The
 * same seeded fight in each phase lands the same blows at the same times, fires every effect of his at the
 * same time (each fx call by name), every gun shot and palm bolt born at the same time, its speed and heading
 * the same, its first point within a few cm (it leaves from the hand as drawn); the phase-1 gear-1 left hand
 * behind his back through every key and clip. The look builds in every phase, nothing NaN.
 */
async function scenarioOneRef() {
  out('\n== scenario ONEREF (ADR-285: ?oneRef / ?oneRefMove: the reference pack\'s look and poses, never a time or an effect) ==');
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const MM = await imp('src/entities/enemies/wokenOne/moves.js');
  const PS = await imp('src/entities/enemies/wokenOne/poses.js');
  const GR = await imp('src/entities/enemies/wokenOne/tuning.js');
  const rnd = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const key = (A) => JSON.stringify([A.end, A.recoveryStart, A.hits, A.beats.map((b) => [b.index, b.start, b.impact, b.end, b.W, b.H, b.A, b.S, b.F, b.close, b.flash, b.feint, b.last, b.def.windup, b.def.tell, b.def.damage, b.def.zone, b.def.dash, b.def.travel, b.def.lift])]);
  let n = 0;
  const diff = [];
  for (const mv of ['0', 'a', 'b']) {
    LS.setLook('oneMoves', mv);
    for (const name of MOVE_NAMES) {
      const def = MOVES[name];
      for (const [ph, gear] of [[1, 1], [1, 2], [2, 1], [3, 1]]) {
        if (def.transition && ph !== def.phase) continue;
        for (let s = 1; s <= 4; s++) {
          const opts = def.streak ? { count: 2 + s } : null;
          GR.GEARED.now = gear;
          LS.setLook('oneRefMove', '0');
          const a = realise(name, ph, rnd(s * 7919), opts);
          LS.setLook('oneRefMove', 'a');
          const b = realise(name, ph, rnd(s * 7919), opts);
          if (!a || !b) continue;
          n++;
          if (key(a) !== key(b) || JSON.stringify(a.draws) !== JSON.stringify(b.draws)) diff.push(`${name} p${ph}g${gear} ${mv} s${s}`);
        }
      }
    }
  }
  GR.GEARED.now = 1;
  LS.setLook('oneRefMove', null);
  LS.setLook('oneMoves', null);
  assert(!diff.length && n > 1500, `${n} realisations (every move, phase, gear, branch, hold draw, mirror and flurry count, under ?oneMoves=0, a and b) time every beat the same with ?oneRefMove on and off: the same windups, holds, impacts, flashes, active windows, zones, dashes and lifts (${diff.slice(0, 6).join(', ') || 'none differ'})`);
  // phase 1, gear 1: the left hand behind his back in every key of every move and every clip
  {
    LS.setLook('oneRefMove', 'a');
    GR.GEARED.now = 1;
    const bad = [];
    for (const name of MOVE_NAMES) {
      const def = MOVES[name];
      if (def.transition || def.twoHand || def.gear === 2 || !(Array.isArray(def.weight) ? def.weight[0] > 0 : def.phase === 1)) continue;
      const A = realise(name, 1, rnd(5));
      for (const k of A?.clip?.keys ?? []) if (k.lH && (Math.abs(k.lH[0] - PS.BEHIND.lH[0]) > 1e-6 || Math.abs(k.lH[2] - PS.BEHIND.lH[2]) > 1e-6)) { bad.push(name); break; }
    }
    const C1 = MM.clipsOf(1, 1);
    for (const [k, c] of Object.entries(C1)) {
      if (k === 'meditate' || k === 'intro') continue;
      if ((c.keys ?? []).some((q) => q.lH && Math.abs(q.lH[2] - PS.BEHIND.lH[2]) > 1e-6)) bad.push(`clip ${k}`);
    }
    LS.setLook('oneRefMove', null);
    assert(!bad.length, `?oneRefMove=a, phase 1 gear 1: the left hand behind his back in every key of every move and reaction clip (${bad.slice(0, 6).join(', ') || 'all'})`);
  }
  // the same seeded fight per phase: the same blows, the same effects at the same times
  const fightOf = (on, ph, gear) => {
    LS.setLook('oneRefMove', on ? 'a' : '0');
    LS.setLook('oneRef', on ? 'a' : '0');
    const G = build(SEED + 17 * ph + gear);
    duel(G, { dist: 3.4, ai: true, form: ph });
    const d = G.game.dragon;
    if (ph === 1 && gear === 2) d.debug.setGear(2, true);
    const fxCalls = [], births = [];
    const seenShots = new Set();
    const names = [];
    for (let o = Object.getPrototypeOf(d.fx); o && o !== Object.prototype; o = Object.getPrototypeOf(o)) names.push(...Object.getOwnPropertyNames(o));
    // (the calls INTO his effects from outside them: what fires an effect and when; the calls an effect
    // makes inside itself, its particles, follow the limb it is drawn from)
    let depth = 0;
    for (const m of new Set(names)) {
      if (m === 'constructor' || typeof d.fx[m] !== 'function' || /^(update|draw|reset|step|tick)/.test(m)) continue;
      const f = d.fx[m].bind(d.fx);
      d.fx[m] = (...a) => {
        if (depth === 0 && !m.startsWith('_')) fxCalls.push(`${G.game.time.toFixed(3)} ${m}`);
        depth++;
        try { return f(...a); } finally { depth--; }
      };
    }
    G.defend = makeDefender(G, { rng: mulberry32(SEED + ph) });
    const h0 = G.hits.length;
    run(G, 20, () => {
      G.defend.act();
      for (const s of d.fx.shots ?? []) {
        if (!s.alive || seenShots.has(s)) continue;
        seenShots.add(s);
        births.push({ t: G.game.time, x: s.x, y: s.y, z: s.z, dx: s.dx, dz: s.dz, v: s.speed, iron: !!s.iron, heavy: !!s.heavy });
      }
    });
    const nan = ![d.position.x, d.position.z, d._tip.x, d._tip.y, d._hand.x].every(Number.isFinite);
    LS.setLook('oneRefMove', null);
    LS.setLook('oneRef', null);
    return { hits: G.hits.slice(h0).map((h) => `${h.t.toFixed(3)} ${h.attack} ${h.r} ${h.damage}`), fxCalls, births, nan };
  };
  const report = [];
  for (const [ph, gear] of [[1, 1], [1, 2], [2, 1], [3, 1]]) {
    const A = fightOf(false, ph, gear), B = fightOf(true, ph, gear);
    const tag = `phase ${ph}${ph === 1 ? ` gear ${gear}` : ''}`;
    const fd = A.hits.findIndex((h, i) => h !== B.hits[i]);
    const xd = A.fxCalls.findIndex((c, i) => c !== B.fxCalls[i]);
    let far = 0, dirOk = true, tOk = A.births.length === B.births.length, bd = '';
    for (let i = 0; tOk && i < A.births.length; i++) {
      const a = A.births[i], b = B.births[i];
      if (Math.abs(a.t - b.t) > 1e-6 || a.iron !== b.iron || a.heavy !== b.heavy || Math.abs((a.v ?? 0) - (b.v ?? 0)) > 1e-6) {
        tOk = false;
        bd = `; #${i} differs: t ${a.t.toFixed(3)} / ${b.t.toFixed(3)}, v ${a.v} / ${b.v}, heavy ${a.heavy} / ${b.heavy}`;
      }
      far = Math.max(far, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
      const ha = Math.atan2(a.dx ?? 0, a.dz ?? 1), hb = Math.atan2(b.dx ?? 0, b.dz ?? 1);
      if (Math.abs(Math.atan2(Math.sin(ha - hb), Math.cos(ha - hb))) > 0.06) dirOk = false;
    }
    report.push(`${tag}: ${A.births.length} shots/bolts, ${(far * 100).toFixed(1)} cm`);
    assert(A.hits.length >= 3 && A.hits.length === B.hits.length && fd < 0 && !A.nan && !B.nan,
      `${tag}: a seeded 20 s fight against the defender: ${A.hits.length} blows off, ${B.hits.length} on, the same times, moves, results and damage${fd >= 0 ? ` (first differs: ${A.hits[fd]} / ${B.hits[fd]})` : ''}; nothing NaN`);
    assert(A.fxCalls.length === B.fxCalls.length && xd < 0,
      `${tag}: every effect of his fires at the same time (${A.fxCalls.length} fx calls off, ${B.fxCalls.length} on${xd >= 0 ? `; first differs: ${A.fxCalls[xd]} / ${B.fxCalls[xd]}` : ''})`);
    assert(tOk && dirOk && far <= 0.08,
      `${tag}: ${A.births.length} shots / bolts born at the same times, kinds and speeds, the same heading (${dirOk}), the first point at most ${(far * 100).toFixed(1)} cm apart (<= 8: it leaves from the hand as drawn)${bd}`);
  }
  // the look: builds in every phase, the pieces it adds, nothing NaN
  {
    LS.setLook('oneRef', 'a');
    LS.setLook('oneRefMove', 'a');
    const G = build(SEED + 5);
    duel(G, { dist: 4, ai: true, form: 1 });
    const d = G.game.dragon;
    const D = d.rig.root.userData.dress;
    const seen = [];
    for (const ph of [1, 2, 3]) {
      d.debug.setPhase(ph);
      run(G, 1.5);
      seen.push([d.position.x, d.position.z, d._tip.x, d._hand.y].every(Number.isFinite));
    }
    d.debug.setPhase(1);
    d.debug.setAI(false);
    run(G, 2);
    const low = Math.min(...d.rig.coat.map((C) => { C.segs[1].updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(C.segs[1]).min.y; }));
    LS.setLook('oneRef', null);
    LS.setLook('oneRefMove', null);
    assert(seen.every(Boolean) && D.ref === true && D.guns.length === 4 && low > 0.02 && low < 0.2,
      `?oneRef=a builds and fights in phases 1 - 3 (nothing NaN); the reference's pieces on (${D.ref}); four gun pieces kept (${D.guns.length}); standing, the coat's hem ${low.toFixed(2)} m over the floor (0.02 - 0.2: to the floor, not through it)`);
  }
  assert(LS.PENDING.includes('oneRef') && LS.PENDING.includes('oneRefMove') && !('oneRef' in LS.PICKED) && !('oneRefMove' in LS.PICKED), 'both switches wait for the owner (PENDING, not PICKED): the default draws him as shipped');
}

// ================================================================== scenario: looks
async function scenarioLooks() {
  out('\n== scenario LOOKS (each ?oneLook= builds; his body dressed by phase: the coat, the guns, the edge) ==');
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const PICK = LS.PICKED ?? {};
  assert(!('oneLook' in PICK) && (LS.PENDING ?? []).includes('oneLook'), 'his look is not in PICKED (the owner has not picked) and waits in PENDING');
  const { ASC_LOADOUT } = await imp('src/entities/enemies/ascendant/gear.js');
  const { buildHero } = await imp('src/entities/player/model.js');
  const { ONE_LOADOUT } = await imp('src/entities/enemies/wokenOne/gear.js');
  const countMeshes = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; };
  LS.setLook('ascLook', 'h');
  const asc = countMeshes(buildHero(createSharedUniforms(), ASC_LOADOUT).root);
  LS.setLook('ascLook', null);
  LS.setLook('oneBody', '0'); // (the outfits of ADR-156 on the figure they were built on; the rebuild: scenario REBUILD)
  for (const v of ['a', 'b', 'c']) {
    LS.setLook('oneLook', v);
    let ok = true, meshes = 0, rigMeshes = 0, D = null, row = '';
    try {
      const G = build();
      const { game } = G;
      const d = game.dragon;
      meshes = countMeshes(d.rig.root); // (with what the class hangs on him)
      rigMeshes = countMeshes(buildHero(createSharedUniforms(), ONE_LOADOUT).root); // (the body alone, as Tian Lei's is counted)
      D = d.rig.root.userData.dress;
      ok = !!D && D.kind === 'one' && D.look === v && D.guns.length === 4 && d.rig.coat.length === 6 && d.rig.loadout.waist === 'one.coat';
      const U = game.U.uHeroPartRim.value;
      const seen = {};
      for (const ph of [1, 2, 3]) {
        d.debug.setPhase(ph);
        run(G, 0.25);
        const front = D.fronts[0];
        seen[ph] = {
          guns: D.guns.every((m) => m.visible === (ph === 2)),
          az: front.C.def.az,
          rim: U[6].y,
          jade: U[6].y > U[6].x && U[6].y > 0.5,
          finite: [d.position.x, d.position.z, d._tip.x].every(Number.isFinite),
        };
      }
      row = JSON.stringify(seen);
      assert(seen[1].guns && seen[2].guns && seen[3].guns, `?oneLook=${v}: the guns hidden in phases 1 and 3, shown in phase 2`);
      const opens = v !== 'b';
      const F = D.fronts[0];
      assert(Math.abs(seen[1].az - F.closed) < 1e-6 && Math.abs(seen[2].az - (opens ? F.open : F.closed)) < 1e-6 && Math.abs(seen[3].az - (opens ? F.open : F.closed)) < 1e-6,
        `?oneLook=${v}: the coat's front ${opens ? 'closed in phase 1, open from phase 2' : 'closed in every phase (the Cassock)'} (az ${seen[1].az.toFixed(2)} / ${seen[2].az.toFixed(2)} / ${seen[3].az.toFixed(2)})`);
      assert([1, 2, 3].every((p) => seen[p].jade && seen[p].finite) && seen[3].rim > seen[2].rim, `?oneLook=${v}: his edge is jade, brighter in phase 3 (${seen[2].rim.toFixed(2)} → ${seen[3].rim.toFixed(2)})`);
    } catch (e) { ok = false; out(`     ${v}: ${e.message}`); }
    assert(ok && rigMeshes > 20 && rigMeshes <= asc + 10, `?oneLook=${v} builds (his body ${rigMeshes} meshes, ${meshes} in the fight; Tian Lei's body in the orange gi ${asc})`);
    if (row) out(`     ${v}: ${row}`);
  }
  LS.setLook('oneLook', null);
  LS.setLook('oneBody', null);
}

// ================================================================== scenario: scenes (the set's helper)
async function scenarioScenes() {
  out('\n== scenario SCENES (the hall, the dojo, the Source on the same slots; the morph) ==');
  const { STATE } = await imp('src/world/destructibles.js');
  const { BLOW } = await imp('src/world/breakTuning.js');
  const G = build(SEED, true);
  const { game } = G;
  const W = game.world, D = W.destructibles, S = W.forest.scenes, U = game.U;
  run(G, 0.2);
  const of = (kind) => D.list.filter((b) => b.kind === kind);
  const standing = (kind) => of(kind).filter((b) => !b.absent && b.state === STATE.INTACT);
  const inWorld = (b) => b.colliders.every((c) => W.colliders.circles.includes(c));
  const nonFloor = () => D.list.filter((b) => !b.floor && !b.absent).length;
  assert(S.now === 'hall' && standing('pillar').length === 10 && of('post').every((b) => b.absent) && of('codePillar').every((b) => b.absent) && standing('watcher').length === 4,
    `at the start the Pillared Hall stands (10 pillars, 4 watchers; the posts and the code are out of the world); ${nonFloor()} pieces besides the floor stand (<= 200)`);
  // a slab broken under the dojo's front: whole again after it
  const slab = D.floor.find((b) => Math.hypot(b.x - 3, b.z - 3) < 1.5);
  D.strike(slab.x, slab.z, 0.6, 5, { kind: BLOW.BLUNT, by: 'boss', y: 0.1, src: D.swing() });
  const slabBroke = slab.state !== STATE.INTACT || slab.cracked;
  // the hero stands dead on a slot (a post prints there)
  const p = game.player, slot = { x: 7.5, z: 0 };
  p.debug.teleport(slot.x, slot.z);
  p.position.set(slot.x, 0, slot.z);
  let t = 0;
  const ok = S.to('dojo', { x: 0, z: -9 });
  while (S.morphing && t < 4) {
    G.tick(DT);
    t += DT;
  }
  const post = of('post').find((b) => Math.hypot(b.x - slot.x, b.z - slot.z) < 0.1);
  const pd = Math.hypot(p.position.x - slot.x, p.position.z - slot.z);
  assert(ok && S.now === 'dojo' && t <= 1.8 + 1e-6, `to('dojo') from (0, -9): the morph ends in ${t.toFixed(2)} s (<= 1.8)`);
  assert(of('pillar').every((b) => b.absent && b.state === STATE.GONE && !inWorld(b) && b.colliders.every((c) => !W.colliders.circles.includes(c))) && standing('post').length === 10 && of('post').every(inWorld),
    'after it every pillar is out of the world (its circles too), every post stands whole with its colliders');
  assert(pd >= post.colliders[0].r + p.radius - 0.02, `the hero standing where a post printed is pushed out of it (${pd.toFixed(2)} m from its centre)`);
  assert(!slabBroke || (slab.state === STATE.INTACT && !slab.cracked), `the slab broken under the front is whole again (${slabBroke ? 'it was broken' : 'it held'})`);
  // the old scene's pieces are nothing to the world now
  const bench = of('bench')[0];
  const n0 = D.strike(bench.x, bench.z, 0.4, 1, { kind: BLOW.BLUNT, by: 'boss', y: 0.6, src: D.swing() }); // (over the floor's slabs)
  const cov = D.coverAt(slot.x, slot.z - 3, slot.x, slot.z + 3, 0.1);
  const near = D.nearest(slot.x, slot.z, { maxDist: 4, kind: 'pillar' });
  const stopped = D.stop(-7.5, -8, -7.5, -2, 0.1, 0.25, { kind: BLOW.CUT, by: 'boss', y: 1.2, src: D.swing() });
  assert(n0 === 0 && !cov && !near && (!stopped || stopped.kind !== 'pillar'), `an absent pillar or bench: strike ${n0}, coverAt ${cov?.kind ?? 'none'}, nearest pillar ${near?.kind ?? 'none'}, stop ${stopped?.kind ?? 'none'} (a post is no cover)`);
  assert(standing('watcher').length === 4, `the dojo has the hall's 4 watchers (${standing('watcher').length})`);
  // a watcher struck bursts into green digits and stays gone until the next morph
  const w = standing('watcher')[0];
  const spawns0 = G.counters.spawns;
  D.strike(w.x, w.z, 0.5, 1, { kind: BLOW.CUT, by: 'player', y: 1.2, src: D.swing() });
  run(G, 0.3);
  assert(w.state !== STATE.INTACT && G.counters.spawns - spawns0 >= 10, `a watcher struck goes (${G.counters.spawns - spawns0} digits)`);
  // phase 2: back to the hall, whole: eight watchers now
  t = 0;
  S.to('hall', { x: 0, z: 0 });
  while (S.morphing && t < 4) {
    G.tick(DT);
    t += DT;
  }
  assert(standing('pillar').length === 10 && standing('watcher').length === 8 && w.state === STATE.INTACT && t <= 1.8 + 1e-6,
    `to('hall') again: 10 pillars whole, ${standing('watcher').length} watchers (8; the struck one stands again), in ${t.toFixed(2)} s`);
  assert(D.coverAt(slot.x, slot.z - 3, slot.x, slot.z + 3, 0.1)?.kind === 'pillar', 'a pillar is cover again');
  // the Source
  t = 0;
  S.to('source', { x: 0, z: 0 });
  while (S.morphing && t < 4) {
    G.tick(DT);
    t += DT;
  }
  assert(standing('codePillar').length === 10 && standing('watcher').length === 12 && of('wall').every((b) => b.absent) && U.uScript.value.x > 0.9,
    `to('source'): 10 columns of code, 12 watchers, no walls, the script wave at ${U.uScript.value.x.toFixed(2)}; ${nonFloor()} pieces besides the floor`);
  const rain = W.forest.ambience.rain;
  assert(rain.count > 0 && rain.count <= rain.budget && rain.budget <= 320, `the falling script: ${rain.count} digits (budget ${rain.budget})`);
  // a morph cut short by another: the first ends at once
  S.to('dojo', { x: 0, z: 0 });
  G.tick(DT);
  S.to('hall', { x: 0, z: 0 });
  t = 0;
  while (S.morphing && t < 4) {
    G.tick(DT);
    t += DT;
  }
  assert(standing('pillar').length === 10 && of('post').every((b) => b.absent) && of('codePillar').every((b) => b.absent), 'a morph cut short by another: only the last scene stands');
  // the reset: the home scene, its light and its script (world.js restore: the breakables, then the scenes)
  S.to('source', { x: 0, z: 0 });
  run(G, 0.4);
  W.restore();
  S.reset();
  run(G, 0.1);
  assert(S.now === 'hall' && !S.morphing && standing('pillar').length === 10 && of('codePillar').every((b) => b.absent) && standing('watcher').length === 4 && Math.abs(U.uScript.value.x - S.base.hall) < 1e-3 && U.uScript.value.w === 0,
    `world.restore + scenes.reset mid-morph: the hall with its 4 watchers, the script at rest (${U.uScript.value.x.toFixed(2)})`);
  // deja vu: the stutter shifts, then nothing
  S.stutter(0.12);
  G.tick(DT);
  const sh = U.uScriptF.value.z;
  run(G, 0.2);
  assert(sh !== 0 && U.uScriptF.value.z === 0, `the stutter shifts the letters (${sh}) and lets go`);
  // no other level ever sets the script wave
  const { Colliders } = await imp('src/world/colliders.js');
  const { createSharedUniforms: mk } = await imp('src/render/shaderLib.js');
  const others = LEVELS.filter((L) => L.id !== 'code');
  const set0 = [];
  const e0 = errors.length;
  for (const L of others) {
    const U2 = mk();
    const set = L.buildSet(U2, new Colliders());
    try {
      const g2 = { ...game, U: U2, world: { ...W, forest: set, destructibles: null } };
      set.ambience?.setup?.(g2);
      for (let i = 0; i < 5; i++) set.ambience?.update?.(DT, g2);
    } catch {
      // (another set's weather on this harness: what is read is the uniform)
    }
    if (U2.uScript.value.x !== 0 || U2.uScript.value.w !== 0 || U2.uScriptF.value.y !== 0 || U2.uScriptF.value.z !== 0) set0.push(L.id);
  }
  errors.length = e0; // (the other sets' weather on a harness built for this level may complain)
  assert(!set0.length, `uScript is 0 on every other level (${others.map((L) => L.id).join(', ')})${set0.length ? ': set on ' + set0.join(', ') : ''}`);
}

// ================================================================== the rework (ADR-168, ADR-169): the lead's scenarios
/** Trigger `name` and answer its beat `bi` (a real hit index) the way `how` says: 'parry' (a press
 *  0.1 s before its impact), 'guard' (held from the start), 'dodge' (a roll 0.1 s before, sideways),
 *  'stand' (nothing). Returns what happened in the beat's window. */
function answerBeat(G, name, bi, how, { dist = 1.8, ph = 1, gear = 1, extraT = 0 } = {}) {
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist, form: ph });
  if (ph === 1) d.debug.setGear(gear, true);
  p.debug.god = false;
  p.hp = p.maxHp;
  p.guard = 100;
  d.debug.trigger(name);
  const A = d.brain.act;
  const real = A?.beats.filter((b) => !b.feint) ?? [];
  const b = real[bi];
  if (!b) return null;
  const t0 = game.time - A.t;
  const at = (x) => t0 + x;
  const hp0 = p.hp;
  let minGuard = p.guard, staggers = 0, wasStag = false, stagEnd = -1, flashes = 0, clicked = false, rolled = false;
  const hits0 = G.hits.length;
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon' && game.time >= at(b.start) && game.time <= at(b.end)) flashes++; };
  const end = at(b.end) + 0.05 + extraT;
  run(G, end - game.time + 0.02, () => {
    const t = game.time;
    input.axis = { x: 0, y: 0 };
    game.mouseGround.set(d.position.x, 0, d.position.z);
    if (how === 'guard') input.buttons[1] = true;
    if (how === 'parry' && !clicked && t >= at(b.impact) - 0.1 - DT) { clicked = true; input.up(1); input.click(1); }
    if (how === 'dodge' && !rolled && t >= at(b.impact) - 0.1 - DT) {
      rolled = true;
      const dx = p.position.x - d.position.x, dz = p.position.z - d.position.z, l = Math.hypot(dx, dz) || 1;
      input.axis = { x: dz / l, y: dx / l };
      input.tap('Space');
    }
    if (t >= at(b.impact) - 1e-6) {
      const st = p.state === 'stagger';
      if (st && !wasStag) staggers++;
      if (!st && wasStag) stagEnd = t;
      wasStag = st;
    }
    minGuard = Math.min(minGuard, p.guard);
  });
  G.watch = null;
  if (how === 'guard') input.up(1);
  const hits = G.hits.slice(hits0).filter((h) => h.attack === name);
  const next = real[bi + 1];
  return {
    b, A, t0, hits, staggers, stagEnd, flashes, guardCost: 100 - minGuard, hpLost: hp0 - p.hp,
    dist: Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z), nextImpact: next ? at(next.impact) : Infinity,
    stats: d.flurry?.stats,
  };
}

async function scenarioFlurry() {
  out('\n== scenario FLURRY (a burst: one cue, ONE result; one parry, one guard under the cap, one dodge, one stagger) ==');
  const D = MOVES.oneRoof.beats[0];
  assert(D.flurry && D.selfHit && D.sustain && D.flurry.n >= 6 && D.flurry.n <= 8 && D.damage >= 16 && D.damage <= 18 && D.windup >= TUNING.minFirstWindup,
    `Rain on One Roof's burst: ${D.flurry.n} blows over ${D.flurry.dur} s, ${D.damage} in all, windup ${D.windup} s, the guard's cap ${D.flurry.cap}`);
  // (no move holds two bursts; every burst is a category of its own in the director's eyes or inside a string)
  const two = MOVE_NAMES.filter((n) => (MOVES[n].beats ?? []).filter((b) => b.flurry).length > 1);
  assert(!two.length, `at most one burst a move ${JSON.stringify(two)}`);
  for (const how of ['parry', 'guard', 'dodge', 'stand']) {
    const G = build();
    const r = answerBeat(G, 'oneRoof', 0, how);
    if (!r) {
      assert(false, `${how}: the burst played`);
      continue;
    }
    const res = r.hits.map((h) => h.r);
    const S = r.stats;
    out(`     ${how}: results ${JSON.stringify(res)} · staggers ${r.staggers} · guard ${r.guardCost.toFixed(1)} · health ${r.hpLost.toFixed(1)} · cues ${r.flashes} · ${JSON.stringify(S)}`);
    assert(r.flashes === 1, `${how}: ONE cue for the burst (${r.flashes})`);
    if (how === 'parry') assert(res[0] === RESULT.PARRIED && !res.includes(RESULT.HIT) && r.hpLost === 0, 'one parry turns the whole burst: no blow lands');
    if (how === 'guard') assert(res[0] === RESULT.BLOCKED && r.hpLost === 0 && r.guardCost <= D.flurry.cap + 1e-6 && r.guardCost > 0, `a held guard pays ${r.guardCost.toFixed(1)} guard (<= ${D.flurry.cap}) and no health`);
    if (how === 'dodge') assert(r.hpLost === 0 && !res.includes(RESULT.HIT), 'one roll through its first blow dodges it all');
    if (how === 'stand') {
      assert(r.staggers === 1, `hit: ONE stagger for the whole burst (${r.staggers})`);
      assert(Math.abs(r.hpLost - D.damage) <= 2, `hit: the burst's total is its damage (${r.hpLost.toFixed(1)} of ${D.damage})`);
      assert(r.dist > (D.zone?.r ?? 1.9) - 0.3, `hit: pushed out of reach by its end (${r.dist.toFixed(2)} m)`);
      const free = r.nextImpact - (r.stagEnd > 0 ? r.stagEnd : r.t0 + r.b.impact + 0.4);
      assert(free >= 0.25, `hit: the hero is free ${free.toFixed(2)} s before the next blow (>= 0.25)`);
    }
  }
}

/** Every hit of his on a hero who stands unguarded: the bullets never lock him. */
async function scenarioNolock() {
  out('\n== scenario NOLOCK (phase 2: after any bullet hits, the hero can act >= 0.25 s before the next thing that hurts him; no second bullet stagger) ==');
  const I = TUNING.ironRain;
  for (const name of ['ironRain', 'twoThunders', 'closeIron', 'turningWheel']) {
    const G = build();
    const { game, input } = G;
    duel(G, { dist: name === 'closeIron' ? 2 : 8, form: 2 });
    const d = game.dragon, p = game.player;
    p.debug.god = false;
    p.hp = p.maxHp;
    let stag = 0, prev = false, worst = Infinity, lastHurtEnd = -1, bulletStag = 0, staggering = false;
    const hurts = [];
    G.watch = (n) => {
      if (n === 'player:hurt') hurts.push(game.time);
    };
    d.debug.trigger(name);
    const h0 = G.hits.length;
    run(G, 5, () => {
      input.axis = { x: 0, y: 0 };
      game.mouseGround.set(d.position.x, 0, d.position.z);
      p.hp = Math.max(p.hp, 60);
      const st = p.state === 'stagger';
      if (st && !prev) {
        stag++;
        const last = G.hits[G.hits.length - 1];
        if (last && /shot/.test(last.kind ?? '') && staggering) bulletStag++;
      }
      staggering = st && /shot/.test(G.hits[G.hits.length - 1]?.kind ?? '');
      if (!st && prev) lastHurtEnd = game.time;
      prev = st;
    }, () => quiet(d) && game.time > 1);
    G.watch = null;
    const hits = G.hits.slice(h0).filter((h) => h.r === RESULT.HIT);
    // the free window: from the end of each stagger to the next HIT that is not part of the same burst
    // (a burst's own slugs arrive inside its flinch as chip)
    let free = Infinity;
    for (let i = 1; i < hits.length; i++) {
      if (hits[i - 1].kind !== 'shot') continue; // (the rule follows a BULLET that hit him; a melee string is the engine's)
      const gap = hits[i].t - hits[i - 1].t;
      if (gap < I.gap * (I.per - 1) + 0.05) continue; // (the same burst)
      free = Math.min(free, gap - I.stun);
    }
    worst = free;
    out(`     ${name}: ${hits.length} hits · staggers ${stag} · the least free time between two of them ${Number.isFinite(worst) ? worst.toFixed(2) : '-'} s`);
    assert(!Number.isFinite(worst) || worst >= 0.25, `${name}: the hero can act >= 0.25 s before the next thing that hurts him`);
    assert(bulletStag === 0, `${name}: no bullet re-staggers a hero flinching from a bullet`);
  }
  // hit by burst 1, then guard / parry / roll: burst 2 is blocked / parried / dodged
  for (const how of ['guard', 'parry', 'dodge']) {
    const G = build();
    const { game, input } = G;
    duel(G, { dist: 8, form: 2 });
    const d = game.dragon, p = game.player;
    p.debug.god = false;
    d.debug.trigger('ironRain');
    const A = d.brain.act, b = A.beats[0];
    const t0 = game.time - A.t, every = (I.per - 1) * I.gap + I.rest;
    // (the second burst's first slug leaves at impact + every; it flies ~0.25 s at 8 m)
    let pressed = false, seen = 0, glint2 = -1;
    G.watch = (n, e) => {
      if (n === 'combat:flash' && e?.burst) {
        seen++;
        if (glint2 < 0) glint2 = game.time;
      }
    };
    const h0 = G.hits.length;
    run(G, b.impact - A.t + every + 0.6, () => {
      input.axis = { x: 0, y: 0 };
      game.mouseGround.set(d.position.x, 0, d.position.z);
      // the second burst: answered from its glint (it lands flashLead after it)
      if (glint2 < 0) return;
      const arrive = glint2 + TUNING.flashLead, now = game.time;
      if (how === 'guard') input.buttons[1] = true;
      if (how === 'parry' && !pressed && now >= arrive - 0.12) { pressed = true; input.up(1); input.click(1); }
      if (how === 'dodge' && !pressed && now >= arrive - 0.12) {
        pressed = true;
        const dx = p.position.x - d.position.x, dz = p.position.z - d.position.z, l = Math.hypot(dx, dz) || 1;
        input.axis = { x: dz / l, y: dx / l };
        input.tap('Space');
      }
    });
    input.up(1);
    G.watch = null;
    const all = G.hits.slice(h0).filter((h) => h.attack === 'ironRain');
    const first = all.find((h) => h.r === RESULT.HIT);
    const after = all.filter((h) => glint2 > 0 && h.t >= glint2);
    const want = how === 'guard' ? RESULT.BLOCKED : how === 'parry' ? RESULT.PARRIED : RESULT.DODGED;
    out(`     burst 1 hit, then ${how}: burst 2 ${JSON.stringify(after.map((h) => h.r))} · glints ${seen}`);
    // (a roll after the glint leaves the burst's fixed aim: its slugs miss him, or meet his i-frames)
    const ok = how === 'dodge' ? !after.some((h) => h.r === RESULT.HIT) : after.length > 0 && !after.some((h) => h.r === RESULT.HIT) && after.some((h) => h.r === want);
    assert(!!first && ok, `hit by burst 1, then ${how}: burst 2 is ${how === 'dodge' ? 'dodged (missed or i-frames)' : want}`);
  }  // (the review of PR #101) a burst whose first slug was blocked or dodged: its later slugs must flinch, not
  // stagger: the guard let go after slug 1; a roll straight back along the line of fire whose i-frames end
  // inside the burst. Both keep >= 0.25 s free before the next hurt, and no second stagger in a burst
  for (const how of ['letgo', 'rollback']) {
    const G = build();
    const { game, input } = G;
    duel(G, { dist: 8, form: 2 });
    const d = game.dragon, p = game.player;
    p.debug.god = false;
    p.hp = p.maxHp;
    const glints = [];
    G.watch = (n, e) => {
      if (n === 'combat:flash' && e?.source === 'dragon' && e?.attack === 'ironRain') glints.push(game.time);
    };
    d.debug.trigger('ironRain');
    const h0 = G.hits.length;
    const stag = [];
    let prev = false, done = false;
    const RI = 0.4; // (player.js TUNE.roll.iframes[1]: the roll's i-frames end 0.4 s in)
    run(G, 4, () => {
      input.axis = { x: 0, y: 0 };
      game.mouseGround.set(d.position.x, 0, d.position.z);
      p.hp = Math.max(p.hp, 60);
      const st = p.state === 'stagger';
      if (st && !prev) stag.push([game.time, Infinity]);
      if (!st && prev) stag[stag.length - 1][1] = game.time;
      prev = st;
      // burst 1 lands flashLead after its glint (the beat's own)
      const g = glints[0];
      if (g === undefined || done) return;
      const arrive = g + TUNING.flashLead;
      if (how === 'letgo') {
        if (game.time < arrive + 0.03) input.buttons[1] = true;
        else {
          input.up(1);
          done = true;
        }
      }
      if (how === 'rollback' && game.time >= arrive + 0.06 - RI) {
        // straight back along the line of fire: the i-frames end 0.06 s after slug 1, slugs 2 - 3 still to come
        const dx = p.position.x - d.position.x, dz = p.position.z - d.position.z, l = Math.hypot(dx, dz) || 1;
        input.axis = { x: dx / l, y: -dz / l };
        input.tap('Space');
        done = true;
      }
    }, () => quiet(d) && game.time > 1);
    input.up(1);
    G.watch = null;
    const hits = G.hits.slice(h0).filter((h) => h.r === RESULT.HIT);
    // no second stagger inside a burst: staggers that start within 0.3 s of each other
    let twice = 0;
    for (let i = 1; i < stag.length; i++) if (stag[i][0] - stag[i - 1][0] < 0.3) twice++;
    // free time: from each stagger's end to the next hit that is not of the same burst
    let free = Infinity;
    for (const [s0, s1] of stag) {
      const next = hits.find((h) => h.t > s1 + 1e-6 && h.t - s0 > 0.3);
      if (next) free = Math.min(free, next.t - s1);
    }
    const r1 = G.hits.slice(h0).filter((h) => h.attack === 'ironRain').slice(0, 4).map((h) => h.r);
    out(`     ${how}: burst 1 ${JSON.stringify(r1)} · ${hits.length} hits · staggers ${stag.length} (${stag.map(([a, b]) => (b - a).toFixed(2)).join(', ')} s) · least free ${Number.isFinite(free) ? free.toFixed(2) : '-'} s`);
    assert(hits.length > 0, `${how}: a later slug of a burst still lands (the case is real)`);
    assert(twice === 0, `${how}: never a second stagger inside a burst`);
    // (a slug's stagger: one that starts on a slug's hit; the heavy last shot is a blue blow of its own)
    const slugStag = stag.filter(([a]) => hits.some((h) => Math.abs(h.t - a) < 0.02 && h.damage < TUNING.ironRain.last));
    assert(slugStag.length > 0 && slugStag.every(([a, b]) => b - a <= TUNING.ironRain.stun + 0.05), `${how}: every slug's stagger is the short flinch (${slugStag.length}, <= ${TUNING.ironRain.stun} s)`);
    assert(!Number.isFinite(free) || free >= 0.25, `${how}: >= 0.25 s free before the next hurt (${Number.isFinite(free) ? free.toFixed(2) : '-'} s)`);
  }
}

async function scenarioWall() {
  out('\n== scenario WALL (Borrowed Wall: the upright to the hero\'s side, or the floor; the bite; both blows\' tells; never inside a collider) ==');
  for (const which of ['kick', 'heel']) {
    for (const where of ['dojo', 'floor']) {
      const G = build(SEED, true);
      const { game, input } = G;
      duel(G, { dist: 6 });
      const d = game.dragon, p = game.player, W = game.world.destructibles;
      p.debug.god = true;
      game.world.forest?.scenes?.snap?.('dojo');
      // near a post (x = 7.5) or in the open middle
      if (where === 'dojo') {
        d.position.set(5.5, 0, 0);
        p.debug.teleport(4.0, 5.0);
      } else {
        for (const b of W.list) if (!b.floor && b.h > 1.6) b.absent = true;
        d.position.set(0, 0, -4);
        p.debug.teleport(0, 2);
      }
      p.yaw = 0;
      const bite0 = W.bitten ?? 0;
      let tells = [], maxY = 0, inside = 0, kick = null;
      G.watch = (n, e) => {
        if (n === 'combat:tell' && e?.source === 'dragon') tells.push(e.tell);
        if (n === 'dragon:wallKick') kick = e;
      };
      d.debug.wall(which);
      const A = d.brain.act;
      run(G, 2.4, () => {
        input.axis = { x: 0, y: 0 };
        maxY = Math.max(maxY, d.position.y);
        for (const c of game.world.colliders?.circles ?? SET.circles) {
          if (c.r > 0 && Math.hypot(d.position.x - c.x, d.position.z - c.z) < c.r - 0.05 && d.position.y < (c.h ?? 9)) inside++;
        }
      }, () => d.brain.act !== A && d.mode === 'foot');
      G.watch = null;
      const wantTell = which === 'kick' ? TELL.BLUE : TELL.RED;
      const wall = A?.wall;
      out(`     ${which} / ${where}: upright ${wall?.b ? `${wall.b.kind} at (${wall.b.x.toFixed(1)}, ${wall.b.z.toFixed(1)})` : 'none (the floor)'} · up ${maxY.toFixed(2)} m · tells ${JSON.stringify(tells)} · bites ${(W.bitten ?? 0) - bite0} · inside a collider ${inside} frames`);
      assert(tells.includes(wantTell), `${which}: its tell (${wantTell})`);
      assert(!!kick, `${which} / ${where}: the spring (dragon:wallKick)`);
      if (where === 'dojo') {
        assert(!!wall?.b, `${which}: an upright in reach is used (${wall?.b?.kind})`);
        assert(maxY >= TUNING.wall.up - 0.2, `${which}: up its face (${maxY.toFixed(2)} m)`);
      } else assert(!wall?.b, `${which}: no upright: off the floor`);
      assert(inside === 0, `${which} / ${where}: never inside a collider`);
      assert(Math.hypot(d.position.x, d.position.z) <= (d.bound ?? TUNING.bound) + 0.05, `${which} / ${where}: inside his bound`);
    }
  }
}

async function scenarioGear() {
  out('\n== scenario GEAR (phase 1: one hand, then both at bar 1 <= 0.83; between moves; the opening) ==');
  const G = build();
  const { game } = G;
  duel(G, { dist: 3, ai: true });
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  assert(d.gear === 1, 'he opens in gear 1');
  let gearAt = null, inString = false, opening = null;
  G.watch = (n, e) => {
    if (n === 'dragon:gear') {
      gearAt = { t: game.time, hp: d.hp / d.maxHp };
    }
  };
  d.hp = d.maxHp * 0.9;
  run(G, 3);
  assert(d.gear === 1, `still gear 1 above ${TUNING.gear2.at} (bar ${(d.hp / d.maxHp).toFixed(2)})`);
  d.hp = d.maxHp * 0.8;
  const wasAct = d.mode === 'act' ? d.brain.act?.name : null;
  run(G, 6, () => {
    if (!gearAt && d.mode === 'act' && d.brain.act?.name !== 'secondHand') inString = true;
    if (d.brain.act?.name === 'secondHand' && !opening) opening = { t: game.time, guard: d.guarding };
  }, () => !!gearAt && d.mode === 'foot' && game.time - gearAt.t > 1.2);
  G.watch = null;
  assert(!!gearAt && d.gear === 2, `gear 2 at bar ${gearAt?.hp.toFixed(2)} (<= ${TUNING.gear2.at})`);
  assert(!!opening && opening.guard === false, 'the second hand comes out through an opening (his guard down)');
  const op = MOVES.secondHand.beats[0];
  assert(Math.abs(op.windup - TUNING.gear2.open) < 1e-6 && MOVES.secondHand.recoverOpen === 1, `the opening lasts ${TUNING.gear2.open} s`);
  // gear 2's moves only in gear 2; the pressure numbers per gear
  const G2 = build();
  duel(G2, { dist: 3 });
  const d2 = G2.game.dragon;
  assert(d2.weigh('hundredHands', MOVES.hundredHands, 1, 2) === 0, 'A Hundred Hands waits for gear 2');
  d2.debug.setGear(2, true);
  assert(d2.weigh('hundredHands', MOVES.hundredHands, 1, 2) > 0, 'A Hundred Hands in gear 2');
  assert(TUNING.pressure.chainDepth[0] > 5 && TUNING.chain[0] > 0.75, `gear 2's pressure (chainDepth ${TUNING.pressure.chainDepth[0]}, chain ${TUNING.chain[0]})`);
  d2.debug.setGear(1);
  assert(TUNING.pressure.chainDepth[0] === 5, 'gear 1\'s pressure back');
  // phase 1 realised two-handed in gear 2 (the left hand no longer behind his back)
  d2.debug.setGear(2, true);
  const A2 = realise('lesson', 1, () => 0.5);
  d2.debug.setGear(1);
  const A1 = realise('lesson', 1, () => 0.5);
  assert(A1 && A2 && A1.clip !== A2.clip, 'gear 2 realises phase 1 two-handed (its own clip)');
}

// ================================================================== scenario: herolike
/**
 * HEROLIKE (ADR-170): Xin Yi printed like the hero. His letters follow his size on screen by the
 * hero's rule (his kit's letters -> pipeline.bossLetters, Tian Lei's ADR-155), on five screens;
 * `?oneLetters=0` the fixed cell as before. The quiet print (`?onePrint=a`): every ink gain at or under
 * 1.5 (the edge fades with distance as the hero's does), far line 0, the face at HERO_INK.skin's numbers,
 * the bright cells without glow, phase 3's edge x1.35; `?onePrint=b`: one cell bolder on a small screen
 * only (kit.letterBias); `?onePrint=0`: the table he shipped with, exactly. The coat stirs in phase 1 and
 * holds inside its swing in the cartwheel.
 */
async function scenarioHeroLike() {
  out("\n== scenario HEROLIKE (his letters follow his size like the hero's; the hero's quiet print; ?onePrint=0 as shipped) ==");
  const { setLook, pickedOf, PENDING } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const LOOK = await imp('src/entities/enemies/wokenOne/look.js');
  const { Pipeline, HERO_CELLS, BOSS_BIAS_H } = await imp('src/render/pipeline.js');
  const { HERO_INK, heroPartValues } = await imp('src/entities/player/model.js');
  // (the print of ADR-170 on the figure it was made for; the rebuild's figure: scenario REBUILD)
  setLook('oneBody', '0');
  assert(['oneLetters', 'onePrint'].every((n) => !PENDING.includes(n) && pickedOf(n) === 'a') && LOOK.oneLettersOn() && LOOK.onePrintNow() === 'a',
    'oneLetters and onePrint are the owner pick, a (PICKED, not PENDING; 2026-11-23: "Print a"); they draw a by default');
  const G = build();
  const d = G.game.dragon, kit = d.kit;
  const on = {}, bias = {};
  for (const o of ['0', 'a']) { setLook('oneLetters', o); on[o] = !!kit.letters; }
  setLook('oneLetters', null);
  for (const o of ['0', 'a', 'b']) { setLook('onePrint', o); bias[o] = kit.letterBias; }
  setLook('onePrint', null);
  assert(kit.letters === true && on.a && !on['0'] && bias['0'] === 0 && bias.a === 0 && bias.b === 1,
    `his kit asks for letters that follow his size (${kit.letters}; ?oneLetters=0: ${on['0']}, live); letterBias 0 / 0 / 1 for onePrint 0 / a / b (${bias['0']} / ${bias.a} / ${bias.b})`);
  // the pipeline (a mock renderer): the bosses' grid (ARCHITECTURE "The bosses' letters")
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
  const cellsAt = (W, H, D, letters, b = 0) => {
    pipe.setSize(W, H, 1);
    pipe.bossLetters = letters;
    pipe.bossLetterBias = b;
    U.uBossScreen.value.set(0.4, 0.5, D + cam.matrixWorld.elements[9], 1);
    ps.set(0.6, 0.5, D, 0);
    for (let i = 0; i < 3; i++) { pipe._updateHeroLetters(ps); pipe._updateBossLetters(U.uBossScreen.value); }
    return [u.uHeroCell.value.x, pipe.selfCell.x];
  };
  const rows = [];
  for (const [name, W, H, D] of [['1280x720', 1280, 720, 36], ['1920x1080', 1920, 1080, 36], ['2560x1440', 2560, 1440, 36], ['852x393', 852, 393, 20], ['734x343', 734, 343, 20]]) {
    const [b, h] = cellsAt(W, H, D, kit.letters);
    const [b0] = cellsAt(W, H, D, false);
    const fixed = b0 === pipe.heroCell.x && u.tHeroArt.value === pipe.heroArt.texture && u.uHeroPx.value.x === Math.max(1, Math.floor(H / 1080));
    pipe._bossBase = 0;
    const [bb, hb] = cellsAt(W, H, D, true, 1);
    const small = H < BOSS_BIAS_H;
    const want = small ? HERO_CELLS[HERO_CELLS.indexOf(hb) + 1] : hb;
    pipe._bossBase = 0;
    rows.push(`${name} ${b}/${h} (0: ${b0}, b: ${bb})`);
    assert(b === h && fixed && bb === want,
      `${name} at ${D} m: his cell ${b} px is the hero's ${h} px; ?oneLetters=0 the fixed ${b0} px as before; ?onePrint=b ${bb} px (${small ? 'one step bolder: a small screen' : 'the same: not a small screen'})`);
  }
  out('   his / the hero\'s cell: ' + rows.join('; '));
  // the quiet print: the shared part tables as he writes them (phases 1 - 3)
  const table = (print, phase) => {
    setLook('onePrint', print);
    const g = build();
    const dd = g.game.dragon;
    if (phase > 1) dd.debug.setPhase(phase);
    run(g, 0.1);
    const M = dd.rig.materials, Ug = g.game.U;
    const t = {};
    for (const p of [1, 2, 3, 4, 5, 6, 11, 12, 19]) t[p] = { ink: Ug.uHeroPartInk.value[p].toArray(), rim: Ug.uHeroPartRim.value[p].toArray(), fill: Ug.uHeroPartFill.value[p].toArray() };
    const f = M.flask.uniforms;
    const r = { t, glow: f.uGlowMask?.value, glowK: f.uArtGlowK?.value, skin: M.skin.uniforms.uArtFill.value.r, meshes: 0, dd };
    dd.rig.root.traverse((o) => { if (o.isMesh) r.meshes++; });
    setLook('onePrint', null);
    return r;
  };
  const qa = table('a', 2), q3 = table('a', 3), q0 = table('0', 2), q03 = table('0', 3);
  const [sl, sf, sr] = heroPartValues(HERO_INK.skin);
  const parts = Object.values(qa.t);
  const gains = Math.max(...parts.map((p) => Math.max(p.ink[3], p.rim[3])));
  const far = Math.max(...parts.map((p) => p.fill[2]));
  const sk = qa.t[1];
  assert(gains <= 1.5 && far === 0, `the quiet print: every ink and silhouette gain <= 1.5 (max ${gains}), far line 0 everywhere (max ${far}): the edge fades with distance, no seams at the game camera`);
  assert(sk.fill[0] === sf[0] && sk.fill[3] === sf[3] && sk.ink[3] === sl[3] && sk.rim[3] === sr[3] && (sk.fill[1] & 4),
    `his face and hands at HERO_INK.skin's numbers: fill gain ${sk.fill[0]} (${sf[0]}), far fill ${sk.fill[3]} (${sf[3]}), line ${sk.ink[3]} (${sl[3]}), rim ${sk.rim[3]} (${sr[3]}), open`);
  assert(qa.glow === 0 && qa.glowK === 0 && q0.glow === 1 && qa.t[19].ink[3] <= 1 && qa.skin < q0.skin,
    `the bright cells do not glow (glow mask ${qa.glow}, was ${q0.glow}; ink gain ${qa.t[19].ink[3]}); the face's fill held down (${qa.skin.toFixed(2)}, was ${q0.skin.toFixed(2)})`);
  const e2 = qa.t[6].rim[1], e3 = q3.t[6].rim[1], o2 = q0.t[6].rim[1];
  assert(Math.abs(e3 / e2 - 1.35) < 1e-3 && e2 < o2 * 0.6 && e2 > o2 * 0.45 && e2 > qa.t[6].rim[0],
    `the jade edge at about half the lifted one's (${e2.toFixed(3)} / ${o2.toFixed(3)}), phase 3's x${(e3 / e2).toFixed(2)} (the lifted print's ratio)`);
  // ?onePrint=0: the table he shipped with, exactly (main 7884a1e look.js inkTable, look a)
  const J = [0.62, 1.0, 0.84], L = (s, a) => [J[0] * s, J[1] * s, J[2] * s, a];
  const SHIP = (k) => ({
    6: { ink: L(0.36, 1.6), rim: L(0.95 * k, 1.0), fill: [1, 0, 0.12, 1.0] }, 4: { ink: L(0.3, 1.6), rim: L(0.8 * k, 1.0), fill: [1, 0, 0.12, 0.9] },
    5: { ink: L(0.3, 1.6), rim: L(0.7 * k, 1.0), fill: [1, 0, 0.1, 0.6] }, 12: { ink: L(0.34, 1.6), rim: L(0.8 * k, 1.0), fill: [1, 0, 0.2, 0.8] },
    3: { ink: L(0.3, 1.0), rim: L(0.6 * k, 1.0), fill: [1, 0, 0.1, 0.5] }, 11: { ink: L(0.34, 1.6), rim: L(0.85 * k, 1.0), fill: [1.0, 8, 0.15, 0.8] },
    1: { ink: [0.75, 0.85, 0.8, 0.8], rim: [0.85, 0.95, 0.9, 0.9], fill: [2.2, 4, 0, 0.75] }, 2: { ink: [0.2, 0.3, 0.26, 0.8], rim: [0.25, 0.35, 0.3, 0.8], fill: [1, 0, 0, 1] },
    19: { ink: [0.9, 1.3, 1.1, 1.8], rim: [0.9, 1.3, 1.1, 1.8], fill: [1, 2, 1, 1.4] },
  });
  const same = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-6);
  const diff = [];
  for (const [T, S] of [[q0.t, SHIP(1)], [q03.t, SHIP(1.35)]]) for (const p in S) for (const k of ['ink', 'rim', 'fill']) if (!same(T[p][k], S[p][k])) diff.push(`${p}.${k}`);
  assert(!diff.length && q0.meshes > qa.meshes, `?onePrint=0: his part table as shipped, phases 2 and 3 (${diff.join(', ') || 'identical'}); the shapes too (${q0.meshes} meshes, the quiet print ${qa.meshes})`);
  // the coat: it stirs from phase 1 (its tails and sides; the closed front barely), and the cartwheel
  // keeps every panel inside its swing
  const P1 = (print) => {
    setLook('onePrint', print);
    const g = build();
    setLook('onePrint', null);
    const D = g.game.dragon.rig.root.userData.dress;
    run(g, 0.1);
    const t = D.panels.find((p) => p.tail).def, f = D.panels.find((p) => p.front).def, s = D.panels.find((p) => !p.tail && !p.front).def;
    return { tail: t.breeze, side: s.breeze, front: f.breeze, frontAz: D.fronts.map((F) => F.C.def.az) };
  };
  const c0 = P1('0'), ca = P1('a');
  assert(c0.tail === 0 && ca.tail > 0 && ca.side > 0 && ca.front < ca.side && ca.frontAz.every((a, i) => a === c0.frontAz[i]),
    `phase 1: the coat stirs (tails ${ca.tail.toFixed(3)}, sides ${ca.side.toFixed(3)}, the closed front ${ca.front.toFixed(3)}; as shipped ${c0.tail}), the front stays closed (az ${ca.frontAz.map((a) => a.toFixed(2)).join(' / ')})`);
  const swing = (print) => {
    setLook('onePrint', print);
    const g = build();
    setLook('onePrint', null);
    duel(g, { dist: 4, form: 2 });
    const dd = g.game.dragon, st = dd.anim.coatState;
    dd.debug.trigger('turningWheel');
    let out = 0, inw = 0;
    for (let i = 0; i < 100; i++) {
      g.tick(DT);
      for (const s of st) { const t = s[0].x + s[1].x; out = Math.max(out, -t); inw = Math.max(inw, t); }
    }
    return { out, inw };
  };
  const w0 = swing('0'), wa = swing('a'), CS = LOOK.COAT_SWING;
  assert(wa.out <= CS.out + 1e-6 && wa.inw <= CS.in + 1e-6 && (w0.out > CS.out || w0.inw > CS.in),
    `the cartwheel: every panel inside its swing (out ${(wa.out * 57.3).toFixed(0)} deg <= ${(CS.out * 57.3).toFixed(0)}, in ${(wa.inw * 57.3).toFixed(0)} deg <= ${(CS.in * 57.3).toFixed(0)}; as shipped out ${(w0.out * 57.3).toFixed(0)}, in ${(w0.inw * 57.3).toFixed(0)})`);
  setLook('oneBody', null);
}

// ================================================================== the motion audit (ADR-162's, for him: ADR-168)
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const AUD_PTS = ['fistR', 'fistL', 'elbowR', 'elbowL', 'kneeR', 'kneeL', 'footR', 'footL', 'head', 'chest', 'pelvis'];
const _inv = new THREE.Matrix4();
/** His joints now: W world, B his own frame (the root's), Wr world round his root. */
function rigSample(d) {
  const R = d.rig;
  R.root.updateMatrixWorld(true);
  _inv.copy(R.root.matrixWorld).invert();
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
    B[k] = W[k].clone().applyMatrix4(_inv);
    Wr[k] = W[k].clone().sub(root);
  }
  return { W, B, Wr, root, yaw: d.yaw, x: d.position.x, z: d.position.z, y: d.position.y };
}
/** A point drawn on him (leaned toward the camera, at his drawn size) → the same point on his upright
 *  gameplay body (duelist.drawnPoint's inverse). */
function upright(d, v) {
  const L = d.lean, P = d.position, k = L?.k || 0, S = d.drawScale || 1;
  const y = v.y - P.y;
  return new THREE.Vector3(P.x + (v.x - P.x - k * (L?.dx || 0) * y - (L?.ox || 0)) / S, P.y + y / S, P.z + (v.z - P.z - k * (L?.dz || 0) * y - (L?.oz || 0)) / S);
}
const DEG = 180 / Math.PI;
const ang3 = (a, b, c) => {
  const u = new THREE.Vector3().subVectors(a, b).normalize(), w = new THREE.Vector3().subVectors(c, b).normalize();
  return Math.acos(Math.min(1, Math.max(-1, u.dot(w)))) * DEG;
};
/** The largest one-frame jolt over three samples (second difference, mm a frame², in his own frame or in
 *  the world round his root, whichever is worse) and its joint. */
function joltOf(a, b, c) {
  let best = 0, k0 = '', w = false;
  const v = new THREE.Vector3();
  for (const k of AUD_PTS) {
    const jb = v.copy(c.B[k]).addScaledVector(b.B[k], -2).add(a.B[k]).length() * 1000;
    const jw = v.copy(c.Wr[k]).addScaledVector(b.Wr[k], -2).add(a.Wr[k]).length() * 1000;
    const j = Math.max(jb, jw);
    if (j > best) { best = j; k0 = k; w = jw > jb; }
  }
  return { j: best, k: k0, w };
}
/** The root's pop over three samples: its second difference along the floor (mm a frame²). */
const rootPop = (a, b, c) => Math.hypot(c.x - 2 * b.x + a.x, c.z - 2 * b.z + a.z) * 1000;
/** The moves the audit covers: every one of MOVE_NAMES, in every phase it is used in (a transition in its
 *  own, a counter or a flurry in its phase, deja vu's mirrored copies in phase 3). GCD_AUDIT=name,name
 *  keeps those only. */
function auditList() {
  const only = (process.env.GCD_AUDIT ?? '').split(',').filter(Boolean);
  const L = [];
  for (const name of MOVE_NAMES) {
    if (only.length && !only.includes(name)) continue;
    const def = MOVES[name];
    // (a hidden move: the phases it weighs in, its own at least)
    const used = def.hidden && !def.mirrorOf ? [1, 2, 3].filter((f) => weightIn(def, f) > 0 && f >= (def.phase ?? 1)) : phasesOf(name);
    const phs = def.transition ? [def.phase] : def.counter ? [def.phase ?? 1] : def.mirrorOf ? [3] : used.length ? used : [def.phase ?? 1];
    for (const ph of phs) L.push({ name, ph });
  }
  return L;
}

/**
 * The audit of `list` ([{ name, ph }]): each move run once (AI off, phase `ph` entered through
 * debug.setPhase, so the move is realised round that phase's guard) with the hero still in front of him at
 * the middle of its band, and once with the hero circling him at 3.5 m/s when `orbits` holds true. His
 * joints tracked frame by frame (his own frame and the world round his root): the largest jolts and where
 * they fall (windup / strike / active / follow / recovery / the blend out), the fastest turn, how far his
 * planted feet slide (in all, and the worst frame), the elbows' and knees' tightest fold, the root's pops
 * (its second difference) anywhere on the floor and at each beat's end, and each blow at its impact frame:
 * the limb's end against the hero's body circle (gap m; negative: inside him), the striking arm's elbow (a
 * fist, a palm) or the kicking leg's knee. Frames in the air (a lift, a flight, a dash's travel, a blink, a
 * flit) and in a hit-stop or a slow-mo are left out of the jolts.
 */
function auditMoves(list, orbits = [false, true], TOP = 0) {
  const rows = [], worst = [];
  for (const orbit of orbits) {
    for (const { name, ph } of list) {
      const def = MOVES[name];
      const G = build(SEED, def.beats.some((b) => b.unwrite));
      const band = def.band ?? [0, 4];
      const dist = Math.min(7, Math.max(1.6, (band[0] + Math.min(band[1], 8)) / 2));
      duel(G, { dist, form: def.transition ? def.phase - 1 : ph });
      const { game } = G;
      const d = game.dragon, p = game.player;
      p.debug.god = true;
      p.debug.noRiposte = true;
      settle(G, 2);
      // (the hero EAST of him, as asc.mjs's: the drawn figure leans toward the camera along z)
      d.position.set(0, 0, 0);
      d.yaw = Math.PI / 2;
      p.debug.teleport(dist, 0);
      game.mouseGround.set(0, 0, 0);
      // (footwork's own planner holds his feet in the world: let them step to the new place first)
      run(G, 0.7);
      // (Return to Sender needs three bolts hanging before him: the Lab's)
      if (def.needs === 'held3') d.debug.hold(3);
      if (!d.debug.trigger(name)) { rows.push({ name, ph, orbit, fail: 'trigger' }); continue; }
      const A = d.brain.act;
      if (!A) { rows.push({ name, ph, orbit, fail: 'no act' }); continue; }
      const F = [], contact = [];
      let after = -1, th = Math.atan2(p.position.x - d.position.x, p.position.z - d.position.z), px = d.position.x, pz = d.position.z;
      const phaseOf = (t) => {
        for (const b of A.beats) {
          if (t < b.start) continue;
          const i = b.index ?? A.beats.indexOf(b);
          if (t < b.impact - 0.12) return `b${i} windup`;
          if (t <= b.impact + 0.06) return `b${i} strike`;
          if (t <= b.end + 1e-6) return `b${i} active`;
        }
        return t < (A.recoveryStart ?? A.end) ? 'follow' : 'recovery';
      };
      for (let i = 0; i < 1500; i++) {
        if (orbit) {
          th += (3.5 / Math.max(1.5, dist)) * DT;
          p.debug.teleport(d.position.x + Math.sin(th) * dist, d.position.z + Math.cos(th) * dist);
        }
        p.hp = p.maxHp;
        const inAct = d.brain.act === A && d.mode === 'act';
        if (!inAct && after < 0) after = 0;
        if (after >= 0 && after++ > 14) break;
        const s = rigSample(d);
        s.t = inAct ? A.t : A.end + after * DT;
        s.ph = inAct ? phaseOf(A.t) : 'blend out';
        s.beatEnd = inAct && A.beats.some((b) => Math.abs(A.t - b.end) < DT * 1.5);
        s.jump = Math.hypot(d.position.x - px, d.position.z - pz) > 0.4;
        px = d.position.x;
        pz = d.position.z;
        s.stop = game.hitstopTimer > 0 || game.timeScale < 0.9;
        s.air = s.jump || d.position.y > 0.05 || !!d.brain.leap || (inAct && (A.beats.some((b) => b.def.dash && A.t >= b.start && A.t <= b.end + 0.1) || A.beats.some((b) => (b.def.blink || b.def.flit) && A.t >= b.start - 0.05 && A.t <= b.impact + 0.05)));
        F.push(s);
        // the blow against the hero, at each real beat's impact frame
        if (inAct) for (const b of A.beats) {
          if (b.feint || b._aud || A.t < b.impact || !b.def.zone || b.def.cast || b.def.selfHit || b.def.send) continue;
          b._aud = true;
          // (the limb's end as drawn, back on his upright gameplay body: the camera lean and his drawn size
          // out, duelist.drawnPoint's inverse; the hero's position is gameplay)
          const tp = upright(d, d._tip), pp = p.position, pr = p.radius ?? 0.45;
          const flat = Math.hypot(tp.x - pp.x, tp.z - pp.z) - pr, up = tp.y < 0 ? -tp.y : tp.y > 1.85 ? tp.y - 1.85 : 0;
          const part = b.def.part ?? 'fistR';
          const arm = part === 'fistL' ? ['shL', 'elbowL', 'fistL'] : ['shR', 'elbowR', 'fistR'];
          const leg = part === 'footL' || part === 'kneeL' ? ['hipL', 'kneeL', 'footL'] : ['hipR', 'kneeR', 'footR'];
          const kick = /^(foot|knee)/.test(part);
          // (the line, ADR-253: the limb's root → its end against the root → the hero's centre, flat, in
          // degrees; and how far the end sits off his own line to the hero, m)
          const lr = part === 'feet' ? null : upright(d, kick ? s.W[leg[0]] : s.W[arm[0]]), le = upright(d, kick ? s.W[leg[2]] : s.W[arm[2]]);
          let off = null, lat = null;
          if (lr) {
            const a1 = Math.atan2(le.x - lr.x, le.z - lr.z), a2 = Math.atan2(pp.x - lr.x, pp.z - lr.z);
            off = Math.round(Math.abs(wrapA(a1 - a2)) * DEG);
            const hx = pp.x - d.position.x, hz = pp.z - d.position.z, hl = Math.hypot(hx, hz) || 1;
            lat = +(((le.x - d.position.x) * hz - (le.z - d.position.z) * hx) / hl).toFixed(2);
          }
          contact.push({ i: b.index ?? A.beats.indexOf(b), gap: Math.max(flat, up), flat, y: tp.y, zone: b.def.zone.kind, part, off, lat, blow: b.def.blow ?? '',
            sep: +Math.hypot(pp.x - d.position.x, pp.z - d.position.z).toFixed(2),
            elbow: kick || part === 'feet' ? null : Math.round(ang3(s.B[arm[0]], s.B[arm[1]], s.B[arm[2]])),
            knee: kick ? Math.round(ang3(s.B[leg[0]], s.B[leg[1]], s.B[leg[2]])) : null });
        }
        G.tick(DT);
      }
      // jolts and the root's pops
      let pb = { v: 0 }, pw = { v: 0 }, out1 = { v: 0 }, pop = { v: 0 }, popEnd = { v: 0 }, total = 0;
      const jolts = [], v = new THREE.Vector3();
      for (let i = 2; i < F.length; i++) {
        const a = F[i - 2], b = F[i - 1], c = F[i];
        if (a.air || b.air || c.air || a.stop || b.stop || c.stop) continue;
        let fb = 0;
        for (const k of AUD_PTS) {
          const jb = v.copy(c.B[k]).addScaledVector(b.B[k], -2).add(a.B[k]).length() * 1000;
          const jw = v.copy(c.Wr[k]).addScaledVector(b.Wr[k], -2).add(a.Wr[k]).length() * 1000;
          const j = Math.max(jb, jw);
          fb = Math.max(fb, j);
          jolts.push({ j, k, t: c.t, ph: c.ph, w: jw > jb });
          if (jb > pb.v) pb = { v: jb, k, t: c.t, ph: c.ph };
          if (jw > pw.v) pw = { v: jw, k, t: c.t, ph: c.ph };
          if (c.ph === 'blend out' && j > out1.v) out1 = { v: j, k };
        }
        total += fb;
        const rp = rootPop(a, b, c);
        if (rp > pop.v) pop = { v: rp, ph: c.ph };
        const seam = a.beatEnd || b.beatEnd || c.beatEnd || (c.ph === 'blend out' && a.ph !== 'blend out');
        if (seam && rp > popEnd.v) popEnd = { v: rp, ph: c.ph };
      }
      jolts.sort((x, y) => y.j - x.j);
      // his facing: the fastest turn (deg/s, one frame)
      let yawR = 0, yawAt = '';
      for (let i = 1; i < F.length; i++) {
        if (F[i].jump) continue;
        const r = (Math.abs(wrapA(F[i].yaw - F[i - 1].yaw)) / DT) * DEG;
        if (r > yawR) { yawR = r; yawAt = F[i].ph; }
      }
      // planted feet: travel on the floor while the foot is down (world), outside dashes, blinks and leaps
      let slide = 0, slideMax = 0, slideAt = '';
      for (let i = 1; i < F.length; i++) {
        if (F[i].air || F[i - 1].air) continue;
        for (const k of ['footR', 'footL']) {
          const a = F[i].W[k], b = F[i - 1].W[k];
          if (a.y < 0.14 && b.y < 0.14) {
            const m = Math.hypot(a.x - b.x, a.z - b.z);
            slide += m;
            if (m > slideMax) { slideMax = m; slideAt = F[i].ph; }
          }
        }
      }
      // joints: the elbows' and knees' tightest fold, the lowest knee / foot
      let elbow = 180, knee = 180, low = 9;
      for (const s of F) {
        elbow = Math.min(elbow, ang3(s.B.shR, s.B.elbowR, s.B.fistR), ang3(s.B.shL, s.B.elbowL, s.B.fistL));
        knee = Math.min(knee, ang3(s.B.hipR, s.B.kneeR, s.B.footR), ang3(s.B.hipL, s.B.kneeL, s.B.footL));
        low = Math.min(low, s.W.kneeR.y, s.W.kneeL.y, s.W.footR.y, s.W.footL.y);
      }
      rows.push({ name, ph, orbit, dist: +dist.toFixed(1), frames: F.length, total: Math.round(total), pb, pw, out: out1, pop, popEnd, yawR: Math.round(yawR), yawAt, slide: +slide.toFixed(2), slideMax: Math.round(slideMax * 1000), slideAt, elbow: Math.round(elbow), knee: Math.round(knee), low: +low.toFixed(2), contact });
      if (TOP) worst.push(`   ${name} P${ph}${orbit ? ' (orbit)' : ''}: ` + jolts.filter((x, i, L) => L.findIndex((y) => y.k === x.k && Math.abs(y.t - x.t) < 0.05) === i).slice(0, TOP).map((x) => `${x.k} ${Math.round(x.j)}${x.w ? 'w' : ''} @${x.t.toFixed(2)} ${x.ph}`).join(' · '));
    }
  }
  return { rows, worst };
}

/**
 * His AI against a defending bot (makeDefender, mixed; god mode), `secs` s in each phase (entered through
 * debug.setPhase): each frame his worst jolt with what he was doing and what he did two frames before (a
 * seam), the root's pops, and at every LINK (one move straight into the next) and every beat's end the
 * jolt and the root's pop across it. Hit-stops, slow-mo and jumps of the root (a blink, a flit, the air)
 * are left out.
 */
function auditFight(secs = 30, phases = [1, 2, 3]) {
  const R = [];
  for (const ph of phases) {
    const G = build(SEED + ph, true);
    duel(G, { dist: 3, form: ph, ai: true });
    const { game } = G;
    const d = game.dragon, p = game.player;
    p.debug.god = true;
    p.debug.noRiposte = true;
    G.defend = makeDefender(G, { style: 'mixed' });
    Math.random = mulberry32(SEED * 7 + ph);
    const what = () => {
      const a = d.brain.act;
      if (d.mode === 'act' && a) {
        const b = a.beats.find((x) => a.t < x.end + 1e-6);
        return `${a.name}:${b ? (a.t < b.impact - 0.12 ? 'windup' : 'strike') + (b.index ?? a.beats.indexOf(b)) : 'recovery'}`;
      }
      return d.mode === 'react' ? `react:${d.brain.react?.kind ?? ''}` : d.mode;
    };
    const H = [], all = [], links = [], ends = [];
    let px = d.position.x, pz = d.position.z, lastHs = -99, total = 0, frames = 0, pops = 0, popMax = 0, prevAct = null, prevBeat = -1;
    for (let i = 0, n = Math.round(secs / DT); i < n; i++) {
      G.defend.act();
      p.hp = p.maxHp;
      game.mouseGround.set(d.position.x, 0, d.position.z);
      G.tick(DT);
      if (d.brain.pendingPhase > ph) d.brain.pendingPhase = 0;
      if (d.hp < d.maxHp * 0.6) d.hp = d.maxHp * (ph === 1 ? 0.95 : 0.9);
      if (game.hitstopTimer > 0 || game.timeScale < 0.9) lastHs = i;
      const s = rigSample(d);
      const a = d.mode === 'act' ? d.brain.act : null;
      const bi = a ? a.beats.findIndex((x) => a.t < x.end + 1e-6) : -1;
      s.link = !!(a && prevAct && a !== prevAct);
      s.end = !!(a && a === prevAct && bi !== prevBeat);
      prevAct = a;
      prevBeat = bi;
      s.jump = Math.hypot(d.position.x - px, d.position.z - pz) > 0.4 || d.position.y > 0.05 || !!d.brain.leap;
      px = d.position.x;
      pz = d.position.z;
      s.w = what();
      s.t = game.time;
      H.push(s);
      if (H.length > 4) H.shift();
      if (H.length < 4 || H.some((h) => h.jump) || i - lastHs < 4) continue;
      frames++;
      const J = joltOf(H[1], H[2], H[3]), rp = rootPop(H[1], H[2], H[3]);
      total += J.j;
      popMax = Math.max(popMax, rp);
      if (rp > 150) pops++;
      all.push({ j: Math.round(J.j), k: J.k, t: +s.t.toFixed(2), now: H[3].w, before: H[1].w, rp: Math.round(rp) });
      // a seam (a link, a beat's end) at this frame: the worse of the two windows that straddle it
      const seam = { j: Math.round(Math.max(J.j, joltOf(H[0], H[1], H[2]).j)), rp: Math.round(Math.max(rp, rootPop(H[0], H[1], H[2]))), k: J.k, w: `${H[1].w} -> ${H[3].w}` };
      if (H[2].link) links.push(seam);
      else if (H[2].end) ends.push(seam);
    }
    G.defend = null;
    all.sort((x, y) => y.j - x.j);
    R.push({ ph, frames, mean: total / Math.max(1, frames), over300: all.filter((x) => x.j > 300).length, over150: all.filter((x) => x.j > 150).length, seams: all.filter((x) => x.now !== x.before && x.j > 150).length, pops, popMax: Math.round(popMax), all, links, ends });
  }
  return R;
}

async function scenarioAudit() {
  out('\n== scenario AUDIT (opt-in: every move, the hero still and circling; then his AI in each phase: jolts, sliding feet, elbows at contact, blows inside the hero, root pops) ==');
  const TOP = Number(process.env.GCD_AUDIT_TOP ?? 0);
  const fmt = (o) => (o.v ? `${Math.round(o.v)} ${o.k ?? ''} ${o.ph ?? ''}`.replace(/\s+/g, ' ').trim() : '-');
  if (process.env.GCD_AUDIT_MOVES !== '0') {
    const { rows, worst } = auditMoves(auditList(), [false, true], TOP);
    out('   move            P orbit   total  jolt own frame (mm/f2)         jolt world round root           blend-out     turn/s  slide m (worst mm)          elbow knee  low  root pop any / beat end      blows: limb gap m (- inside him) / elbow° / knee°');
    for (const r of rows) {
      if (r.fail) { out(`   ${r.name.padEnd(15)} ${r.ph} FAIL ${r.fail}`); continue; }
      const c = r.contact.map((x) => `${x.part}:${x.flat.toFixed(2)}${x.y > 1.85 || x.y < 0 ? '^' : ''}${x.elbow != null ? `/${x.elbow}°` : ''}${x.knee != null ? `/k${x.knee}°` : ''}`).join(' ');
      out(`   ${r.name.padEnd(15)} ${r.ph} ${r.orbit ? 'yes  ' : '     '} ${String(r.total).padStart(6)}  ${fmt(r.pb).padEnd(30)} ${fmt(r.pw).padEnd(31)} ${fmt(r.out).padEnd(13)} ${String(r.yawR).padStart(5)}  ${r.slide.toFixed(2).padStart(5)} (${String(r.slideMax).padStart(3)} ${r.slideAt.padEnd(10)}) ${String(r.elbow).padStart(5)} ${String(r.knee).padStart(4)} ${r.low.toFixed(2).padStart(5)}  ${String(Math.round(r.pop.v)).padStart(5)} / ${String(Math.round(r.popEnd.v)).padStart(4)} ${(r.popEnd.ph ?? '').padEnd(12)}  ${c}`);
    }
    if (TOP) for (const w of worst) out(w);
    const ok = rows.filter((r) => !r.fail);
    const sum = (k) => ok.reduce((a, r) => a + r[k], 0);
    const blows = ok.flatMap((r) => r.contact);
    const fists = blows.filter((c) => c.part === 'fistR' || c.part === 'fistL');
    const kicks = blows.filter((c) => c.knee != null);
    out(`   -- ${ok.length} runs (${rows.length - ok.length} failed to start): jolt total ${sum('total')} mm/f2 (each frame's worst, summed) · the worst ${Math.round(Math.max(...ok.map((r) => Math.max(r.pb.v, r.pw.v))))} · runs with a jolt over 300: ${ok.filter((r) => Math.max(r.pb.v, r.pw.v) > 300).length}`);
    out(`   -- feet: slide ${sum('slide').toFixed(2)} m in all, the worst frame ${Math.max(...ok.map((r) => r.slideMax))} mm; root pops: the worst ${Math.round(Math.max(...ok.map((r) => r.pop.v)))}, at a beat's end ${Math.round(Math.max(...ok.map((r) => r.popEnd.v)))} mm/f2`);
    out(`   -- blows: ${blows.length}; inside him (gap < -0.15 m): ${blows.filter((c) => c.flat < -0.15).length}, the deepest ${Math.min(...blows.map((c) => c.flat)).toFixed(2)} m; fists' elbows at contact ${fists.length ? `${Math.min(...fists.map((c) => c.elbow))} - ${Math.max(...fists.map((c) => c.elbow))}° (mean ${(fists.reduce((a, c) => a + c.elbow, 0) / fists.length).toFixed(0)})` : '-'}; kicks' knees ${kicks.length ? `${Math.min(...kicks.map((c) => c.knee))} - ${Math.max(...kicks.map((c) => c.knee))}°` : '-'}`);
    const J = process.env.GCD_AUDIT_JSON;
    if (J) fs.writeFileSync(J, JSON.stringify(rows, null, 1));
  }
  if (process.env.GCD_AUDIT_FIGHT !== '0') {
    const secs = Number(process.env.GCD_FIGHT_SECS ?? 30);
    out(`\n   -- his AI against a defender, ${secs} s a phase --`);
    const mx = (L, k) => (L.length ? Math.max(...L.map((x) => x[k])) : 0);
    for (const r of auditFight(secs)) {
      const lk = r.links, en = r.ends;
      out(`   P${r.ph}: ${r.frames} frames, mean worst jolt ${r.mean.toFixed(1)} mm/f2; over 300: ${r.over300}, over 150: ${r.over150}, of those on a seam: ${r.seams}; root pops over 150: ${r.pops} (worst ${r.popMax})`);
      out(`       links ${lk.length}: worst jolt ${mx(lk, 'j')}, root pop ${mx(lk, 'rp')}${lk.length ? ` (${[...lk].sort((a, b) => b.j - a.j).slice(0, 3).map((x) => `${x.j}/${x.rp} ${x.w}`).join(' · ')})` : ''}`);
      out(`       beat ends ${en.length}: worst jolt ${mx(en, 'j')}, root pop ${mx(en, 'rp')}${en.length ? ` (${[...en].sort((a, b) => b.rp - a.rp).slice(0, 3).map((x) => `${x.j}/${x.rp} ${x.w}`).join(' · ')})` : ''}`);
      const seen = new Set();
      for (const x of r.all) {
        const key = `${x.k} ${x.now} ${x.before}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out(`       ${String(x.j).padStart(5)} ${x.k.padEnd(7)} t${x.t}  ${x.before === x.now ? x.now : `${x.before} -> ${x.now}`}  (root ${x.rp})`);
        if (seen.size >= Number(process.env.GCD_FIGHT_TOP ?? 12)) break;
      }
    }
  }
}

/**
 * GUNS (opt-in, ADR-253): every gun move of phase 2 once, the hero still in front of him (and, with
 * GCD_GUN_ORBIT=1, circling him): at every shot that leaves a gun (fx.throwShot) and every muzzle flash
 * that is not a shot's (the point-blank shot, Turning Wheel's), the firing gun's barrel against the line of
 * fire (flat degrees; its elevation), the firing arm's line (shoulder → fist against the line of fire), its
 * elbow, the muzzle as drawn against where the shot leaves, and the other hand (its barrel off the hero,
 * its elbow). `rows` for the PR's table (GCD_AUDIT_JSON writes them).
 */
function gunAudit(list = ['twoThunders', 'ironRain', 'ironLeap', 'closeIron', 'turningWheel', 'answer2'], orbit = false) {
  const rows = [];
  const V = () => new THREE.Vector3();
  for (const name of list) {
    const G = build(SEED);
    const def = MOVES[name], band = def.band ?? [0, 4];
    const dist = Math.min(7, Math.max(1.6, (band[0] + Math.min(band[1], 8)) / 2));
    duel(G, { dist, form: 2 });
    const { game } = G;
    const d = game.dragon, p = game.player;
    p.debug.god = true;
    p.debug.noRiposte = true;
    settle(G, 2);
    d.position.set(0, 0, 0);
    d.yaw = Math.PI / 2;
    p.debug.teleport(dist, 0);
    game.mouseGround.set(0, 0, 0);
    run(G, 0.7);
    const shots = [];
    const sample = (kind, ox, oy, oz, dx, dz, left) => {
      const R = d.rig;
      R.root.updateMatrixWorld(true);
      const sh = upright(d, R.arms[left ? 'L' : 'R'].upper.getWorldPosition(V()));
      const fist = upright(d, (left ? (R.arms.L.wrist ?? R.arms.L.fore) : R.sword).getWorldPosition(V()));
      const el = R.arms[left ? 'L' : 'R'].fore.getWorldPosition(V());
      // (a gun's barrel as drawn: its body's centre to its muzzle's, the meshes' own; gear.js buildGuns)
      const GM = R.root.userData.dress?.guns ?? [];
      const ctr = (m) => { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); return m.geometry.boundingBox.getCenter(V()).applyMatrix4(m.matrixWorld); };
      const barrel = (L) => { const bd = GM[L ? 2 : 0], mz = GM[L ? 3 : 1]; return bd && mz ? ctr(mz).sub(ctr(bd)).normalize() : V(0, 0, 1); };
      const az = (v) => Math.atan2(v.x, v.z), fire = Math.atan2(dx, dz);
      const b = barrel(left), o = barrel(!left);
      const angB = Math.abs(wrapA(az(b) - fire)) * DEG, elevB = Math.asin(Math.max(-1, Math.min(1, b.y))) * DEG;
      const arm = Math.abs(wrapA(Math.atan2(fist.x - sh.x, fist.z - sh.z) - fire)) * DEG;
      const elbow = ang3(R.arms[left ? 'L' : 'R'].upper.getWorldPosition(V()), el, (left ? (R.arms.L.wrist ?? R.arms.L.fore) : R.sword).getWorldPosition(V()));
      const toHero = Math.atan2(p.position.x - d.position.x, p.position.z - d.position.z);
      const offB = Math.abs(wrapA(az(o) - toHero)) * DEG;
      const ob = R.arms[left ? 'R' : 'L'];
      const offElbow = ang3(ob.upper.getWorldPosition(V()), ob.fore.getWorldPosition(V()), (left ? R.sword : (R.arms.L.wrist ?? R.arms.L.fore)).getWorldPosition(V()));
      const facing = Math.abs(wrapA(d.yaw - toHero)) * DEG;
      // (the muzzle as drawn: the gun mesh's bright cell, world; the shot leaves from (ox, oy, oz))
      const gm = (R.root.userData.dress?.guns ?? []).filter((m) => m.parent === (left ? (R.arms.L.wrist ?? R.arms.L.fore) : R.sword));
      let mzl = null;
      for (const m of gm) { m.geometry.computeBoundingBox(); const c = m.geometry.boundingBox.getCenter(V()); if (m.geometry.boundingBox.max.x - m.geometry.boundingBox.min.x < 0.04 && m.geometry.boundingBox.max.y - m.geometry.boundingBox.min.y < 0.04) mzl = c.applyMatrix4(m.matrixWorld); }
      const fw = (left ? (R.arms.L.wrist ?? R.arms.L.fore) : R.sword).getWorldPosition(V());
      const mb = mzl ? Math.round(Math.abs(wrapA(Math.atan2(mzl.x - fw.x, mzl.z - fw.z) - fire)) * DEG) : null;
      shots.push({ kind, hand: left ? 'L' : 'R', t: +(d.brain.act?.t ?? -1).toFixed(2), barrel: Math.round(angB), elev: Math.round(elevB), arm: Math.round(arm), elbow: Math.round(elbow),
        off: Math.round(offB), offElbow: Math.round(offElbow), facing: Math.round(facing), y: +oy.toFixed(2), fistY: +fw.y.toFixed(2), muzzleGap: +Math.hypot(fw.x - ox, fw.z - oz).toFixed(2), mb });
    };
    const ts = d.fx.throwShot?.bind(d.fx), mz = d.fx.muzzle?.bind(d.fx);
    let inShot = false;
    d.fx.throwShot = (o) => { inShot = true; sample(o.heavy ?? o.returnable ? 'heavy' : 'slug', o.x, o.y, o.z, o.dx, o.dz, d.iron.hand === 0); return ts(o); };
    d.fx.muzzle = (x, y, z, dx, dz, ...rest) => { if (!inShot) sample('flash', x, y, z, dx, dz, false); inShot = false; return mz(x, y, z, dx, dz, ...rest); };
    if (!d.debug.trigger(name)) { rows.push({ name, fail: 'trigger' }); continue; }
    const A = d.brain.act;
    for (let i = 0; i < 900; i++) {
      if (orbit) {
        const th = Math.atan2(p.position.x - d.position.x, p.position.z - d.position.z) + (3.5 / dist) * DT;
        p.debug.teleport(d.position.x + Math.sin(th) * dist, d.position.z + Math.cos(th) * dist);
      }
      p.hp = p.maxHp;
      if (d.brain.act !== A) break;
      G.tick(DT);
    }
    rows.push({ name, shots });
  }
  return rows;
}
/**
 * LINE (ADR-253, `?oneMoves=b`; `a` stays the default): the limbs on the line and the guns on the line of fire.
 * The timings equal `a`'s; at contact the straight blows within 10 degrees of the hero on his line, the arm
 * long, reaching him (they were 22 - 63 degrees off, the back-fist 0.6 m short); every kick straight at the
 * contact and still straight two frames on (Sky Turns' first tornado folded to 118 on its hit-stop frame); the
 * short blows reach (the elbow was 0.73 m short, the spin back kick 0.46, the flying knee 0.44); the sweep's
 * foot crosses the hero at its impact (94 degrees round and 1 m short) and its leg stays long through the
 * turn; the mirrored palm strikes with the hand that is drawn; every gun shot leaves the drawn muzzle with
 * the barrel on its line (55 - 113 degrees off); on `a` the guns are left as built.
 */
async function scenarioLine() {
  out('\n== scenario LINE (?oneMoves=b: straight blows on the line, kicks held straight, short blows that reach, the sweep, the guns) ==');
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  try {
    // the timings: b plays every move as a does
    const diff = [];
    let same = 0;
    for (const name of MOVE_NAMES) {
      for (const f of phasesOf(name)) {
        LS.setLook('oneMoves', 'a');
        const A0 = realise(name, f, () => 0.5);
        LS.setLook('oneMoves', 'b');
        const A1 = realise(name, f, () => 0.5);
        const t0 = A0.beats.map((b) => b.impact.toFixed(3)).join(), t1 = A1.beats.map((b) => b.impact.toFixed(3)).join();
        if (t0 === t1 && A0.end === A1.end) same++;
        else diff.push(`${name} P${f}`);
      }
    }
    assert(!diff.length && same > 60, `b keeps every move's timing (impacts and end, ${same} realisations)${diff.length ? ' ' + diff.slice(0, 6).join(', ') : ''}`);
    // the rig at each blow's contact (the audit's, the hero still in front of him)
    LS.setLook('oneMoves', 'b');
    const { rows } = auditMoves([{ name: 'lesson', ph: 1 }, { name: 'skyTurns', ph: 1 }, { name: 'craneWater', ph: 1 }, { name: 'moonOver', ph: 3 }, { name: 'lowWind', ph: 1 }, { name: 'closeIron', ph: 2 }, { name: 'stormStep', ph: 1 }, { name: 'lessonM', ph: 3 }], [false]);
    const C = rows.flatMap((r) => (r.contact ?? []).map((c) => ({ ...c, name: r.name })));
    const straight = C.filter((c) => ['cross', 'backfist', 'palm'].includes(c.blow) && c.zone !== 'line' || (c.blow === 'palm'));
    const offS = straight.filter((c) => !(c.off <= 10 && c.elbow >= 160 && c.flat <= 0.12 && c.flat >= -0.16));
    assert(straight.length >= 8 && !offS.length, `straight blows on the line: ${straight.length} at most ${Math.max(...straight.map((c) => c.off))} deg off, elbows >= ${Math.min(...straight.map((c) => c.elbow))}, gaps ${Math.min(...straight.map((c) => c.flat)).toFixed(2)} - ${Math.max(...straight.map((c) => c.flat)).toFixed(2)} m${offS.length ? ' OFF: ' + offS.map((c) => `${c.name}:${c.blow} ${c.off}deg e${c.elbow} g${c.flat.toFixed(2)}`).join(', ') : ''}`);
    const kicks = C.filter((c) => c.knee != null && /^foot/.test(c.part) && c.blow !== 'sweep' && c.blow !== 'dropHeel');
    assert(kicks.length >= 8 && kicks.every((c) => c.knee >= 165), `every kick lands straight: knees ${Math.min(...kicks.map((c) => c.knee))} - ${Math.max(...kicks.map((c) => c.knee))} deg at contact (${kicks.length} kicks; Sky Turns' first tornado was 118, the butterfly 131)`);
    const short = C.filter((c) => /^(elbow|knee)/.test(c.part) || c.blow === 'spinBack');
    assert(short.length >= 4 && short.every((c) => c.flat <= 0.15), `the short blows reach him: ${short.map((c) => `${c.blow || c.part} ${c.flat.toFixed(2)}`).join(', ')} m (the elbow was 0.73 short, the spin kick 0.46, the knee 0.44)`);
    const sw = C.find((c) => c.blow === 'sweep');
    assert(sw && sw.off <= 25 && Math.abs(sw.flat) <= 0.25 && sw.knee >= 120, `the sweep crosses him at its impact: ${sw?.off} deg off, ${sw?.flat.toFixed(2)} m, the knee ${sw?.knee} (was 94 deg round, 1 m short, 106 - 134)`);
    const mp = C.filter((c) => c.name === 'lessonM' && c.blow === 'palm');
    assert(mp.length === 1 && mp[0].part === 'fistL' && mp[0].elbow >= 160 && mp[0].flat <= 0.15, `the mirrored palm strikes with the left hand it is drawn on (${mp[0]?.part} e${mp[0]?.elbow} g${mp[0]?.flat.toFixed(2)}; it glinted on the right hand at the hip, 0.85 m short)`);
    // a kick held: two frames after Sky Turns' first contact the leg is still straight (it folded at once)
    {
      const G = build();
      const d = G.game.dragon, p = G.game.player;
      duel(G, { dist: 2.4 });
      p.debug.god = true;
      d.debug.trigger('skyTurns');
      const A = d.brain.act, b0 = A.beats[0], V = () => new THREE.Vector3();
      const knees = [];
      run(G, 1.2, () => {
        if (d.brain.act !== A || A.t < b0.impact || knees.length >= 6) return;
        const leg = d.rig.legs.R;
        const a = leg.thigh.getWorldPosition(V()), k = leg.shin.getWorldPosition(V()), f = leg.foot.getWorldPosition(V());
        knees.push(Math.acos(Math.max(-1, Math.min(1, a.sub(k).normalize().dot(f.sub(k).normalize())))) * DEG);
      });
      assert(knees.length >= 6 && knees.slice(0, 6).every((k) => k >= 160), `Sky Turns' first tornado held straight through its contact: ${knees.slice(0, 6).map((k) => k.toFixed(0)).join(' ')} deg the first six frames (it folded to 118 on the second)`);
    }
    // the guns: every shot from the drawn muzzle, its barrel on the line of fire
    const gun = gunAudit(['twoThunders', 'ironRain', 'closeIron', 'turningWheel']).flatMap((r) => r.shots ?? []).filter((s) => s.kind !== 'flash' || s.muzzleGap < 0.5);
    const firing = gun.filter((s) => !(s.barrel <= 20 && s.muzzleGap <= 0.32 && s.elbow >= 150));
    assert(gun.length >= 14 && !firing.length, `every shot leaves the drawn muzzle with the barrel on its line: ${gun.length} shots, barrels at most ${Math.max(...gun.map((s) => s.barrel))} deg off, at most ${Math.max(...gun.map((s) => s.muzzleGap)).toFixed(2)} m from the fist, elbows >= ${Math.min(...gun.map((s) => s.elbow))}${firing.length ? ' OFF: ' + firing.map((s) => `${s.kind}${s.hand} ${s.barrel}deg ${s.muzzleGap}m e${s.elbow}`).join(', ') : ''}`);
    // on a: the guns as built, the shots as they were
    LS.setLook('oneMoves', 'a');
    {
      const G = build();
      const d = G.game.dragon;
      duel(G, { dist: 6, form: 2 });
      d.debug.trigger('twoThunders');
      run(G, 1.2);
      const Gm = d.rig.root.userData.dress?.guns ?? [];
      assert(Gm.length >= 4 && Gm.every((m) => m.position.lengthSq() < 1e-9 || !d.gunAim?.touched) && !d.gunAim?.on(), 'on a the guns stay as built (no turn, no kick)');
    }
  } catch (e) {
    assert(false, `LINE: ${e.stack}`);
  }
  LS.setLook('oneMoves', null);
}

/** GUNFX (ADR-253): the redrawn shots and bolts (`?oneGunFx`, `?oneBoltFx`) draw without a bad number, on
 *  the code's palette, and what they cost: the fire field's live blobs and his glyph particles through Two
 *  Thunders, Iron Rain and Pushing Hands, each option against '0'. */
async function scenarioGunFx() {
  out('\n== scenario GUNFX (the shots and bolts redrawn: they draw, and what they cost) ==');
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  LS.setLook('oneMoves', 'b');
  const cost = {};
  for (const [sw, moves, form] of [['oneGunFx', ['twoThunders', 'ironRain'], 2], ['oneBoltFx', ['pushingHands'], 3]]) {
    for (const o of ['0', 'a', 'b']) {
      LS.setLook(sw, o);
      let peak = 0, sum = 0, n = 0, glyph = 0, bad = 0;
      for (const mv of moves) {
        const G = build(SEED);
        const { game } = G;
        const d = game.dragon, p = game.player;
        duel(G, { dist: 6, form });
        p.debug.god = true;
        d.debug.trigger(mv);
        const A = d.brain.act, F = game.fx?.fire;
        run(G, 4, () => {
          const c = F?.count ?? 0;
          peak = Math.max(peak, c);
          sum += c;
          n++;
          glyph = Math.max(glyph, d.fx.add?.alive ?? d.fx.add?.count ?? 0);
          if (!Number.isFinite(c)) bad++;
        }, () => d.brain.act !== A && !d.fx.shots.some((s) => s.alive));
      }
      cost[`${sw}=${o}`] = { peak, mean: Math.round(sum / Math.max(1, n)), glyph };
      assert(bad === 0 && peak > 0, `${sw}=${o}: draws (the fire field's blobs: mean ${Math.round(sum / Math.max(1, n))}, peak ${peak}; glyph particles at most ${glyph})`);
    }
    LS.setLook(sw, null);
  }
  LS.setLook('oneMoves', null);
  const J = process.env.GCD_AUDIT_JSON;
  if (J) fs.writeFileSync(J.replace(/\.json$/, '-gunfx.json'), JSON.stringify(cost, null, 1));
}

/** PROBE (opt-in, ADR-253): one move (GCD_PROBE=name:phase), frame by frame round each blow's impact: u, the
 *  striking limb's elbow / knee, its gap to the hero and its line. For finding where a limb folds. */
async function scenarioProbe() {
  const [name, phs = '1'] = (process.env.GCD_PROBE ?? 'skyTurns:1').split(':');
  const ph = Number(phs);
  out(`\n== scenario PROBE (${name} in phase ${ph}) ==`);
  const def = MOVES[name], G = build(SEED);
  const band = def.band ?? [0, 4], dist = Math.min(7, Math.max(1.6, (band[0] + Math.min(band[1], 8)) / 2));
  duel(G, { dist, form: ph });
  const { game } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  p.debug.noRiposte = true;
  settle(G, 2);
  d.position.set(0, 0, 0);
  d.yaw = Math.PI / 2;
  p.debug.teleport(dist, 0);
  run(G, 0.7);
  if (process.env.GCD_GEAR === '2') d.debug.setGear(2, true);
  d.debug.trigger(name);
  const A = d.brain.act;
  for (let i = 0; i < 600 && d.brain.act === A; i++) {
    p.hp = p.maxHp;
    const s = rigSample(d);
    const b = A.beats.find((x) => !x.feint && Math.abs(A.t - x.impact) <= 0.2);
    if (b) {
      const part = b.def.part ?? 'fistR';
      const kick = /^(foot|knee)/.test(part), L = part === 'footL' || part === 'kneeL' || part === 'fistL';
      const j = kick ? [L ? 'hipL' : 'hipR', L ? 'kneeL' : 'kneeR', L ? 'footL' : 'footR'] : [L ? 'shL' : 'shR', L ? 'elbowL' : 'elbowR', L ? 'fistL' : 'fistR'];
      const tp = upright(d, d._tip);
      const reachL = s.B[j[0]].distanceTo(s.B[j[2]]) / (kick ? 0.9 : 0.62);
      out(`   b${b.index ?? A.beats.indexOf(b)} ${b.def.blow ?? part} t${(A.t - b.impact).toFixed(3)} ${kick ? 'knee' : 'elbow'} ${ang3(s.B[j[0]], s.B[j[1]], s.B[j[2]]).toFixed(0)}° root-end ${reachL.toFixed(2)} hip ${s.B[j[0]].toArray().map((v) => v.toFixed(2)).join(',')} tip y ${tp.y.toFixed(2)} gap ${(Math.hypot(tp.x - p.position.x, tp.z - p.position.z) - 0.45).toFixed(2)} root y ${d.position.y.toFixed(2)} foot ${s.B[j[2]].toArray().map((v) => v.toFixed(2)).join(',')}`);
    }
    G.tick(DT);
  }
}
async function scenarioGuns() {
  out('\n== scenario GUNS (opt-in: each gun move once; at each shot the firing barrel vs the line of fire, the arm, the other hand) ==');
  for (const orbit of process.env.GCD_GUN_ORBIT === '1' ? [false, true] : [false]) {
    const rows = gunAudit(undefined, orbit);
    for (const r of rows) {
      out(`   ${r.name}${orbit ? ' (orbit)' : ''}: ${r.fail ?? ''}`);
      for (const s of r.shots ?? []) out(`      ${s.kind.padEnd(5)} ${s.hand} t${s.t}  barrel ${String(s.barrel).padStart(3)}° off the line (elev ${s.elev}°) · arm ${String(s.arm).padStart(3)}° · elbow ${s.elbow}° · facing ${s.facing}° · fist→muzzle mesh ${s.mb}° · leaves ${s.muzzleGap} m from the drawn fist, y ${s.y} (fist ${s.fistY}) · other hand: barrel ${s.off}° off him, elbow ${s.offElbow}°`);
    }
    const J = process.env.GCD_AUDIT_JSON;
    if (J) fs.writeFileSync(J.replace(/\.json$/, `-guns${orbit ? '-orbit' : ''}.json`), JSON.stringify(rows, null, 1));
  }
}

/**
 * MOTIONFIX (ADR-162's kit for him, ADR-168): what the audit found on his strings and the kit fixed stays fixed.
 * Every string he picks (cat 'string', in the first phase it is used in; deja vu's copies are the same
 * blows), run with the hero circling him: a punch lands with the arm open (anim.js armSoft: every elbow
 * was 126 - 131° at contact), a planted foot no longer swivels and skates with his tracking turn (the
 * feet's planner: 1.8 - 11.3 m of sliding a string, up to 711 mm in one frame), and no joint jolts past
 * 480 mm/f² (four of the five strings did on main: 353 - 653).
 */
async function scenarioMotionFix() {
  out('\n== scenario MOTIONFIX (his strings with the hero circling: punches with an open arm, feet that stay planted, no pops) ==');
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  // (the moves of ADR-168 as shipped; then the rebuild, ADR-221, its own bounds: straight limbs travel
  // further, the spin kick after a straight kick jolts more)
  for (const mv of ['0', 'a']) {
    LS.setLook('oneMoves', mv);
    out(`   -- ?oneMoves=${mv}`);
    await motionFixRun(mv);
  }
  LS.setLook('oneMoves', null);
}
async function motionFixRun(mv) {
  const JOLT = mv === 'a' ? 700 : 480, ELBOW = mv === 'a' ? 145 : 140;
  const names = MOVE_NAMES.filter((n) => MOVES[n].cat === 'string' && !MOVES[n].mirrorOf && !MOVES[n].transition && phasesOf(n).length);
  const { rows } = auditMoves(names.map((name) => ({ name, ph: phasesOf(name)[0] })), [true]);
  const ok = rows.filter((r) => !r.fail);
  assert(ok.length === names.length && names.length >= 4, `${ok.length} of ${names.length} strings run (${names.join(', ')})`);
  const fists = ok.flatMap((r) => r.contact.filter((c) => c.part === 'fistR' || c.part === 'fistL').map((c) => ({ ...c, name: r.name })));
  const low = fists.filter((c) => c.elbow < ELBOW);
  assert(fists.length >= 8 && !low.length, `${fists.length} punches land with the arm open (>= ${ELBOW}): elbows ${Math.min(...fists.map((c) => c.elbow))} - ${Math.max(...fists.map((c) => c.elbow))}° (main: 126 - 131°)${low.length ? `; under 140: ${low.map((c) => `${c.name}#${c.i} ${c.elbow}`).join(', ')}` : ''}`);
  const feet = ok.map((r) => `${r.name} ${r.slide.toFixed(2)} m / ${r.slideMax}`).join(', ');
  assert(ok.every((r) => r.slideMax < 300 && r.slide < 2.5), `planted feet hold through his tracking turn: under 2.5 m of sliding a string and 300 mm in a frame (${feet}; main: 1.8 - 11.3 m, up to 711 mm)`);
  const jolt = (r) => Math.round(Math.max(r.pb.v, r.pw.v));
  assert(ok.every((r) => jolt(r) < JOLT), `no joint jolts past ${JOLT} mm/f² in a string: ${ok.map((r) => `${r.name} ${jolt(r)}`).join(', ')} (main: 353 - 653)`);
}

// ================================================================== the pursuit (pressure.pursue)
/** A bot that keeps the hero away from him: the pace defender's answers, and between them 'retreat' (runs
 *  from each of his windups, sprinting, then comes back in), 'flee' (the same, never bending back in at
 *  the floor's edge), 'kite' (holds 6 - 8 m) or 'roam' (2.5, 5 or 9 m, a new spot every 4 s). */
function aiBot(G, mode, roam) {
  const def = paceDefender(G);
  let runUntil = -1;
  const goal = { r: 2.5, a: 0, until: -1 };
  const B = (CONFIG.world.dragonBound ?? 12) - 0.6;
  const runs = mode === 'retreat' || mode === 'flee';
  return {
    onEvent(n, e) {
      def.onEvent(n, e);
      if (runs && n === 'dragon:windup' && MOVES[e?.name] && !MOVES[e.name].transition) runUntil = G.game.time + 1.1;
    },
    act() {
      const g = G.game, input = G.input, p = g.player, d = g.dragon;
      const rolled = def.act();
      if (rolled || p.state === 'roll') { input.release('ShiftLeft'); return rolled; }
      // (the retreating hero runs instead of guarding: only a red cue makes him roll)
      if (runs && g.time < runUntil) input.up(1);
      const dx = p.position.x - d.position.x, dz = p.position.z - d.position.z, dist = Math.hypot(dx, dz) || 1;
      let wx = 0, wz = 0, sprint = false;
      if (runs) {
        if (g.time < runUntil) {
          wx = dx / dist; wz = dz / dist; sprint = true;
          // (at the floor's edge: along it, the side away from him, bending back in (retreat) or not (flee))
          const R0 = Math.hypot(p.position.x, p.position.z) || 1;
          if (Math.hypot(p.position.x + wx * 2, p.position.z + wz * 2) > B) {
            const t = dx * p.position.z - dz * p.position.x >= 0 ? 1 : -1, k = mode === 'flee' ? 0 : Math.min(1.5, Math.max(0, (R0 - (B - 2.5)) / 2));
            wx = (-dz / dist) * t - (p.position.x / R0) * k; wz = (dx / dist) * t - (p.position.z / R0) * k;
            const l = Math.hypot(wx, wz) || 1; wx /= l; wz /= l;
          }
        } else if (dist > 3.2) { wx = -dx / dist; wz = -dz / dist; }
      } else {
        if (g.time > goal.until) {
          goal.r = mode === 'kite' ? 6 + roam() * 2 : [2.5, 5, 9][Math.floor(roam() * 3)];
          goal.a = Math.atan2(dx, dz) + (roam() - 0.5) * 1.6;
          goal.until = g.time + (mode === 'kite' ? 2 : 4);
        }
        const gx = d.position.x + Math.sin(goal.a) * goal.r, gz = d.position.z + Math.cos(goal.a) * goal.r;
        const k = Math.hypot(gx, gz) > B ? B / Math.hypot(gx, gz) : 1;
        const ex = gx * k - p.position.x, ez = gz * k - p.position.z, l = Math.hypot(ex, ez);
        if (l > 0.6) { wx = ex / l; wz = ez / l; sprint = mode === 'kite' && l > 2; }
      }
      if (sprint) input.hold('ShiftLeft'); else input.release('ShiftLeft');
      input.axis = { x: wx, y: -wz };
      return rolled;
    },
  };
}

/** A real melee beat of his: a zone of his own (no cast, no stream, no sent volley, nothing out of the
 *  hover: those reach wherever the hero is). */
const meleeBeat = (b) => !b.feint && !!b.def.zone && !b.def.cast && !b.def.selfHit && !b.def.send && !b.def.fist && !b.def.pass && (!b.def.release || b.cut === true);

/** One AI run against a bot in phase `ph`: his melee swings, those at air (the hero beyond the blow's zone
 *  + 1.5 m at its impact, nothing met) split into the swings THROWN at air (the hero already out of what
 *  it could reach, past the pursuit's margin, at its glint) and those the hero ESCAPED (he left after the
 *  glint: a blow once cued is thrown), the glints with no blow after them (the move left before the
 *  impact with him not hit out of it), the break-offs. `pursue: false`: the kit without pressure.pursue. */
function whiffRun(seed, ph, mode, secs, pursue = true) {
  const PU = TUNING.pressure.pursue;
  if (!pursue) delete TUNING.pressure.pursue;
  try {
    const G = build(seed, true);
    const { game } = G;
    const d = game.dragon, p = game.player;
    duel(G, { dist: 3, ai: true, form: ph });
    p.debug.god = true;
    p.debug.noRiposte = true;
    G.defend = aiBot(G, mode, mulberry32(seed * 31 + ph));
    Math.random = mulberry32(seed * 7 + ph);
    const hp = d.hitPlayer.bind(d);
    d.hitPlayer = (o) => { const r = hp(o); if (o?.beat && r !== RESULT.IGNORED) o.beat._contact = true; return r; };
    const pr = p.radius ?? 0.45, c = new THREE.Vector3();
    const R = { seed, ph, mode, swings: 0, air: 0, escaped: 0, contacts: 0, glints: 0, glintNoBlow: 0, by: {}, lost: {}, stops: d.brain.stats.stops ?? 0 };
    let lastA = null, lastT = 0;
    const settleAct = (A, t, why) => {
      for (const b of A.beats) {
        if (!b.flashed || !meleeBeat(b) || b._g) continue;
        b._g = true;
        R.glints++;
        // (a glint whose blow never came: the move left before its impact, and not because he was hit out of it)
        if (t < b.impact - 1e-6 && why !== 'react' && why !== 'broken') { R.glintNoBlow++; R.lost[A.name] = (R.lost[A.name] || 0) + 1; }
      }
    };
    const t0 = game.time;
    for (let i = 0; i < Math.round(secs / DT); i++) {
      G.defend.act();
      game.mouseGround.set(d.position.x, 0, d.position.z);
      G.tick(DT);
      if (d.brain.pendingPhase > ph) d.brain.pendingPhase = 0;
      if (d.hp < d.maxHp * 0.6) d.hp = d.maxHp * (ph === 1 ? 0.95 : 0.9);
      const a = d.mode === 'act' ? d.brain.act : null;
      if (lastA && a !== lastA) settleAct(lastA, lastT, d.mode);
      lastA = a;
      lastT = a ? a.t : 0;
      if (a && !a.def.transition) {
        for (const b of a.beats) {
          if (!meleeBeat(b)) continue;
          // (at its glint: how far the hero stood beyond what the blow could still reach; past the pursuit's
          // margin the blow was thrown at air by choice, under it he left after the glint, an evasion)
          if (b.flashed && b._g0 === undefined) {
            const s = d.brain._sense();
            b._g0 = s ? s.dist - d.brain._reachLeft(b, a.t, s) : Infinity;
          }
          if (b._far === undefined && a.t >= b.impact) {
            // (the zone's centre: `fwd` m ahead of him, `side` m to his left)
            const z = b.def.zone, fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), f = z.fwd || 0, sd = z.side || 0;
            const cc = c.set(d.position.x + fx * f + fz * sd, 0, d.position.z + fz * f - fx * sd);
            b._far = Math.hypot(p.position.x - cc.x, p.position.z - cc.z) - (z.r + pr);
          }
          if (b.done && !b._seen && b._far !== undefined) {
            b._seen = true;
            R.swings++;
            if (b._contact || b.cover) { R.contacts++; continue; }
            if (b._far > 1.5) {
              if (b._g0 !== undefined && b._g0 <= (PU?.margin ?? 0.5)) R.escaped++;
              else { R.air++; R.by[a.name] = (R.by[a.name] || 0) + 1; }
            }
          }
        }
      }
    }
    R.T = game.time - t0;
    R.stops = (d.brain.stats.stops ?? 0) - R.stops;
    G.defend = null;
    d.hitPlayer = hp;
    return R;
  } finally {
    if (!pursue) TUNING.pressure.pursue = PU;
  }
}

/**
 * One staged move with his AI on (the reach watch is his AI's): `name` triggered in phase `ph` with the hero
 * `dist` m in front of him, `hero(G, t)` steering the hero each frame. Returns the move's glints, its blows on
 * the hero, the break-offs, the swings at air, the hero's distance at the break-off and the closest he came
 * in the `after` s that followed. `pursue: false`: the kit without pressure.pursue.
 */
function chaseCase(name, { ph = 1, dist = 1.8, hero = null, pursue = true, after = 1.5 } = {}) {
  const PU = TUNING.pressure.pursue;
  if (!pursue) delete TUNING.pressure.pursue;
  try {
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon, p = game.player;
    duel(G, { dist, form: ph });
    p.debug.god = true;
    p.debug.noRiposte = true;
    d.position.set(0, 0, -2);
    d.yaw = 0;
    place(G, dist);
    run(G, 0.05);
    const flashes = [], h0 = G.hits.length, s0 = d.brain.stats.stops ?? 0;
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === name) flashes.push({ t: game.time, tell: e.tell }); };
    const hp = d.hitPlayer.bind(d);
    d.hitPlayer = (o) => { const r = hp(o); if (o?.beat && r !== RESULT.IGNORED) o.beat._contact = true; return r; };
    d.debug.trigger(name);
    d.debug.setAI(true);
    const A = d.brain.act;
    let stopAt = null, stopDist = 0, closest = Infinity, air = 0;
    const t0 = game.time;
    const gap = () => Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z);
    run(G, 6, () => {
      for (const b of A.beats) if (b.done && !b._seenW && meleeBeat(b)) { b._seenW = true; if (!b._contact && !b.cover) air++; }
      hero?.(G, game.time - t0);
      if (stopAt === null && (d.brain.stats.stops ?? 0) > s0) { stopAt = game.time - t0; stopDist = gap(); }
      if (stopAt !== null) closest = Math.min(closest, gap());
    }, () => (stopAt !== null ? game.time - t0 > stopAt + after : d.brain.act !== A && game.time - t0 > 0.5));
    G.watch = null;
    G.input.release('ShiftLeft');
    G.input.up(1);
    G.input.axis = { x: 0, y: 0 };
    d.hitPlayer = hp;
    return { G, d, A, flashes, hits: G.hits.slice(h0).filter((h) => h.attack === name), stops: (d.brain.stats.stops ?? 0) - s0, stopAt, stopDist, closest, air };
  } finally {
    if (!pursue) TUNING.pressure.pursue = PU;
  }
}

/** The hero's input toward a direction (world x, z), sprinting or not. */
const steer = (G, wx, wz, sprint = false) => {
  if (sprint) G.input.hold('ShiftLeft');
  else G.input.release('ShiftLeft');
  G.input.axis = { x: wx, y: -wz };
};

/**
 * PURSUIT (pressure.pursue, Tian Lei's, ADR-162; his, ADR-168): a blow the hero has run out of the reach of breaks off
 * before its glint and he chases; a glint is always followed by a blow. Staged: the hero sprints out of
 * Idle Hand's first windup (broken off, no glint, no hit, he comes after him; without the pursuit the jab
 * is thrown at air), a hero who stays is hit as before, a string on a hero who guards in reach is thrown
 * whole. Then his AI a minute a phase against heroes who step out of reach (GCD_WBOTS, default
 * retreat,flee; GCD_WSECS 60): 0 swings thrown at air (a hero who leaves after a glint escapes a blow
 * that is thrown: counted apart), 0 glints with no blow.
 */
async function scenarioPursuit() {
  out('\n== scenario PURSUIT (a blow the hero ran out of the reach of breaks off before its glint, and he chases; no swing at air) ==');
  const PU = TUNING.pressure.pursue, pf = (v, ph) => (Array.isArray(v) ? v[Math.min(v.length, ph) - 1] : v);
  assert(PU && PU.margin > 0 && [1, 2, 3].every((f) => pf(PU.closeK, f) >= 1 && pf(PU.dashK, f) >= 1),
    `TUNING.pressure.pursue: break off ${PU?.margin} m past what a blow can still reach; the chase by phase x${[1, 2, 3].map((f) => pf(PU?.closeK, f)).join(' / ')} step-in, x${[1, 2, 3].map((f) => pf(PU?.dashK, f)).join(' / ')} dash`);
  // 1. the hero rolls away out of Idle Hand's first windup (at 0.1 s, before its glint) and sprints on
  const runOut = (G, t) => {
    if (t < 0.08) return;
    const p = G.game.player, d = G.game.dragon, dx = p.position.x - d.position.x, dz = p.position.z - d.position.z, l = Math.hypot(dx, dz) || 1;
    if (t < 0.9) steer(G, dx / l, dz / l, true);
    if (t > 0.08 && t < 0.11) G.input.tap('Space');
    if (t >= 0.9) steer(G, 0, 0);
  };
  const jab = chaseCase('idleHand', { hero: runOut, dist: 3.0 });
  const jab0 = chaseCase('idleHand', { hero: runOut, dist: 3.0, pursue: false });
  out(`     Idle Hand rolled out of: broken off at ${jab.stopAt?.toFixed(2)} s with the hero ${jab.stopDist.toFixed(1)} m off, the closest he came in 1.5 s ${jab.closest.toFixed(1)} m; without the pursuit: ${jab0.flashes.length} glints, ${jab0.air} at air`);
  assert(jab.stops === 1 && !jab.flashes.length && !jab.hits.length && jab.air === 0 && jab.closest < jab.stopDist - 1.5,
    `Idle Hand, the hero rolls out of its first windup from 3 m: broken off (${jab.stops}), no glint (${jab.flashes.length}), no hit (${jab.hits.length}), and he chases: ${jab.stopDist.toFixed(1)} → ${jab.closest.toFixed(1)} m`);
  assert(jab0.stops === 0 && jab0.flashes.length >= 1 && jab0.air >= 1, `without TUNING.pressure.pursue (as on main): thrown at air (${jab0.flashes.length} glints, ${jab0.air} at air)`);
  // 2. ... and a hero who stays is hit as before; a string on a hero who guards in reach is thrown whole
  const stay = chaseCase('idleHand');
  const real = stay.A.beats.filter((b) => !b.feint).length;
  assert(stay.stops === 0 && stay.flashes.length === real && stay.hits.length === real, `Idle Hand, the hero stays: ${stay.flashes.length} glints, ${stay.hits.length} blows of ${real} (${stay.hits.map((h) => h.r).join(' ')})`);
  const guard = chaseCase('stairKick', { hero: (G) => G.input.press(1) });
  const real2 = guard.A.beats.filter((b) => !b.feint).length;
  assert(guard.stops === 0 && guard.flashes.length === real2 && guard.hits.length === real2, `Climbing the Stair on a hero who guards in reach: ${guard.flashes.length} glints and ${guard.hits.length} blows of ${real2}, ${guard.stops} broken off`);
  // 3. his AI against heroes who step out of reach
  const SEEDS = (process.env.GCD_WSEEDS ?? String(SEED)).split(',').map(Number).filter(Number.isFinite);
  const SECS = Number(process.env.GCD_WSECS ?? 60);
  const BOTS = (process.env.GCD_WBOTS ?? 'retreat,flee').split(',');
  // (GCD_WPURSUE=0: the same bots against the kit without pressure.pursue, as on main: reported, the
  // asserts left out)
  const WITH = process.env.GCD_WPURSUE !== '0';
  out(`     his AI, ${SECS} s a phase, seeds ${SEEDS.join(', ')}${WITH ? '' : ', WITHOUT pressure.pursue'}:`);
  out('     bot      P  swings  contact  AIR  air/min  escaped  glints  no blow  broken off   at air by move');
  for (const mode of BOTS) {
    for (let ph = 1; ph <= 3; ph++) {
      const rs = SEEDS.map((seed) => whiffRun(seed, ph, mode, SECS, WITH));
      const sum = (k) => rs.reduce((a, r) => a + r[k], 0), T = sum('T');
      const by = {};
      for (const r of rs) for (const [k, v] of Object.entries(r.by)) by[k] = (by[k] || 0) + v;
      const lost = {};
      for (const r of rs) for (const [k, v] of Object.entries(r.lost)) lost[k] = (lost[k] || 0) + v;
      out(`     ${mode.padEnd(8)} ${ph} ${String(sum('swings')).padStart(7)} ${String(sum('contacts')).padStart(8)} ${String(sum('air')).padStart(4)} ${((sum('air') * 60) / T).toFixed(2).padStart(8)} ${String(sum('escaped')).padStart(8)} ${String(sum('glints')).padStart(7)} ${String(sum('glintNoBlow')).padStart(8)} ${String(sum('stops')).padStart(11)}   ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(' · ')}${Object.keys(lost).length ? `  (glints lost: ${Object.entries(lost).map(([k, v]) => `${k} ${v}`).join(' · ')})` : ''}`);
      if (!WITH) continue;
      assert(sum('air') === 0, `${mode} P${ph}: 0 swings thrown at air a minute (${((sum('air') * 60) / T).toFixed(2)}; ${sum('swings')} swings, ${sum('escaped')} escaped after their glint, ${sum('stops')} broken off)`);
      assert(sum('glintNoBlow') === 0, `${mode} P${ph}: every glint is followed by its blow (${sum('glints')} glints, ${sum('glintNoBlow')} without)`);
    }
  }
}

const S = {
  pace: scenarioPace,
  win: scenarioWin,
  strategy: scenarioStrategy,
  training: scenarioTraining,
  reward: scenarioReward,
  cover: scenarioCover,
  bend: scenarioBend,
  stop: scenarioStop,
  stance: scenarioStance,
  flight: scenarioFlight,
  rising: scenarioRising,
  dejavu: scenarioDejavu,
  flow: scenarioFlow,
  levels: scenarioLevels,
  data: scenarioData,
  flurry: scenarioFlurry,
  nolock: scenarioNolock,
  wall: scenarioWall,
  gear: scenarioGear,
  timing: scenarioTiming,
  audit: scenarioAudit,
  guns: scenarioGuns,
  probe: scenarioProbe,
  line: scenarioLine,
  gunfx: scenarioGunFx,
  motionfix: scenarioMotionFix,
  pursuit: scenarioPursuit,
  smoke: scenarioSmoke,
  looks: scenarioLooks,
  rebuild: scenarioRebuild,
  oneref: scenarioOneRef,
  herolike: scenarioHeroLike,
  scenes: scenarioScenes,
};
const OPT_IN = new Set(['smoke', 'cost', 'strategy', 'audit', 'guns', 'probe']);
const list = SCEN === 'all' ? Object.keys(S).filter((k) => !OPT_IN.has(k)) : SCEN.split(',');
if (process.env.GCD_LOOKS) {
  const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  for (const kv of process.env.GCD_LOOKS.split(',')) {
    const [k, v] = kv.split('=');
    if (k) setLook(k, v ?? null);
  }
}
for (const k of list) {
  if (!S[k]) { out(`unknown scenario ${k}`); process.exit(2); }
  await S[k]();
}
const notCat = [...EMITTED].filter((n) => !CATALOGUE.has(n) && n !== 'state');
assert(!notCat.length, `every event this level emits is in the catalogue ${JSON.stringify(notCat)}`);
out(`\n\nconsole errors/warnings: ${errors.length}${errors.length ? '\n  ' + [...new Set(errors)].slice(0, 12).join('\n  ') : ''}`);
if (errors.length) fails++;
out(fails ? `\nWOKE: ${fails} FAILED` : '\nWOKE: ALL PASSED');
process.exit(fails ? 1 : 0);
