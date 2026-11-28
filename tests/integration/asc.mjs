// The Skybreak Ring and Tian Lei, the Last Ascendant, headless (MOVES.md): the REAL Player, Ascendant,
// Hud, GameFlow, AudioEngine and Lab (+ real LightPool, GlyphParticles, CameraRig, Events) wired like
// src/main.js for `?level=ring`; the world is a light mock on the real Colliders, filled by the level's
// set (world/skybreakRing.js). A bot drives the input. Copied from lord.mjs (its build, bots, helpers).
// usage: node asc.mjs <repoRoot> [scenario]   (env: GCD_SEED=n reseeds the AI)
//   scenario: level | data | timing | forms | flare | bare | engine | pace | bounds | flow | win | training | all
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
const { createSkybreakRing, RING } = await imp('src/world/skybreakRing.js');
const { Destructibles } = await imp('src/world/destructibles.js');
const { Scars } = await imp('src/world/scars.js');
const { Player } = await imp('src/entities/player/player.js');
const { Ascendant } = await imp('src/entities/enemies/ascendant/ascendant.js');
const { MOVES, MOVE_NAMES, CLIPS_BY_FORM, COUNTERS, COUNTER_LISTS, STREAKS, TRANSITIONS, realise } = await imp('src/entities/enemies/ascendant/moves.js');
const { TUNING } = await imp('src/entities/enemies/ascendant/tuning.js');
const { paceOn } = await imp('src/entities/enemies/ascendant/pace.js');
/** The lead of the cue that just fired (read in a combat:flash handler, or while it is pending): its beat's
 *  impact - flash, the readable pace's 0.35 s on a melee blow (ADR-248, `?ascPace=a`), a ki beat's or an
 *  exempt move's own (TUNING.flashLead); TUNING.flashLead when no beat of his is cueing. */
const cueLead = (G) => {
  const A = G?.game?.dragon?.brain?.act;
  const b = A?.beats?.find((x) => x.flashed && !x.done && !x.feint);
  const l = b ? b.impact - b.flash : NaN;
  return Number.isFinite(l) && l > 0 ? l : TUNING.flashLead;
};
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
const LVL = getLevel('ring');
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
const FORMS = TUNING.forms;
const weightIn = (def, f) => (Array.isArray(def.weight) ? def.weight[f - 1] ?? 0 : def.weight ?? 0);
/** The forms a move is used in (its weight; a counter: its own form; a transition: the form before it). */
const formsOf = (name) => {
  const def = MOVES[name];
  if (def.transition) return [def.phase - 1];
  if (def.counter) return [...COUNTER_LISTS.map((L, i) => (L.includes(name) ? i + 1 : 0)), STREAKS.indexOf(name) + 1].filter((f) => f > 0);
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
  const set = createSkybreakRing(createSharedUniforms(), c);
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
  const set = real ? createSkybreakRing(U, colliders) : null;
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
    if (![d.position.x, d.position.y, d.position.z, d.hp, d.yaw, d.posture, d.maxPosture].every(Number.isFinite)) throw new Error('ascendant NaN');
    if (![d._tip.x, d._tip.y, d._tip.z, d._hilt.x].every(Number.isFinite)) throw new Error('ascendant limb NaN');
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

/** Title → the duel (the Lab's flow jump), in form `form`, the hero `dist` m in front of him, facing him. */
function duel(G, { dist = 4, ang = 0, ai = false, form = 1 } = {}) {
  const { game } = G;
  run(G, 0.2);
  game.flow.debug.toState('boss');
  const d = game.dragon;
  d.debug.setAI(ai);
  if (form > 1) d.debug.setForm(form);
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
const quiet = (d) => d.mode === 'foot' && !d.fx.shotsAlive && !d.fx.crescentsAlive && !d.fx.strikesAlive && !d.ki?.busy && !d.terrain?.busy;

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
        pend.push({ tell: d.tell, at: G.game.time + (d.source === 'world' ? 0.3 : cueLead(G)), x: d.x, z: d.z, hazard: !!d.hazard && !d.bullet, done: false });
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

/** Break him and give the deathblow with the hero's own attack press. Returns the form after it. */
function deathblow(G, how = 'posture') {
  const { game, input } = G;
  const d = game.dragon;
  if (how === 'posture') d.debug.postureBreak();
  else d.takeHit({ damage: 99999, exact: true });
  run(G, 0.3);
  place(G, 2.0);
  const was = d.phase;
  run(G, 4, () => { if (((game.realTime * 60) | 0) % 12 === 0 && d.broken) input.click(0); }, () => d.phase !== was || d.mode === 'dying');
  return d.phase;
}

// ================================================================== scenario: level
async function scenarioLevel() {
  out('\n== scenario LEVEL (the registry, the set, the boss slot: he waits, arms folded) ==');
  assert(LEVELS.includes(LVL) && LVL.id === 'ring', `levels: ${LEVELS.map((l) => l.id).join(', ')}`);
  assert(['?level=ring', '?lab&level=SKYBREAK', '?level=ascendant', '?level=tianlei'].every((q) => levelFromSearch(q) === LVL), '?level=ring / skybreak / ascendant / tianlei pick the level (case-insensitive)');
  for (const k of ['arrive', 'stir', 'phase2', 'phase3', 'victory', 'fallen', 'restReset', 'again', 'rise']) if (!LVL.text[k]) assert(false, `the level has its ${k} line`);
  assert(CONFIG.world.dragonBound === RING.floor.r && CONFIG.world.dragonSleep.z === RING.wait.z, 'applyLevel merged the ring\'s layout into CONFIG.world');
  const G = build();
  const d = G.game.dragon;
  assert(d instanceof Ascendant && d.kind === 'duelist' && d.name === TUNING.name && d.kit.id === 'ascendant' && d.object3d.name === 'ascendant', `the boss is his own duelist: ${d.name}`);
  assert(Math.abs(d.drawScale - TUNING.scale) < 1e-9 && Math.abs(d.drawScale / G.game.player.drawScale - 1.12) < 0.02, `drawn 1.12 x the hero (${d.drawScale.toFixed(3)} vs ${G.game.player.drawScale})`);
  assert(d.mode === 'sleep' && d.brain.clip === d.brain.C.meditate && d.lives.total === 3 && d.lives.left === 3 && d.phase === 1, 'he waits standing, arms folded (meditate), three bars');
  assert(!d.rig.root.getObjectByName('weapon') && typeof d.ki?.reset === 'function' && typeof d.terrain?.reset === 'function', 'bare-handed; his ki and terrain objects exist (stubs for the second wave)');
  run(G, 0.3);
  G.game.flow.debug.toState('explore');
  run(G, 0.3);
  assert(d.mode === 'sleep', 'exploring, far off: he does not stir');
  d.startIntro();
  run(G, 3, null, () => d.mode === 'foot');
  assert(G.counts['dragon:wake'] === 1 && G.counts['dragon:introDone'] === 1 && d.mode === 'foot', 'woken: he opens his eyes, unfolds his arms and drops into his stance');
}

// ================================================================== scenario: data (the move rules)
async function scenarioData() {
  out('\n== scenario DATA (move data rules in every form a move is used in, both ends of every random roll) ==');
  let checked = 0;
  // (MOVES.md: no white blow above 26, black 36; a red blow as the Lord's Crushing Dark, 30 at most)
  const CAP = { [TELL.NORMAL]: 26, [TELL.BLUE]: 26, [TELL.RED]: 30, [TELL.BLACK]: 36 };
  const strings = [0, 0, 0, 0], count = [0, 0, 0, 0];
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    const forms = formsOf(name);
    if (!forms.length) assert(false, `${name}: used in at least one form`);
    if (!def.transition && !def.counter && !(Array.isArray(def.weight) && def.weight.length === FORMS)) assert(false, `${name}: a weight per form`);
    for (const f of forms) {
      if (!def.transition && !def.counter) count[f]++;
      let most = 0;
      for (const r of [0, 0.35, 0.7, 0.999]) {
        const A = realise(name, f, () => r);
        const real = A.beats.filter((b) => !b.feint);
        most = Math.max(most, real.length);
        const tag = `${name} form ${f} r${r}`;
        if (!real.every((b) => [TELL.NORMAL, TELL.BLUE, TELL.RED, TELL.BLACK].includes(b.def.tell))) assert(false, `${tag}: a tell on every real hit`);
        const first = real[0];
        // (a snap, ADR-225: a white blow from the guard may wind up shorter: >= snap.min, little damage, its flash after its tell)
        const snapOk = (b) => b?.def.snap && b.def.tell === TELL.NORMAL && b.impact - b.tellAt >= TUNING.snap.min - 1e-6 && b.def.damage <= TUNING.snap.maxDamage && b.flash > b.tellAt;
        if (!def.transition && !(first && (first.impact - first.tellAt >= TUNING.minFirstWindup - 1e-6 || snapOk(first)))) assert(false, `${tag}: first real windup ${first ? (first.impact - first.tellAt).toFixed(3) : '-'} >= ${TUNING.minFirstWindup}`);
        for (let i = 1; i < real.length; i++) if (!(real[i].impact - real[i - 1].impact >= TUNING.minHitGap - 1e-6)) assert(false, `${tag}: hits ${i - 1}→${i} ${(real[i].impact - real[i - 1].impact).toFixed(3)} s apart >= ${TUNING.minHitGap}`);
        for (const b of real) if (!(b.flash >= b.tellAt - 1e-6)) assert(false, `${tag}: hit ${b.hit} flashes after its tell`);
        for (let i = 1; i < real.length; i++) if (!(real[i].flash >= real[i - 1].impact - 1e-6)) assert(false, `${tag}: hit ${i}'s flash comes after hit ${i - 1} lands`);
        for (const b of real) if (!(b.def.zone || b.def.release || b.def.cast)) assert(false, `${tag}: hit ${b.hit} has a zone, a release or a cast`);
        for (const b of real) if (b.def.tell === TELL.RED && b.def.zone?.kind === 'ring' && !b.def.ring) assert(false, `${tag}: a red ring has its \`ring\``);
        for (const b of real) if (b.def.zone && !b.def.part) assert(false, `${tag}: hit ${b.hit} says which limb strikes (part)`);
        for (const b of real) if (!def.transition && b.def.damage > CAP[b.def.tell]) assert(false, `${tag}: hit ${b.hit} ${b.def.damage} damage (white / blue ≤ 26, red ≤ 30, black ≤ 36)`);
        if (!(A.end > A.recoveryStart && Math.abs(A.clip.dur - A.end) < 1e-9)) assert(false, `${tag}: clip spans the move`);
        if (!(A.clip.kit === CLIPS_BY_FORM[(def.transition ? def.phase : f) - 1].clash.kit)) assert(false, `${tag}: compiled round its form's stance`);
        checked++;
      }
      if (most >= 5) strings[f]++;
    }
  }
  assert(checked > 80, `${checked} realisations obey the rules (a tell and a limb per hit, first windup >= ${TUNING.minFirstWindup} s, hits >= ${TUNING.minHitGap} s apart, each flash after the hit before it, white / blue ≤ 26, red ≤ 30, black ≤ 36)`);
  for (let f = 1; f <= FORMS; f++) assert(count[f] >= 6 && strings[f] >= 2, `form ${f}: ${count[f]} moves, ${strings[f]} strings of five hits or more`);
  for (let f = 1; f <= FORMS; f++) {
    const six = MOVE_NAMES.filter((n) => weightIn(MOVES[n], f) > 0 && realise(n, f, () => 0.2).beats.filter((b) => !b.feint).length >= 6);
    const varied = six.filter((n) => MOVES[n].beats.some((b) => Array.isArray(b.pick) || b.chance < 1));
    assert(six.length >= 1 && varied.length >= 1, `form ${f} has a six-hit string that varies (${six.join(', ')})`);
  }
  for (const [ph, mv] of Object.entries(TRANSITIONS)) assert(MOVES[mv]?.transition && MOVES[mv].phase === Number(ph) && Math.abs(realise(mv, Number(ph) - 1, () => 0.5).beats[0].impact - TUNING.transform.windup) < 1e-6, `form ${ph} begins with ${mv} (${TUNING.transform.windup} s, then the ring)`);
  assert(COUNTERS.length === FORMS && COUNTERS.every((n, i) => MOVES[n]?.counter && realise(n, i + 1, () => 0.5)) && STREAKS.every((n) => MOVES[n]?.streak), 'every form has its counter and its flurry');
  assert(COUNTER_LISTS.length === FORMS && COUNTER_LISTS.every((L, i) => L.includes(COUNTERS[i]) && L.every((n) => MOVES[n]?.counter && !MOVES[n].streak && realise(n, i + 1, () => 0.5))), `every counter in a form's list is a counter move realisable in that form (${COUNTER_LISTS.map((L) => L.join('+')).join(' / ')})`);
  assert(TUNING.flashLead <= TUNING.minHitGap + 1e-9, `the glint (${TUNING.flashLead} s) fits inside the tightest gap (${TUNING.minHitGap} s)`);
  const gap = (f) => { const A = realise(f === 1 ? 'gates' : f === 2 ? 'goldenGates' : 'thousand', f, () => 0.2); const h = A.beats.filter((b) => !b.feint); return h[1].impact - h[0].impact; };
  const gaps = [1, 2, 3].map(gap);
  if (!paceOn()) assert(gaps[0] > gaps[1] && gaps[1] > gaps[2] && gaps[2] >= TUNING.minHitGap, `a string's hits come faster form by form: ${gaps.map((g) => g.toFixed(3)).join(' > ')} s`);
  else {
    // (the readable pace, ADR-248: a string's blows sit at its floor in every form; the forms speed up in their
    // first blows, x windupScale)
    const first = [1, 2, 3].map((f) => { const A = realise(f === 1 ? 'gates' : f === 2 ? 'goldenGates' : 'thousand', f, () => 0.2); return A.beats.find((b) => !b.feint).impact; });
    assert(first[0] > first[1] && first[1] > first[2] && gaps.every((g) => g >= TUNING.pace.gap - 1e-6), `the readable pace: a string's first blow comes sooner form by form (${first.map((g) => g.toFixed(2)).join(' > ')} s), its blows ${TUNING.pace.gap} s apart or more (${gaps.map((g) => g.toFixed(2)).join(', ')})`);
  }
  // harder forms: more pressure, not more damage (the windups shorten; no move hits harder in a later form)
  assert(TUNING.windupScale.every((w, i) => i === 0 || w < TUNING.windupScale[i - 1]) && TUNING.recoveryScale.every((w, i) => i === 0 || w < TUNING.recoveryScale[i - 1]), 'windups and recoveries shorten form by form');
  // a mikiri and a lock in every form
  const flat = (n) => MOVES[n].beats.flatMap((b) => (Array.isArray(b.pick) ? b.pick : [b]));
  for (let f = 1; f <= FORMS; f++) {
    const inF = MOVE_NAMES.filter((n) => weightIn(MOVES[n], f) > 0 && MOVES[n].phase <= f);
    const mik = inF.filter((n) => flat(n).some((b) => b.mikiri)), lock = inF.filter((n) => flat(n).some((b) => b.lock));
    assert(mik.length >= 1 && lock.length >= 1, `form ${f}: a perilous thrust (${mik.join(', ')}) and a lock (${lock.join(', ')})`);
  }
}

// ================================================================== scenario: timing (flash → contact)
async function scenarioTiming() {
  out('\n== scenario TIMING (every move from inside its band: each glint is a blow, on time) ==');
  let worst = 0, moves = 0;
  const only = process.env.GCD_TMOVE;
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    if (def.transition || def.terrain || def.ki || def.hidden) continue;
    if (only && name !== only) continue;
    for (const f of formsOf(name)) {
      const G = build();
      const d = G.game.dragon;
      const [lo, hi] = def.band;
      const at = def.counter ? 2.2 : Math.max(1.6, Math.min(hi - 0.4, lo + (Math.min(hi, 12) - lo) * 0.4));
      duel(G, { dist: at, form: f });
      G.game.player.debug.god = true;
      const flashes = [], contacts = [];
      G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon') { flashes.push([G.game.time, cueLead(G)]); if (only) out(`       ${G.game.time.toFixed(3)} flash ${e.attack} ${e.tell}`); } };
      const h0 = G.hits.length;
      if (!d.debug.trigger(name)) { assert(false, `${name} form ${f}: starts`); continue; }
      // (a counter stance only hits if the hero cuts into it: the bot cuts once it is catching)
      const cut = def.beats[0]?.stance ? () => { const a = d.brain.act, b = a?.beats[0]; if (a?.name === name && b && !b.caught && a.t > b.start + 0.3 * (b.impact - b.start) + 0.1 && ((G.game.realTime * 60) | 0) % 6 === 0) G.input.click(0); } : null;
      run(G, 9, cut, () => quiet(d));
      for (const h of G.hits.slice(h0)) if (h.r !== RESULT.IGNORED) { contacts.push(h.t); if (only) out(`       ${h.t.toFixed(3)} contact ${h.attack} ${h.kind} ${h.r}`); }
      let w = 0;
      for (const c of contacts) {
        const fl = flashes.filter(([t]) => t <= c + 1e-6).pop();
        w = Math.max(w, fl === undefined ? Infinity : Math.abs(c - fl[0] - fl[1]));
      }
      worst = Math.max(worst, Number.isFinite(w) ? w : 9);
      moves++;
      if (!(contacts.length >= 1) || !(w <= 0.09)) assert(false, `${name} form ${f} from ${at.toFixed(1)} m: ${flashes.length} flashes, ${contacts.length} contacts, worst ${(w * 1000).toFixed(0)} ms`);
      else out(`     ${name.padEnd(13)} form ${f} from ${at.toFixed(1)} m: ${flashes.length} flashes, ${contacts.length} contacts, worst ${(w * 1000).toFixed(0)} ms`);
    }
  }
  if (only) return;
  assert(moves >= 20 && worst <= 0.09, `${moves} move × form runs: every contact within ${(worst * 1000).toFixed(0)} ms of its flash + its cue's lead (${TUNING.flashLead} s; ${TUNING.pace.flashLead} s a paced melee blow), and every move's first hit lands`);
}

// ================================================================== scenario: forms (three bars, a deathblow each)
async function scenarioForms() {
  out('\n== scenario FORMS (three bars: a bar emptied or posture broken → the deathblow → the transformation) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon;
  duel(G, { dist: 2.2 });
  game.player.debug.god = true;
  d.posture = 0;
  d.addPosture(POSTURE.parry.normal);
  const full = d.posture;
  d.posture = 0;
  d.hp = d.maxHp * 0.1;
  d.addPosture(POSTURE.parry.normal);
  const low = d.posture;
  d.posture = 0;
  d.hp = d.maxHp;
  assert(Math.abs(full - POSTURE.parry.normal * TUNING.posture.gainByHp[0]) < 1e-6 && low > full * 2, `the Sekiro rule: a parry moves his posture ${full.toFixed(1)} on a full bar, ${low.toFixed(1)} on a bar nearly empty`);
  const dealt = d.takeHit({ damage: 99999, exact: true });
  assert(dealt > 0 && d.hp === 0 && d.broken && d.mode === 'broken' && d.state === 'staggered' && !G.counts['dragon:death'], 'an empty bar breaks him (no death): on one knee');
  run(G, TUNING.posture.breakTime + 0.3);
  assert(!d.broken && Math.abs(d.hp - d.maxHp * TUNING.posture.spared.hp) < 1e-6 && d.posture > 0 && d.phase === 1, `a break left alone: he rises with ${Math.round(d.hp)} HP and half the meter`);
  // the deathblow, with the hero's own attack press
  let f = deathblow(G, 'hp');
  assert(f === 2 && G.counts['dragon:plunged'] === 1 && G.counts['dragon:phase2'] === 1 && d.lives.left === 2 && d.hp === d.maxHp, `the deathblow ends form 1: form ${f}, ${d.lives.left} pips left, a full bar`);
  assert(d._changing && d.brain.act?.name === 'ascend2' && d.takeHit({ damage: 50 }) === 0 && d.hp === d.maxHp, 'through the transformation nothing lands on him');
  const tAsc = game.time;
  let ringAt = -1;
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'ascend2') ringAt = game.time + TUNING.flashLead; };
  run(G, 5, null, () => d.mode === 'foot');
  G.watch = null;
  assert(!d._changing && d.mode === 'foot' && G.counters.flares >= 1 && ringAt - tAsc > TUNING.transform.windup - 0.3, `the transformation's ring goes out ${(ringAt - tAsc).toFixed(2)} s in (the light flared), then he can be struck again`);
  assert(d.maxPosture === TUNING.posture.max[1] && d.posture === 0 && d.pilot.form === 2, 'form 2 has its own posture meter and stance');
  run(G, 0.2);
  assert(game.hud.lifeEls.filter((e) => e.classList.contains('gone')).length === 1, 'the boss bar spent one pip');
  f = deathblow(G, 'posture');
  run(G, 5, null, () => d.mode === 'foot');
  assert(f === 3 && d.lives.left === 1 && G.counts['dragon:phase3'] === 1 && d.maxPosture === TUNING.posture.max[2], 'a posture break and the deathblow: form 3 (Thunder Ascension)');
  deathblow(G, 'posture');
  assert(d.mode === 'dying' && G.counts['dragon:death'] === 1, 'the third deathblow kills him');
  run(G, 7, null, () => d.mode === 'dead');
  assert(d.mode === 'dead' && d.lives.left === 0 && G.counts['dragon:dead'] === 1 && d.hurtSpheres.length === 0, 'he falls and is gone');
  run(G, 4);
  assert(game.state === 'victory', `the flow ends in victory (${game.state})`);
  d.reset();
  assert(d.phase === 1 && d.lives.left === 3 && d.hp === d.maxHp && d.mode === 'sleep' && !d._changing, 'reset: waiting again, form 1');
  // the Lab's jumps
  const G2 = build();
  duel(G2, { dist: 6 });
  const d2 = G2.game.dragon;
  assert(d2.debug.phase2() && d2.phase === 2 && !d2.debug.phase4(), 'Lab: Phase 2 starts the next transformation; there is no fourth');
  run(G2, 5, null, () => d2.mode === 'foot');
  assert(d2.debug.setForm(3) && d2.phase === 3 && d2.debug.form === 3 && d2.debug.setForm(1) && d2.phase === 1, 'Lab: setForm jumps to any form');
}

// ================================================================== scenario: flare (his moments)
async function scenarioFlare() {
  out('\n== scenario FLARE (parry moments, exactly one charged blow per form, red blows) ==');
  const flat = (n) => MOVES[n].beats.flatMap((b) => (Array.isArray(b.pick) ? b.pick : [b]));
  const inForm = (n, f) => weightIn(MOVES[n], f) > 0 && MOVES[n].phase <= f;
  const BLACK = { 1: 'splitFist', 2: 'sunbreaker', 3: 'heavenfall' };
  for (const f of [1, 2, 3]) {
    const parry = MOVE_NAMES.filter((n) => inForm(n, f) && flat(n).some((b) => b.flare && b.tell === TELL.BLUE));
    const black = MOVE_NAMES.filter((n) => inForm(n, f) && flat(n).some((b) => b.tell === TELL.BLACK));
    const red = MOVE_NAMES.filter((n) => inForm(n, f) && flat(n).some((b) => b.tell === TELL.RED && b.zone && !b.cast));
    assert(parry.length >= 1 && black.length === 1 && black[0] === BLACK[f] && red.length >= 2, `form ${f}: parry moments ${parry.join(', ')}; charged ${black.join(', ')}; ${red.length} moves with a red blow`);
  }
  const G = build();
  duel(G, { dist: 3.0 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  const play = (name, dist, act = null, max = 6, form = 1, hold = 1.6) => {
    settle(G);
    if (d.phase !== form) d.debug.setForm(form);
    run(G, 0.3);
    d.position.set(0, 0, -2);
    d.yaw = 0;
    place(G, dist);
    run(G, 0.3);
    p.guard = p.maxGuard;
    p.streak = 0;
    const ev = [];
    let flashT = null, warnPre = 0, charges = 0;
    const fx = d.fx, ch = fx.charge;
    fx.charge = (...a) => { charges++; return ch.apply(fx, a); };
    const h0 = G.hits.length, hp0 = p.hp;
    G.watch = (n, e) => { ev.push([n, e ? { ...e } : e]); if (n === 'combat:flash' && e?.attack === name && flashT === null) { flashT = game.time; flareLead = cueLead(G); } };
    d.debug.trigger(name);
    run(G, max, () => {
      game.mouseGround.set(d.position.x, 0, d.position.z);
      if (flashT === null && d.mode === 'act') warnPre = Math.max(warnPre, d.warn);
      act?.(flashT);
    }, () => flashT !== null && game.time > flashT + hold && p.state !== 'flurry' && game.hitstopTimer <= 0);
    G.watch = null;
    fx.charge = ch;
    input.up(1);
    return { ev, flashT, warnPre, charges, hits: G.hits.slice(h0), lost: hp0 - p.hp, has: (n) => ev.some((x) => x[0] === n), get: (n) => ev.find((x) => x[0] === n)?.[1], all: (n) => ev.filter((x) => x[0] === n).map((x) => x[1]) };
  };
  // (the lead of the cue that fired: the readable pace's on a melee blow, ADR-248)
  let flareLead = TUNING.flashLead;
  const at = (fT, lead) => fT !== null && game.time >= fT + flareLead - lead - DT;
  // (Piercing Palm, a red perilous thrust, flares red; Mountain-Splitting Fist charges black)
  p.debug.god = true;
  const pp = play('piercingPalm', 3.4);
  const pf = pp.all('combat:flash').filter((e) => e.attack === 'piercingPalm');
  assert(pf.length === 1 && pf[0].tell === TELL.RED && pf[0].perilous === true, `Piercing Palm: one red flare, perilous (a mikiri answers it): ${pf.length}`);
  p.debug.god = false;
  let g0 = null;
  const split = play('splitFist', 3.0, () => { input.press(1); if (g0 === null && G.hits.some((h) => h.attack === 'splitFist')) g0 = p.guard; });
  const sh = split.hits.find((h) => h.attack === 'splitFist');
  assert(split.get('combat:tell')?.tell === TELL.BLACK && split.has('combat:charge') && split.charges > 20 && split.warnPre > 0.5, `Mountain-Splitting Fist: tell black, the charge drawn through its windup (${split.charges} frames), his body darkening (${split.warnPre.toFixed(2)})`);
  assert(sh?.r === RESULT.BLOCKED && split.lost === 0 && g0 === 0 && split.get('player:guardOpen')?.black === true, `on a held guard it is stopped (${sh?.r}), no HP lost, the guard meter gone (${g0}) and the guard knocked open`);
  const bare = play('splitFist', 3.0);
  assert(bare.hits.find((h) => h.attack === 'splitFist')?.r === RESULT.HIT && bare.lost > 25, `unanswered it lands: ${bare.lost.toFixed(0)} HP`);
  // a parry moment: Hundred Hands parried blow for blow; its palm thrust (a blue flare) ends his string
  // and the hero counters
  p.debug.god = true;
  G.defend = makeDefender(G, { early: PLAIN_LEAD }); // plain parries: a perfect one of the palm locks first
  const hun = play('hundred', 2.2, () => G.defend.act(), 9, 1, 5);
  G.defend = null;
  const pal = hun.all('combat:flash').filter((x) => x.attack === 'hundred' && x.flare);
  // (the counter cut, or, in the default deathblow mode, the combo that replaces it)
  const dbEnd = hun.get('player:flurryEnd')?.art === 'deathblow' ? hun.get('player:flurryEnd') : null;
  const cnt = hun.get('player:flareCounter') ?? (dbEnd ? { damage: dbEnd.damage, strikes: dbEnd.strikes } : null);
  assert(pal.length === 1 && pal[0].tell === TELL.BLUE && hun.all('dragon:parried').some((x) => x.flare && x.last) && !!cnt, `Hundred Hands: the palm thrust is a blue flare (${pal.length}); parried, his string ends and the hero counters (${cnt ? `${cnt.strikes} blow(s)` : 'no counter'})`);
  void at;
}

// ================================================================== scenario: bare (no blade assumption misfires)
async function scenarioBare() {
  out('\n== scenario BARE (bare hands: his limbs, the parry, the guard clash, the trade, the lock, the mikiri, the full deflect) ==');
  const G = build();
  duel(G, { dist: 2.4 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  // tellPoint: each part is the end of that limb, on his body (within a body's reach of his root)
  run(G, 0.2);
  const parts = ['fistR', 'fistL', 'footR', 'footL', 'kneeR', 'kneeL', 'elbowR', 'elbowL', 'palms', 'shoulder', 'feet'];
  const v = new THREE.Vector3();
  const near = parts.every((k) => { d.tellPoint(k, v); return Number.isFinite(v.x + v.y + v.z) && Math.hypot(v.x - d.position.x, v.z - d.position.z) < 1.4 && v.y > 0 && v.y < 2.6; });
  d.tellPoint('footR', v);
  const footY = v.y;
  d.tellPoint('fistR', v);
  assert(near && footY < v.y, `tellPoint for ${parts.length} parts: each a point of his body (a foot ${footY.toFixed(2)} m, the right fist ${v.y.toFixed(2)} m)`);
  // through a kick his "blade" is the shin; through a punch the forearm
  d.debug.trigger('meteorStep');
  let kickSeg = 0, partSeen = '';
  run(G, 2, () => { if (d.mode === 'act' && d._part === 'footR') { kickSeg = Math.max(kickSeg, d._tip.distanceTo(d._hilt)); partSeen = d._part; } }, () => quiet(d));
  assert(partSeen === 'footR' && kickSeg > 0.3 && kickSeg < 0.8, `through a kick his blade is the shin (${kickSeg.toFixed(2)} m)`);
  // the parry of a punch: the contact shown on the fist, his string goes on (a deflect), the last recoils him
  const parryRun = (name, dist, mode = 'parry') => {
    settle(G);
    d.position.set(0, 0, -2);
    d.yaw = 0;
    place(G, dist);
    run(G, 0.3);
    const ev = [];
    const pend = [];
    G.watch = (n, e) => { ev.push(n); if (n === 'combat:flash' && e?.source === 'dragon') pend.push({ t: game.time + cueLead(G), tell: e.tell, done: false }); };
    const h0 = G.hits.length;
    d.debug.trigger(name);
    run(G, 8, () => {
      game.mouseGround.set(d.position.x, 0, d.position.z);
      if (p.state === 'lock') { if (((game.realTime * 60) | 0) % 4 === 0) input.click(0); return; }
      for (const e of pend) {
        if (e.done) continue;
        const left = e.t - game.time;
        const lead = mode === 'perfect' ? 0.05 : mode === 'trade' ? 0.12 : mode === 'mikiri' ? 0.15 : 0.12;
        if (left <= lead) {
          e.done = true;
          if (mode === 'trade') input.click(0);
          else if (mode === 'mikiri') { const dx = d.position.x - p.position.x, dz = d.position.z - p.position.z, l = Math.hypot(dx, dz) || 1; input.axis = { x: dx / l, y: -dz / l }; input.tap('Space'); }
          else { input.up(1); input.click(1); }
        }
      }
    }, () => quiet(d) && game.hitstopTimer <= 0 && !['lock', 'flurry', 'roll', 'attack', 'riposte'].includes(p.state));
    G.watch = null;
    input.up(1);
    input.axis = { x: 0, y: 0 };
    return { ev, hits: G.hits.slice(h0), has: (n) => ev.includes(n), count: (n) => ev.filter((x) => x === n).length };
  };
  const par = parryRun('ironMountain', 2.6);
  const parried = par.hits.filter((h) => h.r === RESULT.PARRIED).length;
  assert(parried >= 2 && par.has('dragon:parried') && (par.has('combat:deflectChain') || parried >= 2) && !G.payload.size, `Iron Mountain parried blow for blow: ${parried} parried (the shoulder deflected, the palm recoils him)`);
  // a full deflect of a long string (Hundred Hands: eight blows)
  const fd = parryRun('hundred', 2.2);
  // (a perfect parry of the palm, a `lock` blow, locks the blades instead: since ADR-227 the bot's
  // 0.12 s press is perfect)
  assert(fd.has('dragon:deflected') || fd.has('player:flareCounter') || fd.has('player:lock'), `Hundred Hands parried whole: ${fd.hits.filter((h) => h.r === RESULT.PARRIED).length} parried → ${fd.has('dragon:deflected') ? 'the full deflect' : fd.has('player:lock') ? 'the blade lock' : 'the moment\'s counter'}`);
  // the guard clash on his forearm: the hero cuts into his raised guard
  settle(G);
  d.position.set(0, 0, -2);
  d.yaw = 0;
  place(G, 1.9);
  run(G, 0.4);
  let guardAt = null;
  const fxg = d.fx.guard;
  d.fx.guard = (x, y, z, o) => { guardAt ??= { x, y, z, part: d._part }; return fxg.call(d.fx, x, y, z, o); };
  run(G, 2, () => { if (((game.realTime * 60) | 0) % 25 === 0) input.click(0); }, () => !!guardAt);
  d.fx.guard = fxg;
  const fore = guardAt ? Math.hypot(guardAt.x - d.position.x, guardAt.z - d.position.z) : 9;
  assert(!!guardAt && (guardAt.part === 'fistL' || guardAt.part === 'fistR') && fore < 1.3 && guardAt.y > 0.6 && guardAt.y < 2.2, `his guard turns the cut on a forearm (${guardAt?.part}, ${fore.toFixed(2)} m from his root, ${guardAt?.y?.toFixed(2)} m up)`);
  // a trade: the hero's cut meets his blow
  const tr = parryRun('gates', 2.2, 'trade');
  assert(tr.hits.some((h) => h.r === RESULT.CLASHED) || G.counts['player:trade'] > 0 || tr.has('dragon:guard'), `a trade against his fists ends sanely (${tr.hits.map((h) => h.r).join(' ')})`);
  // the lock: a perfect parry of a lock blow, the hero mashes and wins
  d.debug.setForm(2);
  run(G, 0.4);
  const lk = parryRun('vanishStep', 2.2, 'perfect');
  assert(lk.has('player:lock') && (lk.has('dragon:windup')) && d.mode !== 'act', `Vanishing Step's last blow perfect-parried: the lock (${lk.count('player:lock')} lock events), it ends (${d.mode} ${d.brain.react?.kind ?? ''})`);
  // the mikiri: a roll INTO the Piercing Palm
  d.debug.setForm(1);
  run(G, 0.4);
  const mk = parryRun('piercingPalm', 3.4, 'mikiri');
  assert(mk.has('player:mikiri') && G.counts['dragon:stagger'] > 0, `a roll into Piercing Palm is the mikiri (${mk.has('player:mikiri')})`);
  assert(!G.payload.size, `no non-finite payload in his events (${[...G.payload].join(', ')})`);
}

// ================================================================== scenario: engine (the four patches)
async function scenarioEngine() {
  out('\n== scenario ENGINE (a zone off his root, hits from the air, a sustained beat, the lock at range) ==');
  const { X } = await imp('src/entities/enemies/ascendant/moves.js');
  const { N, B, R } = X.TELL;
  const G = build();
  duel(G, { dist: 2.0 });
  const { game, input } = G;
  const d = game.dragon, p = game.player, br = d.brain;
  p.debug.god = true;
  // 1. zone.fwd / zone.side: a ring 1 m round a point 3 m ahead of him
  d.position.set(0, 0, 0);
  d.yaw = 0;
  const sense = (x, z) => ({ dx: x, dz: z, dist: Math.hypot(x, z), ang: Math.atan2(x, z), p: { x, z } });
  const Z = { kind: 'ring', r: 0.6, fwd: 3 };
  const zr = [br._inZone(Z, sense(0, 3)), br._inZone(Z, sense(0, 0.3)), br._inZone({ ...Z, side: 2 }, sense(2, 3)), br._inZone({ ...Z, side: 2 }, sense(-2, 3))];
  const line = br._inZone({ kind: 'line', r: 1, w: 0.4, fwd: 2 }, sense(0, 2.6)) && !br._inZone({ kind: 'line', r: 1, w: 0.4, fwd: 2 }, sense(0, 0.4));
  assert(zr[0] && !zr[1] && zr[2] && !zr[3] && line && br._ideal(Z) > 3 && br._reach({ def: { zone: Z }, close: 0 }) > 4, `a zone ahead of him / to his left is tested round its own centre (${zr.join(' ')}, line ${line})`);
  // 2. hits from the air: a move that lifts him 3 m, a blow up there marked `air`, one not marked, down again
  MOVES.__air = {
    label: 'test: air', phase: 1, weight: 0, manual: true, hidden: true, cooldown: 0, band: [0, 9], recovery: 0.4,
    beats: [
      { tell: N, windup: 0.5, active: 0.1, damage: 5, knockback: 0, zone: { kind: 'ring', r: 3.6 }, part: 'feet', close: 0, lift: [[0, 0], [0.9, 3]], air: true, keys: [] },
      { tell: N, windup: 0.4, active: 0.1, damage: 5, knockback: 0, zone: { kind: 'ring', r: 3.6 }, part: 'feet', close: 0, keys: [] },
      { tell: B, windup: 0.4, active: 0.1, damage: 5, knockback: 0, zone: { kind: 'ring', r: 3.6 }, part: 'feet', close: 0, air: true, keys: [] },
      { tell: N, windup: 0.5, active: 0.1, damage: 5, knockback: 0, zone: { kind: 'ring', r: 3.6 }, part: 'feet', close: 0, lift: [[0, 3], [1, 0]], keys: [] },
    ],
  };
  settle(G);
  place(G, 2.0);
  const h0 = G.hits.length;
  let topBetween = 0;
  d.debug.trigger('__air');
  run(G, 4, () => { const a = br.act; if (a && a.t > a.beats[1].start && a.t < a.beats[2].end) topBetween = Math.max(topBetween, d.position.y); }, () => d.mode === 'foot');
  const air = G.hits.slice(h0).filter((h) => h.attack === '__air' && h.r !== RESULT.IGNORED);
  assert(air.length === 3 && topBetween > 2.9 && d.position.y === 0, `held 3 m up between beats (${topBetween.toFixed(2)} m), the two \`air\` blows and the landing reach the hero, the unmarked one up there does not (${air.length} contacts)`);
  // a stagger in the air drops him (T.airFall), it does not snap him to the floor
  d.debug.trigger('__air');
  run(G, 0.55);
  const y0 = d.position.y;
  d.brain.startReact('stagger');
  run(G, 2 * DT);
  const y1 = d.position.y;
  run(G, 1);
  assert(y0 > 2 && y1 > 1 && y1 < y0 && d.position.y === 0, `a stagger at ${y0.toFixed(2)} m drops him (${y1.toFixed(2)} m two frames on), then he is on the floor`);
  // 3. a sustained beat: lit 1.2 s, a tick every 0.2 s; the ledger's interval holds the other answer off
  MOVES.__beam = {
    label: 'test: sustain', phase: 1, weight: 0, manual: true, hidden: true, cooldown: 0, band: [0, 20], recovery: 0.4,
    beats: [
      { tell: R, windup: 0.6, fixed: true, active: 0.1, damage: 5, knockback: 0, zone: { kind: 'line', r: 12, w: 1.6 }, part: 'palms', close: 0, track: 0.85, sustain: { dur: 1.2, tick: 0.2 }, keys: [] },
      { tell: N, windup: 0.4, active: 0.1, damage: 5, knockback: 0, zone: { kind: 'sector', r: 3, ang: 1 }, part: 'fistR', close: 0, keys: [] },
    ],
  };
  settle(G);
  place(G, 5);
  const ticks = [];
  d.onSustain = (b, s, a, k) => ticks.push([game.time, k]);
  let conflictIn = null, conflictOut = null, endedAt = 0, startT = 0;
  const A = realise('__beam', 1, () => 0.5);
  d.debug.trigger('__beam');
  startT = game.time;
  run(G, 4, () => {
    const a = br.act;
    if (a?.name === '__beam' && conflictIn === null && a.t > a.beats[0].impact + 0.5) conflictIn = br.ledger.conflict(game.time + 0.2, 1, 0.3);
    if (a?.name === '__beam' && conflictOut === null && a.t > a.beats[0].impact + 0.5) conflictOut = br.ledger.conflict(game.time + 1.4, 1, 0.3);
    if (a?.name === '__beam') endedAt = game.time;
  }, () => d.mode === 'foot');
  delete d.onSustain;
  const span = ticks.length ? ticks[ticks.length - 1][0] - ticks[0][0] : 0;
  assert(Math.abs(A.beats[0].end - A.beats[0].impact - 1.3) < 1e-6 && A.beats[1].start >= A.beats[0].end - 1e-9, `realise: the lit beat ends 1.3 s after its impact (active + dur) and the next waits (${(A.beats[0].end - A.beats[0].impact).toFixed(2)})`);
  assert(ticks.length >= 5 && ticks.length <= 7 && span > 0.9 && ticks.every(([, k], i) => i === 0 || k > ticks[i - 1][1]), `d.onSustain ticks every 0.2 s through the lit window (${ticks.length} ticks over ${span.toFixed(2)} s, k ${ticks.map((x) => x[1].toFixed(2)).join(' ')})`);
  assert(conflictIn === true && conflictOut === false, `the ledger knows the whole lit window: a guard-answer impact inside it conflicts (${conflictIn}), one past it does not (${conflictOut})`);
  assert(endedAt - startT > 0.6 + 1.3 + 0.4, `the string after it waited for it (the move ran ${(endedAt - startT).toFixed(2)} s)`);
  // 4. the lock at range: startBladeLock takes L.dist and the pair settles there
  settle(G);
  place(G, 6);
  run(G, 0.2);
  const okLock = br.startLock({ dist: 6 });
  let dmax = 0, dmin = 99;
  run(G, 1.0, () => { const dd = Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z); dmax = Math.max(dmax, dd); dmin = Math.min(dmin, dd); });
  assert(okLock && p.state === 'lock' && p.bladeLock?.dist === 6 && dmin > 4.5, `a lock at 6 m: the hero is held there, not drawn in to 1.3 m (${dmin.toFixed(2)} - ${dmax.toFixed(2)} m)`);
  run(G, 4, () => { if (((game.realTime * 60) | 0) % 4 === 0) input.click(0); }, () => p.state !== 'lock');
  delete MOVES.__air;
  delete MOVES.__beam;
  assert(p.state !== 'lock', 'and it ends');
  // 5. the counter stance (`stance`, the third wave): a feint beat with a bait hold; a cut into it is
  //    caught (no damage, the hero bounced, the punish beat at once); none: the move ends there, open
  MOVES.__stance = {
    label: 'test: stance', phase: 1, weight: 0, manual: true, hidden: true, cooldown: 0, band: [0, 9], recovery: 0.4,
    beats: [
      { tell: N, windup: 0.45, fixed: true, hold: [0.8, 0.8], active: 0.05, damage: 0, feint: true, stance: { from: 0.3, open: 0.6 }, part: 'palms', close: 0, track: 0.9, keys: [] },
      { tell: R, windup: 0.5, active: 0.1, damage: 9, knockback: 1, knockdown: true, zone: { kind: 'ring', r: 3 }, ring: 3, part: 'palms', close: 0, keys: [] },
    ],
  };
  p.debug.god = false;
  const stance = (cut) => {
    settle(G);
    d.position.set(0, 0, -2);
    d.yaw = 0;
    place(G, 1.9);
    run(G, 0.3);
    p.debug.heal();
    const hp0 = d.hp, ph0 = p.hp, h0 = G.hits.length, c0 = br.stats.caught, m0 = br.stats.stanceMiss, b0 = G.counts['player:bounced'] ?? 0;
    const A = realise('__stance', 1, () => 0.5);
    let caughtAt = null, punishTell = null, openT = 0, guardDownT = 0, glow = 0;
    const sg = d.fx.stanceGlow;
    d.fx.stanceGlow = (...a) => { glow++; return sg?.apply(d.fx, a); };
    G.watch = (n, e) => { if (n === 'dragon:guard' && e?.caught && caughtAt === null) caughtAt = br.act?.t ?? -1; if (n === 'combat:tell' && e?.attack === '__stance' && punishTell === null) punishTell = game.time; };
    d.debug.trigger('__stance');
    const t0 = game.time;
    run(G, 5, () => {
      const a = br.act;
      if (cut && a?.name === '__stance' && a.t > A.beats[0].start + 0.5 && a.t < A.beats[0].impact && ((game.realTime * 60) | 0) % 6 === 0) input.click(0);
      if (d.mode === 'foot' && game.time - t0 < 3) { openT += DT; if (br.raiseT > 0 && !br.guardUp()) guardDownT += DT; }
    }, () => game.time - t0 > 2.6 && d.mode === 'foot' && p.state !== 'bounce');
    d.fx.stanceGlow = sg;
    G.watch = null;
    return { caughtAt, punishTell: punishTell === null ? null : punishTell - t0, dHp: hp0 - d.hp, pHp: ph0 - p.hp, hits: G.hits.slice(h0).filter((h) => h.attack === '__stance'), caught: br.stats.caught - c0, miss: br.stats.stanceMiss - m0, bounced: (G.counts['player:bounced'] ?? 0) - b0, openT, guardDownT, glow, A };
  };
  const c = stance(true);
  // (the event is sent after the jump: the move's clock already stands at the stance beat's end)
  assert(c.caught === 1 && c.miss === 0 && c.dHp === 0 && c.bounced >= 1 && c.caughtAt !== null && Math.abs(c.caughtAt - c.A.beats[0].end) < 1e-6, `a cut into the stance is CAUGHT (${c.caught}; the move jumped to the stance's end, ${c.caughtAt?.toFixed(2)} s), no damage to him (${c.dHp}), the hero's blade thrown back (${c.bounced})`);
  assert(c.hits.length >= 1 && c.hits[0].tell === TELL.RED && c.glow > 5, `then the punish beat comes at once and reaches the hero (${c.hits.map((h) => h.r).join(' ')}); the light drawn into his palms was drawn (${c.glow} frames)`);
  const m = stance(false);
  assert(m.caught === 0 && m.miss === 1 && m.hits.length === 0 && m.guardDownT > 0.4 && m.guardDownT < 1.2, `a stance nobody cut into ends at its impact with no punish (${m.hits.length} hits) and he is open with his guard down (${m.guardDownT.toFixed(2)} s)`);
  delete MOVES.__stance;
  p.debug.god = true;
}

// ================================================================== scenario: pace (the director's meter)
function paceDefender(G) {
  const pend = [];
  let guardUntil = -1;
  const leadOf = (src) => (src === 'world' ? 0.3 : cueLead(G));
  return {
    onEvent(n, e) {
      if (n !== 'combat:flash' || (e?.source !== 'dragon' && e?.source !== 'world')) return;
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
            let wx = e.hazard ? dx / l : -dz / l, wz = e.hazard ? dz / l : dx / l;
            const B = (CONFIG.world.dragonBound ?? 12) - 1;
            if (Math.hypot(p.x + wx * 3, p.z + wz * 3) > B) { wx = -wx; wz = -wz; }
            input.axis = { x: wx, y: -wz };
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

async function scenarioPace() {
  out('\n== scenario PACE (a steady defender in god mode vs his AI, per form: cues, gaps, mix, chains, conflicts) ==');
  const DIR = await imp('src/entities/enemies/duelist/director.js');
  const SECS = Number(process.env.GCD_PSECS ?? 120);
  const SEEDS = (process.env.GCD_PSEEDS ?? '4242,7,99').split(',').map(Number).filter(Number.isFinite);
  const answer = (tell) => (tell === TELL.RED || tell === TELL.BLACK ? 'dodge' : 'guard');
  const skip = (name) => !MOVES[name] || MOVES[name].transition || MOVES[name].counter;
  const rows = [];
  const B = (CONFIG.world.dragonBound ?? 12) - 1;
  for (const seed of SEEDS) {
    for (let ph = 1; ph <= FORMS; ph++) {
      const G = build(seed, true);
      const { game } = G;
      const d = game.dragon, p = game.player;
      duel(G, { dist: 3, ai: true, form: ph });
      p.debug.god = true;
      p.debug.noRiposte = true;
      G.defend = paceDefender(G);
      Math.random = mulberry32(seed * 7 + ph);
      const flashes = [], acts = [], cats = {}, busyT = [], moves = {};
      let chained = 0, prevAct = null, prevMode = d.mode, linger = 0, frames = 0;
      const fh = {}, lastFH = {};
      const s0 = { ...(d.brain.stats ?? {}) };
      G.watch = (n, e) => {
        if (n === 'combat:flash' && (e?.source === 'dragon' || e?.source === 'world')) flashes.push([game.time, e.tell, e.attack]);
        if (n === 'combat:charge' && Number.isFinite(e?.dur)) for (let k = 0; k < e.dur; k += 0.1) busyT.push(game.time + k);
        if (n === 'dragon:windup' && !skip(e?.name)) { acts.push([game.time, e.name]); moves[e.name] = (moves[e.name] || 0) + 1; const c = DIR.categoryOf(MOVES[e.name]); cats[c] = (cats[c] || 0) + 1; }
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
          const k = Math.hypot(gx, gz) > B ? B / Math.hypot(gx, gz) : 1;
          const dx = gx * k - p.position.x, dz = gz * k - p.position.z, l = Math.hypot(dx, dz);
          G.input.axis = l > 0.6 ? { x: dx / l, y: -dz / l } : { x: 0, y: 0 };
        }
        game.mouseGround.set(d.position.x, 0, d.position.z);
        G.tick(DT);
        if (d.brain.pendingPhase > ph) d.brain.pendingPhase = 0;
        const a = d.brain.act;
        if (d.mode === 'act' && a && a !== prevAct && !a.def.transition && !a.def.counter && prevMode === 'act' && prevAct) chained++;
        prevAct = d.mode === 'act' ? a : null;
        prevMode = d.mode;
        frames++;
        // (the great spell's 2.4 s charge (the ring's light pulled down, stones rising), any beam of
        // his while it is lit (it sweeps after the hero; its ticks are not cues), the great orb's gather
        // and a counter stance while it is catching (a decision for the hero: cut into it or wait) are
        // not empty gaps: the meter counts them as it counts a black blow's charge)
        if (frames % 6 === 0 && ((d.mode === 'act' && (d.brain.act?.def?.ki === 'beamGreat' || d.brain.act?.def?.ki === 'lantern') && d.brain.act.t < (d.brain.act.beats?.[0]?.impact ?? 0)) || d.ki?.beams?.phase === 'lit' || d.brain.catching?.())) busyT.push(game.time);
        if (d.fx.shotsAlive || d.fx.strikesAlive || d.ki?.busy || d.terrain?.busy) linger++;
        // (what a feint or a hold of the fairness guard gave way to: the live things of his then)
        for (const k of ['feints', 'holds']) {
          const v = d.brain.stats?.[k] ?? 0;
          if (v > (lastFH[k] ?? v)) {
            const why = [...(d.fx.strikes ?? []).filter((x) => x.alive).map((x) => x.attack), ...(d.fx.shots ?? []).filter((x) => x.alive).map((x) => x.attack)];
            const key = `${k.slice(0, 4)}:${a?.name ?? d.mode}<${[...new Set(why)].join('+') || 'blow'}`;
            fh[key] = (fh[key] || 0) + v - lastFH[k];
          }
          lastFH[k] = v;
        }
      }
      G.watch = null;
      G.defend = null;
      const T = game.time - t0;
      const hurt = G.hits.filter((h) => h.t > t0 && h.r === RESULT.HIT).length;
      const sky = flashes.filter((f) => f[2] === 'thunderfall').length;
      const ts = [t0, ...flashes.map((f) => f[0]), ...busyT.filter((x) => x > t0 && x < t0 + T), t0 + T].sort((x, y) => x - y);
      let gapMax = 0, gapAt = '';
      for (let i = 1; i < ts.length; i++) {
        if (ts[i] - ts[i - 1] <= gapMax) continue;
        gapMax = ts[i] - ts[i - 1];
        // (where the longest gap went: the cue before it, the moves started inside it, the cue after)
        const a0 = ts[i - 1], a1 = ts[i], fb = flashes.filter((f) => f[0] <= a0 + 1e-6).pop(), fa = flashes.find((f) => f[0] >= a1 - 1e-6);
        gapAt = `@${(a0 - t0).toFixed(1)} ${fb?.[2] ?? '-'} → [${acts.filter((m) => m[0] > a0 - 0.05 && m[0] < a1).map((m) => m[1]).join(' ')}] → ${fa?.[2] ?? '-'}`;
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
      const st = d.brain.stats ?? {};
      const dlt = (k) => (st[k] ?? 0) - (s0[k] ?? 0);
      const dodge = flashes.filter((f) => answer(f[1]) === 'dodge').length / (flashes.length || 1);
      rows.push({ seed, ph, fh, perMin: (flashes.length * 60) / T, dodge, gapMax, gapAt, picks: acts.length, chained, conflicts, conflictAt, holds: dlt('holds'), feints: dlt('feints'), links: dlt('links'), stops: dlt('stops'), hurt, cats, moves, linger: linger / (frames || 1), sky: (sky * 60) / T, skySkips: d.ki?.shots?.stats?.skySkips ?? 0 });
    }
  }
  PACE_ROWS.push(...rows);
  const CATS = DIR.CATEGORIES;
  out(`   ${SECS} s per form, seeds ${SEEDS.join(', ')}`);
  out(`   seed ph cue/min dodge% gapMax moves chain links hold/f clash hurt  ${CATS.map((c) => c.slice(0, 7).padStart(8)).join('')}`);
  for (const r of rows) out(`   ${String(r.seed).padStart(4)}  ${r.ph} ${r.perMin.toFixed(1).padStart(7)} ${(r.dodge * 100).toFixed(0).padStart(6)} ${r.gapMax.toFixed(2).padStart(6)} ${String(r.picks).padStart(5)} ${String(r.chained).padStart(5)} ${String(r.links).padStart(5)} ${`${r.holds}/${r.feints}`.padStart(6)} ${String(r.conflicts).padStart(5)} ${String(r.hurt).padStart(4)}  ${CATS.map((c) => (((r.cats[c] || 0) * 100) / (r.picks || 1)).toFixed(0).padStart(8)).join('')}${r.stops ? `  stops ${r.stops}` : ''}${r.conflicts ? `  CONFLICTS ${r.conflictAt.slice(0, 4).join(' · ')}` : ''}${r.gapMax > 3 ? `  gap ${r.gapAt}` : ''}`);
  const mean = (ph, k) => { const rs = rows.filter((r) => r.ph === ph); return rs.reduce((a, r) => a + r[k], 0) / (rs.length || 1); };
  for (let ph = 1; ph <= FORMS; ph++) out(`   mean F${ph}: ${mean(ph, 'perMin').toFixed(1)} cues/min, ${(mean(ph, 'dodge') * 100).toFixed(0)} % to dodge, longest gap ${Math.max(...rows.filter((r) => r.ph === ph).map((r) => r.gapMax)).toFixed(2)} s, ${mean(ph, 'chained').toFixed(1)} chained of ${mean(ph, 'picks').toFixed(1)} moves`);
  paceSummary(rows, CATS);
  if (process.env.GCD_PFORMS) return;
  // (TUNING.pressure.meter: each form busier than the one before in the seeds' mean (rampMean), on
  // every seed at least `ramp` x, `minRate` cues a minute, no gap over `maxGap` s)
  const MT = TUNING.pressure.meter, pf = (v, ph) => v[Math.min(v.length, ph) - 1];
  for (let ph = 2; ph <= FORMS; ph++) {
    const a0 = mean(ph - 1, 'perMin'), a1 = mean(ph, 'perMin');
    assert(a1 >= a0 * pf(MT.rampMean, ph), `the seeds' mean: F${ph} at least x${pf(MT.rampMean, ph)} F${ph - 1}'s cues a minute (${a0.toFixed(1)} → ${a1.toFixed(1)}, x${(a1 / a0).toFixed(3)})`);
  }
  for (const r of rows) {
    const prev = rows.find((x) => x.seed === r.seed && x.ph === r.ph - 1);
    if (prev) assert(r.perMin >= prev.perMin * pf(MT.ramp, r.ph), `seed ${r.seed}: F${r.ph} at least x${pf(MT.ramp, r.ph)} F${r.ph - 1} (${prev.perMin.toFixed(1)} → ${r.perMin.toFixed(1)})`);
    assert(r.perMin >= pf(MT.minRate, r.ph) && r.gapMax <= pf(MT.maxGap, r.ph), `seed ${r.seed} F${r.ph}: ${r.perMin.toFixed(1)} cues a minute (>= ${pf(MT.minRate, r.ph)}), longest gap ${r.gapMax.toFixed(2)} s (<= ${pf(MT.maxGap, r.ph)})`);
  }
  for (const r of rows) assert(r.conflicts === 0, `seed ${r.seed} F${r.ph}: no two cues of different sources needing different answers within 0.3 s (${r.conflicts}: ${r.conflictAt.slice(0, 4).join(' · ')})`);
}

// ================================================================== scenario: bounds
async function scenarioBounds() {
  out('\n== scenario BOUNDS (he keeps to the ring, and a hero at its edge is still in his reach) ==');
  const B = Math.min(CONFIG.world.dragonBound ?? TUNING.bound, TUNING.bound);
  let peak = 0;
  for (let f = 1; f <= FORMS; f++) {
    const G = build();
    duel(G, { dist: 3, ai: true, form: f });
    const { game } = G;
    const d = game.dragon, p = game.player;
    p.debug.god = true;
    let outside = 0, melee = 0;
    const h0 = G.hits.length;
    const ex = B * 0.72;
    run(G, 30, () => {
      p.debug.teleport(ex, ex * 0.5);
      if (Math.hypot(d.position.x, d.position.z) > B + 1e-6) outside++;
    });
    for (const h of G.hits.slice(h0)) if (h.r === RESULT.HIT) melee++;
    peak = Math.max(peak, G.peakAdd);
    assert(outside === 0 && melee >= 3, `form ${f}: 30 s against a hero near the ring's edge: never off his floor (${outside} frames out), ${melee} blows landed`);
    if (G.payload.size) assert(false, `form ${f}: finite event payloads (${[...G.payload].join(', ')})`);
  }
  assert(peak < 6500, `every form with the AI on: the additive particle pool peaks at ${peak} of 7000`);
}

// ================================================================== scenario: flow
async function scenarioFlow() {
  out('\n== scenario FLOW (title → the ring → he opens his eyes → the duel; a death sends him back) ==');
  const G = build();
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  run(G, 0.3);
  input.tap('Enter');
  run(G, 0.5);
  if (game.state !== 'explore') game.flow.debug.toState('explore');
  run(G, 0.3);
  assert(game.state === 'explore' && d.mode === 'sleep', 'exploring; he waits, arms folded');
  p.debug.teleport(0, CONFIG.world.bossTriggerZ + 2.5);
  run(G, 0.2);
  run(G, 4, () => { input.axis = { x: 0, y: 1 }; }, () => d.mode !== 'sleep');
  input.axis = { x: 0, y: 0 };
  assert(d.mode === 'intro' && game.state === 'bossIntro', `onto the ring: he stirs (hero at z ${p.position.z.toFixed(1)}, ${game.state})`);
  run(G, 8, null, () => d.mode === 'foot' || d.mode === 'act');
  run(G, 0.2);
  assert(G.counts['dragon:introDone'] === 1 && game.state === 'boss', `the intro ends in the duel (${game.state})`);
  p.debug.god = false;
  p.hp = 1;
  d.debug.setAI(true);
  run(G, 25, null, () => game.state === 'dead');
  assert(game.state === 'dead', 'he can kill the hero');
  run(G, 12, () => { if (((game.realTime * 60) | 0) % 30 === 0) input.tap('Enter'); }, () => game.state === 'explore');
  assert(game.state === 'explore' && d.mode === 'sleep' && d.phase === 1, `after the death he waits again (${game.state}, ${d.mode})`);
}

// ================================================================== scenario: win
async function scenarioWin() {
  out('\n== scenario WIN (a fencing bot in god mode: parries, rolls, cuts in his openings, gives the deathblows) ==');
  const G = build();
  const MK = attachMarks(G.game); // (the floor marks the fight leaves: they change nothing in it)
  const { game } = G;
  const d = game.dragon;
  duel(G, { dist: 3, ai: true });
  G.defend = makeDefender(G);
  const formAt = [0];
  let blows = 0;
  G.watch = (n) => {
    if (n === 'dragon:plunged') blows++;
    if (/^dragon:phase[23]$/.test(n)) formAt.push(game.time);
  };
  const t0 = game.time;
  const won = run(G, 420, () => fencer(G), () => d.mode === 'dead');
  const T = game.time - t0;
  const taken = G.hits.filter((h) => h.r === RESULT.HIT).length;
  const parries = G.hits.filter((h) => h.r === RESULT.PARRIED).length;
  out(`     ${won ? 'won' : 'NOT won'} in ${T.toFixed(0)} s: ${blows} deathblows, ${parries} parries, ${taken} hits taken (god mode), forms at ${formAt.map((t) => (t - t0 > 0 ? (t - t0).toFixed(0) : '0')).join(' / ')} s; form ${d.phase}, bar ${Math.round(d.hp)}`);
  marksCheck(MK, 'asc', out, assert);
  assert(won && blows === 3, `the bot beats all three forms (${blows} deathblows)`);
  assert(T > 30 && T < 300, `the fight takes a bot that answers every tell ${T.toFixed(0)} s`);
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
  assert(kinds.has('asc') && !kinds.has('lord') && !kinds.has('ash') && kinds.has('duel'), `his own boss kind (${[...kinds].join(', ')})`);
  // (GCD_TONLY=id1,id2: those situations alone, in that order)
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
  // the Lab's form buttons: Phase 2 from form 1, then the next
  const G2 = build();
  duel(G2, { dist: 5 });
  const d2 = G2.game.dragon;
  const ok2 = d2.debug.phase2();
  run(G2, 5, null, () => d2.mode === 'foot');
  const ok3 = d2.debug.phase3();
  run(G2, 5, null, () => d2.mode === 'foot');
  assert(ok2 && ok3 && d2.phase === 3 && G2.counts['dragon:phase2'] === 1 && G2.counts['dragon:phase3'] === 1, 'the Lab\'s form buttons: Phase 2, then Phase 3, each its transformation');
}

// ================================================================== the second wave's scenarios
// Each agent adds its scenario FUNCTIONS directly under its own heading line (and its registry
// entries under the same heading inside `S`, below).
// --- shots
/** A shots move from `dist` m in form `form`; `step` each frame. → { ok, hits (the hero's), secs }. */
function shotCast(G, name, { secs = 8, step = null } = {}) {
  const d = G.game.dragon, h0 = G.hits.length, t0 = G.game.time;
  const ok = d.debug.trigger(name);
  run(G, secs, step, () => G.game.time - t0 > 0.3 && quiet(d));
  return { ok, hits: G.hits.slice(h0).filter((h) => h.attack === name || MOVES[name]), secs: G.game.time - t0 };
}
function shotStage(form, dist, ang = 0) {
  const G = build();
  duel(G, { dist, form, ang });
  return G;
}
const hitBy = (r, name) => r.hits.filter((h) => h.attack === name);

async function scenarioShots() {
  out('\n== scenario SHOTS (what he throws and calls: each answer of its MOVES.md row) ==');
  const S0 = (G) => ({ ...G.game.dragon.ki.shots.stats });
  // ---- Spirit Shot: standing still is hit; a parry turns it; a PERFECT parry sends it back; a roll at the cue goes through it
  {
    const G = shotStage(1, 9);
    Math.random = () => 0.9; // (the second palm's 50 %: not this time)
    const hp0 = G.game.player.hp;
    const r = shotCast(G, 'spiritShot');
    const h = hitBy(r, 'spiritShot');
    assert(r.ok && h.length === 1 && h[0].r === RESULT.HIT && G.game.player.hp < hp0, `Spirit Shot from 9 m, unanswered: it lands (${(hp0 - G.game.player.hp).toFixed(1)} damage)`);
  }
  {
    const G = shotStage(1, 9);
    Math.random = () => 0.9;
    G.defend = makeDefender(G, { early: PLAIN_LEAD }); // a plain parry (a perfect one sends it back)
    const d = G.game.dragon, hp0 = d.hp, php = G.game.player.hp;
    const r = shotCast(G, 'spiritShot', { step: () => G.defend.act() });
    const h = hitBy(r, 'spiritShot');
    assert(h.some((x) => x.r === RESULT.PARRIED) && G.game.player.hp === php && d.hp === hp0, `a parry turns it: no damage either way (${h.map((x) => x.r).join(', ')})`);
  }
  {
    const G = shotStage(1, 9);
    Math.random = () => 0.9;
    G.defend = makeDefender(G, { early: 0.05 });
    const d = G.game.dragon, hp0 = d.hp, p0 = d.posture;
    const ret0 = G.counts['dragon:returned'] ?? 0;
    const r = shotCast(G, 'spiritShot', { step: () => G.defend.act() });
    const T = TUNING.shots.spirit;
    assert(hitBy(r, 'spiritShot').some((x) => x.r === RESULT.PARRIED) && Math.abs(hp0 - d.hp - T.returnDamage * TUNING.damageScale) < 3 + T.returnDamage && hp0 - d.hp >= T.returnDamage * 0.9 && (G.counts['dragon:returned'] ?? 0) === ret0 + 1, `a PERFECT parry sends it back into him: ${(hp0 - d.hp).toFixed(0)} damage, posture ${p0.toFixed(0)} → ${d.posture.toFixed(0)}, dragon:returned`);
  }
  {
    const G = shotStage(1, 9);
    Math.random = () => 0.9;
    G.defend = makeDefender(G, { style: 'dodge' });
    const r = shotCast(G, 'spiritShot', { step: () => G.defend.act() });
    assert(!hitBy(r, 'spiritShot').some((x) => x.r === RESULT.HIT), `a roll at its cue goes through it (${hitBy(r, 'spiritShot').map((x) => x.r).join(', ') || 'no contact'})`);
  }
  // ---- Scatter: three in a fan
  {
    const G = shotStage(1, 8);
    const s0 = S0(G);
    const r = shotCast(G, 'scatter');
    const s1 = G.game.dragon.ki.shots.stats;
    assert(r.ok && s1.blasts - s0.blasts === 3 && hitBy(r, 'scatter').some((x) => x.r === RESULT.HIT), `Scatter throws three in a fan (${s1.blasts - s0.blasts}); standing still, one lands (${hitBy(r, 'scatter').map((x) => x.r).join(', ')})`);
    const G2 = shotStage(1, 8);
    G2.defend = makeDefender(G2);
    const r2 = shotCast(G2, 'scatter', { step: () => G2.defend.act() });
    assert(!hitBy(r2, 'scatter').some((x) => x.r === RESULT.HIT), `parried at its cue, none lands (${hitBy(r2, 'scatter').map((x) => x.r).join(', ')})`);
  }
  // ---- Blast Dance: the point-blank blast is a palm in reach; the hip shot a blast
  {
    const G = shotStage(2, 2.2);
    G.game.player.debug.god = true;
    Math.random = () => 0.5;
    const r = shotCast(G, 'blastDance');
    const h = hitBy(r, 'blastDance');
    assert(r.ok && h.length >= 4, `Blast Dance from 2.2 m: ${h.length} of its six blows meet the hero (${h.map((x) => x.r).join(', ')})`);
  }
  // ---- Golden Rain: ten in 1.6 s, two sweeping fans; each cues itself
  {
    const G = shotStage(2, 10);
    G.game.player.debug.god = true;
    const s0 = S0(G);
    let flashes = 0;
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'goldenRain') flashes++; };
    const r = shotCast(G, 'goldenRain');
    G.watch = null;
    const s1 = G.game.dragon.ki.shots.stats, thrown = s1.blasts - s0.blasts, skipped = s1.rainSkips - s0.rainSkips;
    const h = hitBy(r, 'goldenRain');
    assert(r.ok && thrown + skipped === TUNING.shots.rain.count && thrown >= 8, `Golden Rain: ${thrown} thrown, ${skipped} held back by the fairness guard (of ${TUNING.shots.rain.count})`);
    assert(h.length >= 1 && h.length === flashes, `each blast that reaches him cued itself: ${h.length} contacts, ${flashes} cues`);
    const G2 = shotStage(2, 10);
    G2.defend = makeDefender(G2);
    const p0 = G2.game.player.hp;
    const r2 = shotCast(G2, 'goldenRain', { step: () => G2.defend.act() });
    const h2 = hitBy(r2, 'goldenRain');
    out(`     parried: ${h2.map((x) => x.r).join(', ')} (${(p0 - G2.game.player.hp).toFixed(0)} damage taken)`);
    assert(h2.filter((x) => x.r === RESULT.HIT).length <= 1, `a parry at each cue answers the rain (${h2.filter((x) => x.r === RESULT.HIT).length} landed)`);
  }
  // ---- Sun Wheel: out on a curve, home through the hero (red: roll), back in his hand
  {
    const G = shotStage(2, 8);
    const r = shotCast(G, 'sunWheel', { secs: 9 });
    const h = hitBy(r, 'sunWheel');
    assert(r.ok && h.some((x) => x.r === RESULT.HIT) && !G.game.dragon.fx.shots.some((s) => s.alive && s.kind === 'disc'), `Sun Wheel from 8 m, standing still: it cuts him on its way (${h.map((x) => x.r).join(', ')}) and comes home (${r.secs.toFixed(1)} s)`);
    const G2 = shotStage(2, 8);
    G2.defend = makeDefender(G2);
    const r2 = shotCast(G2, 'sunWheel', { secs: 9, step: () => G2.defend.act() });
    assert(!hitBy(r2, 'sunWheel').some((x) => x.r === RESULT.HIT), `a roll at its flare goes through it (${hitBy(r2, 'sunWheel').map((x) => x.r).join(', ') || 'no contact'})`);
  }
  // ---- Heaven's Volley: up 4 m, six marks called, the dive; under 4.5 s; rolled through, nothing lands
  {
    const G = shotStage(2, 7);
    G.defend = makeDefender(G);
    const d = G.game.dragon, s0 = S0(G);
    let top = 0;
    const r = shotCast(G, 'skyVolley', { secs: 9, step: () => { top = Math.max(top, d.position.y); G.defend.act(); } });
    const s1 = d.ki.shots.stats, calls = s1.volleyCalls - s0.volleyCalls;
    const A = realise('skyVolley', 2, () => 0.5);
    assert(r.ok && top >= TUNING.shots.volley.rise - 0.2 && calls + (s1.volleySkips - s0.volleySkips) === TUNING.shots.volley.count && calls >= 4, `Heaven's Volley: he rises to ${top.toFixed(1)} m, ${calls} strikes called`);
    assert(A.end <= 4.6, `the whole move is over in ${A.end.toFixed(2)} s (≤ 4.6)`);
    const h = r.hits.filter((x) => x.attack === 'skyVolley');
    assert(!h.some((x) => x.r === RESULT.HIT), `a hero who rolls at each flare comes through (${h.map((x) => x.r).join(', ') || 'no contact'})`);
    const G2 = shotStage(2, 7);
    const r2 = shotCast(G2, 'skyVolley', { secs: 9 });
    assert(r2.hits.some((x) => x.attack === 'skyVolley' && x.r === RESULT.HIT), `standing still, the strikes or the dive land (${r2.hits.filter((x) => x.attack === 'skyVolley').length} contacts)`);
  }
  // ---- Thunder Gates and Lightning Lance: bolts; a perfect parry throws one back
  {
    const G = shotStage(3, 2.4);
    G.game.player.debug.god = true;
    G.game.player.debug.noRiposte = true; // (a parried blue bolt would answer with a deathblow combo: this is about the bolts)
    G.defend = makeDefender(G);
    const s0 = S0(G);
    const r = shotCast(G, 'thunderGates', { step: () => G.defend.act() });
    const s1 = G.game.dragon.ki.shots.stats;
    assert(r.ok && s1.bolts - s0.bolts === 2 && hitBy(r, 'thunderGates').length >= 8, `Thunder Gates: ${hitBy(r, 'thunderGates').length} blows meet the parrying hero, ${s1.bolts - s0.bolts} bolts`);
  }
  {
    const G = shotStage(3, 9);
    G.defend = makeDefender(G, { early: 0.05 });
    const d = G.game.dragon, hp0 = d.hp, s0 = S0(G);
    const r = shotCast(G, 'lance', { step: () => G.defend.act() });
    const s1 = d.ki.shots.stats, h = hitBy(r, 'lance');
    assert(r.ok && h.length === 4 && !h.some((x) => x.r === RESULT.HIT) && s1.boltReturns - s0.boltReturns >= 1 && d.hp < hp0, `Lightning Lance: four bolts parried (${h.map((x) => x.r).join(', ')}); perfect parries send ${s1.boltReturns - s0.boltReturns} back (${(hp0 - d.hp).toFixed(0)} damage to him)`);
  }
  {
    // (the tuning pass's cap: four perfect returns of one Lance are worth 50 + 25 + 13 + 6, not 4 x 50)
    const G = shotStage(3, 9);
    const d = G.game.dragon, T = TUNING.shots, hp0 = d.hp;
    const sh = d.ki.shots;
    G.game.player.deflect.perfect = true;
    for (let i = 0; i < 4; i++) sh.onHit({ beat: { def: { ki: 'bolt' } } }, RESULT.PARRIED);
    G.game.player.deflect.perfect = false;
    const want = [0, 1, 2, 3].reduce((a, i) => a + T.bolt.returnDamage * Math.pow(T.returns.decay, i), 0);
    assert(Math.abs(hp0 - d.hp - want) < 1 || (d.broken && hp0 - d.hp <= want + 1), `four perfect returns close together: ${(hp0 - d.hp).toFixed(1)} damage to him (cap: ${want.toFixed(1)}; ${4 * T.bolt.returnDamage} uncapped)`);
  }
  // ---- Storm Cage: eight orbs round the hero, open on the side away from him
  {
    const G = shotStage(3, 6);
    const r = shotCast(G, 'stormCage');
    const h = hitBy(r, 'stormCage');
    assert(r.ok && h.filter((x) => x.r === RESULT.HIT).length === 1, `Storm Cage, standing still: it closes on him; the first orb knocks him down and the rest pass over him (${h.length} contacts, ${h.filter((x) => x.r === RESULT.HIT).length} hit)`);
    const G2 = shotStage(3, 6);
    G2.defend = makeDefender(G2, { style: 'dodge' });
    const r2 = shotCast(G2, 'stormCage', { step: () => G2.defend.act() });
    const h2 = hitBy(r2, 'stormCage');
    out(`     rolled at each flare: ${h2.map((x) => x.r).join(', ') || 'no contact'}`);
    assert(h2.filter((x) => x.r === RESULT.HIT).length <= 1, `rolled at each flare, at most one lands (${h2.filter((x) => x.r === RESULT.HIT).length})`);
  }
  // ---- ascend3's corners: harmless unless the hero stands on one
  {
    const G = shotStage(3, 4);
    const sh = G.game.dragon.ki.shots, hp0 = G.game.player.hp;
    sh.corners();
    run(G, 2.5);
    assert(G.game.player.hp === hp0 && !G.game.dragon.fx.strikes.some((s) => s.alive), 'the four corner bolts strike the corners only: the hero in the middle is untouched');
    const c = RING.corners[0];
    G.game.player.debug.teleport(c[0] * 0.92, c[1] * 0.92);
    sh.corners();
    run(G, 0.2);
    assert(G.game.dragon.fx.strikes.some((s) => s.alive && s.attack === 'thunderCorners'), 'a hero on a corner: a strike is called there, with its ring and its cue');
  }
}

async function scenarioWeather() {
  out('\n== scenario WEATHER (Thunderfall: form 3, in his pauses, at most 2 live, never in the hero\'s opening) ==');
  const G = build(4242, true);
  const { game } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist: 5, ai: true, form: 3 });
  p.debug.god = true;
  G.defend = makeDefender(G);
  const sh = d.ki.shots, c0 = sh.stats.skyCalls;
  let maxLive = 0, inOpening = 0;
  const calls = [];
  G.watch = (n, e) => { if (n === 'combat:tell' && e?.attack === 'thunderfall') { calls.push(game.time); if (d.mode === 'react' || d.broken) inOpening++; } };
  run(G, 40, () => {
    G.defend.act();
    game.mouseGround.set(d.position.x, 0, d.position.z);
    if (d.brain.pendingPhase > 3) d.brain.pendingPhase = 0;
    let live = 0;
    for (const s of d.fx.strikes) if (s.alive && s.attack === 'thunderfall') live++;
    maxLive = Math.max(maxLive, live);
  });
  G.watch = null;
  const n = sh.stats.skyCalls - c0;
  out(`     ${n} strikes called in 40 s (${sh.stats.skySkips} slots skipped), at most ${maxLive} live`);
  assert(n >= 8 && n <= 26, `Thunderfall calls a strike every ~1.8 - 3.2 s (${n} in 40 s)`);
  assert(maxLive <= TUNING.shots.weather.maxLive, `at most ${TUNING.shots.weather.maxLive} live (${maxLive})`);
  assert(inOpening === 0, `none cued while he is in a reaction or broken (${inOpening})`);
  // form 2: no weather
  const G2 = build(7, true);
  duel(G2, { dist: 5, ai: true, form: 2 });
  G2.game.player.debug.god = true;
  const c2 = G2.game.dragon.ki.shots.stats.skyCalls;
  run(G2, 15);
  assert(G2.game.dragon.ki.shots.stats.skyCalls === c2, 'form 2: no Thunderfall');
}

// (the third wave, ki: Heaven's Lantern and THE PUSH, Raining Suns)
/** Heaven's Lantern from a set-up (him at (0, -2) facing +z, the hero `dist` m ahead); `answer`: 'none'
 *  | 'block' (held from the start) | 'parry' / 'perfect' (a press `early` s before the orb meets him) |
 *  'roll' (sideways, 0.1 s before); `mash`: a press every `mash` frames in the lock. */
function lanternPlay(G, { dist = 9, form = 2, answer = 'none', early = 0.04, mash = 0, max = 12, step = null } = {}) {
  const { game, input } = G;
  const d = game.dragon, p = game.player, sh = d.ki.shots;
  settle(G);
  if (d.phase !== form) { d.debug.setForm(form); run(G, 0.4); }
  input.axis = { x: 0, y: 0 };
  input.up(1);
  d.position.set(0, 0, -2);
  d.yaw = 0;
  place(G, dist);
  run(G, 0.2);
  p.hp = p.maxHp;
  p.guard = p.maxGuard;
  const info = { flashes: [], states: new Set(), lock: false, reel: 0, top: 0, hp0: p.hp, dhp0: d.hp, start: { x: p.position.x, z: p.position.z }, held: true, flew: 0, dirs: [], heldAct: 0, barred: 0, skyOff: true, busyOut: true };
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon') info.flashes.push({ t: game.time, tell: e.tell, attack: e.attack }); };
  const h0 = G.hits.length, s0 = { ...sh.stats };
  info.started = d.debug.trigger('skyLantern');
  run(G, max, () => {
    info.top = Math.max(info.top, d.position.y);
    info.states.add(p.state);
    const L = sh.lantern, s = L.s;
    if (L.phase === 'fly' && s?.alive && !s.done) {
      info.flew++;
      info.dirs.push(s.dx * 1000 + s.dz);
      // while it is out: his move held at its landing, nothing else of his may start, the weather down
      if (d.mode === 'act' && d.brain.act?.name === 'skyLantern') info.heldAct++;
      if (sh.begin({ def: { ki: 'blast' } }) !== false || sh.weigh({ ki: 'rain' }, 1) !== 0) info.barred++;
      if (sh._skySlot(1.1, 0.5) !== -1) info.skyOff = false;
      if (!sh.busy || !d.ki.busy) info.busyOut = false;
      if (answer === 'block') input.press(1);
      const along = (p.position.x - s.x) * s.dx + (p.position.z - s.z) * s.dz, tta = (along - s.radius - p.radius) / s.speed;
      if (!info.answered && (answer === 'parry' || answer === 'perfect') && tta <= early) { info.answered = true; input.up(1); input.click(1); }
      if (!info.answered && answer === 'roll' && tta <= 0.1) { info.answered = true; input.axis = { x: -s.dz, y: -s.dx }; input.tap('Space'); }
    }
    if (p.state === 'lock') {
      info.lock = true;
      if (mash && ((game.realTime * 60) | 0) % mash === 0) input.click(0);
    }
    if (d.mode === 'react' && d.brain.react?.kind === 'reeling') info.reel += DT;
    step?.(info);
  }, () => info.started && game.time > 0 && !sh.lantern.on && quiet(d) && game.hitstopTimer <= 0 && !['roll', 'knockdown', 'lock'].includes(p.state));
  G.watch = null;
  input.axis = { x: 0, y: 0 };
  input.up(1);
  info.hits = G.hits.slice(h0).filter((h) => h.attack === 'skyLantern');
  info.lost = info.hp0 - p.hp;
  info.dealt = info.dhp0 - d.hp;
  info.moved = Math.hypot(p.position.x - info.start.x, p.position.z - info.start.z);
  info.d = Object.fromEntries(Object.entries(sh.stats).map(([k, v]) => [k, v - (s0[k] ?? 0)]));
  return info;
}

async function scenarioLantern() {
  out('\n== scenario LANTERN (Heaven\'s Lantern: the gather, the throw, every answer; THE PUSH won and lost) ==');
  const LA = TUNING.shots.lantern, scale = TUNING.damageScale ?? 1;
  const G = build();
  duel(G, { dist: 9, form: 2 });
  const { game } = G;
  const d = game.dragon, sh = d.ki.shots;
  // 1. stood in: he rises, the orb gathers (the ledger told from the start), one blue cue on the orb, it lands
  let told = 0;
  const st = lanternPlay(G, { step: () => { if (sh.lantern.phase === 'gather' && d.brain.ledger?.exp?.some((e) => e.alive && e.src === 'skyLantern')) told++; } });
  const c0 = st.hits.find((h) => h.r !== RESULT.IGNORED), f0 = st.flashes.filter((f) => f.attack === 'skyLantern');
  assert(st.started && st.top >= LA.lift - 0.2, `Heaven's Lantern: he rises ${st.top.toFixed(2)} m (${LA.lift})`);
  assert(told > 30 || !d.brain.ledger?.exp, `the orb's blow is known to the ledger through the gather (${told} frames)`);
  assert(f0.length === 1 && f0[0].tell === TELL.BLUE && c0 && Math.abs(c0.t - f0[0].t - TUNING.flashLead) < 0.09, `one blue cue on the orb, ${c0 ? ((c0.t - f0[0]?.t) * 1000).toFixed(0) : '-'} ms before it meets him (flashLead ${TUNING.flashLead * 1000})`);
  assert(c0?.r === RESULT.HIT && Math.abs(c0.damage - LA.damage * scale) < 1e-6 && st.states.has('knockdown') && st.d.lanternHits === 1, `unanswered it lands: ${c0?.damage?.toFixed(1)} damage, knockdown`);
  assert(st.flew > 20 && new Set(st.dirs).size === 1, `it never homes: one heading through ${st.flew} frames of flight`);
  assert(st.heldAct >= st.flew - 1 && st.barred === 0 && st.skyOff && st.busyOut, `while it is out his move waits at its landing (${st.heldAct}/${st.flew} frames), nothing of his may start, the weather stands down, busy`);
  // 2. a block: safe (guard only), it bursts on the guard
  const bl = lanternPlay(G, { answer: 'block' });
  assert(bl.hits[0]?.r === RESULT.BLOCKED && bl.lost === 0 && bl.d.lanternBlocked === 1 && !bl.lock, `a held guard: ${bl.hits[0]?.r}, ${bl.lost} HP lost; it bursts on the guard`);
  // 3. a plain parry: safe, no push
  const pp = lanternPlay(G, { answer: 'parry', early: PLAIN_LEAD + DT }); // (this helper's press lands a step later than a `left <= lead` check)
  assert(pp.hits[0]?.r === RESULT.PARRIED && pp.lost === 0 && !pp.lock && pp.d.pushes === 0, `a plain parry: ${pp.hits[0]?.r}, ${pp.lost} HP lost, no push`);
  // 4. a roll: it passes and bursts on the floor beyond
  const rl = lanternPlay(G, { answer: 'roll' });
  assert(!rl.hits.some((h) => h.r === RESULT.HIT) && rl.d.lanternPassed === 1 && rl.lost === 0, `a roll at the cue: it passes (${rl.hits.map((h) => h.r).join(' ') || 'no contact'}) and bursts beyond`);
  // 5. THE PUSH won: a perfect parry, the hero mashes
  const won = lanternPlay(G, { answer: 'perfect', mash: 4 });
  assert(won.lock && won.d.pushes === 1 && won.d.pushWon === 1 && won.lost === 0, `a perfect parry: THE PUSH (a lock at range); mashing wins it (${won.d.pushWon} won, ${won.lost} HP lost)`);
  assert(won.d.lanternReturns === 1 && won.dealt >= LA.returnDamage - 1 && (G.counts['dragon:returned'] ?? 0) >= 1, `won: it flies back into him: ${won.dealt.toFixed(0)} damage (${LA.returnDamage}), dragon:returned`);
  assert(won.reel > LA.reel - 0.3 || d.broken || won.states.size === 0, `... and he reels ${won.reel.toFixed(2)} s (${LA.reel})`);
  const won7 = lanternPlay(G, { answer: 'perfect', mash: 9 });
  assert(won7.d.pushWon === 1, `a person's pace (a press every 9 frames) wins it too (${won7.d.pushWon} won)`);
  // 6. THE PUSH lost: no mash
  const lost = lanternPlay(G, { answer: 'perfect', mash: 0 });
  const big = lost.hits.find((h) => h.r === RESULT.HIT && Math.abs(h.damage - LA.lose.damage * scale) < 1e-6);
  assert(lost.lock && lost.d.pushLost === 1 && !!big && lost.states.has('knockdown') && lost.moved > LA.lose.knockback * 0.6, `not pushed, the push is lost: ${big?.damage?.toFixed(1)} damage, knockdown, thrown ${lost.moved.toFixed(1)} m`);
  const L = TUNING.lock, K = LA.push, need = (o) => (1 - o.start + o.decay * o.dur) / o.push / o.dur;
  out(`     the mash: the push needs ${need(K).toFixed(1)} presses a second to win outright in ${K.dur} s; the duel's lock (form 3) ${need({ ...L, decay: L.decay[2] }).toFixed(1)}`);
  assert(need(K) <= need({ ...L, decay: L.decay[2] }) + 1e-6, 'the push is no harder to win than the duel\'s lock');
  // 7. resets in the middle: the gather, the flight, the push
  for (const [what, at] of [['gather', (L2, D2) => L2.phase === 'gather' && D2.brain.act?.t > 0.9], ['flight', (L2) => L2.phase === 'fly'], ['push', (L2) => L2.phase === 'push']]) {
    const G2 = build();
    duel(G2, { dist: 9, form: 2 });
    const d2 = G2.game.dragon, sh2 = d2.ki.shots;
    let hit = false;
    lanternPlay(G2, { answer: what === 'push' ? 'perfect' : 'none', max: 6, step: () => { if (!hit && at(sh2.lantern, d2)) { hit = true; d2.reset(); } } });
    run(G2, 0.5);
    assert(hit && !sh2.lantern.on && !sh2.busy && !d2.fx.shots.some((s) => s.alive && s.lantern) && G2.game.player.state !== 'lock', `a reset in the ${what}: nothing of the orb is left (${hit ? 'reset' : 'never reached'})`);
  }
  assert(!G.payload.size, `no non-finite payloads (${[...G.payload].join(', ')})`);
}

async function scenarioSuns() {
  out('\n== scenario SUNS (Raining Suns: sixteen from the air, falling, each cued; the finisher; blocked, nothing lands) ==');
  const BA = TUNING.shots.barrage;
  // 1. stood in (god): he leaps, pours them down; each that reaches him cued itself; they fall to him
  const G = shotStage(2, 9);
  const d = G.game.dragon, p = G.game.player, sh = d.ki.shots;
  p.debug.god = true;
  const s0 = { ...sh.stats };
  let flashes = 0, top = 0, yHigh = 0;
  const near = [];
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'rainingSuns') flashes++; };
  const r = shotCast(G, 'rainingSuns', { secs: 9, step: () => {
    top = Math.max(top, d.position.y);
    for (const s of d.fx.shots) {
      if (!s.alive || s.kind !== 'blast' || s.attack !== 'rainingSuns' || s.returned) continue;
      yHigh = Math.max(yHigh, s.y);
      if (Math.hypot(s.x - p.position.x, s.z - p.position.z) < 1.2) near.push(s.y);
    }
  } });
  G.watch = null;
  const thrown = sh.stats.suns - s0.suns, skipped = sh.stats.sunsSkips - s0.sunsSkips, h = hitBy(r, 'rainingSuns');
  assert(r.ok && top >= BA.lift - 0.2 && thrown + skipped === BA.count && thrown >= BA.count - 3, `Raining Suns: he leaps to ${top.toFixed(1)} m; ${thrown} thrown, ${skipped} held back by the fairness guard (of ${BA.count})`);
  const onHim = Math.ceil(BA.count / Math.max(1, BA.direct ?? 1)) + 1;
  assert(h.length >= onHim - 2 && h.length === flashes, `each blast that reaches him (every ${BA.direct ?? 1}th, and the finisher) cued itself: ${h.length} contacts, ${flashes} cues`);
  const yn = near.length ? near.reduce((a, v) => a + v, 0) / near.length : 0;
  assert(yHigh > BA.lift && near.length > 0 && yn > 0.6 && yn < 1.7, `they fall from his palms (${yHigh.toFixed(1)} m up) to the hero (${yn.toFixed(2)} m at him)`);
  assert(r.secs < 7 && Math.abs(d.position.y) < 1e-6, `over in ${r.secs.toFixed(1)} s, and he is back on the floor`);
  // 2. blocked through: nothing lands
  const G2 = shotStage(2, 9);
  const p2 = G2.game.player, hp0 = p2.hp;
  const r2 = shotCast(G2, 'rainingSuns', { secs: 9, step: () => G2.input.press(1) });
  G2.input.up(1);
  const h2 = hitBy(r2, 'rainingSuns');
  assert(h2.length >= 5 && !h2.some((x) => x.r === RESULT.HIT) && p2.hp === hp0, `a held guard takes them all (${h2.filter((x) => x.r === RESULT.BLOCKED).length} blocked, ${p2.hp === hp0 ? 'no' : hp0 - p2.hp} HP lost)`);
  // 3. parried at each cue, the finisher perfectly: it flies back into him
  const G3 = shotStage(2, 9);
  G3.game.player.debug.god = true;
  G3.defend = makeDefender(G3, { early: 0.05 });
  const d3 = G3.game.dragon, ret0 = G3.counts['dragon:returned'] ?? 0, dh0 = d3.hp;
  const r3 = shotCast(G3, 'rainingSuns', { secs: 9, step: () => G3.defend.act() });
  const h3 = hitBy(r3, 'rainingSuns');
  assert(!h3.some((x) => x.r === RESULT.HIT) && (G3.counts['dragon:returned'] ?? 0) > ret0 && d3.hp < dh0, `parried at each cue: none lands (${h3.filter((x) => x.r === RESULT.PARRIED).length} parried); the finisher perfectly parried flies back into him (${(dh0 - d3.hp).toFixed(0)} damage)`);
  // 4. a reset in the middle of the pour: nothing left in the air, he is on the floor
  const G4 = shotStage(2, 9);
  const d4 = G4.game.dragon;
  d4.debug.trigger('rainingSuns');
  run(G4, 1.6);
  const was = d4.ki.shots.rain.on;
  d4.reset();
  run(G4, 0.3);
  assert(was && !d4.ki.shots.rain.on && !d4.ki.shots.busy && d4.position.y === 0, 'a reset in the middle of the pour: nothing of it left, he is on the floor');
  assert(!G.payload.size && !G3.payload.size, 'no non-finite payloads');
}
//
// --- beams
/** One beam move from a set-up: him at (0, -2) facing +z, the hero `dist` m ahead at angle `ang`;
 *  `step(info)` runs every frame (info.flashT: the time of his cue, or null). Returns what happened. */
function beamPlay(G, name, { dist = 10, ang = 0, form = 1, step = null, max = 9, god = false } = {}) {
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  settle(G);
  if (d.phase !== form) { d.debug.setForm(form); run(G, 0.4); }
  input.axis = { x: 0, y: 0 };
  input.up(1);
  input.release('ShiftLeft');
  d.position.set(0, 0, -2);
  d.yaw = 0;
  place(G, dist, ang);
  run(G, 0.2);
  p.guard = p.maxGuard;
  p.debug.god = god;
  p.hp = p.maxHp;
  const info = { flashT: null, flashes: [], hits: [], hp0: p.hp, guard0: p.guard, start: { x: p.position.x, z: p.position.z }, minGuard: p.guard, states: new Set(), beamOn: 0 };
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon') { info.flashes.push({ t: game.time, tell: e.tell, x: e.x, y: e.y, z: e.z, attack: e.attack }); if (info.flashT === null) info.flashT = game.time; } };
  const h0 = G.hits.length;
  info.started = d.debug.trigger(name);
  run(G, max, () => {
    game.mouseGround.set(d.position.x, 0, d.position.z);
    step?.(info);
    info.minGuard = Math.min(info.minGuard, p.guard);
    info.states.add(p.state);
    if (d.ki.beams.busy) info.beamOn++;
  }, () => info.flashT !== null && quiet(d) && game.hitstopTimer <= 0 && !['roll', 'knockdown'].includes(p.state));
  G.watch = null;
  input.axis = { x: 0, y: 0 };
  input.up(1);
  input.release('ShiftLeft');
  info.hits = G.hits.slice(h0).filter((h) => h.attack === name);
  info.lost = info.hp0 - p.hp;
  info.end = { x: p.position.x, z: p.position.z };
  info.moved = Math.hypot(info.end.x - info.start.x, info.end.z - info.start.z);
  p.debug.god = false;
  return info;
}

async function scenarioBeams() {
  out('\n== scenario BEAMS (Rising Tide, the sweep, Twin Tide, the great beam: the cue, the first contact, the ticks, every answer) ==');
  const { BEAM_TUNING: BT } = await imp('src/entities/enemies/ascendant/tuningBeam.js');
  const G = build();
  duel(G, { dist: 10 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  const lead = TUNING.flashLead, scale = TUNING.damageScale ?? 1;
  // 1. Rising Tide on a hero who stands: one red cue at the palm, the first contact flashLead later,
  // knocked down and thrown along the line, no tick on him while he is down
  const st = beamPlay(G, 'risingTide', { dist: 10 });
  const f0 = st.flashes[0], c0 = st.hits.find((h) => h.r !== RESULT.IGNORED);
  const palmH = f0 ? f0.y : 0;
  assert(st.started && st.flashes.length === 1 && f0.tell === TELL.RED && palmH > 0.7 && palmH < 2, `Rising Tide: one red cue (${st.flashes.length}) at the palm (${palmH.toFixed(2)} m up)`);
  assert(c0 && c0.r === RESULT.HIT && Math.abs(c0.t - st.flashT - lead) < 0.09 && Math.abs(c0.damage - BT.rising.first.damage * scale) < 1e-6, `the first contact lands ${c0 ? ((c0.t - st.flashT) * 1000).toFixed(0) : '-'} ms after the cue (flashLead ${lead * 1000}), ${c0?.damage} damage`);
  assert(st.states.has('knockdown') && st.moved > BT.rising.first.knockback * 0.7 && st.hits.filter((h) => h.r === RESULT.HIT).length === 1, `knocked down and thrown ${st.moved.toFixed(1)} m along it; no tick on him while down (${st.hits.length} contacts)`);
  assert(st.beamOn * DT > BT.rising.lit - 0.1 && st.beamOn * DT < BT.rising.lit + 0.6, `lit ${(st.beamOn * DT).toFixed(2)} s (${BT.rising.lit} s, then it fades)`);
  // 2. stepping into the lit beam: ticks, a stream (no stagger)
  let into = false;
  const tk = beamPlay(G, 'risingTide', { dist: 10, step: (I) => {
    const B = d.ki.beams.B;
    if (I.flashT !== null && !I.aside) { I.aside = true; p.debug.teleport(p.position.x + 4, p.position.z); }
    if (!into && B.phase === 'lit' && B.t > BT.active + 0.02) { into = true; p.debug.teleport(B.ox + B.dx * 7, B.oz + B.dz * 7); }
  } });
  const parts = tk.hits.filter((h) => h.r === RESULT.HIT), dealt = parts.reduce((a, h) => a + h.damage, 0);
  const nTicks = dealt / (BT.rising.tick * scale);
  // (the tuning pass's cap: after BT.maxTicks ticks the hero is thrown clear, knocked down; before it, a
  // stream: each tick in parts under the stagger floor, no stagger)
  const capped = Math.round(nTicks) >= (BT.maxTicks ?? 99);
  const streamParts = capped ? parts.slice(0, -1) : parts;
  assert(nTicks >= 2 && nTicks <= (BT.maxTicks ?? 99) && Math.abs(nTicks - Math.round(nTicks)) < 1e-6 && streamParts.every((h) => h.damage < 5) && !tk.states.has('stagger') && capped === tk.states.has('knockdown'), `stepping into it once lit: ${nTicks.toFixed(0)} ticks of ${BT.rising.tick} (each in parts under the stagger floor, no stagger${capped ? `; the ${BT.maxTicks}rd throws him clear, knocked down` : ''}) (${[...tk.states].join(' ')})`);
  // 3. the answers from the cue: off the line at each distance (run, sprint, a roll), against the strip
  out(`     leaving the line from the cue (strip ${BT.rising.w} m + the hero's ${(p.radius * 2).toFixed(1)} m; the line fixed at ${BT.rising.fix} of the ${BT.rising.windup} s windup, the cue at ${((BT.rising.windup - lead) / BT.rising.windup).toFixed(2)}):`);
  const table = {};
  for (const dist of [6, 10, 14]) {
    for (const how of ['stand', 'run', 'sprint', 'roll']) {
      const r = beamPlay(G, 'risingTide', { dist, step: (I) => {
        if (I.flashT === null || how === 'stand') return;
        input.axis = { x: 1, y: 0 };
        if (how === 'sprint') input.hold('ShiftLeft');
        if (how === 'roll' && !I.rolled) { I.rolled = true; input.tap('Space'); }
      } });
      const fc = r.hits[0];
      table[`${how}${dist}`] = fc ? fc.r : 'clear';
    }
    out(`       ${String(dist).padStart(2)} m: ${['stand', 'run', 'sprint', 'roll'].map((h) => `${h} ${table[`${h}${dist}`]}`).join(' · ')}`);
  }
  assert([6, 10, 14].every((m) => table[`stand${m}`] === RESULT.HIT && table[`sprint${m}`] === 'clear' && [RESULT.PERFECT, RESULT.DODGED, 'clear'].includes(table[`roll${m}`])), 'standing it lands at 6 / 10 / 14 m; a sprint off the line from the cue clears it, a roll at the cue goes through it');
  // 4. a held guard: guard drains, no health, slid along the line; it cannot be parried
  const bl = beamPlay(G, 'risingTide', { dist: 9, step: () => input.press(1) });
  const blHits = bl.hits.filter((h) => h.r !== RESULT.IGNORED);
  assert(blHits[0]?.r === RESULT.BLOCKED && bl.lost === 0 && bl.guard0 - bl.minGuard > BT.rising.first.damage && d.ki.beams.stats.blocked > 0, `a held guard: blocked (${blHits[0]?.r}), ${bl.lost} HP lost, guard ${bl.guard0} → ${Math.round(bl.minGuard)} (ticks drain it too)`);
  assert(bl.moved > 0.9, `... and slid ${bl.moved.toFixed(2)} m along the beam`);
  const pr = beamPlay(G, 'risingTide', { dist: 9, step: (I) => { if (I.flashT !== null && !I.pp && game.time >= I.flashT + lead - 0.1) { I.pp = true; input.click(1); } } });
  assert(!pr.hits.some((h) => h.r === RESULT.PARRIED), `it cannot be parried (${pr.hits.map((h) => h.r).join(' ')})`);
  // 5. the sweep (form 2): dragged toward the hero's side; outrun at a sprint from 8 m, rolled through
  const SW = BT.sweep, sprint = 7.2;
  out(`     the sweep's edge at ${SW.turn} deg/s: ${[8, 12, 16].map((m) => `${m} m ${(SW.turn * Math.PI / 180 * m).toFixed(1)} m/s`).join(' · ')} (the hero sprints ${sprint})`);
  let swept = 0;
  const sw0 = beamPlay(G, 'tideSweep', { dist: 8, form: 2, step: () => { const B = d.ki.beams.B; if (B.phase === 'lit') swept = Math.max(swept, Math.abs(B.swept)); } });
  assert(sw0.flashes.length === 1 && sw0.hits[0]?.r === RESULT.HIT && swept * 180 / Math.PI > SW.arc - 3 && swept * 180 / Math.PI <= SW.arc + 1e-6, `Rising Tide, sweeping: one cue; standing, the first contact; it turns ${(swept * 180 / Math.PI).toFixed(1)} deg (${SW.arc} at most)`);
  // (a sprint from a standstill AT the cue does not clear its 2 m in flashLead: the cue's answer is the
  // roll; a hero already sprinting round him as it starts is off the fixed line and outruns the sweep)
  const cue8 = beamPlay(G, 'tideSweep', { dist: 8, form: 2, step: (I) => { if (I.flashT === null) return; input.axis = { x: 1, y: 0 }; input.hold('ShiftLeft'); } });
  out(`       a sprint from a standstill at the cue, 8 m: ${cue8.hits.map((h) => `${h.r} @${((h.t - cue8.flashT) * 1000).toFixed(0)}ms`).join(' ') || 'untouched'}`);
  const run8 = beamPlay(G, 'tideSweep', { dist: 8, form: 2, step: () => {
    const ox = p.position.x - d.position.x, oz = p.position.z - d.position.z, l = Math.hypot(ox, oz) || 1;
    input.axis = { x: oz / l, y: ox / l }; // (round him: the way (oz, -ox) on the floor)
    input.hold('ShiftLeft');
  } });
  assert(!run8.hits.some((h) => h.r === RESULT.HIT), `from 8 m a hero sprinting round him outruns the sweep (${run8.hits.map((h) => `${h.r} ${h.damage.toFixed(1)} @${((h.t - run8.flashT) * 1000).toFixed(0)}ms`).join(' ') || 'untouched'}; moved ${run8.moved.toFixed(1)} m)`);
  const thr = beamPlay(G, 'tideSweep', { dist: 8, form: 2, step: (I) => {
    const B = d.ki.beams.B;
    // (a positive sweep turns his facing toward r = (dz, -dx): the hero stands 3.2 m that way, 8 m out;
    // as its edge comes within his reach he rolls back through it, against the sweep)
    if (I.flashT !== null && !I.aside) { I.aside = true; const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw); p.debug.teleport(d.position.x + fx * 8 + fz * 3.2, d.position.z + fz * 8 - fx * 3.2); }
    if (I.aside && !I.rolled && B.phase === 'lit') {
      const ox = p.position.x - B.ox, oz = p.position.z - B.oz, across = Math.abs(-ox * B.dz + oz * B.dx);
      if (across < SW.w / 2 + 1.3) { I.rolled = true; input.axis = { x: -B.dz * B.sign, y: -B.dx * B.sign }; input.tap('Space'); }
    }
  } });
  out(`       roll through: ${thr.hits.map((h) => `${h.r} @${((h.t - thr.flashT) * 1000).toFixed(0)}ms`).join(' ')}`);
  assert(thr.hits.length > 0 && !thr.hits.some((h) => h.r === RESULT.HIT), `standing aside as it comes, a roll through it (${thr.hits.map((h) => h.r).join(' ') || 'untouched'})`);
  assert(!G.payload.size, `no non-finite payloads (${[...G.payload].join(', ')})`);
  // 6. Twin Tide (form 3): two cues, the second palm leads a running hero
  const tw = beamPlay(G, 'twinTide', { dist: 9, form: 3, step: () => { input.axis = { x: 1, y: 0 }; } });
  const twParts = tw.flashes.map((f) => f.tell);
  assert(tw.flashes.length === 2 && twParts.every((t) => t === TELL.RED) && tw.flashes[1].t - tw.flashes[0].t > BT.twin.lit, `Twin Tide: two red cues ${((tw.flashes[1]?.t - tw.flashes[0]?.t) || 0).toFixed(2)} s apart, the second after the first is out`);
  assert(d.ki.beams.stats.beams >= 9, `every beam lit (${d.ki.beams.stats.beams} so far)`);
}

/** The great beam from a set-up in form 3 (him at (0, -2) facing the hero `dist` m north... south). */
function greatPlay(G, { dist = 6, parry = null, mash = 0, block = false, max = 12 } = {}) {
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  const info = { lock: false, won: null, meterMax: 0, sep: 0, zoom: 0, clashT: 0, dims: 0, hpLock: 0, reel: 0 };
  const amb = game.world.forest.ambience, dim0 = amb.dim;
  amb.dim = (k) => { info.dims++; info.dimMax = Math.max(info.dimMax ?? 0, k); return dim0?.call(amb, k); };
  const r = beamPlay(G, 'heavenTide', { dist, form: 3, max, step: (I) => {
    if (block) input.press(1);
    if (d.mode === 'react' && d.brain.react?.kind === 'reeling') info.reel += DT;
    if (parry && I.flashT !== null && !I.pp && game.time >= I.flashT + TUNING.flashLead - parry) { I.pp = true; input.up(1); input.click(1); I.g0 = p.guard; I.h0 = p.hp; }
    if (I.pp && info.headHp === undefined && game.time >= I.flashT + TUNING.flashLead + 0.05) { info.headHp = I.h0 - p.hp; info.headGuard = I.g0 - p.guard; }
    if (p.state === 'lock') {
      if (!info.lock) { info.lock = true; info.sep = Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z); info.hpLock = p.hp; }
      info.zoom = Math.max(info.zoom, game.cameraRig.cine?.zoom ?? 0);
      info.clashT += DT;
      info.meterMax = Math.max(info.meterMax, p.bladeLock?.meter ?? 0);
      if (mash && ((game.realTime * 60) | 0) % mash === 0) input.click(0);
    }
  } });
  game.world.forest.ambience.dim = dim0;
  return { ...r, ...info };
}

async function scenarioClash() {
  out('\n== scenario CLASH (Heaven-Splitting Tide: the vanish, the charge, the head, THE CLASH won and lost, never mandatory) ==');
  const { BEAM_TUNING: BT } = await imp('src/entities/enemies/ascendant/tuningBeam.js');
  const G = build();
  duel(G, { dist: 6, form: 3 });
  const { game } = G;
  const d = game.dragon, p = game.player, K = BT.clash, GB = BT.great, scale = TUNING.damageScale ?? 1;
  const watch = [];
  // 1. stood in: the vanish to the far edge, the charge (the light dimmed), one blue flare, the head lands
  const st = greatPlay(G, { dist: 6 });
  const from0 = Math.hypot(d.position.x, d.position.z);
  const fh = st.flashes[0], hd = st.hits.find((h) => h.r !== RESULT.IGNORED);
  assert(st.flashes.length === 1 && fh.tell === TELL.BLUE && st.dims > 60 && st.dimMax > GB.dim * 0.9, `the great beam: one blue cue; the charge held the light down ${st.dims} frames (to ${st.dimMax?.toFixed(2)})`);
  assert(hd?.r === RESULT.HIT && Math.abs(hd.damage - GB.first.damage * scale) < 1e-6 && st.states.has('knockdown') && Math.abs(hd.t - st.flashT - TUNING.flashLead) < 0.09, `its head lands ${((hd?.t - st.flashT) * 1000).toFixed(0)} ms after the cue: ${hd?.damage?.toFixed(1)}, knockdown`);
  void from0;
  // the vanish: he was at the ring's edge farthest from the hero when it fired
  let edge = 0, across = 0;
  const ed = beamPlay(G, 'heavenTide', { dist: 4, form: 3, step: (I) => { if (I.flashT !== null && !edge) { edge = Math.hypot(d.position.x, d.position.z); across = d.position.x * p.position.x + d.position.z * p.position.z; } } });
  assert(edge > 10 && across < 0 && ed.flashes.length === 1, `he vanished to the ring's far edge first (${edge.toFixed(1)} m from the middle, the hero on the other side)`);
  // 2. a plain parry of the head: held as a block (guard paid, no health)
  // (then held as a guard: the ticks pay guard too, until it gives)
  const pl = greatPlay(G, { dist: 6, parry: PLAIN_LEAD + DT, block: false }); // (this helper's press lands a step later than a `left <= lead` check)
  const plHead = pl.hits.find((h) => h.r !== RESULT.IGNORED);
  assert(plHead?.r === RESULT.PARRIED && !pl.lock && pl.headHp === 0 && pl.headGuard > 0, `a plain parry of the head (${plHead?.r}): no clash, the head cost ${pl.headGuard?.toFixed(0)} guard and ${pl.headHp} HP`);
  // 3. THE CLASH won: a perfect parry, the hero mashes
  const won = greatPlay(G, { dist: 6, parry: 0.04, mash: 4 });
  const ws = d.ki.beams.stats;
  assert(won.lock && won.sep > 12 && Math.abs(won.sep - Math.hypot(won.start.x - d.position.x, won.start.z - d.position.z)) < 30, `a perfect parry of the head: THE CLASH at range (${won.sep.toFixed(1)} m apart)`);
  assert(won.zoom > 2, `the camera drawn back to frame both (cinematic zoom +${won.zoom.toFixed(1)} m)`);
  assert(ws.won >= 1 && won.lost === 0, `mashing (a press every 4 frames) wins it (${ws.won} won; ${won.lost} HP lost)`);
  const won7 = greatPlay(G, { dist: 6, parry: 0.04, mash: 9 });
  assert(won7.lock && d.ki.beams.stats.won >= 2, `a person's pace (a press every 9 frames, 6.7 a second) wins it too (${won7.clashT.toFixed(2)} s, the meter to ${won7.meterMax.toFixed(2)})`);
  // he reels: a long opening
  void watch;
  out(`     won: the meter peaked at ${won.meterMax.toFixed(2)} in ${won.clashT.toFixed(2)} s; he reeled ${won.reel.toFixed(2)} s`);
  assert(won.reel > K.reel - 0.3, `... and he reels ${won.reel.toFixed(2)} s: a long opening (the hero has ${won.sep.toFixed(0)} m to cross at 7.2 m/s: ${(won.sep / 7.2).toFixed(1)} s)`);
  // 4. THE CLASH lost: no mash
  const lost = greatPlay(G, { dist: 6, parry: 0.04, mash: 0 });
  const lh = lost.hits.filter((h) => h.r === RESULT.HIT);
  const big = lh.find((h) => Math.abs(h.damage - K.lose.damage * scale) < 1e-6);
  assert(lost.lock && d.ki.beams.stats.lost >= 1 && !!big && lost.states.has('knockdown') && lost.moved > K.lose.knockback * 0.6, `not answered, the clash is lost: ${big?.damage?.toFixed(1)} damage, knocked down, thrown ${lost.moved.toFixed(1)} m along the beam`);
  // 5. the mash numbers against the duel's lock
  const L = TUNING.lock, need = (o) => (1 - o.start + o.decay * o.dur) / o.push / o.dur;
  out(`     the mash: the clash needs ${need(K).toFixed(1)} presses a second to win outright in ${K.dur} s (to hold ${K.hold}: ${((K.hold - K.start + K.decay * K.dur) / K.push / K.dur).toFixed(1)}); the duel's lock (form 3) ${need({ ...L, decay: L.decay[2] }).toFixed(1)} (${((L.hold - L.start + L.decay[2] * L.dur) / L.push / L.dur).toFixed(1)})`);
  assert(need(K) <= need({ ...L, decay: L.decay[2] }) + 1e-6, 'the clash is no harder to win than the duel\'s lock');
  // 6. never mandatory: off the line before it fires (a sprint round him once the thread shows), then a
  // roll back through its edge as the sweep comes (sprinting on with it, the sweep runs him down)
  const offPlay = (roll) => beamPlay(G, 'heavenTide', { dist: 9, form: 3, max: 12, step: (I) => {
    const ox = p.position.x - d.position.x, oz = p.position.z - d.position.z, l = Math.hypot(ox, oz) || 1;
    if (I.rolled) { G.input.release('ShiftLeft'); return; }
    G.input.axis = { x: oz / l, y: ox / l };
    G.input.hold('ShiftLeft');
    // (the roll: 0.1 s before the head would land, toward the line and through it, against the sweep
    // that will be dragged his way)
    if (roll && I.flashT !== null && game.time >= I.flashT + TUNING.flashLead - 0.1) {
      const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), qx = p.position.x - d.position.x, qz = p.position.z - d.position.z;
      const sd = Math.sign(-qx * fz + qz * fx) || 1, wx = -sd * -fz, wz = -sd * fx;
      I.rolled = true;
      G.input.axis = { x: wx, y: -wz };
      G.input.tap('Space');
    }
  } });
  const off = offPlay(true), offRun = offPlay(false);
  const hp = (r) => r.hits.filter((h) => h.r === RESULT.HIT).reduce((a, h) => a + h.damage, 0);
  out(`     off the line, then rolled back through its edge: ${hp(off).toFixed(0)} HP (${off.hits.map((h) => h.r).join(' ') || 'untouched'}); sprinting on with the sweep instead: ${hp(offRun).toFixed(0)} HP`);
  assert(!off.hits.some((h) => h.r === RESULT.HIT) && !offRun.hits.some((h) => h.damage > GB.tick * scale), 'off the line the head never lands; rolled back through, the sweep never touches him');
  // (the tuning pass: one beam takes at most BT.maxTicks ticks from a hero who is not blocking; before
  // the cap sprinting on with the sweep cost 119 HP)
  assert(hp(offRun) <= (BT.maxTicks ?? 99) * GB.tick * scale + 1e-6, `sprinting on with the sweep costs at most ${BT.maxTicks} ticks: ${hp(offRun).toFixed(0)} HP (<= ${((BT.maxTicks ?? 99) * GB.tick * scale).toFixed(0)}), then he is thrown clear`);
  assert(!G.payload.size, `no non-finite payloads (${[...G.payload].join(', ')})`);
}

async function scenarioBeamWorld() {
  out('\n== scenario BEAMWORLD (what a beam does to the real set: a butte top, the trench in the tiles, the great beam reach) ==');
  const G = build(SEED, true);
  duel(G, { dist: 6 });
  const { game } = G;
  const d = game.dragon, p = game.player, W = game.world.destructibles;
  const tops = W.list.filter((o) => o.def?.kind === 'butteTop');
  const gone = () => tops.filter((o) => o.state !== tops[0].def.__intact && o.state !== 0).length;
  const intact0 = tops.map((o) => o.state);
  const floorBad = () => W.list.filter((o) => o.floor && (o.cracked || o.state !== intact0[0])).length;
  const tileWorn = () => W.list.filter((o) => o.floor && (o.cracked || o.hp < o.hpMax)).length;
  void gone;
  assert(tops.length >= 4, `the set's butte tops: ${tops.length}`);
  // Rising Tide from 13 m west of the first butte, at it (the drawn beam ends on it)
  const B0 = RING.buttes[0], top0 = tops.reduce((a, o) => (Math.hypot(o.x - B0.x, o.z - B0.z) < Math.hypot(a.x - B0.x, a.z - B0.z) ? o : a));
  const s0 = top0.state, t0 = tileWorn();
  const ux = 1, uz = 0;
  const fire = (name, bx, bz, hx, hz, form) => {
    settle(G);
    if (d.phase !== form) { d.debug.setForm(form); run(G, 0.4); }
    d.position.set(bx, 0, bz);
    d.yaw = Math.atan2(hx - bx, hz - bz);
    p.debug.teleport(hx, hz);
    p.debug.god = true;
    run(G, 0.2);
    let len = 0, top = false;
    d.debug.trigger(name);
    run(G, 9, () => { const B = d.ki.beams.B; if (B.phase === 'lit') { len = Math.max(len, B.len); top ||= B.top; } }, () => quiet(d) && G.game.hitstopTimer <= 0);
    return { len, top };
  };
  const r1 = fire('risingTide', B0.x - 13 * ux, B0.z - 13 * uz, B0.x - 7, B0.z, 1);
  assert(r1.top && r1.len < 13 && top0.state !== s0, `Rising Tide at a butte 13 m off: the drawn beam ends on it (${r1.len.toFixed(1)} m) and its top comes off (state ${s0} → ${top0.state})`);
  assert(tileWorn() > t0 + 3, `a trench: ${tileWorn() - t0} floor tiles cracked or worn under it`);
  // the great beam from the ring's far edge: its line carries on to a butte past its 26 m
  const B1 = RING.buttes.reduce((a, b) => (Math.hypot(b.x, b.z) > Math.hypot(a.x, a.z) ? b : a));
  const top1 = tops.reduce((a, o) => (Math.hypot(o.x - B1.x, o.z - B1.z) < Math.hypot(a.x - B1.x, a.z - B1.z) ? o : a));
  const l1 = Math.hypot(B1.x, B1.z), s1 = top1.state;
  const r2 = fire('heavenTide', 0, 0, (B1.x / l1) * 6, (B1.z / l1) * 6, 3);
  out(`     the great beam toward a butte ${l1.toFixed(1)} m from the middle: drawn ${r2.len.toFixed(1)} m (to it: ${r2.top}); its top ${s1} → ${top1.state}`);
  assert(r2.top && r2.len > 26 && top1.state !== s1, 'the great beam reaches a butte past its 26 m and takes the top off');
  void floorBad;
}




/**
 * INSTANT (the fourth wave): Instant Wave. The sign (two fingers to the brow), gone, BESIDE the hero ~4 m
 * off to a side (never behind), both hands cupped at the hip with the light between the palms, one red
 * cue >= 0.8 s after the arrival; standing it lands, a roll at the cue goes through it, a held guard pays
 * no health. And the cupped-hands option (`?ascBeamPose=cup`) gives every beam the cup.
 */
async function scenarioInstant() {
  out('\n== scenario INSTANT (Instant Wave: the sign, beside the hero, the cupped hands, a fair red cue; ?ascBeamPose=cup) ==');
  const { BEAM_TUNING: BT } = await imp('src/entities/enemies/ascendant/tuningBeam.js');
  const IN = BT.instant, lead = TUNING.flashLead;
  const G = build();
  duel(G, { dist: 9, form: 3 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  /** One Instant Wave on a hero `dist` m off; `answer(info)` every frame. Samples the body through it. */
  const play = (dist = 9, answer = null, god = false) => {
    let snapT = null;
    const sg = d.fx.signSnap;
    const S = { snapT: null, arrive: null, x0: null, cupGap: 9, cupY: -9, chestY: 0, thrustFwd: -9, browMin: 9, bearing: null, sep: null, charge: 0, chargeBefore: 0 };
    const bc = d.fx.beamCharge, cc = d.fx.cupCharge;
    d.fx.beamCharge = (...a) => { if (snapT === null) S.chargeBefore++; return bc?.apply(d.fx, a); };
    d.fx.cupCharge = (...a) => { if (snapT === null) S.chargeBefore++; else S.charge++; return cc?.apply(d.fx, a); };
    d.fx.signSnap = (...a) => { snapT = game.time; return sg?.apply(d.fx, a); };
    const r = beamPlay(G, 'instantWave', { dist, form: 3, god, max: 8, step: (I) => {
      const a = d.brain.act;
      if (S.x0 === null) S.x0 = { x: d.position.x, z: d.position.z };
      if (a?.name === 'instantWave') {
        const b = a.beats[0], u = (a.t - b.start) / (b.impact - b.start);
        if (u > 0.2 && u < IN.signAt - 0.02) {
          const h = d.tellPoint('fistR', v), hd = w.set(0, 0.16, 0.09).applyMatrix4(d.rig.head.matrixWorld);
          S.browMin = Math.min(S.browMin, Math.hypot(h.x - hd.x, h.y - hd.y, h.z - hd.z));
        }
        if (snapT !== null && S.arrive === null) {
          S.snapT = snapT;
          S.arrive = { t: game.time, x: d.position.x, z: d.position.z };
          S.sep = Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z);
          const ang = Math.atan2(d.position.x - p.position.x, d.position.z - p.position.z) - p.yaw;
          S.bearing = Math.atan2(Math.sin(ang), Math.cos(ang));
        }
        // the cup: both hands together, low (at the hip), between the arrival and the cock
        if (u > IN.signAt + 0.25 && u < 0.88) {
          const R = d.tellPoint('fistR', v), L = d.tellPoint('fistL', w), H = d._hs;
          S.n = (S.n ?? 0) + 1;
          S.gapSum = (S.gapSum ?? 0) + Math.hypot(R.x - L.x, R.y - L.y, R.z - L.z);
          S.hipSum = (S.hipSum ?? 0) + (R.y + L.y) / 2 - H[2].y;
          S.headSum = (S.headSum ?? 0) + H[0].y - (R.y + L.y) / 2;
          S.cupGap = S.gapSum / S.n;
          S.cupY = S.hipSum / S.n;
          S.chestY = S.headSum / S.n;
        }
        // the thrust: both palms out ahead of him along his facing
        if (u > 1.05 && u < 1.6) {
          const M = d.tellPoint('palms', v), fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
          S.thrustFwd = Math.max(S.thrustFwd, (M.x - d.position.x) * fx + (M.z - d.position.z) * fz);
        }
      }
      answer?.(I, S);
    } });
    d.fx.signSnap = sg;
    d.fx.beamCharge = bc;
    d.fx.cupCharge = cc;
    return { ...r, S };
  };
  const tFmt = (t) => (t === null || t === undefined ? '-' : `${(t * 1000).toFixed(0)} ms`);
  // 1. standing: the sign, gone, beside him; one red cue at the cupped palms, >= 0.8 s after the arrival
  const st = play(9);
  const S = st.S, f0 = st.flashes[0], c0 = st.hits.find((h) => h.r !== RESULT.IGNORED);
  assert(st.started && S.arrive && S.browMin < 0.2 && S.chargeBefore === 0 && S.charge > 20, `Instant Wave: the sign (the hand ${S.browMin.toFixed(2)} m off his brow), gone at the snap; no light gathers before he arrives, then the cupped hands' charge (${S.chargeBefore} / ${S.charge} frames)`);
  assert(S.sep > IN.r - 0.8 && S.sep < IN.r + 0.8 && Math.abs(S.bearing) > 0.6 && Math.abs(S.bearing) < 2.0, `he arrives ${S.sep?.toFixed(2)} m from the hero, at his side (${S.bearing?.toFixed(2)} rad off his facing: not before, not behind)`);
  assert(st.flashes.length === 1 && f0.tell === TELL.RED && f0.t - S.arrive.t >= 0.8 - lead - 1e-6, `one red cue (${st.flashes.length}), ${tFmt(f0?.t - S.arrive.t)} after the arrival`);
  assert(c0 && c0.r === RESULT.HIT && c0.t - S.arrive.t >= 0.8 - 1e-6 && Math.abs(c0.t - f0.t - lead) < 0.09 && st.states.has('knockdown'), `standing, it lands ${tFmt(c0?.t - S.arrive.t)} after he arrived (>= 800), ${tFmt(c0?.t - f0?.t)} after its cue; knocked down`);
  const palm = f0 ? Math.hypot(f0.x - S.arrive.x, f0.z - S.arrive.z) : 9;
  assert(S.cupGap < 0.22 && Math.abs(S.cupY) < 0.25 && S.chestY > 0.5 && S.thrustFwd > 0.35 && palm < 1.3, `the cupped hands: ${S.cupGap.toFixed(2)} m apart, ${S.cupY.toFixed(2)} m off his hip's height (${S.chestY.toFixed(2)} m under his head); thrust ${S.thrustFwd.toFixed(2)} m out; the cue between the palms (${palm.toFixed(2)} m off his root)`);
  // 2. a roll at the cue goes through it; a sprint off the line from the cue (reported)
  const rl = play(9, (I) => { if (I.flashT !== null && !I.rolled && game.time >= I.flashT + lead - 0.18) { I.rolled = true; input.tap('Space'); } });
  assert(!rl.hits.some((h) => h.r === RESULT.HIT), `a roll at the cue goes through it (${rl.hits.map((h) => h.r).join(' ') || 'untouched'})`);
  const off = play(9, (I) => {
    if (I.flashT === null) return;
    const B = d.ki.beams.B, fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
    // (away from the line he aims down, across it)
    const ox = p.position.x - d.position.x, oz = p.position.z - d.position.z, sd = Math.sign(-ox * fz + oz * fx) || 1;
    input.axis = { x: sd * -fz, y: -(sd * fx) };
    input.hold('ShiftLeft');
    void B;
  });
  out(`     a sprint off the line from the cue: ${off.hits.map((h) => `${h.r} @${tFmt(h.t - off.flashT)}`).join(' ') || 'clear'}`);
  // 3. a held guard: blocked, no health
  const bl = play(9, () => input.press(1));
  const blh = bl.hits.filter((h) => h.r !== RESULT.IGNORED);
  assert(blh[0]?.r === RESULT.BLOCKED && bl.lost === 0, `a held guard: ${blh[0]?.r}, ${bl.lost} HP lost`);
  // 4. both sides of the hero, never behind; from near and far in its band
  const sides = new Set(), bears = [];
  for (const [dist, seed] of [[4, 1], [7, 2], [12, 3], [9, 4], [6, 5], [10, 6]]) {
    Math.random = mulberry32(seed * 101);
    const r = play(dist, null, true);
    if (r.S.bearing !== null) { sides.add(Math.sign(r.S.bearing)); bears.push(r.S.bearing); }
  }
  assert(sides.size === 2 && bears.length === 6 && bears.every((b) => Math.abs(b) > 0.6 && Math.abs(b) < 2.0), `both of the hero's sides drawn, never behind or before him (${bears.map((b) => b.toFixed(2)).join(' ')})`);
  assert(!G.payload.size, `no non-finite payloads (${[...G.payload].join(', ')})`);
  // 5. the option: ?ascBeamPose=cup gives every beam the cupped hands (moves/kiBeam.js built under that
  // URL); with no parameter today's palm thrust (Instant Wave alone cupped)
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const { X } = await imp('src/entities/enemies/ascendant/moves.js');
  const beamsOf = (M) => Object.values(M).flatMap((m) => m.beats.flatMap((b) => (Array.isArray(b.pick) ? b.pick : [b]))).filter((b) => b.beam);
  const today = beamsOf(MOVES ? Object.fromEntries(Object.entries(MOVES).filter(([, m]) => m.ki?.startsWith?.('beam'))) : {});
  assert(today.length >= 6 && today.every((b) => !!b.beam.cup === (b.beam.kind === 'instant')), `no parameter: the beams as shipped (${today.filter((b) => b.beam.cup).length} cupped: Instant Wave's)`);
  LS.readLookUrl('?ascBeamPose=cup');
  try {
    const mod = await import(pathToFileURL(`${ROOT}/src/entities/enemies/ascendant/moves/kiBeam.js`).href + '?cup');
    const M = mod.beamMoves(X), cupped = beamsOf(M);
    const gap = (k) => Math.hypot(k.rH[0] - 0.178 - (k.lH[0] + 0.178), k.rH[1] - k.lH[1], k.rH[2] - k.lH[2]);
    const gathers = cupped.map((b) => b.keys.find(([u]) => u > 0.4 && u < 0.95)?.[1]).filter(Boolean);
    assert(mod.BEAM_POSE === 'cup' && cupped.length === today.length && cupped.every((b) => b.beam.cup && b.part === 'palms') && M.heavenTide.clashPose !== MOVES.heavenTide.clashPose, `?ascBeamPose=cup: all ${cupped.length} beam beats cupped (the charge, the cue and the beam at the palms), the clash pose cupped too`);
    assert(gathers.length === cupped.length && gathers.every((k) => gap(k) < 0.2), `... each gathered with the hands together (key gaps ${gathers.map((k) => gap(k).toFixed(2)).join(' ')} m)`);
    for (const n of ['risingTide', 'tideSweep', 'twinTide', 'heavenTide']) {
      const a = M[n].beats.map((b) => [b.windup, b.zone.r, b.zone.w, b.tell, b.damage].join()), o = MOVES[n].beats.map((b) => [b.windup, b.zone.r, b.zone.w, b.tell, b.damage].join());
      if (a.join('|') !== o.join('|')) assert(false, `${n}: the same timings, zones, tells and damage under the cup`);
    }
  } finally {
    LS.readLookUrl('');
  }
}

/** ORBC (the fourth wave): Heaven's Lantern under `?ascOrb=c` (the great gathered sphere): the same
 *  timings and answers as the shipped orb (the look is fx.js's, live; the arms' keys are build-time). */
async function scenarioOrbC() {
  out('\n== scenario ORBC (Heaven\'s Lantern as the great gathered sphere, ?ascOrb=c: same timings, same answers) ==');
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const LA = TUNING.shots.lantern;
  LS.setLook('ascOrb', 'c');
  try {
    const G = build();
    duel(G, { dist: 9, form: 2 });
    const d = G.game.dragon, fire = G.game.fx.fire;
    let peak = 0;
    const peakStep = () => { peak = Math.max(peak, fire.count ?? fire.alive ?? 0); };
    assert(d.fx.look('ascOrb') === 'c', `the orb drawn as option ${d.fx.look('ascOrb')}`);
    const st = lanternPlay(G, { step: peakStep });
    const c0 = st.hits.find((h) => h.r !== RESULT.IGNORED), f0 = st.flashes.filter((f) => f.attack === 'skyLantern');
    assert(f0.length === 1 && f0[0].tell === TELL.BLUE && c0?.r === RESULT.HIT && Math.abs(c0.t - f0[0].t - TUNING.flashLead) < 0.09 && st.top >= LA.lift - 0.2, `stood in: one blue cue on the sphere, it lands ${c0 ? ((c0.t - f0[0]?.t) * 1000).toFixed(0) : '-'} ms after (${c0?.r})`);
    const rl = lanternPlay(G, { answer: 'roll', step: peakStep });
    assert(!rl.hits.some((h) => h.r === RESULT.HIT) && rl.d.lanternPassed === 1, `a roll: it passes (${rl.hits.map((h) => h.r).join(' ') || 'no contact'})`);
    const bl = lanternPlay(G, { answer: 'block', step: peakStep });
    assert(bl.hits[0]?.r === RESULT.BLOCKED && bl.lost === 0, `a held guard: ${bl.hits[0]?.r}, ${bl.lost} HP lost`);
    const won = lanternPlay(G, { answer: 'perfect', mash: 4, step: peakStep });
    assert(won.lock && won.d.pushWon === 1 && won.d.lanternReturns === 1, `THE PUSH won: it flies back into him (${won.dealt.toFixed(0)} damage)`);
    const lost = lanternPlay(G, { answer: 'perfect', mash: 0, step: peakStep });
    assert(lost.lock && lost.d.pushLost === 1, 'THE PUSH lost: it bursts on the hero');
    out(`     the fire field's peak through these: ${peak} blobs (of 6000)`);
    assert(peak < 3000 && !G.payload.size, `the sphere within the field's budget (${peak}), no non-finite payloads`);
  } finally {
    LS.setLook('ascOrb', null);
  }
}
//
// --- strings
/**
 * MOTION (the strings agent): every builder kind measured on his real body, in each form's stance:
 * the coil (how far the striking limb's end is drawn back from where it strikes), its speed at the
 * impact, how far it reaches toward the hero standing at the zone's ideal distance, the chest's turn
 * from the coil to the impact, and in a string how far a planted foot slides on the floor.
 */
async function scenarioMotion() {
  out('\n== scenario MOTION (each strike on his real body: the coil, the speed at impact, the reach, the chest\'s turn; feet in a string) ==');
  const { X } = await imp('src/entities/enemies/ascendant/moves.js');
  const N = X.TELL.N;
  const KINDS = [
    ...['jab', 'cross', 'hook', 'uppercut', 'backfist', 'palm', 'double', 'hammer'].map((k) => [k, () => X.punch(k, N, 0.5, 10)]),
    ...['front', 'side', 'round', 'sweep', 'axe', 'flying', 'knee'].map((k) => [`kick:${k}`, () => X.kick(k, N, 0.55, 10)]),
    ['elbow', () => X.elbow(N, 0.5, 10)], ['shoulder', () => X.shoulder(N, 0.5, 10)],
  ];
  const G = build();
  duel(G, { dist: 3 });
  const { game } = G;
  const d = game.dragon, p = game.player, br = d.brain;
  p.debug.god = true;
  const yawOf = (o) => { const e = new THREE.Euler().setFromQuaternion(o.getWorldQuaternion(new THREE.Quaternion()), 'YXZ'); return e.y; };
  const rows = [];
  const v = new THREE.Vector3(), chest = new THREE.Vector3();
  for (const f of [1, 2, 3]) {
    for (const [name, mk] of KINDS) {
      settle(G, 2);
      if (d.phase !== f) d.debug.setForm(f);
      run(G, 0.3);
      const beat = { ...mk(), close: 0, dash: undefined, leap: undefined };
      const ideal = br._ideal(beat.zone);
      // (the hero EAST of him: the drawn figure leans toward the camera along z, so reach is measured along x)
      d.position.set(0, 0, 0);
      d.yaw = Math.PI / 2;
      p.debug.teleport(Math.max(0.9, ideal), 0);
      run(G, 0.2);
      d.position.set(0, 0, 0);
      d.yaw = Math.PI / 2;
      MOVES.__m = { label: 'motion', phase: 1, weight: 0, manual: true, hidden: true, cooldown: 0, band: [0, 99], recovery: 0.5, beats: [beat] };
      d.debug.trigger('__m');
      const A = br.act, b = A.beats[0];
      const cockT = b.start + (beat.cock ?? 0.7) * b.W;
      let hp0 = null, coil = null, hit = null, prev = null, speed = 0, yaw0 = 0, yaw1 = 0;
      for (let i = 0; i < 200 && br.act === A; i++) {
        const t = A.t;
        const tip = d._tip.clone();
        if (coil === null && t >= cockT) { coil = tip; yaw0 = yawOf(d.rig.chest); }
        if (prev && t > b.impact - 0.15 && t <= b.impact + 1e-6 && game.dt > 0.008) speed = Math.max(speed, tip.distanceTo(prev) / game.dt);
        if (hit === null && t >= b.impact) {
          hit = tip;
          hp0 = p.position.clone();
          yaw1 = yawOf(d.rig.chest);
        }
        prev = tip;
        G.tick(DT);
      }
      // (how far short of the hero's body the limb's end stops: along the line to him, from his root, less his radius)
      const drawn = coil && hit ? coil.distanceTo(hit) : 0;
      const reach = hit ? hp0.x - hit.x - (p.radius ?? 0.45) : 9;
      if (process.env.GCD_MDBG && f === 1) out(`      ${name} tip ${hit?.x.toFixed(2)},${hit?.y.toFixed(2)},${hit?.z.toFixed(2)} root ${d.position.x.toFixed(2)},${d.position.z.toFixed(2)} hero ${hp0?.x.toFixed(2)},${hp0?.z.toFixed(2)} yaw ${d.yaw.toFixed(2)}`);
      rows.push({ f, name, drawn, speed, reach, turn: Math.abs(wrapA(yaw1 - yaw0)), ideal });
    }
  }
  delete MOVES.__m;
  out('   form kind            coil m  speed m/s  short of him m  chest turn rad');
  for (const r of rows) out(`   ${r.f}    ${r.name.padEnd(15)} ${r.drawn.toFixed(2).padStart(6)} ${r.speed.toFixed(1).padStart(10)} ${r.reach.toFixed(2).padStart(12)} ${r.turn.toFixed(2).padStart(14)}`);
  // feet in a string: a planted foot (on the floor, not moving with a step) slides with the root
  const G2 = build();
  duel(G2, { dist: 2.6 });
  const d2 = G2.game.dragon;
  G2.game.player.debug.god = true;
  const slide = {};
  for (const name of ['gates', 'hundred']) {
    settle(G2, 3);
    d2.position.set(0, 0, -2);
    d2.yaw = 0;
    place(G2, 2.6);
    run(G2, 0.3);
    d2.debug.trigger(name);
    const ft = [d2.rig.legs.R.foot, d2.rig.legs.L.foot], last = [null, null];
    let slid = 0, moved = 0, r0 = d2.position.clone();
    while (d2.mode === 'act' && d2.brain.act?.name === name) {
      G2.tick(DT);
      for (let k = 0; k < 2; k++) {
        ft[k].getWorldPosition(v);
        // (the low sweep's leg skims the floor on purpose: not counted)
        const sw = d2.brain.act?.beats.find((x) => d2.brain.act.t < x.end)?.def.sweep;
        // (on the floor: a planted ankle is ~0.085 m up; the planner's steps lift it ~0.13 m, under the 0.16 this
        // used: a longer string's extra steps counted as sliding, ADR-248)
        if (last[k] && v.y < 0.11 && last[k].y < 0.11 && !sw) {
          const st = Math.hypot(v.x - last[k].x, v.z - last[k].z);
          slid += st;
          if (process.env.GCD_MDBG && st > 0.05) out(`      slide ${k} ${st.toFixed(3)} t ${d2.brain.act?.t.toFixed(3)} dt ${G2.game.dt.toFixed(4)} y ${v.y.toFixed(3)} root ${d2.position.x.toFixed(2)},${d2.position.z.toFixed(2)}`);
        }
        last[k] = v.clone();
      }
    }
    moved = Math.hypot(d2.position.x - r0.x, d2.position.z - r0.z);
    slide[name] = { slid, moved };
    out(`   ${name}: planted feet slid ${slid.toFixed(2)} m in all while the root travelled ${moved.toFixed(2)} m`);
  }
  // the feet as duel.mjs MOTION measures them (ADR-126): where they are DRAWN (the animator's pose), the
  // frames of a dash (> 9 m/s) or with him off the ground left out, a foot counted while it is within
  // 0.02 m of its lowest
  const feet = {};
  {
    const { P } = await imp('src/entities/player/anim.js');
    const G3 = build();
    duel(G3, { dist: 2.6 });
    const d3 = G3.game.dragon;
    G3.game.player.debug.god = true;
    const FEET_SET = process.env.GCD_FEET ? ['gates', 'hundred', 'tiger', 'ironMountain', 'goldenGates', 'skyHammer', 'thousand', 'stormWaltz', 'heavenEarth'] : ['gates', 'hundred'];
    for (const name of FEET_SET) {
      const form = Math.max(1, (MOVES[name].weight ?? [1]).findIndex((w) => w > 0) + 1);
      settle(G3, 4);
      if (d3.phase !== form) d3.debug.setForm(form);
      run(G3, 0.3);
      d3.position.set(0, 0, -2);
      d3.yaw = 0;
      place(G3, 2.6);
      run(G3, 0.3);
      if (!d3.debug.trigger(name)) continue;
      const an = [], lo = [9, 9];
      for (let i = 0; i < 900 && d3.mode === 'act' && d3.brain.act?.name === name; i++) {
        G3.tick(DT);
        G3.game.player.debug.heal?.();
        const c = d3.anim.cur, HS = d3.anim.drawScale, cy = Math.cos(d3.yaw), sy = Math.sin(d3.yaw);
        const foot = (k) => ({ x: d3.position.x + HS * (c[k] * cy + c[k + 2] * sy), y: c[k + 1], z: d3.position.z + HS * (-c[k] * sy + c[k + 2] * cy) });
        an.push([foot(P.rF), foot(P.lF), Math.hypot(d3.pilot.groundVel.x, d3.pilot.groundVel.z) > 9 || d3.position.y > 0.03]);
      }
      for (const f of an) for (let k = 0; k < 2; k++) lo[k] = Math.min(lo[k], f[k].y);
      let s = 0;
      for (let i = 1; i < an.length; i++) for (let k = 0; k < 2; k++) {
        const a = an[i][k], b = an[i - 1][k];
        if (!an[i][2] && !an[i - 1][2] && a.y < lo[k] + 0.02 && b.y < lo[k] + 0.02) s += Math.hypot(a.x - b.x, a.z - b.z);
      }
      feet[name] = s;
      out(`   ${name} (form ${form}): drawn planted feet slide ${s.toFixed(2)} m (duel.mjs MOTION's measure)`);
    }
  }
  // the follow-through's clock (realise.js, ADR-126): every beat's F at least its active frames, 0.3 s at
  // most (or its active frames when those are longer: a cast held open) and over before the next impact; a
  // sustained beat (a beam) spans its whole lit time; the clip
  // asks for stepping feet
  {
    const bad = [];
    let n = 0;
    for (const name of MOVE_NAMES) {
      for (let ph = 1; ph <= 3; ph++) {
        for (const r of [0.001, 0.999]) {
          const a = realise(name, ph, () => r);
          if (!a) continue;
          a.beats.forEach((b, i) => {
            n++;
            const nb = a.beats[i + 1];
            if (b.S > 0 ? Math.abs(b.F - (b.A + b.S)) > 1e-9 : !(b.F >= b.A - 1e-9 && b.F <= Math.max(b.A, 0.3) + 1e-9)) bad.push(`${name}/${ph}#${i} F ${b.F.toFixed(3)} A ${b.A} S ${b.S} next ${nb ? (nb.impact - b.impact).toFixed(3) : "-"}`);
            if (nb && !(b.impact + b.F <= nb.impact + 1e-9)) bad.push(`${name}/${ph}#${i} runs past the next impact`);
          });
          if (!a.clip.steps) bad.push(`${name}: no steps`);
        }
      }
    }
    assert(n > 200 && !bad.length, `the follow-through's clock on ${n} realised beats: within [active, 0.3 s], a beam's over its lit time, done before the next impact (${[...new Set(bad)].slice(0, 12).join(', ') || 'all'})`);
  }
  for (const k of ['gates', 'hundred']) assert(feet[k] < 1.0, `${k}: outside a dash or a leap his drawn feet on the ground slide under 1.0 m over the string, as the other two bosses' (${feet[k]?.toFixed(2)} m)`);
  // (a strike that reaches: its end within 0.45 m of the hero's body at its ideal distance; the lines
  // that close on a dash (palm, double, elbow, shoulder) and the areas (hammer, sweep, axe) aside)
  const AREA = new Set(['palm', 'double', 'elbow', 'shoulder', 'hammer', 'kick:sweep', 'kick:axe']);
  const short = rows.filter((r) => !AREA.has(r.name) && r.reach > 0.45);
  assert(!short.length, `every punch and kick reaches the hero at its ideal distance (${short.map((r) => `${r.name} f${r.f} ${r.reach.toFixed(2)}`).join(', ') || 'all within 0.45 m'})`);
  const slow = rows.filter((r) => !['shoulder', 'kick:sweep'].includes(r.name) && r.speed < 6);
  assert(!slow.length, `every strike's end is moving >= 6 m/s into its impact (${slow.map((r) => `${r.name} f${r.f} ${r.speed.toFixed(1)}`).join(', ') || 'all'})`);
  const coil = rows.filter((r) => r.name !== 'shoulder' && r.drawn < 0.4);
  assert(!coil.length, `every coil draws the striking limb back >= 0.4 m from where it strikes (${coil.map((r) => `${r.name} f${r.f}`).join(', ') || 'all'})`);
  for (const [k, v] of Object.entries(slide)) assert(v.slid < 0.5 * v.moved, `${k}: his planted feet slide ${v.slid.toFixed(2)} m while he travels ${v.moved.toFixed(2)} m (under half: the feet step)`);
  return { rows, slide };
}
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/**
 * STRINGS (the strings agent): the second wave's strings and the transformation's timing. Sky Hammer
 * launches the hero and is waiting where he lands; Mirage feints three times out of blinks (no glint)
 * before its one red blow; Heavenfall calls the terrain's shock ring (terrain.quake) at its landing; a
 * transformation shows the new form (dressPhase: the hair, the light, the aura) at its nova, not before;
 * the dash is faster than his sprint.
 */
async function scenarioStrings() {
  out('\n== scenario STRINGS (Sky Hammer, Mirage, Heavenfall, the form shown at the nova, the dash) ==');
  const G = build();
  duel(G, { dist: 2.0, form: 2 });
  const { game } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  const prep = (form, dist) => {
    settle(G, 4);
    if (d.phase !== form) d.debug.setForm(form);
    run(G, 0.3);
    d.position.set(0, 0, -3);
    d.yaw = 0;
    place(G, dist);
    run(G, 0.2);
  };
  // Sky Hammer: the launch (thrown >= 8 m, knocked down), the blink to where he lands, the hammer on him
  prep(2, 1.8);
  const p0 = p.position.clone();
  let far = 0, landGap = 9, flashes = [];
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'skyHammer') flashes.push(e.tell); };
  d.debug.trigger('skyHammer');
  run(G, 5, () => {
    far = Math.max(far, Math.hypot(p.position.x - p0.x, p.position.z - p0.z));
    const a = d.brain.act, b = a?.beats[2];
    if (b?._blinked && landGap === 9) landGap = Math.hypot(d.position.x - p.position.x, d.position.z - p.position.z);
  }, () => d.mode === 'foot');
  G.watch = null;
  const hammer = G.hits.filter((h) => h.attack === 'skyHammer').map((h) => h.r);
  // (< 3.5: under the readable pace, ADR-248, the launch lands a little later, the hero still sliding when he blinks)
  assert(far >= 8 && landGap < 3.5 && flashes.length === 3 && flashes[2] === TELL.RED, `Sky Hammer: the launch throws the hero ${far.toFixed(1)} m, he blinks to ${landGap.toFixed(1)} m from him, the hammer is red (${hammer.join(' ')})`);
  // Mirage: three feints (no glint), then the red blow
  prep(3, 5);
  const mf = [];
  let blinks = 0;
  const vanish = d.fx.vanish;
  d.fx.vanish = (...a) => { blinks++; return vanish?.apply(d.fx, a); };
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'mirage') mf.push(e.tell); };
  d.debug.trigger('mirage');
  run(G, 5, null, () => d.mode === 'foot');
  G.watch = null;
  d.fx.vanish = vanish;
  assert(blinks === 4 && mf.length === 1 && mf[0] === TELL.RED, `Mirage: ${blinks} vanishes (three feints and the blow), ${mf.length} glint (${mf.join(' ')})`);
  // Heavenfall: the leap, the landing calls the terrain's shock ring with its numbers
  prep(3, 6);
  let quake = null, apex = 0;
  const T = d.terrain, q0 = T.quake;
  T.quake = (x, z, o) => { quake = { x, z, o }; return q0?.call(T, x, z, o); };
  d.debug.trigger('heavenfall');
  run(G, 5, () => { apex = Math.max(apex, d.position.y); }, () => d.mode === 'foot');
  T.quake = q0;
  assert(!!quake && quake.o.to === 14 && quake.o.speed === 9 && quake.o.damage === 22 && apex > 4 && Number.isFinite(quake.x + quake.z), `Heavenfall: apex ${apex.toFixed(1)} m, its landing calls terrain.quake (${JSON.stringify(quake?.o)})`);
  // the form shown at the nova: a deathblow → the transformation: dressPhase stays 1 until the ring goes out
  prep(1, 2);
  d.debug.postureBreak();
  run(G, 0.3);
  d.onExecute({ damage: 260 });
  let shownEarly = 0, shownAt = -1;
  const t0 = game.time;
  run(G, 5, () => {
    const a = d.brain.act;
    if (a?.def?.transition && a.t < a.beats[0].impact - 0.05 && d.dressPhase !== 1) shownEarly++;
    if (shownAt < 0 && d.dressPhase === 2) shownAt = game.time - t0;
  }, () => d.mode === 'foot' && d.phase === 2);
  assert(shownEarly === 0 && d.phase === 2 && shownAt > TUNING.transform.windup + 1, `the new form is shown at the nova (${shownAt.toFixed(2)} s after the deathblow), not at the transformation's start (${shownEarly} frames early)`);
  // the dash: faster than his sprint, from form 2, past `at` m
  prep(2, 3);
  d.debug.setAI(true);
  d.brain.dashCool = 0;
  d.position.set(0, 0, -6);
  p.debug.teleport(0, 6);
  let top = 0;
  run(G, 1.2, () => { const v = d.pilot.groundVel; top = Math.max(top, Math.hypot(v.x, v.z)); });
  d.debug.setAI(false);
  assert(top > TUNING.move.sprint * 1.4, `the dash at ${top.toFixed(1)} m/s (his sprint ${TUNING.move.sprint})`);
}
/**
 * SIGN (the third wave): THE SIGN before a vanish: the hand at his brow and he still stands where he
 * stood at u 0.45, gone at 0.55, the snap drawn at the hand, the blow from behind (Sign Step, Three
 * Signs' sides, the retrofits on Vanishing Step, Storm Waltz, Mirage and riposte3).
 */
async function scenarioSign() {
  out('\n== scenario SIGN (two fingers to the brow, gone at u 0.5, the snap, the blow from behind / the sides) ==');
  const G = build();
  duel(G, { dist: 4, form: 2 });
  const { game } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  const prep = (form, dist) => {
    settle(G, 4);
    if (d.phase !== form) d.debug.setForm(form);
    run(G, 0.3);
    d.position.set(0, 0, -3);
    d.yaw = 0;
    place(G, dist);
    run(G, 0.2);
  };
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  /** One move: each sign beat's samples (where he stood, the hand's height against his head), the
   *  snaps, and where each blow of it met the hero from (rad off the hero's facing: 0 before him). */
  const play = (name, form, dist = 4) => {
    prep(form, dist);
    const snaps = [], sg = d.fx.signSnap;
    d.fx.signSnap = (...a) => { snaps.push(game.time); return sg?.apply(d.fx, a); };
    const S = new Map();
    const from = [];
    const h0 = G.hits.length;
    d.debug.trigger(name);
    run(G, 7, () => {
      const a = d.brain.act;
      if (!a || a.name !== name) return;
      for (const b of a.beats) {
        if (!b.def.blink?.sign || a.t < b.start || a.t > b.impact) continue;
        const u = (a.t - b.start) / (b.impact - b.start), s = S.get(b) ?? { x0: d.position.x, z0: d.position.z, at45: null, at55: null, brow: 9 };
        S.set(b, s);
        if (u > 0.3 && u < 0.48) {
          // (the brow as drawn: the head joint's world position, up a head's half-height, a little forward)
          const h = d.tellPoint('fistR', v), hd = w.set(0, 0.16, 0.09).applyMatrix4(d.rig.head.matrixWorld);
          s.brow = Math.min(s.brow, Math.hypot(h.x - hd.x, h.y - hd.y, h.z - hd.z));
        }
        if (s.at45 === null && u >= 0.45) s.at45 = Math.hypot(d.position.x - s.x0, d.position.z - s.z0);
        if (s.at55 === null && u >= 0.56) s.at55 = Math.hypot(d.position.x - s.x0, d.position.z - s.z0);
      }
    }, () => d.mode === 'foot' && game.time > 0.5);
    d.fx.signSnap = sg;
    for (const h of G.hits.slice(h0)) if (h.attack === name) from.push(h);
    return { S: [...S.values()], snaps, hits: from };
  };
  // (the side a blow came from: the boss's bearing off the hero's facing at the moment of contact)
  const bear = [];
  G.watch = (n, e) => {
    if (n !== 'player:hurt' && n !== 'player:block' && n !== 'player:parry') return;
    const ang = Math.atan2(d.position.x - p.position.x, d.position.z - p.position.z) - p.yaw;
    bear.push(Math.atan2(Math.sin(ang), Math.cos(ang)));
  };
  const fmt = (r) => r.S.map((s) => `${s.at45?.toFixed(2)}→${s.at55?.toFixed(2)} m, hand ${s.brow.toFixed(2)} m off his brow`).join(' · ');
  // Sign Step: one sign, the hook from behind, then the knee and the palm
  bear.length = 0;
  const ss = play('signStep', 2);
  const okS = (r, n) => r.S.length === n && r.snaps.length === n && r.S.every((s) => s.at45 !== null && s.at45 < 0.15 && s.at55 > 2.5 && s.brow < 0.18);
  assert(okS(ss, 1) && ss.hits.length === 3, `Sign Step: still where he stood at u 0.45, gone at 0.55, the hand at his brow (${fmt(ss)}); ${ss.snaps.length} snap; ${ss.hits.length} blows land`);
  assert(Math.abs(bear[0]) > 2.2, `... and the hook comes from BEHIND the hero (${bear[0]?.toFixed(2)} rad off his facing)`);
  // Three Signs: three signs; the blows from his left, his right, behind
  bear.length = 0;
  const ts = play('threeSigns', 3);
  assert(okS(ts, 3) && ts.hits.length >= 3, `Three Signs: three signs, each still at 0.45 and gone at 0.55 (${fmt(ts)}); ${ts.snaps.length} snaps; ${ts.hits.length} blows`);
  assert(bear.length >= 3 && bear[0] > 0.7 && bear[0] < 2.4 && bear[1] < -0.7 && bear[1] > -2.4 && Math.abs(bear[2]) > 2.2, `... from the hero's left, his right, then behind (${bear.slice(0, 3).map((b) => b.toFixed(2)).join(' / ')} rad)`);
  // the retrofits: the first beat of each signs; the later blinks do not
  for (const [name, form, dist] of [['vanishStep', 2, 5], ['stormWaltz', 3, 5], ['mirage', 3, 5], ['riposte3', 3, 2.2]]) {
    const r = play(name, form, dist);
    const signs = MOVES[name].beats.filter((b) => b.blink?.sign).length;
    assert(signs === 1 && MOVES[name].beats[0].blink?.sign && okS(r, 1), `${name}: its first beat out of THE SIGN (${fmt(r)}), ${r.snaps.length} snap, ${r.hits.length} blows`);
  }
  G.watch = null;
}

/**
 * CATCH (the third wave): the counter stances with their real punish. A cut into the stance is caught
 * (no damage, the hero's blade thrown back) and the punish's first beat starts within 0.1 s; no cut:
 * the move ends at the stance's impact with no blow and his guard is down `open` s.
 */
async function scenarioCatch() {
  out('\n== scenario CATCH (Still Water, Golden Mirror, Thunder Mirror: caught, the punish at once; or waited out, open) ==');
  const G = build();
  duel(G, { dist: 2, form: 1 });
  const { game, input } = G;
  const d = game.dragon, p = game.player, br = d.brain;
  const ST = TUNING.stance;
  const stance = (name, form, cut) => {
    settle(G, 4);
    if (d.phase !== form) d.debug.setForm(form);
    run(G, 0.3);
    d.position.set(0, 0, -2);
    d.yaw = 0;
    place(G, 1.9);
    run(G, 0.3);
    p.debug.heal();
    p.debug.god = true;
    const hp0 = d.hp, h0 = G.hits.length, c0 = br.stats.caught, m0 = br.stats.stanceMiss, b0 = G.counts['player:bounced'] ?? 0;
    let caughtT = null, punishT = null, guardDown = 0, glow = 0;
    const sg = d.fx.stanceGlow;
    d.fx.stanceGlow = (...a) => { glow++; return sg?.apply(d.fx, a); };
    G.watch = (n, e) => {
      if (n === 'dragon:guard' && e?.caught && caughtT === null) caughtT = game.time;
      if (n === 'combat:tell' && e?.attack === name && caughtT !== null && punishT === null) punishT = game.time;
    };
    d.debug.trigger(name);
    const t0 = game.time;
    let cutAt = -1;
    run(G, 6, () => {
      const a = br.act, b = a?.name === name ? a.beats[0] : null;
      if (cut && b && cutAt < 0 && a.t > b.start + ST.windup * 0.55 && a.t < b.impact) { input.click(0); cutAt = game.time; }
      if (d.mode === 'foot' && game.time - t0 < 3.5 && br.raiseT > 0 && !br.guardUp()) guardDown += DT;
    }, () => game.time - t0 > 2.8 && d.mode === 'foot' && quiet(d) && p.state !== 'bounce');
    d.fx.stanceGlow = sg;
    G.watch = null;
    const hits = G.hits.slice(h0).filter((h) => h.attack === name);
    return { caught: br.stats.caught - c0, miss: br.stats.stanceMiss - m0, dHp: hp0 - d.hp, bounced: (G.counts['player:bounced'] ?? 0) - b0, caughtT, punishT, hits, guardDown, glow };
  };
  for (const [name, form] of [['stillWater', 1], ['goldenMirror', 2], ['thunderMirror', 3]]) {
    const c = stance(name, form, true);
    const lag = c.punishT !== null && c.caughtT !== null ? c.punishT - c.caughtT : 9;
    assert(c.caught === 1 && c.miss === 0 && c.dHp === 0 && c.bounced >= 1 && c.glow > 5, `${name} (form ${form}): a cut into the stance is CAUGHT (${c.caught}), no damage to him (${c.dHp}), the hero's blade thrown back (${c.bounced}), light drawn into his palms (${c.glow} frames)`);
    assert(lag <= 0.1 && c.hits.length >= 1, `... the punish starts ${(lag * 1000).toFixed(0)} ms after the catch and reaches the hero (${c.hits.map((h) => `${h.tell}:${h.r}`).join(' ')})`);
    const m = stance(name, form, false);
    assert(m.caught === 0 && m.miss === 1 && m.hits.length === 0 && m.guardDown > ST.open * 0.7 && m.guardDown < ST.open + 0.6, `... waited out: the move ends at the stance with no blow (${m.hits.length}) and he is open, his guard down ${m.guardDown.toFixed(2)} s`);
  }
}

/**
 * RIPOSTES (the third wave): every counter of each form's list is drawn out of his deflect (the kit's
 * counterMove on the AI's stream), and each lands as a counter; riposteBolt hops back first.
 */
async function scenarioRipostes() {
  out('\n== scenario RIPOSTES (each form\'s counters all drawn; riposteBolt hops back, then the bolt) ==');
  const G = build();
  duel(G, { dist: 2.2, form: 1 });
  const { game } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  for (let f = 1; f <= FORMS; f++) {
    const seen = new Map();
    for (let i = 0; i < 200; i++) { const n = d.kit.counterMove(f); seen.set(n, (seen.get(n) ?? 0) + 1); }
    const L = COUNTER_LISTS[f - 1];
    assert(L.length >= 2 && L.every((n) => (seen.get(n) ?? 0) > 40) && [...seen.keys()].every((n) => L.includes(n)), `form ${f}: every counter of its list is drawn (${[...seen].map(([n, k]) => `${n} ${k}`).join(', ')} of 200)`);
  }
  // riposteBolt: back ~1.5 m through the windup, then the bolt down the line
  settle(G, 4);
  d.debug.setForm(3);
  run(G, 0.3);
  d.position.set(0, 0, -2);
  d.yaw = 0;
  place(G, 2.2);
  run(G, 0.2);
  const x0 = d.position.x, z0 = d.position.z, h0 = G.hits.length;
  let back = 0, boltAt = 0;
  d.debug.trigger('riposteBolt');
  run(G, 3, () => {
    const a = d.brain.act;
    if (a?.name === 'riposteBolt' && a.t < a.beats[0].impact) back = Math.hypot(d.position.x - x0, d.position.z - z0);
    if (a?.name === 'riposteBolt' && !boltAt && a.beats[0].struck) boltAt = Math.hypot(d.position.x - p.position.x, d.position.z - p.position.z);
  }, () => d.mode === 'foot' && game.time > 0.5);
  const hits = G.hits.slice(h0).filter((h) => h.attack === 'riposteBolt');
  assert(back > TUNING.sign.hop * 0.8 && hits.length === 1 && hits[0].tell === TELL.BLUE, `riposteBolt: back ${back.toFixed(2)} m before the bolt, thrown from ${boltAt.toFixed(1)} m; it lands (${hits.map((h) => `${h.tell}:${h.r}`).join(' ')})`);
}
// --- body
/**
 * BODY (the look agent, BRIEF 4): the homage outfits `?ascLook=h | g | v` build and dress by form
 * (hidden / shown pieces, the gold hair, teal eyes, the wristbands keep their colour), fight a few
 * seconds without a NaN, and no switch leaves the default figure (a) changed.
 */
async function scenarioBody() {
  out('\n== scenario BODY (the outfits behind ?ascLook=: h / g / v dressed by form; the default untouched) ==');
  const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const { ascLookNow, HOMAGE_LOOKS } = await imp('src/entities/enemies/ascendant/look.js');
  const visibleMeshes = (root) => {
    let n = 0;
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (let p = o; p; p = p.parent) if (p.visible === false) return;
      n++;
    });
    return n;
  };
  const fillOf = (m) => m?.uniforms?.uArtFill?.value.toArray().map((x) => +x.toFixed(3));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const shape = (G) => {
    const d = G.game.dragon, D = d.rig.root.userData.dress;
    let m = 0;
    d.rig.root.traverse((o) => { if (o.isMesh) m++; });
    return { look: D?.look, meshes: m, switched: D?.at.length ?? 0 };
  };
  setLook('ascLook', null);
  const base = shape(build());
  assert(ascLookNow().id === 'e' && base.look === 'k', `no switch: the owner's pick, e, the gi with wraps in ember (${base.meshes} meshes, ${base.switched} switched by form)`);
  setLook('ascLook', 'a');
  const old = shape(build());
  assert(old.look === 'a' && old.meshes > 0, `?ascLook=a: the tunic as it shipped before (${old.meshes} meshes, ${old.switched} switched by form)`);
  setLook('ascLook', null);
  assert(same(HOMAGE_LOOKS, ['h', 'g', 'v']), 'the homage options are h, g, v');
  for (const o of HOMAGE_LOOKS) {
    setLook('ascLook', o);
    const G = build();
    const d = G.game.dragon, M = d.rig.materials, D = d.rig.root.userData.dress;
    const s = shape(G);
    const rows = [];
    const eye1 = fillOf(M.eye), hem1 = fillOf(M.hem);
    let ok = s.look === o && ascLookNow().homage === true;
    for (const f of [1, 2, 3]) {
      if (d.phase !== f) d.debug.setForm(f);
      run(G, 0.5);
      const goldOn = D.at.filter((e) => (e.m.material === M.hair || e.m.material === M.hairTip) && e.m.visible).length;
      const eye = fillOf(M.eye);
      rows.push(`f${f}: ${visibleMeshes(d.rig.root)} visible, gold hair ${goldOn}`);
      ok &&= D.phase === f && (f === 1 ? goldOn === 0 : goldOn > 0);
      ok &&= same(fillOf(M.hem), hem1); // the wristbands / gloves keep their colour
      ok &&= f === 1 ? same(eye, eye1) : eye[1] > 0.8 && eye[2] > 0.7; // teal from form 2
    }
    // back to form 1: the eyes given back, the form-1 pieces shown
    d.debug.setForm(1);
    run(G, 0.3);
    ok &&= same(fillOf(M.eye), eye1) && D.at.every((e) => e.m.visible === (e.from <= 1 && e.to >= 1));
    // g: the torn top (form 3) and the whole top and left sleeve (forms 1 - 2)
    if (o === 'g') ok &&= D.at.some((e) => e.from === 3 && e.to === 3 && e.m.material === M.coat) && D.at.filter((e) => e.from === 1 && e.to === 2 && e.m.material === M.coat).length >= 2;
    // a few seconds of his AI with the outfit on (no NaN: G.tick checks)
    d.debug.setAI(true);
    run(G, 4);
    assert(ok, `?ascLook=${o}: ${s.meshes} meshes (${s.switched} switched by form); ${rows.join(' · ')}; eyes teal in forms 2 - 3, the bands keep their colour`);
  }
  setLook('ascLook', null);
  const after = shape(build());
  assert(after.look === 'k' && after.meshes === base.meshes && after.switched === base.switched, `switched back: the pick, e, as before (${after.meshes} meshes)`);
}

/**
 * HEROLIKE (ADR-155): Tian Lei printed like the hero. His letters follow his size on screen by the
 * hero's rule (his kit's letters -> pipeline.bossLetters -> the bosses' grid), the hero's quieter
 * print; his gold hair (forms 2 - 3) his own hair risen, no taller in form 3; the gi with wraps in
 * three colourings, no blue on it.
 */
async function scenarioHeroLike() {
  out("\n== scenario HEROLIKE (his letters follow his size like the hero's; the hair risen, not tall; the gi with wraps) ==");
  const { setLook, pickedOf } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const LOOK = await imp('src/entities/enemies/ascendant/look.js');
  const { Pipeline } = await imp('src/render/pipeline.js');
  const L = CONFIG.render.heroLetters;
  // the picks
  assert(pickedOf('ascLetters') === 'a' && pickedOf('ascHair') === 'b' && pickedOf('ascLook') === 'e' && pickedOf('ascLift') === 'b', "the owner's picks (2026-11-23): letters a, hair b, outfit e, print b");
  const G = build();
  const d = G.game.dragon;
  const kit = d.kit, on = {};
  for (const o of ['0', 'a']) { setLook('ascLetters', o); on[o] = !!kit.letters; }
  setLook('ascLetters', null);
  assert(kit.letters === true && on.a === true && on['0'] === false, `his kit asks for letters that follow his size (the pick a: ${kit.letters}); ?ascLetters=0 the fixed cell (${on['0']}), live`);
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
  // the hero and him at the same depth (the pass takes his 1 m above his root, as the hero's)
  const cellsAt = (H, D, letters) => {
    pipe.setSize(Math.round((H * 16) / 9), H, 1);
    pipe.bossLetters = letters;
    U.uBossScreen.value.set(0.4, 0.5, D + cam.matrixWorld.elements[9], 1);
    ps.set(0.6, 0.5, D, 0);
    for (let i = 0; i < 3; i++) { pipe._updateHeroLetters(ps); pipe._updateBossLetters(U.uBossScreen.value); }
    return [u.uHeroCell.value.x, pipe.selfCell.x];
  };
  const rows = [];
  for (const [name, H, D] of [['phone', 393, 20], ['720p', 720, 36], ['1080p', 1080, 36], ['1440p', 1440, 36], ['4K', 2160, 36], ['1440p 24 m', 1440, 24], ['1440p 54 m', 1440, 54]]) {
    const [b, h] = cellsAt(H, D, kit.letters);
    rows.push(`${name} ${b}/${h}`);
    assert(b === h && u.tHeroArt.value === pipe._selfArt.get(b)?.texture && u.uHeroPx.value.x === Math.max(1, Math.round(b / 4 - 0.01)),
      `${name} at ${D} m: his cell ${b} px is the hero's ${h} px, its atlas and a ${u.uHeroPx.value.x} px font pixel`);
    const [b0] = cellsAt(H, D, false);
    assert(b0 === pipe.heroCell.x && u.tHeroArt.value === pipe.heroArt.texture && u.uHeroPx.value.x === Math.max(1, Math.floor(H / 1080)),
      `${name}: with ?ascLetters=0 (as every boss whose kit does not ask) the fixed ${b0} px cell as before`);
  }
  out("   his / the hero's cell: " + rows.join('; '));
  // the print: the hero's quieter one (the fills lower than the lifted ones, the rim softer)
  const fill = (look) => {
    setLook('ascLift', look);
    const g = build();
    setLook('ascLift', null);
    const M = g.game.dragon.rig.materials;
    return { skin: M.skin.uniforms.uArtFill.value.r, coat: M.coat.uniforms.uArtFill.value.r, rim: M.coat.uniforms.uArtRim.value };
  };
  const qa = fill('a'), qb = fill('b');
  assert(qb.skin < qa.skin * 0.6 && qb.coat < qa.coat && qb.rim < qa.rim * 0.6, `the quieter print: skin ${qb.skin.toFixed(2)} (lifted ${qa.skin.toFixed(2)}), coat ${qb.coat.toFixed(2)} (${qa.coat.toFixed(2)}), rim ${qb.rim.toFixed(2)} (${qa.rim.toFixed(2)})`);
  // the hair: how far the gold rises above his dark form-1 hair's top, per form (world m, at rest)
  const rise = (opt) => {
    setLook('ascHair', opt);
    const g = build();
    setLook('ascHair', null);
    const dd = g.game.dragon, M = dd.rig.materials, D = dd.rig.root.userData.dress;
    dd.rig.root.updateMatrixWorld(true);
    const top = (f, mats) => {
      let y = -Infinity;
      for (const e of D.at) if (e.from <= f && e.to >= f && mats.includes(e.m.material)) y = Math.max(y, new THREE.Box3().setFromObject(e.m).max.y);
      return y;
    };
    const dark = top(1, [M.shirt]);
    return { dark, f2: top(2, [M.hair, M.hairTip]) - dark, f3: top(3, [M.hair, M.hairTip]) - dark };
  };
  const h0 = rise('0'), hb = rise('b'), ha = rise('a');
  out(`   the gold above his dark hair: tall crown ${h0.f2.toFixed(2)} / ${h0.f3.toFixed(2)} m, short crown ${ha.f2.toFixed(2)} / ${ha.f3.toFixed(2)}, risen ${hb.f2.toFixed(2)} / ${hb.f3.toFixed(2)} (forms 2 / 3)`);
  assert(hb.f2 < h0.f2 - 0.08 && hb.f3 < h0.f3 - 0.15 && ha.f2 < h0.f2 - 0.08, 'the risen hair (and the short crown) stand well below the tall crown');
  assert(hb.f3 - hb.f2 < 0.05 && hb.f2 < 0.12, `form 3 no taller than form 2 by more than 5 cm, both near his own hair's height (${hb.f2.toFixed(2)} / ${hb.f3.toFixed(2)} m above it)`);
  // the gi with wraps: e / r / w build, dress by form, no blue on the cloth; outfit a's wraps
  for (const o of LOOK.KUNG_LOOKS) {
    setLook('ascLook', o);
    const g = build();
    const dd = g.game.dragon, M = dd.rig.materials, D = dd.rig.root.userData.dress;
    const blue = ['coat', 'pants', 'hem', 'leather', 'collar', 'facing'].filter((k) => {
      const c = M[k]?.uniforms?.uArtFill?.value;
      return c && c.b > c.r * 1.2 && c.b > 0.1;
    });
    let wraps = 0;
    dd.rig.root.traverse((x) => { if (x.isMesh && x.material === M.hem) wraps++; });
    let ok = D.look === 'k' && LOOK.ascLookNow().tint === o && !blue.length && wraps >= 4;
    for (const f of [1, 2, 3]) {
      if (dd.phase !== f) dd.debug.setForm(f);
      run(g, 0.4);
      const gold = D.at.filter((e) => (e.m.material === M.hair || e.m.material === M.hairTip) && e.m.visible).length;
      ok &&= f === 1 ? gold === 0 : gold > 0;
    }
    dd.debug.setAI(true);
    run(g, 3);
    assert(ok, `?ascLook=${o}: the gi with wraps (${wraps} wrapped pieces), no blue cloth (${blue.join(', ') || 'none'}), the gold hair from form 2`);
  }
  setLook('ascLook', null);
}
// --- audit
/**
 * AUDIT (opt-in, ADR-162): every move of his run once (AI off, the hero still in front of him at the
 * middle of its band, then circling him at 3.5 m/s), his joints tracked frame by frame in his own frame
 * and in the world round his root: the largest one-frame jolts (second difference, mm) and where they
 * fall (windup / strike / follow / recovery / the blend out), the fastest turn of his facing, how far his
 * planted feet slide, the joints' range, and how far each blow's limb stops from the hero at its impact.
 * GCD_AUDIT=name,name runs only those; GCD_AUDIT_TOP=n lists the n worst frames of each move.
 */
/** The audit of moves `names` (each run once a hero still in front of him, once circling him when
 *  `orbits` holds true): one row a run (AUDIT prints them; MOTIONFIX asserts on them). */
function auditMoves(names, orbits = [false, true], TOP = 0) {
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const inv = new THREE.Matrix4(), v = new THREE.Vector3();
  const DEG = 180 / Math.PI;
  const ang3 = (a, b, c) => {
    const u = new THREE.Vector3().subVectors(a, b).normalize(), w = new THREE.Vector3().subVectors(c, b).normalize();
    return Math.acos(clamp(u.dot(w), -1, 1)) * DEG;
  };
  const PTS = ['fistR', 'fistL', 'elbowR', 'elbowL', 'kneeR', 'kneeL', 'footR', 'footL', 'head', 'chest', 'pelvis'];
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
    return { W, B, Wr, yaw: d.yaw, x: d.position.x, z: d.position.z, y: d.position.y };
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
      const f = formsOf(name)[0] ?? def.phase ?? 1;
      const G = build();
      const band = def.band ?? [0, 4];
      const dist = clamp((band[0] + Math.min(band[1], 8)) / 2, 1.6, 7);
      duel(G, { dist, form: Math.max(1, f) });
      const { game } = G;
      const d = game.dragon, p = game.player;
      p.debug.god = true;
      settle(G, 2);
      // (the hero EAST of him, as MOTION does: the drawn figure leans toward the camera along z)
      d.position.set(0, 0, 0);
      d.yaw = Math.PI / 2;
      p.debug.teleport(dist, 0);
      // (footwork's own planner holds his feet in the world: let them step to the new place first)
      run(G, 0.7);
      if (!d.debug.trigger(name)) { rows.push({ name, orbit, fail: 'trigger' }); continue; }
      const A = d.brain.act;
      const F = [];
      let after = -1, th = Math.atan2(p.position.x - d.position.x, p.position.z - d.position.z), contact = [], px = d.position.x, pz = d.position.z;
      for (let i = 0; i < 1200; i++) {
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
        // (a frame the root jumps in, a blink or a flit, is no one's motion: left out)
        s.jump = Math.hypot(d.position.x - px, d.position.z - pz) > 0.4;
        px = d.position.x;
        pz = d.position.z;
        s.air = s.jump || d.position.y > 0.05 || !!d.brain.leap || !!A.beats.find((b) => b.def.dash && A.t >= b.start && A.t <= b.end + 0.1) || !!A.beats.find((b) => b.def.blink && A.t >= b.start - 0.05 && A.t <= b.impact + 0.05);
        F.push(s);
        // the blow against the hero, at each real beat's impact frame
        if (inAct) for (const b of A.beats) {
          if (b.feint || b._aud || A.t < b.impact || !b.def.zone || (b.def.release && !b.cut) || b.def.cast) continue;
          b._aud = true;
          if (process.env.GCD_SIDEDBG) out(`      ${name} b${b.index} ${b.def.part} tip ${d._tip.x.toFixed(2)},${d._tip.y.toFixed(2)},${d._tip.z.toFixed(2)} hero ${p.position.x.toFixed(2)},${p.position.z.toFixed(2)} root ${d.position.x.toFixed(2)},${d.position.z.toFixed(2)} yaw ${d.yaw.toFixed(2)}`);
          const tp = d._tip, pp = p.position, pr = p.radius ?? 0.45;
          const flat = orbit ? Math.hypot(tp.x - pp.x, tp.z - pp.z) - pr : Math.abs(pp.x - tp.x) - pr, up = tp.y < 0 ? -tp.y : tp.y > 1.85 ? tp.y - 1.85 : 0;
          const sm = sample(d), arm = b.def.part === 'fistL' ? ['shL', 'elbowL', 'fistL'] : ['shR', 'elbowR', 'fistR'];
          contact.push({ i: b.index ?? A.beats.indexOf(b), gap: Math.max(flat, up), flat, y: tp.y, zone: b.def.zone.kind, part: b.def.part,
            sep: +Math.hypot(pp.x - d.position.x, pp.z - d.position.z).toFixed(2), side: +(((tp.x - d.position.x) * (pp.z - d.position.z) - (tp.z - d.position.z) * (pp.x - d.position.x)) / Math.max(0.01, Math.hypot(pp.x - d.position.x, pp.z - d.position.z))).toFixed(2), elbow: Math.round(ang3(sm.B[arm[0]], sm.B[arm[1]], sm.B[arm[2]])),
            // (a kick: the striking knee and the standing knee at contact, deg; 180 = straight)
            knee: Math.round(ang3(sm.B[b.def.part === 'footL' ? 'hipL' : 'hipR'], sm.B[b.def.part === 'footL' ? 'kneeL' : 'kneeR'], sm.B[b.def.part === 'footL' ? 'footL' : 'footR'])),
            own: [sm.B[arm[2]].x, sm.B[arm[2]].y, sm.B[arm[2]].z].map((x) => +x.toFixed(2)), sh: [sm.B[arm[0]].x, sm.B[arm[0]].y, sm.B[arm[0]].z].map((x) => +x.toFixed(2)),
            stand: Math.round(ang3(sm.B[b.def.part === 'footL' ? 'hipR' : 'hipL'], sm.B[b.def.part === 'footL' ? 'kneeR' : 'kneeL'], sm.B[b.def.part === 'footL' ? 'footR' : 'footL'])) });
        }
        if (process.env.GCD_SLIDE === name && !orbit && F.length > 1) {
          const q = F[F.length - 2], fo = d.pilot?.feetOff;
          for (const k of ['footR', 'footL']) {
            const a1 = s.W[k], b1 = q.W[k], mv = Math.hypot(a1.x - b1.x, a1.z - b1.z);
            const f = k === 'footR' ? fo?.r : fo?.l;
            if (!s.air && !q.air && a1.y < 0.14 && b1.y < 0.14 && mv > 0.004) out(`      slide ${s.t.toFixed(3)} ${s.ph.padEnd(10)} ${k} ${(mv * 1000).toFixed(0)}mm y${a1.y.toFixed(3)} mode ${d.mode} clip ${d.brain.clip ?? ''} t${f?.t?.toFixed(2)} w${f?.w?.toFixed(2)} root ${(Math.hypot(s.x - q.x, s.z - q.z) * 1000).toFixed(0)}mm yaw ${((s.yaw - q.yaw) * 57.3).toFixed(1)}`);
          }
        }
        if (process.env.GCD_TRACE === name && !orbit) {
          const fo = d.pilot?.feetOff, k = process.env.GCD_TRACE_PT ?? 'footL';
          out(`      ${s.t.toFixed(3)} ${s.ph.padEnd(10)} ${k} w[${s.W[k].x.toFixed(3)},${s.W[k].y.toFixed(3)},${s.W[k].z.toFixed(3)}] root[${s.x.toFixed(3)},${s.z.toFixed(3)}] offL[${fo?.l.x.toFixed(3)},${fo?.l.y.toFixed(3)},${fo?.l.z.toFixed(3)} t${fo?.l.t.toFixed(2)} w${fo?.l.w?.toFixed(2)} lift${fo?.l.lift?.toFixed(3)}] yaw${d.yaw.toFixed(3)} offR[${fo?.r.x.toFixed(3)},${fo?.r.z.toFixed(3)} t${fo?.r.t.toFixed(2)}]`);
        }
        G.tick(DT);
      }
      // jolts: the largest second difference of each point (mm a frame²), in his frame and in the world round his root
      let pb = { v: 0 }, pw = { v: 0 }, out1 = { v: 0 };
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
        }
      }
      jolts.sort((a, b) => b.j - a.j);
      // a statue: the longest run of frames where nothing of him moves 3 mm (his own frame) and his root stands
      let still = 0, stillBest = 0, stillAt = '';
      for (let i = 1; i < F.length; i++) {
        const q = F[i - 1], c = F[i];
        const moved = PTS.some((k) => c.B[k].distanceTo(q.B[k]) > 0.003) || Math.hypot(c.x - q.x, c.z - q.z) > 0.003 || Math.abs(wrapA(c.yaw - q.yaw)) > 0.003;
        still = moved ? 0 : still + 1;
        if (still > stillBest) { stillBest = still; stillAt = c.ph; }
      }
      // his facing: the fastest turn (deg/s, one frame)
      let yawR = 0, yawAt = '';
      for (let i = 1; i < F.length; i++) {
        const r = Math.abs(wrapA(F[i].yaw - F[i - 1].yaw)) / DT * DEG;
        if (r > yawR) { yawR = r; yawAt = F[i].ph; }
      }
      // planted feet: travel on the floor while the foot is down (world), outside dashes, blinks and leaps
      let slide = 0;
      for (let i = 1; i < F.length; i++) {
        if (F[i].air || F[i - 1].air) continue;
        for (const k of ['footR', 'footL']) {
          const a = F[i].W[k], b = F[i - 1].W[k];
          if (a.y < 0.14 && b.y < 0.14) slide += Math.hypot(a.x - b.x, a.z - b.z);
        }
      }
      // joints: the elbows' and knees' tightest fold, the lowest knee / foot
      let elbow = 180, knee = 180, low = 9;
      for (const s of F) {
        elbow = Math.min(elbow, ang3(s.B.shR, s.B.elbowR, s.B.fistR), ang3(s.B.shL, s.B.elbowL, s.B.fistL));
        knee = Math.min(knee, ang3(s.B.hipR, s.B.kneeR, s.B.footR), ang3(s.B.hipL, s.B.kneeL, s.B.footL));
        low = Math.min(low, s.W.kneeR.y, s.W.kneeL.y, s.W.footR.y, s.W.footL.y);
      }
      const row = { name, orbit, f, dist: +dist.toFixed(1), frames: F.length, still: +(stillBest * DT).toFixed(2), stillAt, pb, pw, out: out1, yawR: Math.round(yawR), yawAt, slide: +slide.toFixed(2), elbow: Math.round(elbow), knee: Math.round(knee), low: +low.toFixed(2), contact };
      rows.push(row);
      if (TOP) worst.push(`   ${name}${orbit ? ' (orbit)' : ''}: ` + jolts.filter((x, i, L) => L.findIndex((y) => y.k === x.k && Math.abs(y.t - x.t) < 0.05) === i).slice(0, TOP).map((x) => `${x.k} ${Math.round(x.j)}${x.w ? 'w' : ''} @${x.t.toFixed(2)} ${x.ph}`).join(' · '));
    }
  }
  return { rows, worst };
}

async function scenarioAudit() {
  out('\n== scenario AUDIT (every move: jolts, turns, sliding feet, joints, the blow against the hero) ==');
  // (GCD_LOOK='ascMotion=a,halMotion=a': the looks the audit plays, live)
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  for (const kv of (process.env.GCD_LOOK ?? '').split(',').filter(Boolean)) LS.setLook(...kv.split('='));
  const only = (process.env.GCD_AUDIT ?? '').split(',').filter(Boolean);
  const TOP = Number(process.env.GCD_AUDIT_TOP ?? 0);
  const { rows, worst } = auditMoves(MOVE_NAMES.filter((n) => !only.length || only.includes(n)), [false, true], TOP);
  const fmt = (o) => (o.v ? `${Math.round(o.v)} ${o.k} ${o.ph ?? ''}`.trim() : '-');
  out('   move               f  orbit  jolt(own frame, mm/f²)              jolt(world)                         blend-out     turn°/s (when)          slide  elbow knee  low   blow vs hero (gap m per beat; - = inside him)');
  for (const r of rows) {
    if (r.fail) { out(`   ${r.name} FAIL ${r.fail}`); continue; }
    const c = r.contact.map((x) => `${x.part}:${x.gap.toFixed(2)}${/^fist|palms/.test(x.part) ? `/e${x.elbow}` : /^foot/.test(x.part) ? `/k${x.knee}s${x.stand}` : ''}`).join(' ');
    out(`   ${r.name.padEnd(18)} ${r.f}  ${r.orbit ? 'yes' : '   '}  ${fmt(r.pb).padEnd(36)} ${fmt(r.pw).padEnd(36)} ${fmt(r.out).padEnd(13)} ${String(r.yawR).padStart(5)} (${r.yawAt})`.padEnd(170) + ` ${r.slide.toFixed(2).padStart(5)} ${String(r.elbow).padStart(5)} ${String(r.knee).padStart(4)} ${r.low.toFixed(2).padStart(5)}  ${c}`);
  }
  if (TOP) for (const w of worst) out(w);
  const S = process.env.GCD_AUDIT_JSON;
  if (S) fs.writeFileSync(S, JSON.stringify(rows.map((r) => ({ ...r })), null, 1));
}
/**
 * MOTIONFIX (ADR-162): what the motion audit found and fixed stays fixed, on the moves that showed it:
 * a planted foot no longer jumps when the keys lift it (the strings' feet jolted 900 - 1300 mm a frame²),
 * a punch lands with the arm open (every elbow was ~130° at contact), a palm thrust on a dash stops at
 * the hero's body instead of passing through it, the roundhouse's knee does not flip side to side.
 */
async function scenarioMotionFix() {
  out('\n== scenario MOTIONFIX (feet that do not jump, punches with an open arm, palms that stop at him, a steady roundhouse knee) ==');
  const { rows } = auditMoves(['hundred', 'thousand', 'piercingPalm', 'riposteKnee', 'skyHammer'], [false]);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  const jolt = (r, pts) => Math.max(...[r.pb, r.pw].filter((x) => pts.includes(x.k)).map((x) => x.v), 0);
  const feet = ['hundred', 'thousand', 'skyHammer'].map((n) => [n, Math.round(Math.max(jolt(by[n], ['footR', 'footL']), jolt(by[n], ['kneeR', 'kneeL'])))]);
  assert(feet.every(([, j]) => j < 450), `the strings' feet and knees: the worst jolt under 450 mm/f² (was 900 - 1150): ${feet.map(([n, j]) => `${n} ${j}`).join(', ')}`);
  const punches = ['hundred', 'thousand'].flatMap((n) => by[n].contact.filter((c) => c.part === 'fistR' || c.part === 'fistL'));
  const elbows = punches.map((c) => c.elbow);
  assert(punches.length >= 10 && Math.min(...elbows) >= 145, `${punches.length} punches land with the arm open: elbows ${Math.min(...elbows)} - ${Math.max(...elbows)}° (was ~130°)`);
  assert(punches.every((c) => c.flat > -0.26), `a punch stops at the hero's body, not through it (deepest ${Math.min(...punches.map((c) => c.flat)).toFixed(2)} m into his 0.45 m circle)`);
  const palms = ['hundred', 'piercingPalm'].flatMap((n) => by[n].contact.filter((c) => c.part === 'palms'));
  assert(palms.length >= 2 && palms.every((c) => c.flat > -0.15 && c.gap < 0.2), `a palm thrust on a dash stops at the hero's body: ${palms.map((c) => c.flat.toFixed(2)).join(', ')} m (was 0.37 - 0.44 m through him)`);
  const knee = Math.round(jolt(by.riposteKnee, ['kneeR', 'kneeL']));
  assert(knee < 500, `the roundhouse's knee does not flip from frame to frame: worst jolt ${knee} mm/f² (was 731)`);
}
/**
 * AUDITFIGHT (opt-in, ADR-162): his AI against a defending bot, `GCD_FIGHT_SECS` s a form (30): the
 * same joints as AUDIT, every frame, and the largest jolts listed with what he was doing (the move
 * and its phase, footwork, a reaction) and what he did the frame before (a seam between two things).
 */
async function scenarioAuditFight() {
  out('\n== scenario AUDITFIGHT (his AI against a defender: the worst jolts and the seams they fall on) ==');
  const secs = Number(process.env.GCD_FIGHT_SECS ?? 30);
  const inv = new THREE.Matrix4(), v = new THREE.Vector3();
  const PTS = ['fistR', 'fistL', 'elbowR', 'elbowL', 'kneeR', 'kneeL', 'footR', 'footL', 'head', 'chest', 'pelvis'];
  const all = [];
  let total = 0, frames = 0;
  for (const form of [1, 2, 3]) {
    const G = build(SEED + form);
    duel(G, { dist: 3, form, ai: true });
    const { game } = G;
    const d = game.dragon, p = game.player;
    p.debug.god = true;
    G.defend = makeDefender(G, { style: 'mixed' });
    const H = [];
    const what = () => {
      const a = d.brain.act;
      if (d.mode === 'act' && a) {
        const b = a.beats.find((x) => a.t < x.end + 1e-6);
        return `${a.name}:${b ? (a.t < b.impact - 0.12 ? 'windup' : 'strike') + (b.index ?? a.beats.indexOf(b)) : 'recovery'}`;
      }
      return d.mode === 'react' ? `react:${d.brain.react?.kind ?? ''}` : d.mode;
    };
    let px = d.position.x, pz = d.position.z, lastHs = -99;
    for (let i = 0, n = Math.round(secs / DT); i < n; i++) {
      G.defend.act();
      p.hp = p.maxHp;
      G.tick(DT);
      // (a hit-stop is a freeze-frame meant to stop the motion: no jolt is counted from 2 frames
      // before it to 3 frames after it; its frames still enter the window, so nothing spans it)
      const hs = game.hitstopTimer > 0 || (game.flow?.cineScale ?? 1) < 0.9;
      if (hs) lastHs = i;
      const R = d.rig;
      R.root.updateMatrixWorld(true);
      inv.copy(R.root.matrixWorld).invert();
      const at = (o) => new THREE.Vector3().applyMatrix4(o.matrixWorld);
      const W = { fistR: at(R.sword), fistL: at(R.arms.L.wrist ?? R.arms.L.fore), elbowR: at(R.arms.R.fore), elbowL: at(R.arms.L.fore), kneeR: at(R.legs.R.shin), kneeL: at(R.legs.L.shin), footR: at(R.legs.R.foot), footL: at(R.legs.L.foot), head: at(R.head), chest: at(R.chest), pelvis: at(R.pelvis) };
      const root = new THREE.Vector3().setFromMatrixPosition(R.root.matrixWorld);
      const B = {}, Wr = {};
      for (const k in W) { B[k] = W[k].clone().applyMatrix4(inv); Wr[k] = W[k].clone().sub(root); }
      const jump = Math.hypot(d.position.x - px, d.position.z - pz) > 0.4 || d.position.y > 0.05;
      px = d.position.x;
      pz = d.position.z;
      H.push({ B, Wr, w: what(), jump: jump || hs, t: game.time });
      if (H.length > 3) H.shift();
      if (H.length < 3 || H.some((h) => h.jump) || i - lastHs < 4) continue;
      frames++;
      let best = 0, bk = '';
      for (const k of PTS) {
        const jb = v.copy(H[2].B[k]).addScaledVector(H[1].B[k], -2).add(H[0].B[k]).length() * 1000;
        const jw = v.copy(H[2].Wr[k]).addScaledVector(H[1].Wr[k], -2).add(H[0].Wr[k]).length() * 1000;
        const j = Math.max(jb, jw);
        if (j > best) { best = j; bk = k; }
      }
      total += best;
      all.push({ form, j: Math.round(best), k: bk, t: +H[2].t.toFixed(2), now: H[2].w, before: H[0].w });
    }
    G.defend = null;
  }
  all.sort((a, b) => b.j - a.j);
  const seams = all.filter((x) => x.now !== x.before).length;
  out(`   ${frames} frames, mean worst jolt ${(total / Math.max(1, frames)).toFixed(1)} mm/f²; over 300: ${all.filter((x) => x.j > 300).length}, over 150: ${all.filter((x) => x.j > 150).length}; on a seam (the frame before was something else): ${seams}`);
  const seen = new Set();
  for (const x of all) {
    const key = `${x.k} ${x.now} ${x.before}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out(`   F${x.form} ${String(x.j).padStart(5)} ${x.k.padEnd(7)} t${x.t}  ${x.before === x.now ? x.now : `${x.before} -> ${x.now}`}`);
    if (seen.size >= Number(process.env.GCD_FIGHT_TOP ?? 25)) break;
  }
}
//
//
// --- terrain
/** One of his terrain moves on the REAL ring, the hero `dist` m in front of him (AI off): `step` runs
 *  each frame (a defender, a sidestep); until his move and everything it threw are over. */
function terrainPlay(name, { dist = 7, form = 1, step = null, ang = 0, max = 6, seed = SEED, defend = null } = {}) {
  const G = build(seed, true);
  const { game } = G;
  duel(G, { dist, form, ang });
  if (defend) {
    G.defend = makeDefender(G, { style: defend });
    step = () => G.defend.act();
  }
  const d = game.dragon, p = game.player;
  p.debug.god = false;
  const flashes = [], tells = [];
  G.watch = (n, e) => {
    if (n === 'combat:flash' && e?.source === 'dragon') flashes.push({ t: game.time, tell: e.tell, attack: e.attack, x: e.x, z: e.z });
    if (n === 'combat:tell' && e?.source === 'dragon') tells.push({ t: game.time, attack: e.attack });
  };
  const t0 = game.time, hp0 = p.hp;
  const ok = name ? d.debug.trigger(name) : true;
  run(G, max, step, () => game.time - t0 > 0.4 && d.mode === 'foot' && !d.terrain.busy);
  const hits = G.hits.filter((h) => h.t >= t0);
  return { G, d, p, ok, flashes, tells, hits, lost: hp0 - p.hp, t0 };
}

async function scenarioTerrain() {
  out('\n== scenario TERRAIN (Tile Kick, Ring Breaker, Stone Storm on the ring\'s tiles: every answer) ==');
  const T = TUNING.terrain;
  // ---- Tile Kick: a tile stamped up and punched at the hero
  {
    const A = terrainPlay('tileKick', { dist: 7 });
    const W = A.G.game.world.destructibles;
    const h = A.hits.find((x) => x.attack === 'tileKick'), f = A.flashes.filter((x) => x.attack === 'tileKick');
    const taken = W.floor.filter((b) => b.state !== 0).length;
    assert(A.ok && f.length === 1 && f[0].tell === TELL.NORMAL && h?.r === RESULT.HIT && h.damage >= 16 && Math.abs(h.t - f[0].t - TUNING.flashLead) < 0.06, `Tile Kick at 7 m, unanswered: one normal flare on the tile, then it lands on him ${h ? (h.t - f[0].t).toFixed(2) : '-'} s later (${h?.damage} damage)`);
    assert(taken >= 1, `the tile's place is left broken (${taken} slab(s) of the floor no longer whole)`);
    for (const dist of [4.5, 9, 13.5]) {
      const B = terrainPlay('tileKick', { dist });
      const hb = B.hits.find((x) => x.attack === 'tileKick');
      assert(hb?.r === RESULT.HIT && B.flashes.length === 1, `at ${dist} m it reaches him, cued (${B.flashes.length} flare)`);
    }
    const G2 = build(SEED, true);
    duel(G2, { dist: 8 });
    G2.defend = makeDefender(G2, { style: 'parry' });
    const t0 = G2.game.time;
    G2.game.dragon.debug.trigger('tileKick');
    run(G2, 5, () => G2.defend.act(), () => G2.game.time - t0 > 0.4 && G2.game.dragon.mode === 'foot' && !G2.game.dragon.terrain.busy);
    const hp = G2.hits.find((x) => x.attack === 'tileKick');
    assert(hp?.r === RESULT.PARRIED || hp?.r === RESULT.BLOCKED, `answered with a guard at the flare: ${hp?.r} (a parry cuts it in two)`);
  }
  // ---- Ring Breaker: a line of tiles bursting toward him
  {
    const A = terrainPlay('ringBreaker', { dist: 7, form: 2 });
    const f = A.flashes.filter((x) => x.attack === 'ringBreaker'), h = A.hits.filter((x) => x.attack === 'ringBreaker');
    assert(A.ok && f.length >= 1 && f.every((x) => x.tell === TELL.RED) && h.length === 1 && h[0].r === RESULT.HIT && A.tells.length >= 1, `Ring Breaker at 7 m, standing: ${f.length} red flare(s) on the tiles near him, one blow (${h[0]?.damage}, a knockdown)`);
    const W = A.G.game.world.destructibles;
    assert(W.floor.filter((b) => b.state !== 0).length >= 4, `the line left ${W.floor.filter((b) => b.state !== 0).length} slabs broken`);
    const R = terrainPlay('ringBreaker', { dist: 7, form: 2, defend: 'mixed' });
    assert(!R.hits.some((x) => x.attack === 'ringBreaker' && x.r === RESULT.HIT), `rolled at the flare: through it (${R.hits.filter((x) => x.attack === 'ringBreaker').map((x) => x.r).join(',') || 'no blow'})`);
    // he sprints sideways the moment the line starts: off the line, it misses him
    const S = terrainPlay('ringBreaker', { dist: 7, form: 2, step: (G) => { if (G.game.dragon.brain.act?.t > 0.75) G.input.axis = { x: 1, y: 0 }; } });
    assert(!S.hits.some((x) => x.attack === 'ringBreaker'), `stepping off the line (a sprint sideways from the fist's fall): it misses (${S.hits.filter((x) => x.attack === 'ringBreaker').length} blows)`);
  }
  // ---- Stone Storm: three thrown, then the great one
  {
    const A = terrainPlay('stoneStorm', { dist: 8, form: 2 });
    const f = A.flashes.filter((x) => x.attack === 'stoneStorm');
    const n = f.filter((x) => x.tell === TELL.NORMAL).length, r = f.filter((x) => x.tell === TELL.RED).length;
    const h = A.hits.filter((x) => x.attack === 'stoneStorm');
    let gap = Infinity;
    for (let i = 1; i < f.length; i++) gap = Math.min(gap, f[i].t - f[i - 1].t);
    const nr = f.findIndex((x) => x.tell === TELL.RED);
    const sepRed = nr > 0 ? f[nr].t - f[nr - 1].t : Infinity;
    if (n !== T.stoneStorm.count) out(`     (debug: flashes ${JSON.stringify(f.map((x) => [+(x.t - A.t0).toFixed(2), x.tell]))} hits ${JSON.stringify(h.map((x) => [+(x.t - A.t0).toFixed(2), x.r]))} log ${JSON.stringify(A.d.brain.guardLog?.filter?.((e) => e && e.kind).slice(0, 6))})`);
    assert(A.ok && n === T.stoneStorm.count && r === 1 && h.length >= 2, `Stone Storm at 8 m, unanswered: ${n} normal flares and ${r} red, ${h.length} blows land`);
    assert(gap >= 0.34 && sepRed >= 0.4, `its cues are ${gap.toFixed(2)} s apart at least; the red one ${sepRed.toFixed(2)} s after the last normal one`);
    const D = terrainPlay('stoneStorm', { dist: 8, form: 2, defend: 'mixed' });
    assert(D.lost === 0, `answered (guards, a roll at the red): ${D.lost} HP lost`);
    // a stagger in the windup drops them
    const G = build(SEED, true);
    duel(G, { dist: 8, form: 2 });
    const d = G.game.dragon, W = G.game.world.destructibles;
    const okS = d.debug.trigger('stoneStorm');
    run(G, 0.5);
    if (!d.terrain.storm.hold.some((x) => x.piece)) out(`     (debug: trigger ${okS}, act ${d.brain.act?.name}, mode ${d.mode}, near ${d.terrain._tilesRound(T.stoneStorm)})`);
    const held = d.terrain.storm.hold.filter((x) => x.piece).length;
    d.debug.stagger();
    run(G, 3);
    const flyN = G.hits.filter((x) => x.attack === 'stoneStorm').length;
    assert(held >= 2 && !d.terrain.busy && flyN === 0 && W.floor.every((b) => b.state !== 3), `staggered in the windup with ${held} tiles held: they drop, nothing is thrown`);
  }
  // ---- no tiles, no move
  {
    const G = build(SEED, true);
    duel(G, { dist: 7, form: 2 });
    const d = G.game.dragon, W = G.game.world.destructibles;
    for (const b of W.floor) if (Math.hypot(b.x - d.position.x, b.z - d.position.z) < 9) W.strike(b.x, b.z, 0.05, 5, { kind: 'blunt', by: 'world', src: W.swing() });
    const wK = d.terrain.weigh(MOVES.tileKick, 1, 7), wS = d.terrain.weigh(MOVES.stoneStorm, 1, 7);
    assert(wK === 0 && wS === 0 && d.debug.trigger('stoneStorm') === false, `the floor round him spent: Tile Kick and Stone Storm weigh 0 and do not start (Ring Breaker: ${d.terrain.weigh(MOVES.ringBreaker, 1, 7)})`);
  }
  const G = build(SEED, true);
  duel(G, { dist: 3 });
  const W = G.game.world.destructibles;
  const near = W.floor.filter((b) => b.kind === 'tile' && Math.hypot(b.x, b.z) <= 6).length;
  assert(near >= 40, `${near} tiles within 6 m of the centre`);
}

/** The quake (Heavenfall's landing): the tiles round it shatter, a front runs out and strikes the hero once, red. */
async function scenarioQuake() {
  out('\n== scenario QUAKE (d.terrain.quake: a front over the whole ring, cued as it reaches the hero) ==');
  const T = TUNING.terrain.quake;
  const play = (dist, step = null, o = {}) => {
    const G = build(SEED, true);
    const { game } = G;
    duel(G, { dist, form: 3 });
    const d = game.dragon, p = game.player, W = game.world.destructibles;
    const flashes = [];
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon') flashes.push({ t: game.time, tell: e.tell }); };
    const t0 = game.time, hp0 = p.hp;
    const ok = d.terrain.quake(d.position.x, d.position.z, o);
    run(G, 4, step, () => !d.terrain.busy && game.time - t0 > 0.3);
    return { G, d, p, W, ok, flashes, hits: G.hits.filter((h) => h.t >= t0), lost: hp0 - p.hp, t0 };
  };
  const A = play(9);
  const x0 = A.d.position.x, z0 = A.d.position.z;
  const inner = A.W.floor.filter((b) => Math.hypot(b.x - x0, b.z - z0) < T.shatter - 0.8);
  const ring = A.W.floor.filter((b) => { const e = Math.hypot(b.x - x0, b.z - z0); return e > T.shatter + 0.5 && e < T.to - 0.5; });
  const h = A.hits.filter((x) => x.tell === TELL.RED);
  const expect = (9 - T.from) / T.speed;
  assert(A.ok && A.flashes.length === 1 && A.flashes[0].tell === TELL.RED && h.length === 1 && h[0].r === RESULT.HIT && Math.abs(h[0].t - A.flashes[0].t - TUNING.flashLead) < 0.08, `the front reaches a hero at 9 m ${(h[0]?.t - A.t0).toFixed(2)} s after the landing (${expect.toFixed(2)} by its speed), one red flare ${(h[0]?.t - A.flashes[0]?.t).toFixed(2)} s before, one blow`);
  assert(inner.length >= 30 && inner.every((b) => b.state !== 0), `every one of the ${inner.length} tiles within ${T.shatter - 0.8} m of the landing broke`);
  assert(ring.filter((b) => b.cracked || b.state !== 0).length >= ring.length * 0.9, `the front heaved ${ring.filter((b) => b.cracked || b.state !== 0).length} of the ${ring.length} slabs it crossed (cracked)`);
  const G = build(SEED, true);
  duel(G, { dist: 9, form: 3 });
  G.defend = makeDefender(G);
  const d = G.game.dragon, p = G.game.player, hp0 = p.hp, t0 = G.game.time;
  d.terrain.quake(d.position.x, d.position.z, {});
  run(G, 4, () => G.defend.act(), () => !d.terrain.busy && G.game.time - t0 > 0.3);
  assert(hp0 - p.hp === 0 && G.hits.some((x) => x.t >= t0 && (x.r === RESULT.DODGED || x.r === RESULT.PERFECT || x.r === RESULT.IGNORED)), `rolled through at the flare: ${hp0 - p.hp} HP lost (${G.hits.filter((x) => x.t >= t0).map((x) => x.r).join(',')})`);
  const I = play(2.5);
  assert(I.hits.length === 0 && I.flashes.length === 0, 'a hero inside `from` at the landing: the front is not his (the leap\'s own blow is)');
  const F = play(17);
  assert(F.hits.length === 0, `a hero past where it stops (${T.to} m): untouched`);
}

/** The ring's wear by form: his AI against a god-mode defender who roams, `GCD_WSECS` s a form (75),
 *  each transformation's nova on the tiles (the class's hook, called here as the class will); how much
 *  of the ring is cracked / broken at each transformation and at the end. */
async function scenarioWear() {
  out('\n== scenario WEAR (the ring visibly worse each form: cracked / broken share of the tiles) ==');
  const SECS = Number(process.env.GCD_WSECS ?? 75);
  const rows = [];
  for (const seed of (process.env.GCD_WSEEDS ?? '4242,7').split(',').map(Number)) {
    const G = build(seed, true);
    const { game } = G;
    duel(G, { dist: 4, ai: true });
    const d = game.dragon, p = game.player, W = game.world.destructibles;
    p.debug.god = true;
    p.debug.noRiposte = true;
    G.defend = makeDefender(G, { world: true });
    const roam = mulberry32(seed * 13), goal = { r: 3, a: 0, until: -1 };
    const tiles = W.floor.filter((b) => b.kind === 'tile');
    const share = () => ({ broken: tiles.filter((b) => b.state !== 0).length / tiles.length, cracked: tiles.filter((b) => b.state === 0 && b.cracked).length / tiles.length });
    const row = [];
    const B = (CONFIG.world.dragonBound ?? 12) - 1;
    const moves = {};
    G.watch = (n, e) => { if (n === 'dragon:windup' && MOVES[e?.name]?.terrain) moves[e.name] = (moves[e.name] || 0) + 1; };
    for (let f = 1; f <= FORMS; f++) {
      if (f > 1) {
        d.debug.setForm(f);
        d.terrain.nova?.(d.position.x, d.position.z, TUNING.transform?.ringRadius ?? 6.5);
      }
      for (let i = 0; i < Math.round(SECS / DT); i++) {
        const rolled = G.defend.act();
        if (game.time > goal.until) {
          goal.r = [2.5, 5, 8][Math.floor(roam() * 3)];
          goal.a = Math.atan2(p.position.x - d.position.x, p.position.z - d.position.z) + (roam() - 0.5) * 1.6;
          goal.until = game.time + 4;
        }
        if (!rolled && p.state !== 'roll') {
          const gx = d.position.x + Math.sin(goal.a) * goal.r, gz = d.position.z + Math.cos(goal.a) * goal.r;
          const k = Math.hypot(gx, gz) > B ? B / Math.hypot(gx, gz) : 1;
          const dx = gx * k - p.position.x, dz = gz * k - p.position.z, l = Math.hypot(dx, dz);
          G.input.axis = l > 0.6 ? { x: dx / l, y: -dz / l } : { x: 0, y: 0 };
        }
        if (d.hp < d.maxHp * 0.3) d.hp = d.maxHp; // (no break: the form runs its full time)
        G.tick(DT);
      }
      const s = share();
      row.push(s);
    }
    rows.push(row);
    out(`     seed ${seed}: ` + row.map((s, i) => `after form ${i + 1}: ${(100 * s.broken).toFixed(0)} % broken, ${(100 * s.cracked).toFixed(0)} % cracked`).join(' · ') + ` · terrain moves ${JSON.stringify(moves)}`);
  }
  const mean = (i, k) => rows.reduce((a, r) => a + r[i][k], 0) / rows.length;
  const worn = [0, 1, 2].map((i) => mean(i, 'broken') + mean(i, 'cracked') * 0.5);
  assert(worn[0] < worn[1] && worn[1] < worn[2] && mean(2, 'broken') >= 0.25, `the ring worse each form: broken ${[0, 1, 2].map((i) => (100 * mean(i, 'broken')).toFixed(0)).join(' → ')} % (cracked ${[0, 1, 2].map((i) => (100 * mean(i, 'cracked')).toFixed(0)).join(' → ')} %), ${SECS} s a form`);
}

// ================================================================== run
// --- integ
/**
 * INTEG (the integration agent): the joins between the second wave's pieces. A beam's head is no
 * trade; a bolt strikes as lightning; while a beam is lit no guard string starts and no Thunderfall is
 * called; the links after a red thing of his; a reset in the middle of everything leaves nothing in the
 * air, lit or lifted and the floor and the light restored; a deathblow on a lit beam; a transformation
 * with the disc out; Heavenfall's quake under a Stone Storm.
 */
async function scenarioInteg() {
  out('\n== scenario INTEG (the pieces together: trades, bolts, the beam\'s bar, links, resets in the middle of things) ==');
  const { LINKS } = await imp('src/entities/enemies/ascendant/links.js');
  const G = build(SEED, true);
  duel(G, { dist: 6, form: 3 });
  const { game } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  const prep = (form, dist) => {
    settle(G, 6);
    run(G, 4, null, () => quiet(d));
    if (d.phase !== form) d.debug.setForm(form);
    run(G, 0.3);
    d.position.set(0, 0, -2);
    d.yaw = 0;
    place(G, dist);
    run(G, 0.2);
  };
  // 1. a trade (_tradeNow) never takes a beam's head (selfHit / sustain); a blow of his body still trades
  const stub = () => {
    const keep = { canTrade: p.canTrade, onTrade: p.onTrade, front: d._fromFront };
    p.canTrade = () => true;
    p.onTrade = () => ({ heavy: false, crush: false });
    d._fromFront = () => true;
    return () => { p.canTrade = keep.canTrade; p.onTrade = keep.onTrade; d._fromFront = keep.front; };
  };
  const tradeAt = (name, pick) => {
    d.debug.trigger(name);
    let res = null, beat = null;
    run(G, 6, () => {
      const a = d.brain.act;
      if (res !== null || !a || a.name !== name) return;
      const b = a.beats.find((x) => !x.done && !x.feint && a.t < x.impact);
      if (b && pick(b) && b.impact - a.t < 0.08) {
        const un = stub();
        res = d._tradeNow();
        un();
        beat = b;
      }
    }, () => res !== null);
    return { res, done: !!beat?.done };
  };
  prep(3, 6);
  const tb = tradeAt('heavenTide', (b) => !!b.def.selfHit);
  prep(1, 2);
  const tg = tradeAt('gates', () => true);
  assert(tb.res === false && !tb.done && tg.res === true, `a trade never takes the great beam's head (${tb.res}, the beat ${tb.done ? 'spent' : 'kept'}); a blow of his body still trades (${tg.res})`);
  // 2. a bolt strikes as lightning
  prep(3, 8);
  p.debug.god = true;
  const h0 = G.hits.length;
  d.debug.trigger('lance');
  run(G, 5, null, () => d.mode === 'foot' && quiet(d));
  const bolts = G.hits.slice(h0).filter((h) => h.attack === 'lance');
  assert(bolts.length > 0 && bolts.every((h) => h.kind === 'lightning'), `Lightning Lance's bolts strike as lightning (${bolts.map((h) => h.kind).join(' ')})`);
  // 3. while a beam is lit: no string asking a guard starts, no Thunderfall is called; a red move may
  prep(1, 10);
  d.debug.trigger('risingTide');
  let barred = null, slot = null, redOk = null;
  run(G, 4, () => {
    const B = d.ki.beams;
    if (barred === null && B.busy && B.phase === 'lit') {
      barred = d.weigh('gates', MOVES.gates, 1, 3) === 0 && d.onActStart({ def: MOVES.gates, name: 'gates' }) === false;
      redOk = d.weigh('piercingPalm', MOVES.piercingPalm, 1, 3) > 0;
      slot = d.ki.shots._skySlot(0.9, 0.6);
    }
  }, () => barred !== null);
  assert(barred === true && slot === -1 && redOk === true, `while the beam is lit a guard string is barred (${barred}), no Thunderfall slot (${slot}); a red closer is not (${redOk})`);
  // 4. after a red thing of his: no guard string among the links (the AFTER_RED rule)
  const guardy = (n) => (MOVES[n]?.beats ?? []).some((b) => (Array.isArray(b.pick) ? b.pick : [b]).some((x) => !x.feint && (x.tell === TELL.NORMAL || x.tell === TELL.BLUE)) && (MOVES[n].beats[0]?.tell === TELL.NORMAL || MOVES[n].beats[0]?.tell === TELL.BLUE));
  const redMoves = ['sunWheel', 'stormCage', 'skyVolley', 'ringBreaker', 'stoneStorm', 'risingTide', 'tideSweep', 'twinTide'];
  const badLinks = redMoves.flatMap((m) => (LINKS[m] ?? []).filter((e) => e.when === 'near' && guardy(e.to)).map((e) => `${m}→${e.to}`));
  const missing = [...redMoves, 'goldenRain', 'scatter', 'spiritShot', 'lance', 'tileKick'].filter((m) => !LINKS[m]?.length);
  const unknown = Object.values(LINKS).flat().map((e) => e.to).filter((n) => !MOVES[n]);
  assert(!badLinks.length && !missing.length && !unknown.length, `links: after a red thing no guard string in reach (${badLinks.join(', ') || 'none'}), every ki / terrain move links (${missing.join(', ') || 'all'}), every target is a move (${unknown.join(', ') || 'all'})`);
  // 5. resets in the middle of things: nothing left in the air, lit or lifted; the floor and the light back
  const amb = game.world.forest.ambience;
  const D = game.world.destructibles;
  const resetCase = (label, form, dist, name, when) => {
    prep(form, dist);
    d.debug.trigger(name);
    let hit = false;
    run(G, 8, null, () => (hit = when()));
    run(G, 0.05);
    game.flow._resetWorld();
    run(G, 0.6);
    const st = amb.state;
    const broken = (D?.floor ?? []).filter((b) => b.kind === 'tile' && b.state !== 0).length;
    const left = { ki: !!d.ki.busy, terrain: !!d.terrain.busy, shots: d.fx.shotsAlive | 0, strikes: d.fx.strikesAlive | 0, y: +d.position.y.toFixed(2), dim: +(st.dim ?? 0).toFixed(2), broken, fire: game.fx.fire.count | 0 };
    const ok = hit && !left.ki && !left.terrain && !left.shots && !left.strikes && left.y === 0 && left.dim < 0.05 && left.broken === 0;
    out(`     ${label}: ${hit ? 'reached' : 'NOT reached'}, after the reset ${JSON.stringify(left)}`);
    return ok;
  };
  const cases = [
    ['the great beam lit', 3, 8, 'heavenTide', () => d.ki.beams.phase === 'lit'],
    ['the great beam charging (the light dimmed)', 3, 8, 'heavenTide', () => (amb.state.dim ?? 0) > 0.3],
    ['the disc out', 2, 8, 'sunWheel', () => (d.fx.shotsAlive | 0) > 0],
    ['the volley in the air', 2, 8, 'skyVolley', () => d.position.y > 2],
    ['the Stone Storm hanging', 2, 9, 'stoneStorm', () => d.terrain.storm?.hold?.some((h) => h.piece)],
    ['Heavenfall\'s quake running', 3, 7, 'heavenfall', () => d.terrain.quakes?.some((q) => q.live)],
    ['the Ring Breaker\'s line', 2, 8, 'ringBreaker', () => !!d.terrain.line?.live],
  ];
  const resets = cases.map(([l, f, m, n, w]) => [l, resetCase(l, f, m, n, w)]);
  assert(resets.every(([, ok]) => ok), `a reset in the middle of each leaves nothing in the air, lit or lifted, the floor whole and the light back (${resets.filter(([, ok]) => !ok).map(([l]) => l).join(', ') || 'all'})`);
  run(G, 0.5);
  duel(G, { dist: 6, form: 3 });
  p.debug.god = true;
  // 6. a deathblow while the great beam is lit: the beam goes out, he transforms / dies cleanly
  prep(2, 8);
  const banners = [], b0 = game.hud.banner;
  game.hud.banner = (t, k) => { banners.push(t); return b0?.call(game.hud, t, k); };
  d.debug.trigger('tideSweep');
  run(G, 4, null, () => d.ki.beams.phase === 'lit');
  const lit = d.ki.beams.phase === 'lit';
  d.debug.postureBreak();
  run(G, 0.3);
  d.onExecute({ damage: 260 });
  run(G, 5, null, () => d.mode === 'foot' && d.phase === 3);
  assert(lit && !d.ki.beams.busy && d.phase === 3 && d.mode === 'foot', `a deathblow while a beam is lit: the beam out (${d.ki.beams.phase}), the transformation done (form ${d.phase}, ${d.mode})`);
  game.hud.banner = b0;
  assert(banners.includes('THUNDER ASCENSION') && d.lives.left === 1 && game.audio._bossPhase?.('boss2') === 3, `... the banner (${banners.join(' / ')}), one pip left (${d.lives.left}), the music on form 3's track (${game.audio._bossPhase?.('boss2')})`);
  // 7. a transformation with the disc in the air: the disc comes back or goes, nothing NaN, he is form 3... (from form 2)
  duel(G, { dist: 8, form: 2 });
  p.debug.god = true;
  prep(2, 8);
  d.debug.trigger('sunWheel');
  run(G, 3, null, () => (d.fx.shotsAlive | 0) > 0);
  const out1 = (d.fx.shotsAlive | 0) > 0;
  d.debug.postureBreak();
  run(G, 0.2);
  d.onExecute({ damage: 260 });
  run(G, 6, null, () => d.mode === 'foot' && d.phase === 3 && quiet(d));
  assert(out1 && d.phase === 3 && quiet(d), `a transformation with the disc in the air: form ${d.phase}, nothing left flying (${d.fx.shotsAlive | 0})`);
  // 8. Heavenfall's quake while a Stone Storm hangs: both run out, nothing stuck
  prep(3, 9);
  d.debug.trigger('stoneStorm');
  run(G, 4, null, () => d.terrain.storm?.hold?.some((h) => h.piece));
  const hang = !!d.terrain.storm?.hold?.some((h) => h.piece);
  d.terrain.quake?.(d.position.x, d.position.z, { from: 3.4, to: 14, speed: 9, damage: 22 });
  run(G, 8, null, () => d.mode === 'foot' && !d.terrain.busy);
  assert(hang && !d.terrain.busy && d.mode === 'foot', `a quake under a hanging Stone Storm: both run out (${hang ? 'hung' : 'never hung'}, busy ${d.terrain.busy})`);
  // 9. the fire field's budget with everything at once (form 3: the aura, the great beam lit, ten blasts
  //    (Golden Rain's count) thrown across it, two called strikes and a quake)
  prep(3, 8);
  const fire = game.fx.fire;
  let peak = 0, thrown = 0, lit9 = 0;
  d.debug.trigger('heavenTide');
  run(G, 8, () => {
    peak = Math.max(peak, fire.count | 0);
    if (d.ki.beams.phase !== 'lit') return;
    lit9++;
    if (lit9 === 1) {
      d.fx.callStrike?.(p.position.x + 2, p.position.z, 2.1, 1.1, { damage: 0, attack: 'thunderfall', style: 'bolt' });
      d.fx.callStrike?.(p.position.x - 2, p.position.z + 1, 2.1, 1.1, { damage: 0, attack: 'thunderfall', style: 'bolt' });
      d.terrain.quake?.(d.position.x, d.position.z, { from: 3.4, to: 14, speed: 9, damage: 0 });
    }
    if (thrown < 10 && lit9 % 9 === 0) {
      thrown++;
      const a = -0.6 + thrown * 0.12;
      d.fx.throwShot({ kind: 'blast', x: d.position.x, y: 1.1, z: d.position.z, dx: Math.sin(d.yaw + a), dz: Math.cos(d.yaw + a), speed: 13, damage: 0, tell: TELL.NORMAL, attack: 'goldenRain', form: 3 });
    }
  }, () => lit9 > 0 && !d.ki.beams.busy && d.mode === 'foot');
  out(`     the fire field with everything at once (form 3: aura, great beam, ${thrown} blasts, 2 strikes, a quake): peak ${peak} blobs of ${fire.max ?? 6000}`);
  assert(thrown === 10 && peak > 0 && peak < 3500, `the fire field's peak with everything at once: ${peak} < 3500 blobs`);
  assert(!G.payload.size, `no non-finite payloads (${[...G.payload].join(', ')})`);
}

// --- pursuit
// The whiff meter (the owner: "make the boss also stop attacking empty air if the player moves out of
// the distance"): every REAL MELEE beat (a zone of his own: not a thrown thing, a cast or a beam) that
// ends `done` with no contact while the hero stands beyond its reach + 1.5 m at its impact is a swing at
// air. God-mode bots that answer every cue (PACE's defender) and move four ways: `roam` (PACE's: 2.5 / 5
// / 9 m goals), `retreat` (the owner's player: sprints straight away whenever he winds up a move, then
// walks back in; at the ring's edge he runs along it and bends back in), `flee` (the same, but at the
// edge he runs along it and drifts off the ring, past the circle the boss keeps to) and `kite` (keeps 6
// - 8 m off). GCD_WSEEDS / GCD_WSECS / GCD_WBOTS; GCD_WMOVES lists every move.
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
      // (the retreating player runs instead of guarding: only a red cue makes him roll)
      if (runs && g.time < runUntil) input.up(1);
      const dx = p.position.x - d.position.x, dz = p.position.z - d.position.z, dist = Math.hypot(dx, dz) || 1;
      let wx = 0, wz = 0, sprint = false;
      if (runs) {
        if (g.time < runUntil) {
          wx = dx / dist; wz = dz / dist; sprint = true;
          // (at the ring's edge: along it, the side away from him, bending back in (retreat) or not (flee))
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

/** A real melee beat: a zone of his own (not a thrown thing unless it became the cut, no cast, no beam). */
const meleeBeat = (b) => !b.feint && !!b.def.zone && !b.def.cast && !b.def.selfHit && (!b.def.release || b.cut === true);

/** One AI run against a bot: the swings at air by move, the swings, the cues, the break-offs. */
function whiffRun(seed, ph, mode, secs) {
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
  const R = { seed, ph, mode, swings: 0, whiffs: 0, short: 0, contacts: 0, by: {}, stopBy: {}, flashes: 0, dist: 0, n: 0, far: 0, stops: d.brain.stats.stops ?? 0 };
  // (the break-offs by move: the reach watch's say, where there is one)
  const oor = d.brain._outOfReach?.bind(d.brain);
  if (oor) d.brain._outOfReach = (a, b, t, s) => { const r = oor(a, b, t, s); if (r) R.stopBy[`${a.name}#${b.hit}`] = (R.stopBy[`${a.name}#${b.hit}`] || 0) + 1; return r; };
  G.watch = (n, e) => { if (n === 'combat:flash' && (e?.source === 'dragon' || e?.source === 'world')) R.flashes++; };
  const t0 = game.time;
  for (let i = 0; i < Math.round(secs / DT); i++) {
    G.defend.act();
    game.mouseGround.set(d.position.x, 0, d.position.z);
    G.tick(DT);
    if (d.brain.pendingPhase > ph) d.brain.pendingPhase = 0;
    const a = d.mode === 'act' ? d.brain.act : null;
    if (a && !a.def.transition) {
      for (const b of a.beats) {
        if (!meleeBeat(b)) continue;
        if (b._far === undefined && a.t >= b.impact) {
          const z = b.def.zone, cc = d.zoneCentre(z, c);
          b._far = Math.hypot(p.position.x - cc.x, p.position.z - cc.z) - (z.r + pr);
        }
        if (b.done && !b._seen && b._far !== undefined) {
          b._seen = true;
          R.swings++;
          if (b._contact || b.cover) { R.contacts++; continue; }
          if (b._far > 1.5) { R.whiffs++; R.by[a.name] = (R.by[a.name] || 0) + 1; } else R.short++;
        }
      }
    }
    const dist = Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z);
    R.dist += dist; R.n++;
    if (dist > 6) R.far++;
  }
  R.T = game.time - t0;
  R.stops = (d.brain.stats.stops ?? 0) - R.stops;
  G.watch = null;
  G.defend = null;
  return R;
}

/** The whiff table: per bot and form, swings / swings at air / a minute, the worst moves. */
function whiffTable(rows) {
  const per = (rs, k) => rs.reduce((a, r) => a + r[k], 0);
  out('   bot     F  swings  contact  short  AIR  air/min  air%  cues/min  dist  far%  stops');
  const sum = {};
  for (const mode of [...new Set(rows.map((r) => r.mode))]) {
    for (let ph = 1; ph <= FORMS; ph++) {
      const rs = rows.filter((r) => r.mode === mode && r.ph === ph);
      if (!rs.length) continue;
      const T = per(rs, 'T'), sw = per(rs, 'swings'), wh = per(rs, 'whiffs');
      const by = {};
      for (const r of rs) for (const [k, v] of Object.entries(r.by)) by[k] = (by[k] || 0) + v;
      const top = Object.entries(by).sort((x, y) => y[1] - x[1]);
      const sb = {};
      for (const r of rs) for (const [k, v] of Object.entries(r.stopBy)) sb[k] = (sb[k] || 0) + v;
      const stopTop = Object.entries(sb).sort((x, y) => y[1] - x[1]);
      const S = (sum[`${mode}${ph}`] = { perMin: (wh * 60) / T, share: wh / (sw || 1), cues: (per(rs, 'flashes') * 60) / T, top, stops: per(rs, 'stops'), contacts: per(rs, 'contacts'), T, dist: per(rs, 'dist') / (per(rs, 'n') || 1), far: per(rs, 'far') / (per(rs, 'n') || 1) });
      out(`   ${mode.padEnd(8)} ${ph} ${String(sw).padStart(7)} ${String(per(rs, 'contacts')).padStart(8)} ${String(per(rs, 'short')).padStart(6)} ${String(wh).padStart(4)} ${S.perMin.toFixed(2).padStart(8)} ${(S.share * 100).toFixed(1).padStart(5)} ${S.cues.toFixed(1).padStart(9)} ${S.dist.toFixed(1).padStart(5)} ${(S.far * 100).toFixed(0).padStart(5)} ${String(S.stops).padStart(6)}   ${top.slice(0, process.env.GCD_WMOVES ? 30 : 6).map(([k, v]) => `${k} ${v}`).join(' · ')}${stopTop.length ? `   (broken off: ${stopTop.slice(0, process.env.GCD_WMOVES ? 30 : 5).map(([k, v]) => `${k} ${v}`).join(' · ')})` : ''}`);
    }
  }
  return sum;
}

async function scenarioWhiff() {
  out('\n== scenario WHIFF (his melee beats that end on nothing with the hero beyond reach + 1.5 m: swings at air) ==');
  const SEEDS = (process.env.GCD_WSEEDS ?? '4242,7,99').split(',').map(Number).filter(Number.isFinite);
  const SECS = Number(process.env.GCD_WSECS ?? 90);
  const BOTS = (process.env.GCD_WBOTS ?? 'roam,retreat,flee,kite').split(',');
  const rows = [];
  for (const mode of BOTS) for (const seed of SEEDS) for (let ph = 1; ph <= FORMS; ph++) rows.push(whiffRun(seed, ph, mode, SECS));
  out(`   ${SECS} s a run, seeds ${SEEDS.join(', ')}`);
  return whiffTable(rows);
}

/**
 * One staged move with his AI on (the reach watch is his AI's): `name` triggered in `form` with the hero
 * `dist` m before him (the boss at `at`, facing +z), `hero(G, a, t)` steering the hero each frame
 * (a: the move while it runs). `pursue: false`: the kit without TUNING.pressure.pursue (as before).
 * Returns the move's glints and results, the break-offs, the hero's distance at the break-off and the
 * closest the boss came in the `after` s that followed.
 */
function chaseCase(name, { form = 1, dist = 2.4, at = [0, -2], hero = null, pursue = true, after = 1.5 } = {}) {
  const PU = TUNING.pressure.pursue;
  if (!pursue) delete TUNING.pressure.pursue;
  try {
    const G = build(SEED, true);
    const { game } = G;
    const d = game.dragon, p = game.player;
    duel(G, { dist, form });
    p.debug.god = true;
    p.debug.noRiposte = true;
    d.position.set(at[0], 0, at[1]);
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
    let stopAt = null, stopDist = 0, closest = Infinity, t0 = game.time, airAt = 0;
    const gap = () => Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z);
    run(G, 6, () => {
      // (a swing at air: a real melee beat of the move that ended with no contact)
      for (const b of A.beats) if (b.done && !b._seenW && meleeBeat(b)) { b._seenW = true; if (!b._contact && !b.cover) airAt++; }
      hero?.(G, d.brain.act === A ? A : null, game.time - t0);
      if (stopAt === null && (d.brain.stats.stops ?? 0) > s0) { stopAt = game.time - t0; stopDist = gap(); }
      if (stopAt !== null) closest = Math.min(closest, gap());
    }, () => stopAt !== null ? game.time - t0 > stopAt + after : d.brain.act !== A && game.time - t0 > 0.5);
    G.watch = null;
    G.input.release('ShiftLeft');
    G.input.up(1);
    G.input.axis = { x: 0, y: 0 };
    const hits = G.hits.slice(h0).filter((h) => h.attack === name);
    // (the blows of what he did after breaking off, in the window: the chase reached the hero)
    const follow = stopAt === null ? [] : G.hits.slice(h0).filter((h) => h.attack !== name && h.t - t0 >= stopAt);
    d.hitPlayer = hp;
    return { G, d, p, A, flashes, hits, follow, stops: (d.brain.stats.stops ?? 0) - s0, stopAt, stopDist, closest, air: airAt };
  } finally {
    if (!pursue) TUNING.pressure.pursue = PU;
  }
}

/** The hero's input toward a direction (world x, z), sprinting or not. */
const steer = (G, wx, wz, sprint = false) => {
  if (sprint) G.input.hold('ShiftLeft'); else G.input.release('ShiftLeft');
  G.input.axis = { x: wx, y: -wz };
};

async function scenarioPursuit() {
  out('\n== scenario PURSUIT (a blow the hero ran out of the reach of breaks off before its glint, and he chases) ==');
  const PU = TUNING.pressure.pursue, pf = (v, ph) => (Array.isArray(v) ? v[Math.min(v.length, ph) - 1] : v);
  const forms = [1, 2, 3];
  assert(PU && PU.margin > 0 && PU.after > 0 && forms.every((f) => pf(PU.closeK, f) >= 1 && pf(PU.dashK, f) >= 1 && pf(PU.closeK, f) >= pf(PU.closeK, f - 1 || 1)),
    `TUNING.pressure.pursue: break off ${PU?.margin} m past what a blow can still reach; the chase by form x${forms.map((f) => pf(PU.closeK, f)).join(' / ')} step-in, x${forms.map((f) => pf(PU.dashK, f)).join(' / ')} dash, never less in a later form`);
  // 1. Aura Burst (form 2: a ring of 4.5 m round him, no step-in): the hero rolls out of it and runs on
  // before its cue: no glint, no hit; he breaks off and chases. Without the pursuit he throws it at air.
  const rollOut = (G, a, t) => {
    if (t < 0.12) return;
    const p = G.game.player, d = G.game.dragon, dx = p.position.x - d.position.x, dz = p.position.z - d.position.z, l = Math.hypot(dx, dz) || 1;
    if (t < 0.6) steer(G, dx / l, dz / l, true);
    if (t > 0.12 && t < 0.15) G.input.tap('Space');
    if (t >= 0.6) steer(G, 0, 0);
  };
  const burst = chaseCase('auraBurst', { form: 2, dist: 2.2, hero: rollOut });
  const burst0 = chaseCase('auraBurst', { form: 2, dist: 2.2, hero: rollOut, pursue: false });
  out(`     Aura Burst rolled out of: broken off at ${burst.stopAt?.toFixed(2)} s with the hero ${burst.stopDist.toFixed(1)} m off, the closest he came in 1.5 s ${burst.closest.toFixed(1)} m, then ${burst.follow.map((h) => `${h.attack} ${h.r}`).join(', ') || 'no blow'}; without the pursuit: ${burst0.flashes.length} glint, ${burst0.air} swing at air`);
  // (he chases: the move he picks after breaking off is a roll, and the gap it leaves is that move's:
  // Tiger Descends' dash runs into him (0.6 m), Golden Gates' strikes stop at a fist's reach (1.2 m).
  // So "chases" is: he closes in and that move's blows reach the hero in the window (who ran on to
  // 6 m: a blow on him there is the chase, whatever reach the move has). The sounds' own
  // random stream (ADR-165) turned this seed's pick from tiger to goldenGates, which the old
  // 1.5 m-closer band missed while every blow of it landed.)
  // (>= 1: under the readable pace, ADR-248, the move he chases with can break off again on a hero still running)
  assert(burst.stops >= 1 && !burst.flashes.length && !burst.hits.length && burst.closest < burst.stopDist && burst.follow.length > 0,
    `Aura Burst, the hero rolls out before its cue: broken off (${burst.stops}), no glint (${burst.flashes.length}), no hit (${burst.hits.length}), and he chases: ${burst.stopDist.toFixed(1)} → ${burst.closest.toFixed(1)} m, ${burst.follow.length} blow${burst.follow.length === 1 ? '' : 's'} of the next move on him`);
  assert(burst0.stops === 0 && burst0.flashes.length === 1 && burst0.air === 1, `without TUNING.pressure.pursue (as before): the burst is thrown at air (${burst0.flashes.length} glint, ${burst0.air} at air)`);
  // 2. ... and a hero who stays in it is hit as before
  const stay = chaseCase('auraBurst', { form: 2, dist: 2.2 });
  assert(stay.stops === 0 && stay.flashes.length === 1 && stay.hits.length === 1 && stay.hits[0].r === RESULT.HIT, `Aura Burst, the hero stays: the glint and the blow as before (${stay.flashes.length} glint, ${stay.hits.map((h) => h.r).join(' ') || 'no hit'})`);
  // 3. a string in reach: Eight Gates against a hero who guards where he stands: every blow, no break-off
  const guard = (G) => G.input.press(1);
  const gates = chaseCase('gates', { form: 1, dist: 2.0, hero: guard });
  const real = gates.A.beats.filter((b) => !b.feint).length;
  assert(gates.stops === 0 && gates.flashes.length === real && gates.hits.length === real, `Eight Gates on a hero who guards in reach: ${gates.flashes.length} glints and ${gates.hits.length} blows of ${real}, ${gates.stops} broken off`);
  // 4. the chase: Tiger Descends' first blow (a dash of 4 m; form 2) on a hero sprinting straight away
  // from 4.5 m: his dash runs x dashK and the blow reaches him; without the pursuit it falls short
  const runAway = (G) => {
    const p = G.game.player, d = G.game.dragon, dx = p.position.x - d.position.x, dz = p.position.z - d.position.z, l = Math.hypot(dx, dz) || 1;
    steer(G, dx / l, dz / l, true);
  };
  const tiger = chaseCase('tiger', { form: 2, dist: 4.5, hero: runAway, at: [0, -9] });
  const tiger0 = chaseCase('tiger', { form: 2, dist: 4.5, hero: runAway, at: [0, -9], pursue: false });
  const first = (r) => (r.A.beats[0]._contact ? 'reaches him' : r.A.beats[0].done ? 'at air' : 'not thrown');
  out(`     Tiger Descends' first blow on a sprinter: ${first(tiger)} (${tiger.flashes.length} glints, ${tiger.hits.length} blows, ${tiger.air} at air, ${tiger.stops} broken off); without the pursuit: ${first(tiger0)} (${tiger0.flashes.length} glints, ${tiger0.hits.length} blows, ${tiger0.air} at air)`);
  assert(tiger.A.beats[0]._contact && tiger.stops === 0 && tiger.air === 0, `Tiger Descends' first blow on a hero sprinting away from 4.5 m: the dash runs on (x${pf(PU.dashK, 2)}) and reaches him (${tiger.hits.map((h) => h.r).join(' ') || 'no hit'}), nothing at air (${tiger.air})`);
  // 5. off the ring: the hero sprints out past the circle he keeps to in Eight Gates' first windup: no
  // step or dash of his gets there; broken off, no glint
  const off = chaseCase('gates', { form: 1, dist: 2.4, at: [0, 11.6], hero: runAway });
  assert(off.stops === 1 && !off.flashes.length && !off.hits.length, `Eight Gates on a hero who runs off the ring (his bound ${off.d.bound.toFixed(1)} m): broken off (${off.stops}), no glint (${off.flashes.length}), no hit`);
  // 6. out of a blink: the reach watch starts where he arrives. Sky Hammer (form 2): the hero launched
  // 11 m, the blink to where he lands, the hammer still lands on him; Sign Step (form 2) on a hero who
  // sprints away from the sign: the vanish leads him (blinkLead) and every blow reaches him or is
  // broken off before its glint, none at air
  const hammer = chaseCase('skyHammer', { form: 2, dist: 1.8 });
  assert(hammer.stops === 0 && hammer.flashes.length === 3 && hammer.hits.length === 3 && hammer.air === 0, `Sky Hammer with his AI on: the launch, the blink to where the hero lands, the hammer on him (${hammer.flashes.length} glints, ${hammer.hits.map((h) => h.r).join(' ')}, ${hammer.stops} broken off)`);
  const sign = chaseCase('signStep', { form: 2, dist: 5, hero: runAway });
  out(`     Sign Step on a sprinter: ${sign.flashes.length} glints, ${sign.hits.map((h) => h.r).join(' ') || 'no blow'}, ${sign.air} at air, ${sign.stops} broken off`);
  assert(sign.air === 0 && sign.flashes.length === sign.hits.length && sign.hits.length + sign.stops >= 1, `Sign Step on a hero who sprints away: every glint is a blow on him (${sign.flashes.length} glints, ${sign.hits.length} blows), none at air (${sign.air})`);
}

// --- tune
// The tuning pass's meters (opt-in, reported, not asserted): PACE's summary over the seeds, the pick
// table (how often each move is picked per form at fixed hero distances), and the Lord suite's mortal
// bots (`probe`: whole fights at 95 / 85 / 70 %; `defend`: a pure defender, two minutes a form).
// Ten seeds for the tables: GCD_PSEEDS=4242,7,99,1337,2024,11,23,555,808,31337 (PACE, picks) and
// GCD_PRSEEDS=... (probe, defend).
const PACE_ROWS = [];
const TEN = '4242,7,99,1337,2024,11,23,555,808,31337';
const stat = (v) => ({ min: Math.min(...v), mean: v.reduce((a, x) => a + x, 0) / (v.length || 1), max: Math.max(...v) });
const f1s = (x) => x.toFixed(1);

/** PACE over the seeds, one line per form, and (GCD_PMOVES) each move's picks per 120 s. */
function paceSummary(rows, CATS) {
  out('   -- summary over the seeds (min / mean / max) --');
  for (let ph = 1; ph <= FORMS; ph++) {
    const rs = rows.filter((r) => r.ph === ph);
    if (!rs.length) continue;
    const c = stat(rs.map((r) => r.perMin)), g = stat(rs.map((r) => r.gapMax)), dg = stat(rs.map((r) => r.dodge * 100)), lg = stat(rs.map((r) => r.linger * 100));
    const prev = rows.filter((r) => r.ph === ph - 1);
    let ramp = '';
    if (prev.length) {
      const m0 = stat(prev.map((r) => r.perMin)).mean;
      const worst = Math.min(...rs.map((r) => { const p = prev.find((x) => x.seed === r.seed); return p ? r.perMin / p.perMin : 9; }));
      ramp = ` · x${(c.mean / m0).toFixed(3)} the form before (worst seed x${worst.toFixed(3)})`;
    }
    const picks = rs.reduce((a, r) => a + r.picks, 0) || 1;
    const mix = CATS.map((k) => [k, rs.reduce((a, r) => a + (r.cats[k] || 0), 0) / picks]).filter((x) => x[1] > 0).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}`).join(' ');
    const sum = (k) => rs.reduce((a, r) => a + r[k], 0);
    out(`   F${ph}: cues/min ${f1s(c.min)} / ${f1s(c.mean)} / ${f1s(c.max)}${ramp} · longest gap max ${g.max.toFixed(2)} mean ${g.mean.toFixed(2)} s · dodge ${dg.min.toFixed(0)} / ${dg.mean.toFixed(0)} / ${dg.max.toFixed(0)} % · lingers ${lg.mean.toFixed(0)} % (${lg.min.toFixed(0)} - ${lg.max.toFixed(0)}) · conflicts ${sum('conflicts')} · holds ${sum('holds')} feints ${sum('feints')} · mix ${mix}${ph >= (TUNING.shots?.weather?.form ?? 3) ? ` · Thunderfall ${stat(rs.map((r) => r.sky)).mean.toFixed(1)}/min (every ${(60 / Math.max(0.01, stat(rs.map((r) => r.sky)).mean)).toFixed(1)} s; ${stat(rs.map((r) => r.sky)).min.toFixed(1)} - ${stat(rs.map((r) => r.sky)).max.toFixed(1)}), slot misses ${sum('skySkips')}` : ''}`);
  }
  if (!process.env.GCD_PMOVES) return;
  for (let ph = 1; ph <= FORMS; ph++) {
    const m = {};
    for (const r of rows.filter((x) => x.ph === ph)) for (const [k, v] of Object.entries(r.fh ?? {})) m[k] = (m[k] || 0) + v;
    const e = Object.entries(m).sort((x, y) => y[1] - x[1]);
    if (e.length) out(`   F${ph} holds / feints (the move held or feinted < what was live): ${e.slice(0, 14).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  }
  out('   -- picks per 120 s (mean of the seeds) by form --');
  const names = MOVE_NAMES.filter((n) => !MOVES[n].transition && !MOVES[n].counter);
  for (const n of names) {
    const v = [1, 2, 3].map((ph) => { const rs = rows.filter((r) => r.ph === ph); return rs.length ? rs.reduce((a, r) => a + (r.moves[n] || 0), 0) / rs.length : 0; });
    out(`   ${n.padEnd(14)} w ${[1, 2, 3].map((f) => String(weightIn(MOVES[n], f)).padStart(4)).join('')} │ ${v.map((x, i) => (weightIn(MOVES[n], i + 1) > 0 ? x.toFixed(1) : '-').padStart(6)).join('')}`);
  }
}

/** A god-mode defender PINNED `r` m from him (the footwork cannot close it: after each frame the hero is
 *  set back on that circle, its bearing drifting slowly; not while he rolls, is down or thrown);
 *  r 'away': 14 m off. */
function holdAt(G, r, roam, goal) {
  const { game } = G, d = game.dragon, p = game.player;
  if (['roll', 'knockdown', 'stagger', 'guardBreak', 'lock', 'bounce'].includes(p.state) || p.kb?.lengthSq?.() > 1) return;
  if (game.time > goal.until) {
    goal.da = (roam() - 0.5) * 0.5;
    goal.until = game.time + 4;
  }
  const R = r === 'away' ? 14 : r;
  const a = Math.atan2(p.position.x - d.position.x, p.position.z - d.position.z) + goal.da * DT;
  let gx = d.position.x + Math.sin(a) * R, gz = d.position.z + Math.cos(a) * R;
  const lim = 34;
  const k = Math.hypot(gx, gz) > lim ? lim / Math.hypot(gx, gz) : 1;
  p.position.x = gx * k;
  p.position.z = gz * k;
  G.input.axis = { x: 0, y: 0 };
}

/** PICKS: how often each move is picked per form with the hero held 2.5 / 5 / 9 m from him, and kept
 *  away (14 m). Seeds GCD_PSEEDS (default three), GCD_PSECS s a run (default 120). */
async function scenarioPicks() {
  out('\n== scenario PICKS (each move\'s picks per form, the hero held 2.5 / 5 / 9 m off and kept away) ==');
  const DIR = await imp('src/entities/enemies/duelist/director.js');
  const SECS = Number(process.env.GCD_PSECS ?? 120);
  const SEEDS = (process.env.GCD_PSEEDS ?? '4242,7,99').split(',').map(Number).filter(Number.isFinite);
  const DISTS = (process.env.GCD_PDISTS ?? '2.5,5,9,away').split(',').map((x) => (x === 'away' ? x : Number(x)));
  const skip = (name) => !MOVES[name] || MOVES[name].transition || MOVES[name].counter;
  const tab = {}; // tab[form][dist] = { moves: {}, cats: {}, picks, secs, flashes, dodge }
  for (const seed of SEEDS) {
    for (let ph = 1; ph <= FORMS; ph++) {
      for (const r of DISTS) {
        const G = build(seed, true);
        const { game } = G;
        const d = game.dragon, p = game.player;
        duel(G, { dist: r === 'away' ? 9 : r, ai: true, form: ph });
        p.debug.god = true;
        p.debug.noRiposte = true;
        G.defend = paceDefender(G);
        Math.random = mulberry32(seed * 7 + ph);
        const cell = ((tab[ph] ??= {})[r] ??= { moves: {}, cats: {}, picks: 0, secs: 0, flashes: 0, dodge: 0, dist: 0, n: 0 });
        G.watch = (n, e) => {
          if (n === 'combat:flash' && (e?.source === 'dragon' || e?.source === 'world')) { cell.flashes++; if (e.tell === TELL.RED || e.tell === TELL.BLACK) cell.dodge++; }
          if (n === 'dragon:windup' && !skip(e?.name)) { cell.picks++; cell.moves[e.name] = (cell.moves[e.name] || 0) + 1; const c = DIR.categoryOf(MOVES[e.name]); cell.cats[c] = (cell.cats[c] || 0) + 1; }
        };
        const roam = mulberry32(seed * 31 + ph), goal = { a: 0, until: -1 };
        const t0 = game.time;
        for (let i = 0; i < Math.round(SECS / DT); i++) {
          const rolled = G.defend.act();
          if (!rolled && p.state !== 'roll') holdAt(G, r, roam, goal);
          game.mouseGround.set(d.position.x, 0, d.position.z);
          G.tick(DT);
          if (d.brain.pendingPhase > ph) d.brain.pendingPhase = 0;
          if ((i & 15) === 0) { cell.dist += Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z); cell.n++; }
        }
        cell.secs += game.time - t0;
        G.watch = null;
        G.defend = null;
      }
    }
  }
  const names = MOVE_NAMES.filter((n) => !skip(n));
  out(`   ${SECS} s a run, seeds ${SEEDS.join(', ')}; picks per 120 s (mean of the seeds); columns per form: ${DISTS.join(' / ')} m`);
  out(`   ${'move'.padEnd(14)} ${'weights'.padEnd(14)}${[1, 2, 3].map((f) => `│ F${f} ${DISTS.map((x) => String(x).padStart(5)).join('')} `).join('')}`);
  for (const n of names) {
    const cells = [1, 2, 3].map((ph) => DISTS.map((r) => { const c = tab[ph]?.[r]; if (!c || !(weightIn(MOVES[n], ph) > 0)) return '    -'; return ((c.moves[n] || 0) * 120 / c.secs).toFixed(1).padStart(5); }).join(''));
    out(`   ${n.padEnd(14)} ${[1, 2, 3].map((f) => String(weightIn(MOVES[n], f))).join('/').padEnd(14)}${cells.map((c) => `│    ${c} `).join('')}`);
  }
  for (let ph = 1; ph <= FORMS; ph++) {
    for (const r of DISTS) {
      const c = tab[ph][r];
      const mix = DIR.CATEGORIES.filter((k) => c.cats[k]).map((k) => `${k} ${((c.cats[k] * 100) / (c.picks || 1)).toFixed(0)}`).join(' ');
      const terr = names.filter((n) => MOVES[n].terrain).reduce((a, n) => a + (c.moves[n] || 0), 0);
      const zero = names.filter((n) => weightIn(MOVES[n], ph) > 0 && !(c.moves[n] > 0));
      out(`   F${ph} at ${String(r).padStart(4)} (held at ${(c.dist / (c.n || 1)).toFixed(1)} m): ${((c.flashes * 60) / c.secs).toFixed(1)} cues/min, dodge ${((c.dodge * 100) / (c.flashes || 1)).toFixed(0)} %, ${((c.picks * 120) / c.secs).toFixed(1)} picks/120 s · ${mix} · terrain ${((terr * 75) / c.secs).toFixed(1)} per 75 s${zero.length ? ` · never picked: ${zero.join(', ')}` : ''}`);
    }
  }
}

/** A mortal fencer (no god mode; lord.mjs's): it answers a share of his cues, cuts in his openings,
 *  gives the deathblows, and drinks below `drinkAt` HP in his openings or out of reach. `attack: false`:
 *  a pure defender (it never swings). */
function mortalFencer(G, { attack = true, drinkAt = 60, execute = true } = {}) {
  const { game, input } = G;
  const p = game.player, d = game.dragon;
  input.axis = { x: 0, y: 0 };
  if (!p.alive || game.state !== 'boss') return;
  const tgt = new THREE.Vector3();
  d.lockPoint(tgt);
  game.mouseGround.set(tgt.x, 0, tgt.z);
  const dx = tgt.x - p.position.x, dz = tgt.z - p.position.z, dist = Math.hypot(dx, dz);
  if (p.state === 'lock') {
    if (((game.realTime * 60) | 0) % 5 === 0) input.click(0);
    return;
  }
  const busy = G.defend.act();
  const tick = (game.realTime * 60) | 0;
  // (GCD_PRDRINK=human: it also drinks in the second half of his move's recovery, as a person would;
  // the Lord suite's bot drinks only in a reaction / break or out of reach, rare under his pressure)
  const ra = d.brain.act;
  const opening = d.broken || d.mode === 'react' || (process.env.GCD_PRDRINK === 'human' && d.mode === 'act' && !!ra && ra.t > ra.recoveryStart);
  if (p.hp < drinkAt && p.flasks > 0 && (opening || dist > 6) && !G.defend.dueWithin(0.7) && ['idle', 'run', 'block'].includes(p.state) && tick % 6 === 0) { input.up(1); input.tap('KeyF'); return; }
  if (dist > 2.6 && !busy) input.axis = { x: dx / dist, y: -dz / dist };
  if (!attack) {
    if (execute && d.broken && dist < 3.2 && tick % 12 === 0) input.click(0);
    return;
  }
  const a = d.brain.act;
  const open = d.broken || (d.mode === 'react' && ['recoil', 'stagger', 'flinch', 'reeling', 'trampled'].includes(d.brain.react?.kind)) || (a && a.t > a.recoveryStart) || p.critTimer > 0;
  if (!busy && dist < 3.2 && (open ? tick % 20 === 0 : tick % 70 === 0)) input.click(0);
}

/** One mortal run: what it measured (hurt from player:hurt, so after the hero's own rules). */
function mortalRun(seed, { skill, form = 1, secs = 600, attack = true, oneForm = false, execute = true } = {}) {
  const G = build(seed, true);
  const { game } = G;
  const d = game.dragon, p = game.player;
  duel(G, { dist: 3, ai: false, form });
  G.defend = makeDefender(G, { skill, rng: mulberry32(seed * 977 + Math.round(skill * 100)), world: true });
  d.debug.setAI(true);
  const formAt = [game.time];
  const hurt = [], flashT = [], breaks = [];
  let curAtk = null;
  const th = p.takeHit.bind(p);
  p.takeHit = (h) => { curAtk = h?.attack ?? null; const r = th(h); curAtk = null; return r; };
  const n = { parries: 0, perfect: 0, dodges: 0, heals: 0, blows: 0 };
  G.watch = (ev, e) => {
    if (ev === 'player:hurt' && e?.damage > 0) {
      const atk = curAtk ?? '';
      const t = game.time;
      const why = G.defend?.stats.skipped.some((x) => x[0] > t - 1.5 && x[1] === atk) ? 'missed' : flashT.some((x) => x[0] > t - 1.5 && x[1] === atk) ? 'ANSWERED' : 'uncued';
      hurt.push([t, e.damage, atk || d.brain.act?.name || d.mode, form + formAt.length - 1, why]);
    }
    if (ev === 'combat:flash' && (e?.source === 'dragon' || e?.source === 'world')) flashT.push([game.time, e.attack]);
    if (ev === 'dragon:postureBreak') breaks.push({ form: form + formAt.length - 1, bar: d.hp <= 0, at: d.hp / TUNING.hp });
    if (ev === 'player:parry') { n.parries++; if (e?.perfect) n.perfect++; }
    if (ev === 'player:perfectDodge') n.dodges++;
    if (ev === 'player:heal') n.heals++;
    if (ev === 'dragon:plunged') n.blows++;
    if (/^dragon:phase[23]$/.test(ev)) formAt.push(game.time);
    // (GCD_PRPOSTURE: where his posture came from: every rise of 25 or more, with what came before)
    if (process.env.GCD_PRPOSTURE) {
      if (ev !== 'dragon:posture' && !ev.startsWith('fx') && ev !== 'combat:tell') { recent.push(ev.replace(/^(dragon|player|combat):/, '')); if (recent.length > 6) recent.shift(); }
      if (ev === 'dragon:posture' && Number.isFinite(e?.posture)) {
        if (e.posture - lastP >= 25) out(`        posture +${(e.posture - lastP).toFixed(0)} → ${e.posture.toFixed(0)}/${e.max} F${d.phase} bar ${(d.hp / d.maxHp * 100).toFixed(0)}% @${(game.time - formAt[0]).toFixed(1)} after ${recent.join(' ')}`);
        lastP = e.posture;
      }
    }
  };
  let lastP = 0;
  const recent = [];
  const t0 = game.time;
  let outcome = 'time';
  run(G, secs, () => {
    mortalFencer(G, { attack, execute });
    if (oneForm && d.brain.pendingPhase > form) d.brain.pendingPhase = 0;
  }, () => {
    if (d.mode === 'dead') { outcome = 'won'; return true; }
    if (!p.alive) { outcome = 'died'; return true; }
    return false;
  });
  G.watch = null;
  G.defend = null;
  const T = game.time - t0;
  let worst1 = 0, worst1At = '';
  for (let i = 0; i < hurt.length; i++) {
    let s = 0;
    const at = [];
    for (let j = i; j < hurt.length && hurt[j][0] - hurt[i][0] <= 1; j++) { s += hurt[j][1]; at.push(hurt[j][2]); }
    if (s > worst1) { worst1 = s; worst1At = at.join('+'); }
  }
  const worst = hurt.reduce((m, h) => (h[1] > m[1] ? h : m), [0, 0, '']);
  const perForm = formAt.map((t, i) => ((formAt[i + 1] ?? game.time) - t));
  const lostByForm = [1, 2, 3].map((f) => hurt.filter((h) => h[3] === f).reduce((a, h) => a + h[1], 0));
  const why = hurt.reduce((m, h) => ((m[h[4]] = (m[h[4]] || 0) + h[1]), m), {});
  const answered = hurt.filter((h) => h[4] !== 'missed').map((h) => `${h[2]} ${h[1].toFixed(0)} ${h[4]} @${(h[0] - t0).toFixed(1)}`);
  const killer = outcome === 'died' ? hurt[hurt.length - 1]?.[2] ?? '?' : null;
  return { seed, skill, outcome, T, why, answered, breaks, form: d.phase, bar: d.hp / TUNING.hp, hp: p.hp, flasks: p.maxFlasks - p.flasks, heals: n.heals, hits: hurt.length, dmg: hurt.reduce((a, h) => a + h[1], 0), worst: worst[1], worstBy: worst[2], worst1, worst1At, perForm, lostByForm, killer, ...n, byMove: hurt.reduce((m, h) => ((m[h[2]] = (m[h[2]] || 0) + h[1]), m), {}) };
}

const ends = (r) => r.breaks.map((b) => `F${b.form}:${b.bar ? 'bar' : `posture@${(b.at * 100).toFixed(0)}%`}`).join(' ') || '-';

/** PROBE: mortal bots that answer 95 / 85 / 70 % of his cues (GCD_PSKILLS), seeds GCD_PRSEEDS,
 *  whole fights (10 minutes at most). Reported, not asserted. */
async function scenarioProbe() {
  out('\n== scenario PROBE (mortal bots, whole fights: answer a share of his cues, cut in his openings, drink below 60 HP) ==');
  const skills = (process.env.GCD_PSKILLS ?? '0.95,0.85,0.7').split(',').map(Number);
  const seeds = (process.env.GCD_PRSEEDS ?? '4242,7,99').split(',').map(Number);
  const all = [];
  for (const skill of skills) {
    for (const seed of seeds) {
      const r = mortalRun(seed, { skill });
      all.push(r);
      out(`   skill ${skill} seed ${String(seed).padEnd(5)} ${r.outcome.padEnd(4)} ${r.T.toFixed(0).padStart(4)} s · form ${r.form} bar ${(r.bar * 100).toFixed(0)} % · forms ${r.perForm.map((x) => x.toFixed(0)).join(' / ')} s · ends ${ends(r)} · HP lost by form ${r.lostByForm.map((x) => x.toFixed(0)).join(' / ')} · damage missed / answered / uncued ${['missed', 'ANSWERED', 'uncued'].map((k) => (r.why[k] ?? 0).toFixed(0)).join(' / ')} · hits ${r.hits} for ${r.dmg.toFixed(0)} · flasks ${r.flasks} · worst blow ${r.worst.toFixed(1)} (${r.worstBy}) · worst second ${r.worst1.toFixed(1)} (${r.worst1At}) · parries ${r.parries} (perfect ${r.perfect}) · perfect dodges ${r.dodges} · deathblows ${r.blows}${r.killer ? ` · killed by ${r.killer}` : ''}`);
      if (process.env.GCD_PRMOVES) out(`        damage by move: ${Object.entries(r.byMove).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · ')}${r.answered.length ? `\n        not missed by choice: ${r.answered.join(' · ')}` : ''}`);
    }
  }
  out('   -- summary by skill --');
  for (const skill of skills) {
    const rs = all.filter((r) => r.skill === skill), won = rs.filter((r) => r.outcome === 'won');
    const T = won.length ? stat(won.map((r) => r.T)) : null;
    const pf = [0, 1, 2].map((i) => won.length ? stat(won.map((r) => r.perForm[i] ?? 0)) : null);
    const kills = rs.filter((r) => r.killer).reduce((m, r) => ((m[r.killer] = (m[r.killer] || 0) + 1), m), {});
    const bars = rs.flatMap((r) => r.breaks).reduce((m, b) => ((m[b.bar ? 'bar' : 'posture'] += 1), m), { bar: 0, posture: 0 });
    const w = rs.reduce((m, r) => (r.worst > m.worst ? r : m), rs[0]), w1 = rs.reduce((m, r) => (r.worst1 > m.worst1 ? r : m), rs[0]);
    out(`   skill ${skill}: won ${won.length} / ${rs.length}${T ? ` in ${T.min.toFixed(0)} / ${T.mean.toFixed(0)} / ${T.max.toFixed(0)} s (forms ${pf.map((s) => (s ? `${s.min.toFixed(0)}-${s.mean.toFixed(0)}-${s.max.toFixed(0)}` : '-')).join(' / ')} s)` : ''} · forms ended by bar ${bars.bar}, by posture ${bars.posture} · HP lost by form (mean) ${[0, 1, 2].map((i) => stat(rs.map((r) => r.lostByForm[i])).mean.toFixed(0)).join(' / ')} · worst blow ${w.worst.toFixed(1)} (${w.worstBy}) · worst second ${w1.worst1.toFixed(1)} (${w1.worst1At}, seed ${w1.seed})${Object.keys(kills).length ? ` · deaths by ${Object.entries(kills).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`);
  }
  return all;
}

/** DEFEND: a mortal pure defender (95 %, never swings, drinks its flasks) against each form for
 *  GCD_DSECS s (default 120; the form is held). Defensive play must not be punished. */
async function scenarioDefend() {
  out('\n== scenario DEFEND (a mortal pure defender, 95 %, two minutes of each form) ==');
  const secs = Number(process.env.GCD_DSECS ?? 120);
  const seeds = (process.env.GCD_PRSEEDS ?? '4242,7,99').split(',').map(Number);
  const skill = Number(process.env.GCD_DSKILL ?? 0.95);
  const all = [];
  for (const seed of seeds) {
    for (let form = 1; form <= FORMS; form++) {
      const r = mortalRun(seed, { skill, form, secs, attack: false, oneForm: true, execute: false });
      all.push({ ...r, f: form });
      out(`   seed ${String(seed).padEnd(5)} form ${form}: ${r.outcome === 'died' ? `DIED at ${r.T.toFixed(0)} s (${r.killer})` : `alive after ${r.T.toFixed(0)} s, ${r.hp.toFixed(0)} HP`} · damage missed / answered / uncued ${['missed', 'ANSWERED', 'uncued'].map((k) => (r.why[k] ?? 0).toFixed(0)).join(' / ')} · hits ${r.hits} for ${r.dmg.toFixed(0)} · flasks ${r.flasks} · worst blow ${r.worst.toFixed(1)} (${r.worstBy}) · worst second ${r.worst1.toFixed(1)} (${r.worst1At}) · parries ${r.parries} · his bar ${(r.bar * 100).toFixed(0)} %`);
      if (process.env.GCD_PRMOVES) out(`        damage by move: ${Object.entries(r.byMove).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · ')}${r.answered.length ? `\n        not missed by choice: ${r.answered.join(' · ')}` : ''}`);
    }
  }
  for (let form = 1; form <= FORMS; form++) {
    const rs = all.filter((r) => r.f === form);
    const w = rs.reduce((m, r) => (r.worst > m.worst ? r : m), rs[0]), w1 = rs.reduce((m, r) => (r.worst1 > m.worst1 ? r : m), rs[0]);
    out(`   form ${form}: alive ${rs.filter((r) => r.outcome !== 'died').length} / ${rs.length} · lowest HP ${Math.min(...rs.map((r) => (r.outcome === 'died' ? 0 : r.hp))).toFixed(0)} · flasks used max ${Math.max(...rs.map((r) => r.flasks))} · HP lost mean ${stat(rs.map((r) => r.dmg)).mean.toFixed(0)} · worst blow ${w.worst.toFixed(1)} (${w.worstBy}) · worst second ${w1.worst1.toFixed(1)} (${w1.worst1At}, seed ${w1.seed})`);
  }
}
//
/**
 * HELDMOTION (ADR-225, `?ascMotion=a`): the switch moves poses only: every move realises with the same
 * beats, windups, impacts and flashes on and off. On, every blue and red blow of the builders has its
 * reworked keys and on his real body is IN its held pose from HELD_AT of the windup to the cock: the
 * striking limb's end within a few cm of where it is held (it tightens, it does not drift), drawn back
 * from where it strikes; a normal blow keeps its keys. The snap blows: weighed only with the switch, a
 * short white windup, and a fight with the switch on raises nothing.
 */
async function scenarioHeldMotion() {
  out('\n== scenario HELDMOTION (?ascMotion=a: the same timings, a held windup pose on every blue and red blow, the snap blows) ==');
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const { MOTION } = await imp('src/entities/enemies/ascendant/moves.js');
  const { HELD_AT } = await imp('src/entities/enemies/ascendant/motion.js');
  // 1. timings identical on and off
  let n = 0, diff = [];
  for (const name of MOVE_NAMES) for (let ph = 1; ph <= 3; ph++) for (const r of [0.001, 0.5, 0.999]) {
    LS.setLook('ascMotion', '0');
    const a = realise(name, ph, () => r);
    LS.setLook('ascMotion', 'a');
    const b = realise(name, ph, () => r);
    if (!a || !b) continue;
    n++;
    const sig = (m) => m.beats.map((x) => [x.start, x.impact, x.end, x.flash, x.W, x.H].map((v) => v.toFixed(5)).join(',')).join(';') + `|${m.end.toFixed(5)}`;
    if (sig(a) !== sig(b)) diff.push(`${name}/${ph}`);
  }
  LS.setLook('ascMotion', null);
  assert(n > 300 && !diff.length, `${n} realisations: the same beats, windups, impacts, flashes and ends with the switch on and off (${diff.slice(0, 6).join(', ') || 'all'})`);
  // 2. which beats are reworked: every blue / red builder blow (not a stepped one), no normal one
  const beats = [];
  for (const [name, def] of Object.entries(MOVES)) for (const b0 of def.beats) for (const b of b0.pick ?? [b0]) beats.push([name, b]);
  const want = beats.filter(([, b]) => b.mo && (b.tell === TELL.BLUE || b.tell === TELL.RED) && !b.mo.step && !(b.mo.fam === 'kick' && b.mo.kind === 'sweep'));
  const missing = want.filter(([, b]) => !MOTION.keysFor(b)).map(([n]) => n);
  const normal = beats.filter(([, b]) => b.tell === TELL.NORMAL && MOTION.keysFor(b)).map(([n]) => n);
  assert(want.length >= 30 && !missing.length && !normal.length, `${want.length} blue and red builder blows have held keys (${missing.join(', ') || 'all'}), no normal blow is reworked (${normal.join(', ') || 'none'})`);
  // 3. on his body: in the held pose from HELD_AT to the cock
  const rows = [];
  for (const [name, f] of [['piercingPalm', 1], ['tiger', 1], ['skyHammer', 2], ['heavenEarth', 3], ['hundred', 1]]) {
    for (const opt of ['0', 'a']) {
      LS.setLook('ascMotion', opt);
      const G = build();
      duel(G, { dist: 3, form: f });
      const d = G.game.dragon, p = G.game.player;
      p.debug.god = true;
      settle(G, 2);
      d.position.set(0, 0, -2);
      d.yaw = 0;
      place(G, 2.6);
      run(G, 0.3);
      if (!d.debug.trigger(name)) { rows.push({ name, opt, fail: true }); continue; }
      const A = d.brain.act;
      const hb = A.beats.find((b) => b.def.tell === TELL.BLUE || b.def.tell === TELL.RED);
      const cockT = hb.start + (hb.def.cock ?? 0.7) * hb.W, heldT = hb.start + Math.min(HELD_AT, (hb.def.cock ?? 0.7) - 0.2) * hb.W;
      const inv = new THREE.Matrix4(), pts = [];
      let atHit = null;
      for (let i = 0; i < 600 && d.brain.act === A; i++) {
        G.tick(DT);
        p.hp = p.maxHp;
        if (A.t >= heldT && A.t <= cockT) {
          d.rig.root.updateMatrixWorld(true);
          inv.copy(d.rig.root.matrixWorld).invert();
          pts.push(d._tip.clone().applyMatrix4(inv));
        }
        if (!atHit && A.t >= hb.impact) {
          d.rig.root.updateMatrixWorld(true);
          inv.copy(d.rig.root.matrixWorld).invert();
          atHit = d._tip.clone().applyMatrix4(inv);
        }
      }
      let drift = 0;
      for (const q of pts) drift = Math.max(drift, q.distanceTo(pts[0]));
      rows.push({ name, opt, hold: +(cockT - heldT).toFixed(2), drift: +drift.toFixed(2), drawn: pts.length && atHit ? +pts[0].distanceTo(atHit).toFixed(2) : 0 });
    }
  }
  LS.setLook('ascMotion', null);
  for (const r of rows) out(`   ${r.name.padEnd(13)} ${r.opt}: ${r.fail ? 'no trigger' : `held ${r.hold} s: the striking end moves ${r.drift} m, ${r.drawn} m back from its strike`}`);
  const on = rows.filter((r) => r.opt === 'a' && !r.fail), off = rows.filter((r) => r.opt === '0' && !r.fail);
  assert(on.length === 5 && on.every((r) => r.drift <= 0.16 && r.drawn >= 0.3), `with the switch every blow sits in its held pose from u ${HELD_AT} to the cock: the striking end moves <= 0.16 m (${on.map((r) => r.drift).join(', ')}) and is drawn >= 0.3 m back (${on.map((r) => r.drawn).join(', ')})`);
  assert(on.reduce((s, r) => s + r.drift, 0) < off.reduce((s, r) => s + r.drift, 0), `... where before it was still drifting into its coil (${off.map((r) => r.drift).join(', ')} m)`);
  // 4. the snap blows: weighed only with the switch, short and white, and a fight with them raises nothing
  const snaps = MOVE_NAMES.filter((k) => MOVES[k].snap);
  const G = build();
  duel(G, { dist: 1.8 });
  const d = G.game.dragon;
  LS.setLook('ascMotion', '0');
  const w0 = snaps.map((k) => d.weigh(k, MOVES[k], 1, 1.5));
  LS.setLook('ascMotion', 'a');
  const w1 = snaps.map((k) => d.weigh(k, MOVES[k], 1, 1.5));
  assert(snaps.length === 2 && w0.every((w) => w === 0) && w1.every((w) => w > 0), `the snap blows (${snaps.join(', ')}) weigh 0 without the switch, ${w1.join(', ')} with it`);
  const S = TUNING.snap;
  const bad = [];
  for (const k of snaps) for (let ph = 1; ph <= 3; ph++) {
    const b = realise(k, ph, () => 0.5).beats[0];
    if (!(b.def.tell === TELL.NORMAL && b.W >= S.min && b.W <= 0.34 && b.def.damage <= S.maxDamage && b.flash > b.tellAt + 0.02)) bad.push(`${k}/${ph} W ${b.W.toFixed(2)}`);
  }
  assert(!bad.length, `a snap is white, winds up ${S.min} - 0.34 s in every form (unscaled), deals <= ${S.maxDamage} and flashes after its tell (${bad.join(', ') || 'all'})`);
  const G2 = build(SEED + 7);
  duel(G2, { dist: 2.4, ai: true });
  G2.game.player.debug.god = true;
  G2.defend = makeDefender(G2, { style: 'mixed' });
  const used = new Set();
  let nan = 0;
  for (let i = 0; i < 60 * 40; i++) {
    G2.defend.act();
    G2.tick(DT);
    const a = G2.game.dragon.brain.act;
    if (a) used.add(a.name);
    const t = G2.game.dragon._tip;
    if (!Number.isFinite(t.x + t.y + t.z)) nan++;
  }
  LS.setLook('ascMotion', null);
  assert(!nan && used.size >= 5, `40 s of his AI with the switch on: ${used.size} moves (${[...used].filter((k) => MOVES[k]?.snap).join(', ') || 'no snap drawn'} among them), no NaN`);
}

/**
 * LIMBS (ADR-248, `?ascMotion=b`): the straight limbs. Poses only, on top of `a`: every move realises with
 * the same timings as `a`; every straight blow's contact key puts its hand `armReach` x the arm out on the
 * line from its shoulder to his centre line, every kick's its foot `legReach` x the leg from its hip; the
 * other beats' keys are `a`'s. On his body: the punches land with the arm long (>= 165 deg at the elbow) and
 * their fists near his centre line, the kicks with the leg straight (>= 165 deg at the knee), the sweep's
 * knees no longer flip (Eight Gates' worst jolt was 709 mm/f2) and the animator carries the kick out.
 */
async function scenarioLimbs() {
  out('\n== scenario LIMBS (?ascMotion=b: long punches in one line, straight kicks, the sweep from a drop stance) ==');
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const { MOTION } = await imp('src/entities/enemies/ascendant/moves.js');
  const { LIMBS, hipOf } = await imp('src/entities/enemies/ascendant/motion.js');
  const { DIM } = await imp('src/entities/player/model.js');
  const T = TUNING.limbs;
  // 1. timings identical to `a`
  let n = 0;
  const diff = [];
  const sig = (m) => m.beats.map((x) => [x.start, x.impact, x.end, x.flash, x.W, x.H].map((v) => v.toFixed(5)).join(',')).join(';') + `|${m.end.toFixed(5)}`;
  for (const name of MOVE_NAMES) for (let ph = 1; ph <= 3; ph++) for (const r of [0.001, 0.999]) {
    LS.setLook('ascMotion', 'a');
    const a = realise(name, ph, () => r);
    LS.setLook('ascMotion', 'b');
    const b = realise(name, ph, () => r);
    if (!a || !b) continue;
    n++;
    if (sig(a) !== sig(b)) diff.push(`${name}/${ph}`);
  }
  LS.setLook('ascMotion', null);
  assert(n > 200 && !diff.length, `${n} realisations: the same beats, windups, impacts, flashes and ends as a (${diff.slice(0, 6).join(', ') || 'all'})`);
  // 2. the keys: straight blows long, kicks long, the rest a's
  const beats = [];
  for (const [name, def] of Object.entries(MOVES)) for (const b0 of def.beats) for (const b of b0.pick ?? [b0]) if (b.mo) beats.push([name, b]);
  let punches = 0, kicks = 0, same = 0;
  const shortP = [], shortK = [], changed = [];
  for (const [name, b] of beats) {
    const kb = MOTION.limbKeysFor(b), ka = MOTION.keysFor(b) ?? b.keys;
    const hb = kb?.find(([u]) => Math.abs(u - 1) < 1e-6)?.[1];
    const st = (b.mo.fam === 'punch' && LIMBS.STRAIGHT.has(b.mo.kind)) || b.mo.fam === 'bolt', kk = b.mo.fam === 'kick' && LIMBS.KICKS.has(b.mo.kind);
    if (st && hb) {
      const hs = b.part === 'palms' && b.mo.kind === 'double' ? ['rH', 'lH'] : b.part === 'fistL' ? ['lH'] : ['rH'];
      for (const h of hs) {
        punches++;
        if (!(Math.hypot(...hb[h]) >= T.armReach * LIMBS.L_ARM * 0.99)) shortP.push(`${name}:${b.mo.kind}`);
      }
    } else if (kk && hb) {
      const f = b.part === 'footL' ? 'lF' : 'rF', v = hb[f];
      if (Array.isArray(v) && v.length === 3) {
        kicks++;
        const h = hipOf(hb, f === 'lF' ? 1 : -1), l = Math.hypot(v[0] - h[0], v[1] - h[1], v[2] - h[2]);
        if (!(l >= T.legReach * LIMBS.L_LEG * 0.97 || v[1] <= DIM.ankle + 1e-6)) shortK.push(`${name}:${b.mo.kind} ${l.toFixed(2)}`);
      }
    } else {
      same++;
      if (JSON.stringify(kb) !== JSON.stringify(ka)) changed.push(`${name}:${b.mo.fam}/${b.mo.kind ?? ''}`);
    }
  }
  assert(punches >= 40 && !shortP.length, `${punches} straight blows put the hand ${T.armReach} x the arm out at contact (${shortP.slice(0, 5).join(', ') || 'all'})`);
  assert(kicks >= 15 && !shortK.length, `${kicks} kicks put the foot ${T.legReach} x the leg from its hip at contact (${shortK.slice(0, 5).join(', ') || 'all'})`);
  assert(same >= 20 && !changed.length, `${same} other builder blows (hooks, uppercuts, elbows, knees, the shoulder, the hammer) keep a's keys (${changed.slice(0, 5).join(', ') || 'all'})`);
  // 3. on his body
  LS.setLook('ascMotion', 'b');
  const { rows } = auditMoves(['hundred', 'gates', 'stormWaltz', 'streakFlurry2'], [false]);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  const fists = ['hundred', 'stormWaltz'].flatMap((m) => by[m].contact.filter((c) => (c.part === 'fistR' || c.part === 'fistL') && c.own));
  const straightF = fists.filter((c) => c.elbow >= 165);
  assert(fists.length >= 8 && straightF.length >= fists.length - 2, `the straight punches land with the arm long: elbows ${fists.map((c) => c.elbow).join(' ')} deg (>= 165; the hooks keep their bend)`);
  const centre = by.hundred.contact.filter((c) => c.part === 'fistR' || c.part === 'fistL').map((c) => Math.abs(c.own[0]));
  assert(centre.length >= 7 && Math.max(...centre) < 0.14, `... down his centre line: the fists at most ${Math.max(...centre).toFixed(2)} m off it in his frame (were 0.17 - 0.24 across it)`);
  const feet = ['gates', 'stormWaltz', 'streakFlurry2'].flatMap((m) => by[m].contact.filter((c) => c.part === 'footR' || c.part === 'footL'));
  assert(feet.length >= 4 && feet.every((c) => c.knee >= 155), `the kicks land with the leg straight: knees ${feet.map((c) => c.knee).join(' ')} deg (>= 155; the roundhouses were ~100)`);
  const jolt = Math.round(Math.max(by.gates.pb.v, by.gates.pw.v));
  assert(jolt < 520, `the sweep's knees no longer flip: Eight Gates' worst jolt ${jolt} mm/f2 (was 709 at the sweep)`);
  // 4. the animator, live
  {
    const G = build();
    const d = G.game.dragon;
    duel(G, { dist: 3 });
    run(G, 0.1);
    const on = d.anim.kickStretch === T.kickStretch && d.anim.legSoft === T.legSoft && d.anim.armSoft === T.armSoft;
    LS.setLook('ascMotion', 'a');
    run(G, 0.1);
    const off = d.anim.kickStretch === null && d.anim.legSoft === TUNING.legSoft && d.anim.armSoft === TUNING.armSoft;
    assert(on && off, 'the arms and legs open further and the kick is carried out on b only (anim armSoft / legSoft / kickStretch, live)');
  }
  LS.setLook('ascMotion', null);
}

/**
 * READABLE (ADR-248, `?ascPace=a`, the owner's pick: the default): his blows at COMBAT rule 10's floor. Under it every move (not a
 * snap blow, not a transformation) has its first real blow at least pace.first s (x the form's windupScale)
 * after its start, its later real blows at least pace.gap s apart, the cue pace.flashLead s before each
 * impact (never before its tell), the time a held cock (its keys as they were, the hold longer); off, it is
 * exactly as shipped (`?ascPace=0`).
 */
async function scenarioReadable() {
  out('\n== scenario READABLE (?ascPace=a: first blows >= 0.7 s, blows >= 0.45 s apart, the cue 0.35 s before) ==');
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const { PACED } = await imp('src/entities/enemies/ascendant/pace.js');
  const P = TUNING.pace;
  let n = 0;
  const bad = [], same = [];
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    for (const f of formsOf(name)) for (const r of [0.001, 0.999]) {
      LS.setLook('ascPace', '0');
      const A0 = realise(name, f, () => r);
      LS.setLook('ascPace', null);
      const A = realise(name, f, () => r);
      if (!A || !A0) continue;
      // (off: the realiser's own cue; on: the same windups, only the holds longer)
      const lead0 = Array.isArray(TUNING.flashLead) ? TUNING.flashLead[f - 1] : TUNING.flashLead;
      if (A0.beats.some((b) => Math.abs(b.impact - b.flash - lead0) > 1e-6)) same.push(`${name}/${f} cue`);
      if (A0.beats.length !== A.beats.length || A0.beats.some((b, i) => Math.abs(b.W - A.beats[i].W) > 1e-6 || A.beats[i].H < b.H - 1e-6)) same.push(`${name}/${f} windup`);
      if (PACED.exempt(def)) {
        // (an exempt move: as it shipped)
        if (A.beats.some((b, i) => Math.abs(b.impact - A0.beats[i].impact) > 1e-6 || Math.abs(b.flash - A0.beats[i].flash) > 1e-6)) bad.push(`${name}/${f} exempt moved`);
        continue;
      }
      n++;
      const ws = Array.isArray(TUNING.windupScale) ? TUNING.windupScale[f - 1] : 1;
      // (a ki beat keeps its own windup and cue; it still counts in the run before the blow after it)
      const real = A.beats.filter((b) => !b.feint && (b.def.damage ?? 0) > 0);
      if (real.length && !PACED.spell(real[0].def) && !PACED.runIn(real[0].def) && real[0].impact - real[0].start < P.first * ws - 1e-6) bad.push(`${name}/${f} first ${(real[0].impact - real[0].start).toFixed(2)}`);
      for (let i = 1; i < real.length; i++) if (!PACED.spell(real[i].def) && !PACED.runIn(real[i].def) && real[i].impact - real[i - 1].impact < P.gap - 1e-6) bad.push(`${name}/${f} gap ${(real[i].impact - real[i - 1].impact).toFixed(2)}`);
      for (const b of A.beats) if (Math.abs(b.flash - (PACED.spell(b.def) ? b.impact - lead0 : Math.max(b.tellAt, b.impact - P.flashLead))) > 1e-6) bad.push(`${name}/${f} cue`);
    }
  }
  LS.setLook('ascPace', null);
  assert(n > 60 && !bad.length, `${n} realisations under the pace: first blows >= ${P.first} s x the form, blows >= ${P.gap} s apart, the cue ${P.flashLead} s before; ki beats keep their cue, a blow he dashes in for its windup, counters / flurries / snaps / hazards / floor pieces as shipped (${bad.slice(0, 5).join(', ') || 'all'})`);
  assert(!same.length, `off, the cue is the realiser's own; on, the same windups, only the held cock longer (${same.slice(0, 5).join(', ') || 'all'})`);
}

/**
 * SHOTCOST (opt-in, ADR-248): what each blast look costs the effects: the live fire-field blobs and glyph
 * particles while he throws Spirit Shot (form 1) and Raining Suns (form 2), peak and mean a frame, per
 * `?ascShot` option. A table, no assertions (`npm run perf` stages a still fight: it never sees a blast).
 */
async function scenarioShotCost() {
  out('\n== scenario SHOTCOST (the blast looks: fire blobs and glyph particles a frame) ==');
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  for (const [name, form, dist] of [['spiritShot', 1, 6], ['rainingSuns', 2, 6]]) {
    for (const L of ['0', 'a', 'b']) {
      LS.setLook('ascShot', L);
      const G = build();
      const { game } = G, d = game.dragon;
      duel(G, { dist, form });
      game.player.debug.god = true;
      run(G, 0.5);
      d.debug.trigger(name);
      const A = d.brain.act;
      let n = 0, sumF = 0, peakF = 0, sumP = 0, peakP = 0;
      run(G, 6, () => {
        const f = game.fx.fire.count, p = game.fx.add.count + game.fx.alpha.count;
        n++;
        sumF += f;
        sumP += p;
        peakF = Math.max(peakF, f);
        peakP = Math.max(peakP, p);
      }, () => d.brain.act !== A);
      out(`   ${name.padEnd(12)} ${L}: fire blobs peak ${String(peakF).padStart(5)} mean ${String(Math.round(sumF / Math.max(1, n))).padStart(5)}   glyphs peak ${String(peakP).padStart(5)} mean ${String(Math.round(sumP / Math.max(1, n))).padStart(5)}   (${n} frames)`);
    }
  }
  LS.setLook('ascShot', null);
}

const S = {
  level: scenarioLevel,
  data: scenarioData,
  timing: scenarioTiming,
  forms: scenarioForms,
  flare: scenarioFlare,
  // (its lock check: ?dbLock=lock, the deathblow does not take the perfect blue parry from the blade lock; ADR-280)
  bare: async () => {
    const M = await imp('src/entities/player/deathblow.js'), m0 = M.dbLockMode();
    M.setDbLock('lock');
    try {
      return await scenarioBare();
    } finally {
      M.setDbLock(m0);
    }
  },
  engine: scenarioEngine,
  pace: scenarioPace,
  bounds: scenarioBounds,
  flow: scenarioFlow,
  win: scenarioWin,
  training: scenarioTraining,
  // --- shots
  shots: scenarioShots,
  weather: scenarioWeather,
  lantern: scenarioLantern,
  suns: scenarioSuns,
  //
  // --- beams
  beams: scenarioBeams,
  clash: scenarioClash,
  beamworld: scenarioBeamWorld,
  instant: scenarioInstant,
  orbc: scenarioOrbC,
  // --- strings
  motion: scenarioMotion,
  strings: scenarioStrings,
  sign: scenarioSign,
  catch: scenarioCatch,
  ripostes: scenarioRipostes,
  // --- body
  body: scenarioBody,
  herolike: scenarioHeroLike,
  motionfix: scenarioMotionFix,
  heldmotion: scenarioHeldMotion,
  limbs: scenarioLimbs,
  readable: scenarioReadable,
  //
  //
  // --- terrain
  terrain: scenarioTerrain,
  quake: scenarioQuake,
  wear: scenarioWear,
  // --- integ
  integ: scenarioInteg,
  // --- pursuit
  pursuit: scenarioPursuit,
  // --- the contact pass (ADR-259, ?contact=a): fists and feet drawn on what they strike, the rules unmoved
  contact: async () => {
    out('\n== scenario CONTACT (fists and feet drawn ON what they strike; the rules unmoved; ADR-259) ==');
    const { contactCheck } = await import('./contactCheck.mjs');
    const home = (G) => { const d = G.game.dragon, Sl = CONFIG.world.dragonSleep; d.position.set(Sl.x, 0, Sl.z); d.yaw = 0; };
    const moves = ['hundred', 'riposte', 'gates', 'snapJab', 'piercingPalm'].filter((n) => MOVES[n]);
    return contactCheck({ THREE, imp, build, duel, place, run, settle, home, DT, assert, out, RESULT, moves });
  },
};
// (one parry, ADR-279: ?parry=one, the default, makes every parry perfect. These scenarios press a PLAIN parry on purpose
// (a perfect one would lock the blades, break him, or send a shot back): they run with ?parry=two)
{
  const RULES = await imp('src/combat/rules.js');
  for (const k of ['flare', 'shots', 'lantern', 'clash']) {
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
// --- tune (opt-in: run only when named)
const OPT_IN = { shotcost: scenarioShotCost, picks: scenarioPicks, probe: scenarioProbe, defend: scenarioDefend, audit: scenarioAudit, auditfight: scenarioAuditFight, whiff: scenarioWhiff,
  // (the bench, tests/integration/bench.mjs: the same mortal bots as veil.mjs)
  bench: async () => { const { benchScenario } = await import('./bench.mjs'); return benchScenario({ build, duel, run, TUNING, TELL, DT, THREE, out, mulberry32 }, 'asc'); } };
// GCD_SKIP (a comma list) leaves scenarios out of `all` (tests/run.mjs runs the long ones as
// processes of their own, so a new scenario lands in `all`)
const SKIP = new Set((process.env.GCD_SKIP ?? '').split(',').map((s) => s.trim()).filter(Boolean));
for (const k of SKIP) if (!S[k]) { out(`unknown scenario in GCD_SKIP: ${k}`); process.exit(2); }
const list = SCEN === 'all' ? Object.keys(S).filter((k) => !SKIP.has(k)) : SCEN.split(',');
if (SCEN === 'all' && SKIP.size) out(`\n(not run here, GCD_SKIP: ${[...SKIP].join(', ')})`);
// (GCD_LOOK='ascPace=0,ascMotion=a': look switches forced for the whole run, a bisect against the looks before)
{
  const LS = await imp('src/entities/enemies/duelist/lookSwitch.js');
  for (const kv of (process.env.GCD_LOOK ?? '').split(',').filter(Boolean)) LS.setLook(...kv.split('='));
}
for (const k of list) {
  if (OPT_IN[k]) S[k] = OPT_IN[k];
  if (!S[k]) { out(`unknown scenario ${k}`); process.exit(2); }
  await S[k]();
}
const notCat = [...EMITTED].filter((n) => !CATALOGUE.has(n) && n !== 'state');
assert(!notCat.length, `every event this level emits is in the catalogue ${JSON.stringify(notCat)}`);
out(`\nconsole errors/warnings: ${errors.length}${errors.length ? '\n  ' + [...new Set(errors)].slice(0, 12).join('\n  ') : ''}`);
if (errors.length) fails++;
out(fails ? `\nASC: ${fails} FAILED` : '\nASC: ALL PASSED');
process.exit(fails ? 1 : 0);
