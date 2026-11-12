// The technique system, headless (ADR-054; docs/ARCHITECTURE.md → "Techniques"): the REAL Player,
// AshDisciple / Dragon, Hud, GameFlow, AudioEngine, TouchControls and Lab (+ real LightPool,
// GlyphParticles, CameraRig, Events) wired like src/main.js; the world is a light mock on the real
// Colliders. Covers the Qi meter's gains, firing (the stance, the counter, the lunge, the red blow,
// the turned sword qi, the roll cancel, slot 2), the unlock on victory, persistence (localStorage),
// the equip panel, the touch buttons, and the counter against the wyrm in Cinderwood.
// usage: node technique.mjs <repoRoot> [scenario]   (env: ABYSS_SEED=n reseeds the AI)
//   scenario: data | qi | fire | wyrm | unlock | save | equip | touch | all
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
const { TELL, RESULT } = await imp('src/combat/rules.js');
const { LEVELS, getLevel, applyLevel } = await imp('src/levels/index.js');
const { COURTYARD } = await imp('src/world/courtyard.js');
const { Player } = await imp('src/entities/player/player.js');
const { QI, SLOT_COUNT, SLOT_KEYS, TECHNIQUES, TECHNIQUE_IDS, getTechnique, qiForParry } = await imp('src/entities/player/techniques/index.js');
const { TechniqueBook } = await imp('src/entities/player/techniques/book.js');
const { SAVE_KEY, loadSave } = await imp('src/game/save.js');
const { TUNING: ASH_TUNING } = await imp('src/entities/enemies/ashDisciple/tuning.js');
const { SCALE } = await imp('src/entities/dragon/tuning.js');
const { Hud } = await imp('src/ui/hud.js');
const { TouchControls } = await imp('src/ui/touch.js');
const { AudioEngine } = await imp('src/audio/audio.js');
const { GameFlow } = await imp('src/game/flow.js');
const { Lab } = await imp('src/dev/lab.js');

const ASH = getLevel('ash');
const CINDER = getLevel('cinderwood');
const RIPOSTE = getTechnique('ashRiposte');
const errors = [];
console.error = (...a) => { errors.push(a.map((x) => (x?.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x))).join(' ')); };
console.warn = (...a) => { errors.push('WARN ' + a.map(String).join(' ')); };
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
let fails = 0;
const assert = (c, m) => { if (!c) { fails++; out('FAIL', m); } else out('ok  ', m); };
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SEED = Number(process.env.ABYSS_SEED ?? 4242);
const DT = 1 / 60;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// the event catalogue (docs/ARCHITECTURE.md → "Event catalogue"): what this suite emits must be in it
const CATALOGUE = (() => {
  const md = fs.readFileSync(`${ROOT}/docs/ARCHITECTURE.md`, 'utf8');
  const sec = md.split(/^## /m).find((s) => s.startsWith('Event catalogue')) ?? '';
  const names = new Set();
  for (const m of sec.matchAll(/`([a-zA-Z]+(?::[a-zA-Z0-9]+)?)[ `]/g)) names.add(m[1]);
  return names;
})();

// CONFIG.world as booted (Cinderwood's layout): each build restores it, then applies its level
const WORLD0 = JSON.parse(JSON.stringify(CONFIG.world));

/** A Storage-like map (the persistence scenarios install it as globalThis.localStorage). */
class MemStorage {
  constructor() { this.m = new Map(); this.writes = 0; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.writes++; this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const setStorage = (s) => {
  if (s === undefined) delete globalThis.localStorage;
  else Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });
};

function build(level = ASH) {
  resetWindow();
  Math.random = mulberry32(SEED);
  for (const k of Object.keys(CONFIG.world)) if (!(k in WORLD0)) delete CONFIG.world[k];
  Object.assign(CONFIG.world, JSON.parse(JSON.stringify(WORLD0)));
  applyLevel(level);
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
    // the virtual sources the touch controls feed (core/input.js), mapped onto the mock's keys
    virt: [],
    setVirtual(code, down) { this.virt.push([code, !!down]); if (down) this.hold(code); else this.release(code); },
    setVirtualAxis() {}, releaseVirtual() {},
    endFrame() {
      pk.clear(); rk.clear(); pb.fill(false); rb.fill(false);
      for (const c of tapKeys) { keys.delete(c); rk.add(c); }
      tapKeys.clear();
      for (let b = 0; b < 3; b++) if (tapBtn[b]) { tapBtn[b] = false; btn[b] = false; rb[b] = true; }
      this.anyPressed = false; this.wheel = 0;
    },
  };
  const colliders = new Colliders();
  if (level === ASH) {
    const P = COURTYARD.pillarAt;
    for (let k = -3; k <= 3; k++) {
      const t = k * 5.2;
      colliders.add(t, -P, 0.62, 'stone');
      colliders.add(-P, t, 0.62, 'stone');
      colliders.add(P, t, 0.62, 'stone');
      if (Math.abs(t) > 5) colliders.add(t, P, 0.62, 'stone');
    }
  } else for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; colliders.add(Math.cos(a) * 19.5, Math.sin(a) * 19.5, 0.9, 'stone'); }
  const world = {
    colliders, bonfire: { ...CONFIG.world.bonfire }, nest: level === ASH ? { x: 0, z: -3 } : { x: -3, z: -15.5 },
    forest: { treeSpots: [], bonfire: { ...CONFIG.world.bonfire }, ash: level === ASH },
    setGrassQuality() {}, resolve: (pos, r, b) => colliders.resolve(pos, r, b),
    setPusher(slot, x, y, z, r) { if (![x, y, z, r].every(Number.isFinite)) throw new Error(`NaN pusher ${slot}`); },
    clearPushers() {}, gust(x, z, s, r) { if (![x, z, s, r].every(Number.isFinite)) throw new Error('NaN gust'); },
    scorch: { burnCircle(x, z, r) { if (![x, z, r].every(Number.isFinite)) throw new Error('NaN scorch'); }, reset() {}, heatAt: () => 0, burnAt: () => 0 },
    atmosphere: { bonfireLit: true, setBonfireLit(v) { this.bonfireLit = !!v; } }, update() {},
  };
  const mkParticles = (opts) => {
    const p = new GlyphParticles(U, opts);
    const spawn = p.spawn.bind(p);
    p.spawn = (o) => {
      for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'size']) if (o[k] !== undefined && !Number.isFinite(o[k])) throw new Error(`NaN particle ${k}`);
      return spawn(o);
    };
    return p;
  };
  const game = {
    THREE, CONFIG, level, levels: LEVELS.map((L) => ({ id: L.id, name: L.name })), pickLevel() {},
    renderer: null, scene, fxScene: new THREE.Scene(), camera, pipeline: { finalMat: { uniforms: { uHurt: { value: 0 }, uFade: { value: 0 }, uDesat: { value: 0 }, uWarm: { value: 0 }, uExposure: { value: 1 }, uBloom: { value: 1 } } } }, U,
    events: new Events(), input, cameraRig: new CameraRig(camera), lights: new LightPool(U),
    fx: { alpha: mkParticles({ max: 3000, additive: false }), add: mkParticles({ max: 7000, additive: true }) },
    time: 0, realTime: 0, timeScale: 1, debugTimeScale: 1, hitstopTimer: 0, hitstopScale: 1,
    mouseGround: new THREE.Vector3(), state: 'title', settings: { quality: CONFIG.defaultQuality, showFps: false },
    hitstop(seconds, scale = 0.04) { this.hitstopTimer = Math.max(this.hitstopTimer, seconds); this.hitstopScale = Math.min(this.hitstopScale, scale); },
    shake(a) { if (!Number.isFinite(a)) throw new Error('NaN shake'); this.cameraRig.addTrauma(a); },
  };
  const G = { game, input, counts: {}, log: [], watch: null, hits: [], payload: new Set() };
  const emit = game.events.emit.bind(game.events);
  game.events.emit = (n, d) => {
    G.counts[n] = (G.counts[n] || 0) + 1;
    if (/^(player|technique|combat|dragon):/.test(n)) G.log.push({ n, d, t: game.time });
    for (const [k, v] of Object.entries(d ?? {})) if (typeof v === 'number' && !Number.isFinite(v)) G.payload.add(`${n}.${k}`);
    G.watch?.(n, d);
    emit(n, d);
  };
  game.world = world;
  game.audio = new AudioEngine(game);
  game.player = new Player(game);
  game.dragon = level.createBoss(game);
  game.boss = game.dragon;
  game.hud = new Hud(game);
  game.touch = new TouchControls(game);
  game.flow = new GameFlow(game);
  game.lab = new Lab(game);
  game.applyQuality = () => {};
  const takeHit = game.player.takeHit.bind(game.player);
  game.player.takeHit = (h) => {
    const r = takeHit(h);
    G.hits.push({ t: game.time, r, attack: h?.attack, tell: h?.tell, damage: h?.damage, state: game.player.state });
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
    if (![p.position.x, p.position.z, p.hp, p.yaw, p.qi].every(Number.isFinite)) throw new Error('player NaN');
    if (![d.position.x, d.position.z, d.hp, d.yaw].every(Number.isFinite)) throw new Error('boss NaN');
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
const since = (G, i0, n) => G.log.slice(i0).filter((e) => e.n === n);

/** Title → the fight (the Lab's flow jump), AI off, the hero `dist` m in front of the boss. */
function fight(G, dist = 4, ang = 0) {
  const { game } = G;
  run(G, 0.2);
  game.flow.debug.toState('boss');
  game.dragon.debug.setAI(false);
  run(G, 0.6);
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
  aim(G);
}

function aim(G) {
  const { game } = G;
  const v = new THREE.Vector3();
  game.dragon.lockPoint(v);
  game.mouseGround.set(v.x, 0, v.z);
}

/** Until the boss stands free in its fight and the hero can act. */
function settle(G, max = 6) {
  const { game } = G;
  const d = game.dragon, p = game.player;
  return run(G, max, aim, () => (d.mode ? d.mode === 'foot' : !d.brain?.action && d.state === 'combat') && (p.state === 'idle' || p.state === 'run') && game.hitstopTimer <= 0);
}

/**
 * Trigger the boss's `name` (Lab) and answer its first cued blow: press `key` (a slot key) `lead` s
 * before the predicted impact (from its combat:flash). Returns { flash, pressT, hit (the takeHit record
 * of that attack), i0 (log index at the trigger) }.
 */
function answer(G, name, key = SLOT_KEYS[0], lead = 0.25, max = 5) {
  const { game, input } = G;
  const rec = { flash: null, impactT: null, pressT: null, hit: null, i0: G.log.length };
  const h0 = G.hits.length;
  G.watch = (n, d) => {
    if (n === 'combat:flash' && d?.attack === name && rec.impactT === null) {
      rec.flash = d;
      rec.impactT = game.time + (game.dragon.kind === 'duelist' ? ASH_TUNING.flashLead : 0.35);
    }
  };
  rec.trigger = game.dragon.debug.trigger(name);
  for (let i = 0; i < Math.round(max / DT); i++) {
    aim(G);
    if (rec.impactT !== null && rec.pressT === null && rec.impactT - game.time - DT <= lead) {
      input.tap(key);
      rec.pressT = game.time;
    }
    G.tick(DT);
    if (!rec.hit) rec.hit = G.hits.slice(h0).find((h) => h.attack === name) ?? null;
    else break;
  }
  G.watch = null;
  return rec;
}

// ================================================================== scenario: data
async function scenarioData() {
  out('\n== scenario DATA (the registry, the Qi rules, the slots, the level reward) ==');
  assert(TECHNIQUE_IDS.length >= 1 && TECHNIQUE_IDS.every((id) => TECHNIQUES[id].id === id), `registry: ${TECHNIQUE_IDS.join(', ')}`);
  for (const id of TECHNIQUE_IDS) {
    const T = TECHNIQUES[id];
    assert(typeof T.name === 'string' && typeof T.short === 'string' && T.short.length <= 8 && typeof T.icon === 'string' && T.icon.length === 1 && typeof T.desc === 'string' && typeof T.from === 'string', `${id}: name, short (≤ 8), one-char icon, description, teacher`);
    assert(T.cost > 0 && T.cost <= QI.max, `${id}: cost ${T.cost} within the meter (${QI.max})`);
    assert(T.kind === 'counter', `${id}: a known kind (${T.kind})`);
    const S = T.stance;
    assert(S.dur >= 0.5 && S.open >= 0 && S.open < 0.1 && S.arc > 0 && S.arc <= Math.PI && S.counterRange > 0 && S.rollAfter < S.dur, `${id}: stance ${S.dur} s, raised by ${S.open} s, cone ${(S.arc * 180 / Math.PI).toFixed(0)}°, counter range ${S.counterRange} m`);
    for (const k of ['counter', 'lunge']) {
      const C = T[k];
      assert(C.kind === 'thrust' && [C.windup, C.active, C.recovery, C.damage, C.poise, C.posture, C.reach, C.hitstop, C.shake].every((v) => Number.isFinite(v) && v >= 0) && C.active > 0, `${id}.${k}: a thrust with finite timings and numbers (windup ${C.windup} · active ${C.active} · recovery ${C.recovery} · ${C.damage} dmg · posture ${C.posture})`);
    }
    assert(T.counter.pierce === true && T.lunge.pierce === false && T.counter.damage > T.lunge.damage && T.counter.iframes > T.counter.windup + T.counter.active, `${id}: only the counter pierces, it hits harder, its i-frames outlast its active frames`);
  }
  assert(SLOT_COUNT === 2 && SLOT_KEYS.length === 2 && SLOT_KEYS[0] === 'KeyQ' && SLOT_KEYS[1] === 'KeyR', 'two slots on Q and R');
  assert(qiForParry('normal') === QI.parry.normal && qiForParry('blue') === QI.parry.blue && qiForParry('normal', 1, true) === QI.parryLight, `a parry: normal ${QI.parry.normal}, blue ${QI.parry.blue}, a bullet ${QI.parryLight}`);
  assert(qiForParry('normal', 3) === QI.parry.normal + 2 * QI.chainBonus && qiForParry('normal', 99) === QI.parry.normal + QI.chainBonusMax, `the deflect chain adds ${QI.chainBonus} a parry, at most ${QI.chainBonusMax}`);
  assert(ASH.reward?.technique === 'ashRiposte' && !CINDER.reward, 'the Ashfall level teaches the Ash Riposte; Cinderwood teaches nothing (yet)');
  for (const L of LEVELS) if (L.reward?.technique) assert(!!getTechnique(L.reward.technique), `level ${L.id}'s reward is a registered technique`);
  // the book on its own (no storage in this process)
  const ev = new Events();
  const seen = [];
  ev.on('technique:learned', (d) => seen.push(['learned', d]));
  ev.on('technique:equip', (d) => seen.push(['equip', d]));
  const book = new TechniqueBook({ events: ev, level: ASH });
  assert(book.list().length === 0 && book.slots.every((s) => s === null) && !book.equippedAny, 'a new book: nothing learned, both slots empty');
  assert(book.equip(0, 'ashRiposte') === false && book.learn('nope') === null, 'an unlearned or unknown technique cannot be equipped / learned');
  const r = book.learn('ashRiposte');
  assert(r.first && r.slot === 0 && book.slots[0] === 'ashRiposte' && book.saved === false, 'learn: first time, into slot 1 (no storage: kept in memory)');
  assert(book.equip(1, 'ashRiposte') && book.slots[0] === null && book.slots[1] === 'ashRiposte', 'equip into slot 2 moves it out of slot 1');
  assert(book.equip(0, 'ashRiposte') && book.slots[0] === 'ashRiposte' && book.slots[1] === null, 'and back (the slots swap)');
  assert(book.learn('ashRiposte').first === false && book.slots[0] === 'ashRiposte', 'learning it again changes nothing');
  assert(book.equip(0, null) && !book.equippedAny && book.equip(2, 'ashRiposte') === false, 'a slot empties; slot 3 does not exist');
  assert(seen.filter((s) => s[0] === 'learned').length === 2 && seen.some((s) => s[0] === 'equip'), 'technique:learned / technique:equip emitted');
  return null;
}

// ================================================================== scenario: qi
async function scenarioQi() {
  out('\n== scenario QI (the meter: parries, a chain, a perfect dodge, landed and guarded strikes) ==');
  const G = build(ASH);
  const { game, input } = G;
  const p = game.player, d = game.dragon;
  p.techniques.learn('ashRiposte');
  fight(G, 4.5);
  p.debug.god = true;
  assert(p.qi === 0 && p.qiMax === QI.max, `the meter starts empty (${p.qi} / ${p.qiMax})`);
  // a parried normal blow (RMB tapped 0.12 s before the impact the glint announces)
  settle(G);
  place(G, 4.5);
  let q0 = p.qi;
  const h0 = G.hits.length;
  d.debug.trigger('plumThrust');
  let pressed = false;
  let impactT = null;
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'plumThrust' && impactT === null) impactT = game.time + ASH_TUNING.flashLead; };
  run(G, 3, (GG) => { aim(GG); if (impactT !== null && !pressed && impactT - game.time - DT <= 0.12) { pressed = true; input.click(2); } }, () => G.hits.length > h0);
  G.watch = null;
  const hp = G.hits[G.hits.length - 1];
  assert(hp?.r === RESULT.PARRIED && near(p.qi - q0, QI.parry.normal), `a parried normal blow: +${QI.parry.normal} Qi (${q0} → ${p.qi})`);
  // a blue blow (Falling Ash)
  settle(G);
  place(G, 2.6);
  q0 = p.qi;
  const h1 = G.hits.length;
  d.debug.trigger('fallingAsh');
  pressed = false;
  impactT = null;
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'fallingAsh' && impactT === null) impactT = game.time + ASH_TUNING.flashLead; };
  run(G, 3, (GG) => { aim(GG); if (impactT !== null && !pressed && impactT - game.time - DT <= 0.12) { pressed = true; input.click(2); } }, () => G.hits.length > h1);
  G.watch = null;
  const hb = G.hits[G.hits.length - 1];
  assert(hb?.r === RESULT.PARRIED && hb.tell === TELL.BLUE && near(p.qi - q0, QI.parry.blue), `a parried blue blow: +${QI.parry.blue} Qi (${q0} → ${p.qi})`);
  // a chain (Swallow Flicks: three hits, each parried)
  settle(G);
  place(G, 2.6);
  p.qi = 0;
  const h2 = G.hits.length;
  const due = [];
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'swallow') due.push(game.time + ASH_TUNING.flashLead); };
  d.debug.trigger('swallow');
  run(G, 4, (GG) => {
    aim(GG);
    if (due.length && due[0] - game.time - DT <= 0.12) { due.shift(); input.up(2); input.click(2); }
  }, () => G.hits.slice(h2).filter((h) => h.attack === 'swallow').length >= 3);
  G.watch = null;
  const chainHits = G.hits.slice(h2).filter((h) => h.attack === 'swallow');
  const want = qiForParry('normal', 1) + qiForParry('normal', 2) + qiForParry('blue', 3);
  assert(chainHits.length === 3 && chainHits.every((h) => h.r === RESULT.PARRIED) && near(p.qi, Math.min(QI.max, want)), `a three-hit chain parried: ${chainHits.map((h) => h.r).join(' / ')} → ${p.qi} Qi (want ${want}: the chain bonus)`);
  // a perfect dodge (the Ghostep)
  settle(G);
  place(G, 4.5);
  p.qi = 0;
  const h3 = G.hits.length;
  impactT = null;
  pressed = false;
  G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'plumThrust' && impactT === null) impactT = game.time + ASH_TUNING.flashLead; };
  d.debug.trigger('plumThrust');
  run(G, 3, (GG) => {
    aim(GG);
    if (impactT !== null && !pressed && impactT - game.time - DT <= 0.1) { pressed = true; input.axis = { x: 1, y: 0 }; input.tap('Space'); }
  }, () => G.hits.length > h3);
  input.axis = { x: 0, y: 0 };
  G.watch = null;
  assert(G.hits[G.hits.length - 1]?.r === RESULT.PERFECT && near(p.qi, QI.perfectDodge), `a perfect dodge: +${QI.perfectDodge} Qi (${p.qi})`);
  // a strike that lands (at his back) and one he guards
  settle(G);
  place(G, 1.6, Math.PI);
  run(G, 0.05);
  d.yaw = Math.atan2(-(p.position.x - d.position.x), -(p.position.z - d.position.z));
  p.qi = 0;
  const hp0 = d.hp;
  input.click(0);
  run(G, 0.6);
  assert(d.hp < hp0 && near(p.qi, QI.hit.light), `a light strike that lands: +${QI.hit.light} Qi (${p.qi})`);
  settle(G);
  place(G, 1.8);
  run(G, 0.4);
  p.qi = 0;
  const g0 = G.counts['dragon:guard'] ?? 0;
  input.click(0);
  run(G, 0.6);
  assert((G.counts['dragon:guard'] ?? 0) > g0 && p.qi === 0, `a strike he guards: no Qi (${p.qi})`);
  // the cap and qiFull (once), the bonfire keeps it, a respawn empties it
  const f0 = G.counts['player:qiFull'] ?? 0;
  p.gainQi(70);
  p.gainQi(70);
  p.gainQi(70);
  assert(p.qi === QI.max && (G.counts['player:qiFull'] ?? 0) === f0 + 1, `capped at ${QI.max}; player:qiFull once`);
  p.restAtBonfire();
  assert(p.qi === QI.max, 'resting at the bonfire keeps the Qi');
  p.respawn(0, 0);
  assert(p.qi === 0, 'a respawn (death, retry) empties it');
  return G;
}

// ================================================================== scenario: fire
async function scenarioFire() {
  out('\n== scenario FIRE (the Ash Riposte: denied, the counter, i-frames, the lunge, red, sword qi, roll, slot 2) ==');
  const G = build(ASH);
  const { game, input } = G;
  const p = game.player, d = game.dragon;
  fight(G, 4.5);
  p.debug.god = true;
  // nothing equipped: Q does nothing
  p.qi = QI.max;
  input.tap('KeyQ');
  run(G, 0.1);
  assert(p.state !== 'technique' && p.qi === QI.max, `Q with an empty slot does nothing (${p.state})`);
  p.techniques.learn('ashRiposte');
  // too little Qi: denied
  p.qi = RIPOSTE.cost - 1;
  const den0 = G.counts['player:techniqueDenied'] ?? 0;
  input.tap('KeyQ');
  run(G, 0.1);
  assert(p.state !== 'technique' && (G.counts['player:techniqueDenied'] ?? 0) === den0 + 1 && p.qi === RIPOSTE.cost - 1, 'too little Qi: player:techniqueDenied, nothing spent');
  // the counter: Q as his Plum Thrust comes
  settle(G);
  place(G, 4.5);
  p.qi = QI.max;
  const hp0 = d.hp, post0 = d.posture;
  const r = answer(G, 'plumThrust', 'KeyQ', 0.25);
  const stance = since(G, r.i0, 'player:technique');
  assert(r.pressT !== null && stance.some((e) => e.d.phase === 'stance' && e.d.id === 'ashRiposte' && e.d.slot === 0), 'Q raised the stance (player:technique stance, slot 1)');
  assert(p.qi === 0, `the Qi was spent (${p.qi})`);
  assert(r.hit?.r === RESULT.PARRIED && r.hit.state === 'heavy', `his thrust was turned (${r.hit?.r}) and the counter started (${r.hit?.state})`);
  assert(since(G, r.i0, 'player:technique').some((e) => e.d.phase === 'counter') && since(G, r.i0, 'dragon:parried').length === 1, 'player:technique counter; he was parried (dragon:parried)');
  const atk = p.atk;
  assert(atk?.tech?.counter === true && atk.def === RIPOSTE.counter && p.iframeT > 0, 'the counter thrust runs with its i-frames');
  run(G, 0.5);
  const hitEv = since(G, r.i0, 'player:hitDragon').find((e) => e.d.technique === 'ashRiposte');
  assert(!!hitEv && d.hp <= hp0 - RIPOSTE.counter.damage * 0.85, `the counter landed: ${hitEv?.d.damage} damage (his HP ${hp0} → ${d.hp})`);
  assert(d.posture > post0 + RIPOSTE.counter.posture * 0.9 || d.broken, `posture ${post0.toFixed(0)} → ${d.posture.toFixed(0)} (parry + ${RIPOSTE.counter.posture})`);
  assert(d.mode === 'react' && ['stagger', 'broken'].includes(d.brain.react?.kind) || d.broken, `the counter staggers him (${d.mode} ${d.brain.react?.kind})`);
  // i-frames: a blow during the counter passes through
  settle(G);
  place(G, 2.2);
  p.qi = QI.max;
  const sw = answer(G, 'swallow', 'KeyQ', 0.25);
  const later = G.hits.filter((h) => h.attack === 'swallow' && h.t > sw.hit?.t);
  assert(sw.hit?.r === RESULT.PARRIED, `Swallow Flicks' first flick turned (${sw.hit?.r})`);
  run(G, 1.2);
  const later2 = G.hits.filter((h) => h.attack === 'swallow' && h.t > sw.hit?.t);
  assert(later2.every((h) => h.r !== RESULT.HIT), `nothing of his string lands after the counter (${later2.map((h) => h.r).join(', ') || 'the counter cut it short'})`);
  // the pierce through his guard: footwork, guard up, front
  settle(G);
  place(G, 1.8);
  run(G, 0.4);
  assert(d.guarding, 'he stands guard');
  const hpG = d.hp;
  const dealt = d.takeHit({ damage: 80, part: 'body', heavy: true, poise: 10, posture: 20, pierce: true, point: { x: d.position.x, y: 1.2, z: d.position.z } });
  assert(dealt > 0 && d.hp < hpG && d.mode === 'react' && d.brain.react?.kind === 'stagger', `a piercing strike goes through his guard and staggers him (${dealt} dmg, ${d.brain.react?.kind})`);
  const dealt2 = (settle(G), run(G, 0.4), d.takeHit({ damage: 80, part: 'body', heavy: true, poise: 10, point: { x: d.position.x, y: 1.2, z: d.position.z } }));
  assert(dealt2 === 0, 'the same strike without pierce is guarded');
  // the lunge: nothing comes
  settle(G);
  place(G, 3.0);
  p.qi = QI.max;
  const i0 = G.log.length;
  const hpL = d.hp;
  input.tap('KeyQ');
  run(G, 0.1);
  assert(p.state === 'technique', `the stance holds (${p.state})`);
  run(G, RIPOSTE.stance.dur + 0.05);
  const lunge = since(G, i0, 'player:technique').find((e) => e.d.phase === 'lunge');
  assert(!!lunge && p.atk?.def === RIPOSTE.lunge && p.atk.tech.counter === false, `nothing came: the lunge after ${RIPOSTE.stance.dur} s`);
  run(G, 0.6);
  out(`     the lunge into his guard: his HP ${hpL} → ${d.hp} (guarded unless he was open)`);
  // a red blow: the stance does not turn it
  settle(G);
  place(G, 2.0);
  p.qi = QI.max;
  const rr = answer(G, 'lotus', 'KeyQ', 0.25);
  assert(rr.pressT !== null && rr.hit?.tell === TELL.RED && rr.hit.r === RESULT.HIT, `a red blow in the stance lands (${rr.hit?.r}, ${rr.hit?.tell})`);
  run(G, 2);
  // thrown sword qi: turned, the stance holds, no counter
  settle(G);
  place(G, 10);
  p.qi = QI.max;
  const rc = answer(G, 'ashCrescent', 'KeyQ', 0.25);
  assert(rc.hit?.r === RESULT.PARRIED && rc.hit.state === 'technique' && p.state === 'technique', `an Ash Crescent is turned and the stance holds (${rc.hit?.r}, ${p.state})`);
  assert(!since(G, rc.i0, 'player:technique').some((e) => e.d.phase === 'counter'), 'no counter at 10 m');
  run(G, 1.2);
  // a roll cancels the stance
  settle(G);
  place(G, 4);
  p.qi = QI.max;
  input.tap('KeyQ');
  run(G, RIPOSTE.stance.rollAfter + 0.05);
  input.axis = { x: 1, y: 0 };
  input.tap('Space');
  run(G, 0.05);
  input.axis = { x: 0, y: 0 };
  assert(p.state === 'roll' && p.tech === null && p.qi === 0, `a roll cancels it (${p.state}); the Qi stays spent`);
  run(G, 0.8);
  // slot 2 fires on R
  settle(G);
  p.techniques.equip(1, 'ashRiposte');
  p.qi = QI.max;
  const i2 = G.log.length;
  input.tap('KeyR');
  run(G, 0.1);
  assert(p.state === 'technique' && since(G, i2, 'player:technique').some((e) => e.d.slot === 1), 'equipped in slot 2, R raises it');
  run(G, 1.5);
  // from the guard and out of an attack's recovery
  settle(G);
  p.techniques.equip(0, 'ashRiposte');
  p.qi = QI.max;
  input.press(2);
  run(G, 0.3);
  input.tap('KeyQ');
  run(G, 0.05);
  assert(p.state === 'technique', `Q out of the held guard (${p.state})`);
  input.up(2);
  run(G, 1.5);
  return G;
}

// ================================================================== scenario: wyrm (Cinderwood)
async function scenarioWyrm() {
  out('\n== scenario WYRM (the Ash Riposte in Cinderwood: the bite turned, the counter lands) ==');
  const G = build(CINDER);
  const { game } = G;
  const p = game.player, d = game.dragon;
  assert(d.kind !== 'duelist' && typeof d.plungePoint === 'function', 'the boss slot holds the wyrm');
  p.techniques.learn('ashRiposte');
  fight(G, 6 * (SCALE / 1.25));
  p.debug.god = true;
  settle(G, 8);
  place(G, 6 * (SCALE / 1.25));
  p.qi = QI.max;
  const hp0 = d.hp;
  const r = answer(G, 'bite', 'KeyQ', 0.25);
  assert(r.pressT !== null && r.hit?.r === RESULT.PARRIED && r.hit.state === 'heavy', `the bite turned by the stance, the counter starts (${r.hit?.r}, ${r.hit?.state})`);
  run(G, 0.6);
  const hit = since(G, r.i0, 'player:hitDragon').find((e) => e.d.technique === 'ashRiposte');
  assert(!!hit && d.hp < hp0, `the counter lands on the wyrm: ${hit?.d.damage} damage on its ${hit?.d.part} (HP ${hp0} → ${d.hp})`);
  return G;
}

// ================================================================== scenario: unlock
async function scenarioUnlock() {
  out('\n== scenario UNLOCK (victory over the Ash Disciple teaches the Ash Riposte; the reward card) ==');
  setStorage(new MemStorage());
  try {
    const G = build(ASH);
    const { game } = G;
    const p = game.player, d = game.dragon;
    assert(!p.techniques.has('ashRiposte') && !p.techniques.equippedAny, 'not learned before the duel');
    assert(!game.hud.qiRow.root.classList.contains('on'), 'the Qi row is hidden while nothing is equipped');
    fight(G, 5);
    const i0 = G.log.length;
    d.debug.kill();
    run(G, 6, null, () => game.state === 'victory');
    assert(game.state === 'victory', `he falls: victory (${game.state})`);
    const learned = since(G, i0, 'technique:learned');
    assert(learned.length === 1 && learned[0].d.id === 'ashRiposte' && learned[0].d.first === true && learned[0].d.slot === 0, `technique:learned {ashRiposte, first, slot 1} (${JSON.stringify(learned[0]?.d)})`);
    assert(p.techniques.slots[0] === 'ashRiposte', 'equipped in slot 1');
    const card = game.hud.rewardUi;
    assert(!card.root.classList.contains('on'), 'the reward card waits for the banner');
    run(G, 3.2);
    assert(card.root.classList.contains('on') && card.name.textContent === 'ASH RIPOSTE', `the card shows: ${card.name.textContent} — "${card.how.textContent}"`);
    run(G, 0.2);
    assert(game.hud.qiRow.root.classList.contains('on'), 'the Qi row appears in the player frame');
    const rec = loadSave();
    assert(rec.techniques?.learned?.includes('ashRiposte') && rec.techniques.slots?.[0] === 'ashRiposte', `saved: ${JSON.stringify(rec.techniques)}`);
    // fight again (R): the card goes, he can be beaten again, nothing new is learned
    game.input.tap('KeyR');
    run(G, 4, null, () => game.state === 'explore');
    assert(!card.root.classList.contains('on'), 'leaving the victory screen hides the card');
    game.flow.debug.toState('boss');
    run(G, 0.5);
    const i1 = G.log.length;
    d.debug.kill();
    run(G, 6, null, () => game.state === 'victory');
    const again = since(G, i1, 'technique:learned');
    run(G, 3.2);
    assert(again.length === 1 && again[0].d.first === false && !card.root.classList.contains('on'), 'a second victory: already known, no card');
    // Cinderwood's victory teaches nothing
    const W = build(CINDER);
    W.game.player.techniques.forget();
    W.game.flow.debug.toState('boss');
    run(W, 0.5);
    W.game.dragon.debug.kill();
    run(W, 12, null, () => W.game.state === 'victory');
    assert(W.game.state === 'victory' && !since(W, 0, 'technique:learned').length, 'the wyrm\'s victory teaches nothing (no reward yet)');
    return G;
  } finally {
    setStorage(undefined);
  }
}

// ================================================================== scenario: save
async function scenarioSave() {
  out('\n== scenario SAVE (localStorage: learned + slots survive a reload; bad / blocked storage is harmless) ==');
  const mem = new MemStorage();
  setStorage(mem);
  try {
    const G1 = build(ASH);
    const b1 = G1.game.player.techniques;
    b1.learn('ashRiposte');
    b1.equip(1, 'ashRiposte');
    assert(b1.saved && mem.writes >= 2, `written to localStorage['${SAVE_KEY}'] (${mem.writes} writes)`);
    const raw = JSON.parse(mem.getItem(SAVE_KEY));
    assert(raw.v === 1 && raw.techniques.learned[0] === 'ashRiposte' && raw.techniques.slots[0] === null && raw.techniques.slots[1] === 'ashRiposte', `the record: ${JSON.stringify(raw)}`);
    // a reload: a new game reads it back
    const G2 = build(CINDER);
    const b2 = G2.game.player.techniques;
    assert(b2.has('ashRiposte') && b2.slots[0] === null && b2.slots[1] === 'ashRiposte', `a reload (the other level) keeps it: slots ${JSON.stringify(b2.slots)}`);
    // other sections of the record are kept
    mem.setItem(SAVE_KEY, JSON.stringify({ ...raw, other: { keep: 1 } }));
    b2.equip(0, 'ashRiposte');
    assert(JSON.parse(mem.getItem(SAVE_KEY)).other?.keep === 1, 'a write keeps the record\'s other sections');
    // forget (the Lab) clears it
    b2.forget();
    assert(new TechniqueBook({ events: new Events() }).list().length === 0, 'forgotten: a new book reads nothing');
    // junk in storage: ignored
    mem.setItem(SAVE_KEY, '{not json');
    const G3 = build(ASH);
    assert(G3.game.player.techniques.list().length === 0, 'unparseable save: an empty book, no throw');
    mem.setItem(SAVE_KEY, JSON.stringify({ techniques: { learned: ['ashRiposte', 'ghost'], slots: ['ghost', 'ashRiposte', 'x'] } }));
    const b4 = new TechniqueBook({ events: new Events() });
    assert(b4.list().join() === 'ashRiposte' && b4.slots[0] === null && b4.slots[1] === 'ashRiposte', `unknown ids dropped (${JSON.stringify(b4.slots)})`);
  } finally {
    setStorage(undefined);
  }
  // storage that throws on access (blocked site data)
  Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('blocked'); }, configurable: true });
  try {
    const b = new TechniqueBook({ events: new Events() });
    const r = b.learn('ashRiposte');
    assert(r.first && b.saved === false && b.slots[0] === 'ashRiposte', 'blocked storage: still learned, kept in memory, nothing thrown');
  } finally {
    setStorage(undefined);
  }
  return null;
}

// ================================================================== scenario: equip
async function scenarioEquip() {
  out('\n== scenario EQUIP (pause → TECHNIQUES: the slots cycle, the list) ==');
  const G = build(ASH);
  const { game } = G;
  const p = game.player;
  run(G, 0.2);
  game.flow.debug.toState('explore');
  run(G, 0.3);
  game.flow.pause(true);
  run(G, 0.1);
  const pm = game.hud.pauseUi;
  assert(pm.on && pm.techVal.textContent === 'NONE YET', `the pause menu lists TECHNIQUES (${pm.techVal.textContent})`);
  pm.btnTech.dispatch('click');
  assert(pm.techs.on && pm.root.classList.contains('techs'), 'TECHNIQUES opens the equip panel in the menu\'s place');
  const rows = pm.techs.list.findAll((e) => e.classList?.contains('ab-tech-row'));
  assert(rows.length === TECHNIQUE_IDS.length && rows.every((r) => r.classList.contains('locked')), `every technique listed, locked (${rows.length})`);
  assert(pm.techs.list.textContent.includes('defeat Shen Hui'), 'a locked one says who teaches it');
  p.techniques.learn('ashRiposte');
  run(G, 0.05);
  assert(pm.techs.slotBtns[0].v.textContent.includes('ASH RIPOSTE') && pm.techs.slotBtns[1].v.textContent.includes('empty'), `slot 1: ${pm.techs.slotBtns[0].v.textContent} · slot 2: ${pm.techs.slotBtns[1].v.textContent}`);
  pm.techs.slotBtns[1].b.dispatch('click');
  assert(p.techniques.slots[0] === null && p.techniques.slots[1] === 'ashRiposte', `a tap on slot 2 moves it there (${JSON.stringify(p.techniques.slots)})`);
  pm.techs.slotBtns[1].b.dispatch('click');
  assert(!p.techniques.equippedAny, 'another tap empties slot 2');
  pm.techs.slotBtns[0].b.dispatch('click');
  assert(p.techniques.slots[0] === 'ashRiposte', 'a tap on slot 1 equips it there');
  const back = pm.techs.root.findAll((e) => e.tagName === 'BUTTON' && e.textContent === 'BACK')[0];
  back?.dispatch('click');
  assert(!pm.techs.on && !pm.root.classList.contains('techs'), 'BACK returns to the menu');
  pm.btnTech.dispatch('click');
  game.flow.pause(false);
  run(G, 0.1);
  assert(!pm.techs.on, 'resuming closes it (the next pause opens on the menu)');
  return G;
}

// ================================================================== scenario: touch
async function scenarioTouch() {
  out('\n== scenario TOUCH (the slot buttons above BLOCK: hidden until equipped, the Qi meter, a tap fires) ==');
  const G = build(ASH);
  const { game, input } = G;
  const p = game.player, t = game.touch;
  t.setActive(true);
  fight(G, 4.5);
  run(G, 0.1);
  const b0 = t.btn.tech0, b1 = t.btn.tech1;
  assert(!!b0 && !!b1 && b0.def.code === 'KeyQ' && b1.def.code === 'KeyR', 'tech0 / tech1 feed KeyQ / KeyR');
  assert(b0.el.classList.contains('hide') && b1.el.classList.contains('hide'), 'hidden while the slots are empty');
  p.techniques.learn('ashRiposte');
  p.qi = 50;
  run(G, 0.05);
  assert(!b0.el.classList.contains('hide') && b1.el.classList.contains('hide') && b0.t.textContent === RIPOSTE.short && b0.g.textContent === RIPOSTE.icon, `slot 1 shows "${b0.g.textContent} ${b0.t.textContent}"; slot 2 stays hidden`);
  assert(b0.s.textContent === '[###...]' && !b0.el.classList.contains('ready'), `half a meter: ${b0.s.textContent}`);
  p.qi = QI.max;
  run(G, 0.05);
  assert(b0.s.textContent === 'READY' && b0.el.classList.contains('ready'), 'a full meter: READY, lit');
  const v0 = input.virt.length;
  b0.el.dispatch('pointerdown', { pointerId: 7, pointerType: 'touch' });
  run(G, 0.05);
  b0.el.dispatch('pointerup', { pointerId: 7, pointerType: 'touch' });
  run(G, 0.05);
  assert(input.virt.slice(v0).some(([c, dn]) => c === 'KeyQ' && dn) && input.virt.slice(v0).some(([c, dn]) => c === 'KeyQ' && !dn), 'a tap presses and releases KeyQ');
  assert(p.state === 'technique' || since(G, 0, 'player:technique').length > 0, `the tap raised the stance (${p.state})`);
  run(G, 1.5);
  game.flow.pause(true);
  run(G, 0.05);
  assert(t.ui.root.classList.contains('off'), 'paused: the controls hide');
  game.flow.pause(false);
  t.setActive(false);
  return G;
}

const SCENARIOS = { data: scenarioData, qi: scenarioQi, fire: scenarioFire, wyrm: scenarioWyrm, unlock: scenarioUnlock, save: scenarioSave, equip: scenarioEquip, touch: scenarioTouch };
const runs = [];
for (const [name, fn] of Object.entries(SCENARIOS)) if (SCEN === name || SCEN === 'all') runs.push(await fn());
if (!runs.length) { out(`unknown scenario '${SCEN}' (${Object.keys(SCENARIOS).join(' | ')} | all)`); process.exit(2); }

out('');
{
  const emitted = new Set();
  for (const G of runs) if (G) Object.keys(G.counts).forEach((k) => emitted.add(k));
  const notCat = [...emitted].filter((k) => !CATALOGUE.has(k));
  assert(!notCat.length, `every event emitted is in the catalogue ${JSON.stringify(notCat)}`);
  const pay = new Set();
  for (const G of runs) G?.payload.forEach((k) => pay.add(k));
  assert(!pay.size, `no non-finite numbers in event payloads ${JSON.stringify([...pay])}`);
}
assert(errors.length === 0, `no console errors or warnings (${errors.length})${errors.length ? ': ' + errors.slice(0, 5).join(' || ') : ''}`);
out(fails ? `\nTECHNIQUE: ${fails} FAILED` : '\nTECHNIQUE: ALL PASSED');
process.exit(fails ? 1 : 0);
