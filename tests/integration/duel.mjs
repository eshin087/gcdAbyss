// The Ashfall level and the Ash Disciple, headless (docs/specs/ash-disciple.md): the REAL Player,
// AshDisciple, Hud, GameFlow, AudioEngine and Lab (+ real LightPool, GlyphParticles, CameraRig,
// Events) wired like src/main.js for `?level=ash`; the world is a light mock on the real Colliders
// with the courtyard's ring of pillars. A bot drives the input.
// usage: node duel.mjs <repoRoot> [scenario]   (env: GCD_SEED=n reseeds the AI)
//   scenario: levels | data | timing | terrain | guard | clash | trade | deflect | ghostep | execute | phase | flow | win | sfx | all
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ui, AUDIO, resetWindow } from './shim.mjs';
import { attachMarks, marksCheck } from './marks.mjs';
import { swordAudit, printAudit, printImpacts, heldTip } from './swordAudit.mjs';

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
const { TELL, RESULT, DEFENSE, POSTURE } = await imp('src/combat/rules.js');
const { LEVELS, DEFAULT_LEVEL, getLevel, levelFromSearch, applyLevel, levelUrl } = await imp('src/levels/index.js');
const { COURTYARD, createCourtyard } = await imp('src/world/courtyard.js');
const { Scars } = await imp('src/world/scars.js');
const { Destructibles, STATE } = await imp('src/world/destructibles.js');
const { BREAK } = await imp('src/world/breakTuning.js');
const { Player, TUNE: TUNE_P } = await imp('src/entities/player/player.js');
const { AshDisciple } = await imp('src/entities/enemies/ashDisciple/disciple.js');
const { MOVES, MOVE_NAMES, CLIP, realise } = await imp('src/entities/enemies/ashDisciple/moves.js');
const { TUNING } = await imp('src/entities/enemies/ashDisciple/tuning.js');
const { Hud } = await imp('src/ui/hud.js');
const { Bindings, installActions } = await imp('src/core/bindings.js');
const { TouchControls } = await imp('src/ui/touch.js');
const { AudioEngine } = await imp('src/audio/audio.js');
const { GameFlow } = await imp('src/game/flow.js');
const { Lab } = await imp('src/dev/lab.js');
// GCD_LOOKS=ashMotion=a,lordMotion=a: look switches set for the whole run (duelist/lookSwitch.js setLook; ADR-226)
for (const kv of (process.env.GCD_LOOKS ?? '').split(',').filter(Boolean)) (await imp('src/entities/enemies/duelist/lookSwitch.js')).setLook(...kv.split('='));

const ASH = getLevel('ash');
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
const PLAIN_LEAD = (DEFENSE.perfectParryWindow + DEFENSE.parryWindow) / 2 + DT / 2;

// the event catalogue (docs/ARCHITECTURE.md → "Event catalogue"): what this level emits must be in it
const CATALOGUE = (() => {
  const md = fs.readFileSync(`${ROOT}/docs/ARCHITECTURE.md`, 'utf8');
  const sec = md.split(/^## /m).find((s) => s.startsWith('Event catalogue')) ?? '';
  const names = new Set();
  for (const m of sec.matchAll(/`([a-zA-Z]+(?::[a-zA-Z0-9]+)?)[ `]/g)) names.add(m[1]);
  return names;
})();

applyLevel(ASH);

/** `seed`: the AI's (a number), or { seed, real }. `real`: the courtyard's REAL set and its breakables
 *  (world.destructibles, world.scars, world.impact, world.restore, wired as src/world/world.js does),
 *  for the moves that use the terrain (ADR-111). Without it the world is the mock the older scenarios
 *  were written on: no destructibles. */
function build(opt = SEED) {
  const seed = typeof opt === 'number' ? opt : opt?.seed ?? SEED, real = typeof opt === 'object' && !!opt?.real;
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
  const set = real ? createCourtyard(U, colliders) : null;
  for (let k = -3; k <= 3 && !set; k++) {
    const t = k * 5.2;
    colliders.add(t, -P, 0.62, 'stone');
    colliders.add(-P, t, 0.62, 'stone');
    colliders.add(P, t, 0.62, 'stone');
    if (Math.abs(t) > 5) colliders.add(t, P, 0.62, 'stone');
  }
  if (!set) for (const s of [-1, 1]) colliders.add(s * COURTYARD.gateX, COURTYARD.gateZ, 0.7, 'stone');
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
  // the fire field (render/fireField.js): the same NaN guard and spawn count as the glyph pools
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
    THREE, CONFIG, level: ASH, levels: LEVELS.map((L) => ({ id: L.id, name: L.name })), pickLevel() {},
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
  if (set) {
    world.scars = new Scars(game, set.scarInk);
    world.destructibles = new Destructibles(game, world, set);
    world.impact = (x, z, r, power, o) => world.destructibles.strike(x, z, r, power, o ?? { kind: 'blunt', by: 'world' });
    world.restore = () => { world.scars.reset(); world.destructibles.reset(); };
    world.update = (dt) => { world.destructibles.update(dt); world.scars.update(dt, game.time); };
  }
  game.audio = new AudioEngine(game);
  game.player = new Player(game);
  // (his rig is built on a stream of its own: every THREE object draws Math.random for its uuid, so a
  // body look with more pieces (?ashLook=b, the owner's pick) would otherwise shift the AI's seeded
  // stream and replay every fight with another seed. The picks, 2026-11-16)
  const R0 = Math.random;
  Math.random = mulberry32(seed + 0x5eed);
  game.dragon = ASH.createBoss(game);
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
    game.world.update(dt);
    game.cameraRig.update(realDt, game.player.position);
    game.lights.update(dt, game.player.position);
    game.fx.alpha.update(dt, game.time);
    game.fx.add.update(dt, game.time);
    game.fx.fire.update(dt);
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
// style (the STRATEGY measurement): 'mixed' = the above; 'dodge' = a perfect dodge of EVERY tell and
// never a parry; 'parry' = parries, and a red blow rolled EARLY (i-frames, outside the perfect window)
function makeDefender(G, { skill = 1, style = 'mixed', lead = 0.12 } = {}) {
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
        if (e.tell === TELL.RED || e.tell === TELL.BLACK || style === 'dodge') {
          if (left <= (style === 'parry' ? 0.3 : 0.1)) {
            e.done = true;
            const d = g.dragon.position, p = g.player.position;
            const dx = p.x - d.x, dz = p.z - d.z, l = Math.hypot(dx, dz) || 1;
            input.axis = { x: dz / l, y: dx / l }; // roll across his blade
            input.tap('Space');
            stats.dodgeTry++;
          }
        } else if (left <= lead) {
          e.done = true;
          input.up(1);
          input.click(1);
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

// ================================================================== scenario: floor
/**
 * The floor breaks (2026-11-16, world/floor.js, BREAK.floor): a duel on the real set with his AI on
 * against the fencing bot (god mode; his health kept over 15 % so the fight runs its length), the share
 * of the floor inside his bound broken (and cracked) after 30 s, 1, 2 and 4 minutes. The owner's target:
 * not all rubble early, never untouched after two minutes, 30 - 50 % broken after a whole duel.
 */
async function scenarioFloor() {
  out('\n== scenario FLOOR (a courtyard duel breaks the floor: the share over time) ==');
  const F = build({ real: true });
  duel(F, { dist: 4, ai: true });
  F.defend = makeDefender(F);
  const fd = F.game.dragon, fp = F.game.player, W = F.game.world.destructibles;
  fp.debug.god = true;
  const inB = W.floor.filter((b) => Math.hypot(b.x, b.z) <= (fd.baseBound ?? 12.5));
  const at = {};
  let t = 0;
  for (const s of [30, 60, 120, 240]) {
    run(F, s - t, (GG) => { fd.hp = Math.max(fd.hp, fd.maxHp * 0.15); fencer(GG); }, () => fd.state === 'dead');
    t = s;
    const broken = inB.filter((b) => b.state !== STATE.INTACT).length, cracked = inB.filter((b) => b.state === STATE.INTACT && b.cracked).length;
    at[s] = broken / inB.length;
    out(`     ${s} s (${F.game.time.toFixed(0)} s): ${broken} of ${inB.length} slabs inside his bound broken (${(at[s] * 100).toFixed(0)} %; ${inB.filter((b) => b.state !== STATE.INTACT && b.by === "player").length} by the hero), ${cracked} cracked; phase ${fd.phase}; ${W.list.length - W.standing} pieces down in all`);
  }
  assert(at[30] < 0.25 && at[120] > 0, `not rubble early (${(at[30] * 100).toFixed(0)} % after 30 s, < 25 %), never untouched after two minutes (${(at[120] * 100).toFixed(0)} %)`);
  // (the owner's target 30 - 50 % after a whole duel; the band allows for the seed)
  assert(at[240] >= 0.22 && at[240] <= 0.6, `after 4 minutes ${(at[240] * 100).toFixed(0)} % of the floor inside his bound is broken (22 .. 60 %; the aim 30 - 50 %)`);
  assert(!F.payload.size, `no non-finite payload in his events (${[...F.payload].join(', ')})`);
  return F;
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
  // (kneeling for real: the animator plays his meditation clip, not the walking clip's guard)
  assert(d.anim.key === 'duel' && d.brain.clip?.name === 'meditate', `he waits in his meditation clip (${d.anim.key}, ${d.brain.clip?.name})`);
  assert(Math.hypot(d.position.x - CONFIG.world.dragonSleep.x, d.position.z - CONFIG.world.dragonSleep.z) < 1e-6, 'he kneels at the level\'s resting spot');
  let bad = 0;
  d.object3d.traverse((m) => { const pos = m.geometry?.attributes?.position; if (pos) for (const v of pos.array) if (!Number.isFinite(v)) bad++; });
  assert(bad === 0, `his gear has no NaN vertices (${bad})`);
  assert(d.batch.meshes.length > 0 && d.batch.meshes.length < 24, `he draws through rigid batches (${d.batch.meshes.length} meshes)`);
  const labLevel = ui.find?.((e) => e.textContent === 'LEVEL') ?? null;
  assert(G.game.lab && typeof G.game.pickLevel === 'function', 'the Lab and the title get the level list and pickLevel');
  // the courtyard's breakables (2026-11-16: everything but the gate, the bell's bronze and the bonfire
  // breaks: 78 → 456: its floor 293 slabs, the pillars 30 (a corner's second pillar joins its first),
  // the colossi in two stages, the cauldron, the lintel, the trees and stumps out to 40 m)
  const B = createCourtyard(createSharedUniforms(), new Colliders()).breakables, kinds = (k) => B.filter((b) => b.kind === k).length;
  assert(B.length >= 380 && B.length <= 520 && kinds('flagstone') >= 250 && kinds('colossus') === 4 && kinds('cauldron') === 1 && kinds('lintel') === 1 && kinds('bell') === 1 && kinds('pillar') === 30 && kinds('lantern') === 4, `the courtyard's breakables: ${B.length} (flagstone ${kinds('flagstone')}, pillar ${kinds('pillar')}, colossus ${kinds('colossus')}, cauldron, lintel, deadTree ${kinds('deadTree')}, stump ${kinds('stump')}, boulder ${kinds('boulder')})`);
  const at = new Map();
  for (const b of B) if (b.kind === 'pillar' && b.topples !== false) { const k = `${b.x.toFixed(1)},${b.z.toFixed(1)}`; at.set(k, (at.get(k) ?? 0) + 1); }
  assert([...at.values()].every((n) => n === 1), 'no standing pillar is listed twice');
  return G;
}

// ================================================================== scenario: moves (the second pass)
/**
 * Shen Hui's second pass (wave 2): every new move in every phase it is in, answered by a parrying bot
 * and by a rolling bot (no blow of it lands: each tell is answered by what it promises); the long
 * string re-closes on a hero who stepped back; burning ground keeps the rule of fire on grass (its
 * first burn after its grace, then one a tick, blockable, never while rolling) and its cap; the storm
 * of qi leaves a way out (the straddling wave passes either side of a hero who stands, a rolling bot
 * takes nothing); links fire by where the hero is.
 */
const NEW_MOVES = ['glideKick', 'leapSpin', 'mirrorFeint', 'chaseRain', 'windSpin', 'partingWind', 'burningCross', 'emberFan', 'zigzag', 'leapingString', 'kickBrand', 'ashString', 'ashFlurry', 'qiStorm', 'ghostDash', 'flitLotus'];
async function scenarioMoves() {
  out('\n== scenario MOVES (the second pass: every new move answered, the re-close, burning ground, the storm, links) ==');
  const { linkFor } = await imp('src/entities/enemies/duelist/director.js');
  assert(NEW_MOVES.every((n) => MOVES[n]), `the new moves exist (${NEW_MOVES.filter((n) => !MOVES[n]).join(', ') || 'all'})`);
  const per = { 1: NEW_MOVES.filter((n) => MOVES[n].phase === 1).length, 2: NEW_MOVES.filter((n) => MOVES[n].phase === 2).length, 3: NEW_MOVES.filter((n) => MOVES[n].phase === 3).length };
  assert(per[1] >= 5 && per[2] >= 5 && per[3] >= 5, `at least five new moves per phase (${per[1]} / ${per[2]} / ${per[3]})`);
  // no new blow over today's worst (30 before the scale) and the bands: a string hit 10 - 15, blue 18 - 26, red 22 - 30
  const band = { [TELL.NORMAL]: [10, 15], [TELL.BLUE]: [18, 26], [TELL.RED]: [22, 30] };
  const off = [];
  for (const n of NEW_MOVES) for (const b of MOVES[n].beats) if (!b.feint && b.tell !== TELL.BLACK) { const B = band[b.tell]; if (!(b.damage >= B[0] && b.damage <= B[1])) off.push(`${n} ${b.tell} ${b.damage}`); }
  assert(!off.length, `every new blow's damage in its band (${off.join(', ') || 'all'})`);
  const blacks = MOVE_NAMES.filter((n) => MOVES[n].beats.some((b) => b.tell === TELL.BLACK));
  assert(blacks.length === 1, `still exactly one charged black move (${blacks.join(', ')})`);

  // ---- every new move against a parrying bot and a rolling bot, in each phase it is in
  const G = build();
  duel(G, { dist: 4 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  p.debug.noRiposte = true;
  const toPhase = (ph) => {
    while (d.phase < ph) {
      const n = d.phase + 1;
      d.debug[`phase${n}`]();
      run(G, 4, null, () => d.phase === n && d.mode === 'foot');
    }
  };
  const tried = [];
  for (const ph of [1, 2, 3]) {
    toPhase(ph);
    for (const name of NEW_MOVES) {
      const def = MOVES[name];
      if (def.phase > ph) continue;
      for (const style of ['mixed', 'dodge']) {
        settle(G, 8);
        d.position.set(0, 0, -2);
        d.yaw = 0;
        place(G, (def.band[0] + Math.min(def.band[1], 9)) / 2);
        run(G, 0.2);
        d.brain.cooldowns = {};
        // (each run on clean stones: a line left by the run before burns where the hero now stands)
        d.moveFx?.reset();
        G.defend = makeDefender(G, { style });
        const h0 = G.hits.length;
        d.debug.trigger(name);
        const mtrace = [];
        run(G, 9, (GG) => { if (process.env.GCD_MTRACE) mtrace.push([+GG.game.time.toFixed(2), `${p.state}/${d.brain.act?.beats?.findIndex((b) => d.brain.act.t < b.end) ?? '-'}`]); GG.input.axis = { x: 0, y: 0 }; GG.defend.act(); GG.game.mouseGround.set(d.position.x, 0, d.position.z); }, () => d.mode === 'foot' && !d.fx.crescentsAlive);
        G.defend = null;
        input.up(1);
        const landed = G.hits.slice(h0).filter((h) => h.attack === name && h.r === RESULT.HIT);
        if (process.env.GCD_MTRACE && landed.length) out('     trace', name, JSON.stringify(G.hits.slice(h0).map((h) => [h.attack, h.r, h.tell, +(h.t).toFixed(2)])), JSON.stringify(mtrace.filter((x, i, A) => i === 0 || x[1] !== A[i - 1][1])));
        tried.push(`${name}/P${ph}/${style}:${landed.length}`);
        if (landed.length) assert(false, `${name} P${ph}: answered by a ${style === 'dodge' ? 'rolling' : 'parrying'} bot, ${landed.length} blow(s) landed (${landed.map((h) => h.tell).join(',')})`);
      }
    }
  }
  assert(tried.every((t) => t.endsWith(':0')), `every new move in every phase it is in: no blow lands on a hero who answers its tells (parry / roll): ${tried.length} runs`);

  // ---- the long string re-closes: the hero steps back 5.5 m as the glide comes; the string goes on and reaches him
  {
    const G2 = build();
    duel(G2, { dist: 2 });
    const d2 = G2.game.dragon, p2 = G2.game.player;
    p2.debug.god = true;
    p2.debug.noRiposte = true;
    d2.debug.trigger('chaseRain');
    const A = d2.brain.act, glideI = A.beats.findIndex((b) => b.def.dash?.max >= 5);
    let moved = false, at = 0;
    const h0 = G2.hits.length;
    run(G2, 8, () => {
      const t = d2.brain.act === A ? A.t : -1;
      if (!moved && t >= A.beats[glideI].start - 0.12) {
        moved = true;
        at = G2.game.time;
        const dx = p2.position.x - d2.position.x, dz = p2.position.z - d2.position.z, l = Math.hypot(dx, dz) || 1;
        p2.debug.teleport(d2.position.x + (dx / l) * 5.5, d2.position.z + (dz / l) * 5.5);
      }
    }, () => d2.mode === 'foot');
    const after = G2.hits.slice(h0).filter((h) => h.attack === 'chaseRain' && h.t > at);
    assert(moved && glideI > 0 && after.length >= 1 && A.beats[glideI].done, `Chasing Rain re-closes: the hero 5.5 m back as its glide comes, the string goes on and ${after.length} of its blows reach him after it (glide beat ${glideI})`);
  }

  // ---- the qi as a string's last word (the engine pass): a release beat with a `zone` is the cut
  // itself on a hero still inside that reach as its cue comes due (cued, flashed, it lands; no qi),
  // and throws its sword qi at a hero who stepped back (the crescents as before)
  for (const name of ['chaseRain', 'partingWind']) {
    for (const back of [false, true]) {
      const G5 = build();
      duel(G5, { dist: 1.8 });
      const d5 = G5.game.dragon, p5 = G5.game.player;
      p5.debug.god = true;
      p5.debug.noRiposte = true;
      const thrown = [];
      const tc = d5.fx.throwCrescent.bind(d5.fx);
      d5.fx.throwCrescent = (...a) => { const c = tc(...a); if (c) thrown.push(c); return c; };
      const flashes = [];
      G5.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === name && e.source === 'dragon' && !e.hazard) flashes.push(G5.game.time); };
      d5.debug.trigger(name);
      const A = d5.brain.act, B = A.beats[A.beats.length - 1];
      const h0 = G5.hits.length;
      let moved = false, impactAt = -1;
      // (the hero stands where the string's last cut finds him: put back in front of him at 1.8 m
      // as its windup starts, or 5.5 m back)
      run(G5, 12, () => {
        if (d5.brain.act !== A) return;
        if (!moved && A.t >= B.start) {
          moved = true;
          place(G5, back ? 5.5 : 1.8);
        }
        if (impactAt < 0 && A.t >= B.impact) impactAt = G5.game.time;
      }, () => d5.mode === 'foot' && !d5.fx.crescentsAlive);
      G5.watch = null;
      const lead = Array.isArray(TUNING.flashLead) ? TUNING.flashLead[0] : TUNING.flashLead;
      const last = G5.hits.slice(h0).filter((h) => h.attack === name && h.t >= impactAt - 1e-6);
      const cue = flashes.filter((t) => Math.abs(t + lead - impactAt) < DT * 1.5);
      if (!back) assert(B.cut === true && cue.length === 1 && last.length >= 1 && last[0].t - impactAt < 0.12 && !thrown.length, `${MOVES[name].label}: its last beat on a hero 1.8 m off is the cut (cut ${B.cut}): cued ${lead} s before (${cue.length} flash), it lands on him (${last.map((h) => h.r).join(',') || 'nothing'}), ${thrown.length} qi thrown`);
      else assert(B.cut === false && thrown.length >= 1 && last.length >= 1, `${MOVES[name].label}: its last beat at a hero 5.5 m back throws its qi (${thrown.length} crescent(s), cut ${B.cut}), and it reaches him (${last.map((h) => h.r).join(',') || 'nothing'})`);
    }
  }

  // ---- burning ground: the rule of fire on grass, its cap
  {
    const G3 = build();
    duel(G3, { dist: 1.6 });
    const d3 = G3.game.dragon, p3 = G3.game.player, F = d3.moveFx;
    d3.debug.phase2();
    run(G3, 4, null, () => d3.phase === 2 && d3.mode === 'foot');
    settle(G3, 6);
    place(G3, 1.6);
    p3.debug.god = true;
    p3.debug.noRiposte = true;
    const T = TUNING.burn;
    const made = [];
    const add = F.add.bind(F);
    F.add = (...a) => { const r = add(...a); if (r) made.push(G3.game.time); return r; };
    const states = [];
    const th = p3.takeHit.bind(p3);
    p3.takeHit = (h) => { if (h?.attack === 'burningGround') states.push(p3.state); return th(h); };
    const h0 = G3.hits.length;
    d3.debug.trigger('burningCross');
    // (the hero stays where he defended the string: held there, as its red cut throws him back since
    // the tuning pass)
    const hx = p3.position.x, hz = p3.position.z;
    const hold = () => { if (Math.hypot(p3.position.x - hx, p3.position.z - hz) > 0.05) p3.debug.teleport(hx, hz); };
    run(G3, 4, hold, () => d3.mode === 'foot');
    run(G3, 1.5, hold);
    // (no burn while the string still had blows coming: he defends where he stands)
    const lastBlow = Math.max(...G3.hits.slice(h0).filter((h) => h.attack === 'burningCross').map((h) => h.t));
    const burns = G3.hits.slice(h0).filter((h) => h.attack === 'burningGround');
    assert(made.length >= 2, `Cinder Cross leaves its lines of fire (${made.length})`);
    const first = burns[0];
    assert(first && first.t - made[0] >= T.grace - DT - 1e-6 && first.t >= lastBlow + T.armAfter - DT - 1e-6, `the first burn comes after the line's grace (${first ? (first.t - made[0]).toFixed(2) : '-'} s >= ${T.grace}) and after the string's last blow (${first ? (first.t - lastBlow).toFixed(2) : '-'} s >= ${T.armAfter})`);
    // then the tick: a line laid under a hero who stands in it
    settle(G3, 6);
    F.reset();
    const h2 = G3.hits.length, t2 = G3.game.time;
    F.add(p3.position.x - 1.5, p3.position.z, p3.position.x + 1.5, p3.position.z, T.width, T.life);
    run(G3, 2.2, (GG) => { GG.input.axis = { x: 0, y: 0 }; });
    const ticks = G3.hits.slice(h2).filter((h) => h.attack === 'burningGround');
    let minGap = Infinity;
    for (let i = 1; i < ticks.length; i++) minGap = Math.min(minGap, ticks[i].t - ticks[i - 1].t);
    assert(ticks.length >= 3 && ticks[0].t - t2 >= T.grace - DT - 1e-6 && minGap >= T.tick - DT - 1e-6 && ticks.every((h) => h.damage === T.damage), `standing in a line: the first burn ${ticks[0] ? (ticks[0].t - t2).toFixed(2) : '-'} s after it catches (>= ${T.grace}), then ${T.damage} every ${T.tick} s (${ticks.length} burns, the closest ${minGap.toFixed(2)} s apart)`);
    // blockable: a hero who holds his guard in it loses nothing; rolling: never burned
    settle(G3, 6);
    F.reset();
    p3.debug.god = false;
    p3.debug.heal();
    const hp0 = p3.hp;
    p3.guard = p3.maxGuard;
    const x0 = p3.position.x, z0 = p3.position.z;
    const tAdd = G3.game.time;
    F.add(p3.position.x - 1.5, p3.position.z, p3.position.x + 1.5, p3.position.z, T.width, T.life);
    G3.input.press(1);
    const h1 = G3.hits.length;
    // (the owner, 2026-11-16: "guard meter, no health": a guarded tick is a blocked blow of T.guard on
    // the meter and 0 HP; the meter empty knocks the guard open; then the fire burns as unguarded)
    const meter = [], opens = [];
    let gOpenT = -1;
    const w3 = G3.watch;
    G3.watch = (n, e) => { w3?.(n, e); if (n === 'player:guardOpen' && gOpenT < 0) gOpenT = G3.game.time; };
    let blockedRun = true, hpAtOpen = -1;
    run(G3, 3.0, (GG) => {
      GG.input.axis = { x: 0, y: 0 };
      const hs = GG.hits.slice(h1).filter((h) => h.attack === 'burningGround');
      if (hs.length > meter.length) { meter.push(p3.guard); opens.push(Math.hypot(p3.position.x - x0, p3.position.z - z0)); }
      if (gOpenT < 0 && hs.some((h) => h.r === RESULT.HIT)) blockedRun = false;
      if (gOpenT >= 0 && hpAtOpen < 0) hpAtOpen = p3.hp;
    });
    G3.watch = w3;
    G3.input.up(1);
    const gb = G3.hits.slice(h1).filter((h) => h.attack === 'burningGround');
    const pre = gOpenT < 0 ? gb : gb.filter((h) => h.t <= gOpenT + 1e-6);
    const lasted = gOpenT < 0 ? Infinity : gOpenT - tAdd;
    assert(pre.length >= 2 && pre.every((h) => h.r === RESULT.BLOCKED) && blockedRun && (hpAtOpen < 0 ? p3.hp : hpAtOpen) === hp0, `guarding in it: ${pre.length} ticks blocked, 0 HP lost until the guard opens (hp ${hp0} → ${hpAtOpen < 0 ? p3.hp : hpAtOpen}; ${pre.map((h) => h.r).join(',')})`);
    assert(meter.length >= 2 && Math.abs(p3.maxGuard - T.guard - meter[0]) < 1e-6 && (meter.length < 2 || Math.abs(meter[0] - T.guard - meter[1]) < 1e-6 || meter[1] === 0) && Math.max(...opens.slice(0, pre.length)) < 0.1, `each guarded tick drains the guard meter ${T.guard} (${meter.map((g) => g.toFixed(0)).join(' → ')}), no shove (${opens.slice(0, pre.length).map((o) => o.toFixed(2)).join(', ')} m off where he stood)`);
    assert(gOpenT >= 0 && lasted > T.life * 0.35 && lasted < T.life * 0.65 && gb.some((h) => h.t > gOpenT + 0.3 && h.r === RESULT.HIT && h.damage === T.damage), `the meter empties: the guard is knocked open ${lasted.toFixed(2)} s into the line (about half its ${T.life} s), then the fire burns ${T.damage} (${gb.filter((h) => h.t > gOpenT).map((h) => h.r).join(',')})`);
    p3.debug.heal();
    states.length = 0;
    F.reset();
    F.add(p3.position.x - 2.5, p3.position.z, p3.position.x + 2.5, p3.position.z, T.width, T.life);
    run(G3, 0.5);
    for (let i = 0; i < 6; i++) {
      G3.input.axis = { x: i % 2 ? 1 : -1, y: 0 };
      G3.input.tap('Space');
      run(G3, 0.45);
    }
    G3.input.axis = { x: 0, y: 0 };
    assert(!states.includes('roll'), `never while he rolls (${states.length} burns, states: ${[...new Set(states)].join(',') || 'none'})`);
    // the cap: more lines than the phase allows, the oldest go out
    F.reset();
    for (let i = 0; i < 12; i++) F.add(-6 + i, 8, -6 + i, 10, T.width, T.life);
    const lit = F.lines.filter((L) => L.alive && L.age < L.life - T.fade).length;
    assert(lit <= T.cap[1], `the cap: 12 lines asked in phase 2, ${lit} burn on (<= ${T.cap[1]})`);
    run(G3, T.life + 0.2);
    assert(F.alive === 0, `and they burn out in ${T.life} s (${F.alive} left)`);
    p3.debug.god = true;
  }

  // ---- the storm leaves a way out
  {
    const G4 = build();
    duel(G4, { dist: 4 });
    const d4 = G4.game.dragon, p4 = G4.game.player;
    p4.debug.god = true;
    p4.debug.noRiposte = true;
    d4.debug.phase2();
    run(G4, 4, null, () => d4.phase === 2 && d4.mode === 'foot');
    d4.debug.phase3();
    run(G4, 4, null, () => d4.phase === 3 && d4.mode === 'foot');
    settle(G4, 6);
    const thrown = [];
    const tc = d4.fx.throwCrescent.bind(d4.fx);
    d4.fx.throwCrescent = (...a) => { const c = tc(...a); if (c) thrown.push(c); return c; };
    const flashes = [];
    G4.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'qiStorm') flashes.push(G4.game.time); };
    d4.position.set(0, 0, -3);
    d4.yaw = 0;
    place(G4, 7);
    run(G4, 0.2);
    const h0 = G4.hits.length;
    d4.debug.trigger('qiStorm');
    run(G4, 6, (GG) => { GG.input.axis = { x: 0, y: 0 }; }, () => d4.mode === 'foot' && !d4.fx.crescentsAlive);
    G4.watch = null;
    const stood = G4.hits.slice(h0).filter((h) => h.attack === 'qiStorm');
    let gapMin = Infinity;
    for (let i = 1; i < flashes.length; i++) gapMin = Math.min(gapMin, flashes[i] - flashes[i - 1]);
    // (nine crescents in four waves: the fans' middles and the heavy one reach a hero who stands; the straddling two pass him)
    assert(thrown.length === 9 && stood.length <= 3, `Storm of Ash: ${thrown.length} crescents in four waves, ${stood.length} of them reach a hero who stands still (the two that straddle him pass either side)`);
    assert(MOVES.qiStorm.beats.every((b) => b.tell !== TELL.RED && b.tell !== TELL.BLACK) && gapMin >= 0.4, `every wave is guardable and the glints come ${gapMin.toFixed(2)} s apart at least (>= 0.4: a roll for each)`);
    settle(G4, 6);
    G4.defend = makeDefender(G4, { style: 'dodge' });
    place(G4, 7);
    const h1 = G4.hits.length;
    d4.brain.cooldowns = {};
    d4.debug.trigger('qiStorm');
    run(G4, 6, (GG) => { GG.input.axis = { x: 0, y: 0 }; GG.defend.act(); }, () => d4.mode === 'foot' && !d4.fx.crescentsAlive);
    G4.defend = null;
    const rolledHits = G4.hits.slice(h1).filter((h) => h.attack === 'qiStorm' && h.r === RESULT.HIT);
    assert(rolledHits.length === 0, `a hero who rolls each glint takes nothing (${rolledHits.length})`);
  }

  // ---- links fire by where the hero is (the roll forced to pass)
  {
    const br = d.brain;
    const R0 = Math.random;
    Math.random = () => 0;
    const sense = (dist, bearing = 0, away = 0) => {
      const a = d.yaw + bearing, dx = Math.sin(a) * dist, dz = Math.cos(a) * dist;
      return { dx, dz, dist, ang: Math.atan2(dx, dz), p: { x: d.position.x + dx, z: d.position.z + dz }, vx: (dx / dist) * away, vz: (dz / dist) * away };
    };
    const pick = (from, s) => { br.cooldowns = {}; return linkFor(br, { name: from }, s)?.to ?? null; };
    // (in phase 3 now)
    const got = {
      far: pick('ashRain', sense(9)),
      behind: pick('ashRain', sense(2.2, Math.PI)),
      side: pick('ashRain', sense(2.2, Math.PI / 2)),
      near: pick('ashRain', sense(2.2)),
      away: pick('partingWind', sense(4, 0, 4)),
    };
    Math.random = R0;
    out(`     links out of Rain of Ashes in phase 3: far ${got.far}, behind ${got.behind}, at his side ${got.side}, near ${got.near}; out of Parting Wind at a hero backing off: ${got.away}`);
    assert(got.far === 'qiStorm' && got.behind === 'flitLotus' && got.side === 'ashString' && got.near && got.near !== got.far && got.away === 'ghostDash', 'links by position: the storm at range, a sweep from behind, a flit string from the side, a close follow-up, the dash chain after a hero who backs off');
    const all = new Set(Object.keys(d.LINKS));
    const missing = MOVE_NAMES.filter((n) => !MOVES[n].counter && !MOVES[n].transition && !MOVES[n].terrain && !all.has(n));
    assert(!missing.length, `every blade move has links (${missing.join(', ') || 'all'})`);
  }
  return G;
}

// ================================================================== scenario: data (the move rules)
async function scenarioData() {
  out('\n== scenario DATA (move data rules, every phase, both ends of every random roll) ==');
  const G = build();
  let checked = 0;
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    // (the second pass: three phases; phase 3's windups no faster than phase 2's)
    for (const phase of [1, 2, 3]) {
      if (def.phase > phase) continue;
      for (const r of [0, 0.999]) {
        const A = realise(name, phase, () => r);
        const real = A.beats.filter((b) => !b.feint);
        const tag = `${name} P${phase} r${r}`;
        if (!real.every((b) => [TELL.NORMAL, TELL.BLUE, TELL.RED, TELL.BLACK].includes(b.def.tell))) assert(false, `${tag}: a tell on every real hit`);
        if (!real.every((b) => !b.def.flare || (b.def.tell === TELL.BLUE && b.def.zone))) assert(false, `${tag}: a flare mark only on a blue blow of the blade`);
        const first = real[0];
        // (a QUICK blow, ADR-226: a normal tell, its windup >= minQuickWindup and its glint inside it)
        const floor = first?.def.quick ? TUNING.minQuickWindup : TUNING.minFirstWindup;
        if (first?.def.quick && !(first.def.tell === TELL.NORMAL && TUNING.flashLead <= first.impact - first.tellAt + 1e-6)) assert(false, `${tag}: a quick blow is a normal one, its glint inside its windup`);
        if (!(first && first.impact - first.tellAt >= floor - 1e-6)) assert(false, `${tag}: first real windup ${first ? (first.impact - first.tellAt).toFixed(2) : '-'} >= ${floor}`);
        for (let i = 1; i < real.length; i++) if (!(real[i].impact - real[i - 1].impact >= TUNING.minHitGap - 1e-6)) assert(false, `${tag}: hits ${i - 1}→${i} ${(real[i].impact - real[i - 1].impact).toFixed(2)} s apart >= ${TUNING.minHitGap}`);
        for (const b of real) if (!(b.flash > b.tellAt)) assert(false, `${tag}: hit ${b.hit} flashes after its tell`);
        if (!A.beats.every((b) => b.feint ? !b.def.tell : true)) assert(false, `${tag}: feints carry no tell`);
        if (!(A.end > A.recoveryStart && A.clip.dur === A.end)) assert(false, `${tag}: clip spans the move`);
        for (const tr of A.clip.tracks) for (const v of tr.V) for (const x of [].concat(v)) if (!Number.isFinite(x)) assert(false, `${tag}: NaN key in ${tr.f}`);
        for (const b of real) if (!b.def.release && !b.def.cast && !b.def.zone) assert(false, `${tag}: hit ${b.hit} has a zone`);
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
    if (def.terrain) continue; // (a move of the courtyard needs its pieces: scenario TERRAIN, on the real set)
    // (into the move's phase through its real transition(s): the kindling, ash on the wind)
    while (def.phase > d.phase) {
      const n = d.phase + 1;
      d.debug[`phase${n}`]();
      run(G, 4, null, () => d.phase === n && d.mode === 'foot');
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
  // (a guarded strike never bites: the attack record's hitAt stays −1, anim.js BITE)
  const guardedAt = [];
  G.watch = (n, e) => { if (n === 'player:hitDragon' && e?.guarded) guardedAt.push(p.atk); };
  input.click(0);
  let bit = false;
  run(G, 0.7, () => { for (const a of guardedAt) if (a && a.hitAt >= 0) bit = true; });
  G.watch = null;
  assert((G.counts['dragon:guard'] ?? 0) > c0 && d.hp === hp0 && d.posture > post0, `a light swing into his guard: dragon:guard, no damage (hp ${d.hp}), posture ${post0.toFixed(0)} → ${d.posture.toFixed(0)}`);
  assert(guardedAt.filter(Boolean).length > 0 && !bit, `a guarded strike does not bite: the attack's hitAt stays −1 (${guardedAt.filter(Boolean).length} guarded hit(s) with the record; bit ${bit})`);
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
    d.debug.streak(0); // (the Riposte is under test: his streak of guards would answer with his flurry, scenario STREAK)
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
  input.press(2);
  run(G, 1.4);
  input.up(2);
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
  input.press(1);
  run(G, 0.04);
  assert(p.state === 'block', `a guard press cancels the bounce at once (${p.state})`);
  const h0 = G.hits.length;
  run(G, 1.6, () => { d.brain.gapT = 99; }, () => G.hits.length > h0);
  assert(seen.includes('riposte'), `the Riposte comes out of the deflect (${seen.join(', ')})`);
  assert(G.hits.length > h0 && G.hits[h0].r !== RESULT.HIT, `the guard raised out of the bounce answers its first cut (${G.hits[h0]?.r})`);
  input.up(1);
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
  input.press(1);
  run(G, 0.04);
  assert(inCut2 && p.state === 'block', `a guard cancels the cut itself (${p.state})`);
  input.up(1);
  settle(G);
  // (4) the blades meet: every blow of two strings parried, the hero's blade lies on his
  const gaps = [], backs = [], stops = [];
  p.debug.noRiposte = true; // (a parried blue blow would answer with a deathblow combo: this is about the clash)
  for (const mv of ['swallow', 'ashRain']) {
    home(G);
    place(G, 2.2);
    run(G, 0.3);
    G.watch = (n) => { if (n === 'player:parry') { gaps.push(p.deflect.gap); backs.push(d.brain.back.off); stops.push(game.hitstopTimer); } };
    G.defend = makeDefender(G, { lead: PLAIN_LEAD }); // plain parries: a perfect one ends the string (a lock, his posture)
    d.brain.trigger(mv);
    run(G, 5, (GG) => { GG.game.mouseGround.set(d.position.x, 0, d.position.z); GG.defend.act(); }, () => d.mode !== 'act');
    G.defend = null;
    G.watch = null;
    settle(G, 8);
  }
  p.debug.noRiposte = false;
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
  // (6) the blade lock: the two close to the lock's distance and the blades cross (?dbLock=lock: the deathblow
  // does not take the perfect blue parry from it; ADR-280)
  const DBM = await imp('src/entities/player/deathblow.js');
  DBM.setDbLock('lock');
  home(G);
  place(G, 2.2);
  run(G, 0.3);
  answerMove(G, 'fallingAsh', (left) => {
    if (left > 0.05) return false;
    input.up(1);
    input.click(1);
    return true;
  }, 2);
  const locked = p.state === 'lock';
  let n = 0, far = 0;
  run(G, 0.7, () => { if (n++ % 8 === 0) input.click(0); });
  const dist = Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z);
  far = p.deflect.gap;
  assert(locked && p.state === 'lock' && Math.abs(dist - 1.3) < 0.25 && far < 0.2, `blades locked: the two stand ${dist.toFixed(2)} m apart and the blades cross (${far.toFixed(2)} m between them)`);
  DBM.setDbLock(DBM.DBLOCK_DEFAULT);
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
  let a = cutTo(0.16);
  let seen = [];
  G.watch = (n, e) => { if (n === 'combat:clash') seen.push(e); };
  const hp0 = p.hp;
  let r = blow();
  assert(a && r === RESULT.CLASHED && p.hp === hp0 && p.state === 'bounce' && seen.length === 1 && !seen[0].counter, `a blow in the hero's cut (${a?.t.toFixed(2)} s into a ${a?.def.windup} + ${a?.def.active} s swing): ${r}, no damage, his blade thrown back (${p.state}), combat:clash`);
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
  // (1b) the flash counter (ADR-102): his blow arrives as the cut only just became a cut (at most
  // DEFENSE.counter.window into its active frames). The cut is not thrown back: it goes through him
  {
    const K = DEFENSE.counter;
    a = cutTo(a.def.windup);
    place(G, 2.0);
    p.atk = a;
    const hpD0 = d.hp, post = d.posture, hpP = p.hp;
    let cnt = null;
    seen = [];
    G.watch = (n, e) => { if (n === 'combat:clash') seen.push(e); if (n === 'player:counter') cnt = { ...e }; };
    r = blow();
    assert(a.t <= a.def.windup + K.window && r === RESULT.CLASHED && seen.length === 1 && seen[0].counter === true && cnt, `a blow that arrives ${(a.t - a.def.windup).toFixed(3)} s into the cut (window ${K.window}) is the flash counter (${r}, player:counter)`);
    assert(p.hp === hpP && p.state === 'attack' && hpD0 - d.hp === K.damage && cnt?.damage === K.damage, `the hero is not thrown back (${p.state}) and the cut goes through him: ${hpD0 - d.hp} damage (${K.damage}, final)`);
    assert(d.posture - post >= K.posture - 0.5 && d.mode === 'react' && d.brain.react?.kind === 'reeling' && p.critTimer >= DEFENSE.ghostep.critWindow - 1e-6, `he takes ${K.posture} posture (${post.toFixed(0)} -> ${d.posture.toFixed(0)}) and reels (${d.brain.react?.kind}); the crit window opens (${p.critTimer.toFixed(2)} s)`);
    assert(game.hitstopTimer >= K.stop - 0.02 && p.streak >= 1, `the frame freezes on it (${game.hitstopTimer.toFixed(3)} s) and it counts in the streak (${p.streak})`);
    G.watch = null;
    run(G, 0.5);
    assert(hpD0 - d.hp === K.damage, `the swing itself lands nothing more (${hpD0 - d.hp})`);
    settle(G, 8);
  }
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
  let ev = tradeInto('swallow', 0.24);
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
    if (due > 0 && game.time >= due) { due = -1; input.up(1); input.click(1); }
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
  input.press(2);
  run(G, 1.4);
  input.up(2);
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

// ================================================================== scenario: flashchain
// The flash chain (?counter=chain, combat/flashChain.js, ADR-246): a flash counter that is not the last
// link throws him back and he strikes back at once with his counter move; a flash counter of one of its
// blows is the next link; the last link is the flash counter's own ending (he reels, the crit window).
async function scenarioFlashChain() {
  out('\n== scenario FLASHCHAIN (three flash counters in a row: he strikes back after each, the third ends it) ==');
  const { setCounterMode } = await imp('src/combat/flashChain.js');
  const { LIGHT } = await imp('src/entities/player/combat.js');
  const CH = DEFENSE.counterChain, K = DEFENSE.counter;
  const G = build();
  duel(G, { dist: 2.0 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  // the press that makes a flash counter: his blow arrives just after the cut becomes a cut
  const LEAD = LIGHT[0].windup + K.window / 2;
  const counters = [];
  G.watch = (n, e) => { if (n === 'player:counter') counters.push({ ...e, t: game.time, hp: d.hp }); };
  /** Press attack LEAD s before the next real blow of whatever he is throwing; run until a counter
   *  lands or `max` s pass. Returns the counter event or null. */
  const counterNext = (max = 3) => {
    const n0 = counters.length;
    let clicked = null;
    run(G, max, () => {
      game.mouseGround.set(d.position.x, 0, d.position.z);
      const A = d.brain.act, b = A?.beats.find((x) => !x.feint && x.impact > A.t);
      if (b && clicked !== b && b.impact - A.t <= LEAD) { clicked = b; input.click(0); }
    }, () => counters.length > n0);
    return counters.length > n0 ? counters[counters.length - 1] : null;
  };
  try {
    // (0) the switch off: the flash counter as it ships (he reels at once)
    setCounterMode('0');
    settle(G, 8);
    home(G);
    place(G, 2.0);
    run(G, 0.3);
    d.brain.trigger('swallow');
    let c = counterNext();
    assert(!!c && !c.links && d.brain.react?.kind === 'reeling' && p.critTimer > 0, `chain off: a flash counter ends his string, he reels (${d.brain.react?.kind}), the crit window opens (${p.critTimer.toFixed(2)} s)`);
    settle(G, 8);
    // (1) the chain on: three in a row
    setCounterMode('chain');
    home(G);
    place(G, 2.0);
    run(G, 0.3);
    p.debug.heal();
    d.posture = 0;
    const counterMove = TUNING.counterMove ?? 'riposte';
    d.brain.trigger('swallow');
    d.debug.setAI(true); // (his strike-back comes out of his footwork, which runs with the AI on)
    const hp0 = d.hp;
    c = counterNext();
    assert(c?.link === 1 && c.links === CH.links && !c.last, `chain on: the first flash counter is link 1 of ${CH.links} (${c?.link} / ${c?.links})`);
    assert(c && Math.abs(hp0 - c.hp - CH.damage[0]) < 0.5 && d.brain.react?.kind === CH.react && p.critTimer <= 0, `... it deals ${CH.damage[0]} (${(hp0 - (c?.hp ?? hp0)).toFixed(0)}), throws him back (${d.brain.react?.kind}) and opens no crit window (${p.critTimer.toFixed(2)})`);
    const t1 = game.time;
    run(G, 1.5, () => game.mouseGround.set(d.position.x, 0, d.position.z), () => d.mode === 'act');
    const A1 = d.brain.act, b1 = A1?.beats.find((x) => !x.feint);
    const gap1 = A1 && b1 ? game.time - t1 + (b1.impact - A1.t) : NaN;
    assert(A1?.name === counterMove && A1.flashLink === 1, `... and he strikes back at once: ${A1?.name} (link ${A1?.flashLink})`);
    assert(gap1 >= DEFENSE.trade.rearm && gap1 <= 1.4, `his strike-back's first blow lands ${gap1.toFixed(2)} s after the counter (no sooner than a trade's re-arm, ${DEFENSE.trade.rearm} s)`);
    const hp1 = d.hp;
    c = counterNext();
    assert(c?.link === 2 && !c.last && Math.abs(hp1 - c.hp - CH.damage[1]) < 0.5, `a flash counter of his strike-back is link 2: ${(hp1 - (c?.hp ?? hp1)).toFixed(0)} damage (${CH.damage[1]})`);
    run(G, 1.5, () => game.mouseGround.set(d.position.x, 0, d.position.z), () => d.mode === 'act');
    assert(d.brain.act?.flashLink === 2, `... he strikes back again (link ${d.brain.act?.flashLink})`);
    const hp2 = d.hp;
    c = counterNext();
    const broke = d.mode === 'broken';
    assert(c?.link === 3 && c.last && Math.abs(hp2 - c.hp - CH.damage[2]) < 0.5, `the third is the last link: ${(hp2 - (c?.hp ?? hp2)).toFixed(0)} damage (${CH.damage[2]})`);
    assert((broke || d.brain.react?.kind === 'reeling') && p.critTimer >= DEFENSE.ghostep.critWindow - 0.05, `... he reels (${broke ? 'broken' : d.brain.react?.kind}) and the crit window opens (${p.critTimer.toFixed(2)} s)`);
    assert(game.hitstopTimer >= CH.stop[2] - 0.03 || broke, `the last link freezes longest (${game.hitstopTimer.toFixed(3)} s, ${CH.stop[2]})`);
    // (2) a chain starts over: the next flash counter, on a move that is not a strike-back, is link 1
    d.debug.setAI(false);
    settle(G, 8);
    home(G);
    place(G, 2.0);
    run(G, 0.3);
    p.debug.heal();
    d.posture = 0;
    d.brain.trigger('swallow');
    d.debug.setAI(true);
    c = counterNext();
    assert(c?.link === 1, `a new chain starts at link 1 (${c?.link})`);
    d.debug.setAI(false);
    settle(G, 8);
  } finally {
    setCounterMode('0');
    G.watch = null;
  }
  return G;
}

// ================================================================== scenario: clashdance
// The clash dance (?clash=dance, combat/clashDance.js, ADR-247): parries in a row inside one of his moves pay
// more posture each (DEFENSE.clashDance.mult); the run starts over on a new move, a blow landing on the hero,
// or a gap; the ring rises with the run (player:parry `clash`); his posture recovers more slowly as his health
// drops (regenByHp). Off: every number as before.
async function scenarioClashDance() {
  out('\n== scenario CLASHDANCE (parries in a row pay more posture; resets; slower recovery at low HP; off = today) ==');
  const { setClashMode, clashMult, clashRing, clashRegenK, DEFAULT_CLASH, clashMode } = await imp('src/combat/clashDance.js');
  assert(DEFAULT_CLASH === 'dance' && clashMode() === '0', `the game's default is the dance (${DEFAULT_CLASH}, the owner's pick); a headless sim starts with it off (${clashMode()})`);
  const CD = DEFENSE.clashDance;
  const G = build();
  duel(G, { dist: 3 });
  const { game } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  // every parry's own posture (the first addPosture after its dragon:parried; the full deflect's comes after)
  const log = [];
  let open = null;
  const add0 = d.addPosture.bind(d);
  d.addPosture = (amt) => {
    if (open) {
      open.amt = amt;
      log.push(open);
      open = null;
    }
    return add0(amt);
  };
  const rings = [];
  G.watch = (n, e) => {
    if (n === 'dragon:parried' && !e?.bullet) open = { tell: e.tell, perfect: !!p.deflect.perfect, hit: e.hit };
    if (n === 'player:parry' && !e?.light) rings.push(e.clash);
  };
  /** One move parried by the bot from posture 0: every parry's { amt, base (today's) }. `mid` runs once,
   *  right after the first parry. */
  const parryMove = (name, mid) => {
    settle(G, 8);
    home(G);
    place(G, 3);
    run(G, 0.3);
    d.posture = 0;
    d.postureTimer = 0;
    log.length = 0;
    rings.length = 0;
    G.defend = makeDefender(G);
    d.debug.trigger(name);
    let did = false;
    run(G, 6, (GG) => {
      GG.game.mouseGround.set(d.position.x, 0, d.position.z);
      GG.input.axis = { x: 0, y: 0 };
      GG.defend.act();
      if (mid && !did && log.length === 1) {
        did = true;
        mid();
      }
    }, () => d.mode === 'foot' && log.length > 0);
    G.defend = null;
    const base = (e) => (POSTURE.parry[e.tell] ?? POSTURE.parry.normal) * (e.perfect ? POSTURE.perfect : 1);
    return log.map((e) => ({ amt: e.amt, base: base(e) }));
  };
  const near = (a, b) => Math.abs(a - b) < 0.01;
  const fmt = (L) => L.map((e) => `${e.amt.toFixed(1)}/${e.base.toFixed(0)}`).join(' ');
  try {
    // (0) the table and the ring
    setClashMode('0');
    assert([1, 2, 3, 4, 9].every((n) => clashMult(n) === 1) && clashRing(4).join() === '1,1' && clashRegenK(0.05) === 1, 'off: the multiplier, the ring and the recovery factor are all 1');
    setClashMode('dance');
    assert([1, 2, 3, 4, 9].map(clashMult).join() === '1,1.25,1.5,1.75,1.75', `on: the run's multiplier x${[1, 2, 3, 4, 9].map(clashMult).join(', x')} (the cap from the 4th)`);
    const [g2, r2] = clashRing(2), [g9, r9] = clashRing(9);
    assert(clashRing(1).join() === '1,1' && g2 > 1 && r2 > 1 && r9 <= Math.pow(2, CD.ring.semisMax / 12) + 1e-9 && g9 <= Math.pow(10, CD.ring.dbMax / 20) + 1e-9,
      `the ring: a run's first parry as today, then a little higher and louder each (run 2: rate x${r2.toFixed(3)}, gain x${g2.toFixed(3)}), capped (x${r9.toFixed(3)} / x${g9.toFixed(3)})`);
    const ks = [1, 0.8, 0.7, 0.5, 0.2, 0.05].map(clashRegenK);
    assert(ks.join() === '1,1,0.85,0.75,0.5,0.25', `the recovery by HP: full above 75 %, then steps (100/80/70/50/20/5 % HP: x${ks.join(', x')})`);

    // (1) switch off: today's numbers, no run on player:parry
    setClashMode('0');
    let L = parryMove('swallow');
    assert(L.length === 3 && L.every((e) => near(e.amt, e.base)), `off: Swallow Flicks parried, each parry pays today's posture (${fmt(L)})`);
    assert(rings.length === 3 && rings.every((c) => c === 0), `off: player:parry carries no run (${rings.join(',')})`);

    // (2) on: the run's multiplier, parry by parry
    setClashMode('dance');
    L = parryMove('swallow');
    const want = L.map((e, i) => e.base * clashMult(i + 1));
    assert(L.length === 3 && L.every((e, i) => near(e.amt, want[i])), `on: the 1st / 2nd / 3rd parry pay x1 / x1.25 / x1.5 (${fmt(L)}; want ${want.map((v) => v.toFixed(1)).join(' ')})`);
    assert(rings.join() === '1,2,3', `the ring's run on player:parry counts up with it (${rings.join(',')})`);
    // (3) a new move starts the run over
    L = parryMove('swallow');
    assert(L.length === 3 && near(L[0].amt, L[0].base) && near(L[1].amt, L[1].base * CD.mult[1]), `a new move starts the run over: its first parry x1 again (${fmt(L)})`);
    // (4) a blow landing on the hero starts it over (hurtN moves on a real blow; mid-string it is moved by hand)
    settle(G, 8); // (free: a parried blue blow is answered by the deathblow, ADR-211, and blows miss him in it)
    run(G, 0.5);
    const n0 = p.hurtN;
    p.debug.god = false;
    p.takeHit({ damage: 1, knockback: 1, kind: 'hit', tell: TELL.NORMAL, parryable: false, blockable: false, attack: 'test', sourceX: d.position.x, sourceZ: d.position.z });
    p.takeHit({ damage: 1, kind: 'hit', tell: TELL.NORMAL, parryable: false, blockable: false, attack: 'stream', sourceX: d.position.x, sourceZ: d.position.z });
    p.debug.god = true;
    assert(p.hurtN === n0 + 1,`a blow that lands on the hero counts in player.hurtN (${n0} -> ${p.hurtN}); a contact stream's chip does not`);
    p.debug.heal?.();
    L = parryMove('swallow', () => p.hurtN++);
    assert(L.length === 3 && near(L[1].amt, L[1].base) && near(L[2].amt, L[2].base * CD.mult[1]), `a blow landing on him mid-string starts the run over: the next parry x1, then x1.25 (${fmt(L)})`);
    // (5) a gap starts it over
    L = parryMove('swallow', () => {
      if (d._clash) d._clash.t -= CD.gap + 0.1;
    });
    assert(L.length === 3 && near(L[1].amt, L[1].base) && near(L[2].amt, L[2].base * CD.mult[1]), `more than ${CD.gap} s since the last parry starts it over (${fmt(L)})`);

    // (6) the recovery: the same posture drains more slowly at low HP; off, at one rate
    const drain = (frac) => {
      settle(G, 8);
      d.hp = d.maxHp * frac;
      d.posture = 150;
      d.postureTimer = TUNING.posture.regenDelay + 0.01;
      const p0 = d.posture;
      run(G, 1);
      return (p0 - d.posture) / TUNING.posture.regenRate;
    };
    const fr = [1, 0.7, 0.5, 0.2, 0.05];
    setClashMode('0');
    const off = fr.map(drain);
    setClashMode('dance');
    const on = fr.map(drain);
    assert(off.every((v) => Math.abs(v - off[0]) < 0.03), `off: his posture drains at one rate whatever his HP (${off.map((v) => v.toFixed(2)).join(' / ')} x regenRate in 1 s)`);
    assert(on.every((v, i) => Math.abs(v - clashRegenK(fr[i]) * off[0]) < 0.03), `on: it drains by the steps (${on.map((v) => v.toFixed(2)).join(' / ')} at ${fr.map((f) => f * 100).join(' / ')} % HP)`);
    d.hp = d.maxHp;
  } finally {
    setClashMode('0');
    d.addPosture = add0;
    G.watch = null;
    G.defend = null;
  }
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

// ================================================================== scenario: tempo (the storm's tempo on a man; integ `storm` round the wyrm's head)
// DEFENSE.flurry.tempo (STREAK_FX.tempo, the default with the storm piece on): the first flash cut is a
// heavy beat (seen wound up, held on the contact, the finish held), each later one a share of the one
// before, the storm where the pace falls under `stormAt`. ?tempo=0: the storm of ADR-167 exactly; the
// storm piece off: the pace before it, whatever the tempo says. A riposte's last cut is the heavy beat
// again. Damage, the blows and where he ends: as before.
// ================================================================== scenario: timerip (?rip=)
// The flurry's cuts rip the picture (player/timeRip.js) on a man: a flurry of five (Passing Cut) in
// each look (tests/integration/timerip.mjs has the checks; integ.mjs `timerip` runs it on the wyrm).
async function scenarioTimeRip() {
  out("\n== scenario TIMERIP (the flurry's cuts rip the picture: off | tear | strip | ghosts | negative, on a duelist) ==");
  const { timeRipCheck } = await import('./timerip.mjs');
  const R = await timeRipCheck({
    THREE, build: () => build(), assert, out, DT, label: 'duelist',
    setup: (G) => {
      duel(G, { dist: 4 });
      settle(G);
      place(G, 2.5);
      run(G, 0.3);
      G.game.dragon.hp = G.game.dragon.maxHp;
      G.game.player.debug.god = true;
    },
    go: (G) => G.game.player.debug.flurry(5, 'passing'),
    frame: (G) => G.tick(DT),
    busy: (G) => G.game.player.state === 'flurry' || G.game.player.state === 'plunge',
  });
  return R.negative.G;
}

async function scenarioTempo() {
  out('\n== scenario TEMPO (the flurry on a man: heavy first, then faster by ratio; ?tempo=0 the storm as it was) ==');
  const { STREAK_FX } = await imp('src/combat/streak.js');
  const G = build();
  duel(G, { dist: 4 });
  const { game } = G;
  const d = game.dragon, p = game.player, F = DEFENSE.flurry, S = F.storm, TP = F.tempo;
  const on0 = STREAK_FX.on.storm, tempo0 = STREAK_FX.tempo;
  /** One flurry of `n` blows (Passing Cut), or a riposte of `n` cuts: the frame of every blow. */
  const take = (n, { storm = true, tempo = true, riposte = false } = {}) => {
    STREAK_FX.on.storm = storm;
    STREAK_FX.tempo = tempo;
    settle(G);
    place(G, 2.5);
    run(G, 0.3);
    d.hp = d.maxHp;
    const hp0 = d.hp;
    const tr = { hits: [], art: -1, f: 0, ev: null, ok: false };
    G.watch = (nm, e) => {
      const fl = p.flurry;
      if (nm === 'player:flurryHit') tr.hits.push({ f: tr.f, last: e.last, storm: e.storm, freeze: fl.freeze, hang: fl.hang, w: fl._weight(fl.i), hidden: fl.hidden });
      if (nm === 'player:flurryArt' && tr.art < 0) tr.art = tr.f;
      if (nm === 'player:flurry') tr.ev = { ...e };
    };
    tr.ok = riposte ? p.flurry.start(d, false, n, null, TELL.NORMAL, { riposte: true }) : p.debug.flurry(n, 'passing');
    tr.tempo = p.flurry.tempo;
    run(G, 8, () => { tr.f++; }, () => p.state !== 'flurry');
    G.watch = null;
    tr.dmg = hp0 - d.hp;
    tr.frames = tr.hits.map((h) => h.f).join(',');
    return tr;
  };
  const gaps = (t) => t.hits.filter((h) => !h.last).map((h, i, A) => (i ? h.f - A[i - 1].f : null)).slice(1);
  const rows = [];
  for (let n = 2; n <= F.max; n++) {
    const off = take(n, { tempo: false }), on = take(n), bare = take(n, { storm: false }), bareT = take(n, { storm: false, tempo: false });
    rows.push({ n, off, on, bare, bareT });
    out(`   N=${n}: blows on frames ${off.frames} (art ${off.art}) → tempo ${on.frames} (art ${on.art}) · storm cuts ${off.hits.filter((h) => h.storm > 0).length} → ${on.hits.filter((h) => h.storm > 0).length} · damage ${off.dmg} / ${on.dmg}`);
  }
  assert(rows.every((r) => r.off.ok && r.on.ok && r.on.tempo === true && r.off.tempo === false && r.bare.tempo === false), 'every flurry starts; the tempo is on by default and ?tempo=0 / the storm piece off turn it off');
  assert(rows.every((r) => r.bare.frames === r.bareT.frames && r.bare.art === r.bareT.art), `the storm piece off: the pace before the storm, whatever the tempo says (N=7 on frames ${rows[rows.length - 1].bare.frames})`);
  for (const r of rows) {
    const h = r.on.hits, cuts = h.filter((x) => !x.last), g = gaps(r.on);
    assert(h.length === r.n && h[r.n - 1].last && r.on.dmg === r.off.dmg && r.on.dmg === r.bare.dmg && h.every((x, i) => i === 0 || x.f > h[i - 1].f), `N=${r.n}: ${h.length} blows, each in a frame of its own, ${r.on.dmg} damage as before (${r.off.dmg})`);
    assert(h[0].f * DT >= 0.18 - 1e-9 && h[0].hang > 0 && Math.abs(h[0].freeze - TP.ground.stop) < 1e-9 && h[0].w === 1, `N=${r.n}: the first cut is the heavy beat: its contact ${(h[0].f * DT).toFixed(3)} s after the start (>= 0.18), seen wound up, frozen ${h[0].freeze.toFixed(3)} s`);
    assert(g.every((x, i) => i === 0 || x <= g[i - 1] + 1), `N=${r.n}: the gaps between blows never grow (${g.join(', ') || '-'} frames)`);
    assert(g.every((x, i) => i === g.length - 1 || x <= 2.25 * g[i + 1]), `N=${r.n}: no cliff between neighbouring gaps: each at most 2.25x the next (${g.join(', ') || '-'} frames)`);
    assert(cuts.every((x, i) => i === 0 || (x.w <= cuts[i - 1].w + 1e-9 && x.freeze <= cuts[i - 1].freeze + 1e-9)) && cuts.every((x) => !(x.storm > 0) || (x.w === 0 && x.freeze >= S.stopMin - 1e-9 && !x.hidden)), `N=${r.n}: the weight (${cuts.map((x) => x.w.toFixed(2)).join(' ')}) and the freeze (${cuts.map((x) => x.freeze.toFixed(3)).join(' ')} s) fall cut by cut`);
    assert(r.on.ev?.storm === cuts.some((x) => x.storm > 0) && r.on.ev?.at?.length === r.n - 1, `N=${r.n}: player:flurry plans ${r.on.ev?.at?.length} contacts (storm ${r.on.ev?.storm})`);
  }
  assert(rows.filter((r) => r.n <= 3).every((r) => r.on.hits.every((x) => !(x.storm > 0))), 'N=2 and N=3: no storm cut');
  const g7 = gaps(rows[rows.length - 1].on);
  assert(g7[g7.length - 1] <= 4 && rows[rows.length - 1].on.hits.some((x) => x.storm > 0), `N=7 still ends in a storm a few frames apart (${g7.join(', ')} frames; the last <= 4)`);
  // ?tempo=0 is the storm of ADR-167 (the frames measured when the tempo was built, 2026-11-24)
  const OLD = { 2: '8,62', 3: '8,30,80', 4: '8,31,48,95', 5: '8,31,48,58,102', 6: '8,31,49,59,65,107', 7: '8,31,49,60,66,70,112' };
  assert(rows.every((r) => r.off.frames === OLD[r.n]), `?tempo=0: the storm's frames as they were (${rows.map((r) => r.off.frames).join(' / ')})`);
  // the riposte: its cuts paced by the tempo, its last the heavy beat again (pace 1, whole weight, its 1.8x freeze)
  for (const n of [1, 3, 5]) {
    const r = take(n, { riposte: true }), o = take(n, { riposte: true, tempo: false }), L = r.hits[r.hits.length - 1];
    out(`   riposte of ${n}: frames ${o.frames} → tempo ${r.frames} · damage ${o.dmg} / ${r.dmg}`);
    assert(r.ok && r.hits.length === n && r.dmg === o.dmg && L.w === 1 && L.hang > 0 && Math.abs(L.freeze - TP.ground.stop * 1.8) < 1e-9 && !(L.storm > 0), `a riposte of ${n}: ${r.hits.length} cuts for ${r.dmg} damage as before, its last the heavy beat (frozen ${L.freeze.toFixed(3)} s)`);
  }
  STREAK_FX.on.storm = on0;
  STREAK_FX.tempo = tempo0;
  return G;
}

// ================================================================== scenario: chain (the flurry's path, on a man)
// THE CHAIN (STREAK_FX.chain, DEFENSE.flurry.chain; ?chain=0 off): every pass starts where the one
// before ended (A -> B -> C, never back to the start), every hanging line is the path he ran, the
// arts start where the last cut ended, the last blow throws letter dust, not the 'A' shards. Off: the
// ring-teleport paths exactly. Round the wyrm's head: integ.mjs `chain`.
async function scenarioChain() {
  out('\n== scenario CHAIN (the flurry on a man: each pass from where the last ended; its figures; the slashes on his path; letter dust) ==');
  const { STREAK_FX } = await imp('src/combat/streak.js');
  const FIG = await imp('src/entities/player/flurryFigures.js'), FL = await imp('src/entities/player/flurry.js');
  const { shapeOf, dumpFigure, measure } = await import(pathToFileURL(`${ROOT}/tests/integration/figures.mjs`).href);
  const figure0 = STREAK_FX.figure;
  const FX = await imp('src/entities/player/flurryFx.js');
  const G = build();
  duel(G, { dist: 4 });
  const { game } = G;
  const d = game.dragon, p = game.player, F = DEFENSE.flurry, CH = 1.2;
  const chain0 = STREAK_FX.chain;
  const rel = (x, z) => `(${(x - d.position.x).toFixed(2)},${(z - d.position.z).toFixed(2)})`;
  /** One flurry of `n` blows ending in `art` (or a riposte of `n` cuts): its passes, lines, blows. */
  const take = (n, art, { chain = true, riposte = false, dist = 2.5, figure = 'any' } = {}) => {
    STREAK_FX.chain = chain;
    STREAK_FX.figure = figure;
    settle(G);
    place(G, dist);
    run(G, 0.3);
    d.hp = d.maxHp;
    const hp0 = d.hp, fl = p.flurry;
    const tr = { passes: [], art: null, hits: [], f: 0, glyphs: new Set(), lineErr: 0, near: Infinity, ok: false, end: null };
    const o0 = { cs: fl._cutStarts, va: fl._vanish, ba: fl._beginArt };
    fl._cutStarts = function () { tr.passes.push({ ax: p.position.x, ay: p.position.y, az: p.position.z, i: fl.i, L: fl.nLines - 1, tx: fl.T.x, tz: fl.T.z }); return o0.cs.call(this); };
    fl._vanish = function (b) {
      const ps = tr.passes[tr.passes.length - 1];
      if (ps && ps.bx === undefined && fl.i < fl.cuts) {
        ps.bx = p.position.x;
        ps.by = p.position.y;
        ps.bz = p.position.z;
        const L = fl.lines[ps.L];
        // the hanging line's ends against where his chest was as the pass began / ended
        if (L) tr.lineErr = Math.max(tr.lineErr, Math.hypot(L.ax - ps.ax, L.ay - ps.ay - CH, L.az - ps.az), Math.hypot(L.bx - ps.bx, L.by - ps.by - CH, L.bz - ps.bz));
      }
      return o0.va.call(this, b);
    };
    fl._beginArt = function () {
      const sx = p.position.x, sz = p.position.z;
      const r = o0.ba.call(this);
      tr.art = { sx, sz, ax: fl.A.x, az: fl.A.z, bx: fl.B.x, bz: fl.B.z, tx: fl.T.x, tz: fl.T.z };
      return r;
    };
    const spy = [];
    for (const pool of new Set([game.fx?.add, game.fx?.alpha, p.fx?.add, p.fx?.alpha].filter(Boolean))) {
      const s0 = pool.spawn;
      spy.push([pool, s0]);
      pool.spawn = function (o) { if (p.state === 'flurry' && typeof o?.glyph === 'string') tr.glyphs.add(o.glyph); return s0.call(this, o); };
    }
    G.watch = (nm, e) => {
      if (nm === 'player:flurryHit') tr.hits.push({ f: tr.f, last: e.last, damage: e.damage });
      if (nm === 'player:flurryEnd') tr.end = { ...e };
      if (nm === 'player:flurry') tr.ev = { ...e };
    };
    tr.ok = riposte ? fl.start(d, false, n, null, TELL.NORMAL, { riposte: true }) : p.debug.flurry(n, art);
    tr.ox = fl.ox;
    tr.oz = fl.oz;
    run(G, 8, () => {
      tr.f++;
      // (from the end of the first pass to the end: never back on his dodge spot)
      // (the flash cuts; where the art leaves him is told apart: tr.artNear)
      if (p.state === 'flurry' && tr.passes[0]?.bx !== undefined && p.flurry.i < p.flurry.cuts) tr.near = Math.min(tr.near, Math.hypot(p.position.x - tr.ox, p.position.y, p.position.z - tr.oz));
    }, () => p.state !== 'flurry');
    G.watch = null;
    delete fl._cutStarts;
    delete fl._vanish;
    delete fl._beginArt;
    for (const [pool, s0] of spy) pool.spawn = s0;
    tr.endX = p.position.x;
    tr.endZ = p.position.z;
    tr.dmg = hp0 - d.hp;
    tr.artNear = tr.art ? Math.hypot(tr.art.bx - tr.ox, tr.art.bz - tr.oz) : Infinity;
    // the jump from each pass's end to the next one's start (and into the art)
    tr.jumps = tr.passes.slice(1).map((q, i) => Math.hypot(q.ax - tr.passes[i].bx, q.az - tr.passes[i].bz));
    const lp = tr.passes[tr.passes.length - 1];
    tr.artJump = tr.art && lp ? Math.hypot(tr.art.sx - lp.bx, tr.art.sz - lp.bz) : 0;
    tr.seq = `O${rel(tr.ox, tr.oz)} ` + tr.passes.map((q) => `${rel(q.ax, q.az)}->${rel(q.bx, q.bz)}`).join(' ') + (tr.art ? ` | art ${rel(tr.art.sx, tr.art.sz)}->${rel(tr.art.bx, tr.art.bz)}` : '') + ` | end ${rel(tr.endX, tr.endZ)}`;
    tr.figure = fl.figure;
    tr.fit = fl.figureFit;
    tr.seq = `${tr.figure}: ${tr.seq}`;
    return tr;
  };
  const shard = (t) => [...t.glyphs].some((g) => g.includes('A'));
  for (const art of ['passing', 'falling', 'rising']) {
    for (let n = 2; n <= F.max; n++) {
      const on = take(n, art), off = take(n, art, { chain: false });
      if ([2, 3, 5, 7].includes(n)) out(`   ${art} N=${n}: ${on.seq} · the art ends ${on.artNear.toFixed(2)} m from his dodge spot`);
      const hf = (t) => t.hits.map((h) => h.f);
      const df = hf(on).map((f, i) => Math.abs(f - (hf(off)[i] ?? -99)));
      assert(on.ok && off.ok && on.hits.length === n && on.dmg === off.dmg && df.every((x) => x <= 1), `${art} N=${n}: ${on.hits.length} blows, ${on.dmg} damage as with the chain off (${off.dmg}), every blow within a frame of it (${hf(on).join(',')} / ${hf(off).join(',')})`);
      assert(on.jumps.every((j) => j < 0.3) && on.artJump < 0.3, `${art} N=${n}: each pass starts where the last ended (${on.jumps.map((j) => j.toFixed(2)).join(' ') || '-'} m), the art too (${on.artJump.toFixed(2)} m)`);
      assert(n < 3 || on.near >= 1.5, `${art} N=${n}: through the flash cuts never back within 1.5 m of his dodge spot after the first pass (${on.near === Infinity ? '-' : on.near.toFixed(2)} m)`);
      assert(on.lineErr < 0.35, `${art} N=${n}: every hanging line runs from his chest at the pass's start to its end (off by ${on.lineErr.toFixed(3)} m at most)`);
      assert(!shard(on) && shard(off), `${art} N=${n}: no 'A' shard with the chain (glyphs ${[...on.glyphs].filter((g) => g.includes('A')).join(' ') || 'none'}); the chain off throws them as before`);
      // (off: the ring teleport, as before: a pass starts away from where the last ended)
      if (n >= 3) assert(off.jumps.some((j) => j > 0.5), `${art} N=${n}, the chain off: the passes teleport round the ring as before (${off.jumps.map((j) => j.toFixed(2)).join(' ')} m)`);
    }
  }
  // THE FIGURES: each pinned (?figure=), at every cut count it is offered at: it is the figure laid
  // (or, where it does not fit, the star), it reads as its name, and the chain's rules hold
  const FG = F.chain.figures;
  for (const name of FIG.FIGURE_NAMES) {
    for (let n = 2; n <= F.max; n++) {
      if (n - 1 < (FG[name]?.min ?? 1)) continue;
      // (3.5 m off him: a cage or a cross round a man drawn 2.5 m from the dodge spot passes within
      // 1.5 m of it, and so is passed over there for the star: below)
      const t = take(n, 'passing', { figure: name, dist: 3.5 });
      const sh = shapeOf(t.figure, t.passes);
      if ([3, 5, 7].includes(n)) out(`   ${name} N=${n}: ${t.seq}`);
      assert(t.figure === name, `${name} N=${n}: the figure laid is ${t.figure} (its cost ${t.fit.toFixed(2)})`);
      assert(sh.ok, `${name} N=${n}: it reads as a ${t.figure}: ${sh.why}`);
      // (ADR-101: past his side, never through his body, whatever the figure)
      const near = Math.min(...measure(t.passes).map((q) => q.abs));
      assert(near >= F.chain.figures.body.ground - 0.05, `${name} N=${n}: every pass runs past his side, ${near.toFixed(2)} m off his middle at the nearest`);
      assert(t.jumps.every((j) => j < 0.3) && t.artJump < 0.3 && t.near >= 1.5 && t.lineErr < 0.35 && t.ev?.figure === t.figure, `${name} N=${n}: chained (${t.jumps.map((j) => j.toFixed(2)).join(' ') || '-'} m), never back within 1.5 m of the dodge spot (${t.near === Infinity ? '-' : t.near.toFixed(2)} m), its lines on his path, player:flurry says ${t.ev?.figure}`);
      if ([3, 5, 7].includes(n)) {
        const T = { x: t.passes[0].tx, z: t.passes[0].tz };
        dumpFigure({ name, N: n, air: false, R: F.ground.reach, O: [t.ox - T.x, t.oz - T.z], passes: t.passes.map((q) => [q.ax - T.x, q.az - T.z, q.bx - T.x, q.bz - T.z]), art: t.art ? [t.art.sx - T.x, t.art.sz - T.z, t.art.bx - T.x, t.art.bz - T.z] : null, label: sh.why });
      }
    }
  }
  // a figure that does not fit is passed over for the star: a hexagon cage round a man with the dodge
  // spot 2.5 m off him would pass within 1.3 m of it
  {
    const t = take(F.max, 'passing', { figure: 'cage', dist: 2.5 });
    assert(t.figure === 'star' && t.near >= 1.5, `a cage of six that would pass the dodge spot 2.5 m off him is passed over for the ${t.figure} (never within ${t.near.toFixed(2)} m of it)`);
  }
  // the pick: a different figure each flurry, never the same twice running, several of them
  {
    FL.setFigureSeed(12345);
    p.flurry.lastFigure = '';
    const seen = [];
    for (let k = 0; k < 20; k++) seen.push(take(5, 'passing').figure);
    const kinds = new Set(seen), twice = seen.some((f, k) => k > 0 && f === seen[k - 1]);
    out(`   twenty flurries of five: ${seen.join(' ')}`);
    assert(kinds.size >= 4 && !twice, `twenty flurries of five draw ${kinds.size} figures (>= 4), never the same twice running (${twice ? 'twice' : 'never'})`);
  }
  // ?figure=star is the chain as it was: the same frames, the lines spread like a star
  {
    const s7 = take(F.max, 'passing', { figure: 'star' }), o7 = take(F.max, 'passing', { chain: false });
    const sh = shapeOf('star', s7.passes);
    assert(s7.figure === 'star' && s7.hits.map((h) => h.f).join() === o7.hits.map((h) => h.f).join() && sh.ok, `?figure=star: seven blows on the frames as before (${s7.hits.map((h) => h.f).join(',')}), ${sh.why}`);
  }
  // the dust: tiny letters, under the bloom threshold
  {
    const ds = p.flurry.fx.dustStat;
    take(3, 'passing');
    out(`   the last blow's dust: ${ds.n} letters, the biggest ${ds.maxSize.toFixed(3)} m, the brightest channel ${ds.maxCol.toFixed(2)}`);
    assert(ds.n >= 60 && ds.n <= 120 && ds.maxSize <= 0.09 + 1e-9 && ds.maxCol <= 0.55 + 1e-9, `the last blow throws ${ds.n} letters of white-steel dust (60 - 120), none over 0.09 m, none brighter than the bloom threshold`);
  }
  // the riposte: its cuts chain, its end is where he parried (the rule kept)
  for (const n of [3, 5]) {
    const r = take(n, null, { riposte: true, dist: 3.5 }), o = take(n, null, { riposte: true, chain: false, dist: 3.5 });
    const back = Math.hypot(r.endX - r.ox, r.endZ - r.oz);
    out(`   riposte N=${n}: ${r.seq}`);
    assert(r.ok && r.hits.length === n && r.dmg === o.dmg && r.jumps.every((j) => j < 0.3) && back < 1.2, `a riposte of ${n}: its cuts chain (${r.jumps.map((j) => j.toFixed(2)).join(' ')} m), ${r.dmg} damage as before, and he is back where he parried (${back.toFixed(2)} m)`);
  }
  // N = 1 (the art alone): the chain changes nothing but the dust
  {
    const a = take(1, 'passing'), b = take(1, 'passing', { chain: false });
    // (which side of him the iai passes is the animator's draw, as it always was: the distance is the same)
    const ra = Math.hypot(a.art.bx - a.art.tx, a.art.bz - a.art.tz), rb = Math.hypot(b.art.bx - b.art.tx, b.art.bz - b.art.tz);
    assert(a.hits.map((h) => h.f).join() === b.hits.map((h) => h.f).join() && a.dmg === b.dmg && Math.abs(ra - rb) < 0.05 && a.artJump === 0, `the art alone (N = 1): the same blow on the same frame, ending as far past him (${ra.toFixed(2)} / ${rb.toFixed(2)} m)`);
  }
  STREAK_FX.chain = chain0;
  STREAK_FX.figure = figure0;
  return G;
}

// ================================================================== scenario: dodgefx (the dodge looks, on a man)
// STREAK_FX.dodgefx (?dodgefx=a|b|c|d; DEFENSE.flurry.dodgefx): smeared copies, floor kicks, aerial cuts, and
// a Thunder Thrust / blooms / a spark cloud / a heavier finish. The blows land, the damage is the flurry's
// with it off, he is never somewhere that is not a number, and he ends every flurry on the floor.
async function scenarioDodgefx() {
  out('\n== scenario DODGEFX (the dodge looks: aerial cuts, smear, kicks; a thrust, blooms, a spark cloud, a heavy finish) ==');
  const { STREAK_FX } = await imp('src/combat/streak.js');
  const FL = await imp('src/entities/player/flurry.js');
  const G = build();
  duel(G, { dist: 4 });
  const { game } = G;
  const d = game.dragon, p = game.player, DF = DEFENSE.flurry.dodgefx;
  const fx0 = STREAK_FX.dodgefx;
  const take = (n, v, art = 'passing') => {
    STREAK_FX.dodgefx = v;
    FL.setFigureSeed(777);
    settle(G);
    place(G, 2.5);
    run(G, 0.3);
    d.hp = d.maxHp;
    const hp0 = d.hp, fl = p.flurry;
    const tr = { hits: [], bad: 0, maxY: 0, maxY1: 0, maxY0: 0, frames: 0, arts: new Set(), ok: false, landHold: 0 };
    G.watch = (nm) => {
      if (nm === 'player:flurryHit') tr.hits.push(tr.frames);
    };
    const st = fl.fx.dodgeStat;
    const s0 = { ...st };
    tr.ok = p.debug.flurry(n, art);
    tr.fxv = fl.fxv;
    run(G, 10, () => {
      tr.frames++;
      const q = p.position;
      if (!Number.isFinite(q.x + q.y + q.z + p.yaw)) tr.bad++;
      if (p.state !== 'flurry' || !fl.on) return;
      tr.arts.add(fl.art);
      tr.maxY = Math.max(tr.maxY, q.y);
      if (fl.ph === FL.FP.LAND) tr.landHold++;
      if (fl.i === 1 && fl.ph <= FL.FP.HOLD) tr.maxY1 = Math.max(tr.maxY1, q.y);
      if (fl.i === 0 && fl.ph <= FL.FP.HOLD) tr.maxY0 = Math.max(tr.maxY0, q.y);
    }, () => p.state !== 'flurry');
    G.watch = null;
    tr.endY = p.position.y;
    tr.dmg = hp0 - d.hp;
    tr.stat = { bloom: st.bloom - s0.bloom, tendrils: st.tendrils - s0.tendrils, sparks: st.sparks - s0.sparks, maxSize: st.maxSize, maxCol: st.maxCol };
    return tr;
  };
  // the off pool is the three; with a, four
  {
    const fl = p.flurry;
    fl.fxv = '';
    assert(fl.artPool(false).join() === 'passing,falling,rising' && fl.artPool(true).length === 3, 'dodgefx off: the ground arts are exactly the three (' + fl.artPool(false) + ')');
    fl.fxv = 'a';
    assert(fl.artPool(false).includes('thrust') && fl.artPool(false).length === 4, 'dodgefx a: the Thunder Thrust joins the pool');
    fl.fxv = '';
  }
  for (const v of ['a', 'b', 'c', 'd']) {
    for (const n of [2, 5, 7]) {
      const on = take(n, v), off = take(n, '');
      out('   ' + v + ' N=' + n + ': blows on frames ' + on.hits + ' (off ' + off.hits + '), damage ' + on.dmg + ' / ' + off.dmg + ', highest ' + on.maxY.toFixed(2) + ' m, ends at y ' + on.endY.toFixed(3) + ', letters bloom ' + on.stat.bloom + ' tendrils ' + on.stat.tendrils + ' sparks ' + on.stat.sparks);
      assert(on.ok && on.fxv === v && on.hits.length === n && off.hits.length === n && on.dmg === off.dmg && on.dmg > 0, v + ' N=' + n + ': the flurry ends, all ' + n + ' blows land (' + on.hits.length + '), ' + on.dmg + ' damage as with it off (' + off.dmg + ')');
      assert(on.bad === 0, v + ' N=' + n + ': never a non-finite position or heading (' + on.bad + ' frames)');
      assert(on.endY <= 0.02 && on.endY >= -0.02 && p.state !== 'flurry', v + ' N=' + n + ': he ends the flurry on the floor (y ' + on.endY.toFixed(3) + ')');
      if (n >= 5) assert(on.maxY1 > 1.5, v + ' N=' + n + ': flash cut 1 is aerial (up to ' + on.maxY1.toFixed(2) + ' m)');
      else assert(on.maxY <= 0.02, v + ' N=' + n + ': a short flurry stays on the floor (' + on.maxY.toFixed(3) + ' m)');
      if (n >= 7) assert(on.maxY0 > 1.5, v + ' N=' + n + ': flash cut 0 is aerial too (up to ' + on.maxY0.toFixed(2) + ' m)');
      else if (n >= 5) assert(on.maxY0 <= 0.02, v + ' N=' + n + ': cut 0 stays on the floor (' + on.maxY0.toFixed(3) + ' m)');
      assert(off.maxY <= 0.02, v + ' N=' + n + ': off, no cut leaves the floor (' + off.maxY.toFixed(3) + ' m)');
      if (v === 'b') assert(on.stat.bloom >= n && on.stat.tendrils >= 3 * n, 'b N=' + n + ': a bloom and tendrils on every blow (' + on.stat.bloom + ' blooms, ' + on.stat.tendrils + ' tendrils)');
      if (v === 'c') assert(on.stat.sparks >= 18 * (n - 1), 'c N=' + n + ': a spray of sparks on every blow (' + on.stat.sparks + ')');
      if (v === 'b' || v === 'c') assert(on.stat.maxSize <= 0.09 + 1e-9 && on.stat.maxCol <= 0.55 + 1e-9, v + ' N=' + n + ': tiny letters (' + on.stat.maxSize.toFixed(3) + ' m) under the bloom threshold (' + on.stat.maxCol.toFixed(2) + ')');
      if (v === 'd' && n === 5) {
        const fall = take(n, v, 'falling'), fall0 = take(n, '', 'falling');
        assert(fall.landHold >= Math.floor(DF.heavy.land / DT) - 2 && fall.dmg === fall0.dmg && fall.hits.length === n && fall.endY <= 0.02, 'd: the Falling Leaf holds its landing (' + fall.landHold + ' frames), the same damage (' + fall.dmg + ' / ' + fall0.dmg + ')');
      }
    }
  }
  // the thrust itself (pinned): its blows, the same damage, a bloom and its tendrils, he ends on the floor
  for (const n of [1, 3, 5]) {
    const t = take(n, 'a', 'thrust'), o = take(n, '', 'passing');
    out('   thrust N=' + n + ': blows on frames ' + t.hits + ', damage ' + t.dmg + ' / ' + o.dmg + ', art ' + [...t.arts] + ', bloom ' + t.stat.bloom + ', tendrils ' + t.stat.tendrils);
    assert(t.ok && [...t.arts].join() === 'thrust' && t.hits.length === n && t.dmg === o.dmg && t.bad === 0 && t.endY <= 0.02, 'thrust N=' + n + ': the art is the Thunder Thrust, ' + n + ' blows (' + t.hits.length + '), ' + t.dmg + ' damage as the Passing Cut (' + o.dmg + '), he ends on the floor');
    assert(t.stat.bloom >= 1 && t.stat.tendrils >= DF.thrust.tendrils && t.stat.maxSize <= 0.09 + 1e-9, 'thrust N=' + n + ': a bloom and ' + DF.thrust.tendrils + ' tendrils as it lands (' + t.stat.bloom + ', ' + t.stat.tendrils + ')');
  }
  // the pick: with a, the Thunder Thrust now and then; with it off, never
  {
    const fl = p.flurry;
    const seen = (v) => {
      const got = [];
      fl.fxv = v;
      fl.lastArt.ground = '';
      p.debug.flurryArt = null;
      for (let k = 0; k < 24; k++) got.push(fl._pickArt(false));
      fl.fxv = '';
      return got;
    };
    const on = seen('a'), off = seen('');
    out('   24 picks with a: ' + on.join(' ') + ' | off: ' + [...new Set(off)]);
    assert(on.includes('thrust') && new Set(on).size >= 3, 'with a the pick draws the Thunder Thrust (' + on.filter((x) => x === 'thrust').length + ' of 24) among the others');
    assert(!off.includes('thrust') && new Set(off).size === 3, 'off the pick never draws it: ' + [...new Set(off)]);
  }
  STREAK_FX.dodgefx = fx0;
  return G;
}

// ================================================================== scenario: ghostep
async function scenarioGhostep() {
  out('\n== scenario GHOSTEP (a perfect dodge is answered by the flurry: an art through him that leaves the hero at his back; a streak adds flash cuts) ==');
  const G = build();
  duel(G, { dist: 5 });
  const { game, input } = G;
  const d = game.dragon, p = game.player, F = DEFENSE.flurry;
  const behindOf = () => -((p.position.x - d.position.x) * Math.sin(d.yaw) + (p.position.z - d.position.z) * Math.cos(d.yaw));
  // THE CHAIN (STREAK_FX.chain, the default): the art runs on from where the last flash cut ended,
  // so after one cut (N = 2) it goes through him from his back and leaves the hero past him at his
  // FRONT. The rule kept is "past him": as far beyond him as his ghostepBehind, on the far side from
  // where the art began (?chain=0: at his back, as before). The crit window opens either way.
  const { STREAK_FX } = await imp('src/combat/streak.js');
  const chained = () => STREAK_FX.chain !== false;
  /** Past him along the art: m beyond him on the far side of where its coil began (chain), else behindOf(). */
  const pastOf = () => {
    if (!chained()) return behindOf();
    const C = p.flurry.C0, ex = p.position.x - d.position.x, ez = p.position.z - d.position.z, cx = C.x - d.position.x, cz = C.z - d.position.z;
    return ex * cx + ez * cz < 0 ? Math.hypot(ex, ez) : -Math.hypot(ex, ez);
  };
  /** Tick until the flurry is over: its blows, whether it stayed invulnerable and finite. */
  const ride = (max = 6) => {
    const tr = { hits: [], end: null, frames: 0, iframes: true, finite: true, maxY: 0, shove: 0, close: Infinity };
    let bx = d.position.x, bz = d.position.z;
    const w0 = G.watch;
    G.watch = (n, e) => {
      if (n === 'player:flurryHit') tr.hits.push({ ...e });
      if (n === 'player:flurryEnd') tr.end = { ...e };
    };
    run(G, max, () => {
      input.axis = { x: 0, y: 0 };
      tr.frames++;
      if (p.state === 'flurry' && !p.isInvulnerable()) tr.iframes = false;
      if (![p.position.x, p.position.y, p.position.z].every(Number.isFinite)) tr.finite = false;
      tr.maxY = Math.max(tr.maxY, p.position.y);
      // (ADR-101) how far he is thrown in one frame, and how near the hero comes to him in a flash cut
      tr.shove = Math.max(tr.shove, Math.hypot(d.position.x - bx, d.position.z - bz));
      bx = d.position.x;
      bz = d.position.z;
      const fl = p.flurry;
      if (p.state === 'flurry' && !fl.hidden && fl.i < fl.cuts) tr.close = Math.min(tr.close, Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z));
    }, () => p.state !== 'flurry');
    G.watch = w0;
    return tr;
  };
  p.debug.flurryArt = 'passing';
  /** Trigger `mv` and roll (to the side) 0.1 s before its first impact: a perfect dodge. */
  const dodge = (mv) => {
    let flashT = null, rolled = false;
    const n0 = G.counts['player:ghostep'] ?? 0;
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === mv && flashT === null) flashT = game.time; };
    d.debug.trigger(mv);
    run(G, 2.5, () => {
      input.axis = { x: 0, y: 0 };
      if (flashT !== null && !rolled && game.time >= flashT + TUNING.flashLead - 0.1) {
        rolled = true;
        input.axis = { x: 1, y: 0 };
        input.tap('Space');
      }
    }, () => (G.counts['player:ghostep'] ?? 0) > n0);
    G.watch = null;
    return (G.counts['player:ghostep'] ?? 0) - n0;
  };
  // (ADR-102) a WHITE blow can be parried: its perfect dodge is no flurry. The streak counts and
  // time slows where he stands; no crit window, he is not hurt and his move goes on
  const hp00 = d.hp;
  let got = dodge('plumThrust');
  const front = behindOf();
  assert(got === 1 && p.state === 'ghostep' && p.streak === 1 && d.hp === hp00 && front < 0, `a perfect dodge of his thrust (a white blow) is no flurry: the streak counts, he is not hurt, the hero stays before him (${p.state}, streak ${p.streak}, ${(-front).toFixed(2)} m in front)`);
  assert(p.critTimer <= DEFENSE.ghostep.critWindowWhite + 1e-6 && p.iframeT > 0, `no crit window for it (${p.critTimer.toFixed(2)} s; DEFENSE.ghostep.critWindowWhite ${DEFENSE.ghostep.critWindowWhite}); the dodge's i-frames hold`);
  // a RED blow has no other answer: its perfect dodge is the flurry, as many blows as the streak
  settle(G);
  place(G, 2.2);
  run(G, 0.3);
  const hp01 = d.hp, st0 = p.streak;
  got = dodge('lotus');
  assert(got === 1 && p.state === 'flurry' && p.streak === st0 + 1 && p.flurry.air === false, `a perfect dodge of his sweep (a red blow) starts the flurry on the ground: he offers no plunge (${p.state}, streak ${p.streak})`);
  const t0 = ride();
  const behind = pastOf();
  out(`   ${t0.hits.length} blows (${p.flurry.art}): he lost ${hp01 - d.hp} · the hero ${behind.toFixed(2)} m behind him, y ${p.position.y}, ${p.state}, crit ${p.critTimer.toFixed(2)}`);
  assert(t0.hits.length === 2 && t0.hits[1].last === true && hp01 - d.hp === F.cut.damage + F.last.damage, `the streak of two is a flash cut and the art: ${hp01 - d.hp} damage (${F.cut.damage} + ${F.last.damage}, past his guard)`);
  assert(p.state === 'ghostep' && Math.abs(behind - TUNING.ghostepBehind) < 0.6 && p.critTimer > DEFENSE.ghostep.critWindowWhite && p.position.y === 0, `it leaves the hero ${behind.toFixed(2)} m ${chained() ? 'past him along the art' : 'behind him'} (his ghostepBehind ${TUNING.ghostepBehind}: within sword reach) with the full crit window`);
  assert(t0.iframes && t0.finite, 'invulnerable and finite throughout');
  // the old rule is one switch away (DEFENSE.flurry.on 'any'; the Lab's debug.flurryAny)
  settle(G);
  place(G, 5);
  run(G, 0.3);
  p.debug.flurryAny = true;
  got = dodge('plumThrust');
  assert(got === 1 && p.state === 'flurry', `with debug.flurryAny a white blow's perfect dodge is the flurry again (${p.state})`);
  ride();
  p.debug.flurryAny = false;
  // the back is open: his guard never covers it
  run(G, 0.2);
  d.brain.raiseT = 0;
  const hp0 = d.hp;
  const back0 = behindOf();
  const trace = [];
  input.click(0);
  // (he may still be in a freeze: 0.9 s of real time)
  run(G, 0.9, () => trace.push(`${p.state}${p.atk?.hit ? '!' : ''}`));
  if (process.env.GCD_TRACE) out('     trace', back0.toFixed(2), d.mode, d.brain.act?.name ?? '-', trace.filter((s, i, a) => s !== a[i - 1]).join(' '));
  assert(d.hp < hp0, `a cut at his back after it lands (hp ${hp0} → ${d.hp}; ${back0.toFixed(2)} m behind him, ${d.mode})`);

  // each of the arts against a foe on the ground, two blows: a flash cut through him, then the art
  for (const art of ['passing', 'falling', 'rising']) {
    settle(G);
    place(G, 4.5);
    run(G, 0.3);
    const hpA = d.hp;
    const ok = p.debug.flurry(2, art);
    const tr = ride();
    const b = pastOf(), want = F.cut.damage + F.last.damage;
    out(`   ${art}: started ${ok} · blows ${tr.hits.length} · he lost ${hpA - d.hp} · max y ${tr.maxY.toFixed(1)} · ${(tr.frames * DT).toFixed(2)} s · ${b.toFixed(2)} m behind him · ${p.state}`);
    assert(ok === true && p.flurry.art === art && tr.hits.length === 2 && tr.hits[1].last && hpA - d.hp === want && tr.end?.damage === want, `${art}: a flash cut and the art, ${hpA - d.hp} damage (${want})`);
    assert(p.state !== 'flurry' && p.position.y === 0 && Math.abs(b - TUNING.ghostepBehind) < 0.75 && p.critTimer > 0 && tr.iframes && tr.finite, `${art}: the hero lands ${b.toFixed(2)} m ${chained() ? 'past him along the art' : 'behind him'} (${behindOf().toFixed(2)} m behind his back), the crit window open`);
    assert((art === 'passing') === (tr.maxY < 0.05), `${art}: ${art === 'passing' ? 'run on the ground' : `through the air (${tr.maxY.toFixed(1)} m up)`}`);
  }
  // a streak of five: four cuts cross on him before the art
  settle(G);
  place(G, 4.5);
  run(G, 0.3);
  const hp5 = d.hp;
  p.debug.flurry(5, 'passing');
  const t5 = ride(8);
  assert(t5.hits.length === 5 && hp5 - d.hp === 4 * F.cut.damage + F.last.damage && t5.end?.strikes === 5, `five blows: ${hp5 - d.hp} damage (${4 * F.cut.damage + F.last.damage}) in ${(t5.frames * DT).toFixed(2)} s`);
  assert(p.state !== 'flurry' && p.position.y === 0 && p.flurry.nLines === 0 && !p.flurry.pending, 'it ends on the ground, nothing left hanging');
  // ADR-101: a flurry on a man is paced to be followed. The cuts pass his side (never through his
  // body), they do not throw him about, and the last blow sends him away from where the hero lands
  const GR = F.ground;
  out(`   the cuts: nearest ${t5.close.toFixed(2)} m to him (side ${GR.side}) · his biggest step in a frame ${t5.shove.toFixed(3)} m · afterimage of ${p.fx.bodyN} points`);
  assert(t5.close > GR.side * 0.7, `a flash cut runs past his side: never nearer than ${t5.close.toFixed(2)} m (was 0: through his body)`);
  assert(t5.shove < 0.12, `no blow of it throws him across the floor in a frame (${t5.shove.toFixed(3)} m; a shove of 0.32 m per cut read as him jumping about)`);
  assert(p.fx.bodyN >= 100 && p.fx.body === p._ghostPts, `the afterimage is drawn from his own body: ${p.fx.bodyN} points sampled`);
  const hx5 = p.position.x, hz5 = p.position.z, gap0 = Math.hypot(hx5 - d.position.x, hz5 - d.position.z);
  run(G, 0.7, () => { input.axis = { x: 0, y: 0 }; });
  const gap1 = Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z), pushed = Math.hypot(p.position.x - hx5, p.position.z - hz5);
  out(`   after it: ${gap0.toFixed(2)} m behind him → ${gap1.toFixed(2)} m · the hero moved ${pushed.toFixed(2)} m`);
  assert(gap1 >= gap0 - 0.05 && pushed < 0.1, `he stumbles away from the hero, not into him (${gap0.toFixed(2)} → ${gap1.toFixed(2)} m, the hero pushed ${pushed.toFixed(2)} m)`);
  // a cut flinches him out of whatever he was doing: he does not hang in his string's pose
  settle(G);
  place(G, 2.6);
  run(G, 0.3);
  d.debug.trigger(MOVES.plumThrust ? 'plumThrust' : Object.keys(MOVES)[0]);
  run(G, 0.1);
  const mode0 = d.mode;
  p.debug.flurry(3, 'passing');
  run(G, 2, null, () => p.flurry.i >= 1 || p.state !== 'flurry');
  out(`   cut out of his own move: ${mode0} → ${d.mode}${d.brain.react ? ' (' + d.brain.react.kind + ')' : ''}`);
  assert(mode0 === 'act' && d.mode === 'react', `the first cut throws him out of his move (${mode0} → ${d.mode})`);
  ride(8);
  p.debug.flurryArt = null;
  return G;
}

// ================================================================== scenario: perfectfx (the streak pass)
// A single perfect parry / perfect dodge in its three looks (combat/perfectFx.js, ?perfect=): `today`
// draws and times exactly as before; `sharp` prints its mark in the fire field (finite, never below
// 0.7 m, it ends) with no more slow motion than today; `cinema` gives its long beat to a single / last
// blow only. The rules do not move: his recovery after a parried last blow lasts the same GAME time in
// every mode, and a seven-cut string parried perfectly is not slower to play in `sharp` than today.
async function scenarioPerfectFx() {
  out('\n== scenario PERFECTFX (a perfect parry / dodge in three looks: today | sharp | cinema; the rules unmoved) ==');
  const PFX = await imp('src/combat/perfectFx.js');
  const STK = await imp('src/combat/streak.js');
  const MODES = ['today', 'sharp', 'cinema'];
  const R = {};
  // (his posture kept empty: seven perfect parries would break it and end the string early)
  const press = (lead) => (left) => {
    G0.game.dragon.posture = 0;
    if (left > lead) return false;
    G0.input.up(1);
    G0.input.click(1);
    return true;
  };
  let G0 = null;
  for (const mode of MODES) {
    STK.setPerfectMode(mode);
    PFX.perfectClear();
    const G = (G0 = build());
    duel(G, { dist: 2.0 });
    const { game, input } = G;
    const d = game.dragon, p = game.player;
    p.debug.god = true;
    p.debug.noRiposte = true;
    const r = (R[mode] = { mode });
    // 1) a single perfect parry (Plum Thrust, pressed 0.04 s before the blow)
    run(G, 0.4);
    home(G);
    place(G, 2.0);
    run(G, 0.3);
    const n0 = PFX.PERFECT_LAST.n, q0 = G.hits.length;
    let cine = null;
    const seen = [];
    G.watch = (n, e) => {
      if (n === 'game:cinematic') {
        seen.push(e?.kind);
        const c = game.flow.cine;
        cine = c ? { slowmo: c.slowmo, dur: c.dur, zoom: c.zoom } : null;
      }
    };
    answerMove(G, 'plumThrust', press(0.04), 3);
    G.watch = null;
    const ph = G.hits.slice(q0).find((h) => h.r === RESULT.PARRIED);
    r.stop = ph?.stop ?? 0;
    r.flash = ph?.flash ?? 0;
    r.cine = cine;
    r.seen = seen.slice();
    r.marks = PFX.PERFECT_LAST.n - n0;
    r.mark = { ...PFX.PERFECT_LAST };
    run(G, 1.2);
    r.ended = PFX.PERFECT_LAST.ended && !PFX.perfectBusy();
    // 2) the punish window: Plum Thrust parried perfectly, game AND real time from the parry to his
    // footwork (his recovery is the hero's opening)
    settle(G, 8);
    home(G);
    place(G, 2.0);
    run(G, 0.3);
    let gt0 = null, rt0 = null;
    G.watch = (n, e) => {
      if (n === 'player:parry' && e?.perfect) {
        gt0 = game.time;
        rt0 = game.realTime;
      }
    };
    answerMove(G, 'plumThrust', press(0.04), 4);
    G.watch = null;
    r.punishGame = gt0 == null ? NaN : game.time - gt0;
    r.punishReal = rt0 == null ? NaN : game.realTime - rt0;
    // 3) the seven-cut string (Ash Rain), every blow parried perfectly: its real time, the beats
    settle(G, 8);
    home(G);
    place(G, 2.0);
    run(G, 0.3);
    const beats = [];
    let perf = 0;
    const rs = game.realTime, gs = game.time;
    G.watch = (n, e) => {
      if (n === 'player:parry') {
        if (e?.perfect) perf++;
        beats.push(e?.beat || '-');
      }
    };
    const h0 = G.hits.length;
    // (its fourth blow is marked `lock`: a perfect parry of it crosses the blades, a moment of its
    // own; unmarked for this measurement, so all seven blows are parried)
    const locks = MOVES.ashRain.beats.map((bt) => bt.lock);
    for (const bt of MOVES.ashRain.beats) bt.lock = false;
    answerMove(G, 'ashRain', press(0.04), 12);
    MOVES.ashRain.beats.forEach((bt, i) => (bt.lock = locks[i]));
    G.watch = null;
    if (process.env.GCD_TRACE) out('     ashRain', G.hits.slice(h0).map((h) => `${h.r}/${h.tell}@${h.t.toFixed(2)}`).join(' '), d.mode, d.brain.react?.kind, d.posture, d.maxPosture, d.broken);
    r.stringReal = game.realTime - rs;
    r.stringGame = game.time - gs;
    r.perf = perf;
    r.beats = beats.join('');
    // 4) a perfect dodge of a white blow (Plum Thrust): the Ghostep's slow motion (real s), and the rules
    settle(G, 8);
    home(G);
    place(G, 3.0);
    run(G, 0.3);
    const l0 = PFX.PERFECT_LAST.lineN, a0 = PFX.PERFECT_LAST.arriveN;
    let flashT = null, rolled = false, dodged = false, slowReal = 0, crit = NaN, ifr = NaN, low = Infinity, after = 0;
    G.watch = (n, e) => {
      if (n === 'combat:flash' && e?.attack === 'plumThrust' && flashT === null) flashT = game.time;
      if (n === 'player:ghostep') {
        dodged = true;
        crit = p.critTimer;
        ifr = p.iframeT;
      }
    };
    d.debug.trigger('plumThrust');
    run(G, 3, () => {
      input.axis = { x: 0, y: 0 };
      if (flashT !== null && !rolled && game.time >= flashT + TUNING.flashLead - 0.1) {
        rolled = true;
        input.axis = { x: 1, y: 0 };
        input.tap('Space');
      }
      if (dodged) after++;
      if (dodged && game.timeScale * (game.hitstopTimer > 0 ? game.hitstopScale : 1) < 0.9) slowReal += DT;
      if (dodged && Number.isFinite(PFX.PERFECT_LAST.lowY)) low = Math.min(low, PFX.PERFECT_LAST.lowY);
    }, () => after > 2 && game.timeScale > 0.99 && game.hitstopTimer <= 0);
    G.watch = null;
    r.dodged = dodged;
    r.slowReal = slowReal;
    r.crit = crit;
    r.ifr = ifr;
    r.ghost = PFX.PERFECT_LAST.ghost;
    run(G, 1);
    r.tear = PFX.PERFECT_LAST.tear;
    r.lines = PFX.PERFECT_LAST.lineN - l0;
    r.arrives = PFX.PERFECT_LAST.arriveN - a0;
    r.dodgeLow = low;
    out(`   ${mode.padEnd(6)} parry: freeze ${r.stop.toFixed(3)} s, flash ${r.flash.toFixed(2)}, slow x${r.cine?.slowmo ?? '-'} for ${r.cine?.dur ?? '-'} s, zoom ${r.cine?.zoom ?? '-'} · mark ${r.marks ? `${r.mark.kind} ${r.mark.frames} frames, ${r.mark.blobs} blobs (peak ${r.mark.peak}), lowest ${r.mark.lowY.toFixed(2)} m, ended ${r.ended}` : 'none'}`);
    out(`          punish window: ${r.punishGame.toFixed(3)} s game (${r.punishReal.toFixed(3)} s real) · Ash Rain: ${r.perf}/7 perfect [${r.beats}] in ${r.stringReal.toFixed(2)} s real (${r.stringGame.toFixed(2)} s game)`);
    out(`          dodge: slow motion ${r.slowReal.toFixed(2)} s real, crit ${r.crit} s, i-frames ${Number(r.ifr).toFixed(3)} s · afterimage ${r.ghost} cells, ${r.tear} torn, ${r.lines} line(s), ${r.arrives} arrival(s)`);
  }
  STK.setPerfectMode('today');
  const T = R.today, S = R.sharp, C = R.cinema;
  // today, exactly as before
  assert(T.marks === 0 && T.seen.includes('perfectParry') && T.stop >= 0.13 && T.flash > 0.4 && T.cine?.slowmo === 0.35 && T.cine?.dur === 0.36, `today: no mark, freeze ${T.stop.toFixed(3)} s, flash ${T.flash.toFixed(2)}, slow x${T.cine?.slowmo} for ${T.cine?.dur} s (TUNE.perfectParry)`);
  assert(T.dodged && Math.abs(T.slowReal - DEFENSE.ghostep.slowmoTime) < 0.05 && T.lines === 0 && T.arrives === 0, `today: the Ghostep's slow motion is ${T.slowReal.toFixed(2)} s (DEFENSE.ghostep ${DEFENSE.ghostep.slowmoTime}), no line, no arrival`);
  // sharp: its mark, shorter
  const SF = PFX.PERFECT_FEEL.sharp;
  assert(S.marks === 1 && S.mark.kind === 'parry' && S.mark.blobs > 0 && S.mark.lowY >= 0.7 - 1e-6 && S.ended, `sharp: the mark prints in the fire field (${S.mark.blobs} blobs, ${S.mark.frames} frames, lowest ${S.mark.lowY.toFixed(2)} m) and ends`);
  assert(S.seen.includes('perfectParry') && S.cine.dur * (1 - S.cine.slowmo) <= T.cine.dur * (1 - T.cine.slowmo) + 1e-9 && S.cine.slowmo >= T.cine.slowmo && S.flash < T.flash && Math.abs(S.stop - SF.parry.stop) < 0.01, `sharp: no more slow motion than today (x${S.cine.slowmo} for ${S.cine.dur} s against x${T.cine.slowmo} for ${T.cine.dur} s), the flash ${S.flash.toFixed(2)} (< ${T.flash.toFixed(2)}), freeze ${S.stop.toFixed(3)} s`);
  assert(S.dodged && S.slowReal <= T.slowReal + 1e-6 && S.ghost > 50 && S.tear === S.ghost && S.lines === 1 && S.arrives === 0 && !(S.dodgeLow < 0.7 - 1e-6), `sharp: the dodge's slow motion ${S.slowReal.toFixed(2)} s (<= ${T.slowReal.toFixed(2)}), the afterimage stands and tears (${S.tear}/${S.ghost} letters), one line`);
  // cinema: the long beat for a single / last blow only
  const CF = PFX.PERFECT_FEEL.cinema.parry;
  assert(C.marks === 1 && C.mark.beat === 'full' && C.cine?.dur === CF.full.beat.dur && C.cine?.slowmo === CF.full.beat.slowmo && C.flash < 0.05 && C.mark.lowY >= 0.7 - 1e-6 && C.ended, `cinema: a single blow gets the full beat (x${C.cine?.slowmo} for ${C.cine?.dur} s), no white flash (${C.flash.toFixed(2)}), the mark ends`);
  assert(C.perf === 7 && /^(short){6}full$/.test(C.beats), `cinema: inside the seven-cut string the beats are short, the last is full [${C.beats}]`);
  assert(C.dodged && C.ghost > 50 && C.tear === C.ghost && C.lines === 1 && C.arrives === 1, `cinema: the dodge's afterimage tears, its line and the arrival mark (${C.lines}, ${C.arrives})`);
  // the rules: the same game-time punish window, the same crit window and i-frames; sharp's string no slower
  for (const M of [S, C]) assert(Math.abs(M.punishGame - T.punishGame) <= 2 * DT && Math.abs(M.crit - T.crit) < 1e-9 && Math.abs(M.ifr - T.ifr) < 1e-9, `${M.mode}: his recovery after the parry lasts ${M.punishGame.toFixed(3)} s of game time (today ${T.punishGame.toFixed(3)}; real ${M.punishReal.toFixed(2)} against ${T.punishReal.toFixed(2)}); crit ${M.crit}, i-frames the same`);
  assert(S.perf === 7 && T.perf === 7 && S.stringReal <= T.stringReal + 1e-6 && Math.abs(S.stringGame - T.stringGame) < 0.1, `seven perfect parries of Ash Rain take ${S.stringReal.toFixed(2)} s real in sharp, ${T.stringReal.toFixed(2)} s today (${C.stringReal.toFixed(2)} s cinema)`);
  // it holds up repeated every 0.3 s, and nothing throws without a fire field
  STK.setPerfectMode('sharp');
  PFX.perfectClear();
  const G = build();
  duel(G, { dist: 2.0 });
  const { game } = G;
  const d = game.dragon, p = game.player;
  let peak = 0;
  const clash0 = PFX.parryClashMode();
  PFX.setParryClash('0'); // (the mark as built, its rings and echoes; the default draws it as a pinpoint: ?parryClash=c, ADR-264)
  for (let i = 0; i < 10; i++) {
    PFX.perfectParryMark(game, (p.position.x + d.position.x) / 2, 1.2, (p.position.z + d.position.z) / 2, { mode: i & 1 ? 'cinema' : 'sharp', beat: 'full', streak: 12 });
    run(G, 0.3, () => { peak = Math.max(peak, game.fx.fire.count); });
  }
  run(G, 1);
  assert(peak < 400 && !PFX.perfectBusy() && PFX.PERFECT_LAST.echo === 2, `a mark every 0.3 s: at most ${peak} blobs alive at once, all gone after; at streak tier ${STK.streakTier(12)} cinema's ring has ${PFX.PERFECT_LAST.echo} echoes`);
  PFX.setParryClash(clash0);
  assert(PFX.perfectBeat('cinema', true, 100) === 'full' && PFX.perfectBeat('cinema', true, 100.3) === 'short' && PFX.perfectBeat('cinema', true, 101.5) === 'full' && PFX.perfectBeat('sharp', true, 105) === '', 'cinema: a second last-blow parry within the gap gets the short beat');
  const fire = game.fx.fire;
  game.fx.fire = null;
  let threw = null;
  try {
    PFX.perfectParryMark(game, 0, 1, 0, { mode: 'cinema' });
    PFX.perfectDodgeLine(game, 0, 1, 0, 2, 1, 0, 'sharp');
    PFX.perfectArrive(game, 0, 1, 0, 'cinema');
    for (let i = 0; i < 12; i++) PFX.perfectUpdate(game, DT, DT);
    p.fx.parry(p.position.x, 1.2, p.position.z, false, 1, 0, 1, { perfect: true, feel: p.fx.perfectMoment('parry', true, 3, 'cinema') });
  } catch (e) {
    threw = e;
  }
  game.fx.fire = fire;
  STK.setPerfectMode('today');
  PFX.perfectClear();
  assert(!threw && errors.length === 0, `nothing throws without a fire field (${threw?.message ?? 'ok'}), no console errors`);
  return G;
}

// ================================================================== scenario: parryfx (?parryFx=)
// The perfect parry's spit of sparks (combat/parrySparks.js, ?parryFx=0|a; `a` the default, ADR-181;
// 0 = the parry as before): with 0 nothing is drawn beyond the shipped mark (no spark); with a the mark is the same
// (frames, blobs) and a PERFECT parry throws 12 - 16 sparks (never a normal one): none white, none
// above the bloom threshold, 90 % of them die within 0.6 m of the crossing, all gone within 0.55 s
// real; finite; no Math.random; a string stays at most 48 alive; nothing throws without a fire field.
async function scenarioParryFx() {
  out('\n== scenario PARRYFX (the perfect parry: a spit of orange sparks off the crossed steel; ?parryFx=0|a) ==');
  const PFX = await imp('src/combat/perfectFx.js');
  const STK = await imp('src/combat/streak.js');
  const PS = await imp('src/combat/parrySparks.js');
  const L = PS.PARRY_SPARKS_LAST;
  const press = (lead) => (left) => {
    G.game.dragon.posture = 0;
    if (left > lead) return false;
    G.input.up(1);
    G.input.click(1);
    return true;
  };
  let G = null;
  const R = {};
  STK.setPerfectMode('sharp');
  for (const mode of ['0', 'a']) {
    PS.setParryFx(mode);
    PFX.perfectClear();
    G = build();
    duel(G, { dist: 2.0 });
    const { game } = G;
    const p = game.player;
    p.debug.god = true;
    p.debug.noRiposte = true;
    const r = (R[mode] = { mode });
    // 1) a normal parry (pressed early, outside the perfect window): no spark
    run(G, 0.4);
    home(G);
    place(G, 2.0);
    run(G, 0.3);
    let n0 = L.n, perf = null;
    G.watch = (n, e) => {
      if (n === 'player:parry') perf = !!e?.perfect;
    };
    answerMove(G, 'plumThrust', press(PLAIN_LEAD), 3);
    G.watch = null;
    r.normal = { perfect: perf, sparks: L.n - n0 };
    // 2) a perfect parry
    settle(G, 8);
    home(G);
    place(G, 2.0);
    run(G, 0.3);
    n0 = L.n;
    const m0 = PFX.PERFECT_LAST.n;
    L.peak = 0;
    L.maxCh = 0;
    L.white = 0;
    L.bad = 0;
    answerMove(G, 'plumThrust', press(0.04), 3);
    run(G, 1.0);
    r.marks = PFX.PERFECT_LAST.n - m0;
    r.blobs = PFX.PERFECT_LAST.blobs;
    r.frames = PFX.PERFECT_LAST.frames;
    r.sparks = L.n - n0;
    r.spawned = r.sparks ? L.spawned : 0;
    r.main = L.main;
    r.heavy = L.heavy;
    r.near = r.sparks ? L.near / Math.max(1, L.died) : 0;
    r.reach = L.reachMax;
    r.life = L.lifeMax;
    r.maxCh = L.maxCh;
    r.white = L.white;
    r.end = r.sparks ? L.lifeMax : null; // (real s from the spit to its last spark's death)
    r.busy = PS.parrySparksBusy();
    r.bad = L.bad;
    out(`   ${mode}: normal parry ${r.normal.perfect ? 'PERFECT?' : 'normal'} (${r.normal.sparks} spits) · perfect: mark ${r.marks} (${r.frames} frames, ${r.blobs} blobs) · sparks ${r.spawned} (${r.main} along the attacker's edge, ${r.heavy} heavy), ${(r.near * 100).toFixed(0)} % died within 0.6 m (furthest ${r.reach.toFixed(2)} m), last died ${r.life.toFixed(2)} s real, brightest channel ${r.maxCh.toFixed(2)}, ${r.white} white`);
  }
  const Z = R['0'], A = R.a;
  assert(Z.normal.perfect === false && Z.marks === 1 && Z.sparks === 0 && Z.spawned === 0 && !Z.busy, `0: the shipped mark (${Z.frames} frames, ${Z.blobs} blobs), no spark`);
  assert(A.normal.perfect === false && A.normal.sparks === 0, `a: a normal parry throws no spark (${A.normal.sparks})`);
  assert(A.marks === 1 && A.frames === Z.frames && A.blobs === Z.blobs, `a: the shipped mark unchanged (${A.frames} frames / ${A.blobs} blobs vs ${Z.frames} / ${Z.blobs})`);
  assert(A.sparks === 1 && A.spawned >= 12 && A.spawned <= 16 && A.main >= 1, `a: one spit of ${A.spawned} sparks (12 - 16), ${A.main} along the attacker's edge`);
  assert(A.white === 0 && A.maxCh > 0.2 && A.maxCh <= 0.55 + 1e-6, `a: orange, never white (${A.white}), brightest channel ${A.maxCh.toFixed(3)} <= 0.55 (no bloom)`);
  assert(A.near >= 0.9 && A.end !== null && A.end <= 0.55 && A.life <= 0.55 && !A.busy && A.bad === 0, `a: ${(A.near * 100).toFixed(0)} % died within 0.6 m, all gone after ${A.end?.toFixed(2)} s real (<= 0.55), none NaN`);
  // many spits (steel met and not): 12 - 16 each, 90 % within 0.6 m, gone within 0.55 s real; a string
  // of ten 0.1 s apart keeps at most 48 alive; no Math.random; no throw without fx
  const { game } = G;
  const p = game.player;
  const x = p.position.x, y = 1.25, z = p.position.z;
  const MR = Math.random;
  let drew = 0, threw = null, peak = 0, died = 0, near = 0, lifeMax = 0, nMin = 99, nMax = 0, white = 0, chMax = 0;
  Math.random = () => {
    drew++;
    return MR();
  };
  try {
    for (let s = 0; s < 60; s++) {
      PFX.perfectClear();
      L.white = 0;
      L.maxCh = 0;
      const met = s % 3 !== 2, c = Math.cos(s), sn = Math.sin(s);
      const e1 = { x: c, y: 0.6, z: sn }, e2 = { x: Math.sin(s * 1.7), y: -0.2 + 0.3 * c, z: Math.cos(s * 1.7) };
      PS.parrySparks(game, x, met ? y : 0.9, z, { e1: met ? e1 : null, e2: met ? e2 : null, met, fdx: sn, fdz: c, mode: 'a' });
      nMin = Math.min(nMin, L.spawned);
      nMax = Math.max(nMax, L.spawned);
      for (let j = 0; j < 60 && PS.parrySparksBusy(); j++) PFX.perfectUpdate(game, DT, DT);
      died += L.died;
      near += L.near;
      lifeMax = Math.max(lifeMax, L.lifeMax);
      white += L.white;
      chMax = Math.max(chMax, L.maxCh);
    }
    PFX.perfectClear();
    const e1 = { x: 0.2, y: 1, z: 0.1 }, e2 = { x: 1, y: 0.1, z: 0.3 };
    for (let i = 0; i < 10; i++) {
      // (the base spit's cap: `grow: '0'`, or ?parryGrow=a's tiers read the hero's streak and raise the cap to 104)
      PS.parrySparks(game, x, y, z, { e1, e2, met: true, mode: 'a', grow: '0' });
      peak = Math.max(peak, L.alive);
      for (let j = 0; j < 6; j++) {
        PFX.perfectUpdate(game, DT, DT);
        peak = Math.max(peak, L.alive);
      }
    }
    for (let j = 0; j < 60; j++) PFX.perfectUpdate(game, DT, DT);
  } catch (e) {
    threw = e;
  }
  Math.random = MR;
  const ended = !PS.parrySparksBusy();
  out(`   60 spits: ${nMin} - ${nMax} sparks each, ${((near / Math.max(1, died)) * 100).toFixed(1)} % died within 0.6 m, the last after ${lifeMax.toFixed(3)} s real, brightest channel ${chMax.toFixed(3)}, ${white} white · ten in a row: peak ${peak} alive`);
  assert(nMin >= 12 && nMax <= 16 && near / Math.max(1, died) >= 0.9 && lifeMax <= 0.55 && white === 0 && chMax <= 0.55 + 1e-6, `60 spits: ${nMin} - ${nMax} sparks, ${((near / Math.max(1, died)) * 100).toFixed(1)} % within 0.6 m, gone within ${lifeMax.toFixed(3)} s real, none white`);
  assert(!threw && drew === 0 && peak <= 48 && ended, `ten in a row: at most ${peak} sparks alive (48), all gone after; Math.random drawn ${drew} times; ${threw?.message ?? 'no throw'}`);
  const fx = game.fx;
  game.fx = { add: null, alpha: null, fire: null };
  threw = null;
  try {
    PS.parrySparks(game, x, y, z, { e1: { x: 1, y: 0, z: 0 }, e2: { x: 0, y: 1, z: 0 }, met: true, mode: 'a' });
    PFX.perfectParryMark(game, x, y, z, { mode: 'sharp' });
    for (let j = 0; j < 90; j++) PFX.perfectUpdate(game, DT, DT);
    PS.setParryFx('a');
    p.fx.parry(x, y, z, false, 1, 0, 1, { perfect: true, feel: p.fx.perfectMoment('parry', true, 3, 'sharp') });
    for (let j = 0; j < 90; j++) PFX.perfectUpdate(game, DT, DT);
  } catch (e) {
    threw = e;
  }
  game.fx = fx;
  PS.setParryFx(PS.PARRY_FX_DEFAULT);
  PFX.perfectClear();
  STK.setPerfectMode('today');
  assert(PS.PARRY_FX_DEFAULT === 'a' && PS.parryFxMode() === 'a', `the spit is the default look (${PS.PARRY_FX_DEFAULT}; ?parryFx=0 draws the parry as before)`);
  assert(!threw && !PS.parrySparksBusy() && errors.length === 0, `nothing throws without a fire field or particles (${threw?.message ?? 'ok'}), no console errors`);
  return G;
}

// ================================================================== scenario: parrygrow (?parryGrow=0|a)
// The perfect parry's chain grows (combat/parrySparks.js PARRY_GROW; 0 = today's spit, the default): with 0
// the spit is today's count and nothing else is drawn; with a, tier 0 / 1 (streak < 5) throws today's count,
// streak 7 (tier 3) more, a string's last blow still more, embers outlive the spit, and a heat flash at the
// crossing is alive the frame after contact and gone by 0.12 s of REAL time (also in slow motion); no NaN.
async function scenarioParryGrow() {
  out('\n== scenario PARRYGROW (the perfect parry chain grows with the streak: sparks, embers, a heat flash; ?parryGrow=0|a) ==');
  const PFX = await imp('src/combat/perfectFx.js');
  const STK = await imp('src/combat/streak.js');
  const PS = await imp('src/combat/parrySparks.js');
  const L = PS.PARRY_SPARKS_LAST, GL = PS.PARRY_GROW_LAST;
  const G = build();
  duel(G, { dist: 2.0 });
  const { game } = G;
  const p = game.player;
  STK.setPerfectMode('sharp');
  PS.setParryFx('a');
  // a screen for the flash (the mock has no canvas: a 1280 x 720 frame, the camera's matrices current)
  const pl = game.pipeline, pl0 = { width: pl.width, height: pl.height, artCell: pl.artCell };
  pl.width = 1280;
  pl.height = 720;
  pl.artCell = { x: 5, y: 8 };
  game.camera.updateMatrixWorld(true);
  game.camera.updateProjectionMatrix();
  const x = p.position.x, y = 1.25, z = p.position.z - 1.0;
  const e1 = { x: 0.3, y: 0.5, z: 0.8 }, e2 = { x: 0.9, y: 0.1, z: -0.3 };
  const spit = (streak, last, mode) => {
    PFX.perfectClear();
    return PS.parrySparks(game, x, y, z, { e1, e2, met: true, streak, last, grow: mode });
  };
  const MR = Math.random;
  let drew = 0, threw = null;
  Math.random = () => (drew++, MR());
  const R = {};
  const sp0 = game.fx.fire.spawn;
  try {
    // today's spit, and the same with the switch on at tiers 0 and 1: the same count (own seeded stream)
    PS.setParryGrow('0');
    R.n0 = [];
    R.nA = [];
    for (const s of [0, 1, 2]) R.n0.push((L.n = 500 + s, spit(s, true)));
    const f0 = GL.flashes;
    let blobs0 = 0;
    game.fx.fire.spawn = (b) => (blobs0++, sp0(b));
    for (const s of [0, 1, 2]) R.nA.push([(L.n = 500 + s, PS.parrySparks(game, x, y, z, { e1, e2, met: true, streak: s, last: true, grow: '0' })), (PFX.perfectClear(), L.n = 500 + s, spit(s, true, 'a'))]);
    R.flashesMade = GL.flashes - f0;
    R.blobsOff = blobs0;
    PS.setParryGrow('a');
    R.tier = {};
    for (const s of [1, 3, 5, 7, 10, 15]) {
      const n = spit(s, false);
      R.tier[s] = { n, tier: GL.tier, embers: GL.embers, cells: GL.flashCells };
    }
    R.last7 = spit(7, true);
    R.cells7L = GL.flashCells;
    // the heat flash: alive the frame after contact (real clock), gone by 0.12 s real, also in slow fx time
    spit(7, true);
    R.flashBlobs0 = GL.flashBlobs;
    R.peak0 = GL.flashPeak;
    const fxDt0 = game.fxDt;
    PFX.perfectUpdate(game, DT, DT);
    R.alive1 = GL.flashAlive;
    for (let i = 0; i < 3; i++) PFX.perfectUpdate(game, DT, DT);
    R.aliveMid = GL.flashAlive;
    for (let i = 0; i < 6 && GL.flashAlive; i++) PFX.perfectUpdate(game, DT, DT);
    R.goneAt = GL.flashAge;
    R.aliveEnd = GL.flashAlive;
    // slow motion: fx time at a tenth of real time, the flash still ends on the real clock
    spit(7, true);
    game.fxDt = DT * 0.1;
    let steps = 0;
    while (GL.flashAlive && steps < 30) {
      PFX.perfectUpdate(game, DT * 0.1, DT);
      steps++;
    }
    R.slowSteps = steps;
    R.slowAge = GL.flashAge;
    game.fxDt = fxDt0;
    // embers: a streak-7 spit, run on: some are still alive after the spit's own flight (about half a second)
    spit(7, true);
    let t = 0, em = 0, maxAlive = 0;
    while (PS.parrySparksBusy() && t < 1.5) {
      PFX.perfectUpdate(game, DT, DT);
      t += DT;
      if (t > 0.5) em = Math.max(em, GL.embersAlive);
    }
    R.emberAt = em;
    R.emberEnd = t;
    // a long chain (a spit every 0.32 s at streak 15): never past the pool, nothing left over
    PFX.perfectClear();
    L.white = 0;
    L.maxCh = 0;
    L.bad = 0;
    for (let i = 0; i < 12; i++) {
      PS.parrySparks(game, x, y, z, { e1, e2, met: true, streak: 15, last: i === 11 });
      maxAlive = Math.max(maxAlive, L.alive);
      for (let j = 0; j < 19; j++) {
        PFX.perfectUpdate(game, DT, DT);
        maxAlive = Math.max(maxAlive, L.alive);
      }
    }
    for (let j = 0; j < 120; j++) PFX.perfectUpdate(game, DT, DT);
    R.maxAlive = maxAlive;
    R.ended = !PS.parrySparksBusy() && !GL.flashAlive;
    R.white = L.white;
    R.maxCh = L.maxCh;
    R.bad = L.bad;
  } catch (e) {
    threw = e;
  }
  game.fx.fire.spawn = sp0;
  Math.random = MR;
  pl.width = pl0.width;
  pl.height = pl0.height;
  pl.artCell = pl0.artCell;
  PS.setParryGrow(PS.PARRY_GROW_DEFAULT);
  PS.setParryFx(PS.PARRY_FX_DEFAULT);
  PFX.perfectClear();
  STK.setPerfectMode('today');
  assert(!threw, `no throw (${threw?.stack ?? 'ok'})`);
  if (threw) return G;
  out(`   today ${R.n0.join(',')} · a at streak 0,1,2 ${R.nA.map((q) => q[1]).join(',')} · tiers ${Object.entries(R.tier).map(([s, v]) => `${s}:${v.n}(+${v.embers} embers, ${v.cells} cells)`).join(' ')} · last blow at 7: ${R.last7} · flash ${R.flashBlobs0} blobs, peak ${R.peak0.toFixed(2)}, alive after 1 frame ${R.alive1}, ended at ${R.goneAt.toFixed(3)} s real (slow motion: ${R.slowAge.toFixed(3)} s in ${R.slowSteps} steps) · embers alive after 0.5 s: ${R.emberAt}, all gone at ${R.emberEnd.toFixed(2)} s · chain peak ${R.maxAlive} alive`);
  assert(PS.PARRY_GROW_DEFAULT === 'a', 'the growth is on by default (the owner\'s pick; ?parryGrow=0 turns it off)');
  assert(R.nA.every(([a, b]) => a === b) && R.n0.every((n) => n >= 12 && n <= 16), `0: today's count (${R.n0.join(',')}); a at streak 0 / 1 / 2 (tier 0) throws the same count, from the same seed (${R.nA.map((q) => q.join('=')).join(', ')})`);
  assert(R.flashesMade === 3 && R.blobsOff > 0, `a flash is made only with the switch on (${R.flashesMade} of 6 spits, ${R.blobsOff} blobs)`);
  assert(R.tier[1].tier === 0 && R.tier[3].tier === 1 && R.tier[7].tier === 3 && R.tier[15].tier === 5 && R.tier[1].n <= 16 && R.tier[3].n >= 15 && R.tier[7].n >= 21 && R.tier[15].n >= 27, `a: more sparks with the tier (streak 1: ${R.tier[1].n}, 7: ${R.tier[7].n}, 15: ${R.tier[15].n})`);
  assert(R.tier[1].embers === 0 && R.tier[3].embers === 0 && R.tier[5].embers === 4 && R.tier[7].embers === 5 && R.tier[15].embers === 7, `a: embers from tier 2 (2 + tier): ${Object.entries(R.tier).map(([s, v]) => `${s}:${v.embers}`).join(' ')}`);
  assert(R.last7 > R.tier[7].n, `a: a string's last blow throws more (${R.last7} against ${R.tier[7].n})`);
  assert(Object.values(R.tier).map((v) => v.cells).join() === '2,3,3,4,4,5' && R.cells7L === 5, `a: the flash grows by a cell per two tiers, five at most (${Object.values(R.tier).map((v) => v.cells).join(',')})`);
  assert(R.flashBlobs0 > 0 && R.peak0 < 1 && R.peak0 > 0.4, `a: the heat flash is written in the fire field (${R.flashBlobs0} blobs, hottest ${R.peak0.toFixed(2)}: orange, under 1)`);
  assert(R.alive1 && R.aliveMid && R.aliveEnd === false && R.goneAt < 0.12 && R.goneAt >= 0.07, `a: the flash is alive the frame after contact and gone by 0.12 s real (${R.goneAt.toFixed(3)} s)`);
  assert(R.slowAge < 0.12 && R.slowSteps < 12, `a: in slow motion the flash still ends on the real clock (${R.slowAge.toFixed(3)} s, ${R.slowSteps} steps)`);
  assert(R.emberAt >= 1 && R.emberEnd <= 1.2, `a: embers still fall after the spit's own flight (${R.emberAt} alive after 0.5 s) and are gone by ${R.emberEnd.toFixed(2)} s`);
  assert(R.maxAlive <= 104 && R.ended && R.white === 0 && R.maxCh <= 0.55 + 1e-6 && R.bad === 0, `a: a long chain stays inside the pool (${R.maxAlive} <= 104), all gone after, none white, none over the bloom threshold (${R.maxCh.toFixed(3)})`);
  assert(drew === 0, `no Math.random drawn (${drew})`);
  return G;
}

// ================================================================== scenario: streak (ADR-094)
// The shared streak (parries and clashes count in it), the riposte a parried last blow is answered
// with, his own streak of guards and the flurry it brings.
async function scenarioStreak() {
  out('\n== scenario STREAK (parries feed the streak; the riposte; his streak of guards and his flurry: answer every blow and he breaks) ==');
  // (the old riposte pinned: the parry feeding the dodge streak and the flurry answer; the default is the deathblow, ADR-211)
  const RC = await imp('src/entities/player/riposteCut.js');
  RC.setRiposteMode('old');
  const G = build();
  duel(G, { dist: 2.4 });
  const { game, input } = G;
  const d = game.dragon, p = game.player, F = DEFENSE.flurry, FS = DEFENSE.foeStreak;
  const since = (c0, n) => (G.counts[n] || 0) - (c0[n] || 0);
  /** Run his move to its end with the defender bot answering (or `step`): what happened. */
  const through = (max, step = null) => {
    const tr = { flits: 0, arts: [], ended: null, frames: 0, finite: true, around: 0 };
    let lx = d.position.x, lz = d.position.z;
    const w0 = G.watch;
    G.watch = (n, e) => {
      if (n === 'player:flurry') tr.arts.push(e.art);
      if (n === 'dragon:flurryEnd') tr.ended = { ...e };
    };
    run(G, max, () => {
      input.axis = { x: 0, y: 0 };
      step?.();
      tr.frames++;
      if (Math.hypot(d.position.x - lx, d.position.z - lz) > 1.5) tr.flits++;
      lx = d.position.x;
      lz = d.position.z;
      if (![p.position.x, p.position.y, p.position.z, d.position.x, d.position.z].every(Number.isFinite)) tr.finite = false;
    }, () => tr.frames > 20 && d.mode !== 'act' && p.state !== 'flurry' && game.hitstopTimer <= 0);
    G.watch = w0;
    return tr;
  };

  // 1) his streak: a strike his guard turns counts one, a strike that lands ends it
  run(G, 0.4);
  d.brain.raiseT = 0;
  d.takeHit({ damage: 30, part: 'body', heavy: false, poise: 5, point: { x: d.position.x, y: 1.2, z: d.position.z } });
  assert(d.streak === 1, `a strike his guard turns: his streak counts ${d.streak}`);
  settle(G);
  d.takeHit({ damage: 30, part: 'body', exact: true, point: { x: d.position.x, y: 1.2, z: d.position.z } });
  assert(d.streak === 0, `a strike that lands ends it (${d.streak})`);

  // 2) his flurry of four, every blow parried: he is at another side for each, the last parry is
  // answered by the riposte, and his posture breaks
  settle(G);
  place(G, 2.4);
  run(G, 0.3);
  p.debug.streak(0);
  d.debug.streak(4);
  const c2 = { ...G.counts };
  G.defend = makeDefender(G, { lead: PLAIN_LEAD }); // plain parries: perfect ones break his posture before the fourth blow
  const ok2 = d.debug.flurry();
  const a2 = d.brain.act;
  const beats2 = a2?.beats.length, flit2 = a2?.beats.filter((b) => b.def.flit).length;
  const t2 = through(8, () => G.defend.act());
  G.defend = null;
  out(`   his flurry of ${beats2}: parries ${since(c2, 'player:parry')} · he moved to another side ${t2.flits} times · hero's streak ${p.streak} · answered ${JSON.stringify(t2.ended)} · broken ${d.broken} · his streak ${d.streak} · the hero's answer: ${t2.arts.join(',') || '-'}`);
  assert(ok2 === true && a2?.name === 'streakFlurry' && beats2 === 4 && flit2 === 3 && since(c2, 'dragon:flurry') === 1, `his flurry starts with as many blows as his streak counts (${beats2}; ${flit2} of them from another side)`);
  assert(since(c2, 'player:parry') === 4 && t2.flits >= 3, `every blow parried, from wherever it came (${since(c2, 'player:parry')} parries, ${t2.flits} blinks)`);
  assert(t2.ended?.answered === true && d.broken && d.streak === 0 && since(c2, 'dragon:postureBreak') >= 1, 'all of them answered: his posture breaks, his streak is spent');
  assert(p.streak >= 4 && t2.arts.includes('riposte'), `the parries count in the hero's streak (${p.streak}); the last one is answered by the riposte`);
  assert(t2.finite && p.state !== 'flurry' && p.position.y === 0, 'it all ends on the ground');

  // 3) the same blocked: a held guard meets them from any side; no riposte
  run(G, 5, null, () => !d.broken && d.mode === 'foot');
  settle(G);
  place(G, 2.4);
  run(G, 0.3);
  d.posture = 0;
  d.debug.streak(3);
  const c3 = { ...G.counts };
  input.press(1);
  run(G, 0.5);
  d.debug.flurry();
  const t3 = through(8);
  input.up(1);
  assert(since(c3, 'player:block') >= 3 && since(c3, 'player:hurt') === 0 && t3.ended?.answered === true && d.broken, `three blows blocked from three sides (${since(c3, 'player:block')} blocks, no hurt): he breaks`);
  assert(!t3.arts.length, 'a block is not answered by the riposte');

  // 4) one let through: nothing breaks, and what was not answered stays in his streak
  run(G, 5, null, () => !d.broken && d.mode === 'foot');
  settle(G);
  place(G, 2.4);
  run(G, 0.3);
  d.posture = 0;
  p.debug.god = true;
  d.debug.streak(3);
  d.debug.flurry();
  const t4 = through(8);
  assert(t4.ended?.answered === false && !d.broken && d.streak === 3 && p.streak === 0, `no blow answered: he does not break, his streak stays ${d.streak}, the hero's is lost`);
  p.debug.god = false;

  // 5) the riposte by itself: a single thrust parried, one flash cut, and the hero is back where he stood
  settle(G);
  place(G, 4.5);
  run(G, 0.3);
  p.debug.streak(0);
  d.debug.streak(0);
  d.posture = 0;
  const hp5 = d.hp, at5 = p.position.clone(), c5 = { ...G.counts };
  G.defend = makeDefender(G);
  d.debug.trigger('plumThrust');
  const t5 = through(6, () => G.defend.act());
  G.defend = null;
  const moved = Math.hypot(p.position.x - at5.x, p.position.z - at5.z);
  out(`   a parried thrust: parries ${since(c5, 'player:parry')} · answered by ${t5.arts.join(',') || '-'} · he lost ${hp5 - d.hp} · the hero ${moved.toFixed(2)} m from where he parried · crit ${p.critTimer.toFixed(2)}`);
  assert(since(c5, 'player:parry') === 1 && t5.arts.join() === 'riposte' && hp5 - d.hp === F.cut.damage, `a parried single blow is answered by one flash cut (${hp5 - d.hp} damage)`);
  assert(moved < 1.2 && p.position.y === 0 && p.critTimer === 0 && p.state !== 'flurry', `and the hero is back where he parried (${moved.toFixed(2)} m off), no crit window`);
  // debug.noRiposte switches it off
  settle(G);
  place(G, 4.5);
  run(G, 0.3);
  p.debug.noRiposte = true;
  const c6 = { ...G.counts };
  G.defend = makeDefender(G);
  d.debug.trigger('plumThrust');
  through(6, () => G.defend.act());
  G.defend = null;
  p.debug.noRiposte = false;
  assert(since(c6, 'player:parry') === 1 && since(c6, 'player:flurry') === 0, 'player.debug.noRiposte: a parry is only a parry');
  RC.setRiposteMode(RC.RIPOSTE_DEFAULT);
  return G;
}

// ================================================================== scenario: training (ADR-099)
// Every situation of the Training catalogue that applies to this boss, run by the runner itself
// (src/dev/training.js): each must play out (done, within its time) and show what it promises.
async function scenarioTraining() {
  out('\n== scenario TRAINING (every situation of the Training catalogue for this boss plays out and shows what it promises) ==');
  const G = build({ real: true }); // (the real courtyard: the TERRAIN situations need its pieces)
  const { game } = G;
  duel(G, { dist: 4 });
  const T = game.lab.training;
  const L = T.list();
  const cats = new Set(L.map((s) => s.cat));
  out(`   ${L.length} situations in ${cats.size} categories: ${[...cats].join(', ')}`);
  const bad = [];
  for (const s of L) {
    if (s.cat === 'BOSS MOVES' && !true) continue;
    T.run(s.id);
    let frames = 0;
    while (T.ph !== 'done' && frames < Math.round(40 / DT)) { G.tick(DT); frames++; }
    const r = T.lastResult;
    const ok = T.ph === 'done' && r?.id === s.id && r.ok;
    if (!ok || process.env.GCD_TRACE) out(`   ${ok ? 'ok ' : 'BAD'} ${s.cat} · ${s.name}: ${T.ph} in ${(frames * DT).toFixed(1)} s · missing ${JSON.stringify(r?.missing ?? '?')} · hero ${game.player.state} streak ${game.player.streak} · boss ${game.dragon.state}`);
    if (!ok) bad.push(s.id);
  }
  T.stop();
  assert(L.length >= 20 && !bad.length, `every situation plays out and shows what it promises (${L.length - bad.length} of ${L.length}${bad.length ? `; not: ${bad.join(', ')}` : ''})`);
  // phase 3's change from phase 1 (no phase 2 run first): the runner puts him in phase 2 first (the
  // review of PR 64: phase3() did nothing from phase 1, and an empty `expect` let the situation pass)
  {
    const G2 = build({ real: true });
    duel(G2, { dist: 4 });
    const T2 = G2.game.lab.training, d2 = G2.game.dragon, from = d2.phase;
    T2.run('phase3a');
    let f = 0;
    while (T2.ph !== 'done' && f < Math.round(20 / DT)) { G2.tick(DT); f++; }
    const r = T2.lastResult, done = T2.ph === 'done';
    T2.stop();
    assert(from === 1 && done && !!r?.ok && d2.phase === 3, `Training's Phase 3 plays from phase 1: phase ${from} → ${d2.phase}, ${r?.ok ? 'shown' : `missing ${JSON.stringify(r?.missing ?? '?')}`}`);
  }
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
  // (the second pass) the third phase, ash on the wind, at its own gate: one dragon:phase3, its own
  // transition (a red ring blow), the phase-3 moves in the pool; phase 3 is no faster than phase 2
  const gate3 = d.maxHp * TUNING.phaseAt[2];
  assert(TUNING.phaseAt.length === 3 && TUNING.phaseAt[1] > TUNING.phaseAt[2] && TUNING.phaseAt[2] > 0, `three phases (phaseAt ${TUNING.phaseAt.join(', ')})`);
  settle(G, 8);
  d.hp = gate3 + 20;
  d.mode = 'foot';
  d.brain.act = null;
  d.takeHit({ damage: 400, part: 'body', heavy: true, poise: 5, exact: true });
  assert(d.hp === gate3 && d.brain.pendingPhase === 3, `damage stops at the third gate (${d.hp} = ${gate3}) until the transition`);
  let p3 = 0, burst = 0;
  const pb = d.fx.phaseBurst;
  d.fx.phaseBurst = (n, ...rest) => { if (n === 3) burst++; return pb?.call(d.fx, n, ...rest); };
  G.watch = (n) => { if (n === 'dragon:phase3') p3++; };
  run(G, 1, null, () => d.brain.act?.name === 'ashWind');
  const A3 = d.brain.act;
  assert(A3?.name === 'ashWind' && d.phase === 3 && p3 === 1, `ash on the wind starts: phase ${d.phase}, ${p3} dragon:phase3`);
  assert(A3?.beats[0]?.def.tell === TELL.RED && A3.beats[0].def.zone?.kind === 'ring' && A3.beats[0].def.damage <= TUNING.transition.damage, 'its blow is a red ring, the Kindling\'s damage');
  run(G, 4, null, () => d.mode === 'foot');
  G.watch = null;
  d.fx.phaseBurst = pb;
  assert(burst === 1, `its impact calls the phase-3 burst once (${burst})`);
  const picks3 = new Set();
  for (let i = 0; i < 300; i++) {
    d.brain.cooldowns = {};
    d.brain.last = [null, null];
    const n = d.brain._choose(3);
    if (n) picks3.add(n);
  }
  assert(picks3.has('ashString') && picks3.has('ashFlurry') && picks3.has('flitLotus'), `phase-3 moves join the pool at 3 m (${[...picks3].join(', ')})`);
  assert(TUNING.windupScale[2] >= TUNING.windupScale[1] && TUNING.recoveryScale[2] >= TUNING.recoveryScale[1], 'phase 3 winds up and recovers no faster than phase 2');
  assert(game.flow._text('phase3') === 'ASH ON THE WIND', 'the flow shows the level\'s phase-3 banner');
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

// ================================================================== scenario: pace (the director's meter)
// A god-mode defender that never attacks, driven by combat:flash (his thrown things send no tell):
// the guard held through a normal / blue blow, a roll 0.28 s before a red / black one (out of a
// hazard's ring: away from its centre). The hero roams between standoffs (2.5 / 5 / 9 m, a new one
// every 4 s), on the REAL courtyard (the terrain moves are in). Per seed and per phase (every phase
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
      const G = (lastG = build({ seed, real: true }));
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
  out('\n== scenario WIN (a fencing bot in god mode: parries, rolls, cuts in his openings) ==');
  const G = build();
  const MK = attachMarks(G.game); // (the floor marks the fight leaves: they change nothing in it)
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
  marksCheck(MK, 'duel', out, assert);
  out(`     damage by his state: ${JSON.stringify(dmgBy)}`);
  assert(won, 'the fencing bot defeats the Ash Disciple within 6 minutes');
  // (the second pass: three phases; the third, ash on the wind, from 30 %)
  assert(d.phase === 3, `the fight went through phases 2 and 3 (phase ${d.phase})`);
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
  // (his pressure over 40 s of the clock is under test: the riposte a parried last blow is answered
  // with, scenario STREAK, holds the world still while the hero cuts)
  p.debug.noRiposte = true;
  G.defend = makeDefender(G);
  let flashes = 0, wMin = 1;
  const h0 = G.hits.length;
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon' && e.tell !== TELL.RED && e.tell !== TELL.BLACK && e.attack !== 'ashCrescent' && !e.hazard) flashes++; };
  run(G, 60, (GG) => {
    input.axis = { x: 0, y: 0 };
    game.mouseGround.set(d.position.x, 0, d.position.z);
    GG.defend.act();
    wMin = Math.min(wMin, Math.abs(d.rig.arms.L.wrist.quaternion.w));
  });
  // (his free hand stays a duelist's: rigid on the forearm, no sword fingers; anim.js opts.freeHand
  // is the hero's alone)
  assert(d.anim.freeHand === false && d.rig.offHand?.fingers === undefined && p.anim.freeHand === true && wMin > 0.99999,
    `through 60 s of his strings his free wrist never turns (|w| ≥ ${wMin.toFixed(6)}) and he has no sword fingers (the hero's free hand alone)`);
  G.watch = null;
  G.defend = null;
  p.debug.noRiposte = false;
  const met = G.hits.slice(h0).filter((h) => h.attack !== 'ashCrescent' && h.tell !== TELL.RED && h.tell !== TELL.BLACK).length;
  // (40 s and >= 25 until ADR-118: a parried blue flare blow now ends his string and he recoils, and his
  // red and black blows are not counted here: 60 s; seeds 4242 / 7 / 99 gave 31, 40, 44 cues)
  out(`     60 s standing his ground: ${flashes} white / blue cues, ${met} of them met`);
  assert(flashes >= 20 && met >= flashes - 1, `standing his ground, every glint is a blow that reaches the hero: ${met} met of ${flashes} non-red flashes`);
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
    if (process.env.GCD_TRACE) ktrace.push(`${d.mode === 'act' ? d.brain.act.name : d.mode === 'react' ? d.brain.react.kind : d.mode}`);
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
  if (process.env.GCD_TRACE) out('     kite', ktrace.filter((x, i, A) => x !== A[i - 1]).join(' '));
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
  // the parry's own numbers as they were before the streak pass (?perfect=today): the `perfectfx`
  // scenario measures the sharp / cinema looks
  const STKX = await imp('src/combat/streak.js');
  STKX.setPerfectMode('today');
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
      if (left > (perfect ? 0.05 : PLAIN_LEAD)) return false;
      input.up(1);
      input.click(1);
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
  STKX.setPerfectMode(STKX.PERFECT_DEFAULT);
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
    input.up(1);
    input.click(1);
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
    input.up(1);
    input.click(1);
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
    input.up(1);
    input.click(1);
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
  p.debug.noRiposte = true; // (a parried blue blow would answer with a deathblow combo: this is about the deflect)
  home(G);
  place(G, 2.6);
  d.posture = 0;
  run(G, 0.2);
  seen.length = 0;
  G.watch = log;
  let reeled = false;
  const ok3 = answerMove(G, 'ashRain', (left) => {
    if (left > PLAIN_LEAD) return false; // plain parries: a perfect one of its last blow locks the blades
    input.up(1);
    input.click(1);
    return true;
  }, 9);
  reeled = seen.includes('dragon:deflected') || d.brain.react?.kind === 'reeling';
  G.watch = null;
  assert(ok3 && seen.includes('dragon:deflected'), `parrying all seven hits of the Rain of Ashes is the full deflect (${seen.join(', ')}${ok3 ? '' : '; not triggered: ' + d.mode + ' ' + (d.brain.react?.kind ?? '')})`);
  assert(reeled && seen.some((s) => s.startsWith('game:cinematic')), 'he reels and the moment plays in slow motion');
  p.debug.noRiposte = false;
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

// ================================================================== scenario: cutfx
/** A cut that lands on the duelist (combat/cutFx.js; player._contactPoint): drawn where the drawn
 *  blade meets his drawn body, his spray from there, the freeze, the kick and the punch, the blade's
 *  flare, the sound, the budget, his shudder (drawn only); a guarded strike gets none of it. */
async function scenarioCutFx() {
  out('\n== scenario CUTFX (a landed cut: the drawn contact, the freeze, the kick, the flare, the sound, the shudder) ==');
  // the blade's flare as it was before the calm (combat/impactCalm.js level 0): these bounds measure
  // the flare itself; the `calm` scenario measures what each level dims
  const CALMX = await imp('src/combat/impactCalm.js');
  const calm0 = CALMX.calmLevel();
  CALMX.setCalm(0);
  const { CUT_LOOK, CUT_LAST } = await imp('src/combat/cutFx.js');
  const { feel, HIT_FEEL } = await imp('src/entities/player/combat.js');
  const G = build();
  duel(G, { dist: 2 });
  const { game, input } = G;
  const d = game.dragon, p = game.player, rig = game.cameraRig;
  p.debug.god = true;
  d.brain.guardUp = () => false;
  d.brain.onStruck = () => {};
  const BUDGET = { light: 20, sweep: 24, point: 24, slam: 62, cleave: 72, execute: 66 };
  const PF = game.U.uSelfPartFill.value[17], PR = game.U.uSelfPartRim.value[17];
  const v = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3();
  // at the moment of the hit (inside takeHit, before his shove): the point against his drawn body and
  // the drawn blade; the gameplay point the hit test found (p._applyHit's h). After the tick (the
  // frame the freeze holds: his shove, his jolt, his update) the cut drawn (the event's point) against
  // the body he is drawn in then
  let pend = null, sparkAt = null, spawns = 0, sounds = [];
  const takeHit0 = d.takeHit.bind(d), applyHit0 = p._applyHit.bind(p), spark0 = d.fx.hitSpark.bind(d.fx), play0 = game.audio.play.bind(game.audio);
  const fxa = game.fx.add, spawn0 = fxa.spawn;
  let hGame = null;
  p._applyHit = (a, h, via) => { hGame = { x: h.x, y: h.y, z: h.z }; return applyHit0(a, h, via); };
  d.takeHit = (o) => {
    if (o?.swing && o.point) {
      let body = Infinity;
      for (const s of d.hurtSpheres) { d.drawnPoint(v.set(s.x, s.y, s.z)); body = Math.min(body, v.distanceTo(o.point) - s.r * d.drawScale); }
      const kind = p.atk?.def?.kind ?? 'light';
      A.lerpVectors(p.sweep.a, p.sweep.b, CUT_LOOK.from);
      B.lerpVectors(p.sweep.a, p.sweep.b, p.fx.arcAt(kind));
      const ab = B.clone().sub(A), u = Math.min(1, Math.max(0, v.set(o.point.x, o.point.y, o.point.z).sub(A).dot(ab) / ab.lengthSq()));
      const blade = A.clone().addScaledVector(ab, u).distanceTo(v.set(o.point.x, o.point.y, o.point.z));
      pend = { point: { ...o.point }, body, blade, def: p.atk?.def, crit: !!o.crit, game: hGame };
    }
    return takeHit0(o);
  };
  d.fx.hitSpark = (x, y, z, ...rest) => { sparkAt = { x, y, z }; return spark0(x, y, z, ...rest); };
  game.audio.play = (name, o) => { sounds.push([name, o]); return play0(name, o); };
  fxa.spawn = (o) => { spawns++; return spawn0.call(fxa, o); };
  const rows = [], bad = [];
  let ev = null, heroLean = 0;
  G.watch = (n, e) => { if (n === 'player:hitDragon' && !e.guarded) ev = e; };
  const t0 = game.time;
  let tick = 0, follow = null;
  while (game.time - t0 < 14 && (rows.length < 8 || !rows.some((r) => r.combo === 5) || follow)) {
    if (tick++ % 3 === 0 && !follow) input.click(0);
    game.mouseGround.set(d.position.x, 0, d.position.z);
    ev = null;
    sparkAt = null;
    spawns = 0;
    sounds = [];
    const n0 = CUT_LAST.n;
    G.tick(DT);
    heroLean = Math.max(heroLean, Math.abs(p.lean.ox ?? 0) + Math.abs(p.lean.oz ?? 0));
    if (follow) {
      // the shudder: the next 3 ticks flicker side to side, then it stops once the freeze is over
      const s = Math.abs(d.lean.ox) > Math.abs(d.lean.oz) ? d.lean.ox : d.lean.oz;
      if (follow.n < 3) follow.signs.push(s);
      follow.n++;
      if (game.hitstopTimer <= 0) follow.after++;
      if (follow.after >= 2) {
        follow.row.shud = follow.signs.length === 3 && follow.signs.every((x, i) => x !== 0 && (i === 0 || Math.sign(x) !== Math.sign(follow.signs[i - 1])));
        follow.row.still = d.lean.ox === 0 && d.lean.oz === 0;
        follow = null;
      }
    }
    if (!ev || !pend) continue;
    const def = pend.def, tier = def?.contact ?? 'light', k = 0;
    let body = Infinity;
    for (const s of d.hurtSpheres) { d.drawnPoint(v.set(s.x, s.y, s.z)); body = Math.min(body, v.distanceTo(ev.point) - s.r * d.drawScale); }
    const row = {
      combo: ev.combo, tier, body, bodyHit: pend.body, blade: pend.blade,
      spark: sparkAt ? Math.hypot(sparkAt.x - ev.point.x, sparkAt.y - ev.point.y, sparkAt.z - ev.point.z) : Infinity,
      stop: game.hitstopTimer, want: Math.max(def.hitstop * (pend.crit ? HIT_FEEL.crit.stop : 1), TUNING.hitStun.light.stop),
      kick: Math.hypot(rig.kickX, rig.kickY), kickWant: feel(def.kick, k), punch: rig.punchZ,
      fill: PF.x, rim: PR.w, cuts: sounds.filter(([nm]) => nm === 'cut').length,
      hits: sounds.filter(([nm, o]) => nm === 'hit' && o?.body === 'cloth').length, spawns, budget: BUDGET[tier] + 90,
      drawn: CUT_LAST.n > n0, moved: pend.game ? Math.hypot(pend.game.x - ev.point.x, pend.game.y - ev.point.y, pend.game.z - ev.point.z) : NaN,
    };
    rows.push(row);
    follow = { row, n: 0, after: game.hitstopTimer <= 0 ? 1 : 0, signs: [] };
    pend = null;
  }
  const fmt = (r) => `${r.combo}/${r.tier} body ${r.body.toFixed(2)} (at the hit ${r.bodyHit.toFixed(2)}) blade ${r.blade.toFixed(2)} stop ${r.stop.toFixed(3)} kick ${r.kick.toFixed(3)} fill ${r.fill.toFixed(2)} spawns ${r.spawns}`;
  out(`   ${rows.length} landed cuts: ${rows.slice(0, 6).map(fmt).join(' · ')}`);
  out(`   the cut off his drawn body in the held frame (m): ${rows.map((r) => `${r.combo}/${r.tier} ${r.body.toFixed(2)}`).join(' · ')}`);
  const moved = rows.map((r) => r.moved).filter(Number.isFinite).sort((a, b) => a - b);
  out(`   the drawn contact sits a median ${(moved[moved.length >> 1] ?? NaN).toFixed(2)} m from the gameplay hit point (max ${(moved[moved.length - 1] ?? NaN).toFixed(2)})`);
  const near = rows.filter((r) => r.body <= 0.15).length;
  assert(rows.length >= 8 && rows.some((r) => r.combo === 5), `the chain lands ${rows.length} cuts on him, the slam among them`);
  assert(near >= 0.9 * rows.length && rows.every((r) => r.body <= 0.3), `every cut is drawn on his drawn body in the frame the freeze holds (after his shove): ${near} of ${rows.length} within 0.15 m of a drawn hurt sphere's surface, all within 0.3 (worst ${Math.max(...rows.map((r) => r.body)).toFixed(2)}; at the hit ${Math.max(...rows.map((r) => r.bodyHit)).toFixed(2)})`);
  assert(rows.every((r) => r.blade <= 0.3 && r.spark <= 1e-6 && r.drawn), `… found on the drawn blade (worst ${Math.max(...rows.map((r) => r.blade)).toFixed(2)} m off it); his spray starts at the cut (worst ${Math.max(...rows.map((r) => r.spark)).toExponential(1)})`);
  assert(rows.every((r) => r.stop >= r.want - 1e-6), `each freezes the frame for its weight (${rows.map((r) => r.stop.toFixed(3)).join(', ')})`);
  assert(rows.every((r) => r.kick >= 0.8 * r.kickWant && r.kickWant > 0 && r.punch > 0), `each throws the camera along the cut (${rows.map((r) => r.kick.toFixed(3)).join(', ')} m) and punches it in`);
  // (his dark blade, ADR-130: the base x TUNE.bladeLook, lit by the strike and the contact's flare)
  const BL = TUNE_P.bladeLook, BF = TUNE_P.bladeFlare;
  const fillMin = BL.fill * (1 + BF.strike[0] + BF.hit[0]) - 0.05, rimMin = 1.7 * BL.line * (1 + BF.line * (BF.strike[0] + BF.hit[0])) - 0.02;
  assert(rows.every((r) => r.fill >= fillMin && r.rim >= rimMin), `each flares the blade (fill ${Math.min(...rows.map((r) => r.fill)).toFixed(2)}+ ≥ ${fillMin.toFixed(2)}, rim ${Math.min(...rows.map((r) => r.rim)).toFixed(2)}+ ≥ ${rimMin.toFixed(2)})`);
  assert(rows.every((r) => r.cuts === 1 && r.hits === 1), `each sounds once as a cut on cloth (${rows.map((r) => `${r.hits}/${r.cuts}`).join(' ')})`);
  assert(rows.every((r) => r.spawns <= r.budget), `each stays within its spawn budget (${rows.map((r) => `${r.spawns}/${r.budget}`).join(' ')})`);
  assert(rows.every((r) => r.shud === true && r.still === true), `he shudders through each freeze, side to side, and is still after it (${rows.map((r) => `${r.shud ? 'y' : 'n'}${r.still ? '' : '!'}`).join(' ')})`);
  assert(heroLean === 0, 'the hero never shudders (his lean has no offset)');
  // the shudder is drawn only: the gameplay spheres (taken with the lean off) never move with it
  {
    settle(G);
    d.lean.on = false;
    d._gameplayPoints();
    const before = d.hurtSpheres.map((s) => [s.x, s.y, s.z]);
    d.lean.ox = 0.3;
    d.lean.oz = -0.2;
    d._gameplayPoints();
    const shift = Math.max(...d.hurtSpheres.map((s, i) => Math.hypot(s.x - before[i][0], s.y - before[i][1], s.z - before[i][2])));
    d.lean.ox = d.lean.oz = 0;
    d.lean.on = true;
    d.object3d.updateMatrixWorld(true);
    assert(shift <= 1e-9, `the shudder never moves his gameplay body (${shift.toExponential(1)} m)`);
  }
  // drawnPoint IS his drawn transform (the cut's placement and the body checks above rest on it): an
  // upright joint mapped by it lands on that joint as drawn (leaned, drawScale, a shudder's offset)
  {
    const r = d.rig, J = [r.head, r.chest, r.pelvis, r.legs.R.shin, r.legs.L.shin];
    d.lean.on = false;
    d.object3d.updateMatrixWorld(true);
    const up = J.map((j) => j.getWorldPosition(new THREE.Vector3()));
    d.lean.ox = 0.03;
    d.lean.oz = -0.02;
    d.lean.on = true;
    d.object3d.updateMatrixWorld(true);
    const err = Math.max(...J.map((j, i) => d.drawnPoint(up[i].clone()).distanceTo(j.getWorldPosition(new THREE.Vector3()))));
    const leaned = d.lean.k > 0 && d.drawScale !== 1;
    d.lean.ox = d.lean.oz = 0;
    d.object3d.updateMatrixWorld(true);
    assert(leaned && err <= 1e-6, `drawnPoint maps his upright joints onto the drawn ones (head, chest, pelvis, shins; lean k ${d.lean.k.toFixed(2)}, scale ${d.drawScale}, offset on: ${err.toExponential(1)} m)`);
  }
  // the shudder is a sword cut's (takeHit's swing; not a hit like the Lord's own returned bolt), and
  // his blade's sweep trail pauses while it runs (its flicker between frames is no swing)
  {
    settle(G);
    d._shud.t = 0;
    d.takeHit({ damage: 1, exact: true, heavy: true, posture: 0, part: 'body', point: { x: d.position.x, y: 1.2, z: d.position.z } });
    const bolt = d._shud.t;
    settle(G);
    const sweep0 = d.fx.sweep;
    let swept = 0;
    d.fx.sweep = () => { swept++; };
    const act = { t: 1, beats: [{ feint: false, impact: 1, W: 0.3, end: 1.1, A: 0.2 }] }; // mid-strike: the trail's window
    d._tipOk = true;
    d.afterPose(DT, act);
    const open = swept;
    d._shud.t = 0.05;
    const shaking = d.shuddering;
    d.afterPose(DT, act);
    const held = swept - open;
    d._shud.t = 0;
    d.fx.sweep = sweep0;
    assert(bolt === 0 && open === 1 && shaking && held === 0, `a hit that is no sword cut does not shudder him (${bolt}); his sweep trail draws mid-strike (${open}) but pauses while he shudders (${held})`);
  }
  // a guarded strike: his guard draws the clash; no cut, no hit sound, no kick, only the strike's flare
  {
    delete d.brain.guardUp;
    settle(G);
    place(G, 1.8);
    run(G, 0.6);
    let gev = null, gs = null;
    const n0 = CUT_LAST.n;
    G.watch = (n, e) => { if (n === 'player:hitDragon' && e.guarded && !gev) gev = e; };
    input.click(0);
    for (let i = 0; i < 60 && !gev; i++) {
      sounds = [];
      const k0 = Math.hypot(rig.kickX, rig.kickY);
      G.tick(DT);
      if (gev) gs = { cut: sounds.filter(([nm]) => nm === 'cut').length, hit: sounds.filter(([nm]) => nm === 'hit').length, k0, k1: Math.hypot(rig.kickX, rig.kickY), fill: PF.x, n: CUT_LAST.n - n0 };
    }
    out(`   a guarded strike: ${gs ? `cut ${gs.cut}, hit ${gs.hit}, kick ${gs.k0.toFixed(4)} → ${gs.k1.toFixed(4)}, fill ${gs.fill.toFixed(2)}, cuts drawn ${gs.n}` : 'none'}`);
    assert(!!gs && gs.cut === 0 && gs.hit === 0 && gs.n === 0 && gs.k1 <= gs.k0 + 1e-6 && gs.fill <= BL.fill * (1 + BF.strike[1]) + 1e-6, 'a guarded strike draws no cut, plays no hit or cut, throws no kick, and flares the blade only by the strike\'s gain');
  }
  G.watch = null;
  d.takeHit = takeHit0;
  p._applyHit = applyHit0;
  d.fx.hitSpark = spark0;
  game.audio.play = play0;
  fxa.spawn = spawn0;
  CALMX.setCalm(calm0);
  return G;
}

// ================================================================== scenario: terrain (ADR-111)
// The moves that use the courtyard, on the REAL set (build({ real: true })): each one's tell and
// timing, the piece it uses and where that ends, that the hero is hit only where it is marked and has
// the answer the tell promises, that none is chosen without a piece in reach, and that the fight's
// reset puts every piece back.
// ================================================================== scenario: a world warning over a thrown piece
// The integration pass: the world's falling piece wins over the courtyard's thrown pieces as it does
// over his crescents (brain._worldCue): a kicked lantern / flagstone in the air whose landing would
// fall within the guard's separation of a world warning needing the other answer lands uncued and
// harmless (quiet: no flare, no blow).
async function scenarioWorldCue() {
  out('\n== scenario WORLDCUE (a world warning: his thrown pieces in the air give way) ==');
  const G = build({ real: true });
  const { game } = G;
  duel(G, { dist: 7 });
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  for (const [move, kind] of [['lanternKick', 'shot'], ['flagKick', 'kick']]) {
    game.world.restore();
    d.debug.reset();
    game.flow.debug.toState('boss');
    d.debug.setAI(false);
    run(G, 0.4);
    settle(G);
    place(G, 7);
    const ok = d.debug.trigger(move);
    const live = () => (kind === 'shot' ? (d.terrain.shot.live ? d.terrain.shot : null) : d.terrain.kicks.find((k) => k.live));
    run(G, 6, null, () => !!live());
    const R = live();
    if (!R) { assert(false, `${move}: started (${ok}) and a piece flew`); continue; }
    const left = R.piece.T - R.piece.t, f0 = d.brain.stats.fizzles;
    game.events.emit('combat:tell', { source: 'world', attack: 'fallingDebris', tell: TELL.RED, impactIn: left + 0.05, x: 0, z: 0, hazard: true });
    let flashed = false;
    run(G, 2, () => { if (R.flashed === true) flashed = true; });
    out(`   ${move}: landing in ${left.toFixed(2)} s, a red world warning 0.05 s after it: quiet ${R.quiet}, flared ${flashed}, fizzles +${d.brain.stats.fizzles - f0}`);
    assert(R.quiet && !flashed && d.brain.stats.fizzles - f0 === 1, `${move}: the piece in the air gives way to the world's warning (lands uncued and harmless)`);
  }
  return G;
}

async function scenarioTerrain() {
  out('\n== scenario TERRAIN (Severed Pillar, Flying Lantern, Three Tolls, Swallow\'s Return on the real courtyard) ==');
  const G = build({ real: true });
  const { game, input } = G;
  duel(G, { dist: 4 });
  const d = game.dragon, p = game.player, W = game.world.destructibles, TT = TUNING.terrain;
  p.debug.god = true;
  const piece = (kind, x, z) => W.list.filter((b) => b.kind === kind).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
  /** Everything stands, he is free at (bx, bz), the hero at (hx, hz). */
  const stage = (bx, bz, hx, hz) => {
    game.world.restore();
    d.debug.reset();
    game.flow.debug.toState('boss');
    d.debug.setAI(false);
    run(G, 0.4);
    settle(G);
    d.position.set(bx, 0, bz);
    d.yaw = Math.atan2(hx - bx, hz - bz);
    p.debug.teleport(hx, hz);
    p.yaw = Math.atan2(bx - hx, bz - hz);
    p.debug.heal();
    p.debug.god = true;
    input.axis = { x: 0, y: 0 };
    game.mouseGround.set(bx, 0, bz);
    run(G, 0.1);
  };
  const weight = (name) => d.weigh(name, MOVES[name], 1, Math.hypot(d.position.x - p.position.x, d.position.z - p.position.z));
  /** Run move `name` to its end; returns what happened. `step(GG, ev)`: per frame, the hero's side. */
  const play = (name, step = null, max = 9) => {
    const ev = { tells: [], flashes: [], worldTells: [], worldFlashes: [], impacts: [], t0: game.time, top: 0, far: 0, ok: false };
    G.watch = (n, e) => {
      if (n === 'combat:tell') (e?.source === 'world' ? ev.worldTells : e?.attack === name ? ev.tells : []).push({ t: game.time, tell: e.tell, x: e.x, z: e.z });
      if (n === 'combat:flash') (e?.source === 'world' ? ev.worldFlashes : e?.attack === name ? ev.flashes : []).push({ t: game.time, tell: e.tell, x: e.x, z: e.z });
      if (n === 'world:impact') ev.impacts.push({ t: game.time, kind: e.kind, mat: e.mat, by: e.by, id: e.id });
    };
    const h0 = G.hits.length;
    ev.ok = d.debug.trigger(name);
    run(G, max, (GG) => {
      ev.top = Math.max(ev.top, d.position.y);
      ev.far = Math.max(ev.far, Math.hypot(d.position.x, d.position.z));
      step?.(GG, ev);
    }, () => d.mode === 'foot' && !d.terrain.busy && !W.active.some((b) => b.state === STATE.FALLING || b.state === STATE.FLYING));
    G.watch = null;
    ev.hits = G.hits.slice(h0);
    return ev;
  };
  /** Each contact of `attack` against the nearest flash before it: the worst error (s) from flash + lead. */
  const worst = (ev, attack, flashes = ev.flashes) => ev.hits.filter((h) => h.attack === attack).reduce((m, h) => {
    const f = flashes.filter((x) => x.t <= h.t + 1e-6).pop();
    return Math.max(m, f ? Math.abs(h.t - (f.t + TUNING.flashLead)) : Infinity);
  }, 0);
  const ms = (v) => (Number.isFinite(v) ? (v * 1000).toFixed(0) : '∞');
  const parryOn = (ev, GG) => {
    // the hero's side: a parry 0.12 s before each cued impact
    for (const f of ev.flashes) if (!f.used && game.time >= f.t + TUNING.flashLead - 0.12 - DT) { f.used = true; GG.input.up(1); GG.input.click(1); }
  };
  const N0 = W.list.length;
  assert(N0 >= 60 && W.standing === N0, `the real courtyard: ${N0} breakables, all standing`);
  assert(['pillarFall', 'lanternKick', 'bellToll', 'swallowReturn'].every((n) => MOVES[n]?.terrain && d.debug.abilities().some((a) => a.name === n)), 'the four moves are in his abilities (the Lab, Training\'s BOSS MOVES)');

  // ---------------------------------------------------------------- Severed Pillar
  const west = piece('pillar', -15.6, 0);
  stage(-6, 2, west.x + 3.2, west.z);
  assert(west.topples && west.h > 4 && weight('pillarFall') > 0 && d.terrain.pick.fell === west, `Severed Pillar: the hero 3.2 m inside the west pillar (h ${west.h.toFixed(1)} m): his AI may pick it, for that pillar`);
  let ev = play('pillarFall');
  const back = Math.hypot(d.position.x - west.x, d.position.z - west.z);
  assert(ev.ok && ev.tells.length === 1 && ev.tells[0].tell === TELL.NORMAL && ev.flashes.length === 1, `it tells white once and glints once (${ev.tells.length} tell, ${ev.flashes.length} flash)`);
  assert(west.state === STATE.BROKEN && ev.impacts.some((e) => e.kind === 'topple' && e.id === west.id && e.by === 'boss') && ev.impacts.some((e) => e.kind === 'crash' && e.id === west.id), 'the pillar he cut fell (world:impact topple by the boss, then crash)');
  assert(ev.far > west.x * -1 + 0.6 && ev.far < d.baseBound + TT.edge + 2, `he went behind it, ${(ev.far - d.baseBound).toFixed(1)} m past his bound (the bound stretches for the move)`);
  assert(ev.worldTells.length === 1 && ev.worldTells[0].tell === TELL.RED && ev.worldFlashes.length === 1, 'the falling pillar tells red and flashes once (the world\'s: source world, hazard)');
  let fall = ev.hits.filter((h) => h.attack === 'fallingDebris');
  assert(fall.length === 1 && fall[0].tell === TELL.RED && fall[0].r === RESULT.HIT && Math.abs(fall[0].t - ev.worldFlashes[0].t - 0.3) < 0.06, `a hero who stays under it takes its one red blow, ${ms(fall[0]?.t - ev.worldFlashes[0]?.t)} ms after its flash`);
  assert(ev.worldTells[0].t - ev.tells[0].t >= 0.55 && fall[0].t - ev.worldTells[0].t >= 0.7, `the cut lands ${(ev.worldTells[0].t - ev.tells[0].t).toFixed(2)} s after his tell, the pillar ${(fall[0].t - ev.worldTells[0].t).toFixed(2)} s after it starts to go (time to be gone)`);
  assert(!ev.hits.some((h) => h.attack === 'pillarFall'), 'his cut itself does not reach a hero 3 m from the pillar');
  // out of the strip: nothing
  stage(-6, 2, west.x + 3.2, west.z);
  ev = play('pillarFall', (GG, e) => {
    if (e.worldTells.length && !e.moved) { e.moved = true; p.debug.teleport(p.position.x, p.position.z + 3.2); }
  });
  assert(west.state === STATE.BROKEN && !ev.hits.some((h) => h.r === RESULT.HIT), 'a hero who steps 3.2 m out of the marked strip is not hit');
  // a roll through it (the red answer)
  stage(-6, 2, west.x + 3.2, west.z);
  ev = play('pillarFall', (GG, e) => {
    if (e.worldFlashes.length && !e.rolled && game.time >= e.worldFlashes[0].t + 0.3 - 0.12) { e.rolled = true; p.debug.god = false; GG.input.axis = { x: 0, y: 1 }; GG.input.tap('Space'); }
  });
  input.axis = { x: 0, y: 0 };
  assert(!ev.hits.some((h) => h.r === RESULT.HIT) && p.hp === p.maxHp, `a roll as it lands goes through it (${ev.hits.map((h) => h.r).join(', ') || 'no contact'})`);
  // the cut is his: a hero hugging the pillar is in it, cued as any blow
  stage(-6, 2, west.x + 1.15, west.z);
  ev = play('pillarFall');
  assert(ev.hits.some((h) => h.attack === 'pillarFall' && h.tell === TELL.NORMAL) && worst(ev, 'pillarFall') <= 0.085, `a hero who hugs the pillar is in the cut: its contact ${ms(worst(ev, 'pillarFall'))} ms off its flash + ${TUNING.flashLead} s`);
  // back inside once it is over
  for (const n of MOVE_NAMES) if (MOVES[n].terrain) d.brain.cooldowns[n] = 99; // (no second trip out)
  p.debug.teleport(-6, 0);
  d.debug.setAI(true);
  run(G, 3.5);
  d.debug.setAI(false);
  settle(G);
  assert(Math.hypot(d.position.x, d.position.z) <= d.baseBound + 0.15 && d.terrain.slack < 0.2, `afterwards he is back inside his bound (${Math.hypot(d.position.x, d.position.z).toFixed(1)} of ${d.baseBound} m)`);
  // not chosen: the hero in the middle of the courtyard, under no pillar
  stage(-6, 2, 0, 3);
  assert(weight('pillarFall') === 0, 'with the hero in the middle of the courtyard (under no pillar) it is not chosen');

  // ---------------------------------------------------------------- Flying Lantern
  const lan = piece('lantern', 12.3, 12.3);
  stage(8, 8, 0, 0);
  assert(weight('lanternKick') > 0 && d.terrain.pick.kick === lan, 'Flying Lantern: 6 m from a stone lantern, the hero 17 m from it: his AI may pick it, for that lantern');
  ev = play('lanternKick');
  let hit = ev.hits.filter((h) => h.attack === 'lanternKick');
  assert(ev.ok && ev.tells.length === 1 && ev.tells[0].tell === TELL.BLUE && ev.flashes.length === 1 && ev.flashes[0].tell === TELL.BLUE, 'it tells blue and glints once, on the flying lantern');
  assert(lan.state === STATE.GONE && ev.impacts.some((e) => e.kind === 'throw' && e.id === lan.id) && ev.impacts.some((e) => e.kind === 'crash' && e.id === lan.id), 'the lantern left the ground, flew and burst (world:impact throw, then crash)');
  assert(Math.hypot(lan.tx, lan.tz) < 0.4, `it came down where the hero stood (${Math.hypot(lan.tx, lan.tz).toFixed(2)} m off)`);
  assert(hit.length === 1 && hit[0].r === RESULT.HIT && worst(ev, 'lanternKick') <= 0.085 && hit[0].t - ev.tells[0].t >= 1.0, `it strikes him once, ${ms(worst(ev, 'lanternKick'))} ms off its flash + ${TUNING.flashLead} s, ${(hit[0]?.t - ev.tells[0]?.t).toFixed(2)} s after the tell`);
  // blue: a parry bursts it on the blade
  stage(8, 8, 0, 0);
  const post0 = d.posture;
  ev = play('lanternKick', (GG, e) => parryOn(e, GG));
  hit = ev.hits.filter((h) => h.attack === 'lanternKick');
  assert(hit.length === 1 && hit[0].r === RESULT.PARRIED && d.posture >= post0 + TT.kick.parryPosture - 12, `parried, it bursts on the blade (result ${hit[0]?.r}); his posture takes the parry`);
  // gone from under it: nothing
  stage(8, 8, 0, 0);
  ev = play('lanternKick', (GG, e) => {
    if (e.flashes.length && !e.moved) { e.moved = true; p.debug.teleport(3.2, -3.2); }
  });
  assert(lan.state === STATE.GONE && !ev.hits.some((h) => h.attack === 'lanternKick'), 'a hero 4.5 m from where it lands is not hit');
  // not chosen: nothing to kick in reach
  stage(0, -1, 0, 5);
  assert(weight('lanternKick') === 0, 'in the middle of the courtyard (no lantern or stump within 13 m) it is not chosen');

  // ---------------------------------------------------------------- Three Tolls
  const bell = piece('bell', -9, -10);
  stage(-4, -5, 4, 4);
  assert(weight('bellToll') > 0 && d.terrain.pick.toll === bell, 'Three Tolls: 7 m from the bell, the hero 20 m from it: his AI may pick it');
  ev = play('bellToll');
  hit = ev.hits.filter((h) => h.attack === 'bellToll');
  assert(ev.ok && ev.tells.map((t) => t.tell).join() === [TELL.NORMAL, TELL.NORMAL, TELL.BLUE].join() && ev.flashes.length === 3, `three blows: white, white, blue; three glints (${ev.flashes.length})`);
  assert(ev.impacts.filter((e) => e.kind === 'chip' && e.mat === 'metal' && e.id === bell.id).length === 3 && bell.state === STATE.INTACT, 'each blow rings the bronze (world:impact chip, metal); the bell stands');
  assert(hit.length === 3 && hit.every((h) => h.r === RESULT.HIT) && worst(ev, 'bellToll') <= 0.085, `each ring strikes a hero who stands in its way once: 3 contacts, worst ${ms(worst(ev, 'bellToll'))} ms off its flash + ${TUNING.flashLead} s`);
  assert(hit[1].t - hit[0].t >= TUNING.minHitGap && hit[2].t - hit[1].t >= TUNING.minHitGap, `the rings arrive ${(hit[1].t - hit[0].t).toFixed(2)} and ${(hit[2].t - hit[1].t).toFixed(2)} s apart (>= ${TUNING.minHitGap})`);
  assert(Math.hypot(d.position.x - bell.x, d.position.z - bell.z) < bell.r + 1.4, 'he stood at the bell');
  // parried in rhythm
  stage(-4, -5, 4, 4);
  ev = play('bellToll', (GG, e) => parryOn(e, GG));
  hit = ev.hits.filter((h) => h.attack === 'bellToll');
  assert(hit.length === 3 && hit.every((h) => h.r === RESULT.PARRIED), `parried in rhythm, all three are turned (${hit.map((h) => h.r).join(', ')})`);
  // rolled through
  stage(-4, -5, 4, 4);
  ev = play('bellToll', (GG, e) => {
    // (across the rings' way: a roll toward the bell would meet the next one sooner than a roll can follow a roll)
    for (const f of e.flashes) if (!f.used && game.time >= f.t + TUNING.flashLead - 0.14) { f.used = true; p.debug.god = false; GG.input.axis = { x: 0.74, y: 0.67 }; GG.input.tap('Space'); }
  });
  input.axis = { x: 0, y: 0 };
  hit = ev.hits.filter((h) => h.attack === 'bellToll');
  assert(hit.length === 3 && !hit.some((h) => h.r === RESULT.HIT) && p.hp === p.maxHp, `a roll as each ring arrives goes through it (${hit.map((h) => h.r).join(', ')})`);
  // at the bell: the rings are born past him
  stage(-4, -5, bell.x + 2.6, bell.z + 2.2);
  ev = play('bellToll');
  assert(!ev.hits.some((h) => h.attack === 'bellToll'), 'a hero who stands at the bell is inside the rings: none strikes him (his way in)');
  // not chosen
  stage(-4, -5, 14, 16);
  assert(weight('bellToll') === 0, `with the hero ${Math.hypot(14 - bell.x, 16 - bell.z).toFixed(0)} m from the bell it is not chosen`);
  stage(9, 9, 6, 6);
  assert(weight('bellToll') === 0, 'with him across the courtyard from the bell it is not chosen');

  // ---------------------------------------------------------------- Swallow's Return
  stage(-10.5, 0, -7.5, 0);
  const hp0 = west.hp;
  assert(west.state === STATE.INTACT && weight('swallowReturn') > 0 && d.terrain.pick.spring === west, 'Swallow\'s Return: the west pillar 5 m behind him: his AI may pick it, for that pillar');
  d.posture = d.maxPosture * 0.5;
  const wPressed = weight('swallowReturn');
  d.posture = 0;
  assert(Math.abs(wPressed - TT.spring.pressed) < 1e-6, `pressed (his posture half full) he wants it ${TT.spring.pressed} times as much`);
  let perch = Infinity;
  ev = play('swallowReturn', () => { if (d.position.y > 1.5) perch = Math.min(perch, Math.hypot(d.position.x - west.x, d.position.z - west.z)); });
  hit = ev.hits.filter((h) => h.attack === 'swallowReturn');
  assert(ev.ok && ev.tells.length === 1 && ev.tells[0].tell === TELL.BLUE && ev.flashes.length === 1, 'it tells blue and glints once');
  assert(ev.top >= 1.8 && perch < 1.0 && west.hp < hp0 && ev.impacts.some((e) => e.kind === 'chip' && e.id === west.id && e.by === 'boss'), `he was ${ev.top.toFixed(1)} m up, on the pillar (${perch.toFixed(2)} m from its centre), and his feet chipped it`);
  assert(hit.length === 1 && hit[0].r === RESULT.HIT && worst(ev, 'swallowReturn') <= 0.085, `the diving cut lands ${ms(worst(ev, 'swallowReturn'))} ms off its flash + ${TUNING.flashLead} s`);
  assert(d.position.y === 0 && Math.hypot(d.position.x - p.position.x, d.position.z - p.position.z) < 3.4, 'he ends on the ground, in reach of the hero');
  // parried
  stage(-10.5, 0, -7.5, 0);
  ev = play('swallowReturn', (GG, e) => parryOn(e, GG));
  hit = ev.hits.filter((h) => h.attack === 'swallowReturn');
  assert(hit.length === 1 && hit[0].r === RESULT.PARRIED, 'parried, the dive is turned (he recoils, or the blades lock)');
  // rolled aside after the dive is committed: it misses
  stage(-10.5, 0, -7.5, 0);
  ev = play('swallowReturn', (GG, e) => {
    if (e.flashes.length && !e.moved && game.time >= e.flashes[0].t + 0.2) { e.moved = true; p.debug.teleport(p.position.x, p.position.z + 4.5); }
  });
  assert(!ev.hits.some((h) => h.attack === 'swallowReturn'), 'a hero gone 4.5 m aside once the dive is committed is not hit');
  // not chosen
  stage(0, 0, 0, 3);
  assert(weight('swallowReturn') === 0, 'in the middle of the courtyard (no tall pillar within 10.5 m) it is not chosen');
  stage(-10.5, 0, -13.5, 0);
  assert(d.terrain.find('spring') !== west, 'a pillar on the hero\'s side of him is not his way out');

  // ---------------------------------------------------------------- the second pass: thrown pieces show the flare only
  // (the owner, 2026-11-16: "flare only": nothing drawn where a thrown piece will land; the flare on the
  // flying piece flashLead before it lands; a roll at the flare always dodges). Every way the duelist's
  // effects draw on the ground ahead of a blow is counted while a thrown piece's move runs or flies.
  const fx = d.fx;
  const MARKED = ['warnRing', 'ringPulse', 'hazardFlash', 'shockRing'];
  const marks = { n: 0 };
  const saved = MARKED.map((k) => fx[k]);
  const spyMarks = (on) => MARKED.forEach((k, i) => { fx[k] = on && typeof saved[i] === 'function' ? (...a) => { marks.n++; return saved[i].apply(fx, a); } : saved[i]; });
  /** The answers to a thrown piece: `stand`, `parry` (0.12 s before the impact), `roll` at its flare
   *  (across its way). Returns the hits it dealt that landed (RESULT.HIT) and the results. */
  const answer = (name, how, bx, bz, hx, hz, phase = 1, pin = false) => {
    stage(bx, bz, hx, hz);
    if (phase > 1) d.phase = phase;
    marks.n = 0;
    spyMarks(true);
    const e = play(name, (GG, ev) => {
      // (`pin`: he stays on his spot whatever knocks him: each slab of a string is aimed at where he stands)
      if (pin) { p.position.x = hx; p.position.z = hz; }
      GG.game.mouseGround.set(d.position.x, 0, d.position.z); // (he faces the boss, as a locked-on hero)
      if (how === 'parry') parryOn(ev, GG);
      if (how === 'roll') for (const f of ev.flashes) if (!f.used) {
        f.used = true;
        p.debug.god = false;
        const ax = p.position.x - d.position.x, az = p.position.z - d.position.z, l = Math.hypot(ax, az) || 1;
        GG.input.axis = { x: -az / l, y: -ax / l };
        GG.input.tap('Space');
      }
    });
    spyMarks(false);
    input.axis = { x: 0, y: 0 };
    p.debug.god = true;
    e.marks = marks.n;
    e.landed = e.hits.filter((h) => h.attack === name && h.r === RESULT.HIT).length;
    return e;
  };
  // Flying Lantern: the flare on the piece, nothing on the ground
  ev = answer('lanternKick', 'stand', 8, 8, 0, 0);
  assert(ev.marks === 0 && ev.flashes.length === 1 && ev.flashes[0].tell === TELL.BLUE && lan.state === STATE.GONE, `Flying Lantern: nothing is drawn on the ground where it lands (${ev.marks} ground marks); one blue cue`);
  for (const [hx, hz] of [[0, 0], [3, -4], [-2, 4]]) {
    const r = answer('lanternKick', 'roll', 8, 8, hx, hz);
    assert(r.flashes.length === 1 && r.landed === 0 && p.hp === p.maxHp, `Flying Lantern at a hero at (${hx}, ${hz}): a roll at its flare is through it (${r.hits.filter((h) => h.attack === 'lanternKick').map((h) => h.r).join(', ') || 'no contact'})`);
  }

  // ---------------------------------------------------------------- the floor: Rising Flagstone
  const flagNames = ['flagKick', 'flagVolley', 'flagFan'];
  assert(flagNames.every((n) => MOVES[n]?.terrain && d.debug.abilities().some((a) => a.name === n)), 'the floor\'s three moves are in his abilities');
  stage(0, -3, 0, 5);
  const wFlag = weight('flagKick'), flagPick = d.terrain.pick.flag;
  assert(wFlag > 0 && flagPick?.kind === 'flagstone' && flagPick.floor && Math.hypot(flagPick.x, flagPick.z + 3) < 4, `Rising Flagstone: in the middle of the courtyard, the hero 8 m off: his AI may pick it, for a flagstone ${flagPick ? Math.hypot(flagPick.x, flagPick.z + 3).toFixed(1) : '-'} m from him`);
  stage(0, -3, 0, -1);
  assert(weight('flagKick') === 0, 'with the hero 2 m from him (inside his blade\'s reach) it is not chosen');
  let exp = 0;
  const ex0 = d.brain.expect;
  d.brain.expect = (...a) => { exp++; return ex0.apply(d.brain, a); };
  const standing0 = W.floor.filter((b) => b.state === STATE.INTACT).length;
  ev = answer('flagKick', 'stand', 0, -3, 0, 5);
  d.brain.expect = ex0;
  hit = ev.hits.filter((h) => h.attack === 'flagKick');
  assert(ev.ok && ev.tells.length === 1 && ev.tells[0].tell === TELL.BLUE && ev.flashes.length === 1 && ev.flashes[0].tell === TELL.BLUE, `it tells blue once and its slab flares once (${ev.tells.length} tell, ${ev.flashes.length} flare)`);
  assert(W.floor.filter((b) => b.state === STATE.INTACT).length < standing0 && ev.impacts.some((e) => e.kind === 'throw') && ev.impacts.some((e) => e.kind === 'crash'), 'a flagstone left the paving, flew and burst (world:impact throw, then crash)');
  assert(ev.marks === 0 && exp >= 1, `nothing is drawn where it lands (${ev.marks}); it was told to the cue ledger (brain.expect x${exp})`);
  assert(hit.length === 1 && hit[0].r === RESULT.HIT && worst(ev, 'flagKick') <= 0.085, `it strikes a hero who stands once, ${ms(worst(ev, 'flagKick'))} ms off its flare + ${TUNING.flashLead} s`);
  ev = answer('flagKick', 'parry', 0, -3, 0, 5);
  hit = ev.hits.filter((h) => h.attack === 'flagKick');
  assert(hit.length === 1 && hit[0].r === RESULT.PARRIED, `blue: a parry bursts it on the blade (${hit.map((h) => h.r).join(', ')})`);
  for (const [bx, bz, hx, hz] of [[0, -3, 0, 5], [2, -2, 9, 4], [-4, 3, -9, -6]]) {
    const r = answer('flagKick', 'roll', bx, bz, hx, hz);
    assert(r.flashes.length === 1 && r.landed === 0 && p.hp === p.maxHp, `him at (${bx}, ${bz}), the hero at (${hx}, ${hz}): a roll at its flare is through it (${r.hits.filter((h) => h.attack === 'flagKick').map((h) => h.r).join(', ') || 'no contact'})`);
  }
  stage(0, -3, 0, 5);
  ev = play('flagKick', (GG, e) => { if (e.flashes.length && !e.moved) { e.moved = true; p.debug.teleport(3.2, 5); } });
  assert(!ev.hits.some((h) => h.attack === 'flagKick'), 'a hero 3.2 m from where it lands when it flares is not hit');

  // ---------------------------------------------------------------- Flagstone Volley (phase 2), Scattered Flagstones (phase 3)
  ev = answer('flagVolley', 'stand', 0, -3, 0, 5, 2, true);
  hit = ev.hits.filter((h) => h.attack === 'flagVolley');
  const nV = ev.tells.length;
  if (process.env.GCD_TDBG) out('     volley', JSON.stringify({ hits: ev.hits.map((h) => [h.attack, h.r, +h.t.toFixed(2)]), flashes: ev.flashes.map((f) => +f.t.toFixed(2)), tells: ev.tells.map((f) => +f.t.toFixed(2)), impacts: ev.impacts.filter((e) => e.kind === 'throw' || e.kind === 'crash').map((e) => [e.kind, e.id, +e.t.toFixed(2)]) }));
  assert(ev.ok && nV >= 2 && nV <= 3 && ev.tells.every((t) => t.tell === TELL.BLUE) && ev.flashes.length === nV && ev.marks === 0, `Flagstone Volley (phase 2): ${nV} slabs, each levered and kicked, each with its flare; nothing on the ground`);
  assert(hit.length === nV && hit.every((h) => h.r === RESULT.HIT) && worst(ev, 'flagVolley') <= 0.085 && hit.slice(1).every((h, i) => h.t - hit[i].t >= TUNING.minHitGap), `each strikes a hero who stands, ${ms(worst(ev, 'flagVolley'))} ms off its flare + lead, ${hit.slice(1).map((h, i) => (h.t - hit[i].t).toFixed(2)).join(' / ')} s apart`);
  ev = answer('flagVolley', 'parry', 0, -3, 0, 5, 2, true);
  assert(ev.hits.filter((h) => h.attack === 'flagVolley').every((h) => h.r === RESULT.PARRIED) && ev.hits.some((h) => h.attack === 'flagVolley'), `parried in turn, every slab bursts on the blade (${ev.hits.filter((h) => h.attack === 'flagVolley').map((h) => h.r + ' ' + h.t.toFixed(2)).join(', ')}; flares ${ev.flashes.map((f) => f.t.toFixed(2)).join(' ')})`);
  ev = answer('flagVolley', 'roll', 0, -3, 0, 6, 2);
  assert(ev.landed === 0, `a roll at each flare is through each (${ev.hits.filter((h) => h.attack === 'flagVolley').map((h) => h.r).join(', ') || 'no contact'})`);
  ev = answer('flagFan', 'stand', 0, -3, 0, 6, 3);
  const fanTaken = ev.impacts.filter((e) => e.kind === 'throw').length;
  hit = ev.hits.filter((h) => h.attack === 'flagFan');
  assert(ev.ok && ev.tells.length === 1 && fanTaken >= 2 && ev.flashes.length >= 1 && ev.marks === 0, `Scattered Flagstones (phase 3): ${fanTaken} slabs levered at once and cut into a fan; ${ev.flashes.length} flare(s), nothing on the ground`);
  assert(hit.length === 1 && hit[0].r === RESULT.HIT && worst(ev, 'flagFan') <= 0.085, `the middle one strikes a hero who stands, once, ${ms(worst(ev, 'flagFan'))} ms off its flare + lead (the others land to either side)`);
  for (const [bx, bz, hx, hz] of [[0, -3, 0, 6], [3, 0, -5, 6]]) {
    const r = answer('flagFan', 'roll', bx, bz, hx, hz, 3);
    assert(r.landed === 0, `the fan at a hero at (${hx}, ${hz}): a roll at the flare is through it`);
  }

  // ---------------------------------------------------------------- a colossus: the Severed Pillar's rule, its strip from fallOff
  const colo = W.list.filter((b) => b.kind === 'colossus' && b.base).sort((a, b) => Math.hypot(a.x + 15.6, a.z + 2.6) - Math.hypot(b.x + 15.6, b.z + 2.6))[0];
  if (colo) {
    // (the pillars beside it would be picked first, being nearer the hero: they stand aside for this check)
    const others = W.list.filter((b) => b !== colo && b.topples && !b.floor);
    const tp = others.map((b) => b.topples);
    for (const b of others) b.topples = false;
    const ux = -colo.x / Math.hypot(colo.x, colo.z), uz = -colo.z / Math.hypot(colo.x, colo.z);
    const inStrip = colo.fallOff + 2.6, under = colo.fallOff * 0.5;
    stage(colo.x + ux * 9, colo.z + uz * 9, colo.x + ux * under, colo.z + uz * under);
    const wUnder = weight('pillarFall');
    stage(colo.x + ux * 9, colo.z + uz * 9, colo.x + ux * inStrip, colo.z + uz * inStrip);
    assert(colo.fallOff > 1 && wUnder === 0 && weight('pillarFall') > 0 && d.terrain.pick.fell === colo, `a colossus: the hero ${under.toFixed(1)} m from its base (under its legs, short of where its upper half lands) is not in its strip; ${inStrip.toFixed(1)} m out he is, and his AI may cut it down on him`);
    ev = play('pillarFall');
    fall = ev.hits.filter((h) => h.attack === 'fallingDebris');
    assert(colo.state === STATE.BROKEN && ev.worldTells.length >= 1 && fall.length === 1 && fall[0].r === RESULT.HIT, `its upper half comes down on the hero (the world's red, marked strip): ${fall.map((h) => h.r).join(', ') || 'no contact'}`);
    others.forEach((b, i) => { b.topples = tp[i]; });
  } else assert(false, 'the courtyard has a colossus');

  // ---------------------------------------------------------------- the bell's ring of sound: its looks (?toll=)
  {
    const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
    const res = {};
    for (const L of ['0', 'a', 'b']) {
      setLook('toll', L);
      const cnt = { old: 0, field: 0, blobs: 0 };
      const T = d.terrain, o0 = T._drawRing, o1 = T._drawRingField, sp = game.fx.fire?.spawn;
      T._drawRing = (...a) => { cnt.old++; return o0.apply(T, a); };
      T._drawRingField = (...a) => { cnt.field++; return o1.apply(T, a); };
      if (sp) game.fx.fire.spawn = (b) => { cnt.blobs++; return sp.call(game.fx.fire, b); };
      stage(-4, -5, 4, 4);
      const e = play('bellToll');
      T._drawRing = o0;
      T._drawRingField = o1;
      if (sp) game.fx.fire.spawn = sp;
      res[L] = { ...cnt, hits: e.hits.filter((h) => h.attack === 'bellToll' && h.r === RESULT.HIT).length };
    }
    setLook('toll', null);
    out(`     the toll's looks: ${Object.entries(res).map(([k, v]) => `${k}: drawn ${v.old} / ${v.field} frames, ${v.blobs} field blobs, ${v.hits} hits`).join(' · ')}`);
    assert(res['0'].old > 0 && res['0'].field === 0 && res.a.field > 0 && res.a.old === 0 && res.b.field > 0 && res.a.blobs > res['0'].blobs, 'the toll\'s ring: the bronze arcs main drew under ?toll=0 (?looks=old), a front of steel in the fire field under a (the owner\'s pick, shipped) and b');
    assert(res['0'].hits === 3 && res.a.hits === 3 && res.b.hits === 3, 'whatever its look, each of the three rings strikes a hero who stands once');
  }

  // ---------------------------------------------------------------- the reset; a world without pieces
  stage(8, 8, 0, 0);
  play('lanternKick');
  stage(-6, 2, west.x + 3.2, west.z);
  d.debug.trigger('pillarFall');
  run(G, 0.9);
  assert(W.standing < N0, `before the reset: ${N0 - W.standing} pieces down or going`);
  game.world.restore();
  d.debug.reset();
  assert(W.standing === N0 && W.list.every((b) => b.state === STATE.INTACT && b.hp === b.hpMax && b.body.visible) && W.active.length === 0, 'the fight\'s reset puts every piece back');
  assert(!d.terrain.busy && d.terrain.slack === 0 && !d.terrain.cur.act && d.bound === d.baseBound, 'and nothing of his is left in the air; his bound is the level\'s');
  const M = build();
  duel(M, { dist: 4 });
  const dm = M.game.dragon;
  assert(['pillarFall', 'lanternKick', 'bellToll', 'swallowReturn', 'flagKick'].every((n) => dm.weigh(n, MOVES[n], 1, 4) === 0 && dm.debug.trigger(n) === false) && dm.mode === 'foot', 'in a world without pieces (the other scenarios\' mock) none is chosen and none starts');
  dm.phase = 3;
  assert(['flagVolley', 'flagFan'].every((n) => dm.weigh(n, MOVES[n], 1, 6) === 0 && dm.debug.trigger(n) === false), '... nor the floor\'s later ones');

  // ---------------------------------------------------------------- a duel on the real set: they come up, they do not crowd out his strings
  // (the tuning pass: three seeds added up; one seed's 150 s held 1 - 5 of them by chance, at HEAD as
  // after the tuning: 4242 / 7 / 99 / 1337 / 2024 gave 4, 1, 3, 3, 1 before it and 1, 1, 3, 3, 3 after)
  const used = {};
  let moves = 0, down = 0, F = null;
  for (const seed of [SEED, 7, 99]) {
    F = build({ seed, real: true });
    duel(F, { dist: 4, ai: true });
    F.defend = makeDefender(F);
    F.watch = (n, e) => { if (n === 'dragon:windup' && e?.name) { moves++; if (MOVES[e.name]?.terrain) used[e.name] = (used[e.name] || 0) + 1; } };
    const fd = F.game.dragon, fp = F.game.player;
    fp.debug.god = true;
    run(F, 150, (GG) => { fd.hp = Math.max(fd.hp, fd.maxHp * 0.6); fencer(GG); }, () => fd.state === 'dead');
    F.watch = null;
    down += F.game.world.destructibles.list.length - F.game.world.destructibles.standing;
  }
  const nT = Object.values(used).reduce((a, b) => a + b, 0);
  out(`     3 x 150 s against the fencing bot: ${moves} moves, ${nT} of the courtyard ${JSON.stringify(used)}; ${down} pieces down`);
  assert(nT >= 5 && nT <= moves * 0.35, `they come up in a duel (${nT}) without crowding out his strings (${((nT / Math.max(1, moves)) * 100).toFixed(0)} % of ${moves} moves, >= 5 in three duels, <= 35 %)`);
  assert(!F.payload.size, `no non-finite payload in his events (${[...F.payload].join(', ')})`);
  return G;
}

// ================================================================== scenario: bots (opt-in)
/**
 * The tuning pass's measuring bots (2026-11-16; not pass / fail: it measures). On the REAL set, mortal
 * (no god mode), each its own random stream for what it misses (the AI's stream stays the seed's):
 * - fencers that answer 95 / 85 / 70 % of the cues (GCD_BSKILLS) and cut in his openings, whole
 *   fights (GCD_BSECS, default 420 s), three seeds (GCD_BSEEDS): won, the time, the time in each
 *   phase, hits, damage, flasks, the worst blow and the worst second (damage inside any 1 s);
 * - a pure defender (never attacks, answers 95 %), two minutes (GCD_BDSECS) in each phase, mortal,
 *   drinking when low: survived, damage, flasks; and the same with its guard held in burning ground
 *   (`stand`: it does not step off; the owner's question about the guard's 1 HP a tick).
 * The bots answer the world's cues too (a felled piece, rolled out of its strip) and step off a burning
 * line (the hero sees it), unless `stand`. GCD_BOTS=fight|defend|stand picks a part (default all).
 */
function probeDefender(G, { skill = 1, seed = 1 } = {}) {
  const pend = [];
  const roll = mulberry32(seed * 977 + Math.round(skill * 100));
  const stats = { flashes: 0, missed: 0, parryTry: 0, dodgeTry: 0, missedAt: [] };
  return {
    stats,
    onEvent(n, e) {
      if (n !== 'combat:flash' || (e?.source !== 'dragon' && e?.source !== 'world')) return;
      stats.flashes++;
      (stats.hist ??= []).push([G.game.time, e.attack, e.tell]);
      if (stats.hist.length > 12) stats.hist.shift();
      if (roll() > skill) { stats.missed++; stats.missedAt.push([G.game.time, e.attack]); return; }
      pend.push({ tell: e.tell, at: G.game.time + (e.source === 'world' ? 0.3 : TUNING.flashLead), x: e.x, z: e.z, hazard: !!e.hazard && !e.bullet, done: false });
    },
    act() {
      const g = G.game, input = G.input, t = g.time;
      for (let i = pend.length - 1; i >= 0; i--) if (pend[i].done || pend[i].at < t - 0.4) pend.splice(i, 1);
      for (const e of pend) {
        if (e.done) continue;
        const left = e.at - t - DT;
        if (e.tell === TELL.RED || e.tell === TELL.BLACK) {
          if (left <= (e.hazard ? 0.2 : 0.1)) {
            e.done = true;
            const c = e.hazard ? { x: e.x, z: e.z } : g.dragon.position, p = g.player.position;
            const dx = p.x - c.x, dz = p.z - c.z, l = Math.hypot(dx, dz) || 1;
            input.axis = e.hazard ? { x: dx / l, y: -dz / l } : { x: dz / l, y: dx / l };
            input.tap('Space');
            stats.dodgeTry++;
          }
        } else if (left <= 0.12) {
          e.done = true;
          input.up(1);
          input.click(1);
          stats.parryTry++;
        }
      }
      return pend.some((e) => !e.done && e.at - t < 0.7);
    },
  };
}
/** Off a burning line the hero stands in or at the edge of (sets the move axis); true if it stepped. */
function stepOffFire(G) {
  const d = G.game.dragon, p = G.game.player;
  if (!d.moveFx || p.state === 'roll') return false;
  for (const L of d.moveFx.lines) {
    if (!L.alive || L.age > L.life - 0.3) continue;
    const dx = L.bx - L.ax, dz = L.bz - L.az, l2 = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((p.position.x - L.ax) * dx + (p.position.z - L.az) * dz) / l2));
    const cx = L.ax + dx * u, cz = L.az + dz * u, ox = p.position.x - cx, oz = p.position.z - cz, o = Math.hypot(ox, oz);
    if (o > L.w / 2 + 0.75) continue;
    const nx = o > 1e-3 ? ox / o : -dz / Math.sqrt(l2), nz = o > 1e-3 ? oz / o : dx / Math.sqrt(l2);
    G.input.axis = { x: nx, y: -nz };
    return true;
  }
  return false;
}
async function scenarioBots() {
  out('\n== scenario BOTS (mortal fencers at 95 / 85 / 70 %, a pure defender per phase; the real set) ==');
  const SEEDS = (process.env.GCD_BSEEDS ?? '4242,7,99').split(',').map(Number).filter(Number.isFinite);
  const SKILLS = (process.env.GCD_BSKILLS ?? '0.95,0.85,0.7').split(',').map(Number).filter(Number.isFinite);
  const SECS = Number(process.env.GCD_BSECS ?? 420), DSECS = Number(process.env.GCD_BDSECS ?? 120);
  const PART = process.env.GCD_BOTS ?? 'all';
  let last = null;
  const worst = (hits) => {
    let blow = 0, sec = 0, blowBy = '', secBy = '';
    for (let i = 0; i < hits.length; i++) {
      if (hits[i].damage > blow) { blow = hits[i].damage; blowBy = hits[i].attack; }
      let s = 0;
      const by = [];
      for (let j = i; j < hits.length && hits[j].t - hits[i].t < 1; j++) { s += hits[j].damage; by.push(hits[j].attack); }
      if (s > sec) { sec = s; secBy = by.join('+'); }
    }
    return { blow, blowBy, sec, secBy };
  };
  const tally = (G, t0, p) => {
    const hits = G.hits.filter((h) => h.t > t0 && h.r === RESULT.HIT && h.damage > 0);
    const chip = G.hits.filter((h) => h.t > t0 && h.r !== RESULT.HIT && h.attack === 'burningGround');
    const burn = hits.filter((h) => h.attack === 'burningGround');
    const by = {};
    for (const h of hits) by[h.attack] = (by[h.attack] || 0) + h.damage;
    return { hits, burn, chip, by, w: worst(hits.filter((h) => h.attack !== 'burningGround')), dmg: hits.reduce((a, h) => a + h.damage, 0) };
  };
  if (PART === 'all' || PART === 'fight') {
    out(`   whole fights, ${SECS} s at most (real time: hit-stops count) · skill · seed · result · time · P1 / P2 / P3 s (from the wake; P2 / P3 counted from their gate) · his HP · hits (blow dmg + burn dmg) · flasks drunk · worst blow · worst second · most damage by`);
    for (const skill of SKILLS) {
      for (const seed of SEEDS) {
        const G = (last = build({ seed, real: true }));
        const { game } = G;
        duel(G, { dist: 4, ai: true });
        const d = game.dragon, p = game.player;
        G.defend = probeDefender(G, { skill, seed });
        const t0 = game.time, r0 = game.realTime, enter = { 1: r0 };
        let drunk = 0;
        const n = { parries: 0, breaks: 0, execs: 0, dealt: 0 };
        const src = {};
        G.watch = (ev, e) => {
          if (ev === 'player:heal') drunk++;
          if (ev === 'player:parry') n.parries++;
          if (ev === 'dragon:postureBreak') n.breaks++;
          if (ev === 'player:plungeHit' && e?.execution) n.execs++;
          if (ev === 'dragon:hurt') { const k = d.broken ? 'broken' : p.state; src[k] = (src[k] || 0) + (e?.damage ?? 0); }
        };
        run(G, SECS, (GG) => { fencer(GG, true); stepOffFire(GG); if (!enter[d.phase]) enter[d.phase] = game.realTime; }, () => d.state === 'dead' || !p.alive || game.state === 'victory');
        G.watch = null;
        const T = game.realTime - r0, won = d.state === 'dead' || game.state === 'victory';
        const ph = [1, 2, 3].map((k) => (enter[k] ? ((enter[k + 1] ?? r0 + T) - enter[k]).toFixed(0) : '-')).join(' / ');
        const r = tally(G, t0, p);
        const top = Object.entries(r.by).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ');
        out(`   ${String(Math.round(skill * 100)).padStart(3)} % ${String(seed).padStart(4)} ${won ? 'WON ' : p.alive ? 'time' : 'DIED'} ${T.toFixed(0).padStart(4)} s  ${ph.padEnd(14)} HP ${String(Math.round(Math.max(0, d.hp))).padStart(4)} (P${d.phase})  hits ${String(r.hits.length).padStart(3)} (${(r.dmg - r.burn.reduce((a, h) => a + h.damage, 0)).toFixed(0)} + burn ${r.burn.reduce((a, h) => a + h.damage, 0).toFixed(0)})  flasks ${drunk}  worst ${r.w.blow.toFixed(1)} (${r.w.blowBy})  sec ${r.w.sec.toFixed(1)} (${r.w.secBy})  · parries ${n.parries} breaks ${n.breaks} execs ${n.execs} · ${top}`);
        out(`        his damage by the hero's state: ${Object.entries(src).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')}`);
        G.defend = null;
      }
    }
  }
  for (const stand of [false, true]) {
    if (!(PART === 'all' || PART === (stand ? 'stand' : 'defend'))) continue;
    out(`   a pure defender (never attacks, answers 95 %${stand ? ', its GUARD HELD and it never steps off a burning line' : ', steps off a burning line'}), mortal, ${DSECS} s a phase · phase · seed · survived · hits (blow dmg + burn dmg) · burn ticks on the guard (no HP) · guard knocked open (by fire) · flasks · worst blow · worst second`);
    for (let ph = 1; ph <= 3; ph++) {
      for (const seed of SEEDS) {
        const G = (last = build({ seed, real: true }));
        const { game } = G;
        duel(G, { dist: 3, ai: true });
        const d = game.dragon, p = game.player;
        p.debug.noRiposte = true;
        G.defend = probeDefender(G, { skill: 0.95, seed });
        for (let n = 2; n <= ph; n++) {
          p.debug.god = true;
          d.brain.forcePhase(n);
          run(G, 8, (GG) => { GG.input.axis = { x: 0, y: 0 }; GG.defend.act(); }, () => d.phase === n && d.mode !== 'act');
        }
        p.debug.god = false;
        p.debug.heal();
        const t0 = game.time;
        let drunk = 0, fireOpens = 0, opens = 0;
        G.watch = (n, e) => { if (n === 'player:heal') drunk++; if (n === 'player:guardOpen') { opens++; if (e?.attack === 'burningGround') fireOpens++; } };
        const st = [], hitState = [];
        const th0 = p.takeHit.bind(p);
        p.takeHit = (h) => { const was = p.state, r = th0(h); if (r === RESULT.HIT && h?.attack !== 'burningGround') hitState.push([game.time, h.attack, h.tell, was, st.slice(-25).map((x) => x[1]).filter((x, i, A) => x !== A[i - 1]).join('>') + ' | cues ' + (G.defend.stats.hist ?? []).filter((f) => f[0] > game.time - 1.5).map((f) => `${f[1]}:${f[2][0]}@${(f[0] - game.time).toFixed(2)}`).join(' ')]); return r; };
        run(G, DSECS, (GG) => {
          st.push([game.time, p.state]);
          if (st.length > 90) st.shift();
          const { input } = GG;
          input.axis = { x: 0, y: 0 };
          if (!p.alive || game.state !== 'boss') return;
          if (d.brain.pendingPhase > ph) d.brain.pendingPhase = 0;
          d.hp = Math.max(d.hp, d.maxHp * (TUNING.phaseAt[ph] ?? 0) + 1);
          const busy = GG.defend.act();
          if (stand) { if (!busy && !input.down?.('Space')) input.press(1); }
          // (it drinks in a lull: no move of his running, or one in its recovery)
          else if (p.hp < 70 && p.flasks > 0 && !busy && (d.mode !== 'act' || d.brain.act?.t > d.brain.act?.recoveryStart) && ((game.realTime * 60) | 0) % 30 === 0) input.tap('KeyF');
          const dx = d.position.x - p.position.x, dz = d.position.z - p.position.z, l = Math.hypot(dx, dz);
          if (!busy && l > 3.4) input.axis = { x: dx / l, y: -dz / l };
          if (!stand) stepOffFire(GG);
          game.mouseGround.set(d.position.x, 0, d.position.z);
        }, () => !p.alive);
        G.watch = null;
        const r = tally(G, t0, p);
        // a blow that landed with no missed cue of it in the 1.2 s before it: the bot answered and was hit
        const ans = hitState.filter((h) => !G.defend.stats.missedAt.some((m) => m[1] === h[1] && h[0] - m[0] < 1.2 && h[0] >= m[0]));
        if (ans.length) out(`      answered and hit anyway: ${ans.map((h) => `${h[1]} ${h[2]} (${h[3]}; ${h[4]})`).join(' · ')}`);
        out(`   P${ph} ${String(seed).padStart(4)} ${p.alive ? 'ALIVE' : `DIED at ${(game.time - t0).toFixed(0)} s`}  hits ${String(r.hits.length).padStart(3)} (${(r.dmg - r.burn.reduce((a, h) => a + h.damage, 0)).toFixed(0)} + burn ${r.burn.reduce((a, h) => a + h.damage, 0).toFixed(0)})  burn ticks guarded ${r.chip.length}  guard knocked open ${opens} (by fire ${fireOpens})  flasks ${drunk}  HP ${Math.round(p.hp)}  worst ${r.w.blow.toFixed(1)} (${r.w.blowBy})  sec ${r.w.sec.toFixed(1)} (${r.w.secBy})`);
        G.defend = null;
      }
    }
  }
  return last;
}

// ================================================================== scenario: answer (opt-in)
/** The fairness sweep of the tuning pass: every AI move (or GCD_AMOVES) in every phase it is in,
 *  triggered from 5 distances across its band (left and right of his facing), against the parrying
 *  bot (white / blue parried, red / black rolled across) with the hero standing, or walking in at him
 *  (GCD_AWALK=1: what the pure defender does past 3.4 m). Prints every blow that lands. */
async function scenarioAnswer() {
  out('\n== scenario ANSWER (every move from across its band against the parrying bot) ==');
  const pick = process.env.GCD_AMOVES ? process.env.GCD_AMOVES.split(',') : MOVE_NAMES.filter((n) => !MOVES[n].counter && !MOVES[n].transition && !MOVES[n].terrain);
  const walk = !!process.env.GCD_AWALK;
  const G = build();
  duel(G, { dist: 4 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  p.debug.noRiposte = true;
  let bad = 0, runs = 0;
  for (const ph of [1, 2, 3]) {
    while (d.phase < ph) { const n = d.phase + 1; d.debug[`phase${n}`](); run(G, 4, null, () => d.phase === n && d.mode === 'foot'); }
    for (const name of pick) {
      const def = MOVES[name];
      if (!def || def.phase > ph || !(perPhaseW(def.weight, ph) > 0)) continue;
      const lo = def.band[0], hi = Math.min(def.band[1], 12);
      for (let k = 0; k < 5; k++) for (const ang of [-0.5, 0.5]) {
        settle(G, 8);
        d.moveFx?.reset();
        d.position.set(0, 0, -2); d.yaw = 0;
        place(G, Math.max(0.8, lo + ((hi - lo) * k) / 4), ang);
        run(G, 0.2);
        d.brain.cooldowns = {};
        G.defend = makeDefender(G);
        const h0 = G.hits.length;
        d.debug.trigger(name);
        runs++;
        run(G, 9, (GG) => {
          GG.input.axis = { x: 0, y: 0 };
          const busy = GG.defend.act();
          const dx = d.position.x - p.position.x, dz = d.position.z - p.position.z, l = Math.hypot(dx, dz);
          if (walk && !busy && l > 3.4) GG.input.axis = { x: dx / l, y: -dz / l };
          GG.game.mouseGround.set(d.position.x, 0, d.position.z);
        }, () => d.mode === 'foot' && !d.fx.crescentsAlive);
        G.defend = null;
        input.up(1);
        const landed = G.hits.slice(h0).filter((h) => h.r === RESULT.HIT && h.attack === name);
        if (landed.length) { bad++; out(`   P${ph} ${name} from ${(lo + ((hi - lo) * k) / 4).toFixed(1)} m (${ang > 0 ? 'left' : 'right'}): ${landed.map((h) => `${h.tell} ${h.damage}`).join(', ')}`); }
      }
    }
  }
  out(`   ${runs} runs, ${bad} with a blow that landed${walk ? ' (the hero walking in)' : ''}`);
  return G;
}
const perPhaseW = (w, ph) => (Array.isArray(w) ? w[Math.min(w.length, ph) - 1] : w);

// ================================================================== scenario: ranged (opt-in)
/** The sword qi moves at each range of their band (a standing, guarding hero): the cues they give and
 *  the crescents thrown / fizzled. GCD_RMOVES picks the moves. */
async function scenarioRanged() {
  out('\n== scenario RANGED (the qi moves: cues by range) ==');
  const names = (process.env.GCD_RMOVES ?? 'ashCrescent,emberFan,qiStorm,partingWind,chaseRain').split(',');
  const G = build();
  duel(G, { dist: 4 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  p.debug.noRiposte = true;
  for (const ph of [1, 2, 3]) {
    while (d.phase < ph) { const n = d.phase + 1; d.debug[`phase${n}`](); run(G, 4, null, () => d.phase === n && d.mode === 'foot'); }
    for (const name of names) {
      const def = MOVES[name];
      if (!def || def.phase > ph) continue;
      const res = [];
      for (const dist of [def.band[0], (def.band[0] + def.band[1]) / 2, Math.min(def.band[1], 12)]) {
        settle(G, 8);
        d.position.set(0, 0, -2); d.yaw = 0;
        place(G, dist);
        run(G, 0.2);
        d.brain.cooldowns = {};
        let fl = 0;
        G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === name) fl++; };
        const f0 = d.brain.stats?.fizzles ?? 0;
        d.debug.trigger(name);
        run(G, 8, (GG) => { GG.input.axis = { x: 0, y: 0 }; GG.input.press(1); GG.game.mouseGround.set(d.position.x, 0, d.position.z); }, () => d.mode === 'foot' && !d.fx.crescentsAlive);
        input.up(1);
        G.watch = null;
        res.push(`${dist.toFixed(1)} m: ${fl} cues${(d.brain.stats?.fizzles ?? 0) - f0 ? ` (${(d.brain.stats?.fizzles ?? 0) - f0} fizzled)` : ''}`);
      }
      out(`   P${ph} ${name}: ${res.join(' · ')}`);
    }
  }
  return G;
}

// ================================================================== scenario: probe (opt-in)
/** A mortal fencer that reads only a share of the tells (GCD_SKILL, default 0.85). Not a pass /
 *  fail check: it measures how dangerous he is. node duel.mjs . probe */
async function scenarioProbe() {
  const skill = Number(process.env.GCD_SKILL ?? 0.85);
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

// ================================================================== scenario: perfect (ADR-102)
// A perfect parry of a blade's blow pays: more posture, and the counter cut (the first light after
// it winds up twice as fast and crits).
async function scenarioPerfect() {
  out('\n== scenario PERFECT (a perfect parry: posture x POSTURE.perfect, and the counter cut) ==');
  // (the old riposte pinned: the default opens the counter cut on a plain parry of a last blow too, ADR-211)
  const RC = await imp('src/entities/player/riposteCut.js');
  RC.setRiposteMode('old');
  const G = build();
  duel(G, { dist: 2.0 });
  const { game, input } = G;
  const d = game.dragon, p = game.player, PP = DEFENSE.perfectParry;
  run(G, 0.4);
  /** Parry Plum Thrust with RMB pressed `lead` s before its impact. Returns the posture it dealt. */
  const parryAt = (lead) => {
    settle(G, 8);
    home(G);
    place(G, 2.0);
    run(G, 0.3);
    d.posture = 0;
    let parry = null, flashT = null, pressed = false;
    G.watch = (n, e) => {
      if (n === 'combat:flash' && e?.attack === 'plumThrust' && flashT === null) flashT = game.time;
      if (n === 'player:parry') parry = { ...e };
    };
    d.debug.trigger('plumThrust');
    run(G, 2.5, () => {
      game.mouseGround.set(d.position.x, 0, d.position.z);
      if (flashT !== null && !pressed && game.time >= flashT + TUNING.flashLead - lead - DT) { pressed = true; input.up(1); input.click(1); }
    }, () => !!parry);
    G.watch = null;
    return { parry, posture: d.posture };
  };
  // a plain parry: pressed between the perfect window (0.20 s since ADR-227) and the parry window (0.22 s),
  // in the middle of that sliver (the press lands within one step after the lead)
  const plainLead = PLAIN_LEAD;
  const plain = parryAt(plainLead);
  assert(plain.parry && !plain.parry.perfect && Math.abs(plain.posture - POSTURE.parry.normal) < 0.5 && !(p.quickUntil > game.time), `a parry pressed ${plainLead.toFixed(3)} s early is a plain one: ${plain.posture.toFixed(0)} posture (${POSTURE.parry.normal}), no counter cut readied`);
  const perf = parryAt(0.04);
  assert(perf.parry?.perfect === true && Math.abs(perf.posture - POSTURE.parry.normal * POSTURE.perfect) < 0.5, `pressed 0.04 s before the blow it is perfect: ${perf.posture.toFixed(0)} posture (${POSTURE.parry.normal} x ${POSTURE.perfect})`);
  assert(p.quickUntil > game.time && p.quickUntil <= game.time + PP.cutWindow + 1e-6, `... and the counter cut is ready for ${PP.cutWindow} s`);
  // the counter cut: the next light winds up cutSpeed x as fast and crits
  p.debug.noRiposte = true;
  const timeLight = (quick) => {
    settle(G, 8);
    home(G);
    place(G, 6);
    run(G, 0.3);
    p.critTimer = 0;
    p.quickUntil = quick ? game.time + 0.5 : -Infinity;
    input.click(0);
    let t = 0, a = null;
    run(G, 1, () => { if (p.atk && p.atk.t < p.atk.def.windup) t += DT; a = p.atk ?? a; }, () => p.atk && p.atk.t >= p.atk.def.windup);
    return { t, a };
  };
  const slow = timeLight(false), fast = timeLight(true);
  assert(!slow.a?.quick && fast.a?.quick === true && fast.a?.crit === true, `the first light after a perfect parry is the counter cut (quick ${fast.a?.quick}, crit ${fast.a?.crit}; a plain light: ${slow.a?.quick})`);
  assert(fast.t <= slow.t * 0.7 && fast.t >= slow.t / PP.cutSpeed - 2 * DT, `it winds up in ${fast.t.toFixed(3)} s against ${slow.t.toFixed(3)} s (x ${PP.cutSpeed})`);
  assert(!(p.quickUntil > game.time), 'one cut only: the next light is a plain one again');
  p.debug.noRiposte = false;
  RC.setRiposteMode(RC.RIPOSTE_DEFAULT);
  return G;
}

// ================================================================== scenario: riposteplanted (?parryRiposte=)
// A perfect parry of a duelist's last blow at a streak of 3 and of 7: with `planted` the hero stays where
// he parried (at most DEFENSE.riposteCut.step m in), no flurry, ONE heavy cut for n flash cuts' damage,
// the duelist reels; with `old` today's riposte flurry still runs.
async function scenarioRipostePlanted() {
  out('\n== scenario RIPOSTEPLANTED (?parryRiposte=planted: the hero stays planted, one heavy cut; old: the flurry) ==');
  const RC = await imp('src/entities/player/riposteCut.js');
  const G = build();
  duel(G, { dist: 2.0 });
  const { game, input } = G;
  const d = game.dragon, p = game.player, R = DEFENSE.riposteCut, C = DEFENSE.flurry.cut;
  run(G, 0.4);
  const take = (mode, n) => {
    RC.setRiposteMode(mode);
    settle(G, 8);
    home(G);
    place(G, 2.0);
    run(G, 0.3);
    d.posture = 0;
    d.hp = d.maxHp;
    p.hp = p.maxHp;
    p.streak = n - 1;
    p.streakT = 0;
    const t = { parry: null, ev: null, hits: [], end: null, flurry: false, ox: 0, oz: 0, far: 0, maxOut: 0, hurt: 0, reel: false, hp0: d.hp, f: 0, stateSeen: new Set(), t0: -1, tEnd: -1 };
    let flashT = null, pressed = false;
    G.watch = (nm, e) => {
      if (nm === 'combat:flash' && e?.attack === 'plumThrust' && flashT === null) flashT = game.time;
      if (nm === 'player:parry' && !t.parry) { t.parry = { ...e }; t.ox = p.position.x; t.oz = p.position.z; }
      if (nm === 'player:flurry') t.ev = { ...e };
      if (nm === 'player:flurryHit') t.hits.push({ ...e });
      if (nm === 'player:flurryEnd') t.end = { ...e };
      if (nm === 'player:hurt') t.hurt++;
    };
    d.debug.trigger('plumThrust');
    run(G, 4, () => {
      game.mouseGround.set(d.position.x, 0, d.position.z);
      if (flashT !== null && !pressed && game.time >= flashT + TUNING.flashLead - 0.04 - DT) { pressed = true; input.up(1); input.click(1); }
      if (t.parry) {
        t.f++;
        t.far = Math.max(t.far, Math.hypot(p.position.x - t.ox, p.position.z - t.oz));
        t.stateSeen.add(p.state);
        if (p.flurry?.on) t.flurry = true;
        if (d.brain.react?.kind === 'stagger') t.reel = true;
        if (t.ev && t.t0 < 0) t.t0 = game.time;
        if (t.end) t.tEnd = t.tEnd < 0 ? game.time : t.tEnd;
        if (!isFinite(p.position.x + p.position.z)) t.nan = true;
      }
    }, () => !!t.end && game.time > t.tEnd + 1.2 && p.state !== 'attack');
    G.watch = null;
    t.hpLost = t.hp0 - d.hp;
    t.state = p.state;
    return t;
  };
  for (const n of [3, 7]) {
    const t = take('planted', n);
    const exp = C.damage * n;
    out(`   planted n=${n}: parry ${!!t.parry?.perfect} · event ${JSON.stringify(t.ev)} · hits ${JSON.stringify(t.hits)} · hp lost ${t.hpLost} · far ${t.far.toFixed(2)} m · states ${[...t.stateSeen].join(',')} · reel ${t.reel}`);
    assert(t.parry?.perfect === true && t.ev?.planted === true && t.ev.strikes === n && t.ev.art === 'riposte' && t.ev.air === false, `planted n=${n}: a perfect parry answers with player:flurry strikes ${t.ev?.strikes} (art ${t.ev?.art})`);
    assert(!t.flurry && !t.stateSeen.has('flurry') && !t.stateSeen.has('ghostep'), `planted n=${n}: the flurry never runs (states ${[...t.stateSeen].join(', ')})`);
    assert(t.far <= R.step + 0.1 && !t.nan, `planted n=${n}: he never ends a frame more than ${(R.step + 0.1).toFixed(1)} m from where he parried (${t.far.toFixed(2)} m)`);
    assert(t.hits.length === 1 && t.hits[0].last === true && t.hits[0].n === n && t.hits[0].of === n, `planted n=${n}: exactly one blow (player:flurryHit n ${t.hits[0]?.n} of ${t.hits[0]?.of})`);
    assert(Math.abs(t.hpLost - exp) < 0.51 && Math.abs(t.hits[0]?.damage - exp) < 0.51, `planted n=${n}: the duelist took ${t.hpLost} (expected ${exp}: ${n} x ${C.damage})`);
    assert(t.reel, `planted n=${n}: he reels (stagger)`);
    assert(t.hurt === 0 && t.state !== 'attack' && t.end?.strikes === n, `planted n=${n}: the hero was not hurt, and is free again (${t.state})`);
  }
  // the step: a foe 2.5 m off (the parry's own contact leaves him about 1 m): at most `step` m in, never nearer than minGap
  {
    settle(G, 8);
    home(G);
    place(G, 2.5);
    run(G, 0.3);
    d.hp = d.maxHp;
    const x0 = p.position.x, z0 = p.position.z, hp0 = d.hp;
    let far = 0, hits = 0, near = Infinity;
    G.watch = (nm) => { if (nm === 'player:flurryHit') hits++; };
    const ok = RC.startRiposteCut(p, d, 3, null, false);
    run(G, 1.5, () => { far = Math.max(far, Math.hypot(p.position.x - x0, p.position.z - z0)); near = Math.min(near, Math.hypot(d.position.x - p.position.x, d.position.z - p.position.z)); }, () => p.state !== 'attack');
    G.watch = null;
    out(`   step: started ${ok} · moved ${far.toFixed(2)} m · nearest ${near.toFixed(2)} m · hits ${hits} · hp lost ${hp0 - d.hp}`);
    assert(ok && far > 0.3 && far <= R.step + 0.1 && near >= R.minGap - 0.15 && hits === 1 && Math.abs(hp0 - d.hp - C.damage * 3) < 0.51, `a foe 2.5 m off: he steps in ${far.toFixed(2)} m (at most ${R.step}), one blow, ${hp0 - d.hp} damage`);
  }
  const o = take('old', 3);
  out(`   old n=3: flurry ${o.flurry} · states ${[...o.stateSeen].join(',')} · hits ${o.hits.length}`);
  assert(o.flurry && o.stateSeen.has('flurry') && o.hits.length === 3 && !o.ev?.planted, `old: today's riposte flurry still runs (${o.hits.length} flash cuts)`);
  RC.setRiposteMode(RC.RIPOSTE_DEFAULT);
  assert(RC.RIPOSTE_DEFAULT === 'deathblow', 'the default is deathblow (the owner\'s pick)');
  return G;
}

// ================================================================== scenario: deathblow (?parryRiposte=deathblow)
// Against a duelist, in deathblow mode: a parry of a blow no longer counts in the dodge streak
// (`player.parryRun` counts the PERFECT ones); a parried last blow recoils him and opens the counter cut's
// window, with no automatic riposte; a parry that BREAKS his posture, or a parry of a BLUE blow, is answered
// where the hero stands by a planted combo of N = min(parryRun, 7) blows (at least 1): each one of his own
// clips (never the same combo twice), 22 + 2 N each and a finisher of 40 + 15 N, never hurt, he reels.
// old / planted: unchanged (the parries still count in the streak).
async function scenarioDeathblow() {
  out('\n== scenario DEATHBLOW (?parryRiposte=deathblow: a posture break or a blue parry -> a planted combo of N blows) ==');
  const RC = await imp('src/entities/player/riposteCut.js');
  const G = build();
  duel(G, { dist: 2.0 });
  const { game, input } = G;
  const d = game.dragon, p = game.player, DB = DEFENSE.deathblow;
  const { deathblowMoves } = await imp('src/entities/player/deathblow.js');
  const DR0 = await imp('src/entities/player/deathblow.js');
  DR0.setDbRead('0'); // (a) - (e) measure ADR-211's combo as built: the read (ADR-264, the default 'all') is part (f)
  const MOVES = deathblowMoves();
  assert(MOVES.length >= 8, `the move library has at least 8 moves (${MOVES.length})`);
  run(G, 0.4);
  const nearBreak = () => d.maxPosture - POSTURE.parry.normal * POSTURE.perfect + 1;
  const take = (mode, o = {}) => {
    RC.setRiposteMode(mode);
    settle(G, 8);
    home(G);
    place(G, 2.0);
    run(G, 0.3);
    d.posture = o.near ? nearBreak() : o.posture ?? 0;
    d.postureTimer = 0;
    d.hp = d.maxHp;
    p.hp = p.maxHp;
    p.debug.god = !o.hurt;
    p.streak = o.streak ?? 0;
    p.streakT = 0;
    p.parryRun = o.run ?? 0;
    const move = o.move ?? 'plumThrust';
    const t = { parry: null, ev: null, hits: [], end: null, flurry: false, ox: 0, oz: 0, far: 0, hurt: 0, hp0: d.hp, states: new Set(), tEnd: -1, quick: false, atk: null, brokenAtEnd: null, brokenAny: false, streaks: [], cine: null, run1: -1, streakAfter: -1, runAfter: -1, clips: [], winds: [], hitT: [], hitR: [], reeled: false, minGap: 99, ghost: 0, tFlurry: -1, tCut: -1, tParryR: -1, reacts: new Set(), hitGap: [], flashMax: 0, steps: [], parryGap: -1 };
    let flashT = null, pressed = false, pressedAtk = false, lastAtk = null;
    G.watch = (nm, e) => {
      if (nm === 'combat:flash' && e?.attack === move && flashT === null) flashT = game.time;
      if (nm === 'player:parry' && !t.parry) { t.parry = { ...e }; t.ox = p.position.x; t.oz = p.position.z; t.run1 = p.parryRun; t.tParryR = game.realTime; t.parryGap = Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z); }
      if (nm === 'player:flurry') { t.ev = { ...e }; t.tFlurry = game.realTime; }
      if (nm === 'player:flurryHit') { t.hits.push({ ...e }); t.hitT.push(game.time); t.hitR.push(game.realTime); t.hitGap.push(Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z)); t.steps.push(p.db.step ?? 0); }
      if (nm === 'player:flurryEnd') { t.end = { ...e }; t.tCut = game.realTime; }
      if (nm === 'player:hurt') t.hurt++;
      if (nm === 'player:streak') t.streaks.push(e.count);
      if (nm === 'dragon:stagger') t.reeled = true;
      if (nm === 'game:cinematic' && e?.kind === 'deathblow') t.cine = { ...e };
    };
    d.debug.trigger(move);
    const lead = o.perfect === false ? TUNING.flashLead - PLAIN_LEAD - DT : TUNING.flashLead - 0.04 - DT;
    run(G, o.secs ?? 5, () => {
      game.mouseGround.set(d.position.x, 0, d.position.z);
      if (!o.hurt && flashT !== null && !pressed && game.time >= flashT + lead) { pressed = true; input.up(1); input.click(1); }
      if (t.parry) {
        t.far = Math.max(t.far, Math.hypot(p.position.x - t.ox, p.position.z - t.oz));
        t.minGap = Math.min(t.minGap, Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z));
        t.states.add(p.state);
        t.ghost = Math.max(t.ghost, game.flow?.grade?.ghost ?? 0);
        if (p.flurry?.on) t.flurry = true;
        if (p.quickUntil > game.time) t.quick = true;
        if (o.press && t.quick && !pressedAtk && p.quickUntil > game.time && p.state !== 'attack') { pressedAtk = true; input.click(0); }
        // (the guard mashed through the combo: a press every third frame)
        if (o.guard && p.db.phase === 'combo' && ((game.realTime * 60) | 0) % 3 === 0) { input.up(1); input.click(1); t.guarded = (t.guarded | 0) + 1; }
        if (p.atk?.quick) t.atk = true;
        if (p.atk && p.atk !== lastAtk && p.atk.rip?.db) { lastAtk = p.atk; t.winds.push(p.atk.def.windup); }
        if (d.broken) t.brokenAny = true;
        t.reacts.add(d.mode === 'react' ? d.brain?.react?.kind : d.mode);
        if (t.hits.length && !t.end) t.flashMax = Math.max(t.flashMax, d.flash ?? 0);
        if (t.end && t.tEnd < 0) { t.tEnd = game.time; t.brokenAtEnd = d.broken; }
        if (!isFinite(p.position.x + p.position.z)) t.nan = true;
      }
    }, o.until ?? (() => !!t.end && game.time > t.tEnd + 1.2 && p.state !== 'attack' && p.state !== 'heavy'));
    G.watch = null;
    t.hpLost = t.hp0 - d.hp;
    t.state = p.state;
    t.streakAfter = p.streak;
    t.runAfter = p.parryRun;
    t.clips = [...p.db.clips];
    t.holds = p.db.hitLog.map((h) => ({ ...h }));
    t.moves = t.clips;
    return t;
  };
  // (a) a string's plain last blow: no automatic riposte, no combo, the counter window opens, the dodge streak is untouched
  {
    const t = take('deathblow', { perfect: false, press: true, secs: 2.2, until: () => false });
    out(`   (a) plain parry: parry ${JSON.stringify({ p: t.parry?.perfect, last: t.parry?.last })} · flurry events ${t.ev ? 1 : 0} · hits ${t.hits.length} · window ${t.quick} · quick cut ${t.atk} · streak ${t.streakAfter} (events ${t.streaks.join(',')}) · parryRun ${t.runAfter}`);
    assert(t.parry && t.parry.perfect === false && t.parry.last === true, '(a) the blow was parried (not perfect), its last');
    assert(!t.ev && !t.hits.length && !t.flurry, '(a) no combo, no automatic riposte: no flurry event, no flash cut');
    assert(t.quick, '(a) the counter cut window opens on a parried last blow');
    assert(t.atk === true, '(a) a press in the window starts the quick counter cut');
    assert(t.streakAfter === 0 && !t.streaks.length, `(a) the parry did not count in the dodge streak (streak ${t.streakAfter}, events ${t.streaks.join(',')})`);
    assert(t.runAfter === 0, '(a) a plain parry is no perfect parry: parryRun 0');
  }
  // (a2) perfect parries count in parryRun, not the streak; a hurt resets it; his posture back to 0 resets it
  {
    const t = take('deathblow', { run: 0, secs: 1.6, until: () => false });
    out(`   (a2) perfect parry (no break): parryRun ${t.run1} · streak ${t.streakAfter} · hits ${t.hits.length} · posture ${d.posture.toFixed(1)}`);
    assert(t.parry?.perfect === true && t.run1 === 1 && t.streakAfter === 0, `(a2) a perfect parry: parryRun 1, the dodge streak untouched (${t.run1}, ${t.streakAfter})`);
    assert(!t.ev && !t.hits.length && !d.broken, '(a2) no break, no deathblow');
    p.parryRun = 3;
    d.posture = 0;
    run(G, 0.2);
    assert(p.parryRun === 0, `(a2) his posture empty again: parryRun reset (${p.parryRun})`);
    const h = take('deathblow', { run: 4, hurt: true, secs: 2.5, until: () => false });
    out(`   (a2) hurt: hurts ${h.hurt} · parryRun ${h.runAfter}`);
    assert(h.hurt >= 1 && h.runAfter === 0, `(a2) a blow that hurts resets parryRun (hurts ${h.hurt}, run ${h.runAfter})`);
  }
  // the checks every combo shares: n blows, their damage, planted, unhurt, its events
  const combo = (tag, t, n) => {
    const k = Math.min(n, DB.cap), mid = DB.mid.base + DB.mid.per * k, fin = DB.fin.base + DB.fin.per * k;
    const exp = mid * (n - 1) + fin;
    out(`   ${tag}: event ${JSON.stringify(t.ev && { strikes: t.ev.strikes, art: t.ev.art, planted: t.ev.planted })} · hits ${JSON.stringify(t.hits.map((h) => [h.n, h.of, h.last, h.damage]))} · hp lost ${t.hpLost} (expected ${exp}) · far ${t.far.toFixed(2)} m · nearest ${t.minGap.toFixed(2)} m · winds ${t.winds.map((w) => w.toFixed(2)).join(' ')} · hit gaps ${t.hitR.map((x, i) => (x - (i ? t.hitR[i - 1] : t.tFlurry)).toFixed(2)).join(' ')} · end ${(t.tCut - t.hitR[t.hitR.length - 1]).toFixed(2)} · clips ${t.clips.join(' > ')} · end ${JSON.stringify(t.end)} · broken ${t.brokenAtEnd}`);
    assert(t.ev?.art === 'deathblow' && t.ev.planted === true && t.ev.strikes === n && t.ev.air === false && t.ev.storm === false, `${tag}: one player:flurry art deathblow, strikes ${n} (${t.ev?.strikes})`);
    assert(t.hits.length === n && t.hits.every((h, i) => h.n === i + 1 && h.of === n && h.planted === true && h.last === (i === n - 1)), `${tag}: ${n} flurryHits, the last flagged (${t.hits.length})`);
    assert(t.hits.every((h, i) => Math.abs(h.damage - (i === n - 1 ? fin : mid)) < 0.51), `${tag}: ${n - 1} x ${mid} then a finisher of ${fin} (${t.hits.map((h) => h.damage).join(',')})`);
    assert(Math.abs(t.hpLost - exp) < 0.51, `${tag}: ${t.hpLost} damage in all = ${exp}`);
    assert(t.far <= 0.7 && !t.nan, `${tag}: within 0.7 m of where he parried (${t.far.toFixed(2)} m)`);
    assert(t.minGap >= DB.minGap - 0.45, `${tag}: never on top of him (${t.minGap.toFixed(2)} m)`);
    assert(t.hurt === 0 && !t.flurry && !t.states.has('flurry') && !t.states.has('ghostep') && !t.states.has('plunge'), `${tag}: never hurt, no flurry / ghostep (states ${[...t.states].join(',')})`);
    assert(t.end?.art === 'deathblow' && t.end.label === 'Deathblow' && t.end.strikes === n && Math.abs(t.end.damage - exp) < 0.51, `${tag}: flurryEnd Deathblow ${t.end?.damage}`);
    assert(t.clips.length === n && t.clips.every((c, i) => i === 0 || c !== t.clips[i - 1]), `${tag}: ${n} clips, none twice in a row (${t.clips.join(' > ')})`);
    assert(t.winds.length === n && t.winds.slice(0, n - 1).every((w, i) => (i === 0 || w <= t.winds[i - 1] + 1e-6) && w >= DB.windMin - 1e-6) && (n < 3 || t.winds[1] < t.winds[0]) && Math.abs(t.winds[n - 1] - DB.finWind) < 1e-6, `${tag}: the tempo quickens, the finisher is held (${t.winds.map((w) => w.toFixed(3)).join(' ')})`);
    assert(t.cine && t.streakAfter === 0 && t.runAfter === 0, `${tag}: the slow beat ran; the dodge streak untouched (${t.streakAfter}); parryRun spent (${t.runAfter})`);
    assert(t.hitT.every((x, i) => i === 0 || x > t.hitT[i - 1]), `${tag}: the blows land one after the other`);
    assert(t.ghost > 0.3, `${tag}: the cold cast ran (grade.ghost ${t.ghost.toFixed(2)})`);
    assert(t.moves.every((m) => MOVES.includes(m)) && t.moves.every((m, i) => i === 0 || m !== t.moves[i - 1]) && (n < 3 || new Set(t.moves).size >= Math.min(n - 1, 3)), `${tag}: the moves of the combo differ from their neighbours (${t.moves.join(' > ')})`);
    assert(n < 2 || ['overhead', 'thrust', 'spinFin'].includes(t.moves[n - 1]), `${tag}: the finisher is one of the big ones (${t.moves[n - 1]})`);
    // the hit-pause: N=7 about 3 s, N=3 about 1.5 s; every blow's path ends at its contact; the hold grows, the finisher's the longest
    const T = t.tCut - t.tFlurry;
    out(`   ${tag}: whole time ${T.toFixed(2)} s · holds ${t.holds.map((h) => h.hold.toFixed(2)).join(' ')} · path points ${t.holds.map((h) => h.k).join(' ')}`);
    if (n === 7) assert(T >= 2.6 && T <= 3.4, `${tag}: the combo's whole time ${T.toFixed(2)} s (2.6-3.4)`);
    if (n === 3) assert(T >= 1.2 && T <= 1.8, `${tag}: the combo's whole time ${T.toFixed(2)} s (1.2-1.8)`);
    assert(t.holds.length === n && t.holds.every((h) => h.k >= 2 && h.k <= 16 && h.end < 0.05), `${tag}: every blow's path has 2-16 points and ends at its contact (${t.holds.map((h) => h.k + '/' + h.end.toFixed(2)).join(' ')})`);
    assert(t.holds.every((h, i) => h.hold >= 0.16 - 1e-6 && (i === 0 || i === n - 1 || h.hold >= t.holds[i - 1].hold - 1e-6)) && t.holds[n - 1].hold >= 0.38 - 1e-6 || n === 1, `${tag}: the hit-pause grows blow by blow and the finisher's is the longest`);
  };
  // (b) a posture-breaking perfect parry: n perfect parries behind it, posture one parry from breaking
  for (const [run, n] of [[2, 3], [6, 7], [0, 1], [9, 7]]) {
    const t = take('deathblow', { near: true, run });
    assert(t.parry?.perfect === true, `(b) run ${run}: the parry was perfect`);
    combo(`(b) run ${run}`, t, n);
    assert(t.brokenAtEnd === true, `(b) run ${run}: he stays broken after it`);
  }
  assert((DB.mid.base + DB.mid.per * DB.cap) * (DB.cap - 1) + DB.fin.base + DB.fin.per * DB.cap > DEFENSE.flurry.cut.damage * 7, 'the combo\'s top is above the flurry x7');
  // (c) a parry of a BLUE blow (the blue flare) without a break: a combo of n, he reels, he is not broken
  for (const [run, n, perfect] of [[3, 3, false], [0, 1, false], [6, 6, false]]) {
    const t = take('deathblow', { move: 'fallingAsh', run, perfect, secs: 6, posture: run > 0 ? 20 : 0 });
    out(`   (c) blue blow run ${run} perfect ${perfect}: parry ${JSON.stringify({ tell: t.parry?.tell, perfect: t.parry?.perfect, flare: t.parry?.flare })} · reeled ${t.reeled} · broken any ${t.brokenAny}`);
    assert(t.parry && t.parry.tell === 'blue' && t.parry.flare === true, `(c) run ${run}: a blue flare blow parried`);
    assert(!!t.ev, `(c) run ${run}: the blue parry started a combo`);
    if (t.ev) {
      combo(`(c) run ${run}`, t, n);
      assert(t.brokenAny === false && t.brokenAtEnd === false, `(c) run ${run}: he is not broken (a parry of a blue blow breaks nothing here)`);
      assert(t.reeled, `(c) run ${run}: he reels`);
    }
  }
  // (d) two combos in a row at the same n: the sequences of clips differ
  for (const n of [1, 3, 5]) {
    const seqs = [];
    for (let k = 0; k < 3; k++) seqs.push(take('deathblow', { near: true, run: n - 1 }).clips.join('|'));
    out(`   (d) n=${n}: ${seqs.join('  //  ')}`);
    assert(seqs.every((q, i) => q && (i === 0 || q !== seqs[i - 1])), `(d) n=${n}: no two combos in a row play the same clips`);
  }
  // (e) old / planted: parries still count in the streak, nothing of the deathblow runs
  for (const mode of ['old', 'planted']) {
    const t = take(mode, { run: 0, streak: 0, secs: 1.6, until: () => false });
    out(`   (e) ${mode}: streak events ${t.streaks.join(',')} · parryRun ${t.runAfter} · art ${t.ev?.art}`);
    assert(t.streaks.length > 0 && t.runAfter === 0 && t.ev?.art !== 'deathblow', `(e) ${mode}: the parry counts in the streak, no deathblow`);
    if (mode === 'planted') assert(t.ghost < 0.05, '(e) planted: the single cut takes no cold cast (' + t.ghost.toFixed(2) + ')');
  }
  // (g) the guard mashed through the combo (ADR-280): it never cuts the combo short (it ended it at once, nothing dealt)
  {
    const t = take('deathblow', { near: true, run: 2, guard: true });
    out(`   (g) guard mashed: presses ${t.guarded | 0} · hits ${t.hits.length} · states ${[...t.states].join(',')}`);
    assert((t.guarded | 0) >= 5, `(g) the guard was pressed through the combo (${t.guarded | 0} presses)`);
    combo('(g) guard mashed', t, 3);
  }
  // (h) a PERFECT parry of a blue blow marked `lock` (Falling Ash): the combo takes it from the blade lock (?dbLock=combo,
  // ADR-280); ?dbLock=lock: the lock as before, no combo
  {
    const DBM = await imp('src/entities/player/deathblow.js');
    const t = take('deathblow', { move: 'fallingAsh', run: 3, secs: 6, posture: 20 });
    out(`   (h) blue lock blow, perfect: parry ${JSON.stringify({ tell: t.parry?.tell, perfect: t.parry?.perfect })} · states ${[...t.states].join(',')} · hits ${t.hits.length}`);
    assert(t.parry?.perfect === true && t.parry.tell === 'blue', '(h) a perfect parry of a blue blow');
    assert(!t.states.has('lock') && !!t.ev, `(h) no blade lock: the combo came (states ${[...t.states].join(',')})`);
    if (t.ev) combo('(h) blue lock blow', t, 4);
    DBM.setDbLock('lock');
    const L = take('deathblow', { move: 'fallingAsh', run: 3, secs: 2.5, posture: 20, until: () => false });
    DBM.setDbLock(DBM.DBLOCK_DEFAULT);
    out(`   (h) dbLock=lock: states ${[...L.states].join(',')} · combo ${L.ev?.art ?? 'none'}`);
    assert(L.parry?.perfect === true && L.states.has('lock') && !L.ev, `(h) dbLock=lock: the blades lock, no combo (states ${[...L.states].join(',')})`);
  }
  // (f) THE READ (?dbread=, ADR-264): a the break, b space, c a clean contact, all. The same blows and damage as today
  // (combo's own checks less the disc and the spacing, which a and b change on purpose), and each piece does its one thing
  {
    const DR = await imp('src/entities/player/deathblow.js');
    const FX = await imp('src/combat/deathblowFx.js');
    const RD = DB.read;
    assert(DR.DBREAD_DEFAULT === 'all', `(f) the read's default is the owner's pick, all (${DR.DBREAD_DEFAULT})`);
    for (const mode of ['0', 'a', 'b', 'c', 'all']) {
      DR.setDbRead(mode);
      const R = DR.dbRead();
      for (const [kind, o] of [['break', { near: true, run: 2 }], ['blue', { move: 'fallingAsh', run: 3, perfect: false, secs: 6, posture: 20 }]]) {
        const t = take('deathblow', o);
        const n = 3, k = n, mid = DB.mid.base + DB.mid.per * k, fin = DB.fin.base + DB.fin.per * k, exp = mid * (n - 1) + fin;
        const wait = t.tFlurry - t.tParryR, after = t.hitGap.slice(1);
        out(`   (f) ${mode} ${kind}: hits ${t.hits.length} · hp lost ${t.hpLost} (${exp}) · parry → combo ${wait.toFixed(2)} s · gaps at the hits ${t.hitGap.map((x) => x.toFixed(2)).join(' ')} · steps ${t.steps.map((x) => x.toFixed(2)).join(' ')} · his reactions ${[...t.reacts].join(',')} · hurt flash ${t.flashMax.toFixed(2)} · fx clean ${FX.DBFX_LAST.clean} · hurt ${t.hurt}`);
        assert(t.ev?.art === 'deathblow' && t.hits.length === n && t.hits.every((h, i) => Math.abs(h.damage - (i === n - 1 ? fin : mid)) < 0.51) && Math.abs(t.hpLost - exp) < 0.51, `(f) ${mode} ${kind}: ${n} blows, ${exp} damage, as today (${t.hits.length}, ${t.hpLost})`);
        assert(t.hurt === 0 && !t.nan && t.end?.art === 'deathblow' && t.runAfter === 0, `(f) ${mode} ${kind}: never hurt, it ends, parryRun spent`);
        assert(t.winds.length === n && Math.abs(t.winds[n - 1] - DB.finWind) < 1e-6 && t.winds.slice(1, n - 1).every((w, i) => w <= t.winds[i] + 1e-6), `(f) ${mode} ${kind}: the tempo quickens, the finisher held (${t.winds.map((w) => w.toFixed(2)).join(' ')})`);
        // a: the beat between the parry and the first blow; thrown open (a broken foe stays on his knee)
        if (R.beat) {
          assert(wait >= RD.beat - 0.03 && wait <= RD.beat + 0.25, `(f) ${mode} ${kind}: the break holds ${RD.beat} s before the combo (${wait.toFixed(2)} s)`);
          if (kind === 'blue') assert(t.reacts.has('reeling') && !t.reacts.has('flinch'), `(f) ${mode} ${kind}: he is thrown open (reeling) and stays open while the blows land (${[...t.reacts].join(',')})`);
          if (kind === 'break') assert(t.reacts.has('broken'), `(f) ${mode} ${kind}: a broken foe stays broken (${[...t.reacts].join(',')})`);
          assert(t.winds[0] >= RD.entryWind - 1e-6, `(f) ${mode} ${kind}: the first blow's step in is seen (wind-up ${t.winds[0].toFixed(2)} s)`);
        } else assert(wait < 0.3, `(f) ${mode} ${kind}: no beat (${wait.toFixed(2)} s)`);
        // b: never nearer than the gap once the first blow has landed (he is driven back, the hero follows)
        // (a broken foe is never shoved: the hero steps back for room, the finisher excepted)
        if (R.space) assert(after.slice(0, -1).every((x) => x >= RD.gap - 0.15) && after.every((x) => x >= Math.min(RD.gap, t.hitGap[0]) - 0.15), `(f) ${mode} ${kind}: the blows land from ${RD.gap} m (${t.hitGap.map((x) => x.toFixed(2)).join(' ')})`);
        // c: his hurt flash dim, the effect told the contact is clean
        assert(FX.DBFX_LAST.clean === R.clean, `(f) ${mode} ${kind}: the hit effect's clean contact ${R.clean} (${FX.DBFX_LAST.clean})`);
        if (R.clean) assert(t.flashMax <= RD.hurtFlash + 0.05, `(f) ${mode} ${kind}: his hurt flash is dim (${t.flashMax.toFixed(2)})`);
        else assert(t.flashMax > RD.hurtFlash + 0.1, `(f) ${mode} ${kind}: today's hurt flash (${t.flashMax.toFixed(2)})`);
      }
    }
    DR.setDbRead(DR.DBREAD_DEFAULT);
  }
  // (g) THE STRIKE GAP (?strikeGap=, ADR-264): his blade blows stop at the floor (never past their reach), every
  // blow still met and parried; '0' as before
  {
    const SG = await imp('src/entities/enemies/duelist/strikeGap.js');
    assert(SG.STRIKE_GAP_DEFAULT === '0', `(g) the strike gap is off by default (it bends Shen Hui's lunges: ashform) (${SG.STRIKE_GAP_DEFAULT})`);
    const gaps = {};
    for (const mode of ['0', 'a', 'b']) {
      SG.setStrikeGap(mode);
      const t = take('deathblow', { move: 'fallingAsh', run: 0, perfect: false, secs: 6, posture: 0 });
      gaps[mode] = t.parryGap;
      out(`   (g) strikeGap ${mode}: parried ${!!t.parry} (${t.parry?.tell}) at ${t.parryGap.toFixed(2)} m · combo ${!!t.ev} · hurt ${t.hurt}`);
      assert(t.parry && t.parry.tell === 'blue' && t.ev?.art === 'deathblow' && t.hurt === 0, `(g) ${mode}: the blue blow still reaches and is parried, the deathblow follows`);
    }
    assert(gaps.a >= gaps['0'] - 0.02 && gaps.b >= gaps.a - 0.02 && gaps.b >= 1.4, `(g) the floor holds him off: ${gaps['0'].toFixed(2)} → a ${gaps.a.toFixed(2)} → b ${gaps.b.toFixed(2)} m`);
    SG.setStrikeGap(SG.STRIKE_GAP_DEFAULT);
    // the clash's size (?parryClash=a|b): a perfect parry still met and answered with the mark drawn smaller
    const PF = await imp('src/combat/perfectFx.js');
    assert(PF.PARRY_CLASH_DEFAULT === 'c' && PF.parryClashSpec()?.clash === 0, "(g) the clash's default is the owner's pick, c (a pinpoint and the sparks)");
    const base = {};
    for (const mode of ['0', 'a', 'b', 'c']) {
      PF.setParryClash(mode);
      const C = PF.parryClashSpec();
      const t = take('deathblow', { move: 'fallingAsh', run: 0, secs: 6, posture: 0 });
      const got = { perfect: t.parry?.perfect, art: t.ev?.art ?? t.end?.art ?? null, hits: t.hits.length, hp: t.hpLost };
      out(`   (g) parryClash ${mode}: ${JSON.stringify(C)} · ${JSON.stringify(got)}`);
      if (mode === '0') Object.assign(base, got);
      else assert(C && C.mark < 1 && C.clash < 1 && C.clash >= 0 && got.perfect === true && JSON.stringify(got) === JSON.stringify(base), `(g) parryClash ${mode}: the mark ${C?.mark} x, the burst ${C?.clash} x; the perfect parry and what follows as with 0`);
    }
    PF.setParryClash(PF.PARRY_CLASH_DEFAULT);
    // the small blue tell (?blueTell=a): a small blue cross on his blade, the blow parried as before
    const DF = await imp('src/entities/enemies/duelist/fx.js');
    assert(DF.BLUE_TELL_DEFAULT === 'a' && DF.TELL_GLINT.blueSmall.w < DF.TELL_GLINT.blue.w && !DF.TELL_GLINT.blueSmall.ring && DF.TELL_GLINT.blueSmall.tint, "(g) the small blue tell: narrower, no ring, dyed blue; the owner's pick, the default");
    DF.setBlueTell('a');
    {
      const t = take('deathblow', { move: 'fallingAsh', run: 3, perfect: false, secs: 6, posture: 20 });
      out(`   (g) blueTell a: parried ${!!t.parry} (${t.parry?.tell}) · combo ${t.ev?.art} · hurt ${t.hurt}`);
      assert(t.parry?.tell === 'blue' && t.ev?.art === 'deathblow' && t.hurt === 0, '(g) blueTell a: the blue blow is still cued, parried and answered');
    }
    DF.setBlueTell(DF.BLUE_TELL_DEFAULT);
  }
  RC.setRiposteMode(RC.RIPOSTE_DEFAULT);
  assert(RC.RIPOSTE_CUT.opts.includes('old') && RC.RIPOSTE_CUT.opts.includes('planted') && RC.RIPOSTE_DEFAULT === 'deathblow', 'deathblow is the default; old and planted stay options');
  return G;
}

// ================================================================== scenario: flare (ADR-118)
// The flare is the only sign of a moment (no glow through the windup, no ring on the floor); a parry
// of a blue flare blow is answered by the hero's counter; the black (charged) blow.
// ================================================================== scenario: fxlooks (the second pass's effects)
// Every option of fxash's switches (?kindle= ?ashp3= ?qi= ?flit=) runs for its whole life headless:
// no error, no NaN (build's guards throw), the field's blob peak under FX_CAP; '0' of the qi redraw
// draws exactly what main drew; and no look moves the fight (the looks draw from their own stream).
// The owner's picks (2026-11-16) are the defaults: the table (lookSwitch PICKED) against the Lab's
// switches, what lookOf returns with nothing set, under ?looks=old and ?looks=new.
async function scenarioFxLooks() {
  out('\n== scenario FXLOOKS (the shock, the Kindling, ash on the wind, the qi, the flit: every option; the picks as the defaults) ==');
  const { setLook, lookOf, PICKED, pickedOf, allOld, readLookUrl } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const { LOOK_SWITCHES: LOOK_SWITCHES_ALL } = await imp('src/dev/labLooks.js');
  const { DuelFx } = await imp('src/entities/enemies/duelist/fx.js');
  const SW = { kindle: ['a', 'b', 'c'], ashp3: ['a', 'b', 'c'], qi: ['0', 'a', 'b', 'c'], flit: ['0', 'a'] };
  // the look as it was before this pass (what `main` drew), every switch of the courtyard
  const BEFORE = { qi: '0', flit: '0', toll: '0', ashLook: '0' };
  const clear = () => { for (const k of [...Object.keys(SW), 'toll', 'ashLook']) setLook(k, null); };
  // 0. the picks: one table, every key a real switch and its value a real option; what lookOf
  //    returns at each call site's default (the Lab's rows carry it) with nothing set, under
  //    ?looks=old (a redraw: '0'; a new thing keeps its pick) and ?looks=new (= the default)
  {
    clear();
    // (switches still waiting for the owner's pick, lookSwitch.js PENDING, are left out of the picks' checks)
    const { PENDING = [] } = await imp('src/entities/enemies/duelist/lookSwitch.js');
    const LOOK_SWITCHES = LOOK_SWITCHES_ALL.filter((s) => !PENDING.includes(s[0]));
    assert(PENDING.every((n) => LOOK_SWITCHES_ALL.some((s) => s[0] === n) && pickedOf(n) == null), `pending switches (${PENDING.join(', ') || 'none'}) are Lab rows and not in PICKED`);
    const row = Object.fromEntries(LOOK_SWITCHES.map((s) => [s[0], s]));
    const bad = Object.entries(PICKED).filter(([k, v]) => !row[k] || !row[k][1].includes(v));
    // (a row marked as awaiting the owner's pick, its 8th field, draws its call site's default until then)
    const waiting = LOOK_SWITCHES.filter((s) => s[7] === 'awaiting' && pickedOf(s[0]) == null).length; // (a picked switch may wait for a new pick: it draws the old one)
    const missing = LOOK_SWITCHES.filter((s) => pickedOf(s[0]) == null && s[7] !== 'awaiting').map((s) => s[0]);
    assert(Object.isFrozen(PICKED) && !bad.length && !missing.length && Object.keys(PICKED).length === LOOK_SWITCHES.length - waiting, `PICKED: ${Object.keys(PICKED).length} switches, each a real switch of the Lab with a real option (${bad.map(([k, v]) => `${k}=${v}`).join(', ') || 'ok'}; not picked: ${missing.join(', ') || 'none'})`);
    const owner = { kindle: 'a', ashp3: 'a', qi: 'a', flit: 'a', burn: 'a', toll: 'a', star: 'a', sky: 'a', ignite: 'a', void: 'a', presence: 'a', great: 'a', floor: 'a', ashLook: 'b', lordLook: 'b' };
    assert(JSON.stringify(Object.keys(owner).sort().map((k) => `${k}=${PICKED[k]}`)) === JSON.stringify(Object.keys(owner).sort().map((k) => `${k}=${owner[k]}`)), 'the table is the owner\'s answer of 2026-11-16: every author\'s pick (a), the bodies b');
    const at = (search) => {
      readLookUrl(search);
      const o = Object.fromEntries(LOOK_SWITCHES.map((s) => [s[0], lookOf(s[0], s[2], s[3])]));
      readLookUrl('');
      return o;
    };
    const none = at(''), old = at('?looks=old'), neu = at('?looks=new'), one = at('?looks=old&star=b'), url = at('?qi=c');
    const wantOld = Object.fromEntries(LOOK_SWITCHES.map((s) => [s[0], s[2] === '0' ? '0' : PICKED[s[0]] ?? s[2]]));
    assert(JSON.stringify(none) === JSON.stringify(Object.fromEntries(LOOK_SWITCHES.map((s) => [s[0], PICKED[s[0]] ?? s[2]]))) && JSON.stringify(neu) === JSON.stringify(none), `with nothing set (and under ?looks=new) every call site draws the pick: ${JSON.stringify(none)}`);
    assert(JSON.stringify(old) === JSON.stringify(wantOld) && !allOld(), `?looks=old: every redraw '0' (what main drew), a new thing its pick: ${JSON.stringify(old)}`);
    assert(one.star === 'b' && one.qi === '0' && url.qi === 'c' && url.star === 'a', `the URL's own parameter beats ?looks=old and the pick (?looks=old&star=b: star ${one.star}, qi ${one.qi}; ?qi=c: qi ${url.qi})`);
    setLook('qi', 'b');
    readLookUrl('?qi=c');
    const forcedWins = lookOf('qi', '0');
    readLookUrl('');
    setLook('qi', null);
    assert(forcedWins === 'b' && lookOf('qi', '0') === 'a', `a look forced live (setLook) beats the URL (${forcedWins}); null gives the pick back (${lookOf('qi', '0')})`);
  }
  // the most the field may gain while one effect plays, the whole scene counted (the hero, his
  // trails, the cues, the flares). HEADLESS has no camera, so every crisp line (_ink: the trails, the
  // qi's edge, a flare's streak) falls back to a blob every 0.1 m instead of one per letter cell:
  // these counts run 1.4 - 2.5x the real page's (the storm with '0': 1111 here, 453 on the page;
  // ash on the wind a: 848 here, ~700 on the page). Measured 2026-11-16 (second round): the Kindling
  // 363 - 385, ash on the wind 631 - 968, the flurry 625 - 672. A cap with headroom, not a target.
  // Re-measured on the shipped looks (the picks, 2026-11-16): kindle a 374, ashp3 a 837, qi a 331 /
  // 540 / 632 (phases 1 - 3), flit a 592: every pick under 1000, the cap kept (it binds every option).
  const FX_CAP = 1000;
  const peakOf = (G, secs, step = null) => {
    const f = G.game.fx.fire, base = f.count;
    let peak = 0;
    run(G, secs, (g) => { step?.(g); peak = Math.max(peak, f.count - base); });
    return peak;
  };
  const report = [];
  // 1. the qi's '0' = main, call for call (one crescent flown 90 frames into a counting mock field;
  // the numbers were measured on f4e199d, before the redraw)
  {
    const want = { 1: [6174, 0, 54], 2: [6210, 0, 51] };
    const fly = (phase) => {
      const c = [0, 0, 0];
      const game = { time: 0, realTime: 0, dt: DT, fxDt: DT, lights: null, fx: { fire: { spawn: () => c[0]++ }, add: { spawn: () => c[1]++ }, alpha: { spawn: () => c[2]++ } }, player: { position: { x: 30, y: 0, z: 0.3 }, alive: true, radius: 0.45 } };
      const d = { game, T: TUNING, phase, emit() {}, hitPlayer: () => RESULT.HIT };
      const fx = new DuelFx(d);
      fx.throwCrescent(0, 0, 1, 0, { tell: TELL.NORMAL, damage: 14 });
      for (let i = 0; i < 90; i++) { game.time += DT; game.realTime += DT; fx.updateCrescents(DT, d); }
      return c;
    };
    for (const phase of [1, 2]) {
      setLook('qi', '0');
      const c = fly(phase);
      assert(c.join() === want[phase].join(), `qi '0' (?looks=old) draws what main drew in phase ${phase} (fire, add, alpha ${c.join()} = ${want[phase].join()})`);
      // with nothing set: the owner's pick, the redraw (another count than main's)
      clear();
      const s = fly(phase);
      assert(lookOf('qi', '0') === PICKED.qi && s.join() !== want[phase].join() && s[0] > 0, `with nothing set the qi draws the pick (${PICKED.qi}) in phase ${phase}, not main's look (fire, add, alpha ${s.join()})`);
    }
    clear();
  }
  // 2. every option of every switch, its whole life
  for (const L of SW.kindle) {
    clear(); setLook('kindle', L);
    const G = build(); duel(G, { dist: 4.5 });
    const d = G.game.dragon;
    d.debug.trigger('kindle');
    const peak = peakOf(G, 3.5);
    report.push(`kindle=${L} ${peak}`);
    assert(d.phase === 2 && d.kindle > 0.9 && peak > 150 && peak < FX_CAP, `?kindle=${L}: the Kindling lands and the blade burns (phase ${d.phase}, kindle ${d.kindle.toFixed(2)}), peak ${peak} blobs < ${FX_CAP}`);
  }
  {
    // the kneel draws on the blade only and keeps the blade from burning before the impact
    clear();
    const G = build(); duel(G, { dist: 4.5 });
    const d = G.game.dragon;
    d.debug.trigger('kindle');
    run(G, 0.9);
    assert(d.kindle < 0.75 && d.brain.act?.def?.transition, `the kneel: the blade is still catching 0.9 s in (kindle ${d.kindle.toFixed(2)} < 0.75)`);
  }
  // phase 3's change on the REAL transition (ashWind, from phase 2) when the kit has a third phase
  const toPhase3 = (d) => {
    if (d.kit.transitions?.[3] && d.T.phaseAt.length >= 3) {
      d.phase = 2;
      d.kindle = 1;
      return d.debug.phase3();
    }
    d.phase = 3; // (a kit without one: driven by hand)
    d.fx.phaseBurst(3, d.position.x, d.position.z);
    return false;
  };
  for (const L of SW.ashp3) {
    clear(); setLook('ashp3', L);
    const G = build(); duel(G, { dist: 4.5 });
    const d = G.game.dragon;
    const real = toPhase3(d);
    let peak = peakOf(G, 4);
    d.debug.trigger('swallow');
    peak = Math.max(peak, peakOf(G, 2.5));
    report.push(`ashp3=${L} ${peak}`);
    assert(d.phase === 3 && d._ashK > 0.9 && peak > 250 && peak < FX_CAP, `?ashp3=${L}: ash on the wind ${real ? 'on the real transition' : 'by hand'}, a moment (peak ${peak} > 250), its stream after (ashK ${d._ashK?.toFixed(2)}), peak < ${FX_CAP}`);
  }
  {
    // one afterimage per flit, whichever flit look: the string's (disciple.beatMotion) or the ash flit's own
    for (const L of SW.flit) {
      clear(); setLook('flit', L);
      const G = build(); duel(G, { dist: 3.5 });
      const d = G.game.dragon;
      d.phase = 3;
      let tick = 0;
      const flits = [], ghosts = [];
      const f0 = d.flit.bind(d), g0 = d.fx.ghost.bind(d.fx);
      d.flit = (...a) => { flits.push(tick); return f0(...a); };
      d.fx.ghost = (...a) => { ghosts.push(tick); return g0(...a); };
      d.debug.trigger('ashFlurry');
      run(G, 5, () => tick++);
      const per = flits.map((t) => ghosts.filter((g) => g === t).length);
      assert(flits.length >= 2 && per.every((n) => n === 1), `?flit=${L}: ashFlurry's ${flits.length} flits leave one afterimage each (${per.join(',')})`);
    }
  }
  for (const L of SW.qi) for (const phase of [1, 2, 3]) {
    clear(); setLook('qi', L);
    const G = build(); duel(G, { dist: 10 });
    const d = G.game.dragon;
    d.phase = phase;
    d.debug.trigger('ashCrescent');
    const peak = peakOf(G, 2.2);
    report.push(`qi=${L}/p${phase} ${peak}`);
    assert(peak < FX_CAP, `?qi=${L} phase ${phase}: the crescents fly out, peak ${peak} blobs < ${FX_CAP}`);
  }
  // the qi with a crowd in the air: the storm's nine (phase 3) and the fans (phases 2, 3)
  const crowd = {};
  for (const L of SW.qi) for (const [mv, phase] of [['qiStorm', 3], ['emberFan', 2], ['emberFan', 3]]) {
    clear(); setLook('qi', L);
    const G = build(); duel(G, { dist: 9 });
    const d = G.game.dragon;
    d.phase = phase;
    d.kindle = 1;
    const ok = d.debug.trigger(mv);
    let most = 0;
    const peak = peakOf(G, 3, () => { most = Math.max(most, d.fx.crescents.filter((c) => c.alive).length); });
    report.push(`qi=${L}/${mv}${phase} ${peak}`);
    // (against today's look in the same crowd: a redraw costs at most 1.3x it; '0' sets the bar)
    crowd[`${mv}${phase}`] ??= peak;
    const bar = crowd[`${mv}${phase}`];
    assert(ok && most >= 3 && peak <= bar * 1.3, `?qi=${L} ${mv} in phase ${phase}: ${most} in the air at once, peak ${peak} blobs <= 1.3 x today's ${bar}`);
  }
  for (const L of SW.flit) {
    clear(); setLook('flit', L);
    const G = build(); duel(G, { dist: 3 });
    const d = G.game.dragon;
    d.debug.flurry(5);
    const peak = peakOf(G, 4);
    report.push(`flit=${L} ${peak}`);
    assert(peak > 30 && peak < FX_CAP, `?flit=${L}: the flurry's flits, peak ${peak} blobs < ${FX_CAP}`);
  }
  {
    // the engines alone: a 6 m front of fire, an afterimage, a hard landing's dust, the break
    clear();
    const G = build(); duel(G, { dist: 6 });
    const d = G.game.dragon, fx = d.fx, f = G.game.fx.fire;
    let b = f.count;
    fx.shock(d.position.x, d.position.z, 6, { k: 1.25, fire: 1, kind: 'fire' });
    const s = f.count - b;
    run(G, 1.2);
    b = f.count;
    const gh = fx.ghost(d, { dx: 1, dz: 0, life: 0.6 });
    const g2 = f.count - b;
    run(G, 1.2);
    b = f.count;
    fx.dust(d.position.x, d.position.z, 1.6);
    run(G, 0.1);
    const du = f.count - b;
    report.push(`shock6=${s} ghost=${g2} dust1.6=${du}`);
    assert(s > 120 && s < 400, `a 6 m front of fire spawns ${s} blobs (a body: > 120, < 400)`);
    assert(gh > 60 && g2 === gh && g2 < 400, `an afterimage prints ${g2} blobs from his body (> 60, < 400)`);
    assert(du > 40 && du < 300, `a hard landing's dust has a body: ${du} blobs`);
  }
  // a phase-3 fight with the AI on (burning lines, the storm, ghosts, the stream): the field's peak
  // as shipped (the picks: nothing set) and before this pass (BEFORE) (the report; a cap far under the field's 6000)
  for (const looks of [{}, BEFORE]) {
    clear();
    for (const [k, v] of Object.entries(looks)) setLook(k, v);
    const G = build(); duel(G, { dist: 4, ai: true });
    G.defend = makeDefender(G);
    const d = G.game.dragon;
    toPhase3(d);
    let peak = 0, sum = 0, n = 0;
    const moves = {};
    G.watch = (nm, e) => { if (nm === 'dragon:windup') moves[e.name] = (moves[e.name] ?? 0) + 1; };
    // (the hero only defends, god mode: the fight runs the whole 40 s in phase 3)
    run(G, 40, (g) => { const p = g.game.player; p.hp = p.maxHp; g.input.axis = { x: 0, y: 0 }; G.defend.act(); const c = g.game.fx.fire.count; peak = Math.max(peak, c); sum += c; n++; });
    G.watch = null;
    out(`     phase-3 fight: ${Object.entries(moves).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    G.defend = null;
    report.push(`fight p3 ${Object.keys(looks).length ? 'before' : 'shipped'}: peak ${peak} mean ${(sum / n).toFixed(0)}`);
    // (the cap, re-measured on the shipped looks 2026-11-16 (the picks): 907 shipped, 919 before
    // this pass (mean 248 / 256); 1400 = about 1.5x the measurement, was 2400)
    assert(d.phase === 3 && peak < 1400, `a phase-3 fight, looks ${Object.keys(looks).length ? `before this pass ${JSON.stringify(looks)}` : 'as shipped (the picks)'}: the field peaks at ${peak} blobs (mean ${(sum / n).toFixed(0)}) < 1400 of its 6000`);
  }
  out(`     blob peaks: ${report.join(' | ')}`);
  // 3. no look moves the fight: a fixed-seed fight (the AI on, phase 2, a defending bot) gives the
  // same hits, cues and positions with every option forced as with the defaults
  const fight = (looks) => {
    clear();
    for (const [k, v] of Object.entries(looks)) setLook(k, v);
    const G = build(); duel(G, { dist: 4, ai: true });
    G.defend = makeDefender(G);
    const d = G.game.dragon;
    d.debug.trigger('kindle');
    const cues = [];
    G.watch = (n, e) => { if (n === 'combat:flash') cues.push(`${e.attack}@${G.game.time.toFixed(2)}`); };
    run(G, 10, fencer);
    toPhase3(d);
    run(G, 14, fencer);
    G.watch = null;
    G.defend = null;
    return `${G.hits.map((h) => `${h.attack}:${h.r}@${h.t.toFixed(2)}`).join(',')}|${cues.join(',')}|${d.position.x.toFixed(3)},${d.position.z.toFixed(3)},${d.hp.toFixed(1)}|${G.game.player.position.x.toFixed(3)}`;
  };
  // (the reference is the fight as shipped; BEFORE (his body '0' too: a build-time look) must play the same)
  // (the old riposte pinned for these fights: they compare one fight under many looks, not the parry's answer; ADR-211)
  const RC = await imp('src/entities/player/riposteCut.js');
  RC.setRiposteMode('old');
  const ref = fight({});
  for (const looks of [{ kindle: 'b', qi: 'a', flit: 'a', ashp3: 'b' }, { kindle: 'c', qi: 'c', flit: 'a', ashp3: 'c' }, { qi: 'b', ashp3: 'a' }, BEFORE, { ashLook: 'c', qi: '0' }]) {
    const got = fight(looks);
    if (got !== ref) { let i = 0; while (got[i] === ref[i]) i++; out(`     differs at ${i}: ...${ref.slice(Math.max(0, i - 80), i + 60)} vs ...${got.slice(Math.max(0, i - 80), i + 60)}`); }
    assert(got === ref, `the looks ${JSON.stringify(looks)} do not move the fight (same hits, cues, positions as shipped)`);
  }
  RC.setRiposteMode(RC.RIPOSTE_DEFAULT);
  clear();
  return build();
}

// ================================================================== scenario: blackout (ADR-271)
// ?black= (combat/blackout.js): a black blow's charge drains the picture, clears on every cancel; the
// violet goes in it; today's look (0) is untouched. ?redTrail= (combat/redTrail.js): a red blow's cut is
// red from its flare on, never before it, never on another blow.
async function scenarioBlackout() {
  out('\n== scenario BLACKOUT (a black blow darkens the picture, clears on every cancel; the red trail from the flare on) ==');
  const { TELL_STYLE } = await imp('src/combat/rules.js');
  const B = await imp('src/combat/blackout.js');
  const RT = await imp('src/combat/redTrail.js');
  const { K_FIRE } = await imp('src/entities/enemies/duelist/fx.js');
  const G = build();
  duel(G, { dist: 5 });
  const { game, input } = G;
  const d = game.dragon, p = game.player, O = TELL_STYLE.black.out, bo = game.blackout;
  run(G, 0.3);
  const BI = await imp('src/combat/blackImpact.js'), bi = game.blackImpact;
  assert(bo && typeof bo.beat === 'function' && bi && B.getBlack() === B.BLACK_DEFAULT && B.BLACK_DEFAULT === 'b' && RT.getRedTrail() === 'a' && BI.getBlackImpact() === 'a', 'game.blackout and game.blackImpact are up (ui/tells.js); the owner picks are the defaults: black b, redTrail a, blackImpact a');
  p.debug.god = true;
  /** Black Tide from 5 m, the guard held; `cut(t)` may cancel it `t` s into the charge. */
  const tide = (mode, cut = null) => {
    B.setBlack(mode);
    settle(G, 8);
    home(G);
    place(G, 5);
    run(G, 0.3);
    p.guard = p.maxGuard;
    let t0 = null, flashT = null, dur = 0, cutT = null, edgeMax = 0;
    const ks = [];
    G.watch = (n, e) => {
      if (n === 'combat:charge' && t0 === null) { t0 = game.time; dur = e.dur; }
      if (n === 'combat:flash' && e?.tell === TELL.BLACK && flashT === null) flashT = game.time;
    };
    d.debug.trigger('blackTide');
    run(G, 4.5, () => {
      input.press(1);
      game.mouseGround.set(d.position.x, 0, d.position.z);
      if (cut && t0 !== null && cutT === null && game.time - t0 >= cut.at) { cutT = game.time; cut.fn(); }
    }, () => {
      ks.push([game.time, bo.k]);
      edgeMax = Math.max(edgeMax, game.hud.tells.chargeAt >= 0 ? 1 : 0);
      return (flashT !== null && game.time > flashT + 1) || (cutT !== null && game.time > cutT + 1);
    });
    G.watch = null;
    input.up(1);
    const kAt = (t) => ks.reduce((best, x) => (Math.abs(x[0] - t) < Math.abs(best[0] - t) ? x : best), [Infinity, 0])[1];
    return { ks, t0, dur, flashT, cutT, kAt, edgeMax, kMax: Math.max(...ks.map((x) => x[1])) };
  };
  // --- today (0): nothing in the grade, the edges still dim, the violet charge drawn
  const z = tide('0');
  assert(z.flashT !== null && z.kMax === 0 && z.edgeMax === 1 && B.blackBody() === 1 && B.flareStyle(TELL.BLACK) === TELL_STYLE.black.flare, `?black=0: the grade untouched (max ${z.kMax}), the screen edges dim through the charge, the violet flare and body as before`);
  // --- a: dark over the last `over` s before the cue, held to the strike, then back
  const a = tide('a');
  const V = O.a;
  assert(a.flashT !== null && a.t0 !== null && a.dur > 1.2, `?black=a: Black Tide charged ${a.dur.toFixed(2)} s, cued`);
  assert(a.kAt(a.flashT - V.over - 0.1) < 0.02 && a.kAt(a.flashT - V.over / 2) > 0.3 && a.kAt(a.flashT) > 0.95, `... dark only over the last ${V.over} s: ${a.kAt(a.flashT - V.over - 0.1).toFixed(2)} → ${a.kAt(a.flashT - V.over / 2).toFixed(2)} → ${a.kAt(a.flashT).toFixed(2)} at the cue`);
  assert(a.kAt(a.flashT + O.hold - 2 * DT) > 0.95 && a.kAt(a.flashT + O.hold + O.snap + 3 * DT) === 0, `... held ${O.hold} s to the strike, colour back in ${O.snap} s (${a.kAt(a.flashT + O.hold - 2 * DT).toFixed(2)} → ${a.kAt(a.flashT + O.hold + O.snap + 3 * DT)})`);
  assert(a.edgeMax === 0 && B.blackBody() === 0 && B.flareStyle(TELL.BLACK) === TELL_STYLE.black.pale.flare && !B.flareStyle(TELL.BLACK).tint && B.flareStyle(TELL.RED) === TELL_STYLE.red.flare, '... the violet goes: no dark screen edges, no darkened body, the black flare undyed; the red flare as it was');
  // --- b: builds through the whole charge; c: darker (the uniforms a mock pipeline does not have)
  const b = tide('b');
  assert(b.kAt(b.t0 + b.dur * 0.5) > 0.3 && b.kAt(b.t0 + b.dur * 0.5) < 0.7 && b.kAt(b.flashT) > 0.95, `?black=b: half dark half way through the charge (${b.kAt(b.t0 + b.dur * 0.5).toFixed(2)}), all of it at the cue`);
  assert(O.c.depth > O.a.depth && O.c.over === O.a.over && O.b.depth === O.a.depth, 'c is a deeper a, b a slower a: one dimension each');
  // --- the black impact: hit or miss, the blow lands with a blast at its point; a cancelled one never does
  const W = game.world, gb = W.groundBlow;
  const blasts = [];
  W.groundBlow = (x, z, o) => { if (o?.kind === 'blast') blasts.push({ x, z, t: game.time, power: o.power }); return gb?.call(W, x, z, o); };
  const lands = (mode) => {
    BI.setBlackImpact(mode);
    const f0 = bi.stats.fired, n0 = blasts.length;
    const r = tide('b');
    return { r, fired: bi.stats.fired - f0, blasts: blasts.slice(n0) };
  };
  const held = lands('a');
  const T0 = d.T, lead = Array.isArray(T0.flashLead) ? T0.flashLead[0] : T0.flashLead;
  const dt0 = held.blasts[0] ? held.blasts[0].t - held.r.flashT : NaN;
  assert(held.fired === 1 && held.blasts.length === 1 && held.blasts[0].power >= 2 && Math.abs(dt0 - lead) < 0.1, `?blackImpact=a: Black Tide on a held guard lands ONE blast (power ${held.blasts[0]?.power}) at its impact (${dt0.toFixed(2)} s after the cue, lead ${lead})`);
  // (a miss: the hero 12 m off, out of its reach)
  BI.setBlackImpact('a');
  B.setBlack('b');
  settle(G, 8);
  home(G);
  place(G, 12);
  run(G, 0.3);
  const f1 = bi.stats.fired, hp1 = p.hp;
  d.debug.trigger('blackTide');
  run(G, 4, () => game.mouseGround.set(d.position.x, 0, d.position.z), () => bi.stats.fired > f1 && d.mode !== 'act');
  assert(bi.stats.fired - f1 === 1 && hp1 - p.hp === 0 && bi.stats.last && !bi.stats.last.hit, `... and a miss (the hero 12 m off, no HP lost) lands it too (${bi.stats.fired - f1})`);
  const none = lands('0');
  assert(none.fired === 0 && none.blasts.length === 0, '?blackImpact=0: no blast (the blow as before)');
  BI.setBlackImpact('a');
  const fc = bi.stats.fired;
  tide('b', { at: 1.0, fn: () => d.debug.stagger() });
  assert(bi.stats.fired === fc && !bi.armed, 'a black blow staggered in its charge never lands its blast');
  W.groundBlow = gb;
  // --- every cancel path lets go (mode b: dark from the start)
  const cancels = [
    ['a stagger', () => d.debug.stagger()],
    ['a posture break', () => d.debug.postureBreak()],
    ['a Lab interrupt (another move)', () => d.debug.trigger('plumThrust')],
    ['a retry', () => { game.events.emit('game:retry', {}); d.debug.reset(); }],
    ['his death', () => d.debug.kill()],
  ];
  for (const [what, fn] of cancels) {
    const c = tide('b', { at: 0.9, fn });
    const late = c.ks.filter((x) => x[0] > c.cutT + O.drop + 0.2 && x[0] < c.cutT + 1);
    assert(c.cutT !== null && c.flashT === null && c.kAt(c.cutT - DT) > 0.2 && late.length > 5 && late.every((x) => x[1] === 0), `${what} at 0.9 s: the dark (${c.kAt(c.cutT - DT).toFixed(2)}) is gone within ${O.drop} s, no cue`);
    if (what === 'his death' || what === 'a retry') {
      d.debug.reset();
      game.flow.debug.toState('boss');
      d.debug.setAI(false);
      run(G, 0.5);
    }
  }
  // --- the red trail: the cut red from the flare on; nothing before it; not on another blow
  const fx = d.fx, ink = fx._ink, sw = fx.sweep;
  const trail = (mode, move) => {
    RT.setRedTrail(mode);
    settle(G, 8);
    home(G);
    place(G, 3);
    run(G, 0.3);
    let inSweep = false, firstRed = null, flashes = 0;
    const reds = [];
    fx.sweep = (...x) => { inSweep = true; try { return sw.apply(fx, x); } finally { inSweep = false; } };
    fx._ink = (...x) => { if (inSweep && x[11] === K_FIRE) reds.push(game.time); return ink.apply(fx, x); };
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.tell === TELL.RED) { flashes++; if (firstRed === null) firstRed = game.time; } };
    d.debug.trigger(move);
    run(G, 4, () => game.mouseGround.set(d.position.x, 0, d.position.z), () => d.mode !== 'act' && game.time > (firstRed ?? Infinity) + 1.2);
    G.watch = null;
    fx.sweep = sw;
    fx._ink = ink;
    return { reds, firstRed, flashes };
  };
  const off = trail('0', 'twinEmbers');
  const on = trail('a', 'twinEmbers');
  assert(off.flashes === 2 && off.reds.length === 0, `?redTrail=0: Twin Embers (${off.flashes} red cues) leaves no red cut`);
  assert(on.flashes === 2 && on.reds.length > 4 && on.reds.every((t) => t >= on.firstRed), `?redTrail=a: its cuts lay ${on.reds.length} red strokes, none before the first flare`);
  const white = trail('a', 'plumThrust');
  assert(white.flashes === 0 && white.reds.length === 0, `... and a parryable blow (Plum Thrust) none (${white.reds.length})`);
  RT.setRedTrail('0');
  B.setBlack('0');
  p.debug.god = false;
  return G;
}

async function scenarioFlare() {
  out('\n== scenario FLARE (the flare is the only sign; a parried blue flare is countered; the black charged blow) ==');
  const { GUARD, TELL_STYLE, isFlare, dodgeOnly, tellDefaults } = await imp('src/combat/rules.js');
  const G = build();
  duel(G, { dist: 2.0 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  run(G, 0.4);
  // --- the rules and the data
  assert(isFlare(TELL.RED) && isFlare(TELL.BLACK) && !isFlare(TELL.BLUE) && isFlare(TELL.BLUE, true) && !isFlare(TELL.NORMAL, true), 'red and black always flare; a blue blow only when it is marked; a white one never');
  assert(dodgeOnly(TELL.RED) && dodgeOnly(TELL.BLACK) && !dodgeOnly(TELL.BLUE) && !tellDefaults(TELL.BLACK).parryable && !tellDefaults(TELL.BLACK).blockable, 'black is dodge-only: no guard and no parry holds it');
  assert(TELL_STYLE.red.warn.from === 0 && TELL_STYLE.red.warn.to === 0 && TELL_STYLE.red.floor === false, 'a red blow glows through no windup and marks no floor (TELL_STYLE.red)');
  const beats = (n) => MOVES[n].beats.flatMap((b) => (Array.isArray(b.pick) ? b.pick : [b]));
  const moments = MOVE_NAMES.filter((n) => beats(n).some((b) => b.flare));
  const blacks = MOVE_NAMES.filter((n) => beats(n).some((b) => b.tell === TELL.BLACK));
  out(`     parry moments: ${moments.join(', ')}; charged: ${blacks.join(', ')}`);
  assert(moments.length >= 5 && moments.every((n) => beats(n).filter((b) => b.flare).every((b) => b.tell === TELL.BLUE && b.zone)), `he has ${moments.length} parry moments, each a blue blow of the blade`);
  assert(blacks.length === 1 && beats(blacks[0])[0].windup >= 1.2 && MOVES[blacks[0]].weight.every((w) => w > 0), `one charged blow (${blacks[0]}), wound up ${beats(blacks[0])[0].windup} s, in both phases`);

  /** One move from `dist` m, the hero answering through `act(flashT)`. */
  const play = (name, dist, act = null, max = 5) => {
    settle(G, 8);
    home(G);
    place(G, dist);
    run(G, 0.3);
    p.guard = p.maxGuard;
    p.streak = 0;
    d.posture = 0;
    const ev = [];
    let flashT = null, warnPre = 0, rings = 0, charges = 0, tellOfWarn = null;
    const fx = d.fx, wr = fx.warnRing, ch = fx.charge;
    fx.warnRing = (...a) => { rings++; return wr.apply(fx, a); };
    fx.charge = (...a) => { charges++; return ch.apply(fx, a); };
    const h0 = G.hits.length, hp0 = p.hp;
    G.watch = (n, e) => {
      ev.push([n, e ? { ...e } : e]);
      if (n === 'combat:flash' && e?.attack === name && flashT === null) flashT = game.time;
    };
    d.debug.trigger(name);
    run(G, max, () => {
      game.mouseGround.set(d.position.x, 0, d.position.z);
      if (flashT === null && d.mode === 'act') { if (d.warn > warnPre) { warnPre = d.warn; tellOfWarn = d.warnTell; } }
      act?.(flashT);
    }, () => flashT !== null && game.time > flashT + 1.6 && p.state !== 'flurry' && game.hitstopTimer <= 0);
    G.watch = null;
    fx.warnRing = wr;
    fx.charge = ch;
    input.up(1);
    return { ev, flashT, warnPre, rings, charges, tellOfWarn, hits: G.hits.slice(h0), lost: hp0 - p.hp, has: (n) => ev.some((x) => x[0] === n), get: (n) => ev.find((x) => x[0] === n)?.[1] };
  };
  const at = (flashT, lead) => flashT !== null && game.time >= flashT + TUNING.flashLead - lead - DT;

  // --- a red area: nothing before the flare
  p.debug.god = true;
  const red = play('lotus', 2.0);
  p.debug.god = false;
  assert(red.flashT !== null && red.get('combat:flash')?.flare === true && red.get('combat:tell')?.flare === true, 'Lotus Sweep (red): its tell and its cue say flare');
  assert(red.warnPre === 0 && red.rings === 0, `... and until the cue nothing shows: no glow on him (${red.warnPre.toFixed(2)}), no ring on the floor (${red.rings} frames drawn)`);
  assert(d.fx.flares.some((f) => f.tell === TELL.RED) || d.fx.flares.every((f) => !f.alive), 'the red flare was drawn through the flare pool');

  // --- a blue flare parried: the counter
  let pressed = false;
  const blue = play('fallingAsh', 2.0, (fT) => { if (!pressed && at(fT, PLAIN_LEAD)) { pressed = true; input.up(1); input.click(1); } });
  const par = blue.get('player:parry'), dpar = blue.get('dragon:parried'), cnt = blue.get('player:flareCounter'), fend = blue.get('player:flurryEnd');
  assert(blue.get('combat:flash')?.flare === true && blue.get('combat:flash')?.tell === TELL.BLUE, 'Falling Ash is a parry moment: a blue cue marked flare');
  assert(par?.flare === true && par.perfect === false && dpar?.flare === true && dpar.last === true, `a plain parry of it (0.20 - 0.22 s early) is the moment's: player:parry flare, dragon:parried last (${JSON.stringify(dpar)})`);
  // (the counter cut, or, in the default deathblow mode, the combo that replaces it: deathblow.js)
  assert(fend?.art === 'deathblow' || (!!cnt && cnt.damage >= DEFENSE.flareCounter.damage - 0.5 && fend?.art === 'counter'), `... and the hero counters by himself: ${cnt?.strikes} blow(s), the last ${cnt?.damage?.toFixed(0)} (${DEFENSE.flareCounter.damage}), art ${fend?.art}`);
  assert(blue.lost === 0 && blue.has('player:flurry'), 'the parry cost no HP and the counter ran as flash cuts (player:flurry)');
  // (an ordinary heavy blow, not marked: the plain deflect, no counter)
  pressed = false;
  let flashes = 0;
  const plainW = G.watch;
  const rain = (() => {
    settle(G, 8); home(G); place(G, 2.0); run(G, 0.3);
    const ev = [];
    let fT = null, n = 0, done = false;
    G.watch = (nm, e) => { ev.push([nm, e ? { ...e } : e]); if (nm === 'combat:flash' && e?.attack === 'ashRain') { n++; if (n === 4) { fT = game.time; } } };
    d.debug.trigger('ashRain');
    p.debug.god = true;
    run(G, 4, () => { game.mouseGround.set(d.position.x, 0, d.position.z); if (fT !== null && !done && game.time >= fT + TUNING.flashLead - 0.12 - DT) { done = true; input.up(1); input.click(1); } }, () => done && game.time > fT + 0.8);
    G.watch = plainW;
    p.debug.god = false;
    return ev;
  })();
  const rp = rain.filter((x) => x[0] === 'dragon:parried').map((x) => x[1]);
  assert(rp.length >= 1 && rp.every((e) => !e.flare) && !rain.some((x) => x[0] === 'player:flareCounter'), `Rain of Ashes' held overhead (heavy, not a moment) parried: a deflect, no counter (${JSON.stringify(rp[0] ?? null)})`);

  // --- the black blow
  // (a) a held guard: the blow is stopped, the meter is gone, the guard knocked open
  const held = play('blackTide', 3.0, () => { input.press(1); });
  const open = held.get('player:guardOpen'), hh = held.hits.find((h) => h.attack === 'blackTide');
  assert(held.get('combat:tell')?.tell === TELL.BLACK && held.get('combat:flash')?.flare === true && held.has('combat:charge'), 'Black Tide: tell black, combat:charge as the dark gathers, a flare for its cue');
  assert(held.charges > 20 && held.warnPre > 0.5 && held.tellOfWarn === TELL.BLACK && held.rings === 0, `through the windup the charge is drawn (${held.charges} frames) and his body darkens (${held.warnPre.toFixed(2)})`);
  assert(hh?.r === RESULT.BLOCKED && held.lost === 0 && open?.black === true, `met on a held guard it is stopped (${hh?.r}), no HP lost (${held.lost})`);
  assert(held.has('player:guardOpen') && !held.has('player:hurt') && !held.has('player:guardBreak'), '... GUARD DOWN, not a guard break: no hurt');
  // (the meter right after: read from a fresh run, as it refills)
  let gAfter = null, stAfter = null, lenAfter = 0;
  const held2 = play('blackTide', 3.0, () => { input.press(1); if (gAfter === null && G.hits.some((h) => h.attack === 'blackTide' && h.t >= game.time - DT * 2 && h.r === RESULT.BLOCKED)) { gAfter = p.guard; stAfter = p.state; lenAfter = p.staggerLen; } });
  assert(gAfter === 0 && stAfter === 'stagger' && Math.abs(lenAfter - GUARD.black.openDur) < 1e-6, `the whole guard meter is gone (${gAfter}) and he is knocked open for ${lenAfter} s (GUARD.black.openDur ${GUARD.black.openDur})`);
  // (b) a parry press: the same
  pressed = false;
  const tap = play('blackTide', 3.0, (fT) => { if (!pressed && at(fT, 0.1)) { pressed = true; input.up(1); input.click(1); } });
  const th = tap.hits.find((h) => h.attack === 'blackTide');
  assert(th?.r === RESULT.BLOCKED && tap.get('player:guardOpen')?.black === true && !tap.has('player:parry') && tap.lost === 0, `a parry pressed in time does not turn it: the guard is knocked open (${th?.r}), no parry, no HP lost`);
  // (c) nothing: it lands
  const none = play('blackTide', 3.0);
  assert(none.lost > 30 && none.hits.find((h) => h.attack === 'blackTide')?.r === RESULT.HIT, `unanswered it lands: ${none.lost.toFixed(0)} HP`);
  p.debug.heal();
  // (d) a perfect dodge: answered as a red blow's is, with the flurry
  pressed = false;
  const roll = play('blackTide', 3.0, (fT) => {
    if (!pressed && at(fT, 0.1)) {
      pressed = true;
      const dx = p.position.x - d.position.x, dz = p.position.z - d.position.z, l = Math.hypot(dx, dz) || 1;
      input.axis = { x: dz / l, y: dx / l };
      input.tap('Space');
    } else input.axis = { x: 0, y: 0 };
  });
  const pd = roll.get('player:perfectDodge');
  assert(pd?.tell === TELL.BLACK && roll.has('player:flurry') && roll.lost === 0, `a perfect dodge of it is answered by the flurry (tell ${pd?.tell}, flurry ${roll.has('player:flurry')})`);
  input.axis = { x: 0, y: 0 };
  return G;
}

// ================================================================== scenario: telemetry (ADR-108)
// What each of his moves did to the hero: every answered blow is announced (combat:answer), the
// attempt's table, the killing move on the death screen, the totals kept across sessions.
async function scenarioTelemetry() {
  out('\n== scenario TELEMETRY (every answered blow is logged per move; the death screen names the killing move; totals are kept) ==');
  const { MoveLog, prettyMove } = await imp('src/game/telemetry.js');
  // --- the table by itself
  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const L = new MoveLog(store, 'ash');
  const A = (attack, result, o = {}) => L.answer({ attack, tell: 'normal', result, damage: 0, dead: false, stream: false, ...o }, o.t ?? 0);
  A('swallow', 'hit', { damage: 14 });
  A('swallow', 'parried');
  A('swallow', 'parried', { perfect: true });
  A('swallow', 'blocked');
  A('lotus', 'perfectDodge');
  A('lotus', 'dodged');
  A('plumThrust', 'clashed');
  A('breath', 'hit', { damage: 5, stream: true, t: 1.0 });
  A('breath', 'hit', { damage: 5, stream: true, t: 1.15 });
  A('breath', 'hit', { damage: 5, stream: true, t: 1.3 });
  A('breath', 'hit', { damage: 5, stream: true, t: 3.0 });
  A('nothing', 'ignored');
  const sw = L.attempt.get('swallow'), lo = L.attempt.get('lotus'), br = L.attempt.get('breath');
  assert(sw.seen === 4 && sw.hit === 1 && sw.parried === 2 && sw.perfectParry === 1 && sw.blocked === 1 && sw.damage === 14, `a move's row counts its blows by answer (${JSON.stringify(sw)})`);
  assert(lo.seen === 2 && lo.dodged === 2 && lo.perfectDodge === 1 && L.attempt.get('plumThrust').clashed === 1 && !L.attempt.has('nothing'), 'dodges, perfect dodges and clashes are counted; an ignored hit is not');
  assert(br.seen === 2 && br.hit === 2 && br.damage === 20, `a stream's ticks are one blow per 1.5 s, its damage counts in full (${br.seen} blows, ${br.damage} damage)`);
  A('swallow', 'hit', { damage: 30, dead: true });
  assert(L.killedBy?.attack === 'swallow' && L.attempt.get('swallow').kills === 1, 'the blow that killed him is remembered');
  const w = L.worst(3);
  assert(w.length === 2 && w[0].id === 'swallow' && w[0].hit === 2 && w[0].seen === 5 && w[1].id === 'breath', `worst(): the moves that struck him, the worst first (${w.map((x) => `${x.id} ${x.hit}/${x.seen}`).join(', ')})`);
  let T = L.commit('death');
  assert(T.attempts === 1 && T.deaths === 1 && T.wins === 0 && T.killedBy.swallow === 1 && T.moves.swallow.hit === 2, 'commit(death) adds the attempt to the stored totals');
  L.reset();
  assert(L.attempt.size === 0 && L.killedBy === null, 'reset(): a new attempt starts empty');
  A('swallow', 'parried');
  T = L.commit('victory');
  const again = new MoveLog(store, 'ash');
  assert(T.attempts === 2 && T.wins === 1 && again.totals().ash.moves.swallow.parried === 3 && again.totals().ash.moves.swallow.seen === 6, 'the totals survive a new session (the same storage) and keep adding up');
  const tab = again.table('ash', (id) => id.toUpperCase());
  assert(tab[0].move === 'SWALLOW' && tab[0].kills === 1 && tab[0]['hit %'] === 33 && tab.length === 4, `table(): one row a move, the deadliest first (${tab.map((r) => r.move).join(', ')})`);
  again.clear();
  assert(Object.keys(again.totals()).length === 0, 'clear() forgets them');
  const bad = new MoveLog({ getItem: () => '{broken', setItem: () => { throw new Error('full'); } }, 'ash');
  bad.answer({ attack: 'x', result: 'hit', damage: 1 }, 0);
  assert(bad.commit('death').attempts === 1 && Object.keys(bad.totals()).length === 0, 'broken or full storage never throws');
  assert(prettyMove('heavenFall') === 'Heaven Fall' && prettyMove('ash_rain') === 'Ash Rain' && prettyMove('') === 'A blow', 'a move without a label is spelled out from its id');

  // --- in the duel: his blows reach the table through the hero's own takeHit
  const G = build();
  duel(G, { dist: 2.0 });
  const { game, input } = G;
  const d = game.dragon, p = game.player, M = game.flow.moves;
  run(G, 0.4);
  M.reset();
  const answers = [];
  G.watch = (n, e) => { if (n === 'combat:answer') answers.push({ ...e }); };
  // Swallow Flicks taken on the chin (god mode off, full HP)
  p.debug.god = false;
  p.debug.heal();
  d.debug.trigger('swallow');
  run(G, 4, () => { input.axis = { x: 0, y: 0 }; game.mouseGround.set(d.position.x, 0, d.position.z); }, () => d.mode !== 'act');
  const row = M.attempt.get('swallow');
  assert(row && row.seen >= 2 && row.hit === row.seen && row.damage > 0 && answers.every((a) => a.attack === 'swallow' && a.result === RESULT.HIT && a.damage > 0 && !a.stream), `Swallow Flicks taken unanswered: ${row?.hit} of ${row?.seen} blows landed for ${row?.damage.toFixed(0)} (combat:answer x${answers.length})`);
  assert(d.attackLabel('swallow') === 'Swallow Flicks' && d.attackLabel('nope') === null && game.flow.moveLabel('swallow') === 'Swallow Flicks' && game.flow.moveLabel('nope') === 'Nope' && game.flow.moveLabel('burn') === 'The flames', 'a move is named by the boss (attackLabel), else spelled out');
  // a parried Plum Thrust is a parry in its row
  settle(G, 8);
  home(G);
  place(G, 2.0);
  run(G, 0.3);
  answers.length = 0;
  let flashT = null, pressed = false;
  const w0 = G.watch;
  G.watch = (n, e) => { w0(n, e); if (n === 'combat:flash' && e?.attack === 'plumThrust' && flashT === null) flashT = game.time; };
  d.debug.trigger('plumThrust');
  run(G, 2.5, () => {
    game.mouseGround.set(d.position.x, 0, d.position.z);
    if (flashT !== null && !pressed && game.time >= flashT + TUNING.flashLead - 0.12 - DT) { pressed = true; input.up(1); input.click(1); }
  }, () => answers.length > 0);
  G.watch = w0;
  const pt = M.attempt.get('plumThrust');
  assert(answers[0]?.result === RESULT.PARRIED && pt?.parried === 1 && pt.hit === 0 && pt.damage === 0, `a parried Plum Thrust is a parry in its row (${JSON.stringify(pt)})`);
  // the death: the killing move is named, the recap lists what struck him, the totals take it
  p.debug.noRiposte = true;
  settle(G, 8);
  home(G);
  place(G, 2.0);
  run(G, 0.3);
  p.hp = 1;
  d.debug.trigger('plumThrust');
  run(G, 4, () => { input.axis = { x: 0, y: 0 }; }, () => game.state === 'dead');
  assert(game.state === 'dead' && M.killedBy?.attack === 'plumThrust' && M.attempt.get('plumThrust').kills === 1, `killed by Plum Thrust (${game.state}, ${M.killedBy?.attack})`);
  const rec = game.flow.deathRecap();
  assert(rec[0] === 'SLAIN BY PLUM THRUST' && rec.some((l) => /^Swallow Flicks {2}\d+ of \d+ blows? landed$/.test(l)) && rec.length <= 4, `the death recap: ${JSON.stringify(rec)}`);
  run(G, 1.5);
  const shown = game.hud.bannerUi.rec.children.map((c) => c.textContent);
  assert(shown.length === rec.length && shown[0] === rec[0] && game.hud.bannerUi.rec.classList.contains('on'), `the death screen shows it under YOU DIED (${shown.length} lines)`);
  // rising again starts a new attempt and clears the lines
  run(G, 6, () => { if (game.flow.canRetry) input.tap('Space'); }, () => game.state === 'explore' && !game.flow.respawning);
  assert(game.state === 'explore' && M.attempt.size === 0 && M.killedBy === null && game.hud.bannerUi.rec.children.length === 0, `rising again starts a new attempt (${game.state}; ${M.attempt.size} rows, ${game.hud.bannerUi.rec.children.length} lines)`);
  G.watch = null;
  p.debug.noRiposte = false;
  return G;
}

// ================================================================== scenario: heavy (ADR-115)
// The heavy branches on a duelist: the right one for each point of the chain, the Mountain
// Splitter crushing his raised guard where a light is turned, the Rising Crescent staggering him,
// a held heavy charging, a light that no longer waits.
async function scenarioHeavy() {
  out('\n== scenario HEAVY (the heavy branches: the chain picks the heavy; a crush through his guard; a stagger; the charge on the heavy button) ==');
  const { HEAVY } = await imp('src/entities/player/combat.js');
  const G = build();
  duel(G, { dist: 2.2 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  run(G, 0.4);
  const names = [], ev = [];
  G.watch = (n, e) => { if (n === 'player:attack') names.push(e.name); ev.push(n); };
  /** n lights in open air (far from him), then a heavy press `gap` m before him. Returns the heavy's name. */
  const branch = (n, gap = 2.2, prep = null) => {
    settle(G, 8);
    home(G);
    if (n > 0) {
      p.debug.teleport(d.position.x + 30, d.position.z + 30);
      game.mouseGround.set(d.position.x + 60, 0, d.position.z + 60);
    }
    for (let k = 0; k < n; k++) { input.click(0); run(G, 0.36); }
    place(G, gap);
    prep?.();
    names.length = 0;
    ev.length = 0;
    input.click(2);
    run(G, 1.4, () => game.mouseGround.set(d.position.x, 0, d.position.z));
    return names[0];
  };
  for (let n = 0; n <= 4; n++) {
    const got = branch(n, 8);
    assert(got === HEAVY[n].name, `${n} light${n === 1 ? '' : 's'} then heavy: ${HEAVY[n].label} (${got})`);
  }
  // after a heavy the chain starts over: the next light is the first
  settle(G, 8);
  place(G, 8);
  input.click(2);
  run(G, 0.9);
  names.length = 0;
  input.click(0);
  run(G, 0.5);
  assert(names[0] === 'fallingCut', `after a heavy the next light is the chain's first (${names[0]})`);
  // his raised guard turns a light ...
  settle(G, 8);
  home(G);
  place(G, 2.2);
  d.brain.raiseT = 0;
  run(G, 0.2);
  let hp0 = d.hp;
  input.click(0);
  run(G, 0.6);
  assert(d.hp === hp0 && (G.counts['dragon:guard'] ?? 0) > 0, `his raised guard turns a light (hp ${hp0} -> ${d.hp})`);
  // ... the Mountain Splitter crushes it: it lands and he staggers
  hp0 = d.hp;
  const got3 = branch(3, 2.2, () => { d.brain.raiseT = 0; });
  assert(got3 === HEAVY[3].name && d.hp < hp0 && ev.includes('dragon:stagger'), `the Mountain Splitter (poise ${HEAVY[3].poise}) crushes his raised guard: ${hp0 - d.hp} damage, he staggers (${ev.filter((n) => n.startsWith('dragon:')).join(', ')})`);
  // the Rising Crescent staggers him where he stands, his guard down
  hp0 = d.hp;
  const got1 = branch(1, 2.2, () => { d.brain.raiseT = 99; });
  assert(got1 === HEAVY[1].name && d.hp < hp0 && ev.includes('dragon:stagger'), `the Rising Crescent lands (${hp0 - d.hp}) and staggers him (reel ${HEAVY[1].reel})`);
  // held, the heavy is the charge; the light never charges
  settle(G, 8);
  place(G, 8);
  names.length = 0;
  input.press(2);
  let charged = false;
  run(G, 1.0, () => { if (p.state === 'charge') charged = true; });
  input.up(2);
  run(G, 1.0);
  assert(charged && names.includes('cleave'), `the heavy held 1 s charges, released: the cleave (${names.join(', ')})`);
  settle(G, 8);
  place(G, 8);
  input.press(0);
  let chargedL = false;
  run(G, 1.0, () => { if (p.state === 'charge') chargedL = true; });
  input.up(0);
  run(G, 0.6);
  assert(!chargedL, 'the light held 1 s never charges');
  G.watch = null;
  return G;
}

// ================================================================== scenario: strategy (opt-in)
/** Which defence wins? Three bots that differ only in how they answer a tell (makeDefender `style`),
 *  each in god mode (how fast it kills, how often it is struck) and mortal at GCD_SKILL (does it
 *  live). Not a pass / fail check: node duel.mjs . strategy */
async function scenarioStrategy() {
  const skill = Number(process.env.GCD_SKILL ?? 0.85);
  out(`
== scenario STRATEGY (mixed / parry-only / dodge-only; god mode, then mortal at ${Math.round(skill * 100)} %) ==`);
  let last = null;
  for (const style of ['mixed', 'parry', 'dodge']) {
    for (const seed of [4242, 7, 99]) {
      for (const mortal of [false, true]) {
        const G = build(seed);
        const { game } = G;
        duel(G, { dist: 4, ai: true });
        G.defend = makeDefender(G, { skill: mortal ? skill : 1, style });
        const d = game.dragon, p = game.player;
        const n = { parries: 0, perfect: 0, flurryDmg: 0, breaks: 0, dealt: 0 };
        G.watch = (ev, e) => {
          if (ev === 'player:parry') n.parries++;
          if (ev === 'player:perfectDodge') n.perfect++;
          if (ev === 'dragon:postureBreak') n.breaks++;
          if (ev === 'dragon:hurt') n.dealt += e.damage;
        };
        const t0 = game.time;
        run(G, 360, (GG) => fencer(GG, mortal), () => d.state === 'dead' || !p.alive || game.state === 'victory');
        G.watch = null;
        const taken = G.hits.filter((h) => h.r === RESULT.HIT);
        const end = d.state === 'dead' || game.state === 'victory' ? 'WON ' : p.alive ? 'time' : 'DIED';
        out(`     ${style.padEnd(5)} seed ${String(seed).padEnd(4)} ${mortal ? 'mortal' : 'god   '} ${end} ${(game.time - t0).toFixed(0).padStart(3)} s  his HP ${String(Math.round(Math.max(0, d.hp))).padStart(4)}  hits taken ${String(taken.length).padStart(2)} (${Math.round(taken.reduce((a, h) => a + (h.damage || 0), 0))} dmg)  parries ${String(n.parries).padStart(3)}  perfect dodges ${String(n.perfect).padStart(2)}  breaks ${n.breaks}`);
        G.defend = null;
        last = G;
      }
    }
  }
  return last;
}

// ================================================================== scenario: motion (ADR-126: how his moves MOVE)
// A duelist's moves as motion, measured on the rig in his own frame: the sword hand never crosses the
// frame in a step (a follow-through has its own clock, realise.js), a string's feet hold their ground
// and step (anim.js _feetClip), a beat's channels do not run on into the next beat (completeBeat), and
// the blade-driven arm stays whole as the blade goes over the vertical (bladeArm on the keyed angles).
// The bounds are a third above what the moves measure (in the comments) and well under what `main`
// did (hand 0.38 - 0.63 m a frame, 3.6 - 6.2 m of sliding in a string).
async function scenarioMotion() {
  out('\n== scenario MOTION (the sword hand has no teleport; the feet step and hold; a beat owns its channels; the arm over the vertical) ==');
  const { P } = await imp('src/entities/player/anim.js');
  const POSES = await imp('src/entities/enemies/ashDisciple/poses.js');
  const { realise, MOVES, MOVE_NAMES } = await imp('src/entities/enemies/ashDisciple/moves.js');
  const G = build();
  duel(G, { dist: 2.6 });
  const { game } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  d.phase = 3;
  const inv = new THREE.Matrix4(), v = new THREE.Vector3();
  const at = (o, x = 0, y = 0, z = 0) => v.set(x, y, z).applyMatrix4(o.matrixWorld).clone();
  const measure = (name) => {
    settle(G, 8);
    place(G, 2.6);
    run(G, 1.0, () => place(G, 2.6));
    if (!d.debug.trigger(name)) return null;
    let hand = 0, prev = null;
    const slide = [0, 0], lo = [9, 9], hi = [0, 0], an = [];
    for (let i = 0; i < 900; i++) {
      G.tick(DT);
      p.debug.heal();
      const a = d.brain.act;
      if (!a || a.name !== name) break;
      const R = d.rig;
      R.root.updateMatrixWorld(true);
      inv.copy(R.root.matrixWorld).invert();
      const w = at(R.arms.R.fore, 0, -0.26, 0).applyMatrix4(inv);
      if (prev) hand = Math.max(hand, w.distanceTo(prev));
      prev = w;
      // the feet where they are DRAWN (the planner's own frame: the root's spot and facing, his drawn size)
      const c = d.anim.cur, HS = d.anim.drawScale, cy = Math.cos(d.yaw), sy = Math.sin(d.yaw);
      const foot = (i) => new THREE.Vector3(d.position.x + HS * (c[i] * cy + c[i + 2] * sy), c[i + 1], d.position.z + HS * (-c[i] * sy + c[i + 2] * cy));
      // (a dash carries him faster than the feet are asked to hold, a leap has him off the ground: those
      // frames are the clip's own)
      an.push([foot(P.rF), foot(P.lF), Math.hypot(d.pilot.groundVel.x, d.pilot.groundVel.z) > 9 || d.position.y > 0.03]);
    }
    for (const f of an) for (let k = 0; k < 2; k++) { lo[k] = Math.min(lo[k], f[k].y); hi[k] = Math.max(hi[k], f[k].y); }
    for (let i = 1; i < an.length; i++) for (let k = 0; k < 2; k++) {
      const a = an[i][k], b = an[i - 1][k];
      if (!an[i][2] && !an[i - 1][2] && a.y < lo[k] + 0.02 && b.y < lo[k] + 0.02) slide[k] += Math.hypot(a.x - b.x, a.z - b.z);
    }
    return { hand, slide: slide[0] + slide[1], lift: Math.max(hi[0] - lo[0], hi[1] - lo[1]), frames: an.length };
  };
  // 1. on the rig: three strings (two cuts and a thrust; seven blows with an overhead; two whirls and a leap)
  for (const [name, maxHand, maxSlide] of [['swallow', 0.3, 1.0], ['ashRain', 0.42, 1.0], ['crane', 0.45, 1.0]]) {
    const m = measure(name);
    assert(!!m && m.frames > 40, `${name} ran (${m?.frames} frames)`);
    if (!m) continue;
    assert(m.hand <= maxHand, `${name}: the sword hand moves at most ${maxHand} m in a frame, in his own frame (${m.hand.toFixed(3)} m)`);
    assert(m.slide <= maxSlide, `${name}: outside a dash or a leap, the feet on the ground slide ${maxSlide} m at most over the whole string (${m.slide.toFixed(2)} m)`);
    assert(m.lift >= 0.05, `${name}: a foot leaves the ground to step (${m.lift.toFixed(3)} m)`);
  }
  // 2. the data: every move in every phase: a follow-through lasts at least the active frames, 0.3 s at
  //    most, and is over before the next beat's first pose
  {
    let n = 0;
    const bad = [];
    for (const name of MOVE_NAMES) {
      for (let ph = Math.max(1, MOVES[name].phase ?? 1); ph <= 3; ph++) {
        for (const r of [0.001, 0.999]) {
          const a = realise(name, ph, () => r);
          if (!a) continue;
          a.beats.forEach((b, i) => {
            n++;
            const nb = a.beats[i + 1];
            if (!(b.F >= b.A - 1e-9 && b.F <= 0.3 + 1e-9)) bad.push(`${name}/${ph} beat ${i}: F ${b.F}`);
            if (nb && !(b.impact + b.F <= nb.impact + 1e-9)) bad.push(`${name}/${ph} beat ${i}: its follow-through runs past the next impact`);
          });
          if (!a.clip.steps) bad.push(`${name}: the clip does not ask for stepping feet`);
        }
      }
    }
    assert(n > 200 && !bad.length, `every beat's follow-through: A <= F <= 0.3 s, over before the next impact; every move's clip steps (${n} beats; ${bad.slice(0, 4).join(' | ')})`);
  }
  // 3. a beat owns its channels: Rain of Ashes' fourth blow is a two-handed overhead; at the next
  //    cut's impact the left hand is off the hilt again and the head no longer holds the chop's set
  //    (the engine's rule, read on the overhead as authored: ADR-250's form, `?ashForm`, cuts it one-handed)
  {
    const { setLook: setLookM, lookOf: lookOfM } = await imp('src/entities/enemies/duelist/lookSwitch.js');
    const form0 = lookOfM('ashForm', '0');
    setLookM('ashForm', '0');
    const a0 = realise('ashRain', 1, () => 0.5);
    setLookM('ashForm', /ashForm=/.test(process.env.GCD_LOOKS ?? '') ? form0 : null);
    const pose = new Float32Array(64);
    POSES.evalClip(pose, a0.clip, a0.beats[3].impact, null);
    const twoAt = pose[P.twoHand], bowAt = pose[P.hdX];
    POSES.evalClip(pose, a0.clip, a0.beats[4].impact, null);
    assert(twoAt > 0.9 && pose[P.twoHand] < 0.05, `two hands on the hilt in the overhead, one in the cut after it (${twoAt.toFixed(2)} -> ${pose[P.twoHand].toFixed(2)})`);
    assert(bowAt < -0.1 && pose[P.hdX] > -0.03, `the head's set in the chop (a channel no cut keys) is back at the guard's in the cut after it (${bowAt.toFixed(2)} -> ${pose[P.hdX].toFixed(2)})`);
    // 4. the clip itself, stepped at 120 Hz: no channel of the sword hand's target jumps (the blade-driven
    //    arm over the vertical, the hand-off between a keyed hand and a driven one), as he plays it
    const a = realise('ashRain', 1, () => 0.5);
    let worst = 0, when = 0;
    const last = [0, 0, 0];
    for (let t = 0; t <= a.end; t += 1 / 120) {
      POSES.evalClip(pose, a.clip, t, null);
      if (t > 0) {
        const dd = Math.hypot(pose[P.rH] - last[0], pose[P.rH + 1] - last[1], pose[P.rH + 2] - last[2]);
        if (dd > worst) { worst = dd; when = t; }
      }
      last[0] = pose[P.rH];
      last[1] = pose[P.rH + 1];
      last[2] = pose[P.rH + 2];
    }
    assert(worst < 0.14, `Rain of Ashes: the sword hand's target moves less than 0.14 m in 1/120 s through the whole clip (${worst.toFixed(3)} m at ${when.toFixed(2)} s)`);
  }
  return G;
}

async function scenarioReact() {
  // (the reaction layer measured over the poses it was tuned on: ADR-226's held raised blade under a heavy
  // thrust jumps 0.077 m in a frame, an open item of that ADR)
  const { setLook: setLookR } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  setLookR('ashMotion', '0');
  setLookR('ashForm', '0'); // (likewise ADR-250's form: his windup poses as the layer was tuned on)
  out('\n== scenario REACT (the body answers where it was hit: drawn only, from the hit\'s own tick, back at rest) ==');
  const { IMPACT } = await imp('src/combat/impact.js');
  const { REACT } = await imp('src/entities/enemies/duelist/reactTuning.js');
  const on0 = IMPACT.on.react, k0 = IMPACT.k.react;
  // the piece's bounds are for strength 1 (the owner's pick draws a human boss's at x1.5)
  const byDuel0 = IMPACT.by.react.duelist;
  IMPACT.by.react.duelist = 1;
  // name, part, the contact in his root frame (x his left, y up, z the way he faces; upright m), the
  // blade's travel (root frame), heavy, a thrust (the hero's attack: a point)
  const CASES = [
    { name: 'head, a cut toward his left', part: 'head', at: [0.05, 1.56, 0.12], cut: [1, -0.25], heavy: false },
    { name: 'body, his right side', part: 'body', at: [-0.19, 1.2, 0.14], cut: [1, -0.35], heavy: false },
    { name: 'body, his left side, heavy', part: 'body', at: [0.19, 1.2, 0.14], cut: [-1, -0.35], heavy: true },
    { name: 'leg, his left', part: 'leg', at: [0.12, 0.34, 0.1], cut: [-1, -0.3], heavy: false },
    { name: 'a thrust at the belly, heavy', part: 'body', at: [0.02, 1.0, 0.2], cut: [0, -1], heavy: true, thrust: true },
  ];
  const v = new THREE.Vector3();
  const sequence = (react) => {
    IMPACT.on.react = react;
    IMPACT.k.react = 1;
    const G = build();
    duel(G, { dist: 2.4 });
    const { game } = G;
    const d = game.dragon, p = game.player, r = d.rig;
    p.debug.god = true;
    const res = [];
    // his root frame <-> the world
    const toW = (x, z) => [x * Math.cos(d.yaw) + z * Math.sin(d.yaw), -x * Math.sin(d.yaw) + z * Math.cos(d.yaw)];
    const toL = (x, z) => [x * Math.cos(d.yaw) - z * Math.sin(d.yaw), x * Math.sin(d.yaw) + z * Math.cos(d.yaw)];
    // the points read: the top of his head, his shoulders, his hips, his thighs (the hip joints), his feet
    const PTS = [[r.head, 0, 0.25, 0], [r.arms.R.upper, 0, 0, 0], [r.arms.L.upper, 0, 0, 0], [r.pelvis, 0, 0, 0], [r.legs.R.thigh, 0, 0, 0], [r.legs.L.thigh, 0, 0, 0], [r.legs.R.foot, 0, 0, 0], [r.legs.L.foot, 0, 0, 0]];
    const read = () => PTS.map(([j, x, y, z]) => { j.updateWorldMatrix(true, false); return v.set(x, y, z).applyMatrix4(j.matrixWorld).clone(); });
    // the layer's offsets now (root frame, drawn m): as drawn, then the plain pose (the layer taken off)
    const offsets = () => {
      const a = read();
      d.hitReact.restore();
      d.object3d.updateMatrixWorld(true);
      const b = read();
      return a.map((q, i) => { const [lx, lz] = toL(q.x - b[i].x, q.z - b[i].z); return [lx, q.y - b[i].y, lz]; });
    };
    for (const C of CASES) {
      home(G);
      place(G, 2.2);
      settle(G);
      d.debug.trigger('fallingAsh');
      const A = d.brain.act;
      run(G, A.beats[0].impact - 0.25);
      game.hitstopTimer = 0;
      const [wx, wz] = toW(C.at[0], C.at[2]), [cx, cz] = toW(C.cut[0], C.cut[1]), [fx, fz] = toW(0, -1);
      const pt = v.set(d.position.x + wx, C.at[1], d.position.z + wz);
      d.drawnPoint(pt);
      // (the hero's attack that landed it: a point for the thrust)
      const atk = p.atk ?? (p.atk = {});
      const def0 = atk.def;
      atk.def = C.thrust ? { contact: 'point', kind: 'light' } : { contact: 'light', kind: 'light' };
      const x0 = d.position.x, z0 = d.position.z, t0 = A.t;
      const dealt = d.takeHit({ damage: 20, part: C.part, point: { x: pt.x, y: pt.y, z: pt.z }, dir: { x: fx, z: fz }, cut: { x: cx, z: cz }, heavy: C.heavy, poise: C.heavy ? 30 : 10, swing: true, exact: true, posture: 1 });
      atk.def = def0;
      const rec = { name: C.name, dealt, stop: game.hitstopTimer, shove: Math.hypot(d.position.x - x0, d.position.z - z0), jolt: d.jolt, act: d.brain.act === A, last: d.hitReact.last };
      // the hit's own tick (the frame the freeze holds)
      G.tick(DT);
      rec.turned = d.hitReact.turned;
      rec.first = react ? offsets() : null;
      // then frame by frame until he is back at rest: the largest jump of an offset between two frames
      let jump = 0, prev = rec.first, frames = 0, finite = true;
      const trace = [];
      for (let i = 0; i < 90; i++) {
        G.tick(DT);
        trace.push([d.brain.act?.t ?? -1, d.mode, d.position.x, d.position.z, d.jolt, d.posture, ...d.hurtSpheres.flatMap((h) => [h.x, h.y, h.z])].map((q) => (typeof q === 'number' ? +q.toFixed(9) : q)).join(','));
        if (react && d.hitReact.active) {
          const o = offsets();
          frames = i + 1;
          for (let k = 0; k < o.length; k++) {
            if (!o[k].every(Number.isFinite)) finite = false;
            jump = Math.max(jump, Math.hypot(o[k][0] - prev[k][0], o[k][1] - prev[k][1], o[k][2] - prev[k][2]));
          }
          prev = o;
        }
      }
      rec.jump = jump;
      rec.frames = frames;
      rec.finite = finite;
      rec.rest = !d.hitReact.active && !d.hitReact.turned;
      rec.clock = A.t - t0; // his move's clock over the hit and the 90 frames (or the next move's)
      rec.trace = trace.join('|');
      res.push(rec);
      settle(G);
    }
    return { res, hits: G.hits.map((h) => `${h.t.toFixed(6)}:${h.r}:${h.attack}`).join(' ') };
  };
  const ON = sequence(true), OFF = sequence(false);
  IMPACT.on.react = on0;
  IMPACT.k.react = k0;
  const dir = (o, i, axis) => o[i][axis];
  for (let n = 0; n < CASES.length; n++) {
    const a = ON.res[n], b = OFF.res[n], C = CASES[n], o = a.first;
    out(`  ${C.name}: ${a.last?.part} side ${a.last?.side} K ${a.last?.K?.toFixed(2)}; head ${o[0].map((q) => q.toFixed(3))} shoulders R ${o[1].map((q) => q.toFixed(3))} L ${o[2].map((q) => q.toFixed(3))} hips ${o[3].map((q) => q.toFixed(3))}; jump ${a.jump.toFixed(3)} m, ${a.frames} frames`);
    assert(a.dealt > 0 && a.turned && a.last?.part === C.part, `${C.name}: the layer turns his joints in the hit's own tick (read as '${a.last?.part}')`);
    if (C.part === 'head') assert(dir(o, 0, 0) > 0.015 && Math.abs(dir(o, 0, 0)) > Math.abs(dir(o, 3, 0)) * 2, `${C.name}: the head snaps along the blade (to his left ${dir(o, 0, 0).toFixed(3)} m), the hips barely move`);
    if (C.part === 'body' && !C.thrust) {
      const s = Math.sign(C.at[0]), struck = s > 0 ? 2 : 1, other = s > 0 ? 1 : 2;
      assert(dir(o, struck, 2) < -0.005 && dir(o, other, 2) > 0.005, `${C.name}: the struck shoulder goes back (${dir(o, struck, 2).toFixed(3)} m), the other comes round (${dir(o, other, 2).toFixed(3)} m)`);
    }
    if (C.part === 'leg') {
      const feet = Math.max(Math.hypot(...o[6]), Math.hypot(...o[7]));
      assert(dir(o, 3, 1) < -0.01 && dir(o, 5, 1) < dir(o, 4, 1) - 0.004 && feet < 0.01, `${C.name}: he drops (${dir(o, 3, 1).toFixed(3)} m) on the struck side (hip L ${dir(o, 5, 1).toFixed(3)} vs R ${dir(o, 4, 1).toFixed(3)}), his feet stay put (${feet.toFixed(4)} m)`);
    }
    if (C.thrust) assert(dir(o, 3, 2) < -0.01 && dir(o, 0, 2) - dir(o, 3, 2) > 0.01, `${C.name}: he folds round the point: hips back (${dir(o, 3, 2).toFixed(3)} m), the head over them (${(dir(o, 0, 2) - dir(o, 3, 2)).toFixed(3)} m)`);
    // (the freeze holds the snap: the struck part stays on the drawn cut)
    const snap = Math.max(...o.slice(0, 6).map((q) => Math.hypot(...q)));
    assert(snap < REACT.snapM * 1.6 + 0.02, `${C.name}: in the freeze frame no point moved more than ${(REACT.snapM * 1.6 + 0.02).toFixed(2)} m (${snap.toFixed(3)} m)`);
    const lim = REACT.rise + REACT.heavyBack + REACT.hipLag + 0.15;
    assert(a.rest && a.frames * DT < lim + 0.25 && a.finite, `${C.name}: back at rest in ${(a.frames * DT).toFixed(2)} s (< ${(lim + 0.25).toFixed(2)} s; the freeze holds game time), finite throughout`);
    assert(a.jump < 0.06, `${C.name}: after the snap no point of him jumps more than 0.06 m between two frames (${a.jump.toFixed(3)} m)`);
    // drawn only: the hit stun, the shove, the jolt, his move and its clock, his hurt spheres frame by frame
    assert(a.stop === b.stop && a.shove === b.shove && a.jolt === b.jolt && a.act === b.act && a.clock === b.clock && a.trace === b.trace,
      `${C.name}: off and on alike in play: freeze ${a.stop.toFixed(3)} s, shove ${a.shove.toFixed(3)} m, his move's clock and every hurt sphere for 1.5 s`);
    assert(!b.turned && b.rest && b.last === null && b.first === null, `${C.name}: off: nothing turned (today's jolt only)`);
  }
  assert(ON.hits === OFF.hits, `his blows on the hero land alike with the layer on and off (${ON.hits.split(' ').filter(Boolean).length} results)`);
  // a guarded strike gets none of it
  {
    IMPACT.on.react = true;
    const G = build();
    duel(G, { dist: 2.4 });
    const d = G.game.dragon;
    G.game.player.debug.god = true;
    settle(G);
    const guarded = d.guarding;
    const r = guarded ? d.takeHit({ damage: 20, part: 'body', point: { x: d.position.x, y: 1.4, z: d.position.z }, swing: true, cut: { x: 1, z: 0 } }) : -1;
    G.tick(DT);
    assert(!guarded || (r === 0 && !d.hitReact.active), `a strike his guard turns gets no reaction (${guarded ? `guarded, ${r} damage` : 'his guard was down: not checked'})`);
    IMPACT.on.react = on0;
  }
  IMPACT.by.react.duelist = byDuel0;
  setLookR('ashMotion', null);
  setLookR('ashForm', null);
  return { counts: {}, payload: new Set() };
}

// ================================================================== scenario: sfx
async function scenarioSfx() {
  out('\n== scenario SFX (the attack sounds: one blow through the air per real blow, before its impact; cues only on blue / red; ?sfx=old) ==');
  const SMP = await imp('src/audio/samples.js');
  SMP.setSfxMode('new'); // (the sound passes are off by default, ADR-176: this scenario tests them)
  const { ATTACK_SOUND, beatSound } = await imp('src/entities/enemies/duelist/attackSound.js');
  // every boss's data: the weapon its TUNING declares, every blow classified (or left out: a cast, a pure throw, a burst)
  const BOSSES = [
    ['ashDisciple', 'sword'], ['starlessLord', 'sword'], ['sheathed', 'sword'], ['ascendant', 'fist'], ['thousandFox', 'fist'],
  ];
  for (const [dir, weapon] of BOSSES) {
    const { MOVES: MV } = await imp(`src/entities/enemies/${dir}/moves.js`);
    const { TUNING: T } = await imp(`src/entities/enemies/${dir}/tuning.js`);
    const seen = { cut: 0, thrust: 0, kick: 0, draw: 0, light: 0, heavy: 0, none: 0 };
    let wrong = 0;
    for (const mv of Object.values(MV)) for (const raw of mv.beats) for (const b of raw.pick ?? [raw]) {
      if (b.feint) continue;
      const s = beatSound(T.weapon, b);
      if (!s) { seen.none++; continue; }
      if (s.weapon !== weapon) wrong++;
      seen[s.shape]++;
      seen[s.weight]++;
      // (a beat that only throws or casts, or a burst, has no blow of its own)
      if (b.cast || b.burst || (b.release && !b.zone)) wrong++;
    }
    assert(T.weapon === weapon && !wrong && seen.light + seen.heavy > 0,
      `${dir}: TUNING.weapon '${T.weapon}', every blow ${weapon} (${JSON.stringify(seen)})`);
  }
  {
    const z = { kind: 'sector', r: 2 };
    const c = (def) => { const s = beatSound('sword', def); return s && `${s.weight}/${s.shape}`; };
    const f = (def) => { const s = beatSound('fist', def); return s && `${s.weight}/${s.shape}`; };
    const checks = [
      [c({ tell: 'normal', damage: 12, zone: z }), 'light/cut'],
      [c({ tell: 'normal', damage: 12, zone: { kind: 'line', r: 3 } }), 'light/thrust'],
      [c({ tell: 'blue', damage: ATTACK_SOUND.heavyDamage, zone: z }), 'heavy/cut'],
      [c({ tell: 'black', damage: 1, zone: z }), 'heavy/cut'],
      [c({ tell: 'red', damage: 1, knockdown: true, zone: { kind: 'ring', r: 3 }, part: 'feet' }), 'heavy/cut'],
      [c({ tell: 'red', damage: 1, zone: z, part: 'feet' }), 'light/kick'],
      [c({ tell: 'blue', damage: 110, zone: { kind: 'line', r: 9 }, draw: true, selfHit: true }), 'heavy/draw'],
      [f({ tell: 'normal', damage: 9, zone: z, part: 'fistR' }), 'light/cut'],
      [f({ tell: 'normal', damage: 9, zone: z, part: 'kneeR' }), 'light/kick'],
      [c({ tell: 'normal', damage: 9, zone: z, whoosh: { shape: 'thrust', weight: 'heavy' } }), 'heavy/thrust'],
      [c({ tell: 'normal', damage: 9, zone: z, whoosh: false }), null],
      [c({ tell: 'normal', damage: 9, zone: z, cast: { kind: 'x' } }), null],
      [f({ tell: 'red', damage: 20, zone: { kind: 'ring', r: 4 }, part: 'feet', burst: true }), null],
      [c({ tell: 'red', damage: 20, zone: { kind: 'line', r: 4 }, selfHit: true }), null],
    ];
    const bad = checks.filter(([g, w]) => g !== w).map(([g, w]) => `${g} != ${w}`);
    assert(!bad.length, `beatSound derives weight / shape from the beat's data, overrides and exclusions ${JSON.stringify(bad)}`);
  }

  const G = build();
  duel(G, { dist: 3 });
  const { game } = G;
  const d = game.dragon, p = game.player;
  p.debug.god = true;
  const sounds = [];
  const play0 = game.audio.play;
  game.audio.play = function (name, o) { sounds.push([name, o?.delay]); return play0.call(this, name, o); };
  if (!game.audio.ctx) game.audio.unlock();
  assert(game.audio.ctx && !game.audio.samples?.loaded, 'audio unlocked, no recorded file loaded headless (every sound is its synth fallback)');
  const probe = (name) => {
    const def = MOVES[name];
    settle(G);
    d.yaw = 0;
    d.position.set(0, 0, -2);
    place(G, (def.band[0] + Math.min(def.band[1], 9)) / 2);
    run(G, 0.1);
    const ev = { atk: [], flash: [], tell: [], hits: [], sounds: [] };
    const s0 = sounds.length;
    G.watch = (n, e) => {
      if (n === 'dragon:attack' && e?.name === name) ev.atk.push({ ...e, t: game.time });
      else if (n === 'combat:flash' && e?.attack === name) ev.flash.push({ tell: e.tell, t: game.time });
      else if (n === 'combat:tell' && e?.attack === name) ev.tell.push(e.tell);
    };
    const h0 = G.hits.length;
    const ok = d.debug.trigger(name);
    run(G, 9, (GG) => { GG.game.mouseGround.set(d.position.x, 0, d.position.z); }, () => d.mode === 'foot' && !d.fx.crescentsAlive);
    G.watch = null;
    ev.hits = G.hits.slice(h0).filter((h) => h.attack === name).map((h) => h.t);
    ev.sounds = sounds.slice(s0);
    ev.ok = ok;
    return ev;
  };
  const n = (ev, s) => ev.sounds.filter(([x]) => x === s).length;
  const lead = ATTACK_SOUND.lead;
  try {
    for (const name of ['plumThrust', 'fallingAsh', 'lotus', 'glideKick', 'mirrorFeint']) {
      const ev = probe(name);
      const beats = MOVES[name].beats.flatMap((b) => b.pick ?? [b]);
      const feints = beats.filter((b) => b.feint).length;
      const payOk = ev.atk.every((e) => e.weapon === 'sword' && (e.weight === 'light' || e.weight === 'heavy')
        && ['cut', 'thrust', 'kick', 'draw'].includes(e.shape) && e.impactIn > 0 && e.impactIn <= lead + 0.02 && Number.isFinite(e.x + e.z));
      // each contact has its blow's sound before it (lead s at most, never after)
      const before = ev.hits.every((t) => ev.atk.some((e) => e.t <= t + 1e-6 && t - e.t <= lead + DT * 2));
      const blue = ev.tell.filter((t) => t === 'blue').length, red = ev.tell.filter((t) => t === 'red' || t === 'black').length;
      const loud = ev.flash.filter((f) => f.tell !== 'normal').length;
      out(`     ${name.padEnd(12)} ${ev.atk.length} blows (${ev.atk.map((e) => `${e.weight}/${e.shape}`).join(' ')}), ${ev.flash.length} flashes, ${ev.hits.length} contacts, feints ${feints}; plays: tellTick ${n(ev, 'tellTick')} tellBlue ${n(ev, 'tellBlue')} tellRed ${n(ev, 'tellRed')} flash ${n(ev, 'flash')} bladeWhoosh ${n(ev, 'bladeWhoosh')}`);
      assert(ev.ok && ev.atk.length === ev.flash.length && ev.atk.length > 0 && payOk && before,
        `${name}: one dragon:attack per glinted blow (${ev.atk.length} / ${ev.flash.length}; a feint none), sword, impactIn within ${lead} s, before each contact`);
      assert(n(ev, 'tellTick') === 0 && n(ev, 'flash') === loud && n(ev, 'tellBlue') === blue && n(ev, 'tellRed') === red,
        `${name}: cues only on blue / red (tellTick 0, flash ${n(ev, 'flash')} = ${loud} blue/red flashes, tellBlue ${blue}, tellRed ${red})`);
      const wh = ev.sounds.filter(([x]) => x === 'bladeWhoosh');
      assert(wh.length >= 1 && wh.length <= ev.atk.length && wh.every(([, dl]) => Number.isFinite(dl) && dl >= 0 && dl < lead),
        `${name}: the blade through the air plays (synth fallback, ${wh.length}), started to peak on the impact (delays ${wh.map(([, dl]) => dl?.toFixed(2)).join(' ')} s)`);
    }
    // ?sfx=old: the tick on a normal tell, the ping on a normal flash, no blade sound
    SMP.setSfxMode('old');
    const ev = probe('plumThrust');
    assert(n(ev, 'tellTick') >= 1 && n(ev, 'flash') >= 1 && n(ev, 'bladeWhoosh') === 0,
      `?sfx=old: today's sounds (tellTick ${n(ev, 'tellTick')}, flash ${n(ev, 'flash')}, bladeWhoosh ${n(ev, 'bladeWhoosh')})`);
  } finally {
    SMP.setSfxMode('new');
    game.audio.play = play0;
  }

  // the combat core against a duelist (round 2): his cloth keeps the synth hit, the blade's bite, his guard,
  // the clash and the parry are recorded when loaded; the synth until then and with ?sfx=old
  {
    const A = game.audio, ctx = A.ctx, ev = game.events;
    const { SAMPLE_FILES } = await imp('src/audio/sampleFiles.js');
    const slots = ['parry', 'parry-blue', 'cut-light', 'clash', 'boss-guard', 'hit-scale'];
    const keep = {};
    const heard = [];
    const took = [];
    const p0 = A.play, s0 = A._sample;
    A.play = function (n, o) { heard.push(n); return p0.call(this, n, o); };
    A._sample = function (slot, ...a) { const ok = s0.call(this, slot, ...a); if (ok) took.push(slot); return ok; };
    const fire = (n, d) => { heard.length = 0; took.length = 0; ctx.currentTime += 0.5; ev.emit(n, d); return `${took.join('+')}|${heard.join('+')}`; };
    const HIT = { damage: 20, part: 'body', point: { x: 1, y: 1, z: 1 }, heavy: false, crit: false, kind: 'light', guarded: false, combo: 1, weight: 'light', shards: false };
    const run = () => [
      fire('player:hitDragon', HIT),
      fire('dragon:guard', { heavy: true, deflect: false, caught: false }),
      fire('dragon:guard', { heavy: false, deflect: true, caught: false }),
      fire('combat:clash', { heavy: false, crush: false, counter: false, x: 0, y: 1, z: 0 }),
      fire('player:parry', { tell: 'blue', attack: 'x', chain: 2, light: false, perfect: false, last: true, flare: false }),
    ];
    try {
      const none = run();
      assert(JSON.stringify(none) === JSON.stringify(['|hit+cut', '|guard', '|deflected', '|trade', '|parry']), `no file: a duelist's hit, guard, deflect, clash and parry play their synth (${none.join(' ')})`);
      for (const s of slots) {
        keep[s] = SAMPLE_FILES[s];
        SAMPLE_FILES[s] = [{ file: `${s}-1.mp3`, peak_ms: 20 }];
        A.samples.recs.set(`${s}-1.mp3`, { buf: ctx.createBuffer(1, 4410, 44100), off: 0, peak: 0.02 });
      }
      A.samples.loaded = slots.length;
      const got = run();
      assert(JSON.stringify(got) === JSON.stringify(['cut-light|hit', 'boss-guard|', '|deflected', 'clash|', 'parry-blue|']),
        `loaded: a duelist's cloth keeps the synth hit (the blade's bite recorded), his guard boss-guard, his deflect the synth, the clash and the parry recorded (${got.join(' ')})`);
      SMP.setSfxMode('old');
      const old = run();
      assert(JSON.stringify(old) === JSON.stringify(none), `?sfx=old with the files loaded: the synth as before (${old.join(' ')})`);
    } finally {
      SMP.setSfxMode(SMP.DEFAULT_SFX);
      A.play = p0;
      A._sample = s0;
      for (const [s, l] of Object.entries(keep)) { if (l === undefined) delete SAMPLE_FILES[s]; else SAMPLE_FILES[s] = l; }
      A.samples.recs.clear();
      A.samples.last.clear();
      A.samples.loaded = 0;
    }
  }
  return G;
}

/**
 * SWORDMOTION (ADR-226): the sword motion pass behind `?ashMotion=a`. On: his sword held in line with his
 * forearm (the audit's wrist ≤ 62° in every frame of the moves below, the hero's bar 60), the blade
 * clear of his head and body, the arms opening at the end of a blow (an elbow past 148°); each blue / red
 * blade blow holds its tell pose (the point still within 8 cm through the hold); the windups, impacts and
 * ends of every move exactly as with the switch off (only poses change); the quick blows' windup
 * TUNING.minQuickWindup and picked only while it is on. Off: as before.
 */
async function scenarioSwordMotion() {
  out('\n== scenario SWORDMOTION (the sword motion pass, ADR-226: the grip, the held tell poses, the quick blows; on and off) ==');
  const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  setLook('ashMotion', 'a');
  let last = null;
  const H = { THREE, build: (...a) => (last = build(...a)), duel: (G, o) => duel(G, o), run, DT, MOVES, names: ['plumThrust', 'fallingAsh', 'piercingAsh', 'swallow', 'crane', 'lotus', 'needleDart', 'wristFlick'], formOf: () => 1, setForm: null };
  const rows = swordAudit(H);
  printAudit(rows, out);
  const ok = rows.filter((r) => !r.fail);
  assert(ok.length === H.names.length, `${ok.length} of ${H.names.length} moves audited`);
  const wr = Math.max(...ok.map((r) => r.wrist.max)), gh = Math.min(...ok.map((r) => r.gap.head)), gb = Math.min(...ok.map((r) => r.gap.body)), el = Math.min(...ok.map((r) => r.elbow[1]));
  assert(wr <= 62, `the sword in line with the forearm: the wrist at most ${wr}° (≤ 62; the hero ≤ 60; before the pass 85 - 128)`);
  assert(gh >= 0.08 && gb >= 0.08, `the blade clear of him: ${gh.toFixed(2)} m from his head, ${gb.toFixed(2)} m from his body at the closest (≥ 0.08)`);
  assert(el >= 148, `every move opens the arm: the widest elbow at least ${el}° (≥ 148; before 131 - 145)`);
  // (ADR-250's form, `?ashForm`, ends the overhead's hold at 0.7 of the windup: read the hold to there)
  const { lookOf: lookOfS } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const u1 = lookOfS('ashForm', '0') !== '0' ? { u1: 0.68 } : {};
  const held = [['fallingAsh', 1], ['lotus', 1]].map(([n, f]) => [n, heldTip(H, n, { form: f, ...u1 })]);
  assert(held.every(([, h]) => !h.fail && h.n >= 6 && h.far < 0.08), `the tell pose is held: the point wanders ${held.map(([n, h]) => `${n} (${h.tell}) ${h.far?.toFixed(3)} m over ${h.n} frames`).join(', ')} (< 0.08)`);
  // the timings: only poses change
  let same = 0, diff = [];
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    if (def.motionOnly) continue;
    for (const ph of [1, 2, 3]) {
      if ((def.phase ?? 1) > ph) continue;
      setLook('ashMotion', 'a');
      const a = realise(name, ph, () => 0.37);
      setLook('ashMotion', '0');
      const b = realise(name, ph, () => 0.37);
      if (!a || !b) continue;
      const k = (A) => A.beats.map((x) => `${x.start.toFixed(4)}/${x.impact.toFixed(4)}/${x.end.toFixed(4)}`).join(' ') + ` ${A.end.toFixed(4)}`;
      if (k(a) === k(b)) same++;
      else diff.push(`${name} P${ph}`);
    }
  }
  assert(!diff.length && same > 40, `${same} realisations time every beat the same on and off (${diff.join(', ') || 'none differ'})`);
  // the quick blows
  const quick = MOVE_NAMES.filter((n) => MOVES[n].motionOnly);
  const G = last ?? build();
  const d = G.game.dragon;
  setLook('ashMotion', '0');
  const off = quick.map((n) => d.weigh(n, MOVES[n], 1, 2));
  setLook('ashMotion', 'a');
  const on = quick.map((n) => d.weigh(n, MOVES[n], 1, 2));
  const fast = quick.every((n) => MOVES[n].beats.every((b) => b.quick && b.fixed && b.tell === TELL.NORMAL && b.windup === TUNING.minQuickWindup));
  assert(quick.length >= 2 && fast && off.every((w) => w === 0) && on.every((w) => w > 0), `${quick.length} quick blows (${quick.join(', ')}): normal, ${TUNING.minQuickWindup} s windups; weighed 0 with the switch off, ${on.join(' / ')} on`);
  setLook('ashMotion', null);
  return last;
}
/**
 * ASHFORM (ADR-250): his form behind `?ashForm=a`, measured at each blow's impact (swordAudit.mjs, the impact
 * table). On: a thrust lands on an open arm (elbow ≥ 150°) with the point on the arm's line (≤ 8°), out of a
 * lunge (the front knee ≤ 125°, the back ≥ 140°); an overhead cuts on a diagonal (the point's path ≤ 66° off
 * level; before 75 - 81); the front foot is down at every cut's impact in a string; the free hand never flies
 * (≤ 12 m/s; before 17 - 19); a low sweep's legs never cross. The windups, impacts and ends of every move as with
 * it off (only poses change). Ember Whirl's and Heaven-Splitting Fall's looks (`?whirlFx` / `?fallFx`, every
 * option) cost the fire field less than 300 blobs more than they do today, and finite throughout.
 */
async function scenarioAshForm() {
  out('\n== scenario ASHFORM (his form, ADR-250: the thrust on the arm, the lunge, the diagonal overhead, the step, the sweep; the specials\' looks) ==');
  const { setLook, lookOf: lookOfF } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const keep = lookOfF('ashForm', '0');
  setLook('ashForm', 'a');
  let last = null;
  const H = { THREE, build: (...a) => (last = build(...a)), duel: (G, o) => duel(G, o), run, DT, MOVES, names: ['plumThrust', 'piercingAsh', 'fallingAsh', 'ashRain', 'crane', 'lotus'], formOf: () => 1, setForm: null };
  const rows = swordAudit(H);
  printImpacts(rows, out);
  const ok = rows.filter((r) => !r.fail);
  assert(ok.length === H.names.length, `${ok.length} of ${H.names.length} moves audited`);
  const imps = ok.flatMap((r) => r.impacts.map((x) => ({ ...x, name: r.name })));
  const th = imps.filter((x) => x.thrust);
  assert(th.length >= 3 && th.every((x) => x.elbow >= 150 && x.armLine <= 8), `a thrust lands on an open arm, the point on its line: ${th.map((x) => `${x.name} b${x.i} ${x.elbow}° / ${x.armLine}°`).join(', ')} (≥ 150° / ≤ 8°)`);
  assert(th.every((x) => x.knR <= 125 && x.knL >= 140), `... out of a lunge: front knee / back knee ${th.map((x) => `${x.knR}/${x.knL}`).join(', ')} (≤ 125 / ≥ 140)`);
  const over = imps.filter((x) => x.bladeEl < -15 && x.tilt != null && x.tilt > 45 && !x.thrust && x.tell === TELL.BLUE);
  assert(over.length >= 3 && over.every((x) => x.tilt <= 66), `an overhead cuts on a diagonal: ${over.map((x) => `${x.name} b${x.i} ${x.tilt}°`).join(', ')} (≤ 66° off level; before 75 - 81)`);
  const rain = ok.find((r) => r.name === 'ashRain');
  const up = rain.impacts.filter((x) => !x.front.endsWith('down'));
  assert(!up.length, `the front foot down at every impact of Rain of Ashes (${up.map((x) => `b${x.i} ${x.front}`).join(', ') || 'all down'})`);
  assert(rain.free.v <= 12, `the free hand never flies through Rain of Ashes: ${rain.free.v} m/s at its fastest (≤ 12; before 17.1)`);
  const lotus = ok.find((r) => r.name === 'lotus');
  assert(lotus.feet.cross >= 0, `Lotus Sweep turns on its feet: the legs never cross (${lotus.feet.cross} m; before -0.73)`);
  // the timings: only poses change
  let same = 0;
  const diff = [];
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    for (const ph of [1, 2, 3]) {
      if ((def.phase ?? 1) > ph) continue;
      setLook('ashForm', 'a');
      const a = realise(name, ph, () => 0.37);
      setLook('ashForm', '0');
      const b = realise(name, ph, () => 0.37);
      if (!a || !b) continue;
      const k = (A) => A.beats.map((x) => `${x.start.toFixed(4)}/${x.impact.toFixed(4)}/${x.end.toFixed(4)}`).join(' ') + ` ${A.end.toFixed(4)}`;
      if (k(a) === k(b)) same++;
      else diff.push(`${name} P${ph}`);
    }
  }
  assert(!diff.length && same > 60, `${same} realisations time every beat the same on and off (${diff.join(', ') || 'none differ'})`);
  // the specials' looks: every option draws, finite, and costs the field little more than today
  setLook('ashForm', 'a');
  const peaks = [];
  for (const [move, sw] of [['emberWhirl', 'whirlFx'], ['heavenFall', 'fallFx']]) {
    const base = [];
    for (const o of ['0', 'a', 'b', 'c']) {
      setLook(sw, o);
      const G = build();
      duel(G, { dist: move === 'heavenFall' ? 6 : 2.4 });
      const { game } = G;
      const d = game.dragon, p = game.player;
      p.debug.god = true;
      d.debug.phase2();
      settle(G, 8);
      d.debug.setAI(false);
      run(G, 0.5);
      d.debug.trigger(move);
      let peak = 0, bad = false;
      run(G, 3, () => {
        p.hp = p.maxHp;
        peak = Math.max(peak, game.fx.fire.count);
        if (!Number.isFinite(d.position.x + d.position.y + d.position.z)) bad = true;
      });
      base.push(peak);
      peaks.push(`${sw}=${o} ${peak}${bad ? ' NaN' : ''}`);
      assert(!bad, `${sw}=${o}: finite throughout`);
      last = G;
    }
    assert(base.slice(1).every((x) => x - base[0] < 300), `${move}'s looks cost the field < 300 blobs over today's ${base[0]} (${base.slice(1).join(' / ')})`);
    setLook(sw, null);
  }
  out(`     blob peaks: ${peaks.join(' | ')}`);
  setLook('ashForm', /ashForm=/.test(process.env.GCD_LOOKS ?? '') ? keep : null);
  return last;
}
/** AUDIT (opt-in, ADR-226): every move's sword motion (tests/integration/swordAudit.mjs). */
async function scenarioAudit() {
  out('\n== scenario AUDIT (every move: the sword wrist, the blade off his body, facing, elbows, the free hand, feet, pops) ==');
  const only = (process.env.GCD_AUDIT ?? '').split(',').filter(Boolean);
  const names = MOVE_NAMES.filter((n) => !only.length || only.includes(n));
  let last = null;
  const rows = swordAudit({ THREE, build: (...a) => (last = build(...a)), duel: (G, o) => duel(G, o), run, DT, MOVES, names,
    formOf: (n) => Math.min(3, Math.max(1, MOVES[n].phase ?? 1)),
    setForm: (G, f) => { const d = G.game.dragon; if (f >= 2) d.debug.phase2(); if (f >= 3) { settle(G, 8); d.debug.phase3(); } settle(G, 8); d.debug.setAI(false); } });
  printAudit(rows, out);
  if (process.env.GCD_AUDIT_IMPACT) printImpacts(rows, out);
  if (process.env.GCD_AUDIT_JSON) fs.writeFileSync(process.env.GCD_AUDIT_JSON, JSON.stringify(rows, null, 1));
  return last;
}

/**
 * ASHREF (ADR-289): Shen Hui after the reference pack (docs/art/character-packs-v04/shen-hui). `?ashRefMove=a`
 * changes poses only: every move, phase, branch roll and flurry count realised with it on and off times every
 * beat the same (start, impact, end, windup, hold, active, sustain, follow-through clock, close, flash, feint,
 * last, the move's recovery and end) under the shipped switches, with ashMotion / ashForm each off, and both off;
 * the same seeded fights (phases 1 and 3) against the defender bot land the same blows at the same times; the
 * sword audit's limits hold (the sword in line with the forearm, the blade clear of his head (the hat) and body,
 * the arms opening, the thrust on the arm's line); the reaction clips follow the switch. `?ashRef=a`: the bronze
 * bracer, the two red inner panels, the ragged over-robe and hem; phase 3 still takes the hat off and burns the
 * robe pale; 3 phases of a fight, nothing NaN.
 */
async function scenarioAshRef() {
  out('\n== scenario ASHREF (ADR-289: the reference pack behind ?ashRef / ?ashRefMove: the look and the poses, never the timing) ==');
  const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const rnd = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const f4 = (x) => (Number.isFinite(x) ? x.toFixed(5) : String(x));
  const key = (A) => JSON.stringify([f4(A.end), f4(A.recoveryStart), A.hits, A.beats.map((b) => [b.index, f4(b.start), f4(b.impact), f4(b.end), f4(b.W), f4(b.H), f4(b.A), f4(b.S), f4(b.F), b.close, f4(b.flash), f4(b.tellAt), b.feint, b.last])]);
  let n = 0;
  const diff = [];
  for (const combo of [{}, { ashMotion: '0' }, { ashForm: '0' }, { ashMotion: '0', ashForm: '0' }]) {
    for (const [k, v] of Object.entries(combo)) setLook(k, v);
    for (const name of MOVE_NAMES) {
      const def = MOVES[name];
      for (const ph of [1, 2, 3]) {
        if ((def.phase ?? 1) > ph || (def.transition && ph !== def.phase)) continue;
        for (let s = 1; s <= 6; s++) {
          const opts = def.streak ? { count: 1 + s } : null;
          setLook('ashRefMove', '0');
          const a = realise(name, ph, rnd(s * 7919), opts);
          setLook('ashRefMove', 'a');
          const b = realise(name, ph, rnd(s * 7919), opts);
          if (!a || !b) continue;
          n++;
          if (key(a) !== key(b)) diff.push(`${name} P${ph} s${s}`);
        }
      }
    }
    for (const k of Object.keys(combo)) setLook(k, null);
  }
  setLook('ashRefMove', null);
  assert(!diff.length && n > 1000, `${n} realisations (47 moves, every phase, branch roll and flurry count; the shipped switches, each off and both off) time every beat the same with ?ashRefMove on and off (${diff.slice(0, 6).join(', ') || 'none differ'})`);
  // the poses do change (the layer is on): the first beat's impact key of a thrust and a cut
  setLook('ashRefMove', 'a');
  const on = realise('plumThrust', 1, rnd(3)), cut = realise('fallingAsh', 1, rnd(3));
  setLook('ashRefMove', '0');
  const off = realise('plumThrust', 1, rnd(3));
  setLook('ashRefMove', null);
  assert(on.clip.kit !== off.clip.kit && cut.clip.kit === on.clip.kit, `?ashRefMove=a compiles its clips round the reference's guard (a set of their own)`);
  // the same seeded fights, the same blows
  const fight = (refOn, phase) => {
    setLook('ashRefMove', refOn ? 'a' : '0');
    const G = build(SEED + 11 + phase);
    duel(G, { dist: 3.5, ai: true });
    const d = G.game.dragon;
    if (phase >= 2) d.debug.phase2();
    if (phase >= 3) d.debug.phase3();
    G.defend = makeDefender(G);
    const h0 = G.hits.length;
    let bad = false;
    run(G, 24, () => {
      G.defend.act();
      if (!Number.isFinite(d.position.x + d.position.z)) bad = true;
    });
    setLook('ashRefMove', null);
    return { bad, hits: G.hits.slice(h0).map((h) => `${h.t.toFixed(3)} ${h.attack} ${h.r} ${h.damage}`) };
  };
  for (const ph of [1, 3]) {
    const A = fight(false, ph), B = fight(true, ph);
    const first = A.hits.findIndex((h, i) => h !== B.hits[i]);
    assert(A.hits.length > 4 && A.hits.length === B.hits.length && first < 0 && !A.bad && !B.bad, `phase ${ph}: a seeded 24 s fight against the defender: ${A.hits.length} blows off, ${B.hits.length} on, the same times, moves and results${first >= 0 ? ` (first differs: ${A.hits[first]} / ${B.hits[first]})` : ''}; finite`);
  }
  // the sword audit with the reference's poses (the shipped switches on)
  setLook('ashRefMove', 'a');
  let last = null;
  const H = { THREE, build: (...a) => (last = build(...a)), duel: (G, o) => duel(G, o), run, DT, MOVES, names: ['plumThrust', 'fallingAsh', 'piercingAsh', 'ashRain', 'swallow', 'crane', 'lotus', 'needleDart', 'wristFlick', 'twinEmbers', 'glideKick'], formOf: () => 1, setForm: null };
  const rows = swordAudit(H);
  printAudit(rows, out);
  printImpacts(rows, out);
  const ok = rows.filter((r) => !r.fail);
  assert(ok.length === H.names.length, `${ok.length} of ${H.names.length} moves audited`);
  const wr = Math.max(...ok.map((r) => r.wrist.max)), gh = Math.min(...ok.map((r) => r.gap.head)), gb = Math.min(...ok.map((r) => r.gap.body)), el = Math.min(...ok.map((r) => r.elbow[1]));
  assert(wr <= 62, `the sword in line with the forearm with the reference's poses: the wrist at most ${wr}° (≤ 62)`);
  assert(gh >= 0.08 && gb >= 0.08, `the blade clear of him (the hat too) with the reference's poses: ${gh.toFixed(2)} m from his head, ${gb.toFixed(2)} m from his body at the closest (≥ 0.08)`);
  assert(el >= 148, `every move opens the arm: the widest elbow at least ${el}° (≥ 148)`);
  const th = ok.flatMap((r) => r.impacts.map((x) => ({ ...x, name: r.name }))).filter((x) => x.thrust);
  assert(th.length >= 3 && th.every((x) => x.elbow >= 150 && x.armLine <= 8), `a thrust lands on an open arm, the point on its line: ${th.map((x) => `${x.name} b${x.i} ${x.elbow}° / ${x.armLine}°`).join(', ')} (≥ 150° / ≤ 8°)`);
  const rain = ok.find((r) => r.name === 'ashRain');
  assert(rain.free.v <= 12, `the free hand never flies through Rain of Ashes: ${rain.free.v} m/s at its fastest (≤ 12)`);
  const lotus = ok.find((r) => r.name === 'lotus');
  assert(lotus.feet.cross >= 0, `Lotus Sweep turns on its feet: the legs never cross (${lotus.feet.cross} m)`);
  const G0 = last;
  const brain = G0.game.dragon.brain;
  const { CLIP: C0, CLIP_REF } = await imp('src/entities/enemies/ashDisciple/moves.js');
  const refC = brain.C === CLIP_REF;
  setLook('ashRefMove', '0');
  const offC = brain.C === C0;
  setLook('ashRefMove', null);
  assert(refC && offC && Object.keys(CLIP_REF).length === Object.keys(C0).length, `the reaction clips follow the switch (${Object.keys(CLIP_REF).length} clips, the reference's round its guard)`);
  // the look (the rebuild after the anchor, three builds): what each hangs on him, by material, and its cost
  const census = (opt) => {
    setLook('ashRef', opt);
    const g = build(SEED + 3);
    duel(g, { dist: 4 });
    const dd = g.game.dragon, MM = dd.rig.materials, c = { red: 0, bronze: 0, coat: 0, sash: 0, tris: 0 };
    dd.rig.root.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.geometry?.index ? o.geometry.index.count / 3 : (o.geometry?.attributes?.position?.count ?? 0) / 3;
      c.tris += n;
      if (o.material === MM.facing) c.red += n;
      if (o.material === MM.trim) c.bronze += n;
      if (o.material === MM.coat) c.coat += n;
      if (o.material === MM.piping) c.sash += n;
    });
    c.coatPanels = dd.rig.coat.length;
    setLook('ashRef', null);
    return c;
  };
  const c0 = census('0');
  for (const opt of ['a', 'b', 'c']) {
    const c1 = census(opt);
    out(`     ?ashRef=${opt}: his rig ${Math.round(c0.tris)} -> ${Math.round(c1.tris)} triangles (+${Math.round(((c1.tris - c0.tris) / c0.tris) * 100)} %); red ${Math.round(c0.red)} -> ${Math.round(c1.red)}, bronze ${Math.round(c0.bronze)} -> ${Math.round(c1.bronze)}, robe ${Math.round(c0.coat)} -> ${Math.round(c1.coat)}, sash ${Math.round(c1.sash)}, ${c1.coatPanels} skirt panels`);
    assert(c1.red > c0.red * 1.5 && c1.bronze > c0.bronze * 1.3 && c1.sash > 0 && c1.coatPanels === 8 && c1.tris - c0.tris < 0.2 * c0.tris, `?ashRef=${opt} dresses him after the anchor (the red inner robe, the bronze bracer, the cord sash, eight skirt panels) for less than 20 % more triangles than he has (+${Math.round(c1.tris - c0.tris)} on ${Math.round(c0.tris)})`);
  }
  setLook('ashRef', 'a');
  const G = build(SEED + 3);
  duel(G, { dist: 4, ai: true });
  const d = G.game.dragon;
  let hatOn1 = null, hatOn3 = null, bad = false;
  const hat = d.rig.root.userData.dress?.hideP3 ?? [];
  run(G, 3, () => { if (!Number.isFinite(d.position.x + d.position.z)) bad = true; });
  hatOn1 = hat.length > 0 && hat.every((m) => m.visible);
  d.debug.phase2();
  run(G, 3);
  d.debug.phase3();
  run(G, 4, () => { if (!Number.isFinite(d.position.x + d.position.z)) bad = true; });
  hatOn3 = hat.some((m) => m.visible);
  setLook('ashRef', null);
  for (const opt of ['b', 'c']) {
    setLook('ashRef', opt);
    const Gx = build(SEED + 5);
    duel(Gx, { dist: 4, ai: true });
    const dx = Gx.game.dragon;
    dx.debug.phase3();
    run(Gx, 4, () => { if (!Number.isFinite(dx.position.x + dx.position.z) || !Number.isFinite(dx.rig.coat[0].segs[1].rotation.x)) bad = true; });
    setLook('ashRef', null);
  }
  assert(hatOn1 && !hatOn3 && !bad, `?ashRef=a: the hat on in phase 1 (${hatOn1}) and off in phase 3 (${!hatOn3}); 10 s through three phases, nothing NaN`);
  return last;
}

const SCENARIOS = {
  ashref: scenarioAshRef,
  motion: scenarioMotion,
  react: scenarioReact,
  strategy: scenarioStrategy,
  terrain: scenarioTerrain,
  worldcue: scenarioWorldCue,
  probe: scenarioProbe,
  bots: scenarioBots,
  ranged: scenarioRanged,
  answer: scenarioAnswer,
  perfect: scenarioPerfect,
  riposteplanted: scenarioRipostePlanted,
  deathblow: scenarioDeathblow,
  flare: scenarioFlare,
  blackout: scenarioBlackout,
  fxlooks: scenarioFxLooks,
  telemetry: scenarioTelemetry,
  heavy: scenarioHeavy,
  // (the blade lock's own checks: ?dbLock=lock, the deathblow does not take the perfect blue parry from it; ADR-280)
  moments: async () => {
    const M = await imp('src/entities/player/deathblow.js'), m0 = M.dbLockMode();
    M.setDbLock('lock');
    try {
      return await scenarioMoments();
    } finally {
      M.setDbLock(m0);
    }
  },
  // (a boss-AI check, measured with the flurry before the dodge looks: the Thunder Thrust's held lunge
  // keeps the hero by him longer, and the seeded fight runs another way)
  pressure: async () => {
    const { STREAK_FX } = await imp('src/combat/streak.js');
    const fx0 = STREAK_FX.dodgefx;
    STREAK_FX.dodgefx = '';
    try {
      return await scenarioPressure();
    } finally {
      STREAK_FX.dodgefx = fx0;
    }
  },
  impact: scenarioImpact,
  levels: scenarioLevels,
  floor: scenarioFloor,
  data: scenarioData,
  moves: scenarioMoves,
  timing: scenarioTiming,
  guard: scenarioGuard,
  clash: scenarioClash,
  trade: scenarioTrade,
  flashchain: scenarioFlashChain,
  clashdance: scenarioClashDance,
  deflect: scenarioDeflect,
  ghostep: scenarioGhostep,
  tempo: scenarioTempo,
  chain: scenarioChain,
  dodgefx: scenarioDodgefx,
  timerip: scenarioTimeRip,
  perfectfx: scenarioPerfectFx,
  parryfx: scenarioParryFx,
  parrygrow: scenarioParryGrow,
  streak: scenarioStreak,
  training: scenarioTraining,
  execute: scenarioExecute,
  phase: scenarioPhase,
  flow: scenarioFlow,
  win: scenarioWin,
  // (the boss's pace is measured with the flurry before the dodge looks (STREAK_FX.dodgefx, 2026-11-25): the
  // Thunder Thrust's held lunge holds the world longer, a gap in HIS cues that is not his pace)
  pace: async () => {
    const { STREAK_FX } = await imp('src/combat/streak.js');
    const fx0 = STREAK_FX.dodgefx;
    STREAK_FX.dodgefx = '';
    try {
      return await scenarioPace();
    } finally {
      STREAK_FX.dodgefx = fx0;
    }
  },
  cutfx: scenarioCutFx,
  sfx: scenarioSfx,
  audit: scenarioAudit,
  swordmotion: scenarioSwordMotion,
  ashform: scenarioAshForm,
  // the contact pass (ADR-259, ?contact=a): the rules unmoved, the blows drawn on what they strike
  contact: async () => {
    out('\n== scenario CONTACT (blows drawn ON what they strike; the rules unmoved; ADR-259) ==');
    const { contactCheck } = await import('./contactCheck.mjs');
    const moves = ['plumThrust', 'fallingAsh', 'swallow', 'ashRain', 'chaseRain', 'riposte'].filter((n) => MOVES[n]);
    return await contactCheck({ THREE, imp, build, duel, place, run, settle, home, DT, assert, out, RESULT, moves });
  },
};
const runs = [];
const OPT_IN = new Set(['probe', 'strategy', 'bots', 'ranged', 'answer', 'audit']); // run only when named
// `all`, one scenario or a comma list; GCD_SKIP (a comma list) leaves scenarios out of `all`
// (tests/run.mjs runs the long ones as processes of their own, so a new scenario lands in `all`)
const SKIP = new Set((process.env.GCD_SKIP ?? '').split(',').map((s) => s.trim()).filter(Boolean));
for (const k of SKIP) if (!SCENARIOS[k]) { out(`unknown scenario in GCD_SKIP: ${k}`); process.exit(2); }
const WANT = SCEN === 'all' ? [] : SCEN.split(',');
for (const k of WANT) if (!SCENARIOS[k]) { out(`unknown scenario '${k}' (${Object.keys(SCENARIOS).join(' | ')} | all)`); process.exit(2); }
if (SCEN === 'all' && SKIP.size) out(`\n(not run here, GCD_SKIP: ${[...SKIP].join(', ')})`);
for (const [name, fn] of Object.entries(SCENARIOS)) if (WANT.includes(name) || (SCEN === 'all' && !OPT_IN.has(name) && !SKIP.has(name))) runs.push(await fn());
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
