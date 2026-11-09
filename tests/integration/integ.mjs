// Whole-game headless integration run (contract v0.2): REAL Player, Dragon, Hud, GameFlow,
// AudioEngine and Lab (+ real LightPool, GlyphParticles, CameraRig, Events), wired exactly like
// src/main.js (construction order, frame order, debugTimeScale in dt). World is a light mock built on
// the real Colliders. A bot drives the input: it moves, attacks, blocks, parries and dodges.
// usage: node integ.mjs <repoRoot> [scenario]   (env: ABYSS_SEED=n reseeds the AI, ABYSS_TRACE=1 logs combat events)
//   scenario: gate | breath | win | die | parry | block | reach | red | plunge | deflect | lab | touch | all (default all)
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ui, fireWin, AUDIO, resetWindow, El } from './shim.mjs';

const ROOT = process.argv[2];
const SCEN = process.argv[3] || 'all';
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const THREE = await import(pathToFileURL(`${ROOT}/node_modules/three/build/three.module.js`).href);
const { CONFIG } = await imp('src/core/config.js');
const { Events } = await imp('src/core/events.js');
const { CameraRig } = await imp('src/core/cameraRig.js');
const { clamp, damp } = await imp('src/core/math.js');
const { createSharedUniforms } = await imp('src/render/shaderLib.js');
const { LightPool } = await imp('src/render/lights.js');
const { GlyphParticles } = await imp('src/render/particles.js');
const { Colliders } = await imp('src/world/colliders.js');
const { TELL, TELL_STYLE, RESULT, DEFENSE, POSTURE } = await imp('src/combat/rules.js');
const { Player, TUNE: TUNE_P } = await imp('src/entities/player/player.js');
const { DIM: HERO_DIM, setHeroGlyphScale } = await imp('src/entities/player/model.js');
const { Dragon } = await imp('src/entities/dragon/dragon.js');
const { TUNING, SCALE } = await imp('src/entities/dragon/tuning.js');
// scripted placements (place()) were authored for the x1.25 wyrm: they scale with its size
const SIZE = SCALE / 1.25;
const { Hud } = await imp('src/ui/hud.js');
const { TouchControls } = await imp('src/ui/touch.js');
const { Input } = await imp('src/core/input.js');
const { AudioEngine } = await imp('src/audio/audio.js');
const { GameFlow } = await imp('src/game/flow.js');
const { Lab } = await imp('src/dev/lab.js');

const errors = [];
console.error = (...a) => { errors.push(a.map((x) => (x?.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x))).join(' ')); };
console.warn = (...a) => { errors.push('WARN ' + a.map(String).join(' ')); };
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
let fails = 0;
const assert = (c, m) => { if (!c) { fails++; out('FAIL', m); } else out('ok  ', m); };
const near = (a, b, eps) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps;

// Deterministic runs: the AI picks attacks with Math.random; every scenario reseeds it.
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SEED = Number(process.env.ABYSS_SEED ?? 1337);

// ---- event catalogue, read from the contract (docs/ARCHITECTURE.md → "Event catalogue")
const CATALOGUE = (() => {
  const md = fs.readFileSync(`${ROOT}/docs/ARCHITECTURE.md`, 'utf8');
  const sec = md.split(/^## /m).find((s) => s.startsWith('Event catalogue')) ?? '';
  const names = new Set();
  for (const m of sec.matchAll(/`([a-zA-Z]+(?::[a-zA-Z0-9]+)?)[ `]/g)) names.add(m[1]);
  return names;
})();

// ---- payload contract for the events the modules talk through (field → type)
// n finite number · s string · b boolean · t tell name · p point {x,y,z}
const PAYLOAD = {
  'combat:tell': { source: 's', attack: 's', tell: 't', impactIn: 'n', x: 'n', z: 'n' },
  'combat:flash': { source: 's', attack: 's', tell: 't', x: 'n', y: 'n', z: 'n' },
  'player:attack': { kind: 's', combo: 'n', charge: 'n' },
  'player:charge': { t: 'n' },
  'player:hitDragon': { damage: 'n', part: 's', point: 'p', heavy: 'b', crit: 'b', kind: 's' },
  'player:slam': { x: 'n', z: 'n' },
  'player:hurt': { damage: 'n', kind: 's', hp: 'n' },
  'player:block': { damage: 'n', tell: 't' },
  'player:parry': { tell: 't', attack: 's', chain: 'n' },
  'player:guardBreak': { attack: 's' },
  'player:dodge': { kind: 's' },
  'player:perfectDodge': { attack: 's', tell: 't' },
  'player:ghostep': { x: 'n', z: 'n' },
  'player:plunge': { execution: 'b' },
  'player:plungeHit': { damage: 'n', execution: 'b' },
  'combat:deflectChain': { count: 'n' },
  'player:heal': { amount: 'n', flasks: 'n' },
  'player:footstep': { x: 'n', z: 'n', sprint: 'b' },
  'player:lockOn': { on: 'b' },
  'dragon:roar': { strength: 'n' },
  'dragon:windup': { name: 's' },
  'dragon:attack': { name: 's' },
  'dragon:step': { x: 'n', z: 'n', heavy: 'b' },
  'dragon:wingFlap': { strength: 'n' },
  'dragon:land': { x: 'n', z: 'n' },
  'dragon:fireball': { x: 'n', y: 'n', z: 'n' },
  'dragon:explosion': { x: 'n', z: 'n', radius: 'n' },
  'dragon:hurt': { damage: 'n', part: 's', hp: 'n', crit: 'b' },
  'dragon:parried': { attack: 's', tell: 't' },
  'dragon:posture': { posture: 'n', max: 'n' },
  state: { from: 's', to: 's' },
  area: { name: 's' },
};
const TELLS = new Set(Object.values(TELL));
const typeOk = (t, v) => (t === 'n' ? Number.isFinite(v) : t === 's' ? typeof v === 'string' : t === 'b' ? typeof v === 'boolean' : t === 't' ? TELLS.has(v) : t === 'p' ? !!v && [v.x, v.y, v.z].every(Number.isFinite) : true);
const payloadErrors = new Set();

function build(opts = {}) {
  resetWindow();
  Math.random = mulberry32(SEED);
  ui.children.forEach((c) => (c.parentNode = null));
  ui.children.length = 0;
  const U = createSharedUniforms();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 16 / 9, CONFIG.camera.near, CONFIG.camera.far);
  // ---- input mock with the real Input interface (core/input.js). Edges last exactly one frame.
  //   tap(code) / click(b): down for this frame, released at its end (a quick tap)
  //   hold(code) / release(code), press(b) / up(b): held across frames (block = press(2) … up(2))
  const keys = new Set(), pk = new Set(), rk = new Set(), tapKeys = new Set();
  const btn = [false, false, false], pb = [false, false, false], rb = [false, false, false], tapBtn = [false, false, false];
  // keys go through the window first: a key the Lab's capture listener consumes never reaches Input
  const input = {
    enabled: true, anyPressed: false, wheel: 0, mouse: { ndcX: 0, ndcY: 0 },
    keys, pressedKeys: pk, releasedKeys: rk, buttons: btn, pressedButtons: pb, releasedButtons: rb,
    axis: { x: 0, y: 0 },
    down(c) { return this.enabled && keys.has(c); },
    pressed(c) { return this.enabled && pk.has(c); },
    released(c) { return this.enabled && rk.has(c); },
    mouseDown(b) { return this.enabled && btn[b]; },
    mousePressed(b) { return this.enabled && pb[b]; },
    mouseReleased(b) { return this.enabled && rb[b]; },
    moveAxis() { return this.enabled ? this.axis : { x: 0, y: 0 }; },
    tap(code) { if (keys.has(code) || fireWin('keydown', { code })) return; keys.add(code); pk.add(code); tapKeys.add(code); this.anyPressed = true; },
    hold(code) { if (keys.has(code) || fireWin('keydown', { code })) return; keys.add(code); pk.add(code); this.anyPressed = true; },
    release(code) { if (!keys.delete(code)) return; rk.add(code); fireWin('keyup', { code }); },
    click(b = 0) { if (btn[b]) return; btn[b] = true; pb[b] = true; tapBtn[b] = true; this.anyPressed = true; fireWin('pointerdown', { button: b }); },
    press(b) { if (btn[b]) return; btn[b] = true; pb[b] = true; this.anyPressed = true; fireWin('pointerdown', { button: b }); },
    up(b) { if (!btn[b]) return; btn[b] = false; rb[b] = true; },
    endFrame() {
      pk.clear(); rk.clear(); pb.fill(false); rb.fill(false);
      for (const c of tapKeys) { keys.delete(c); rk.add(c); }
      tapKeys.clear();
      for (let b = 0; b < 3; b++) if (tapBtn[b]) { tapBtn[b] = false; btn[b] = false; rb[b] = true; }
      this.anyPressed = false; this.wheel = 0;
    },
  };
  const colliders = new Colliders();
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; colliders.add(Math.cos(a) * 19.5, Math.sin(a) * 19.5, 0.9, 'stone'); }
  const pushers = new Map();
  const finalU = { uHurt: { value: 0 }, uFade: { value: 0 }, uDesat: { value: 0 }, uWarm: { value: 0 }, uExposure: { value: 1 }, uBloom: { value: 1 } };
  const counters = { scorchReset: 0, burn: 0, spawns: 0 };
  // world mock: the world API (grass = instanced glyph strokes; no-op quality hook)
  const world = {
    colliders,
    bonfire: { ...CONFIG.world.bonfire }, nest: { x: -3, z: -15.5 },
    forest: { treeSpots: [], bonfire: { ...CONFIG.world.bonfire } },
    setGrassQuality() {},
    resolve: (pos, r, b) => colliders.resolve(pos, r, b),
    setPusher(slot, x, y, z, r) { if (![x, y, z, r].every(Number.isFinite)) throw new Error(`NaN pusher ${slot}`); pushers.set(slot, [x, y, z, r]); },
    clearPushers(a = 0, b = 10) { for (let i = a; i < b; i++) pushers.delete(i); },
    gust(x, z, s, r) { if (![x, z, s, r].every(Number.isFinite)) throw new Error('NaN gust'); },
    scorch: { burnCircle(x, z, r) { if (![x, z, r].every(Number.isFinite)) throw new Error('NaN scorch'); counters.burn++; }, reset() { counters.scorchReset++; }, heatAt: () => 0, burnAt: () => 0 },
    atmosphere: { bonfireLit: true, setBonfireLit(v) { this.bonfireLit = !!v; } },
    update() {},
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
  // opts.realInput: the real core/input.js on a mock canvas (#game) — the touch scenario drives it
  // through the touch controls' pointer events instead of the mock above
  let canvasEl = null;
  if (opts.realInput) {
    canvasEl = new El('canvas');
    canvasEl.id = 'game';
    ui.parentNode.appendChild(canvasEl);
  }
  const game = {
    THREE, CONFIG, renderer: canvasEl ? { domElement: canvasEl } : null, scene, fxScene: new THREE.Scene(), camera,
    pipeline: { finalMat: { uniforms: finalU } }, U,
    events: new Events(), input: opts.realInput ? new Input(canvasEl) : input, cameraRig: new CameraRig(camera), lights: new LightPool(U),
    fx: { alpha: mkParticles({ max: 3000, additive: false }), add: mkParticles({ max: 7000, additive: true }) },
    time: 0, realTime: 0, timeScale: 1, debugTimeScale: 1, hitstopTimer: 0, hitstopScale: 1,
    mouseGround: new THREE.Vector3(), state: 'title', settings: { quality: CONFIG.defaultQuality, showFps: false },
    hitstop(seconds, scale = 0.04) { this.hitstopTimer = Math.max(this.hitstopTimer, seconds); this.hitstopScale = Math.min(this.hitstopScale, scale); },
    shake(a) { if (!Number.isFinite(a)) throw new Error('NaN shake'); this.cameraRig.addTrauma(a); },
  };
  const G = { game, input: game.input, canvas: canvasEl, evLog: [], counts: {}, counters, finalU, logTimes: [], hits: [], watch: null, defend: null };
  // event log + payload contract check (a wrapper, not a subscriber: it must not count as a consumer)
  const emit = game.events.emit.bind(game.events);
  game.events.emit = (n, d) => {
    G.counts[n] = (G.counts[n] || 0) + 1;
    const schema = PAYLOAD[n];
    if (schema) for (const k in schema) if (!typeOk(schema[k], d?.[k])) payloadErrors.add(`${n}.${k}=${JSON.stringify(d?.[k])}`);
    if (!/footstep|step|wingFlap|hurt|hitDragon|attack|windup|fireball|explosion|roll|dodge|posture$/.test(n) || n === 'dragon:hurt') G.evLog.push(`${game.time.toFixed(1)} ${n}${d && n === 'state' ? ' ' + d.from + '->' + d.to : ''}`);
    G.watch?.(n, d);
    if (process.env.ABYSS_TRACE && game.player && game.dragon && /combat:|player:(parry|block|perfectDodge|dodge|roll|guardBreak|hurt)|dragon:(parried|windup|phase2)/.test(n)) {
      out('     TRACE', game.time.toFixed(3), n, JSON.stringify(d ?? null).slice(0, 120), 'p', game.player.state, game.player.stateT.toFixed(2), 'dist', Math.hypot(game.player.position.x - game.dragon.position.x, game.player.position.z - game.dragon.position.z).toFixed(2));
    }
    G.defend?.onEvent(n, d);
    emit(n, d);
  };
  // construction order = main.js: world, audio, player, dragon, hud, touch, flow, lab
  game.world = world;
  game.audio = new AudioEngine(game);
  game.player = new Player(game);
  game.dragon = new Dragon(game);
  game.hud = new Hud(game);
  game.touch = new TouchControls(game); // inert until a touch (no coarse pointer headless)
  game.flow = new GameFlow(game);
  game.lab = new Lab(game);
  game.applyQuality = () => {};
  const hudLog = game.hud.log.bind(game.hud);
  game.hud.log = (t, ch) => { G.logTimes.push([game.realTime, String(t)]); return hudLog(t, ch); };
  // record every hit resolution (the dragon calls game.player.takeHit)
  const takeHit = game.player.takeHit.bind(game.player);
  game.player.takeHit = (h) => {
    const hp0 = game.player.hp;
    const r = takeHit(h);
    G.hits.push({ t: game.time, r, attack: h?.attack, tell: h?.tell, damage: h?.damage, kind: h?.kind, hp0, hp1: game.player.hp });
    return r;
  };
  game.cameraRig.snap(game.player.position);

  // ---- main.js frame (verbatim order)
  const focus = new THREE.Vector3(), lock = new THREE.Vector3();
  const updateCameraFocus = (dt) => {
    const p = game.player.position;
    focus.copy(p);
    const d = game.dragon;
    let zoomOut = 0;
    if (game.player.lockOn && d && d.isTargetable?.()) {
      d.lockPoint(lock);
      focus.x = p.x + (lock.x - p.x) * 0.38;
      focus.z = p.z + (lock.z - p.z) * 0.38;
      zoomOut = clamp(Math.hypot(lock.x - p.x, lock.z - p.z) * 0.35 - 2, 0, 12);
    }
    if (game.flow.cameraOverride) {
      const o = game.flow.cameraOverride;
      if (!(o.focus?.isVector3) || !Number.isFinite(o.weight) || !Number.isFinite(o.zoom ?? 0)) throw new Error('bad cameraOverride');
      focus.lerp(o.focus, o.weight);
      zoomOut = Math.max(zoomOut, o.zoom ?? 0);
    }
    game.cameraRig.extraZoom = damp(game.cameraRig.extraZoom, zoomOut, 2.5, dt);
    game.cameraRig.update(dt, focus);
  };
  const errorCounts = new Map();
  const safe = (name, fn) => {
    try { fn(); } catch (err) {
      const n = (errorCounts.get(name) ?? 0) + 1;
      errorCounts.set(name, n);
      if (n <= 3) console.error(`[${name}] update failed`, err);
    }
  };
  G.errorCounts = errorCounts;
  G.tick = (realDt) => {
    let scale = game.timeScale;
    if (game.hitstopTimer > 0) { game.hitstopTimer -= realDt; scale *= game.hitstopScale; if (game.hitstopTimer <= 0) game.hitstopScale = 1; }
    const dt = realDt * scale * (game.debugTimeScale ?? 1);
    game.realTime += realDt;
    game.time += dt;
    game.dt = dt;
    game.realDt = realDt;
    if (AUDIO.ctx) AUDIO.ctx.currentTime += realDt;
    safe('touch', () => game.touch.update(realDt));
    safe('lab', () => game.lab.update(realDt));
    safe('flow', () => game.flow.update(dt, realDt));
    safe('player', () => game.player.update(dt));
    safe('dragon', () => game.dragon.update(dt));
    safe('lab', () => game.lab.postUpdate?.()); // hitbox overlay matches this frame
    safe('camera', () => updateCameraFocus(realDt));
    safe('world', () => game.world.update(dt));
    game.lights.update(dt, game.player.position);
    game.fx.alpha.update(dt, game.time);
    game.fx.add.update(dt, game.time);
    safe('hud', () => game.hud.update(realDt));
    safe('audio', () => game.audio.update(realDt));
    game.input.endFrame();
    // NaN sentinels
    const p = game.player, d = game.dragon;
    if (![p.position.x, p.position.z, p.hp, p.yaw, p.critTimer].every(Number.isFinite)) throw new Error('player NaN');
    if (![d.position.x, d.position.z, d.hp, d.yaw, d.posture, d.maxPosture].every(Number.isFinite)) throw new Error('dragon NaN');
    for (const h of d.hurtSpheres) if (![h.x, h.y, h.z, h.r].every(Number.isFinite)) throw new Error('hurtSphere NaN');
    for (const k of ['uHurt', 'uFade', 'uDesat', 'uWarm']) if (!Number.isFinite(finalU[k].value)) throw new Error('grade NaN ' + k);
    if (![game.timeScale, game.time, game.debugTimeScale].every(Number.isFinite)) throw new Error('clock NaN');
  };
  return G;
}

const DT = 1 / 60;
const cls = (c) => ui.find((e) => e.classList?.contains(c));
const aimAt = (G) => { const d = G.game.dragon; G.game.mouseGround.set(d.position.x, 0, d.position.z); };

// ---- defender: answers tells like a player would (timed from combat:tell, re-timed by combat:flash)
//   blue / normal → tap RMB 0.12 s before impact (parry) · red → Space 0.1 s before impact (Ghostep)
//   streams that cannot be parried (breath) → hold the guard through them
//   act() returns true while an answer is due (the bot holds its swings)
function makeDefender(G) {
  const pend = [];
  const stats = { tells: 0, parryTry: 0, dodgeTry: 0, blockTry: 0 };
  const lead = TUNING.flashLead;
  let blockUntil = -1;
  return {
    stats,
    onEvent(n, d) {
      const t = G.game.time;
      if (n === 'combat:tell' && Number.isFinite(d?.impactIn)) {
        stats.tells++;
        pend.push({ attack: d.attack, tell: d.tell, at: t + d.impactIn, done: false, stream: d.attack === 'breath' });
      } else if (n === 'combat:flash') {
        // the flash is the authoritative timing cue: re-time the matching pending impact
        let best = null;
        for (const e of pend) if (!e.done && e.attack === d.attack && (!best || Math.abs(e.at - t - lead) < Math.abs(best.at - t - lead))) best = e;
        if (best && Math.abs(best.at - t - lead) < 0.6) best.at = t + lead;
      }
    },
    act() {
      const g = G.game, input = G.input, t = g.time;
      for (let i = pend.length - 1; i >= 0; i--) if (pend[i].done || pend[i].at < t - 0.5) pend.splice(i, 1);
      for (const e of pend) {
        const left = e.at - t - DT;
        if (e.stream) {
          if (left <= 0.3) { e.done = true; blockUntil = t + 2.6; input.press(2); stats.blockTry++; }
        } else if (e.tell === TELL.RED) {
          if (left <= 0.1) {
            e.done = true;
            const d = g.dragon.position, p = g.player.position;
            const dx = d.x - p.x, dz = d.z - p.z, l = Math.hypot(dx, dz) || 1;
            input.axis = { x: dx / l, y: -dz / l };
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
      if (blockUntil > 0 && t > blockUntil) { blockUntil = -1; input.up(2); }
      // like a player who sees the tell: stop swinging while an answer is due (a swing can't be rolled out of)
      let busy = blockUntil > 0;
      for (const e of pend) if (!e.done && e.at - t < 0.9) busy = true;
      return busy;
    },
  };
}

// ---- bot: walks to the dragon, locks on, swings, answers tells (defend), heals when low
function bot(G, opts = {}) {
  const { attack = true, god = false } = opts;
  const { game, input } = G;
  const p = game.player, d = game.dragon;
  const st = game.state;
  input.axis = { x: 0, y: 0 };
  if (god && p.alive) p.hp = p.maxHp;
  if (opts.passive || (st !== 'explore' && st !== 'bossIntro' && st !== 'boss')) return;
  const tgt = new THREE.Vector3();
  d.lockPoint(tgt);
  game.mouseGround.set(tgt.x, 0, tgt.z);
  const dx = tgt.x - p.position.x, dz = tgt.z - p.position.z;
  const dist = Math.hypot(dx, dz);
  if (st === 'boss' && !p.lockOn && d.isTargetable() && (game.time * 10 | 0) % 20 === 0) input.tap('Tab');
  if (dist > 3.2) input.axis = { x: dx / dist, y: -dz / dist };
  const guarding = opts.defend && G.defend ? G.defend.act() : false;
  // a defending bot pokes once a second and presses its advantage in openings (crit window, broken
  // posture, parry recoil) — a longer fight that meets more of the AI's attacks
  const opening = p.critTimer > 0 || d.broken || d.brain?.action?.name === 'recoil';
  const cadence = opts.defend && !opening ? 60 : 24;
  if (st === 'boss' && attack && !guarding && dist < 5 && (game.realTime * 60 | 0) % cadence === 0) input.click(0);
  if (!opts.defend && st === 'boss' && attack && d.brain?.action?.name === 'breath' && (game.realTime * 60 | 0) % 30 === 0) {
    input.axis = { x: 1, y: 0 };
    input.tap('Space');
  }
  if (!god && p.hp < 40 && p.flasks > 0 && (game.realTime * 60 | 0) % 40 === 0) input.tap('KeyF');
}

function run(G, seconds, opts, until) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    bot(G, opts);
    G.tick(DT);
    if (until && until()) return true;
  }
  return false;
}

/** Title → boss through the Lab's flow jump; the dragon's AI is switched off for scripted tests. */
function fightSetup(G, { ai = false } = {}) {
  const { game } = G;
  run(G, 0.3);
  assert(game.flow.debug.toState('boss') === true, 'flow.debug.toState(boss) from title');
  if (!ai) game.dragon.debug.setAI(false);
  run(G, 0.6, { passive: true });
}

/** Wait until the dragon stands idle in combat and the player can act again. */
function settle(G, max = 8) {
  const { game } = G;
  const d = game.dragon, p = game.player;
  return run(G, max, { passive: true }, () => !d.brain.action && d.state === 'combat' && (p.state === 'idle' || p.state === 'run') && game.hitstopTimer <= 0);
}

/** Player at `dist` m from the dragon root, `ang` rad off its facing, looking at it; full HP. */
function place(G, dist, ang = 0) {
  const { game } = G;
  const d = game.dragon, p = game.player;
  const a = d.yaw + ang;
  dist *= SIZE;
  p.debug.teleport(d.position.x + Math.sin(a) * dist, d.position.z + Math.cos(a) * dist);
  p.yaw = Math.atan2(d.position.x - p.position.x, d.position.z - p.position.z);
  p.debug.heal();
  aimAt(G);
}

/**
 * Force `name` through the Lab and answer it: plan.answer ∈ parry | dodge | mash | early | late | none,
 * plan.hold = hold RMB (block) throughout. Timing is taken from the attack's own combat:tell (impactIn)
 * and re-timed by combat:flash, like a player reacting to the tell. Returns the record.
 */
function forceAttack(G, name, plan = {}) {
  const { game, input } = G;
  const rec = { name, tell: null, impactIn: null, tellT: null, impactT: null, flashT: null, res: null, hit: null, hp0: game.player.hp, posture0: game.dragon.posture, ev: {}, tells: [] };
  const c0 = { ...G.counts };
  G.watch = (n, d) => {
    if (n === 'combat:tell' && d?.attack === name) rec.tells.push(d.tell);
    if (n === 'combat:tell' && d?.attack === name && rec.tellT === null) {
      rec.tellT = game.time; rec.impactIn = d.impactIn; rec.impactT = game.time + d.impactIn; rec.tell = d.tell;
    } else if (n === 'combat:flash' && d?.attack === name && rec.flashT === null && rec.tellT !== null) {
      rec.flashT = game.time; rec.impactT = game.time + TUNING.flashLead;
    }
    if (n === 'player:ghostep') rec.ghost = { px: game.player.position.x, pz: game.player.position.z, dx: game.dragon.position.x, dz: game.dragon.position.z, dyaw: game.dragon.yaw };
  };
  const h0 = G.hits.length;
  if (plan.hold) input.press(2);
  run(G, 0.15, { passive: true });
  rec.trigger = game.lab.trigger(name);
  let acted = 0, after = -1;
  const mash = [-0.45, -0.35, -0.25, -0.15, -0.05];
  for (let i = 0; i < Math.round((plan.max ?? 5) / DT); i++) {
    aimAt(G);
    input.axis = { x: 0, y: 0 };
    if (rec.impactT !== null) {
      const left = rec.impactT - game.time - DT;
      if (plan.answer === 'parry' && !acted && left <= 0.12) { acted = 1; input.click(2); rec.pressLead = left; }
      if (plan.answer === 'early' && !acted && left <= 0.45) { acted = 1; input.click(2); rec.pressLead = left; }
      if (plan.answer === 'late' && !acted && left <= -0.06) { acted = 1; input.click(2); rec.pressLead = left; }
      if (plan.answer === 'mash' && acted < mash.length && left <= -mash[acted]) { acted++; input.click(2); }
      if (plan.answer === 'dodge' && !acted && left <= 0.1) {
        acted = 1;
        const d = game.dragon.position, p = game.player.position;
        const dx = d.x - p.x, dz = d.z - p.z, l = Math.hypot(dx, dz) || 1;
        input.axis = { x: dx / l, y: -dz / l };
        input.tap('Space');
        rec.pressLead = left;
      }
    }
    G.tick(DT);
    if (rec.res === null) {
      const h = G.hits.slice(h0).find((x) => x.attack === name);
      if (h) { rec.res = h.r; rec.hit = h; rec.hitT = h.t; after = 0; rec.postureAtHit = game.dragon.posture; rec.hpAtHit = game.player.hp; }
    } else if (++after > (plan.settle ?? 6)) break;
  }
  if (plan.hold) input.up(2);
  for (const k in G.counts) rec.ev[k] = G.counts[k] - (c0[k] || 0);
  G.watch = null;
  return rec;
}
const evn = (rec, n) => rec.ev[n] || 0;

/**
 * Force `name` (player left where it is) and sample, every frame: dragon.warn, whether every
 * material's uWarn.w matches it, and the HUD's red edge opacity. tellI / flashI = first sample
 * after the attack's combat:tell / combat:flash. `stop(tr)` ends the trace early.
 */
function warnTrace(G, name, seconds, stop = null) {
  const { game } = G;
  const d = game.dragon, mats = Object.values(d.model.mats);
  const tr = { trigger: false, tellI: -1, flashI: -1, w: [], edge: [], uniformOk: true, finite: true };
  let told = false, flashed = false;
  G.watch = (n, dd) => {
    if (dd?.attack !== name) return;
    if (n === 'combat:tell') told = true;
    if (n === 'combat:flash') flashed = true;
  };
  tr.trigger = game.lab.trigger(name);
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    G.tick(DT);
    if (told && tr.tellI < 0) tr.tellI = i;
    if (flashed && tr.flashI < 0) tr.flashI = i;
    tr.w.push(d.warn);
    tr.edge.push(Number(cls('ab-edge')?.style.opacity ?? 0) || 0);
    if (!Number.isFinite(d.warn)) tr.finite = false;
    if (!mats.every((m) => m.uniforms.uWarn?.value?.w === d.warn)) tr.uniformOk = false;
    if (stop?.(tr)) break;
  }
  G.watch = null;
  return tr;
}

// ================================================================== scenario: win (god-mode bot that defends)
async function scenarioWin() {
  out('\n== scenario WIN (god-mode bot: attacks, parries, blocks, dodges) ==');
  const G = build();
  const { game, input, evLog, counts, counters } = G;
  G.defend = makeDefender(G);
  assert(game.state === 'title', 'boots in title');
  assert(cls('ab-title') !== null, 'title UI exists');
  assert(game.lab && game.lab.open === false, 'Lab constructed, closed without ?lab');
  run(G, 1.0);
  assert(game.flow.cameraOverride !== null, 'title camera override active');
  input.tap('Space');
  G.tick(DT);
  assert(game.state === 'explore', 'any key → explore');
  assert(AUDIO.ctx !== null, 'audio context created by unlock');
  assert(game.player.state === 'idle', 'title-dismiss key did not roll');
  // walk north until the boss intro starts
  const introStarted = run(G, 30, { god: true, attack: false }, () => game.state === 'bossIntro');
  assert(introStarted, `bossIntro triggered (player z=${game.player.position.z.toFixed(1)})`);
  assert(game.dragon.state === 'waking', `dragon waking after intro start (got ${game.dragon.state})`);
  const fight = run(G, 20, { god: true, attack: false }, () => game.state === 'boss');
  assert(fight, 'dragon:introDone → boss state');
  assert(game.dragon.state === 'combat', `dragon in combat (got ${game.dragon.state})`);
  assert(cls('ab-boss')?.classList.contains('on'), 'boss bar shown');
  assert(game.audio.musicMode === 'boss', `boss music (got ${game.audio.musicMode})`);
  // fight until victory
  let maxPhase = 1, sawBreak = false, sawAir = false;
  const won = run(G, 400, { god: true, defend: true }, () => {
    maxPhase = Math.max(maxPhase, game.dragon.phase);
    if (game.dragon.broken) sawBreak = true;
    if (game.dragon.state === 'airborne') sawAir = true;
    return game.state === 'victory';
  });
  const c = (n) => counts[n] || 0;
  out(`   fight: t=${game.time.toFixed(1)}s dragon hp=${game.dragon.hp} state=${game.dragon.state} phase=${maxPhase} hits=${c('player:hitDragon')} hurt=${c('player:hurt')} tells=${c('combat:tell')} flashes=${c('combat:flash')} break=${sawBreak} air=${sawAir}`);
  out(`   defence: parry ${c('player:parry')}/${G.defend.stats.parryTry} tries · block ${c('player:block')} · guardBreak ${c('player:guardBreak')} · perfect ${c('player:perfectDodge')}/${G.defend.stats.dodgeTry} tries · ghostep ${c('player:ghostep')} · dodge ${c('player:dodge')} · dragon:parried ${c('dragon:parried')} · postureBreak ${c('dragon:postureBreak')}`);
  assert(won, 'victory reached');
  assert(maxPhase === 2, 'phase 2 reached');
  assert(c('dragon:phase2') === 1, 'dragon:phase2 once');
  assert(c('dragon:death') === 1 && c('dragon:dead') === 1, 'dragon:death + dragon:dead once each');
  assert(c('game:victory') === 1, 'game:victory once');
  assert(game.dragon.state === 'dead', 'dragon dead');
  assert(c('combat:tell') >= 3 && c('combat:flash') >= 3 && c('combat:flash') <= c('combat:tell'), `attacks announced with combat:tell + combat:flash (${c('combat:tell')} / ${c('combat:flash')})`);
  assert(c('player:parry') >= 1 && c('player:parry') === c('dragon:parried'), `bot parried in a live fight (player:parry ${c('player:parry')} = dragon:parried ${c('dragon:parried')})`);
  assert(c('player:perfectDodge') >= 1 && c('player:perfectDodge') === c('player:ghostep'), `bot Ghostepped a red tell in a live fight (${c('player:perfectDodge')})`);
  assert(c('player:plungeHit') >= 1 && c('player:plungeHit') <= c('player:plunge'), `perfect dodges plunged onto the head in a live fight (${c('player:plunge')} dives, ${c('player:plungeHit')} hits)`);
  assert((c('dragon:postureBreak') > 0) === sawBreak, `dragon:postureBreak ↔ dragon.broken (${c('dragon:postureBreak')} / ${sawBreak})`);
  assert(c('player:guardBreak') === 0, 'the reacting bot never guard-broke (red tells are dodged, not blocked)');
  assert(c('player:charge') === 0 && c('player:noStamina') === 0, 'no charge from taps, no stamina events');
  run(G, 4, { god: true });
  assert(!cls('ab-boss')?.classList.contains('on'), 'boss bar hidden after victory');
  assert(cls('ab-stats')?.classList.contains('on'), 'victory stats shown');
  assert(game.player.takeHit({ damage: 50, from: { x: 0, z: 0 } }) === RESULT.IGNORED, 'player ignores hits in victory');
  // [R] fight again
  input.tap('KeyR');
  run(G, 4, {}, () => game.state === 'explore' && !game.flow.respawning);
  assert(game.state === 'explore', 'R → explore');
  const d = game.dragon;
  assert(d.state === 'sleeping' && d.hp === d.maxHp && d.phase === 1 && d.posture === 0 && !d.broken && d.maxPosture === TUNING.posture.max[0], 'dragon reset to sleeping/full/phase1/posture 0');
  assert(counters.scorchReset >= 1, 'scorch reset on restart');
  assert(game.player.hp === game.player.maxHp && game.player.critTimer === 0, 'player full hp, no crit window after restart');
  assert(d.object3d.visible, 'dragon visible again after restart');
  // second fight starts cleanly
  const again = run(G, 40, { god: true, attack: false }, () => game.state === 'boss');
  assert(again, 'second fight reaches boss state');
  out('   states: ' + evLog.filter((l) => l.includes(' state ')).map((l) => l.split(' state ')[1]).join(', '));
  return G;
}

// ================================================================== scenario: die + retry + pause + rest
async function scenarioDie() {
  out('\n== scenario DIE (passive bot) ==');
  const G = build();
  const { game, input, counts, counters } = G;
  run(G, 0.6);
  input.click(0);
  G.tick(DT);
  assert(game.state === 'explore', 'click → explore');
  assert(game.player.state === 'idle', 'title-dismiss click did not swing');
  // rest at bonfire at spawn
  input.tap('KeyE');
  G.tick(DT);
  assert((counts['bonfire:rest'] || 0) === 1, 'E near bonfire → bonfire:rest');
  // heal / roll edge events (v0.2: no stamina — rolls are free)
  const maxF = game.player.maxFlasks;
  assert(maxF === 5, `5 flasks (got ${maxF})`);
  for (let i = 0; i < maxF + 1; i++) { input.tap('KeyF'); run(G, 1.1, { passive: true }); }
  assert((counts['player:heal'] || 0) === maxF && (counts['player:noFlask'] || 0) >= 1, `${maxF} heals then noFlask`);
  for (let i = 0; i < 8; i++) { input.axis = { x: 1, y: 0 }; input.tap('Space'); G.tick(DT); run(G, 0.45, { passive: true }); }
  assert((counts['player:roll'] || 0) >= 8, `every roll accepted, none refused (${counts['player:roll'] || 0})`);
  assert(!('stamina' in game.player) && !('maxStamina' in game.player), 'player has no stamina fields');
  run(G, 3, { passive: true });
  game.player.position.set(CONFIG.world.playerSpawn.x, 0, CONFIG.world.playerSpawn.z);
  input.tap('KeyE'); G.tick(DT);
  assert(game.player.flasks === game.player.maxFlasks, 'second rest refills flasks');
  run(G, 25, { attack: false }, () => game.state === 'boss');
  assert(game.state === 'boss', 'reached boss');
  // pause / resume
  run(G, 3, { attack: false });
  const dPos = game.dragon.position.clone(), dHp = game.dragon.hp;
  input.tap('Escape');
  G.tick(DT);
  assert(game.state === 'paused', 'Esc → paused');
  run(G, 2, { attack: false });
  assert(game.timeScale === 0, 'timeScale 0 while paused');
  assert(game.dragon.position.distanceTo(dPos) < 1e-6 && game.dragon.hp === dHp, 'dragon frozen while paused');
  input.tap('Escape');
  G.tick(DT);
  assert(game.state === 'boss', 'Esc → back to boss');
  // stand still near the dragon until dead
  const died = run(G, 240, { attack: false }, () => game.state === 'dead');
  assert(died, `player killed → dead state (hp=${game.player.hp})`);
  assert((counts['player:died'] || 0) === 1, 'player:died once');
  assert(game.audio.musicMode === 'death', `death music (got ${game.audio.musicMode})`);
  run(G, 1.0);
  const bn = ui.findAll((e) => e.classList?.contains('ab-banner'));
  assert(bn.some((b) => b.textContent.includes('YOU DIED')), 'YOU DIED banner');
  input.tap('KeyW');
  G.tick(DT);
  assert(!game.flow.respawning, 'retry not accepted before hold time');
  run(G, 4.0);
  input.tap('KeyW');
  run(G, 5, { passive: true }, () => game.state === 'explore' && !game.flow.respawning);
  assert(game.state === 'explore', 'retry → explore');
  assert((counts['game:retry'] || 0) === 1, 'game:retry once');
  assert(game.player.alive && game.player.hp === game.player.maxHp && game.player.state === 'idle', 'player respawned full');
  assert(Math.hypot(game.player.position.x - CONFIG.world.playerSpawn.x, game.player.position.z - CONFIG.world.playerSpawn.z) < 0.5, 'player at bonfire spawn');
  assert(game.dragon.state === 'sleeping' && game.dragon.hp === game.dragon.maxHp && game.dragon.posture === 0, 'dragon reset');
  assert(counters.scorchReset >= 1, 'scorch reset on retry');
  assert(game.audio.musicMode === 'ambient', `ambient music after retry (got ${game.audio.musicMode})`);
  assert(game.audio.breath ? !game.audio.breath.active : true, 'breath loop stopped after retry');
  assert(G.finalU.uFade.value < 0.05 && G.finalU.uDesat.value < 0.05, `grade cleared (fade=${G.finalU.uFade.value.toFixed(2)} desat=${G.finalU.uDesat.value.toFixed(2)})`);
  assert(!game.flow.cameraOverride || game.flow.cameraOverride.weight < 0.05, 'no lingering camera override');
  run(G, 3, { passive: true });
  assert(game.dragon.state === 'sleeping', 'dragon stays asleep at the bonfire after retry');
  return G;
}

// ================================================================== scenario: breath (a stream)
async function scenarioBreath() {
  out('\n== scenario BREATH (forced breath: stand in it, roll into it, roll out of it) ==');
  const G = build();
  const { game, input, counts } = G;
  run(G, 0.6); input.tap('Space'); G.tick(DT);
  run(G, 30, { attack: false }, () => game.state === 'boss');
  assert(game.state === 'boss', 'walked into the fight');
  const d = game.dragon, p = game.player;
  const BREATH_AT = 8.5; // closer than ~7 m the player stands under the (25 % bigger) head, behind the mouth
  d.debug.setAI(false);
  settle(G);
  // 1) stand in the cone (AI breath range: 6-16 m x SCALE) and take it: every tick is a hit, logged as a summary
  place(G, BREATH_AT);
  const hurt0 = counts['player:hurt'] || 0, log0 = G.logTimes.length;
  p.debug.god = true;
  const r1 = forceAttack(G, 'breath', { answer: 'none', max: 4, settle: 400 });
  p.debug.god = false;
  const lines = G.logTimes.slice(log0).map((x) => x[1]);
  const fireLines = lines.filter((l) => /flame|Burning|Scorched|fire/i.test(l));
  const ticks = G.hits.filter((h) => h.attack === 'breath' && h.t >= r1.tellT).length;
  out('   breath: takeHit ticks', ticks, 'player:hurt', (counts['player:hurt'] || 0) - hurt0, 'fire/burn log lines', fireLines.length, '::', fireLines.join(' / '));
  assert(r1.trigger === true && r1.tell === TELL.NORMAL, 'breath forced via Lab, normal tell');
  assert(ticks >= 5 && (counts['player:hurt'] || 0) - hurt0 >= 5, 'breath ticks reached the player');
  assert(fireLines.length <= 6, 'breath damage summarized (<= ~1 line/s per stream)');
  assert((counts['dragon:breathStart'] || 0) >= 1 && (counts['dragon:breathEnd'] || 0) >= 1, 'breathStart/End emitted');
  assert(!game.audio.breath?.active, 'audio breath loop stopped after breathEnd');
  // 2) blocking the stream: blockable (chip), never parryable even with a timed RMB press
  settle(G);
  place(G, BREATH_AT);
  const rb = forceAttack(G, 'breath', { answer: 'parry', hold: false, max: 2 });
  assert(rb.res !== RESULT.PARRIED && evn(rb, 'player:parry') === 0, `breath is not parryable (got ${rb.res})`);
  settle(G);
  // 3) roll INTO the breath just before the first tick: a perfect dodge → Ghostep
  place(G, BREATH_AT);
  const rg = forceAttack(G, 'breath', { answer: 'dodge', max: 2.5, settle: 30 });
  out('   roll into breath: result', rg.res, 'perfect', evn(rg, 'player:perfectDodge'), 'ghostep', evn(rg, 'player:ghostep'), 'press lead', rg.pressLead?.toFixed(3));
  assert(rg.res === RESULT.PERFECT && evn(rg, 'player:perfectDodge') === 1 && evn(rg, 'player:ghostep') === 1, 'rolling into the breath at its start → one Ghostep');
  settle(G);
  // 4) standing in the stream, then rolling OUT of it: one plain dodge per roll, never a Ghostep
  place(G, BREATH_AT);
  p.debug.god = true;
  const c0 = { ...counts };
  let rollT = -1, tellT = -1;
  G.watch = (n, dd) => { if (n === 'combat:tell' && dd.attack === 'breath') tellT = game.time + dd.impactIn; };
  game.lab.trigger('breath');
  for (let i = 0; i < 240; i++) {
    aimAt(G);
    input.axis = { x: 0, y: 0 };
    if (tellT > 0 && rollT < 0 && game.time > tellT + 0.5) {
      rollT = game.time;
      const a = d.yaw + Math.PI / 2;
      input.axis = { x: Math.sin(a), y: -Math.cos(a) };
      input.tap('Space');
    }
    G.tick(DT);
    if (rollT > 0 && game.time > rollT + 0.8) break;
  }
  G.watch = null;
  p.debug.god = false;
  const dd = (n) => (counts[n] || 0) - (c0[n] || 0);
  out('   roll out of breath: roll', dd('player:roll'), 'dodge', dd('player:dodge'), 'perfect', dd('player:perfectDodge'), 'hurt', dd('player:hurt'));
  assert(dd('player:roll') === 1 && dd('player:dodge') === 1, 'exactly one player:dodge per roll out of the breath');
  assert(dd('player:perfectDodge') === 0, 'rolling out of a stream you stand in is not a perfect dodge');
  return G;
}

// ================================================================== scenario: shells in flight at death
async function scenarioGate() {
  out('\n== scenario GATE (shells in flight when the wyrm dies) ==');
  const G = build();
  const { game, input, counts } = G;
  run(G, 0.6); input.tap('Space'); G.tick(DT);
  run(G, 30, { attack: false }, () => game.state === 'boss');
  const d = game.dragon;
  const p = game.player;
  run(G, 0.3, { passive: true });
  d.fx.launchFireball(new THREE.Vector3(p.position.x, 6, p.position.z - 4), p.position.clone(), null);
  d.hp = 1;
  d.takeHit({ damage: 50, part: 'body', point: { x: d.position.x, y: 2, z: d.position.z } });
  assert(d.state === 'dying', 'dragon dying');
  const hurt0 = counts['player:hurt'] || 0;
  run(G, 2, { passive: true });
  assert((counts['dragon:explosion'] || 0) >= 1, 'shell exploded');
  assert((counts['player:hurt'] || 0) === hurt0, 'no damage from a dead wyrm');
  run(G, 10, { passive: true }, () => game.state === 'victory');
  assert(game.state === 'victory' && p.alive, 'victory with the hero alive');
  return G;
}

// ================================================================== scenario: parry (blue bite)
async function scenarioParry() {
  out('\n== scenario PARRY (blue bite: timed RMB tap; mashed / early / late presses) ==');
  const G = build();
  const { game } = G;
  fightSetup(G);
  const d = game.dragon, p = game.player;
  assert(game.state === 'boss' && d.state === 'combat' && d.debug.aiEnabled === false, 'boss fight, dragon AI off');
  // timed parry
  settle(G);
  place(G, 6);
  const r = forceAttack(G, 'bite', { answer: 'parry' });
  const err = r.hitT - r.impactT;
  out(`   bite: tell ${r.tell} impactIn ${r.impactIn?.toFixed(3)} · RMB ${(r.pressLead ?? NaN).toFixed(3)} s before the predicted impact · hit landed ${(err * 1000).toFixed(0)} ms off the prediction · result ${r.res}`);
  assert(r.trigger === true, 'lab.trigger(bite) → dragon.debug.trigger');
  assert(r.tell === TELL.BLUE, 'bite announces a blue tell');
  assert(r.impactIn >= 0.7, `bite windup readable (impactIn ${r.impactIn?.toFixed(2)} ≥ 0.7)`);
  assert(evn(r, 'combat:flash') === 1, 'one combat:flash for the bite');
  assert(Math.abs(err) <= 0.06, `bite lands within 60 ms of combat:tell impactIn (${(err * 1000).toFixed(0)} ms)`);
  assert(r.res === RESULT.PARRIED, `player.takeHit → 'parried' (got ${r.res})`);
  assert(evn(r, 'player:parry') === 1 && evn(r, 'dragon:parried') === 1, 'player:parry + dragon:parried emitted once');
  assert(r.hpAtHit === r.hp0, `player HP unchanged by a parry (${r.hp0} → ${r.hpAtHit})`);
  assert(r.postureAtHit - r.posture0 >= POSTURE.parry.blue - 0.5, `dragon posture +${(r.postureAtHit - r.posture0).toFixed(1)} (POSTURE.parry.blue ${POSTURE.parry.blue})`);
  assert(d.brain.action?.name === 'recoil' || evn(r, 'dragon:postureBreak') > 0, `parried bite → recoil (action ${d.brain.action?.name})`);
  const tr = game.lab.trainer.results[0];
  out('   timing trainer:', tr ? `${tr.kind} ${tr.text} Δ${tr.drift}ms` : 'n/a');
  assert(tr?.kind === 'parry', 'Lab timing trainer graded the parry');
  // mashed RMB: anti-mash rearm → no parry
  settle(G);
  place(G, 6);
  const m = forceAttack(G, 'bite', { answer: 'mash' });
  out('   mashed RMB → result', m.res);
  assert(m.res !== null && m.res !== RESULT.PARRIED && evn(m, 'player:parry') === 0, `mashed RMB does not parry (got ${m.res})`);
  // early press (outside the window) / late press (after the impact)
  for (const answer of ['early', 'late']) {
    settle(G);
    place(G, 6);
    const x = forceAttack(G, 'bite', { answer });
    out(`   ${answer} RMB (${(x.pressLead ?? NaN).toFixed(2)} s) → result`, x.res);
    assert(x.res === RESULT.HIT && evn(x, 'player:parry') === 0 && x.hpAtHit < x.hp0, `${answer} RMB press does not parry (got ${x.res}, hp ${x.hp0} → ${x.hpAtHit})`);
  }
  // a normal-tell hit of the claw combo can be parried too, and a parry ends the string
  settle(G);
  place(G, 6);
  const cc = forceAttack(G, 'clawCombo', { answer: 'parry', max: 4, settle: 90 });
  out('   clawCombo hit 1 → result', cc.res, 'tells', evn(cc, 'combat:tell'));
  assert(cc.res === RESULT.PARRIED && evn(cc, 'dragon:parried') === 1, `normal-tell combo hit parried (got ${cc.res})`);
  assert(evn(cc, 'combat:tell') === 1, 'a parry ends the combo (no later hit announced)');
  return G;
}

// ================================================================== scenario: block (hold RMB)
async function scenarioBlock() {
  out('\n== scenario BLOCK (hold RMB: normal swipe, blue bite; charged thrust; RMB cancels a charge) ==');
  const G = build();
  const { game } = G;
  fightSetup(G);
  const d = game.dragon, p = game.player;
  settle(G);
  place(G, 5.5, 0.5);
  const r = forceAttack(G, 'swipe', { hold: true });
  const want = TUNING.attacks.swipe.damage * (1 - DEFENSE.blockReduction.normal);
  out(`   swipe: tell ${r.tell} result ${r.res} hp ${r.hp0} → ${r.hpAtHit} (expected -${want.toFixed(2)})`);
  assert(r.tell === TELL.NORMAL, 'swipe announces a normal tell');
  assert(r.res === RESULT.BLOCKED, `held guard → 'blocked' (got ${r.res})`);
  assert(near(r.hp0 - r.hpAtHit, want, 0.01), `blocked damage reduced by DEFENSE.blockReduction.normal (${(r.hp0 - r.hpAtHit).toFixed(2)})`);
  assert(evn(r, 'player:block') === 1 && evn(r, 'player:hurt') === 0, 'player:block emitted, no player:hurt');
  assert(evn(r, 'player:parry') === 0, 'holding block from before the windup is not a parry');
  settle(G);
  place(G, 6);
  const b = forceAttack(G, 'bite', { hold: true });
  const wantB = TUNING.attacks.bite.damage * (1 - DEFENSE.blockReduction.blue);
  out(`   bite: result ${b.res} hp ${b.hp0} → ${b.hpAtHit} (expected -${wantB.toFixed(2)})`);
  assert(b.res === RESULT.BLOCKED && near(b.hp0 - b.hpAtHit, wantB, 0.01), `blocked blue bite chips by DEFENSE.blockReduction.blue (${(b.hp0 - b.hpAtHit).toFixed(2)})`);
  assert(p.blocking === true || p.state === 'block', 'guard still up after a blocked blue hit');
  // charged thrust: hold LMB past the charge threshold, release (no stamina cost). From the flank:
  // the 25 % bigger wyrm's chest sits above sword height, so straight ahead only the head (when low) is in reach
  settle(G);
  place(G, 3, Math.PI / 2);
  const seen = [];
  G.watch = (n, dd) => { if (/^player:(charge|attack|hitDragon)$/.test(n)) seen.push([n, dd]); };
  G.input.press(0);
  run(G, 1.3, { passive: true });
  const charging = p.state === 'charge', k = p.chargeK;
  G.input.up(0);
  run(G, 1.0, { passive: true });
  const ch = seen.filter((e) => e[0] === 'player:charge'), atk = seen.filter((e) => e[0] === 'player:attack'), hit = seen.find((e) => e[0] === 'player:hitDragon');
  out(`   heavy: charging ${charging} k ${k?.toFixed(2)} · charge events ${ch.length} (t ${ch[0]?.[1]?.t}) · attacks ${JSON.stringify(atk.map((e) => e[1]))} · hit ${hit ? `${hit[1].damage} heavy ${hit[1].heavy}` : 'none'}`);
  assert(charging && k >= 0.99 && ch.length === 1 && ch[0][1].t > 0, 'LMB hold → charge state, one player:charge {t}');
  assert(atk.length === 1 && atk[0][1].kind === 'thrust' && atk[0][1].charge >= 0.99, 'release → one player:attack {kind:thrust, charge 1} (no light swing first)');
  assert(hit?.[1]?.heavy === true && hit?.[1]?.kind === 'thrust', 'charged thrust connects (player:hitDragon heavy, kind thrust)');
  // RMB cancels a charge into the guard; releasing LMB afterwards does not fire the heavy
  settle(G);
  seen.length = 0;
  G.input.press(0);
  run(G, 0.6, { passive: true });
  const wasCharging = p.state === 'charge';
  G.input.press(2);
  run(G, 0.1, { passive: true });
  const blockingNow = p.state === 'block' && p.blocking;
  G.input.up(0);
  run(G, 0.5, { passive: true });
  G.input.up(2);
  run(G, 0.3, { passive: true });
  G.watch = null;
  assert(wasCharging && blockingNow && !seen.some((e) => e[0] === 'player:attack'), `RMB cancels a charge into block, no heavy on release (${seen.map((e) => e[0]).join(',')})`);
  return G;
}

// ================================================================== scenario: reach (every hero attack, from the front)
async function scenarioReach() {
  out('\n== scenario REACH (idle wyrm, hero straight in front: light 1, light 2, slam, thrust at 2-3.5 m) ==');
  const G = build();
  const { game, input } = G;
  fightSetup(G);
  const d = game.dragon, p = game.player;
  settle(G);
  const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
  // the wyrm's front hurt surface at sword reach: the most forward body sphere (its chest, 2-4 m up)
  const chest = () => d.hurtSpheres.filter((h) => h.part === 'body').reduce((a, h) => ((h.x - d.position.x) * fx + (h.z - d.position.z) * fz > (a.x - d.position.x) * fx + (a.z - d.position.z) * fz ? h : a));
  const surf = () => { const c = chest(); return Math.hypot(p.position.x - c.x, p.position.z - c.z) - c.r; };
  const c0 = chest();
  out(`   chest sphere: ${((c0.x - d.position.x) * fx + (c0.z - d.position.z) * fz).toFixed(2)} m ahead of the root, y ${c0.y.toFixed(2)} (r ${c0.r.toFixed(2)}): above sword height`);
  /** Hero `gap` m (horizontal) from the chest surface, straight in front, facing it; fresh wyrm. */
  const stand = (gap) => {
    const c = chest();
    p.debug.teleport(c.x + fx * (c.r + gap), c.z + fz * (c.r + gap));
    p.yaw = Math.atan2(c.x - p.position.x, c.z - p.position.z);
    p.debug.heal();
    aimAt(G);
  };
  const fresh = () => { d.hp = d.maxHp; d.posture = 0; run(G, 1.0, { passive: true }); settle(G); };
  const KINDS = { L1: 'light', L2: 'light', slam: 'slam', thrust: 'thrust' };
  const CHARGE_HOLD = 1.3; // s: a full charge
  /** One measured attack at `gap`; earlier combo hits swing in open air far from the wyrm. */
  const trial = (name, gap) => {
    fresh();
    let hit = null, at = NaN, slamEv = 0;
    const kinds = [];
    if (name === 'thrust') {
      stand(gap);
      at = surf();
      G.watch = (n, dd) => { if (n === 'player:hitDragon' && !hit) hit = dd; if (n === 'player:attack') kinds.push(dd.kind); };
      input.press(0);
      run(G, CHARGE_HOLD, { passive: true });
      aimAt(G);
      input.up(0);
      run(G, 1.0, { passive: true });
    } else {
      const n = name === 'L1' ? 1 : name === 'L2' ? 2 : 3;
      if (n > 1) { p.debug.teleport(d.position.x + fx * 40, d.position.z + fz * 40); aimAt(G); }
      for (let k = 0; k < n; k++) {
        if (k === n - 1) {
          stand(gap);
          at = surf();
          G.watch = (nn, dd) => { if (nn === 'player:hitDragon' && !hit) hit = dd; if (nn === 'player:attack') kinds.push(dd.kind); if (nn === 'player:slam') slamEv++; };
        }
        aimAt(G);
        input.click(0);
        run(G, k < n - 1 ? 0.3 : 1.3, { passive: true });
      }
    }
    G.watch = null;
    return { name, gap, at, hit, kinds, slamEv };
  };
  // (CHARGE_HOLD hoisted above)
  const rows = [];
  for (const gap of [0, 2, 2.5, 3, 3.5]) {
    const r = ['L1', 'L2', 'slam', 'thrust'].map((nm) => trial(nm, gap));
    rows.push(r);
    out(`   ${gap ? `${gap.toFixed(1)} m` : 'contact'}`.padEnd(12) + r.map((t) => `${t.name} ${t.hit ? `${t.hit.kind}/${t.hit.part} ${Math.round(t.hit.damage)}` : 'MISS'} @${t.at.toFixed(2)}`.padEnd(30)).join(''));
  }
  for (const r of rows) for (const t of r) {
    const where = t.gap ? `${t.gap} m` : 'contact';
    assert(!!t.hit && t.hit.kind === KINDS[t.name] && t.kinds[0] === KINDS[t.name], `${t.name} connects from the front at ${where} (${t.hit ? `${t.hit.kind} on ${t.hit.part}` : 'miss'}, hero ${t.at.toFixed(2)} m from the chest surface)`);
  }
  assert(rows.every((r) => r[2].slamEv === 1), 'the slam meets the ground once per swing (player:slam)');
  assert(rows.every((r) => r[2].hit?.heavy === true && r[3].hit?.heavy === true && r[0].hit?.heavy === false), 'slam and thrust hit heavy, light sweeps do not');
  return G;
}

// ================================================================== scenario: red tells (tail, stomp)
async function scenarioRed() {
  out('\n== scenario RED (tail / stomp: block fails, perfect dodge → the plunge → crit) ==');
  const G = build();
  const { game, input } = G;
  fightSetup(G);
  const d = game.dragon, p = game.player;
  // the wyrm itself warns (no HUD marks): uWarn ramps through the red windup, spikes on the timing
  // flash and decays; the HUD only flashes the screen edges on the cue; parryable windups never glow
  {
    const W = TELL_STYLE.red.warn;
    const mats = Object.values(d.model.mats);
    assert(mats.length > 0 && mats.every((m) => m.uniforms.uWarn?.value?.isVector4), 'every dragon material has a uWarn vec4');
    assert(!cls('ab-tell') && !cls('ab-tells'), 'no HUD tell marks exist');
    settle(G);
    place(G, 16); // out of reach: only watch the tell
    const tr = warnTrace(G, 'tail', 5);
    const { tellI: ti, flashI: fi } = tr;
    const wind = tr.w.slice(ti, fi);
    const after = fi + Math.ceil(W.decay / DT) + 1;
    out(`   tail warn: tell@${ti} flash@${fi} · windup ${wind[0]?.toFixed(3)} → ${wind[wind.length - 1]?.toFixed(3)} · flash ${tr.w[fi]?.toFixed(3)} · +${W.decay}s ${tr.w[after]?.toFixed(3)} · edge at flash ${tr.edge[fi]}`);
    assert(tr.trigger && ti >= 0 && fi > ti, `tail tell + flash seen (tell@${ti} flash@${fi})`);
    assert(tr.w.slice(0, ti).every((v) => v === 0), 'no red glow before the red tell');
    assert(wind.length > 10 && near(wind[0], W.from, 0.03) && wind[wind.length - 1] > W.to - 0.1 && wind.every((v, i) => v >= W.from - 1e-9 && v <= W.to + 1e-9 && (i === 0 || v >= wind[i - 1] - 1e-9)), 'red windup glow ramps from→to between tell and flash');
    assert(near(tr.w[fi], W.spike, 1e-6), `red glow spikes on the timing flash (${tr.w[fi]})`);
    assert(tr.w.slice(fi, after).every((v, i, a) => i === 0 || v <= a[i - 1] + 1e-9) && tr.w[after] === 0, 'spike decays to 0 within the decay time');
    assert(tr.uniformOk && tr.finite, 'every material uWarn.w follows dragon.warn (finite)');
    assert(tr.edge.slice(0, fi).every((v) => v === 0) && tr.edge[fi] > 0.2, `HUD red edge only flashes on the cue (${tr.edge[fi]})`);
    assert(tr.edge[tr.edge.length - 1] === 0, 'HUD red edge flash fades out');
    // parryable: no glow, no edge flash (the white glint is a particle burst)
    settle(G);
    place(G, 16);
    const bt = warnTrace(G, 'bite', 3);
    assert(bt.flashI >= 0 && Math.max(...bt.w) === 0 && Math.max(...bt.edge) === 0, `blue bite: no red glow / edge (flash@${bt.flashI} max ${Math.max(...bt.w)})`);
    // a stagger mid-windup clears the glow at once
    settle(G);
    place(G, 16);
    const st = warnTrace(G, 'tail', 5, (t) => t.w[t.w.length - 1] > 0.3);
    assert(st.w[st.w.length - 1] > 0.3 && d.debug.stagger() === true, 'stagger mid red windup');
    G.tick(DT);
    assert(d.warn === 0 && mats.every((m) => m.uniforms.uWarn.value.w === 0), `stagger clears the red glow (${d.warn})`);
  }
  // holding block against red: guard break, full damage
  settle(G);
  place(G, 6);
  const gb = forceAttack(G, 'tail', { hold: true });
  out(`   tail vs guard: tell ${gb.tell} result ${gb.res} hp ${gb.hp0} → ${gb.hpAtHit} state ${p.state}`);
  assert(gb.tell === TELL.RED, 'tail announces a red tell');
  assert(gb.res === RESULT.HIT && evn(gb, 'player:guardBreak') === 1, `guard break on a red attack (got ${gb.res})`);
  assert(near(gb.hp0 - gb.hpAtHit, TUNING.attacks.tail.damage, 0.01), `guard break takes full damage (${gb.hp0 - gb.hpAtHit})`);
  assert(evn(gb, 'player:block') === 0, 'no player:block on a red attack');
  // a timed RMB tap does not parry red either
  settle(G);
  place(G, 6);
  const rp = forceAttack(G, 'tail', { answer: 'parry' });
  assert(rp.res === RESULT.HIT && evn(rp, 'player:parry') === 0, `red tail is not parryable (got ${rp.res})`);
  // perfect dodge: Space 0.1 s before impact → the plunge onto the wyrm's head (slow-mo at the
  // vanish), then the landing in front of the head with the crit window open (scenario PLUNGE
  // covers the move itself)
  settle(G);
  place(G, 6);
  const pd = forceAttack(G, 'tail', { answer: 'dodge', settle: 1 });
  out(`   tail dodge: Space ${(pd.pressLead ?? NaN).toFixed(3)} s before · result ${pd.res} · state ${p.state} · slow-mo x${game.hitstopScale} for ${game.hitstopTimer.toFixed(2)} s`);
  assert(pd.res === RESULT.PERFECT, `perfect dodge → 'perfectDodge' (got ${pd.res})`);
  assert(evn(pd, 'player:perfectDodge') === 1 && evn(pd, 'player:ghostep') === 1, 'player:perfectDodge + player:ghostep emitted');
  assert(pd.hpAtHit === pd.hp0, 'no damage on a perfect dodge');
  assert(p.state === 'plunge', `a perfect dodge of the wyrm in range → the plunge (state ${p.state})`);
  assert(near(game.hitstopScale, DEFENSE.ghostep.slowmoScale, 1e-6) || p.slowmoPending > 0, `Ghostep slow-mo x${DEFENSE.ghostep.slowmoScale} (got x${game.hitstopScale})`);
  run(G, 4, { passive: true }, () => p.state !== 'plunge');
  {
    const dist = Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z);
    out(`   the plunge landed ${dist.toFixed(2)} m from the wyrm's root, y ${p.position.y}, crit ${p.critTimer.toFixed(2)}`);
    assert(p.state !== 'plunge' && p.position.y === 0 && Number.isFinite(dist), 'the plunge ends back on the ground');
  }
  assert(p.critTimer > 0, `crit window open after the landing (critTimer ${p.critTimer.toFixed(2)})`);
  // the next hit carries crit
  let crit = null;
  G.watch = (n, dd) => { if (n === 'player:hitDragon' && !crit) crit = dd; };
  for (let i = 0; i < 120 && !crit && p.critTimer > 0; i++) {
    input.axis = { x: 0, y: 0 };
    if (i % 12 === 0) input.click(0);
    G.tick(DT);
  }
  G.watch = null;
  out('   first hit after the plunge:', crit ? `damage ${crit.damage} part ${crit.part} crit ${crit.crit}` : 'none');
  assert(crit?.crit === true, 'next hit inside the crit window carries crit');
  // stomp: red AoE, perfect dodge as well
  settle(G);
  place(G, 3.6);
  const st = forceAttack(G, 'stomp', { answer: 'dodge', settle: 1 });
  out(`   stomp dodge: result ${st.res}`);
  assert(st.tell === TELL.RED && st.res === RESULT.PERFECT && evn(st, 'player:ghostep') === 1, `stomp perfect dodge → the plunge's blink (got ${st.res})`);
  // a posture break (dragon freeze-frame) during the Ghostep slow-mo must not turn it into a freeze
  const slow0 = game.hitstopScale, left0 = game.hitstopTimer;
  assert(d.debug.postureBreak() === true, 'posture break during the Ghostep slow-mo');
  G.tick(DT);
  out(`   slow-mo x${slow0} ${left0.toFixed(2)} s left → after the break x${game.hitstopScale} ${game.hitstopTimer.toFixed(2)} s`);
  assert(near(game.hitstopScale, DEFENSE.ghostep.slowmoScale, 1e-6), `Ghostep slow-mo survives the break freeze (x${game.hitstopScale})`);
  return G;
}

// ================================================================== scenario: the plunge (contract 2, player side)
/** Projected NDC of a world point with the game camera (the real CameraRig drives it). */
function ndc(G, x, y, z) {
  const v = new THREE.Vector3(x, y, z).project(G.game.camera);
  return { x: v.x, y: v.y, ok: Number.isFinite(v.x + v.y) && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
}

async function scenarioPlunge() {
  out('\n== scenario PLUNGE (perfect dodge → dive onto the head, ride, backflip off; plunge:false / out of range / no API; execution; in the air) ==');
  const G = build();
  const { game, input } = G;
  fightSetup(G);
  const d = game.dragon, p = game.player, P = DEFENSE.plunge;
  const bound = CONFIG.world.playerBound;
  const head = new THREE.Vector3();
  const inBody = (x, z, r) => d.bodyCircles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + r);
  /** Tick until the plunge ends (≤ max s): its track, i-frames, camera framing, phases seen. */
  const ride = (max = 5) => {
    const tr = { maxY: 0, phases: new Set(), iframes: true, finite: true, offscreen: 0, frames: 0, ignored: true };
    for (let i = 0; i < Math.round(max / DT) && p.state === 'plunge'; i++) {
      aimAt(G);
      G.tick(DT);
      if (p.state !== 'plunge') break;
      tr.frames++;
      tr.phases.add(p.plungeAnim.phase);
      tr.maxY = Math.max(tr.maxY, p.position.y);
      if (!p.isInvulnerable()) tr.iframes = false;
      if (![p.position.x, p.position.y, p.position.z].every(Number.isFinite)) tr.finite = false;
      // the camera keeps the hero and the head on screen through the move
      d.plungePoint(head);
      // (the vanish is invisible: the camera only has to have him once he reappears)
      if (p.plungeAnim.phase > 0 && (!ndc(G, p.position.x, p.position.y + 1.1, p.position.z).ok || !ndc(G, head.x, head.y, head.z).ok)) {
        tr.offscreen++;
        if (process.env.ABYSS_TRACE) out('     OFF', p.plungeAnim.phase, p.plungeAnim.u.toFixed(2), JSON.stringify(ndc(G, p.position.x, p.position.y + 1.1, p.position.z)), JSON.stringify(ndc(G, head.x, head.y, head.z)));
      }
      if (i === 5) {
        const hp = p.hp;
        tr.ignored = p.takeHit({ damage: 40, tell: TELL.NORMAL, attack: 'bite', from: { x: d.position.x, z: d.position.z }, attacker: d, knockback: 3 }) === RESULT.IGNORED && p.hp === hp;
      }
    }
    tr.state = p.state;
    return tr;
  };
  const since = (c0, n) => (G.counts[n] || 0) - (c0[n] || 0);

  // 1) a perfect dodge of the bite, in range → the plunge, one hit on the head, a landing in front
  settle(G);
  place(G, 6);
  const origin = p.position.clone();
  const hp0 = d.hp, c0 = { ...G.counts };
  const r = forceAttack(G, 'bite', { answer: 'dodge', settle: 1 });
  const plunging = p.state === 'plunge';
  const lift = p.position.y;
  const head0 = d.plungePoint(new THREE.Vector3()), root0 = d.position.clone(), yaw0 = d.yaw, dir0 = { x: p.pl.dx, z: p.pl.dz };
  const tr = ride();
  const dealt = hp0 - d.hp;
  d.plungePoint(head);
  const L = p.position;
  // measured from the head where he dodged it (the wyrm's reaction moves the head afterwards)
  const toO = { x: origin.x - head0.x, z: origin.z - head0.z }, toL = { x: L.x - head0.x, z: L.z - head0.z };
  const side = (toO.x * toL.x + toO.z * toL.z) / ((Math.hypot(toO.x, toO.z) * Math.hypot(toL.x, toL.z)) || 1);
  const F0 = { x: Math.sin(yaw0), z: Math.cos(yaw0) };
  const ahead = (L.x - root0.x) * F0.x + (L.z - root0.z) * F0.z - ((head0.x - root0.x) * F0.x + (head0.z - root0.z) * F0.z);
  out(`   geometry: root ${root0.x.toFixed(1)},${root0.z.toFixed(1)} yaw ${yaw0.toFixed(2)} · head at the dodge ${head0.x.toFixed(1)},${head0.z.toFixed(1)} · origin ${origin.x.toFixed(1)},${origin.z.toFixed(1)} · spring-off dir ${dir0.x.toFixed(2)},${dir0.z.toFixed(2)} · head now ${head.x.toFixed(1)},${head.z.toFixed(1)} · landed ${L.x.toFixed(1)},${L.z.toFixed(1)}`);
  out(`   bite dodge: ${r.res} → state ${plunging ? 'plunge' : p.state}, reappears ${lift.toFixed(1)} m up · phases ${[...tr.phases].join('')} in ${(tr.frames * DT).toFixed(2)} s · max y ${tr.maxY.toFixed(1)} · head damage ${dealt} · landed ${Math.hypot(toL.x, toL.z).toFixed(1)} m from the head (cos to the origin side ${side.toFixed(2)}, ${ahead.toFixed(1)} m ahead) · crit ${p.critTimer.toFixed(2)} · off-screen frames ${tr.offscreen}`);
  assert(r.res === RESULT.PERFECT && plunging, `a perfect dodge of the wyrm in range → the plunge (${r.res}, ${plunging})`);
  assert(evn(r, 'player:perfectDodge') === 1 && evn(r, 'player:ghostep') === 1, 'player:perfectDodge + player:ghostep still emitted (the HUD call-out, stats)');
  assert(lift >= P.appearUp && lift > head.y, `reappears above the head (${lift.toFixed(1)} m)`);
  assert(tr.ignored, 'hits are ignored mid-plunge');
  assert(tr.iframes && tr.finite, 'invulnerable and finite throughout');
  assert([1, 2, 3, 4, 5].every((ph) => tr.phases.has(ph)), `hang → dive → ride → flip → land (${[...tr.phases].join('')})`);
  assert(since(c0, 'player:plunge') === 1 && since(c0, 'player:plungeHit') === 1, `one dive, one hit (${since(c0, 'player:plunge')} / ${since(c0, 'player:plungeHit')})`);
  assert(near(dealt, Math.round(P.damage * TUNING.partMult.head), 1), `the blade hits the head once: ${dealt} (DEFENSE.plunge.damage ${P.damage} × head)`);
  assert(tr.state !== 'plunge' && tr.frames * DT < 3.2, `the move ends (${(tr.frames * DT).toFixed(2)} s)`);
  assert(L.y === 0 && Math.hypot(L.x, L.z) <= bound && !inBody(L.x, L.z, p.radius - 0.05), 'lands on the ground, inside the arena, clear of the body');
  assert(side > 0.3 && ahead > 0 && Math.hypot(toL.x, toL.z) >= P.landMin - 1, `lands in front of the head, toward where he came from (cos ${side.toFixed(2)}, ${ahead.toFixed(1)} m ahead of it)`);
  assert(p.critTimer > 0, 'the crit window is open after the landing');
  assert(tr.offscreen === 0, `the camera kept the hero and the head on screen (${tr.offscreen} frames off)`);

  // 2) a hit that forbids the plunge (hazards: plunge:false) → slow-mo + crit, no teleport
  settle(G);
  place(G, 6);
  input.axis = { x: 1, y: 0 };
  input.tap('Space');
  G.tick(DT);
  G.tick(DT);
  input.axis = { x: 0, y: 0 };
  const pos = p.position.clone();
  const c1 = { ...G.counts };
  const r2 = p.takeHit({ damage: 30, tell: TELL.RED, kind: 'meteor', attack: 'meteor', from: { x: pos.x + 1, z: pos.z }, attacker: d, knockback: 3, plunge: false });
  out(`   plunge:false: ${r2} → state ${p.state}, moved ${pos.distanceTo(p.position).toFixed(2)} m, crit ${p.critTimer.toFixed(2)}`);
  assert(r2 === RESULT.PERFECT && p.state === 'ghostep' && pos.distanceTo(p.position) < 0.3 && p.critTimer > 0, 'plunge:false → a perfect dodge without the teleport (slow-mo + crit)');
  assert(since(c1, 'player:plunge') === 0 && since(c1, 'player:perfectDodge') === 1, 'no plunge, one perfect dodge');

  // 3) out of range (> DEFENSE.plunge.range from the head) → no teleport either
  settle(G);
  d.plungePoint(head);
  {
    const a = d.yaw + Math.PI;
    const far = P.range + 3;
    let x = head.x + Math.sin(a) * far, z = head.z + Math.cos(a) * far;
    if (Math.hypot(x, z) > bound - 1) { x = head.x - Math.sin(a) * far; z = head.z - Math.cos(a) * far; }
    p.debug.teleport(x, z);
  }
  input.axis = { x: 0, y: 1 };
  input.tap('Space');
  G.tick(DT);
  input.axis = { x: 0, y: 0 };
  const posF = p.position.clone();
  const r3 = p.takeHit({ damage: 20, tell: TELL.RED, attack: 'fireball', from: { x: d.position.x, z: d.position.z }, attacker: d, knockback: 3 });
  out(`   out of range (${Math.hypot(posF.x - head.x, posF.z - head.z).toFixed(1)} m from the head): ${r3} → state ${p.state}`);
  assert(r3 === RESULT.PERFECT && p.state === 'ghostep' && posF.distanceTo(p.position) < 0.3, 'out of range → a perfect dodge in place');

  // 4) an attacker without the plunge API → the v0.2 Ghostep (blink behind it)
  settle(G);
  place(G, 6);
  const mob = { position: new THREE.Vector3(p.position.x + 3, 0, p.position.z), yaw: -Math.PI / 2 };
  input.axis = { x: 1, y: 0 };
  input.tap('Space');
  G.tick(DT);
  input.axis = { x: 0, y: 0 };
  const r4 = p.takeHit({ damage: 20, tell: TELL.RED, attack: 'slash', attacker: mob, knockback: 2 });
  const behind = (p.position.x - mob.position.x) * Math.sin(mob.yaw) + (p.position.z - mob.position.z) * Math.cos(mob.yaw);
  out(`   no plunge API: ${r4} → ${behind.toFixed(2)} m along its facing`);
  assert(r4 === RESULT.PERFECT && p.state === 'ghostep' && behind < -1, 'an attacker without plungePoint / onPlunge: Ghostep behind it');

  // 5) execution: posture broken, attack within execRange of the head → the plunge from the hang
  run(G, 1.5, { passive: true });
  settle(G);
  place(G, 6);
  assert(d.debug.postureBreak() === true, 'posture break (Lab)');
  run(G, 0.6, { passive: true });
  d.plungePoint(head);
  {
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
    p.debug.teleport(head.x + fx * 4, head.z + fz * 4);
    aimAt(G);
  }
  const c5 = { ...G.counts }, hp5 = d.hp;
  let execEv = null;
  G.watch = (n, dd) => { if (n === 'player:plunge') execEv = dd; };
  input.click(0);
  G.tick(DT);
  const execStarted = p.state === 'plunge' && p.pl.exec === true;
  const tr5 = ride();
  G.watch = null;
  const dealt5 = hp5 - d.hp;
  out(`   execution: started ${execStarted} · event ${JSON.stringify(execEv)} · damage ${dealt5} · broken after ${d.broken} · perfectDodge events ${since(c5, 'player:perfectDodge')}`);
  assert(execStarted && execEv?.execution === true, 'attack near a broken wyrm\'s head → the plunge as an execution (player:plunge {execution: true})');
  assert(since(c5, 'player:perfectDodge') === 0 && since(c5, 'player:attack') === 0, 'no perfect dodge, no light swing');
  assert(dealt5 >= P.execDamage, `execution damage ${dealt5} (≥ DEFENSE.plunge.execDamage ${P.execDamage})`);
  assert(tr5.state !== 'plunge' && p.position.y === 0 && !d.broken, 'the execution lands and consumes the break');

  // 6) onto a wyrm in the air (the leap): the camera keeps both on screen, he lands on the ground
  settle(G);
  place(G, 11);
  game.lab.trigger('leap');
  run(G, 3, { passive: true }, () => d.state === 'airborne' && d.rig.s.alt > 6);
  const alt = d.rig.s.alt;
  const started = p.debug.plunge(false);
  const tr6 = ride(6);
  out(`   in the air: wyrm alt ${alt.toFixed(1)} m · plunge ${started} · max y ${tr6.maxY.toFixed(1)} · phases ${[...tr6.phases].join('')} · landed y ${p.position.y} · off-screen ${tr6.offscreen} · wyrm ${d.state}`);
  assert(started && alt > 6 && tr6.maxY > alt + 5, 'the plunge reaches a flying wyrm\'s head');
  assert(tr6.state !== 'plunge' && tr6.finite && p.position.y === 0 && Math.hypot(p.position.x, p.position.z) <= bound, 'and lands on the ground inside the arena');
  assert(tr6.offscreen === 0, `the camera kept the hero and the head on screen in the air (${tr6.offscreen} frames off)`);

  // 7) the flying wyrm alone (no plunge): its head stays framed through the leap
  settle(G);
  place(G, 11);
  game.lab.trigger('leap');
  let air = 0, airOff = 0;
  for (let i = 0; i < Math.round(4 / DT); i++) {
    aimAt(G);
    G.tick(DT);
    if (d.state !== 'airborne' || d.rig.s.alt < 4) continue;
    air++;
    const hs = d.hurtSpheres.find((h) => h.part === 'head');
    if (!ndc(G, hs.x, hs.y, hs.z).ok || !ndc(G, p.position.x, 1.1, p.position.z).ok) airOff++;
  }
  out(`   the leap: ${air} airborne frames, head or hero off screen in ${airOff}`);
  assert(air > 20 && airOff <= 2, `the leap keeps the flying head and the hero on screen (${airOff} of ${air} frames off)`);
  return G;
}

// ================================================================== scenario: deflect chain (contract 1, player side)
async function scenarioDeflect() {
  out('\n== scenario DEFLECT (a string parried in rhythm: tap, release, tap; 0.45 s between impacts) ==');
  const G = build();
  const { game, input } = G;
  fightSetup(G);
  const d = game.dragon, p = game.player;
  /**
   * Blows 0.45 s (game) apart from the dragon; a human taps RMB `lead` s (game) before each impact
   * and lets go after `hold` s of REAL time (the parry freeze stretches real time).
   */
  const string = (n, gap, hold, lead = 0.12) => {
    settle(G);
    run(G, TUNE_P.deflectChainGap + 0.2, { passive: true }); // a fresh chain (parries > the gap apart restart it)
    place(G, 6);
    const res = [], chains = [];
    const c0 = { ...G.counts };
    const T0 = game.time + 0.5;
    let k = 0, downAt = -1, pressedFor = -1;
    G.watch = (nm, dd) => { if (nm === 'player:parry') chains.push(dd.chain); };
    for (let i = 0; i < 600 && k < n; i++) {
      const impact = T0 + k * gap;
      // blow k's tap: down `lead` s before its impact (a held button can't be pressed again), up `hold` real s later
      if (pressedFor !== k && game.time >= impact - lead - 1e-9) {
        pressedFor = k;
        if (!input.buttons[2]) {
          input.press(2);
          downAt = game.realTime;
        }
      }
      if (input.buttons[2] && game.realTime - downAt >= hold - 1e-9) input.up(2);
      if (game.time >= impact - 1e-9) {
        d.posture = 0; // (the meter would break the wyrm mid-string; not under test here)
        res.push(d.hitPlayer({ damage: 18, attack: 'clawCombo', tell: TELL.NORMAL, knockback: 1, kind: 'claw' }));
        // (the dragon's onParried emits this once dragon-melee's strings land; stand in for it here)
        if (res.length >= 2 && res.every((x) => x === RESULT.PARRIED)) game.events.emit('combat:deflectChain', { count: res.length });
        k++;
      }
      aimAt(G);
      G.tick(DT);
    }
    input.up(2);
    G.watch = null;
    run(G, 0.3, { passive: true });
    return { res, chains, parries: (G.counts['player:parry'] || 0) - (c0['player:parry'] || 0), hurt: (G.counts['player:hurt'] || 0) - (c0['player:hurt'] || 0) };
  };
  for (const hold of [0.08, 0.15, 0.2]) {
    const s = string(5, 0.45, hold);
    out(`   5 blows 0.45 s apart, taps held ${hold} s: ${s.res.join(' ')} · chain ${s.chains.join(',')} · hurt ${s.hurt}`);
    assert(s.res.length === 5 && s.res.every((x) => x === RESULT.PARRIED) && s.hurt === 0, `every blow of the string deflected (taps of ${hold} s)`);
    assert(s.chains.join(',') === '1,2,3,4,5', `player:parry counts the chain up (${s.chains.join(',')})`);
  }
  // the HUD turns the parry call-out into "DEFLECT ×N"
  const calls = ui.findAll((e) => e.classList?.contains('ab-call') && e.classList?.contains('on')).map((e) => e.textContent);
  out('   call-outs:', JSON.stringify(calls));
  assert(calls.some((t) => /DEFLECT ×5/.test(t)), 'combat:deflectChain → a "DEFLECT ×N" call-out');
  // mashing is still not a parry: a press without a full re-arm (released < parryRearm before) fails
  const m = string(2, 0.3, 0.2);
  out(`   2 blows 0.3 s apart, taps held 0.2 s (no time to re-arm): ${m.res.join(' ')}`);
  assert(m.res[0] === RESULT.PARRIED && m.res[1] !== RESULT.PARRIED, 'faster than the re-arm allows: the second press does not parry (anti-mash kept)');
  // between parries in rhythm the guard lingers up, then eases down
  assert(p.guardHold === 0 || p.guardHold < 1, 'guardHold eases off after the string');
  return G;
}

// ================================================================== scenario: Lab + debug APIs
async function scenarioLab() {
  out('\n== scenario LAB (Lab panel, every ability, posture break, time scale, flow states) ==');
  const G = build();
  const { game, counts } = G;
  const lab = game.lab, d = game.dragon, p = game.player, flow = game.flow;
  run(G, 2.0);
  G.input.tap('F1');
  G.tick(DT);
  assert(lab.open === true && !!cls('lab-root'), 'F1 opens the Lab panel');
  assert(game.state === 'title', 'F1 does not dismiss the title');
  assert(flow.debug.toState('nope') === false, "flow.debug.toState('nope') → false");
  // boss
  assert(flow.debug.toState('boss') === true, 'toState(boss) from title');
  run(G, 0.5, { passive: true });
  assert(game.state === 'boss' && d.state === 'combat', `boss: state ${game.state}, dragon ${d.state}`);
  assert(cls('ab-boss')?.classList.contains('on') && game.audio.musicMode === 'boss', 'boss: bar shown, boss music');
  lab.setHitboxes(true);
  run(G, 0.2, { passive: true });
  assert((lab.overlay?.count?.hurt ?? 0) > 0, `hitbox overlay draws hurt spheres (${lab.overlay?.count?.hurt})`);
  const hb = d.debug.hitboxes();
  assert(Array.isArray(hb) && hb.length > 0 && hb.every((h) => [h.x, h.y, h.z, h.r].every(Number.isFinite) && (h.kind === 'hurt' || h.kind === 'attack')), 'dragon.debug.hitboxes() well-formed');
  p.debug.god = true;
  assert(d.debug.setAI(false) === false && d.debug.aiEnabled === false, 'dragon.debug.setAI(false)');
  // Lab keys while open: digits trigger abilities, [ ] step time — and never reach the game
  settle(G);
  place(G, 6);
  const wk0 = counts['dragon:windup'] || 0;
  let digitSeen = false;
  G.input.tap('Digit1');
  digitSeen = G.input.pressed('Digit1');
  run(G, 1.0, { passive: true });
  assert(!digitSeen && (counts['dragon:windup'] || 0) > wk0, 'Lab key 1 triggers ability 1 and is consumed (game never sees it)');
  G.input.tap('BracketLeft');
  assert(game.debugTimeScale === 0.5 && !G.input.pressed('BracketLeft'), `Lab [ steps time 1 → 0.5 (got ${game.debugTimeScale})`);
  G.input.tap('BracketRight');
  assert(game.debugTimeScale === 1, 'Lab ] steps time back to 1');
  run(G, 4, { passive: true, god: true }, () => !d.brain.action && d.state === 'combat');
  // every ability, in turn
  const abilities = d.debug.abilities();
  assert(Array.isArray(abilities) && abilities.length >= 10, `${abilities.length} abilities listed`);
  assert(abilities.every((a) => typeof a.name === 'string' && typeof a.label === 'string' && TELLS.has(a.tell) && Number.isFinite(a.phase)), 'abilities() entries {name,label,tell,phase}');
  for (const a of abilities) {
    settle(G);
    place(G, a.name === 'breath' || a.name === 'fireball' || a.name === 'charge' ? 11 : 6);
    const e0 = errors.length;
    const r = forceAttack(G, a.name, { max: 9, settle: 600 });
    run(G, 10, { passive: true, god: true }, () => !d.brain.action && d.state === 'combat');
    const ok = r.trigger === true && evn(r, 'dragon:windup') >= 1 && r.tellT !== null && r.tells.includes(a.tell) && errors.length === e0; // multi-hit: abilities() lists the headline tell
    assert(ok, `ability ${a.name.padEnd(9)} [${a.tell}] tells [${r.tells.join(' ')}] trigger ${r.trigger} windup ${evn(r, 'dragon:windup')} tells ${evn(r, 'combat:tell')} flashes ${evn(r, 'combat:flash')} result ${r.res}${errors.length > e0 ? ' ERRORS' : ''}`);
    assert(evn(r, 'combat:flash') >= 1 && evn(r, 'combat:flash') === evn(r, 'combat:tell'), `   ${a.name}: one combat:flash per combat:tell`);
  }
  assert(p.alive, 'god mode kept the hero alive');
  // time scale: 0 freezes game time, 0.5 halves dt (main.js: dt = realDt × scale × debugTimeScale)
  settle(G);
  lab.setTimeScale(0);
  const t0 = game.time, dpos = d.position.clone();
  run(G, 0.5, { passive: true });
  assert(game.time === t0 && d.position.distanceTo(dpos) < 1e-9, 'debugTimeScale 0 freezes game time');
  lab.setTimeScale(0.5);
  run(G, 0.2, { passive: true }, () => game.hitstopTimer <= 0);
  G.tick(DT);
  assert(near(game.dt, DT * 0.5, 1e-9), `debugTimeScale 0.5 → dt ${game.dt.toFixed(5)}`);
  lab.stepTime(+1);
  assert(game.debugTimeScale === 1, `Lab ] steps 0.5 → 1 (got ${game.debugTimeScale})`);
  // posture break
  settle(G);
  const pb0 = counts['dragon:postureBreak'] || 0;
  assert(d.debug.postureBreak() === true, 'dragon.debug.postureBreak()');
  G.tick(DT);
  assert(d.broken === true && d.state === 'staggered' && (counts['dragon:postureBreak'] || 0) === pb0 + 1, `posture break → broken, staggered, dragon:postureBreak (${d.state})`);
  const hp0 = d.hp;
  const dealt = d.takeHit({ damage: 10, part: 'body', point: { x: d.position.x, y: 2, z: d.position.z } });
  assert(dealt === Math.round(10 * POSTURE.breakCritMult) && hp0 - d.hp === dealt, `broken: hits ×${POSTURE.breakCritMult} (dealt ${dealt})`);
  run(G, POSTURE.breakTime + 0.5, { passive: true });
  assert(!d.broken && d.posture < 1, `break ends after ${POSTURE.breakTime} s, meter empty (posture ${d.posture.toFixed(1)})`);
  // ordinary stagger
  settle(G);
  const sg0 = counts['dragon:stagger'] || 0;
  assert(d.debug.stagger() === true, 'dragon.debug.stagger()');
  G.tick(DT);
  assert(d.state === 'staggered' && !d.broken && (counts['dragon:stagger'] || 0) === sg0 + 1, 'stagger → staggered (not broken), dragon:stagger');
  // phase 2 + setHp
  settle(G);
  assert(d.debug.phase2() === true, 'dragon.debug.phase2()');
  run(G, 6, { passive: true }, () => (counts['dragon:phase2'] || 0) >= 1 && !d.brain.action);
  assert(d.phase === 2 && (counts['dragon:phase2'] || 0) === 1 && d.maxPosture === TUNING.posture.max[1], `phase 2 (posture max ${d.maxPosture})`);
  assert(d.debug.setHp(0.3) === true && d.hp === Math.round(d.maxHp * 0.3), `setHp(0.3) → ${d.hp}`);
  // Loop: re-triggers the selected ability (AI stays as the Lab found it)
  settle(G);
  place(G, 6);
  const w0 = counts['dragon:windup'] || 0;
  lab.setLoop(true, 'bite');
  run(G, 9, { passive: true, god: true });
  const loops = lab.loop.count;
  lab.setLoop(false);
  assert(loops >= 2 && (counts['dragon:windup'] || 0) - w0 >= 2, `Loop re-triggered bite ${loops}x`);
  assert(d.debug.aiEnabled === false, 'Loop restored the AI switch as it found it');
  // player debug API
  assert(p.debug.teleport(2, 8) === true && near(p.position.x, 2, 1e-6) && near(p.position.z, 8, 1e-6), 'player.debug.teleport');
  p.hp = 10;
  p.debug.heal();
  assert(p.hp === p.maxHp, 'player.debug.heal');
  // flow states, each with consistent side effects
  p.debug.god = false;
  const died0 = counts['player:died'] || 0;
  assert(flow.debug.toState('dead') === true, 'toState(dead)');
  run(G, 0.3, { passive: true });
  assert(game.state === 'dead' && !p.alive && (counts['player:died'] || 0) === died0 + 1 && game.audio.musicMode === 'death', `dead: state ${game.state}, hero down, player:died, ${game.audio.musicMode} music`);
  assert(flow.debug.toState('explore') === true, 'toState(explore)');
  run(G, 1.0, { passive: true });
  const sp = CONFIG.world.playerSpawn;
  assert(game.state === 'explore' && p.alive && p.hp === p.maxHp && Math.hypot(p.position.x - sp.x, p.position.z - sp.z) < 0.5, `explore: hero respawned at the bonfire (${game.state})`);
  assert(d.state === 'sleeping' && d.hp === d.maxHp && d.phase === 1 && d.posture === 0 && game.audio.musicMode === 'ambient', `explore: dragon asleep, reset; ${game.audio.musicMode} music`);
  assert(!cls('ab-boss')?.classList.contains('on'), 'explore: boss bar hidden');
  assert(flow.debug.toState('boss') === true, 'toState(boss) from explore');
  run(G, 0.5, { passive: true });
  assert(game.state === 'boss' && d.state === 'combat' && cls('ab-boss')?.classList.contains('on'), `boss again: ${game.state} / ${d.state}`);
  const v0 = counts['game:victory'] || 0;
  assert(flow.debug.toState('victory') === true, 'toState(victory)');
  run(G, 15, { passive: true }, () => game.state === 'victory');
  run(G, 1, { passive: true });
  assert(game.state === 'victory' && d.state === 'dead' && (counts['game:victory'] || 0) === v0 + 1 && game.audio.musicMode === 'victory', `victory: ${game.state}, dragon ${d.state}, game:victory, ${game.audio.musicMode} music`);
  assert(flow.debug.toState('boss') === true, 'toState(boss) from victory');
  run(G, 0.5, { passive: true });
  assert(game.state === 'boss' && d.state === 'combat' && d.hp === d.maxHp, `boss after victory: dragon reset and fighting (${d.state}, hp ${d.hp})`);
  // pause → Lab reset path, then close the panel: cheats show on the badge
  G.input.tap('Escape'); G.tick(DT);
  assert(game.state === 'paused', 'Esc → paused');
  assert(flow.debug.toState('explore') === true, 'toState(explore) from pause');
  run(G, 0.5, { passive: true });
  assert(game.state === 'explore' && game.timeScale === 1 && d.state === 'sleeping', `pause → explore unpaused (${game.state}, timeScale ${game.timeScale})`);
  p.debug.infiniteFlasks = true;
  G.input.tap('Backquote');
  run(G, 1, { passive: true });
  assert(lab.open === false && !!cls('lab-badge'), 'backquote closes the panel; badge shows the active cheat');
  return G;
}

// ================================================================== scenario: the hero's rig
async function scenarioHero() {
  out('\n== scenario HERO (Shadow Swordsman rig: coat strips, streamers, hair stay finite and above the grass) ==');
  const G = build();
  const { game, input } = G;
  fightSetup(G);
  const p = game.player, r = p.rig, d = game.dragon;
  p.debug.god = true;
  const strips = r.coat.reduce((n, c) => n + c.strips.length, 0);
  assert(r.coat.length === 7 && strips === 22, `coat skirt: 6 panels + the front flap, ${strips} torn strips`);
  assert(r.streamers?.length === 2 && Object.keys(r.hair).length === 5, 'two sleeve streamers, five hair clusters');
  // clear of the wyrm (AI off): run, sprint, roll, light / backhand / slam, charge + thrust
  p.debug.teleport(d.position.x + 14, d.position.z + 14);
  const v = new THREE.Vector3();
  let bad = 0, low = Infinity, tipLow = Infinity, frames = 0;
  const probe = () => {
    frames++;
    p.object3d.traverse((o) => { const e = o.matrixWorld.elements; for (let i = 0; i < 16; i++) if (!Number.isFinite(e[i])) { bad++; break; } });
    for (const C of r.coat) for (const S of C.strips) { v.set(0, -S.len, 0).applyMatrix4(S.joint.matrixWorld); low = Math.min(low, v.y); }
    v.set(0, 0, HERO_DIM.steelTip).applyMatrix4(r.sword.matrixWorld);
    tipLow = Math.min(tipLow, v.y);
  };
  const go = (s) => { for (let i = 0, n = Math.round(s / DT); i < n; i++) { G.tick(DT); probe(); } };
  input.axis = { x: 0, y: 1 };
  go(1.0);
  input.hold('ShiftLeft');
  go(1.0);
  input.release('ShiftLeft');
  input.axis = { x: 0, y: 0 };
  go(0.4);
  input.tap('Space');
  go(0.9);
  for (let k = 0; k < 3; k++) { input.click(0); go(0.45); }
  go(0.8);
  input.press(0);
  go(1.4);
  input.up(0);
  go(1.0);
  assert(!bad, `rig matrices stay finite through every move (${frames} frames)`);
  assert(low > -0.02, `torn strip tips stay above the grass (lowest ${low.toFixed(3)} m)`);
  assert(tipLow > -0.06, `the steel point never sinks into the ground (lowest ${tipLow.toFixed(3)} m)`);
  // glyph cells follow the view distance: the in-game size at the 36 m camera, finer in close-ups
  // (small parts capped, the blade's two columns fixed); a bad distance never yields NaN
  const coatU = r.materials.coat.uniforms.uCell.value;
  const kFar = setHeroGlyphScale(r.mats, 36);
  const farY = coatU.y;
  const kNear = setHeroGlyphScale(r.mats, 3);
  const nearY = coatU.y;
  assert(kFar === 1 && kNear < 0.5 && nearY < farY * 0.5 && r.materials.hair.uniforms.uCell.value.x <= 0.045 + 1e-9 && r.materials.blade.uniforms.uCell.value.x === 0.045,
    `glyph cells scale with the view distance (coat row ${farY.toFixed(3)} m at 36 m → ${nearY.toFixed(3)} m at 3 m)`);
  setHeroGlyphScale(r.mats, NaN);
  assert(r.mats.every((m) => Number.isFinite(m.uniforms.uCell.value.x + m.uniforms.uCell.value.y + m.uniforms.uGlyphZoom.value)), 'a bad view distance leaves every glyph cell finite');
  return G;
}

// ================================================================== scenario: touch controls
// The REAL core/input.js fed by the touch controls (src/ui/touch.js) through pointer events on
// their DOM, exactly like a phone: tap / hold ATTACK, a timed BLOCK tap parries, DODGE rolls,
// the stick moves (rim = sprint), LOCK / FLASK / || pause, the prompt tap, auto-aim, the phone
// camera + pinch, the title tap, synthetic mouse after a touch ignored, portrait overlay + pause.
async function scenarioTouch() {
  out('\n== scenario TOUCH (virtual stick + buttons → real Input: tap / hold attack, parry, dodge, move) ==');
  const W0 = globalThis.innerWidth, H0 = globalThis.innerHeight;
  globalThis.innerWidth = 844; // a phone in landscape
  globalThis.innerHeight = 390;
  const G = build({ realInput: true });
  const { game, counts } = G;
  const input = game.input, t = game.touch, p = game.player, d = game.dragon, rig = game.cameraRig;
  const c = (n) => counts[n] || 0;
  const touch = (type, target, id, x = 0, y = 0) => target.dispatch(type, { pointerType: 'touch', pointerId: id, clientX: x, clientY: y });
  const frames = (s, each) => { for (let i = 0, n = Math.round(s / DT); i < n; i++) { each?.(i); G.tick(DT); } };
  const rotateOn = () => !!document.body.find((e) => e.classList?.contains('tc-rotate'))?.classList.contains('on'); // overlay lives on <body>
  // desktop: nothing changes until a touch arrives
  assert(t.active === false && !cls('tc-root') && !rig.mobile && rig.targetDistance === CONFIG.camera.distance, 'inert without a touch: no touch DOM, desktop camera');
  assert(typeof input.setVirtual === 'function' && typeof input.setVirtualAxis === 'function', 'real Input exposes the virtual-source API');
  run(G, 1.0, { passive: true });
  // the first touch on the title turns the touch UI on and dismisses "press any key"
  fireWin('pointerdown', { pointerType: 'touch', pointerId: 1, target: G.canvas, clientX: 420, clientY: 200 });
  G.tick(DT);
  fireWin('pointerup', { pointerType: 'touch', pointerId: 1, target: G.canvas });
  assert(t.active && !!cls('tc-root') && cls('ab-root')?.classList.contains('ab-touch'), 'first touch → touch UI on (HUD in touch layout)');
  assert(game.state === 'explore', `title tap → explore (got ${game.state})`);
  assert(game.settings.quality === CONFIG.defaultQualityTouch, `touch → quality ${CONFIG.quality[game.settings.quality]?.name}`);
  assert(rig.mobile && rig.targetDistance === CONFIG.camera.mobileDistance && rig.maxExtraZoom === CONFIG.camera.mobileMaxExtraZoom, `phone camera: ${rig.targetDistance} m, extra zoom ≤ ${rig.maxExtraZoom} m`);
  fireWin('mousedown', { button: 0, target: G.canvas });
  assert(!input.mousePressed(0), 'the compatibility mousedown after a touch is ignored');
  input.endFrame();

  fightSetup(G);
  const B = (id) => cls(`tc-${id}`);
  const atk = B('attack'), blk = B('block'), dge = B('dodge'), flask = B('flask'), lock = B('lock'), pause = B('pause'), zone = cls('tc-zone');
  assert(atk && blk && dge && flask && lock && pause && zone, 'stick zone + ATTACK / BLOCK / DODGE / FLASK / LOCK / || built');
  run(G, 0.2, { passive: true });
  assert(!cls('tc-root').classList.contains('off'), 'controls shown in the fight');
  // auto-aim: game.mouseGround sits on the dragon's lock point
  const lp = new THREE.Vector3();
  settle(G);
  place(G, 7);
  G.tick(DT);
  d.lockPoint(lp);
  assert(t.autoAim && Math.hypot(game.mouseGround.x - lp.x, game.mouseGround.z - lp.z) < 0.3, 'fight: auto-aim puts mouseGround on the dragon');
  const kinds = [];
  G.watch = (n, e) => { if (n === 'player:attack') kinds.push(e.kind); };
  // tap ATTACK → light swing
  settle(G); place(G, 6);
  touch('pointerdown', atk, 11);
  frames(0.1);
  touch('pointerup', atk, 11);
  frames(0.6);
  assert(kinds[0] === 'light', `ATTACK tap → light swing (${kinds.join(',')})`);
  // hold ATTACK → charge, release → thrust
  settle(G); place(G, 6);
  kinds.length = 0;
  touch('pointerdown', atk, 12);
  let charged = false;
  frames(0.9, () => { if (p.state === 'charge') charged = true; });
  G.tick(DT);
  const meter = atk.find((e) => e.classList?.contains('t'))?.textContent ?? '';
  touch('pointerup', atk, 12);
  frames(0.8);
  assert(charged && kinds.includes('thrust'), `ATTACK hold 0.9 s → charge → thrust on release (${kinds.join(',')})`);
  assert(/^\[#+\.*\]$/.test(meter), `ATTACK shows the ASCII charge meter while held ("${meter}")`);
  G.watch = null;
  // DODGE → roll
  settle(G); place(G, 8);
  const r0 = c('player:roll');
  touch('pointerdown', dge, 13);
  frames(0.05);
  const rolled = p.state === 'roll';
  touch('pointerup', dge, 13);
  frames(0.8);
  assert(rolled && c('player:roll') === r0 + 1, `DODGE → roll (state ${p.state})`);
  // BLOCK tapped just before the bite lands → parry (timed from the attack's own tell / flash)
  settle(G); place(G, 6);
  let impactT = null;
  G.watch = (n, e) => {
    if (e?.attack !== 'bite') return;
    if (n === 'combat:tell' && impactT === null) impactT = game.time + e.impactIn;
    if (n === 'combat:flash') impactT = game.time + TUNING.flashLead;
  };
  const pr0 = c('player:parry');
  assert(game.lab.trigger('bite') === true, 'lab.trigger(bite)');
  let pressedAt = null, liftAt = -1;
  for (let i = 0; i < Math.round(5 / DT); i++) {
    if (impactT !== null && pressedAt === null && impactT - game.time - DT <= 0.12) { pressedAt = impactT - game.time; touch('pointerdown', blk, 14); liftAt = i + 4; }
    if (i === liftAt) touch('pointerup', blk, 14);
    G.tick(DT);
    if (c('player:parry') > pr0 && i > liftAt) break;
  }
  G.watch = null;
  assert(c('player:parry') === pr0 + 1, `BLOCK tap ${(pressedAt ?? NaN).toFixed(2)} s before the bite → parry`);
  // BLOCK held → guard up
  settle(G);
  touch('pointerdown', blk, 15);
  frames(0.3);
  const guarded = p.state === 'block' && p.blocking;
  touch('pointerup', blk, 15);
  frames(0.3);
  assert(guarded && p.state !== 'block', `BLOCK hold → block, release → guard down (${p.state})`);
  // stick: up = north, the rim = sprint; release stops
  settle(G); place(G, 14);
  const z0 = p.position.z;
  touch('pointerdown', zone, 16, 150, 300);
  touch('pointermove', zone, 16, 150, 262); // 38 px of 52: past runAt, full run speed
  frames(0.6);
  const ran = p.state === 'run' && p.position.z < z0 - 1.5;
  const ax = input.moveAxis();
  touch('pointermove', zone, 16, 150, 230); // past the rim
  frames(0.3);
  const sprinted = p.state === 'sprint' && input.down('ShiftLeft');
  touch('pointerup', zone, 16);
  frames(0.5);
  assert(ran && Math.abs(ax.x) < 1e-6 && ax.y > 0.99, `stick up → hero runs north (Δz ${(p.position.z - z0).toFixed(2)} m, axis ${ax.x.toFixed(2)},${ax.y.toFixed(2)})`);
  assert(sprinted, 'stick at the rim → sprint (ShiftLeft held)');
  const ax2 = input.moveAxis();
  assert((p.state === 'idle' || p.state === 'run') && !input.down('ShiftLeft') && ax2.x === 0 && ax2.y === 0, `stick release → stops, sprint off (${p.state})`);
  // LOCK toggles lock-on; FLASK drinks
  const tapBtn = (b, id) => { touch('pointerdown', b, id); frames(0.05); touch('pointerup', b, id); frames(0.1); };
  settle(G); place(G, 8);
  tapBtn(lock, 17);
  const locked = p.lockOn;
  tapBtn(lock, 18);
  assert(locked && !p.lockOn, 'LOCK toggles lock-on (Tab)');
  settle(G);
  p.hp = 50;
  const h0 = c('player:heal');
  tapBtn(flask, 19);
  frames(1.0);
  assert(c('player:heal') === h0 + 1, 'FLASK → drink (KeyF)');
  // || → pause; controls hide and every virtual input is released
  touch('pointerdown', atk, 20);
  tapBtn(pause, 21);
  assert(game.state === 'paused' && cls('tc-root').classList.contains('off') && !input.mouseDown(0), `|| → paused, controls hidden + released (${game.state})`);
  touch('pointerup', atk, 20);
  game.flow.resume();
  frames(0.2);
  // pinch: two bare-screen fingers zoom the camera within the phone range
  const z1 = rig.targetDistance;
  fireWin('pointerdown', { pointerType: 'touch', pointerId: 31, target: G.canvas, clientX: 400, clientY: 150 });
  fireWin('pointerdown', { pointerType: 'touch', pointerId: 32, target: G.canvas, clientX: 500, clientY: 150 });
  fireWin('pointermove', { pointerType: 'touch', pointerId: 32, clientX: 500, clientY: 150 });
  fireWin('pointermove', { pointerType: 'touch', pointerId: 32, clientX: 600, clientY: 150 });
  fireWin('pointerup', { pointerType: 'touch', pointerId: 31 });
  fireWin('pointerup', { pointerType: 'touch', pointerId: 32 });
  assert(rig.targetDistance < z1 - 3 && rig.targetDistance >= CONFIG.camera.mobileMinDistance, `pinch apart → closer (${z1} → ${rig.targetDistance.toFixed(1)} m)`);
  // explore at the bonfire: the "[E] Rest" prompt is a tap target
  assert(game.flow.debug.toState('explore') === true, 'toState(explore)');
  frames(0.3);
  const rest0 = c('bonfire:rest');
  assert(/\[E\]/.test(game.hud.promptText ?? ''), `prompt up at the bonfire ("${game.hud.promptText}")`);
  touch('pointerdown', game.hud.promptEl, 22);
  frames(0.05);
  touch('pointerup', game.hud.promptEl, 22);
  frames(0.2);
  assert(c('bonfire:rest') === rest0 + 1, 'prompt tap → rest at the bonfire (KeyE)');
  // auto-aim off (dragon asleep): aim follows the stick
  touch('pointerdown', zone, 23, 150, 300);
  touch('pointermove', zone, 23, 190, 300); // right = east
  frames(0.1);
  touch('pointerup', zone, 23);
  frames(0.05);
  assert(!t.autoAim && game.mouseGround.x > p.position.x + 3 && Math.abs(game.mouseGround.z - p.position.z) < 0.5, 'no target: aim follows the stick (east)');
  // portrait: rotate overlay, the game pauses, controls off
  globalThis.innerWidth = 390;
  globalThis.innerHeight = 844;
  frames(0.1);
  assert(t.portrait && rotateOn() && game.state === 'paused', `portrait → rotate overlay + paused (${game.state})`);
  globalThis.innerWidth = 844;
  globalThis.innerHeight = 390;
  frames(0.1);
  assert(!t.portrait && !rotateOn(), 'landscape again → overlay gone (pause menu waits)');
  game.flow.resume();
  frames(0.1);
  // the Lab switch turns it all off again: desktop camera, quality and HUD back
  t.setActive(false);
  frames(0.05);
  assert(!t.active && !rig.mobile && rig.targetDistance === CONFIG.camera.distance && game.settings.quality === CONFIG.defaultQuality && !cls('ab-root')?.classList.contains('ab-touch'), 'setActive(false) → desktop camera, quality and HUD back');
  globalThis.innerWidth = W0;
  globalThis.innerHeight = H0;
  return G;
}

const SCENARIOS = { gate: scenarioGate, hero: scenarioHero, breath: scenarioBreath, parry: scenarioParry, block: scenarioBlock, reach: scenarioReach, red: scenarioRed, plunge: scenarioPlunge, deflect: scenarioDeflect, lab: scenarioLab, win: scenarioWin, die: scenarioDie, touch: scenarioTouch };
const runs = [];
for (const [name, fn] of Object.entries(SCENARIOS)) if (SCEN === name || SCEN === 'all') runs.push(await fn());
if (!runs.length) { out(`unknown scenario '${SCEN}' (${Object.keys(SCENARIOS).join(' | ')} | all)`); process.exit(2); }

out('');
for (const G of runs) {
  let mx = 0, at = '';
  for (let i = 0; i < G.logTimes.length; i++) { let j = i; while (j < G.logTimes.length && G.logTimes[j][0] - G.logTimes[i][0] < 1) j++; if (j - i > mx) { mx = j - i; at = G.logTimes.slice(i, j).map((x) => x[1]).join(' / '); } }
  out('max HUD log lines in 1 s:', mx, '::', at.slice(0, 300));
}
// ---- contract: every emitted / subscribed event is in the catalogue; every catalogue event has a consumer
{
  const emitted = new Set(), subscribed = new Set();
  for (const G of runs) { Object.keys(G.counts).forEach((k) => emitted.add(k)); [...G.game.events.map.keys()].forEach((k) => { if (G.game.events.map.get(k).size) subscribed.add(k); }); }
  const notCat = [...emitted].filter((k) => !CATALOGUE.has(k));
  const subNotCat = [...subscribed].filter((k) => !CATALOGUE.has(k));
  const neverEmitted = [...CATALOGUE].filter((k) => !emitted.has(k));
  const noConsumer = [...CATALOGUE].filter((k) => !subscribed.has(k));
  out(`event catalogue (docs/ARCHITECTURE.md): ${CATALOGUE.size} names`);
  out('catalogue never emitted in these runs:', JSON.stringify(neverEmitted));
  assert(CATALOGUE.size >= 40, 'event catalogue parsed from ARCHITECTURE.md');
  assert(!notCat.length, `every emitted event is in the catalogue ${JSON.stringify(notCat)}`);
  assert(!subNotCat.length, `every subscribed event is in the catalogue ${JSON.stringify(subNotCat)}`);
  if (SCEN === 'all') assert(!noConsumer.length, `every catalogue event has a consumer ${JSON.stringify(noConsumer)}`);
  assert(!payloadErrors.size, `event payloads match the contract ${JSON.stringify([...payloadErrors].slice(0, 12))}`);
}
for (const G of runs) if (G.errorCounts.size) out('module update errors:', JSON.stringify([...G.errorCounts]));
const uniq = [...new Set(errors)];
out(`\nconsole errors/warnings: ${errors.length} (${uniq.length} unique)`);
for (const e of uniq.slice(0, 20)) out('  ', e.slice(0, 400));
out(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails || uniq.length ? 1 : 0);
