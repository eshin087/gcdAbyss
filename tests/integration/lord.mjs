// The Starless level and the Starless Lord, headless (COMBAT.md → "The Starless Lord"): the REAL
// Player, StarlessLord, Hud, GameFlow, AudioEngine and Lab (+ real LightPool, GlyphParticles,
// CameraRig, Events) wired like src/main.js for `?level=starless`; the world is a light mock on the
// real Colliders, filled by the real throne-hall set. A bot drives the input.
// usage: node lord.mjs <repoRoot> [scenario]   (env: ABYSS_SEED=n reseeds the AI)
//   scenario: level | data | timing | forms | spells | bounds | flow | win | all
// (the spells scenario also covers the Crushing Dark, the Rift, the Dark Star, Parting Light and the glide)
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
const { TELL, RESULT, POSTURE } = await imp('src/combat/rules.js');
const { LEVELS, getLevel, levelFromSearch, applyLevel } = await imp('src/levels/index.js');
const { createThroneHall, HALL } = await imp('src/world/throneHall.js');
const { Player } = await imp('src/entities/player/player.js');
const { StarlessLord } = await imp('src/entities/enemies/starlessLord/lord.js');
const { Duelist } = await imp('src/entities/enemies/duelist/duelist.js');
const { MOVES, MOVE_NAMES, CLIPS_BY_FORM, COUNTERS, TRANSITIONS, realise } = await imp('src/entities/enemies/starlessLord/moves.js');
const { TUNING } = await imp('src/entities/enemies/starlessLord/tuning.js');
const { LORD_LOOKS, LORD_CAPE, LORD_PANELS, lordLoadout } = await imp('src/entities/enemies/starlessLord/gear.js');
const { buildHero } = await imp('src/entities/player/model.js');
const { Hud } = await imp('src/ui/hud.js');
const { Bindings, installActions } = await imp('src/core/bindings.js');
const { TouchControls } = await imp('src/ui/touch.js');
const { AudioEngine } = await imp('src/audio/audio.js');
const { GameFlow } = await imp('src/game/flow.js');
const { Lab } = await imp('src/dev/lab.js');

const LVL = getLevel('starless');
const errors = [];
console.error = (...a) => { errors.push(a.map((x) => (x?.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x))).join(' ')); };
console.warn = (...a) => { errors.push('WARN ' + a.map(String).join(' ')); };
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
let fails = 0;
const assert = (c, m) => { if (!c) { fails++; out('FAIL', m); } else out('ok  ', m); };
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SEED = Number(process.env.ABYSS_SEED ?? 4242);
const DT = 1 / 60;
const FORMS = TUNING.forms;
const weightIn = (def, f) => (Array.isArray(def.weight) ? def.weight[f - 1] ?? 0 : def.weight ?? 0);
/** The forms a move is used in (its weight; a counter: its own form; a transition: the form it begins). */
const formsOf = (name) => {
  const def = MOVES[name];
  if (def.transition) return [def.phase - 1];
  if (def.counter) return [COUNTERS.indexOf(name) + 1].filter((f) => f > 0);
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
// the hall's real colliders (pillars, walls, braziers, the dais's edge), built once
const HALL_SET = (() => {
  const c = new Colliders();
  const set = createThroneHall(createSharedUniforms(), c);
  return { set, circles: c.circles.map((k) => ({ ...k })) };
})();

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
    release(code) { if (!keys.delete(code)) return; rk.add(code); },
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
  for (const k of HALL_SET.circles) colliders.add(k.x, k.z, k.r, k.tag);
  const counters = { spawns: 0, flares: 0, burns: 0 };
  const world = {
    colliders, bonfire: { ...CONFIG.world.bonfire }, nest: { x: 0, z: HALL.throne.z },
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
  const game = {
    THREE, CONFIG, level: LVL, levels: LEVELS.map((L) => ({ id: L.id, name: L.name })), pickLevel() {},
    renderer: null, scene, fxScene: new THREE.Scene(), camera, pipeline: { finalMat: { uniforms: { uHurt: { value: 0 }, uFade: { value: 0 }, uDesat: { value: 0 }, uWarm: { value: 0 }, uExposure: { value: 1 }, uBloom: { value: 1 } } } }, U,
    events: new Events(), input, cameraRig: new CameraRig(camera), lights: new LightPool(U),
    fx: { alpha: mkParticles({ max: 3000, additive: false }), add: mkParticles({ max: 7000, additive: true }) },
    time: 0, realTime: 0, timeScale: 1, debugTimeScale: 1, hitstopTimer: 0, hitstopScale: 1,
    mouseGround: new THREE.Vector3(), state: 'title', settings: { quality: CONFIG.defaultQuality, showFps: false },
    hitstop(seconds, scale = 0.04) { this.hitstopTimer = Math.max(this.hitstopTimer, seconds); this.hitstopScale = Math.min(this.hitstopScale, scale); },
    shake(a) { if (!Number.isFinite(a)) throw new Error('NaN shake'); this.cameraRig.addTrauma(a); },
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
  game.audio = new AudioEngine(game);
  game.player = new Player(game);
  game.dragon = LVL.createBoss(game);
  game.boss = game.dragon;
  game.hud = new Hud(game);
  game.touch = new TouchControls(game);
  game.flow = new GameFlow(game);
  game.lab = new Lab(game);
  game.applyQuality = () => {};
  const takeHit = game.player.takeHit.bind(game.player);
  game.player.takeHit = (h) => {
    const r = takeHit(h);
    G.hits.push({ t: game.time, r, attack: h?.attack, tell: h?.tell, damage: h?.damage, kind: h?.kind });
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
    G.peakAdd = Math.max(G.peakAdd, game.fx.add.count);
    game.hud.update(realDt);
    game.audio.update(realDt);
    game.input.endFrame();
    const p = game.player, d = game.dragon;
    if (![p.position.x, p.position.z, p.hp, p.yaw].every(Number.isFinite)) throw new Error('player NaN');
    if (![d.position.x, d.position.y, d.position.z, d.hp, d.yaw, d.posture, d.maxPosture, d.lit].every(Number.isFinite)) throw new Error('lord NaN');
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
const dist2 = (G) => Math.hypot(G.game.player.position.x - G.game.dragon.position.x, G.game.player.position.z - G.game.dragon.position.z);

// ---- the defender bot: answers his tells from the flash (parry normal / blue, roll through red)
function makeDefender(G, { skill = 1, early = 0.12 } = {}) {
  const pend = [];
  const stats = { flashes: 0, parryTry: 0, dodgeTry: 0 };
  return {
    stats,
    onEvent(n, d) {
      if (n === 'combat:flash' && d?.source === 'dragon') {
        stats.flashes++;
        if (skill < 1 && Math.random() > skill) return;
        pend.push({ tell: d.tell, at: G.game.time + TUNING.flashLead, x: d.x, z: d.z, hazard: !!d.hazard && !d.bullet, done: false });
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
            const d = e.hazard ? { x: e.x, z: e.z } : g.dragon.position, p = g.player.position;
            const dx = p.x - d.x, dz = p.z - d.z, l = Math.hypot(dx, dz) || 1;
            // across his blade; out of a marked circle: straight away from its centre
            input.axis = e.hazard ? { x: dx / l, y: -dz / l } : { x: dz / l, y: dx / l };
            input.tap('Space');
            stats.dodgeTry++;
          }
        } else if (left <= early) {
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

/** Fence: keep close, answer every tell, cut in his openings, give the deathblow to a broken lord. */
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
  out('\n== scenario LEVEL (registry, the throne hall set, the boss slot) ==');
  assert(LEVELS.includes(LVL) && LVL.id === 'starless', `levels: ${LEVELS.map((l) => l.id).join(', ')}`);
  assert(levelFromSearch('?level=starless') === LVL && levelFromSearch('?lab&level=LORD') === LVL && levelFromSearch('?level=throne') === LVL, '?level=starless / lord / throne pick the level (case-insensitive)');
  for (const k of ['arrive', 'stir', 'phase2', 'phase3', 'phase4', 'victory', 'fallen', 'restReset', 'again', 'rise']) if (!LVL.text[k]) assert(false, `the level has its ${k} line`);
  assert(CONFIG.world.bonfire.z === HALL.bonfire.z && CONFIG.world.dragonSleep.z === HALL.throne.z + 0.5 && CONFIG.world.bossTriggerZ < HALL.zS, 'applyLevel merged the hall layout into CONFIG.world');
  const S = HALL_SET.set;
  assert(S.group?.isObject3D && Array.isArray(S.slabs) && S.slabs.length > 150 && S.bonfire && S.nest && S.sky && typeof S.ambience?.update === 'function' && typeof S.ambience?.flare === 'function', `the set has the forest's shape, a sky and its ambience (${S.slabs.length} floor slabs)`);
  let bad = 0;
  S.group.traverse((m) => { const pos = m.geometry?.attributes?.position; if (pos) for (const v of pos.array) if (!Number.isFinite(v)) bad++; });
  assert(bad === 0, `the hall has no NaN vertices (${bad})`);
  assert(HALL_SET.circles.length > 100 && HALL_SET.circles.every((k) => [k.x, k.z, k.r].every(Number.isFinite)), `its colliders are finite (${HALL_SET.circles.length})`);
  // the seal is the origin and clear of colliders; the door is open; the dais is closed
  const c = new Colliders();
  for (const k of HALL_SET.circles) c.add(k.x, k.z, k.r, k.tag);
  const free = (x, z) => { const p = { x, z }; c.resolve(p, 0.45, 40); return Math.hypot(p.x - x, p.z - z) < 1e-6; };
  assert(free(0, 0) && free(6, 6) && free(-9, -9) && free(0, HALL.zS + 1.2) && free(0, HALL.bonfire.z - 2), 'the floor, the door and the path are walkable');
  assert(!free(0, HALL.daisZ - 0.8) && !free(HALL.pillarX + 0.3, HALL.pillarZ[2]) && !free(HALL.halfX + 1.3, 0), 'the dais, the pillars and the walls are not');
  // the ambience runs headless (no pipeline): setup, a flare, a few frames
  const U = createSharedUniforms();
  const g = { U, time: 0, lights: new LightPool(U), fx: { add: new GlyphParticles(U, { max: 2000 }), alpha: new GlyphParticles(U, { max: 2000, additive: false }) }, pipeline: null };
  const amb = createThroneHall(U, new Colliders()).ambience;
  amb.setup(g);
  amb.flare(1);
  for (let i = 0; i < 30; i++) amb.update(DT, g);
  assert(g.fx.add.count > 20 && g.lights.lights.length === 6, `braziers burn headless (${g.fx.add.count} particles, ${g.lights.lights.length} lights)`);

  const G = build();
  const d = G.game.dragon;
  assert(d instanceof StarlessLord && d instanceof Duelist && G.game.boss === d && d.state === 'sleeping' && d.mode === 'sleep', 'the boss slot holds the Starless Lord, enthroned');
  assert(Math.hypot(d.position.x - CONFIG.world.dragonSleep.x, d.position.z - CONFIG.world.dragonSleep.z) < 1e-6 && Math.abs(d.position.y - TUNING.intro.seatY) < 1e-6, 'he sits on the throne (the root at the seat)');
  // seated, not standing in his guard on the seat: the animator plays the throne clip (the hips low)
  {
    const v = new THREE.Vector3();
    d.rig.pelvis.getWorldPosition(v);
    assert(d.anim.key === 'duel' && d.brain.clip?.name === 'meditate' && v.y - d.position.y < 0.85, `he waits in the throne clip, seated (hips ${(v.y - d.position.y).toFixed(2)} m over the root)`);
  }
  assert(d.lives.total === 4 && d.lives.left === 4 && d.hp === TUNING.hp && d.phase === 1, 'four forms, a full bar each');
  // the harness: black plate, a helm, the yoke, the war-skirt and the cape, drawn a head taller
  {
    const L = d.rig.loadout;
    assert(L.head === `lord.helm.${LORD_LOOKS[0]}` && L.chest === 'lord.plate' && L.shoulders === 'lord.yoke' && L.arms === 'lord.arms' && L.legs === 'lord.legs' && L.waist === 'lord.skirt' && L.back === 'lord.cape' && L.weapon === 'lord.saber', `he wears his own harness (${Object.values(L).join(', ')})`);
    assert(d.rig.streamers.length === LORD_CAPE.length && d.rig.coat.length === LORD_PANELS.length && d.rig.offHand?.open && d.rig.offHand?.grip, `the cape hangs on ${d.rig.streamers.length} springs, the war-skirt on ${d.rig.coat.length}`);
    assert(d.drawScale === TUNING.scale && d.anim.drawScale === TUNING.scale && TUNING.scale > 1.2, `he is drawn at ${TUNING.scale} (the animator's gait with it)`);
    // every helm offered builds clean
    let nan = 0;
    for (const look of LORD_LOOKS) {
      const rig = buildHero(createSharedUniforms(), lordLoadout(look));
      rig.root.traverse((m) => { const pos = m.geometry?.attributes?.position; if (pos) for (const x of pos.array) if (!Number.isFinite(x)) nan++; });
      if (rig.loadout.head !== `lord.helm.${look}`) nan++;
    }
    assert(nan === 0, `every helm builds (${LORD_LOOKS.join(', ')})`);
  }
  bad = 0;
  d.object3d.traverse((m) => { const pos = m.geometry?.attributes?.position; if (pos) for (const v of pos.array) if (!Number.isFinite(v)) bad++; });
  assert(bad === 0, `his gear has no NaN vertices (${bad})`);
  assert(d.batch.meshes.length > 0 && d.batch.meshes.length < 28, `he draws through rigid batches (${d.batch.meshes.length} meshes)`);
  assert(d.blades.A && d.blades.B && d.blades.Q && d.blades.L && d.blades.off && !d.blades.A.visible && d.lit === 0, 'every form\'s blades are built; dark while he sits');
  assert(G.game.hud.lifeEls.length === 4, 'the boss bar shows four pips');
  return G;
}

// ================================================================== scenario: data (the move rules)
async function scenarioData() {
  out('\n== scenario DATA (move data rules, every form a move is used in, both ends of every random roll) ==');
  let checked = 0;
  const strings = [0, 0, 0, 0, 0];
  const count = [0, 0, 0, 0, 0];
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
        if (!real.every((b) => [TELL.NORMAL, TELL.BLUE, TELL.RED].includes(b.def.tell))) assert(false, `${tag}: a tell on every real hit`);
        const first = real[0];
        if (!def.transition && !(first && first.impact - first.tellAt >= TUNING.minFirstWindup - 1e-6)) assert(false, `${tag}: first real windup ${first ? (first.impact - first.tellAt).toFixed(3) : '-'} >= ${TUNING.minFirstWindup}`);
        for (let i = 1; i < real.length; i++) if (!(real[i].impact - real[i - 1].impact >= TUNING.minHitGap - 1e-6)) assert(false, `${tag}: hits ${i - 1}→${i} ${(real[i].impact - real[i - 1].impact).toFixed(3)} s apart >= ${TUNING.minHitGap}`);
        for (const b of real) if (!(b.flash >= b.tellAt - 1e-6)) assert(false, `${tag}: hit ${b.hit} flashes after its tell`);
        for (let i = 1; i < real.length; i++) if (!(real[i].flash >= real[i - 1].impact - 1e-6)) assert(false, `${tag}: hit ${i}'s flash comes after hit ${i - 1} lands`);
        for (const b of real) if (!(b.def.zone || b.def.release || b.def.cast)) assert(false, `${tag}: hit ${b.hit} has a zone, a release or a cast`);
        for (const b of real) if (b.def.tell === TELL.RED && b.def.zone?.kind === 'ring' && !b.def.ring) assert(false, `${tag}: a red ring marks the ground`);
        if (!(A.end > A.recoveryStart && Math.abs(A.clip.dur - A.end) < 1e-9)) assert(false, `${tag}: clip spans the move`);
        if (!(A.clip.kit === CLIPS_BY_FORM[(def.transition ? def.phase : f) - 1].clash.kit)) assert(false, `${tag}: compiled round its form's stance`);
        checked++;
      }
      if (most >= 5) strings[f]++;
    }
  }
  assert(checked > 100, `${checked} realisations obey the rules (a tell per hit, first windup >= ${TUNING.minFirstWindup} s, hits >= ${TUNING.minHitGap} s apart, each flash after the hit before it)`);
  for (let f = 1; f <= FORMS; f++) assert(count[f] >= 6 && strings[f] >= 2, `form ${f}: ${count[f]} moves, ${strings[f]} strings of five hits or more`);
  // strings of six: at least one per form, with a drawn alternative (a `pick`) somewhere in it
  for (let f = 1; f <= FORMS; f++) {
    const six = MOVE_NAMES.filter((n) => weightIn(MOVES[n], f) > 0 && realise(n, f, () => 0.2).beats.filter((b) => !b.feint).length >= 6);
    const varied = six.filter((n) => MOVES[n].beats.some((b) => Array.isArray(b.pick) || b.chance < 1));
    assert(six.length >= 1 && varied.length >= 1, `form ${f} has a six-hit string that varies (${six.join(', ')})`);
  }
  for (const [ph, mv] of Object.entries(TRANSITIONS)) assert(MOVES[mv]?.transition && MOVES[mv].phase === Number(ph), `form ${ph} begins with ${mv}`);
  assert(COUNTERS.length === FORMS && COUNTERS.every((n, i) => MOVES[n]?.counter && realise(n, i + 1, () => 0.5)), 'every form has its counter');
  assert(TUNING.flashLead <= TUNING.minHitGap + 1e-9, `the glint (${TUNING.flashLead} s) fits inside the tightest gap (${TUNING.minHitGap} s)`);
  // the gaps really tighten form by form
  const gap = (f) => { const A = realise(f === 1 ? 'litany' : f === 2 ? 'tempest' : f === 3 ? 'cyclone' : 'judgment', f, () => 0.2); const h = A.beats.filter((b) => !b.feint); return h[1].impact - h[0].impact; };
  const gaps = [1, 2, 3, 4].map(gap);
  assert(gaps[0] > gaps[1] && gaps[1] > gaps[2] && gaps[2] > gaps[3] && gaps[3] >= TUNING.minHitGap, `a string's hits come faster form by form: ${gaps.map((g) => g.toFixed(3)).join(' > ')} s`);
}

// ================================================================== scenario: timing (flash → contact)
async function scenarioTiming() {
  out('\n== scenario TIMING (every move from inside its band: each glint is a blow, on time) ==');
  let worst = 0, moves = 0;
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    if (def.transition) continue;
    for (const f of formsOf(name)) {
      const G = build();
      const d = G.game.dragon;
      const [lo, hi] = def.band;
      const at = def.counter ? 2.2 : Math.max(1.6, Math.min(hi - 0.4, lo + (Math.min(hi, 12) - lo) * 0.4));
      duel(G, { dist: at, form: f });
      G.game.player.debug.god = true;
      const flashes = [], contacts = [];
      G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon') flashes.push(G.game.time); };
      const h0 = G.hits.length;
      if (!d.debug.trigger(name)) { assert(false, `${name} form ${f}: starts`); continue; }
      run(G, 9, null, () => d.mode === 'foot' && !d.fx.shotsAlive && !d.fx.crescentsAlive && !d.fx.strikesAlive && d._storm.left === 0);
      for (const h of G.hits.slice(h0)) if (h.r !== RESULT.IGNORED) contacts.push(h.t);
      // every contact was cued flashLead before it (± a frame and the hit-stop of the blow before)
      let w = 0;
      for (const c of contacts) {
        const fl = flashes.filter((t) => t <= c + 1e-6).pop();
        const lead = fl === undefined ? Infinity : Math.abs(c - fl - TUNING.flashLead);
        w = Math.max(w, lead);
      }
      worst = Math.max(worst, Number.isFinite(w) ? w : 9);
      moves++;
      const firstLands = contacts.length >= 1;
      if (!firstLands || !(w <= 0.09)) assert(false, `${name} form ${f} from ${at.toFixed(1)} m: ${flashes.length} flashes, ${contacts.length} contacts, worst ${(w * 1000).toFixed(0)} ms`);
      else out(`     ${name.padEnd(10)} form ${f} from ${at.toFixed(1)} m: ${flashes.length} flashes, ${contacts.length} contacts, worst ${(w * 1000).toFixed(0)} ms`);
    }
  }
  assert(moves >= 30 && worst <= 0.09, `${moves} move × form runs: every contact within ${(worst * 1000).toFixed(0)} ms of its flash + ${TUNING.flashLead} s, and every move's first hit lands`);
}

// ================================================================== scenario: forms (four bars, a deathblow each)
async function scenarioForms() {
  out('\n== scenario FORMS (four bars: a bar emptied or posture broken → the deathblow → the next form) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon;
  duel(G, { dist: 2.2 });
  game.player.debug.god = true;
  assert(d.lit > 0.99 && d.blades.A.visible && !d.blades.off.visible && !d.blades.B.visible && !d.blades.Q.visible, 'form 1: one blade lit');
  // the Sekiro rule: posture is hard to move on a full bar
  d.posture = 0;
  d.addPosture(POSTURE.parry.normal);
  const full = d.posture;
  d.posture = 0;
  d.hp = d.maxHp * 0.1;
  d.addPosture(POSTURE.parry.normal);
  const low = d.posture;
  d.posture = 0;
  d.hp = d.maxHp;
  assert(Math.abs(full - POSTURE.parry.normal * TUNING.posture.gainByHp[0]) < 1e-6 && low > full * 2, `a parry moves his posture ${full.toFixed(1)} on a full bar, ${low.toFixed(1)} on a bar nearly empty`);
  // the bar emptied: he breaks, he does not die
  const dealt = d.takeHit({ damage: 99999, exact: true });
  assert(dealt > 0 && d.hp === 0 && d.broken && d.mode === 'broken' && d.state === 'staggered' && !G.counts['dragon:death'], 'an empty bar breaks him (no death): on one knee');
  // nobody answers: he rises with a little back
  run(G, TUNING.posture.breakTime + 0.3);
  assert(!d.broken && Math.abs(d.hp - d.maxHp * TUNING.posture.spared.hp) < 1e-6 && d.posture > 0 && d.phase === 1, `a break left alone: he rises with ${Math.round(d.hp)} HP and half the meter`);
  // the deathblow, with the hero's own attack press
  let f = deathblow(G, 'hp');
  assert(f === 2 && G.counts['dragon:plunged'] === 1 && G.counts['dragon:phase2'] === 1 && d.lives.left === 3 && d.hp === d.maxHp, `the deathblow ends form 1: form ${f}, ${d.lives.left} pips left, a full bar`);
  assert(d._changing && d.brain.act?.def?.transition && d.takeHit({ damage: 50 }) === 0, 'through the ignition nothing lands on him');
  run(G, 5, null, () => d.mode === 'foot');
  assert(!d._changing && d.lit > 0.9 && d.blades.off.visible && d.blades.L.visible && d.blades.A.visible && G.counters.flares >= 1, 'form 2: both blades lit, the seal flared');
  assert(d.maxPosture === TUNING.posture.max[1] && d.posture === 0, 'form 2 has its own posture meter');
  const hud = game.hud;
  run(G, 0.2);
  assert(hud.lifeEls.filter((e) => e.classList.contains('gone')).length === 1, 'the boss bar spent one pip');
  f = deathblow(G, 'posture');
  run(G, 5, null, () => d.mode === 'foot');
  assert(f === 3 && d.blades.B.visible && d.blades.hiltB.visible && !d.blades.off.visible && d.lives.left === 2, 'a posture break and the deathblow: form 3, the staff lit at both ends');
  f = deathblow(G, 'hp');
  run(G, 5, null, () => d.mode === 'foot');
  assert(f === 4 && d.blades.Q.visible && !d.blades.B.visible && d.lives.left === 1 && G.counts['dragon:phase4'] === 1, 'form 4: the cross-hilted blade');
  deathblow(G, 'posture');
  assert(d.mode === 'dying' && G.counts['dragon:death'] === 1, 'the fourth deathblow kills him');
  run(G, 7, null, () => d.mode === 'dead');
  assert(d.mode === 'dead' && d.lives.left === 0 && G.counts['dragon:dead'] === 1 && d.hurtSpheres.length === 0, 'he falls and is gone');
  run(G, 4);
  assert(game.state === 'victory', `the flow ends in victory (${game.state})`);
  // a reset puts him back on the throne, form 1
  d.reset();
  assert(d.phase === 1 && d.lives.left === 4 && d.hp === d.maxHp && d.mode === 'sleep' && d.lit === 0 && Math.abs(d.position.y - TUNING.intro.seatY) < 1e-6, 'reset: enthroned again, form 1, blades dark');
  // the Lab's jumps
  const G2 = build();
  duel(G2, { dist: 6 });
  const d2 = G2.game.dragon;
  assert(d2.debug.phase2() && d2.phase === 2 && !d2.debug.phase4(), 'Lab: Phase 2 starts the next ignition; Phase 4 waits its turn');
  run(G2, 5, null, () => d2.mode === 'foot');
  assert(d2.debug.setForm(4) && d2.phase === 4 && d2.debug.form === 4, 'Lab: setForm jumps to any form');
}

// ================================================================== scenario: spells
async function scenarioSpells() {
  out('\n== scenario SPELLS (the Void: lightning, push, pull, the thrown blade, torn stone, the storm, the blink) ==');
  const stage = (form, dist, opts = {}) => {
    const G = build();
    duel(G, { dist, form });
    if (opts.god) G.game.player.debug.god = true;
    return G;
  };
  const cast = (G, name, secs = 6, step = null) => {
    const d = G.game.dragon;
    const h0 = G.hits.length;
    const ok = d.debug.trigger(name);
    run(G, secs, step, () => d.mode === 'foot' && !d.fx.shotsAlive && !d.fx.crescentsAlive && !d.fx.strikesAlive && d._storm.left === 0);
    return { ok, hits: G.hits.slice(h0) };
  };
  // ---- Void lightning
  {
    const G = stage(1, 8);
    Math.random = () => 0.9; // (the second bolt's 50 % chance: not this time)
    const hp0 = G.game.player.hp;
    const r = cast(G, 'voidBolt');
    assert(r.ok && r.hits.length === 1 && r.hits[0].r === RESULT.HIT && r.hits[0].kind === 'lightning' && G.game.player.hp < hp0, `unanswered, the bolt lands (${(hp0 - G.game.player.hp).toFixed(1)} damage from 8 m)`);
  }
  {
    const G = stage(1, 8);
    Math.random = () => 0.9;
    G.defend = makeDefender(G);
    const d = G.game.dragon;
    const p0 = d.posture, hp0 = d.hp;
    const r = cast(G, 'voidBolt', 6, () => G.defend.act());
    assert(r.hits.some((h) => h.r === RESULT.PARRIED) && d.posture > p0 && d.hp === hp0, `a parry deflects it: posture ${p0.toFixed(0)} → ${d.posture.toFixed(0)}, no damage to him`);
  }
  {
    const G = stage(1, 8);
    Math.random = () => 0.9;
    G.defend = makeDefender(G, { early: 0.05 }); // inside the perfect window
    const d = G.game.dragon;
    const hp0 = d.hp;
    const r = cast(G, 'voidBolt', 6, () => G.defend.act());
    assert(r.hits.some((h) => h.r === RESULT.PARRIED) && Math.abs(hp0 - d.hp - TUNING.bolt.returnDamage) < 1e-6, `a perfect parry sends it back: ${hp0 - d.hp} damage to him`);
  }
  // ---- the push
  {
    const G = stage(1, 6);
    const d0 = dist2(G);
    const r = cast(G, 'voidPush');
    run(G, 0.8);
    assert(r.hits.length === 1 && r.hits[0].r === RESULT.HIT && dist2(G) > d0 + 3, `the push throws the hero back (${d0.toFixed(1)} → ${dist2(G).toFixed(1)} m)`);
    const G2 = stage(1, 6);
    G2.defend = makeDefender(G2);
    const e0 = dist2(G2);
    const r2 = cast(G2, 'voidPush', 6, () => G2.defend.act());
    assert(r2.hits.some((h) => h.r === RESULT.PARRIED) && dist2(G2) < e0 + 1.2 && !G2.game.dragon.fx.crescentsAlive, 'a parry cuts the wall of force: the hero holds his ground');
  }
  // ---- the pull
  {
    const G = stage(1, 8, { god: true });
    const d0 = dist2(G);
    const d = G.game.dragon;
    let near = d0;
    d.debug.trigger('grasp');
    run(G, 1.4, () => { near = Math.min(near, dist2(G)); });
    assert(G.hits.some((h) => h.kind === 'pull' && h.r === RESULT.HIT) && near < d0 - 3, `the pull drags the hero to him (${d0.toFixed(1)} → ${near.toFixed(1)} m)`);
    const G2 = stage(1, 8);
    G2.defend = makeDefender(G2);
    const r2 = cast(G2, 'grasp', 6, () => G2.defend.act());
    const pulled = r2.hits.find((h) => h.kind === 'pull');
    assert(pulled && (pulled.r === RESULT.DODGED || pulled.r === RESULT.PERFECT), `a roll slips the pull (${pulled?.r})`);
  }
  // ---- the thrown blade
  {
    const G = stage(2, 8, { god: true });
    const d = G.game.dragon;
    let out0 = false, flashes = 0;
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'glaive') flashes++; };
    d.debug.trigger('glaive');
    run(G, 5, () => { out0 = out0 || d.glaiveOut; }, () => out0 && !d.glaiveOut && d.mode === 'foot');
    run(G, 0.1);
    const passes = G.hits.filter((h) => h.attack === 'glaive' && h.r !== RESULT.IGNORED).length;
    assert(out0 && !d.glaiveOut && d.blades.A.visible && flashes === 2 && passes === 2, `the blade leaves his hand, passes the hero twice (${flashes} cues, ${passes} contacts) and comes home`);
  }
  // ---- torn stone
  {
    const G = stage(3, 9, { god: true });
    const tells = [];
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'debris') tells.push(e.tell); };
    const r = cast(G, 'debris', 8);
    const red = tells.filter((t) => t === TELL.RED).length;
    assert(tells.length === 4 && red === 1 && r.hits.filter((h) => h.attack === 'debris').length === 4, `four stones fly, each cued: three to parry, one great red one (${tells.join(', ')})`);
  }
  // ---- the storm
  {
    const G = stage(4, 6, { god: true });
    let marks = 0;
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'storm' && e.hazard) marks++; };
    const r = cast(G, 'storm', 9);
    const struck = r.hits.filter((h) => h.attack === 'storm' && h.r === RESULT.HIT).length;
    assert(marks === 6 && struck >= 2 && G.counters.burns >= 6, `six strikes are called and cued; a hero who stands still is struck (${struck} of 6)`);
    const G2 = stage(4, 6);
    G2.defend = makeDefender(G2);
    G2.game.dragon.debug.trigger('storm');
    run(G2, 7, () => G2.defend.act());
    const took = G2.hits.filter((h) => h.attack === 'storm' && h.r === RESULT.HIT).length;
    assert(took <= 1, `a hero who rolls out of each mark is struck at most once (${took})`);
  }
  // ---- the blink
  {
    const G = stage(4, 5, { god: true });
    const d = G.game.dragon, p = G.game.player;
    const before = { x: d.position.x, z: d.position.z };
    d.debug.trigger('rend');
    run(G, 0.25);
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const rel = (d.position.x - p.position.x) * fx + (d.position.z - p.position.z) * fz;
    assert(Math.hypot(d.position.x - before.x, d.position.z - before.z) > 3 && rel < -1 && dist2(G) < 2.8, `he is gone and behind the hero (${rel.toFixed(1)} m along the hero's facing, ${dist2(G).toFixed(1)} m off)`);
  }
  // ---- the Crushing Dark
  {
    const G = stage(1, 6);
    const d = G.game.dragon, p = G.game.player, hp0 = p.hp;
    let down = false, crush = false;
    const ok = d.debug.trigger('grip');
    run(G, 3.5, () => { down = down || p.state === 'knockdown'; crush = crush || d.fx.crushes.some((c) => c.alive); });
    const hit = G.hits.find((h) => h.kind === 'grip');
    assert(ok && hit?.r === RESULT.HIT && hit.tell === TELL.RED && down && crush && p.hp < hp0, `unanswered, the grip closes: the hero is thrown down and crushed (${(hp0 - p.hp).toFixed(1)} damage)`);
    const G2 = stage(1, 6);
    G2.defend = makeDefender(G2);
    const r2 = cast(G2, 'grip', 5, () => G2.defend.act());
    assert(!r2.hits.some((h) => h.kind === 'grip' && h.r === RESULT.HIT) && G2.game.player.state !== 'knockdown', `a roll slips it (${r2.hits.filter((h) => h.kind === 'grip').map((h) => h.r).join(', ') || 'out of its line'})`);
  }
  // ---- the Rift
  {
    const G = stage(3, 8, { god: true });
    const styles = [];
    const fx = G.game.dragon.fx, thrown = fx.throwCrescent.bind(fx);
    fx.throwCrescent = (...a) => { styles.push(a[4]?.style); return thrown(...a); };
    const r = cast(G, 'rift', 6);
    assert(styles.length === 3 && styles.every((s) => s === 'rift') && r.hits.filter((h) => h.attack === 'rift' && h.r === RESULT.HIT).length === 1, `the Rift throws three fissures; the one at the hero lands (${styles.length})`);
    const G2 = stage(3, 8);
    G2.defend = makeDefender(G2);
    const r2 = cast(G2, 'rift', 6, () => G2.defend.act());
    assert(r2.hits.some((h) => h.attack === 'rift' && h.r === RESULT.PARRIED) && !r2.hits.some((h) => h.attack === 'rift' && h.r === RESULT.HIT), 'a parry breaks the fissure');
  }
  // ---- the Dark Star
  {
    const G = stage(4, 6, { god: true });
    let marks = 0;
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'star' && e.hazard) marks++; };
    const d = G.game.dragon, p = G.game.player;
    let follow = 0;
    d.debug.trigger('star');
    // (the hero walks off: the star goes after him until its cue)
    run(G, 0.9);
    const star = () => d.fx.strikes.find((s) => s.alive && s.style === 'star');
    const s0 = star();
    const at0 = s0 ? Math.hypot(s0.x - p.position.x, s0.z - p.position.z) : 99;
    run(G, 1.0);
    const s1 = star();
    follow = s1 ? at0 - Math.hypot(s1.x - p.position.x, s1.z - p.position.z) : 0;
    run(G, 3, null, () => d.mode === 'foot' && !d.fx.strikesAlive);
    const hit = G.hits.find((h) => h.attack === 'star');
    assert(!!s0 && follow > 1 && marks === 1 && hit?.r === RESULT.HIT && hit.kind === 'void', `the Dark Star drifts onto the hero (${follow.toFixed(1)} m closer), cues once and bursts on him`);
    const G2 = stage(4, 6);
    G2.defend = makeDefender(G2);
    G2.game.dragon.debug.trigger('star');
    run(G2, 5, () => G2.defend.act());
    assert(!G2.hits.some((h) => h.attack === 'star' && h.r === RESULT.HIT), 'a roll at its cue slips the burst');
  }
  // ---- Parting Light
  {
    const G = stage(2, 2, { god: true });
    const d = G.game.dragon, d0 = dist2(G);
    let n = 0, top = 0;
    const fx = d.fx, thrown = fx.throwCrescent.bind(fx);
    fx.throwCrescent = (...a) => { n++; return thrown(...a); };
    const r = cast(G, 'parting', 6, () => { top = Math.max(top, d.position.y); });
    assert(r.ok && n === 2 && top > 1 && dist2(G) > d0 + 3 && r.hits.some((h) => h.attack === 'parting' && h.r === RESULT.HIT), `a backflip out of reach (${d0.toFixed(1)} → ${dist2(G).toFixed(1)} m, ${top.toFixed(1)} m up) and two crescents, cued and landing`);
  }
  // ---- the glide
  {
    const G = stage(1, 15, { god: true });
    const d = G.game.dragon;
    d.debug.setAI(true);
    let glided = false, top = 0, fast = 0;
    const hold = () => { d.brain.gapT = 5; };
    run(G, 4, () => {
      hold();
      if (d.anim.key === 'glide') {
        glided = true;
        top = Math.max(top, d.position.y);
        fast = Math.max(fast, Math.hypot(d.pilot.groundVel.x, d.pilot.groundVel.z));
      }
    }, () => dist2(G) < 3.2);
    run(G, 1.5, hold);
    assert(glided && top > TUNING.glide.hover * 0.8 && fast > TUNING.glide.on && d.position.y < 0.02 && d.anim.key === 'loco' && d.mode === 'foot', `across the hall he is carried (${top.toFixed(2)} m off the floor at ${fast.toFixed(1)} m/s); in reach he comes down and walks`);
  }
  // ---- the red tide
  {
    const G = stage(4, 9, { god: true });
    let n = 0;
    const fx = G.game.dragon.fx, thrown = fx.throwCrescent.bind(fx);
    fx.throwCrescent = (...a) => { n++; return thrown(...a); };
    cast(G, 'tide', 8);
    assert(n === 5, `Red Tide throws five crescents (${n})`);
  }
}

// ================================================================== scenario: bounds
async function scenarioBounds() {
  out('\n== scenario BOUNDS (he keeps to the hall\'s floor, and a cornered hero is still in his reach) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player, H = TUNING.hall;
  duel(G, { dist: 4, ai: true, form: 3 });
  p.debug.god = true;
  let outside = 0, melee = 0;
  const h0 = G.hits.length;
  run(G, 45, () => {
    p.debug.teleport(12.6, 14.6); // the south-east corner, by the door wall
    if (d.mode !== 'intro' && d.position.y < 0.5 && (Math.abs(d.position.x) > H.x + 1e-6 || d.position.z < H.zN - 1e-6 || d.position.z > H.zS + 1e-6)) outside++;
  });
  for (const h of G.hits.slice(h0)) if (h.r === RESULT.HIT && h.kind === 'slash') melee++;
  assert(outside === 0, `45 s of form 3 against a cornered hero: never off the floor (${outside} frames outside)`);
  assert(melee >= 3, `his blade reaches the corner (${melee} blows landed there)`);
  // every form, AI on, a hero who stands in the middle: no errors, no NaN (G.tick throws), the particle pool holds
  let peak = 0;
  for (let f = 1; f <= FORMS; f++) {
    const Gf = build();
    duel(Gf, { dist: 3, ai: true, form: f });
    Gf.game.player.debug.god = true;
    run(Gf, 30);
    peak = Math.max(peak, Gf.peakAdd);
    if (Gf.payload.size) assert(false, `form ${f}: finite event payloads (${[...Gf.payload].join(', ')})`);
  }
  assert(peak < 6500, `30 s of every form with the AI on: the additive particle pool peaks at ${peak} of 7000`);
}

// ================================================================== scenario: flow
async function scenarioFlow() {
  out('\n== scenario FLOW (title → the door → the throne intro → the duel) ==');
  const G = build();
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  run(G, 0.3);
  input.tap('Enter');
  run(G, 0.5);
  if (game.state !== 'explore') game.flow.debug.toState('explore');
  run(G, 0.3);
  assert(game.state === 'explore' && d.mode === 'sleep', 'exploring; he sits');
  p.debug.teleport(0, HALL.zS + 0.6);
  run(G, 0.2);
  assert(d.mode === 'sleep', 'outside the door he does not stir');
  run(G, 3, () => { input.axis = { x: 0, y: 1 }; }, () => d.mode !== 'sleep');
  input.axis = { x: 0, y: 0 };
  assert(d.mode === 'intro' && game.state === 'bossIntro' && p.position.z < CONFIG.world.bossTriggerZ + 0.5, `through the door he lifts his head (hero at z ${p.position.z.toFixed(1)})`);
  let top = 0, lit = false, air = false;
  run(G, 6, () => { top = Math.max(top, d.position.y); lit = lit || d.lit > 0.9; air = air || d.state === 'airborne'; }, () => d.mode === 'foot' || d.mode === 'act');
  run(G, 0.2);
  assert(G.counts['dragon:introDone'] === 1 && game.state === 'boss', `the intro ends in the duel (${game.state})`);
  assert(lit && air && top > TUNING.intro.apex * 0.9 && G.counts['dragon:land'] >= 1, `the blade ignites and he leaps from the dais (apex ${top.toFixed(1)} m)`);
  // (on the floor, or carried a hand's breadth over it: he glides after a hero who keeps his distance)
  assert(d.position.y >= 0 && d.position.y <= TUNING.glide.hover + 1e-6 && Math.hypot(d.position.x - TUNING.intro.land.x, d.position.z - TUNING.intro.land.z) < 6 && d.position.z > TUNING.hall.zN - 1e-6, `he lands on the hall's floor by the seal (${d.position.x.toFixed(1)}, ${d.position.z.toFixed(1)})`);
  // the hero dies; resting resets him to the throne
  p.debug.god = false;
  p.hp = 1;
  d.debug.setAI(true);
  run(G, 25, null, () => game.state === 'dead');
  assert(game.state === 'dead', 'the lord can kill the hero');
  run(G, 12, () => { if (((game.realTime * 60) | 0) % 30 === 0) input.tap('Enter'); }, () => game.state === 'explore');
  assert(game.state === 'explore' && d.mode === 'sleep' && d.phase === 1 && Math.abs(d.position.y - TUNING.intro.seatY) < 1e-6, `after the death he is back on the throne (${game.state}, ${d.mode})`);
}

// ================================================================== scenario: win
async function scenarioWin() {
  out('\n== scenario WIN (a fencing bot in god mode: parries, rolls, cuts in his openings, gives the deathblows) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon;
  duel(G, { dist: 3, ai: true });
  // (env LORD_SKILL=0.8: a probe: the bot answers that share of his tells; only reported)
  const skill = Number(process.env.LORD_SKILL ?? 1);
  G.defend = makeDefender(G, { skill });
  const formAt = [0];
  let blows = 0;
  G.watch = (n, e) => {
    if (n === 'dragon:plunged') blows++;
    if (/^dragon:phase[234]$/.test(n)) formAt.push(game.time);
  };
  const t0 = game.time;
  const won = run(G, 420, () => fencer(G), () => d.mode === 'dead');
  const T = game.time - t0;
  const taken = G.hits.filter((h) => h.r === RESULT.HIT).length;
  const parries = G.hits.filter((h) => h.r === RESULT.PARRIED).length;
  out(`     ${won ? 'won' : 'NOT won'} in ${T.toFixed(0)} s: ${blows} deathblows, ${parries} parries, ${taken} hits taken (god mode), form starts at ${formAt.map((t) => (t - t0 > 0 ? (t - t0).toFixed(0) : '0')).join(' / ')} s; form ${d.phase}, bar ${Math.round(d.hp)}`);
  const dmg = G.hits.filter((h) => h.r === RESULT.HIT).reduce((a, h) => a + (h.damage ?? 0), 0);
  if (skill < 1) {
    out(`     probe (skill ${skill}): ${taken} hits for ${dmg.toFixed(0)} damage in ${T.toFixed(0)} s (the hero has 160 HP and 5 flasks of 70)`);
    return;
  }
  assert(won && blows === 4, `the bot beats all four forms (${blows} deathblows)`);
  assert(T > 55 && T < 300, `the fight takes a bot that answers every tell ${T.toFixed(0)} s`);
}

// ================================================================== run
const S = {
  level: scenarioLevel, data: scenarioData, timing: scenarioTiming, forms: scenarioForms, spells: scenarioSpells,
  bounds: scenarioBounds, flow: scenarioFlow, win: scenarioWin,
};
const list = SCEN === 'all' ? Object.keys(S) : [SCEN];
for (const k of list) {
  if (!S[k]) { out(`unknown scenario ${k}`); process.exit(2); }
  await S[k]();
}
const notCat = [...EMITTED].filter((n) => !CATALOGUE.has(n) && n !== 'state');
assert(!notCat.length, `every event this level emits is in the catalogue ${JSON.stringify(notCat)}`);
out(`\nconsole errors/warnings: ${errors.length}${errors.length ? '\n  ' + [...new Set(errors)].slice(0, 12).join('\n  ') : ''}`);
if (errors.length) fails++;
out(fails ? `\nLORD: ${fails} FAILED` : '\nLORD: ALL PASSED');
process.exit(fails ? 1 : 0);
