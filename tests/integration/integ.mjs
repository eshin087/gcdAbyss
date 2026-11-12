// Whole-game headless integration run (contract v0.2): REAL Player, Dragon, Hud, GameFlow,
// AudioEngine and Lab (+ real LightPool, GlyphParticles, CameraRig, Events), wired exactly like
// src/main.js (construction order, frame order, debugTimeScale in dt). World is a light mock built on
// the real Colliders. A bot drives the input: it moves, attacks, blocks, parries and dodges.
// usage: node integ.mjs <repoRoot> [scenario]   (env: ABYSS_SEED=n reseeds the AI, ABYSS_TRACE=1 logs combat events)
//   scenario: gate | hero | batch | breath | parry | block | reach | red | plunge | deflect | lab | strings | plungeReact |
//             timing | fire | herolook | win | die | touch | all (default all)
//   (timing: ABYSS_TM=name,name... probes only those attacks; ABYSS_TMV=1 prints its per-placement map)
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
  'dragon:parried': { attack: 's', tell: 't', hit: 'n', last: 'b' },
  'combat:deflectChain': { count: 'n' },
  'dragon:phase': { n: 'n' },
  'dragon:plunged': { execution: 'b' },
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
    safe('lab', () => game.lab.postRender?.()); // (main.js: after pipeline.render; nothing is drawn here)
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
function makeDefender(G, { skill = 1 } = {}) {
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
        // skill < 1 (the probe): some tells are simply not read (no answer at all)
        const miss = skill < 1 && Math.random() > skill;
        pend.push({ attack: d.attack, tell: d.tell, at: t + d.impactIn, done: miss, stream: d.attack === 'breath' });
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
  // a defending bot fences like a player reading tells (~5 m from the chest joint, ~6.5 m from the
  // root: still in sword reach, in the claw / bite strings' band); the others walk right up to it
  if (dist > (opts.defend ? 5.0 : 3.2)) input.axis = { x: dx / dist, y: -dz / dist };
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
  // fight until victory (4500 HP over three phases, the strings and the fire: a 3-5 min fight for a human)
  let maxPhase = 1, sawBreak = false, sawAir = false, chainMax = 0;
  const picks = {}, phaseT = [game.time, NaN, NaN], breakT = [];
  G.watch = (n, dd) => {
    if (n === 'dragon:windup') picks[dd.name] = (picks[dd.name] || 0) + 1;
    if (n === 'combat:deflectChain') chainMax = Math.max(chainMax, dd.count);
    if (n === 'dragon:phase') phaseT[dd.n - 1] = game.time;
    if (n === 'dragon:postureBreak') breakT.push(game.time);
  };
  const t0 = game.time;
  const won = run(G, 900, { god: true, defend: true }, () => {
    maxPhase = Math.max(maxPhase, game.dragon.phase);
    if (game.dragon.broken) sawBreak = true;
    if (game.dragon.state === 'airborne') sawAir = true;
    return game.state === 'victory';
  });
  G.watch = null;
  const c = (n) => counts[n] || 0;
  const fightT = game.time - t0;
  out(`   fight: t=${fightT.toFixed(1)}s (phase 2 at ${(phaseT[1] - t0).toFixed(1)} s, phase 3 at ${(phaseT[2] - t0).toFixed(1)} s) dragon hp=${game.dragon.hp} state=${game.dragon.state} phase=${maxPhase} hits=${c('player:hitDragon')} hurt=${c('player:hurt')} tells=${c('combat:tell')} flashes=${c('combat:flash')} break=${sawBreak} air=${sawAir}`);
  out(`   defence: parry ${c('player:parry')}/${G.defend.stats.parryTry} tries · block ${c('player:block')} · guardBreak ${c('player:guardBreak')} · perfect ${c('player:perfectDodge')}/${G.defend.stats.dodgeTry} tries · ghostep ${c('player:ghostep')} · dodge ${c('player:dodge')} · dragon:parried ${c('dragon:parried')} · deflect chains ${c('combat:deflectChain')} (longest x${chainMax}) · postureBreak ${c('dragon:postureBreak')} at ${breakT.map((t) => (t - t0).toFixed(0)).join(', ')} s`);
  out(`   AI picks: ${Object.entries(picks).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  assert(won, 'victory reached');
  assert(maxPhase === 3, 'phase 3 reached');
  assert(c('dragon:phase2') === 1, 'dragon:phase2 once');
  assert(c('dragon:phase3') === 1 && c('dragon:phase') === 2, `dragon:phase3 once, dragon:phase {n} twice (${c('dragon:phase3')} / ${c('dragon:phase')})`);
  assert(phaseT[1] > t0 && phaseT[2] > phaseT[1], 'the phases come in order');
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

// ================================================================== scenario: probe (difficulty, opt-in)
// Not part of 'all': `node tests/integration/integ.mjs . probe` (env ABYSS_SKILL = the share of tells
// the bot answers, default 0.8; ABYSS_SEED reseeds). A mortal bot with the win scenario's habits
// fights until it wins or dies: a rough read of the fight's length and danger for tuning.
async function scenarioProbe() {
  const skill = Number(process.env.ABYSS_SKILL ?? 0.8);
  out(`
== scenario PROBE (mortal bot, answers ${Math.round(skill * 100)} % of tells) ==`);
  const G = build();
  const { game, input, counts } = G;
  G.defend = makeDefender(G, { skill });
  run(G, 1.0);
  input.tap('Space');
  G.tick(DT);
  run(G, 30, { god: true, attack: false }, () => game.state === 'bossIntro');
  run(G, 20, { god: true, attack: false }, () => game.state === 'boss');
  const p = game.player, d = game.dragon;
  const t0 = game.time, phaseT = [0, NaN, NaN];
  let hurt = 0, worst = 0;
  G.watch = (n, e) => {
    if (n === 'dragon:phase') phaseT[e.n - 1] = game.time - t0;
    if (n === 'player:hurt') { hurt += e?.damage ?? 0; worst = Math.max(worst, e?.damage ?? 0); }
  };
  const done = run(G, 900, { god: false, defend: true }, () => game.state === 'victory' || !p.alive || p.state === 'dead' || game.state === 'dead');
  G.watch = null;
  const c = (n) => counts[n] || 0;
  const res = game.state === 'victory' ? 'WIN' : done ? 'DIED' : 'TIMEOUT';
  out(`   ${res} after ${(game.time - t0).toFixed(1)} s · wyrm hp ${d.hp}/${d.maxHp} (${Math.round((100 * d.hp) / d.maxHp)} %) phase ${d.phase} (P2 at ${phaseT[1].toFixed(0)} s, P3 at ${phaseT[2].toFixed(0)} s)`);
  out(`   hero: took ${hurt} dmg (worst ${worst}) · heals ${c('player:heal')} · parries ${c('player:parry')} · chains ${c('combat:deflectChain')} · perfect ${c('player:perfectDodge')} · plunges ${c('player:plungeHit')} · breaks ${c('dragon:postureBreak')} · hits ${c('player:hitDragon')}`);
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
  input.tap('Escape');
  G.tick(DT);
  assert(game.state === 'paused', 'Esc → paused');
  // (snapshot after the Esc frame: that frame still runs on the pre-pause dt, so a wyrm walking at
  // that moment moves once; whether it walks depends on the seeded AI's rolls, which share
  // Math.random with cosmetic FX)
  const dPos = game.dragon.position.clone(), dHp = game.dragon.hp;
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
  // a normal-tell hit of the claw combo can be parried too; since v0.5 (contract 1, the deflect
  // chain) a parry on a hit that is not the string's last one does NOT end it: the next hits follow
  settle(G);
  place(G, 6);
  let par = null;
  const offPar = game.events.on('dragon:parried', (dd) => { if (!par) par = dd; });
  const cc = forceAttack(G, 'clawCombo', { answer: 'parry', max: 4, settle: 150 });
  offPar();
  out('   clawCombo hit 1 → result', cc.res, 'tells', evn(cc, 'combat:tell'), 'parried', JSON.stringify(par));
  assert(cc.res === RESULT.PARRIED && evn(cc, 'dragon:parried') === 1, `normal-tell combo hit parried (got ${cc.res})`);
  assert(par?.hit === 0 && par?.last === false, `dragon:parried {hit 0, last false} for the combo's first hit (${JSON.stringify(par)})`);
  assert(evn(cc, 'combat:tell') === 3, `a parry on hit 1 deflects: the combo goes on (${evn(cc, 'combat:tell')} tells)`);
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
  const want = TUNING.attacks.swipe.damage * (TUNING.damageScale ?? 1) * (1 - DEFENSE.blockReduction.normal);
  out(`   swipe: tell ${r.tell} result ${r.res} hp ${r.hp0} → ${r.hpAtHit} (expected -${want.toFixed(2)})`);
  assert(r.tell === TELL.NORMAL, 'swipe announces a normal tell');
  assert(r.res === RESULT.BLOCKED, `held guard → 'blocked' (got ${r.res})`);
  assert(near(r.hp0 - r.hpAtHit, want, 0.01), `blocked damage reduced by DEFENSE.blockReduction.normal (${(r.hp0 - r.hpAtHit).toFixed(2)})`);
  assert(evn(r, 'player:block') === 1 && evn(r, 'player:hurt') === 0, 'player:block emitted, no player:hurt');
  assert(evn(r, 'player:parry') === 0, 'holding block from before the windup is not a parry');
  settle(G);
  place(G, 6);
  const b = forceAttack(G, 'bite', { hold: true });
  const wantB = TUNING.attacks.bite.damage * (TUNING.damageScale ?? 1) * (1 - DEFENSE.blockReduction.blue);
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
  const KINDS = { L1: 'light', L2: 'light', L3: 'light', L4: 'light', slam: 'slam', thrust: 'thrust' };
  const CLICKS = { L1: 1, L2: 2, L3: 3, L4: 4, slam: 5 }; // the 5-hit chain (ADR-041): falling cut, rising cut, whirl, stab, slam
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
      const n = CLICKS[name];
      if (n > 1) { p.debug.teleport(d.position.x + fx * 40, d.position.z + fz * 40); aimAt(G); }
      for (let k = 0; k < n; k++) {
        if (k === n - 1) {
          stand(gap);
          at = surf();
          G.watch = (nn, dd) => { if (nn === 'player:hitDragon' && !hit) hit = dd; if (nn === 'player:attack') kinds.push(dd.kind); if (nn === 'player:slam') slamEv++; };
        }
        aimAt(G);
        input.click(0);
        run(G, k < n - 1 ? 0.34 : 1.3, { passive: true });
      }
    }
    G.watch = null;
    return { name, gap, at, hit, kinds, slamEv };
  };
  // (CHARGE_HOLD hoisted above)
  const rows = [];
  for (const gap of [0, 2, 2.5, 3, 3.5]) {
    const r = ['L1', 'L2', 'L3', 'L4', 'slam', 'thrust'].map((nm) => trial(nm, gap));
    rows.push(r);
    out(`   ${gap ? `${gap.toFixed(1)} m` : 'contact'}`.padEnd(12) + r.map((t) => `${t.name} ${t.hit ? `${t.hit.kind}/${t.hit.part} ${Math.round(t.hit.damage)}` : 'MISS'} @${t.at.toFixed(2)}`.padEnd(30)).join(''));
  }
  for (const r of rows) for (const t of r) {
    const where = t.gap ? `${t.gap} m` : 'contact';
    assert(!!t.hit && t.hit.kind === KINDS[t.name] && t.kinds[0] === KINDS[t.name], `${t.name} connects from the front at ${where} (${t.hit ? `${t.hit.kind} on ${t.hit.part}` : 'miss'}, hero ${t.at.toFixed(2)} m from the chest surface)`);
  }
  assert(rows.every((r) => r[4].slamEv === 1), 'the slam meets the ground once per swing (player:slam)');
  assert(rows.every((r) => r[4].hit?.heavy === true && r[5].hit?.heavy === true && r.slice(0, 4).every((t) => t.hit?.heavy === false)), 'slam and thrust hit heavy, the four light hits do not');
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
  assert(near(gb.hp0 - gb.hpAtHit, TUNING.attacks.tail.damage * (TUNING.damageScale ?? 1), 0.01), `guard break takes full damage (${gb.hp0 - gb.hpAtHit})`);
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
  assert(near(dealt, P.damage, 1), `the blade hits the head once: ${dealt} (DEFENSE.plunge.damage ${P.damage}, final: onPlunge takes it exact)`);
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
  // shooting fire while flying: a perfect dodge of the burning pass's stream (a hazard spawned with
  // plunge: true) sends the hero onto the flying wyrm's head; it crashes out of the air
  settle(G);
  d.hazards.clear();
  d.position.set(0, 0, -8); // the arena's middle, facing south: the pass has room to run over him
  d.yaw = 0;
  d.rig.snap();
  run(G, 0.3, { passive: true });
  place(G, 18);
  const hpF = d.hp, cF = { ...G.counts };
  let airAtDodge = false;
  const hF0 = G.hits.length;
  const rF = forceAttack(G, 'skyStrafe', { answer: 'dodge', settle: 1, max: 7 });
  if (process.env.ABYSS_TRACE) out('     strafe hits', JSON.stringify(G.hits.slice(hF0)), 'pressLead', rF.pressLead, 'flashT', rF.flashT, 'impactT', rF.impactT, 'hero', p.position.x.toFixed(1), p.position.z.toFixed(1), 'hz', d.hazards.count());
  airAtDodge = d.state === 'airborne' || d.rig.s.alt > 1;
  const plungedF = p.state === 'plunge';
  const trF = ride(6);
  let crashed = false, landedF = false;
  for (let i = 0; i < Math.round(5 / DT); i++) {
    G.tick(DT);
    if (d.brain.action?.name === 'plunged' && d.rig.s.alt < 0.2) crashed = true;
    if (crashed && !d.brain.action && d.state === 'combat') { landedF = true; break; }
  }
  out(`   burning pass dodged: ${rF.res} · wyrm in the air at the dodge ${airAtDodge} · plunge ${plungedF} · phases ${[...trF.phases].join('')} · head damage ${hpF - d.hp} · crashed ${crashed} · back in combat ${landedF} (alt ${d.rig.s.alt.toFixed(2)}, ${d.state})`);
  assert(rF.res === RESULT.PERFECT && airAtDodge && plungedF, `a perfect dodge of the flying wyrm's fire stream → the plunge onto it in the air (${rF.res}, air ${airAtDodge}, ${plungedF})`);
  assert(since(cF, 'player:plungeHit') === 1 && since(cF, 'dragon:plunged') === 1 && hpF - d.hp === P.damage, `one head hit on the flying wyrm (${hpF - d.hp})`);
  assert(crashed && landedF && trF.finite && Number.isFinite(d.position.x + d.position.z), 'the flying wyrm crashes out of the air and fights on');
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
  // a successful deflect re-arms at once (player.rmb.chain): two blows only 0.3 s apart, each tapped in
  // time with the guard held 0.2 s, both deflect. Mashing (whiffed presses) still needs the full
  // re-arm: scenario PARRY's mashed RMB.
  const m = string(2, 0.3, 0.2);
  out(`   2 blows 0.3 s apart, taps held 0.2 s (a deflect re-arms on release): ${m.res.join(' ')}`);
  assert(m.res[0] === RESULT.PARRIED && m.res[1] === RESULT.PARRIED, 'after a deflect the next timed press parries again (no re-arm wait)');
  // between parries in rhythm the guard lingers up, then eases down
  run(G, 1.2, { passive: true });
  assert(p.guardHold === 0 || p.guardHold < 1, `guardHold eases off after the string (${p.guardHold})`);
  return G;
}

// ================================================================== scenario: Lab + debug APIs
// ---- BULLETS: the bullet field (bullets.js) and the four patterns (bulletAttacks.js), docs/COMBAT.md "Bullets"
async function scenarioBullets() {
  out('\n== scenario BULLETS (deflect / block / roll / cut the small ones, dodge the red ones; the cue, the caps, the clears) ==');
  const G = build();
  const { game, input } = G;
  fightSetup(G);
  const d = game.dragon, p = game.player, B = d.bullets, K = TUNING.bullets;
  const lead = TUNING.flashLead;
  assert(B && K && typeof B.spawn === 'function' && B.live === 0, 'dragon.bullets exists, empty at the start');
  const NAMES = ['emberStorm', 'fanVolley', 'wispSwarm', 'fireWheel'];
  const listed = new Set(d.debug.abilities().map((a) => a.name));
  assert(NAMES.every((n) => listed.has(n) && TUNING.attacks[n]?.tell), 'the four patterns are Lab abilities with tuning data');
  const KIND = { ember: 0, wisp: 1, orb: 2 };
  /**
   * `n` bullets flown at the standing hero from `from` m (`gap` s apart), answered off the bullet's own
   * cue: answer = parry (RMB tap 0.12 s before impact) | roll (Space 0.1 s before) | swing (LMB on the
   * cue) | none; hold = guard held throughout; cap = the pattern's hit budget.
   */
  const shot = (kind, o = {}) => {
    settle(G);
    B.clear();
    run(G, 0.8, { passive: true });
    place(G, 7);
    d.posture = 0;
    const c0 = { ...G.counts }, h0 = G.hits.length, hp0 = p.hp;
    const rec = { cues: [], flashAt: [], light: null, parried: [], postureAtHit: null, state: [] };
    G.watch = (n, e) => {
      if (n === 'combat:tell' && e?.bullet) rec.cues.push({ t: game.time, impactIn: e.impactIn, tell: e.tell, hazard: e.hazard });
      if (n === 'combat:flash' && e?.bullet) rec.flashAt.push(game.time);
      if (n === 'player:parry') rec.light = e.light;
      if (n === 'dragon:parried') rec.parried.push(e);
    };
    const from = o.from ?? 6, speed = o.speed ?? 9, n = o.n ?? 1;
    const dx = d.position.x - p.position.x, dz = d.position.z - p.position.z, l = Math.hypot(dx, dz) || 1;
    const ux = dx / l, uz = dz / l;
    const sx = p.position.x + ux * from, sz = p.position.z + uz * from;
    const yaw = Math.atan2(-ux, -uz);
    const grp = o.cap ? B.group(o.cap) : -1;
    let spawned = 0, next = game.time, answered = 0, seenHits = 0;
    if (o.hold) input.press(2);
    for (let i = 0; i < Math.round((o.T ?? 2.4) / DT); i++) {
      while (spawned < n && game.time >= next - 1e-9) {
        B.spawn(kind, 'emberStorm', sx, 1.0, sz, yaw, speed, grp);
        spawned++;
        next += o.gap ?? 0;
      }
      aimAt(G);
      input.axis = { x: 0, y: 0 };
      if (answered < rec.flashAt.length) {
        const left = rec.flashAt[answered] + lead - game.time - DT;
        if (o.answer === 'parry' && left <= 0.12) { answered++; input.click(2); }
        else if (o.answer === 'roll' && left <= 0.1) { answered++; input.axis = { x: ux, y: -uz }; input.tap('Space'); }
        else if (o.answer === 'swing' && left <= (o.swingLead ?? 0.3)) { answered++; input.click(0); }
        else if (!o.answer || o.answer === 'none') answered++;
      }
      G.tick(DT);
      const hs = G.hits.length - h0;
      if (hs > seenHits) { seenHits = hs; if (rec.postureAtHit === null) rec.postureAtHit = d.posture; rec.state.push(p.state); }
    }
    if (o.hold) input.up(2);
    G.watch = null;
    rec.hits = G.hits.slice(h0);
    rec.res = rec.hits.map((h) => h.r);
    rec.lost = rec.hits.reduce((s, h) => s + (h.hp0 - h.hp1), 0);
    rec.hp = hp0 - p.hp;
    rec.ev = {};
    for (const k in G.counts) rec.ev[k] = G.counts[k] - (c0[k] || 0);
    rec.live = B.live;
    return rec;
  };
  const cnt = (r, what) => r.res.filter((x) => x === what).length;

  // --- an ember: announced, hits a standing hero for its own (unscaled) damage
  const st = shot(KIND.ember);
  const cueLead = st.hits[0] ? st.hits[0].t - st.flashAt[0] : NaN;
  out(`   ember, no answer: ${st.res.join(' ')} · −${st.lost} HP · cues ${st.cues.length} (${st.cues[0]?.tell}, hazard ${st.cues[0]?.hazard}) · flash ${cueLead.toFixed(3)} s before impact`);
  assert(st.res.length === 1 && st.res[0] === RESULT.HIT && near(st.lost, K.ember.damage, 0.01), `an ember hits a standing hero for K.ember.damage, not x damageScale (${st.lost})`);
  assert(st.cues.length === 1 && st.flashAt.length === 1 && st.cues[0].tell === TELL.NORMAL && st.cues[0].hazard === true, 'one paired combat:tell + combat:flash { hazard, bullet } per bullet');
  assert(cueLead >= K.cueMin - DT && cueLead <= lead + 2 * DT, `the cue leads the impact by ~flashLead (${cueLead.toFixed(3)} s)`);

  // --- deflect: a parry off the cue sends it back at the wyrm (posture, light clash, no recoil of the wyrm)
  const pa = shot(KIND.ember, { answer: 'parry' });
  out(`   ember, parried: ${pa.res.join(' ')} · −${pa.hp} HP · posture ${pa.postureAtHit} · light ${pa.light} · dragon:parried ${JSON.stringify(pa.parried)} · live ${pa.live}`);
  assert(pa.res.length === 1 && pa.res[0] === RESULT.PARRIED && pa.hp === 0, 'a timed parry deflects the ember (no damage)');
  assert(near(pa.postureAtHit, K.ember.posture, 0.5), `the deflect adds K.ember.posture (${pa.postureAtHit})`);
  assert(pa.light === true && pa.ev['player:parry'] === 1, 'player:parry { light: true }: a light clash');
  assert(pa.parried.length === 1 && pa.parried[0].bullet === true && pa.parried[0].attack === 'emberStorm', 'dragon:parried { bullet: true } once (the wyrm is not interrupted)');
  assert(pa.live === 0, 'the deflected ember flew back to the head and burst');
  const wi = shot(KIND.wisp, { answer: 'parry' });
  out(`   wisp, parried: ${wi.res.join(' ')} · posture ${wi.postureAtHit} · cue ${wi.cues[0]?.tell}`);
  assert(wi.res[0] === RESULT.PARRIED && near(wi.postureAtHit, K.wisp.posture, 0.5) && wi.cues[0]?.tell === TELL.BLUE, 'a wisp is a blue tell: deflected for K.wisp.posture');

  // --- block (chip) and roll (i-frames, no Ghostep off a small bullet)
  const bl = shot(KIND.ember, { hold: true });
  out(`   ember, guard held: ${bl.res.join(' ')} · −${bl.lost.toFixed(2)} HP`);
  assert(bl.res[0] === RESULT.BLOCKED && bl.lost < K.ember.damage && (bl.ev['player:guardBreak'] || 0) === 0, 'a held guard blocks the ember for chip');
  const ro = shot(KIND.ember, { answer: 'roll' });
  out(`   ember, rolled: ${ro.res.join(' ')} · perfectDodge ${ro.ev['player:perfectDodge'] || 0} · ghostep ${ro.ev['player:ghostep'] || 0} · −${ro.hp} HP`);
  assert(cnt(ro, RESULT.DODGED) >= 1 && cnt(ro, RESULT.HIT) === 0 && ro.hp === 0, 'rolling through an ember dodges it');
  assert(!(ro.ev['player:perfectDodge'] || 0) && !(ro.ev['player:ghostep'] || 0), 'no Ghostep off a small bullet (hit.perfect === false)');

  // --- the red orb: dodge only
  const ob = shot(KIND.orb);
  out(`   orb, no answer: ${ob.res.join(' ')} · −${ob.lost} HP at the hit · cue ${ob.cues[0]?.tell}`);
  assert(ob.res[0] === RESULT.HIT && near(ob.lost, K.orb.damage, 0.01) && ob.cues[0]?.tell === TELL.RED, 'an orb is a red tell and hits for K.orb.damage');
  const op = shot(KIND.orb, { answer: 'parry' });
  const oh = shot(KIND.orb, { hold: true });
  out(`   orb, parry tap: ${op.res.join(' ')} · guard held: ${oh.res.join(' ')} (guardBreak ${oh.ev['player:guardBreak'] || 0})`);
  assert(cnt(op, RESULT.PARRIED) === 0 && cnt(op, RESULT.BLOCKED) === 0 && op.hp > 0, 'an orb cannot be parried');
  assert(cnt(oh, RESULT.BLOCKED) === 0 && oh.hp > 0, 'an orb cannot be blocked');
  const od = shot(KIND.orb, { answer: 'roll' });
  out(`   orb, rolled 0.1 s before impact: ${od.res.join(' ')} · perfectDodge ${od.ev['player:perfectDodge'] || 0} · states ${od.state.join(',')} · −${od.hp} HP`);
  assert(od.res[0] === RESULT.PERFECT && od.ev['player:perfectDodge'] === 1 && od.hp === 0, 'a timed roll through an orb is a perfect dodge (Ghostep)');
  assert(!od.state.includes('plunge') && p.state !== 'plunge', 'the Ghostep off a bullet never plunges (plunge: false)');

  // --- the blade cuts small bullets out of the air
  let cutOk = null;
  for (const sl of [0.34, 0.28, 0.22, 0.16]) {
    const cu = shot(KIND.ember, { answer: 'swing', swingLead: sl, speed: 6, from: 5 });
    out(`   ember, swing ${sl} s before impact: hits [${cu.res.join(' ')}] · live ${cu.live} · swings ${cu.ev['player:attack'] || 0}`);
    if (cu.res.length === 0 && cu.live === 0 && cu.hp === 0) { cutOk = sl; break; }
  }
  assert(cutOk !== null, `a swing in time cuts the ember out of the air (no hit resolved; swing ${cutOk} s before impact)`);

  // --- one cue, one parry for a clump; the grace after a hit; the pattern's hit budget; point-blank duds
  const vo = shot(KIND.ember, { n: 5, gap: 0.05, answer: 'parry' });
  out(`   5 embers 0.05 s apart, one parry: ${vo.res.join(' ')} · cues ${vo.cues.length} · live ${vo.live} · −${vo.hp} HP`);
  assert(vo.cues.length === 1 && cnt(vo, RESULT.PARRIED) === 1 && cnt(vo, RESULT.HIT) === 0 && vo.hp === 0 && vo.live === 0, 'impacts within cueGap ride on one cue: one parry answers the clump');
  const gr = shot(KIND.ember, { n: 4, gap: 0.12 });
  out(`   4 embers 0.12 s apart, no answer: ${gr.res.join(' ')} · −${gr.lost} HP`);
  assert(cnt(gr, RESULT.HIT) === 1 && near(gr.lost, K.ember.damage, 0.01), 'after a bullet hit the next ones fizzle for K.grace s (no chain melt)');
  const ca = shot(KIND.ember, { n: 6, gap: 0.7, cap: 2, T: 5.6 });
  out(`   6 embers 0.7 s apart, budget 2: ${ca.res.join(' ')} · cues ${ca.cues.length}`);
  assert(cnt(ca, RESULT.HIT) === 2 && ca.res.length === 2, "a pattern's bullets stop hurting at its hit budget (group().max)");
  const pb = shot(KIND.ember, { from: 0.9, T: 0.6 });
  out(`   ember spawned 0.9 m away: hits [${pb.res.join(' ')}] · cues ${pb.cues.length}`);
  assert(pb.res.length === 0 && pb.hp === 0, 'a bullet spawned point-blank (no time for a cue) is a dud');

  // --- robustness and the clears
  settle(G);
  B.clear();
  assert(B.spawn(KIND.ember, 'x', NaN, 1, 0, 0, 9) === null && B.spawn(7, 'x', 0, 1, 0, 0, 9) === null && B.live === 0, 'spawn rejects NaN / unknown kinds');
  B.update(NaN); B.update(0); B.update(-1);
  place(G, 9);
  for (let i = 0; i < 40; i++) B.spawn(i % 3, 'emberStorm', d.position.x + Math.sin(i) * 6, 1.5, d.position.z + Math.cos(i) * 6, i * 0.7, 3);
  B.startWheel({ attack: 'fireWheel', x: d.position.x, z: d.position.z, n: 4, ang: 0, dir: 1, warn: 0.5, dur: 4, speed: 1, r0: 3, r1: 26, width: 1.1, damage: 20, max: 2 });
  run(G, 0.3, { passive: true });
  const liveBefore = B.live;
  d.enterPhase(2);
  run(G, 2 * DT, { passive: true });
  out(`   phase change: ${liveBefore} bullets + wheel → ${B.live}, wheel ${B.wheel.on}`);
  assert(liveBefore === 40 && B.live === 0 && B.wheel.on === false, 'a phase change clears the bullets and the wheel');
  settle(G, 12);
  for (let i = 0; i < 20; i++) B.spawn(0, 'emberStorm', d.position.x + Math.sin(i) * 7, 1.5, d.position.z + Math.cos(i) * 7, i * 0.7, 2);
  run(G, 0.2, { passive: true });
  d.debug.postureBreak();
  run(G, 3 * DT, { passive: true });
  out(`   posture break: 20 bullets → ${B.live}`);
  assert(B.live === 0, 'a posture break clears the air');
  run(G, 9, { passive: true }, () => !d.broken);
  settle(G, 12);

  // --- the patterns, every phase: a hero who never answers is hit at most maxHits times; a hero who
  // answers every cue (parry the normal / blue ones, roll the red ones) comes through nearly clean
  const pattern = (name, phase, answer, dist) => {
    settle(G, 12);
    if (d.phase !== phase) { d.enterPhase(phase); run(G, 0.2, { passive: true }); settle(G, 14); }
    B.clear();
    run(G, 1.0, { passive: true });
    place(G, dist);
    d.posture = 0;
    const def = answer ? makeDefender(G) : null;
    const h0 = G.hits.length, c0 = { ...G.counts };
    let tells = 0, flashes = 0, peak = 0, bad = 0;
    G.watch = (n, e) => { def?.onEvent(n, e); if (n === 'combat:tell') tells++; if (n === 'combat:flash') flashes++; };
    const ok = game.lab.trigger(name);
    let ended = -1;
    for (let i = 0; i < Math.round(16 / DT); i++) {
      aimAt(G);
      input.axis = { x: 0, y: 0 };
      def?.act();
      d.posture = 0; // (the meter would break the wyrm mid-pattern and clear the air; not under test here)
      G.tick(DT);
      peak = Math.max(peak, B.live);
      for (let j = 0; j < B.pool.length; j++) { const b = B.pool[j]; if (b.alive && !Number.isFinite(b.x + b.y + b.z + b.vx + b.vz)) bad++; }
      if (ended < 0 && !d.brain.action) ended = i;
      if (ended >= 0 && B.live === 0 && !B.wheel.on && i - ended > 30) break;
    }
    G.watch = null;
    input.up(2);
    const hs = G.hits.slice(h0).filter((h) => h.attack === name);
    const by = (r) => hs.filter((h) => h.r === r).length;
    return { ok, ended, tells, flashes, peak, bad, hit: by(RESULT.HIT), parried: by(RESULT.PARRIED), blocked: by(RESULT.BLOCKED), dodged: by(RESULT.DODGED) + by(RESULT.PERFECT), live: B.live, wheel: B.wheel.on, hurt: (G.counts['player:hurt'] || 0) - (c0['player:hurt'] || 0) };
  };
  const DIST = { emberStorm: 9, fanVolley: 11, wispSwarm: 10, fireWheel: 9 };

  // --- the cue in the corners (phase 2): an even-count fan, a wisp that misses and comes round, a
  // swarm roared at a hero so far away that its lead wisp lands after the action has ended
  const lateCues = () => {
    const FV = TUNING.attacks.fanVolley, WS = TUNING.attacks.wispSwarm;
    const R = K.ember.r + (p.radius ?? 0.45);
    /** One pattern against a standing hero at `metres`: its headline tell / flash, hits, and `each(i)` per frame. */
    const watchPattern = (name, metres, each) => {
      settle(G, 12);
      B.clear();
      run(G, 1.0, { passive: true });
      place(G, metres / SIZE);
      d.posture = 0;
      const h0 = G.hits.length;
      const r = { tells: 0, flashes: 0, headTell: null, headFlash: null, ended: null, dist: Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z) };
      G.watch = (n, e) => {
        if (e?.attack !== name) return;
        if (n === 'combat:tell') { r.tells++; if (!e.bullet) r.headTell = game.time; }
        if (n === 'combat:flash') { r.flashes++; if (!e.bullet) r.headFlash = game.time; }
      };
      r.ok = game.lab.trigger(name);
      for (let i = 0; i < Math.round(14 / DT); i++) {
        aimAt(G);
        input.axis = { x: 0, y: 0 };
        d.posture = 0;
        G.tick(DT);
        each?.(r);
        if (r.ended === null && !d.brain.action) r.ended = game.time;
        if (r.ended !== null && B.live === 0 && game.time - r.ended > 0.5) break;
      }
      G.watch = null;
      r.hits = G.hits.slice(h0).filter((h) => h.attack === name && h.r === RESULT.HIT);
      return r;
    };

    // an even count (phase 2: 8 embers): the first volley still has an ember dead on the hero (the
    // lead the headline flash follows) and the second still puts him in a gap
    assert(d.phase === 2 && (perPhaseOf(FV.count, 2) & 1) === 0, `phase 2 fans have an even count (${perPhaseOf(FV.count, 2)})`);
    const miss = [];
    let leadSeen = false, embers = 0;
    const fv = watchPattern('fanVolley', 11, () => {
      if (B.leadAlive()) leadSeen = true;
      const n = B.count(KIND.ember);
      if (n > embers && miss.length < 2) {
        // a volley was just flung: how far from the hero its nearest ember will pass
        let best = Infinity;
        for (const b of B.pool) {
          if (!b.alive || b.kind !== KIND.ember || b.t > 1.5 * DT) continue;
          const dx = p.position.x - b.x, dz = p.position.z - b.z, sp = Math.hypot(b.vx, b.vz) || 1;
          best = Math.min(best, Math.abs(dx * b.vz - dz * b.vx) / sp);
        }
        miss.push(best);
      }
      embers = n;
    });
    const fvLag = fv.hits[0] && fv.headFlash !== null ? fv.hits[0].t - fv.headFlash : NaN;
    out(`   P2 fan of ${perPhaseOf(FV.count, 2)} at ${fv.dist.toFixed(1)} m: lead bullet ${leadSeen} · nearest ember passes ${miss.map((m) => m.toFixed(2)).join(' / ')} m off (volley 1 / 2, touch radius ${R.toFixed(2)}) · headline flash ${fvLag.toFixed(3)} s before the first hit · tells ${fv.tells}/${fv.flashes}`);
    assert(fv.ok && leadSeen, 'even-count fan: the first volley has a lead ember (setLead)');
    assert(miss.length === 2 && miss[0] < 0.1 && miss[1] > R, `even-count fan: volley 1 is centred on the hero, volley 2 has him in a gap (${miss.map((m) => m.toFixed(2)).join(' / ')})`);
    assert(fvLag >= K.cueMin - DT && fvLag <= lead + 3 * DT, `even-count fan: the headline flash leads the first impact by ~flashLead (${fvLag.toFixed(3)} s)`);
    assert(fv.tells === fv.flashes, `even-count fan: one combat:flash per combat:tell (${fv.tells}/${fv.flashes})`);

    // a homing wisp that the hero sidesteps after its cue comes round again: it has to announce the
    // second pass too (or fizzle), never hit off the stale cue
    settle(G, 12);
    B.clear();
    run(G, 0.8, { passive: true });
    place(G, 7);
    {
      const h0 = G.hits.length, flashes = [];
      G.watch = (n, e) => { if (n === 'combat:flash' && e?.bullet) flashes.push(game.time); };
      const ux = (d.position.x - p.position.x), uz = (d.position.z - p.position.z), l = Math.hypot(ux, uz) || 1;
      const w = B.spawn(KIND.wisp, 'wispSwarm', p.position.x + (ux / l) * 8, 1.0, p.position.z + (uz / l) * 8, Math.atan2(-ux, -uz), K.wisp.cruise);
      w.turn = K.wisp.turn;
      w.homeAt = 0;
      let stepped = false, passes = 0, wasNear = false;
      for (let i = 0; i < Math.round(7 / DT) && w.alive; i++) {
        aimAt(G);
        input.axis = { x: 0, y: 0 };
        if (!stepped && flashes.length === 1 && game.time - flashes[0] >= 0.2) {
          stepped = true; // out of its way, 0.15 s before it lands
          p.debug.teleport(p.position.x - (uz / l) * 5, p.position.z + (ux / l) * 5);
        }
        G.tick(DT);
        const near1 = Math.hypot(w.x - p.position.x, w.z - p.position.z) < 1.5;
        if (near1 && !wasNear) passes++;
        wasNear = near1;
      }
      G.watch = null;
      const hs = G.hits.slice(h0).filter((h) => h.r === RESULT.HIT);
      const lag = hs[0] ? hs[0].t - flashes[flashes.length - 1] : NaN;
      out(`   wisp sidestepped after its cue: cues ${flashes.length} · hits ${hs.length}${hs[0] ? ` (${lag.toFixed(3)} s after the last cue)` : ''} · dud ${w.dud} · came near ${passes}×`);
      assert(stepped && flashes.length >= 1, 'the wisp was cued and sidestepped');
      assert(hs.length === 0 ? w.dud || !w.alive : flashes.length >= 2 && lag >= K.cueMin - DT && lag <= lead + K.cueGap + 2 * DT, `a wisp that missed announces its second pass before it hits (cues ${flashes.length}, lag ${lag.toFixed(3)})`);
      assert(flashes.length >= 2 || w.dud, `the second pass is cued again, or the wisp is a dud (cues ${flashes.length}, dud ${w.dud})`);
    }

    // a far hero: the lead wisp lands after the action is over; the headline flash waits for it
    const ws = watchPattern('wispSwarm', 28);
    const wsLag = ws.hits[0] && ws.headFlash !== null ? ws.hits[0].t - ws.headFlash : NaN;
    out(`   P2 wisp swarm at ${ws.dist.toFixed(1)} m: tell at ${(ws.headTell ?? NaN).toFixed(2)} · action over at ${(ws.ended ?? NaN).toFixed(2)} · headline flash at ${(ws.headFlash ?? NaN).toFixed(2)} · first hit at ${(ws.hits[0]?.t ?? NaN).toFixed(2)} (${wsLag.toFixed(3)} s after the flash) · hits ${ws.hits.length}/${WS.maxHits} · tells ${ws.tells}/${ws.flashes}`);
    assert(ws.ok && ws.dist > 26 && ws.headTell !== null && ws.headFlash !== null, 'far wisp swarm: headline tell and flash both go out');
    assert(ws.headFlash > ws.ended, `far wisp swarm: the lead is still flying when the action ends; the flash waits for it (${(ws.headFlash - ws.ended).toFixed(2)} s after the end)`);
    assert(wsLag >= K.cueMin - DT && wsLag <= lead + 3 * DT, `far wisp swarm: the headline flash leads the first impact by ~flashLead (${wsLag.toFixed(3)} s)`);
    assert(ws.tells === ws.flashes && ws.hits.length >= 1 && ws.hits.length <= WS.maxHits, `far wisp swarm: one flash per tell, hits within the budget (${ws.tells}/${ws.flashes}, ${ws.hits.length})`);
  };
  const perPhaseOf = (v, ph) => (Array.isArray(v) ? v[Math.min(v.length - 1, ph - 1)] : v);

  for (const phase of [1, 2, 3]) {
    for (const name of NAMES) {
      const spec = TUNING.attacks[name];
      if ((spec.phase ?? 1) > phase) continue;
      const idle = pattern(name, phase, false, DIST[name]);
      const ans = pattern(name, phase, true, DIST[name]);
      out(`   P${phase} ${name.padEnd(10)} standing: hit ${idle.hit}/${spec.maxHits} · peak ${String(idle.peak).padStart(3)} bullets · tells ${idle.tells}/${idle.flashes}   answering: hit ${ans.hit} parried ${ans.parried} dodged ${ans.dodged} blocked ${ans.blocked} · tells ${ans.tells}/${ans.flashes}`);
      assert(idle.ok && ans.ok && idle.ended >= 0 && ans.ended >= 0, `P${phase} ${name}: triggers and ends`);
      assert(idle.bad === 0 && ans.bad === 0 && idle.live === 0 && !idle.wheel && ans.live === 0, `P${phase} ${name}: no NaN, the field empties afterwards`);
      assert(idle.hit >= 1 && idle.hit <= spec.maxHits, `P${phase} ${name}: a standing hero is hit, at most maxHits times (${idle.hit}/${spec.maxHits})`);
      assert(idle.tells === idle.flashes && ans.tells === ans.flashes && idle.tells >= 1, `P${phase} ${name}: one combat:flash per combat:tell (${idle.tells}/${idle.flashes}, ${ans.tells}/${ans.flashes})`);
      // (the scripted defender answers one cue at a time: the phase-3 storm's crossing arms cost it a second hit)
      assert(ans.hit < idle.hit && ans.hit <= (name === 'emberStorm' ? 2 : 1), `P${phase} ${name}: answering the cues takes fewer hits than standing still (${ans.hit} < ${idle.hit})`);
      if (name === 'emberStorm') assert(ans.parried + ans.dodged >= 1, `P${phase} emberStorm: embers deflected / orbs rolled (${ans.parried} + ${ans.dodged})`);
      else if (name !== 'fireWheel') assert(ans.parried >= 1, `P${phase} ${name}: bullets were deflected (${ans.parried})`);
      else assert(ans.dodged >= 1, `P${phase} fireWheel: a spoke was rolled through (${ans.dodged})`);
    }
    if (phase === 2) lateCues();
  }
  out(`   console errors so far: ${errors.length}`);
  return G;
}

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
  // model viewer (look-dev): the reference sheet's rear 3/4, the solid render, the turntable, the
  // live sheet overlay, and a clean exit (camera, look and overlay restored)
  const sheetEl = () => document.body.find?.((e) => e.classList?.contains('lab-sheet'));
  const mv = lab.modelView({ target: 'hero', yaw: 215, dark: true, look: 'solid' });
  assert(mv?.yaw === 215 && mv.look === 'solid' && game.U.uHeroSolid.value === 1 && !!game.viewOverride, `model view: rear 3/4 (yaw ${mv?.yaw}), the solid look sets U.uHeroSolid`);
  lab.modelView({ target: 'hero', spin: true, yaw: 0, dark: true, look: 'ascii' });
  run(G, 0.5, { passive: true });
  const spun = lab.viewer.describe();
  assert(spun?.spin && spun.yaw > 10 && spun.yaw < 30 && game.U.uHeroSolid.value === 0, `model view: the turntable turns (yaw ${spun?.yaw} after 0.5 s), the ascii look clears U.uHeroSolid`);
  lab.modelView({ target: 'hero', sheet: true, dark: true });
  run(G, 0.6, { passive: true });
  assert(lab.viewer.describe()?.sheet && !!sheetEl() && errors.length === 0, 'model view: the live sheet overlay is up and cycles its angles without errors');
  lab.modelView(null);
  assert(game.viewOverride === null && game.U.uHeroSolid.value === 0 && !sheetEl(), 'model view exit: game camera, ascii look, no sheet overlay');
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

// ================================================================== scenario: fire / flight attacks + hazards (dragon-fire)
async function scenarioFire() {
  out('\n== scenario FIRE (flight attacks, spells, hazards: completion, flight bounds, flash timing, dodges, clear) ==');
  const G = build();
  const { game, input } = G;
  fightSetup(G);
  const d = game.dragon, p = game.player, H = d.hazards, lead = TUNING.flashLead;
  const ER_MAX_CHASE_HITS = TUNING.attacks.eruptions.chase.maxHits;
  const FIRE_NAMES = ['skyStrafe', 'diveBomb', 'hoverBarrage', 'meteorRain', 'eruptions', 'flameRing', 'flameWall', 'nova'];
  const AIR = new Set(['skyStrafe', 'diveBomb', 'hoverBarrage']);
  const HIGH = { skyStrafe: ['pass'], diveBomb: ['hover'], hoverBarrage: ['barrage'] };
  const listed = new Set(d.debug.abilities().map((a) => a.name));
  assert(FIRE_NAMES.every((n) => listed.has(n) && TUNING.attacks[n]?.tell === TELL.RED), 'every fire attack is a red Lab ability with tuning data');
  assert(H && typeof H.clear === 'function' && H.alive === 0, 'dragon.hazards exists, empty at the start');
  // payloads of the fire events (not in the shared PAYLOAD table: checked here)
  const badPay = [];
  const okPay = (n, dd) => {
    if (n === 'dragon:spell' && !(typeof dd?.name === 'string' && Number.isFinite(dd.x) && Number.isFinite(dd.z))) badPay.push(n);
    if (n === 'dragon:hazard' && !(typeof dd?.kind === 'string' && typeof dd?.stage === 'string' && [dd.x, dd.z, dd.radius].every(Number.isFinite))) badPay.push(n);
  };
  /** Put the hero `dist` m straight ahead of the wyrm (world metres), facing it, full HP. */
  const front = (dist) => {
    const a = d.yaw;
    p.debug.teleport(d.position.x + Math.sin(a) * dist, d.position.z + Math.cos(a) * dist);
    p.yaw = Math.atan2(d.position.x - p.position.x, d.position.z - p.position.z);
    p.debug.heal();
    aimAt(G);
  };
  const PLACE = { skyStrafe: 18, diveBomb: 14, hoverBarrage: 14, meteorRain: 12, eruptions: 14, flameRing: 9, flameWall: 14, nova: 12 };
  const timing = [];
  for (const name of FIRE_NAMES) {
    settle(G);
    H.clear();
    d.position.set(0, 0, -8);
    d.yaw = 0;
    d.rig.snap();
    run(G, 0.3, { passive: true });
    front(PLACE[name]);
    p.debug.god = true;
    const flashes = [], tells = [];
    const h0 = G.hits.length;
    let finite = true, maxAlt = 0, outOfBound = 0, circlesInAir = 0, lowSphere = Infinity, lowWhy = '', sawAir = false, spells = 0;
    G.watch = (n, dd) => {
      okPay(n, dd);
      if (n === 'dragon:spell' && dd?.name === name) spells++;
      if (dd?.attack !== name) return;
      if (n === 'combat:tell') tells.push(game.time);
      if (n === 'combat:flash') flashes.push(game.time);
    };
    const trig = game.lab.trigger(name);
    let done = false;
    for (let i = 0; i < Math.round(14 / DT) && !done; i++) {
      input.axis = { x: 0, y: 0 };
      G.tick(DT);
      const pt = d.rig.pt, s = d.rig.s;
      if (![pt.head.x, pt.head.y, pt.head.z, pt.chest.y, pt.hips.y, pt.mouth.y, s.alt, s.pitch, d.yaw].every(Number.isFinite)) finite = false;
      maxAlt = Math.max(maxAlt, s.alt);
      if (Math.hypot(d.position.x, d.position.z) > d.bound + 0.01) outOfBound++;
      if (d.state === 'airborne') {
        sawAir = true;
        if (d.bodyCircles.length) circlesInAir++;
      }
      // up in its main flight phase (the pass, the hover, the barrage) nothing is in sword reach
      if (HIGH[name]?.includes(d.brain.action?.phase)) for (const h of d.hurtSpheres) { if (h.y - h.r < lowSphere) { lowSphere = h.y - h.r; lowWhy = `${h.part} at ${d.brain.action?.phase} alt ${s.alt.toFixed(1)}`; } }
      done = !d.brain.action && d.state === 'combat' && !H.count(null);
    }
    G.watch = null;
    const hits = G.hits.slice(h0).filter((h) => h.attack === name && h.tell === TELL.RED);
    // each red blow lands flashLead after its timing flash (within ~2 frames)
    let worst = 0;
    for (const h of hits) {
      const f = flashes.filter((t) => t <= h.t + 1e-6).pop();
      const err = f === undefined ? Infinity : h.t - (f + lead);
      if (Math.abs(err) > Math.abs(worst)) worst = err;
    }
    timing.push(`${name} ${(worst * 1000).toFixed(0)}ms/${hits.length}`);
    out(`   ${name.padEnd(12)} trigger ${trig} done ${done} tells ${tells.length} flashes ${flashes.length} red hits ${hits.length} worst hit-(flash+lead) ${(worst * 1000).toFixed(0)} ms · max alt ${maxAlt.toFixed(1)} m${Number.isFinite(lowSphere) ? ` · lowest hurt sphere in flight ${lowSphere.toFixed(1)} m (${lowWhy})` : ''}`);
    assert(trig === true && done, `${name}: forced through the Lab, completes, back to combat with its hazards gone (${d.state})`);
    assert(finite, `${name}: positions and pose stay finite`);
    assert(tells.length >= 1 && tells.length === flashes.length, `${name}: one timing flash per tell (${tells.length} / ${flashes.length})`);
    assert(hits.length >= 1, `${name}: the standing hero is hit (${hits.length} red blows)`);
    assert(Math.abs(worst) <= 2.5 * DT, `${name}: every blow lands ~flashLead after its flash (worst ${(worst * 1000).toFixed(0)} ms)`);
    assert(maxAlt <= 16 && !outOfBound, `${name}: stays <= 16 m up and inside the bound (alt ${maxAlt.toFixed(1)}, out ${outOfBound})`);
    if (AIR.has(name)) {
      assert(sawAir && !circlesInAir, `${name}: flies (state airborne) with no body circles (${circlesInAir} frames with circles)`);
      assert(Number.isFinite(lowSphere) && lowSphere > 4.5, `${name}: flying, every hurt sphere is out of sword reach (lowest ${lowSphere.toFixed(1)} m, ${lowWhy})`);
    }
    assert(spells >= 1, `${name}: dragon:spell announces it`);
  }
  out('   flash timing: ' + timing.join(' · '));
  assert(!badPay.length, `dragon:spell / dragon:hazard payloads ${JSON.stringify(badPay.slice(0, 4))}`);

  // ---- a hazard against the hero: standing → hit, rolling (i-frames) → dodged, rolling out of its ring → untouched
  const meteorAt = (delay) => H.circle({ kind: 'meteor', attack: 'meteorRain', x: p.position.x, z: p.position.z, r: 3.4, delay, damage: 18, burn: 0, knockback: 3, fall: 0.6, from: { x: p.position.x + 5, y: 30, z: p.position.z - 11 } });
  const hazardTrial = (rollAt, axis) => {
    settle(G);
    H.clear();
    p.debug.god = false;
    p.debug.heal();
    p.burnT = 0;
    const hp0 = p.hp, h0 = G.hits.length;
    const delay = 1.2;
    meteorAt(delay);
    let told = 0, flashT = -1, rolled = false;
    const t0 = game.time;
    G.watch = (n, dd) => {
      if (dd?.attack !== 'meteorRain') return;
      if (n === 'combat:tell') told++;
      if (n === 'combat:flash') flashT = game.time;
    };
    for (let i = 0; i < Math.round(2.2 / DT); i++) {
      input.axis = { x: 0, y: 0 };
      if (rollAt !== null && !rolled && game.time - t0 >= delay - rollAt - 1e-6) {
        rolled = true;
        input.axis = axis;
        input.tap('Space');
      }
      G.tick(DT);
    }
    G.watch = null;
    const h = G.hits.slice(h0).find((x) => x.attack === 'meteorRain');
    return { res: h?.r ?? null, hp: hp0 - p.hp, told, flash: flashT >= 0 ? flashT - t0 : null };
  };
  const st = hazardTrial(null);
  out(`   meteor on a standing hero: ${st.res}, -${st.hp} HP, tells ${st.told}, flash at ${st.flash?.toFixed(3)} s (impact 1.2)`);
  assert(st.res === RESULT.HIT && near(st.hp, 18 * (TUNING.damageScale ?? 1), 0.01) && st.told === 1 && near(st.flash, 1.2 - lead, 1.5 * DT), 'a meteor hits a standing hero (announced, flashed flashLead before impact)');
  const rl = hazardTrial(0.25, { x: 0, y: 1 });
  out(`   meteor vs a roll 0.25 s before impact: ${rl.res}, -${rl.hp} HP`);
  assert(rl.res === RESULT.DODGED && rl.hp === 0, 'a rolling hero with i-frames is not hit (dodged)');
  const out1 = hazardTrial(0.8, { x: 1, y: 0 });
  out(`   meteor vs a roll out of the ring 0.8 s before impact: ${out1.res}, -${out1.hp} HP`);
  assert(out1.res === null && out1.hp === 0, 'a plain dodge out of the ring avoids it (no blow reaches the hero)');

  // ---- the strafe's burning strip: contact ticks while standing in it, none while rolling through it
  settle(G);
  H.clear();
  p.debug.god = false;
  p.debug.heal();
  const sx = p.position.x, sz = p.position.z;
  const strip = H.strip({ kind: 'strip', attack: 'skyStrafe', announce: false, ax: sx, az: sz - 6, bx: sx, bz: sz + 6, w: 4.6, delay: 0.05, speed: 40, linger: 2.5, tick: 0.25, tickDamage: 4, tickBurn: 0, damage: 26, burn: 0, knockback: 0 });
  const hs0 = G.hits.length;
  run(G, 1.2, { passive: true });
  const standTicks = G.hits.slice(hs0).filter((h) => h.attack === 'skyStrafe' && h.kind === 'fire').length;
  const front1 = G.hits.slice(hs0).filter((h) => h.attack === 'skyStrafe' && h.tell === TELL.RED).length;
  let rollTicks = 0, rollFrames = 0;
  for (let k = 0; k < 2; k++) {
    input.axis = { x: 0, y: k ? -1 : 1 };
    input.tap('Space');
    for (let i = 0; i < Math.round(0.6 / DT); i++) {
      const n0 = G.hits.length;
      G.tick(DT);
      if (p.state !== 'roll') continue;
      rollFrames++;
      rollTicks += G.hits.slice(n0).filter((h) => h.kind === 'fire').length;
    }
  }
  assert(rollFrames > 40, `the hero rolled through the burning strip (${rollFrames} rolling frames)`);
  out(`   strip: front blow ${front1}, ticks standing 1.2 s ${standTicks}, ticks landed during rolls ${rollTicks}`);
  assert(front1 === 1 && standTicks >= 3, 'the strip front hits once, then its fire ticks a hero standing in it');
  assert(rollTicks === 0, 'its fire never ticks a rolling hero');
  assert(H.get(strip) !== null, 'the strip still burns (lingers)');

  // ---- phase 3's eruptions variant: pillars chase the hero for ~3 s (each one rings, tells, flashes)
  settle(G);
  H.clear();
  d.phase = 3;
  G.tick(DT);
  front(14);
  p.debug.god = true;
  const ct = [], cf = [], ch0 = G.hits.length;
  let maxPillars = 0;
  G.watch = (n, dd) => {
    if (dd?.attack !== 'eruptions') return;
    if (n === 'combat:tell') ct.push(game.time);
    if (n === 'combat:flash') cf.push(game.time);
  };
  const rnd = Math.random;
  Math.random = () => 0.1; // (picks the chase: ER.chase.chance)
  game.lab.trigger('eruptions');
  Math.random = rnd;
  const isChase = d.brain.action?.chase === true;
  for (let i = 0; i < Math.round(6 / DT); i++) {
    input.axis = { x: i % 120 < 60 ? 1 : -1, y: 0 }; // the hero keeps moving (side to side)
    G.tick(DT);
    maxPillars = Math.max(maxPillars, H.count('pillar'));
  }
  G.watch = null;
  input.axis = { x: 0, y: 0 };
  const chits = G.hits.slice(ch0).filter((h) => h.attack === 'eruptions');
  // each blow must fall inside SOME pillar's live window: flash + lead .. + active (a moving hero may
  // walk into a pillar that is still erupting, after the next pillar's flash: pairing every blow
  // with the latest flash read that as early)
  const ER_ACT = TUNING.attacks.eruptions.active;
  let cworst = 0;
  for (const h of chits) {
    let best = Infinity;
    for (const f of cf) {
      const e = h.t - (f + lead);
      const out = e < 0 ? e : e > ER_ACT ? e - ER_ACT : 0; // distance outside the live window
      if (Math.abs(out) < Math.abs(best)) best = out;
    }
    if (Math.abs(best) > Math.abs(cworst)) cworst = best;
  }
  out(`   P3 eruption chase: ${isChase}, pillars alive at once ${maxPillars}, tells ${ct.length} flashes ${cf.length}, blows ${chits.length} (worst ${(cworst * 1000).toFixed(0)} ms outside a pillar's live window)`);
  assert(isChase && maxPillars >= 2 && ct.length >= 6 && ct.length === cf.length, 'phase 3: the eruptions chase the hero with announced pillars (one flash per tell)');
  assert(chits.length <= ER_MAX_CHASE_HITS && Math.abs(cworst) <= 2.5 * DT, 'the chase deals at most its hit cap, each blow inside a pillar live window (flash + lead .. + active)');
  d.phase = 1;
  run(G, 1, { passive: true });

  // ---- clear(): by hand, on a phase change, on death, on reset
  settle(G);
  H.clear();
  meteorAt(3);
  H.ring({ kind: 'ring', attack: 'flameRing', x: d.position.x, z: d.position.z, r0: 3, r1: 20, speed: 10, w: 2.2, delay: 2, damage: 1, announce: false });
  H.rain({ attack: 'meteorRain', count: 10, first: 1.3, span: 5, r: 3.4, damage: 1, group: H.group(3) });
  run(G, 0.2, { passive: true });
  const n0 = H.alive;
  H.clear();
  assert(n0 >= 3 && H.alive === 0 && H.count() === 0, `clear() empties the hazards (${n0} → ${H.alive})`);
  H.rain({ attack: 'meteorRain', count: 10, first: 0.5, span: 5, r: 3.4, damage: 1, group: H.group(3) });
  run(G, 1.0, { passive: true });
  const nr = H.alive;
  assert(d.debug.phase2() === true, 'phase 2 forced with hazards on the field');
  G.tick(DT);
  G.tick(DT);
  assert(nr >= 2 && H.alive === 0, `a phase change clears them (${nr} → ${H.alive})`);
  run(G, 6, { passive: true }, () => !d.brain.action && d.state === 'combat');
  H.rain({ attack: 'meteorRain', count: 10, first: 0.5, span: 5, r: 3.4, damage: 1, group: H.group(3) });
  run(G, 1.0, { passive: true });
  const nd = H.alive;
  assert(d.debug.kill() === true, 'kill with hazards on the field');
  G.tick(DT);
  G.tick(DT);
  assert(nd >= 2 && H.alive === 0, `death clears them (${nd} → ${H.alive})`);
  d.debug.reset();
  meteorAt(5);
  d.debug.reset();
  assert(H.alive === 0, 'reset clears them');

  // ---- killed in mid-air (hovering before the dive): it drops and dies cleanly, nothing left flying
  fightSetup(G);
  settle(G);
  front(14);
  game.lab.trigger('diveBomb');
  run(G, 4, { passive: true }, () => d.brain.action?.phase === 'hover');
  const alt0 = d.rig.s.alt, st0 = d.state;
  assert(d.debug.kill() === true, `killed while hovering (${st0}, alt ${alt0.toFixed(1)})`);
  let okFall = true;
  run(G, 2, { passive: true }, () => {
    if (![d.position.x, d.position.z, d.rig.s.alt, d.rig.pt.chest.y].every(Number.isFinite)) okFall = false;
    return false;
  });
  out(`   killed at alt ${alt0.toFixed(1)} (${st0}) → ${d.state}, alt ${d.rig.s.alt.toFixed(2)}`);
  assert(st0 === 'airborne' && alt0 > 10 && okFall && d.state === 'dying' && d.rig.s.alt < 0.2, 'a mid-air death drops the wyrm to the ground and plays the death');
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
  // the coat (ADR-034): two back tails split by a vent, narrow side panels, two front panels
  const tails = r.coat.filter((C) => Math.abs(C.def.az) > 2.2);
  assert(r.coat.length === 6 && tails.length === 2 && strips === 12 && r.coat.every((C) => !C.def.flap),
    `coat: 6 panels (2 back tails split by a vent, 2 side, 2 front), ${strips} torn strips`);
  // the Shrouded set (ADR-043): the cloak's sheets ride the streamer springs (heavier than a ribbon:
  // lag < 1); under the hood only the gold fringe is built (Session 14: the other clusters poke
  // through the cloth); the five spring joints stay for the animator
  {
    const built = Object.entries(r.hair).filter(([, j]) => j.children.some((o) => o.isMesh)).map(([n]) => n);
    assert(r.streamers?.length === 7 && r.streamers.every((S) => S.lag > 0 && S.lag < 1) && Object.keys(r.hair).length === 5 && built.join() === 'fringe' && r.slots.head.length > 0,
      `the cloak: ${r.streamers?.length} sheets on springs; under the hood the hair clusters built are [${built.join(', ')}] of 5 joints`);
  }
  // clear of the wyrm (AI off): run, sprint, roll, light / backhand / slam, charge + thrust
  p.debug.teleport(d.position.x + 14, d.position.z + 14);
  const v = new THREE.Vector3();
  let bad = 0, low = Infinity, tipLow = Infinity, frames = 0;
  // the elbows (ADR-044): the smallest bend of each arm over everything below (rad; 0 = a straight
  // arm). The off hand is skipped while it is on the grip (two-handed: it reaches where the grip is)
  let bendR = Infinity, bendL = Infinity;
  const probe = () => {
    frames++;
    bendR = Math.min(bendR, -r.arms.R.fore.rotation.x);
    if (p.anim.cur[45] < 0.05) bendL = Math.min(bendL, -r.arms.L.fore.rotation.x);
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
  // the 5-hit chain (ADR-041): falling cut → rising cut → whirl → stab → slam, then round again
  const chain = [];
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  G.watch = (n, dd) => { if (n === 'player:attack') chain.push(p.atk?.def?.name ?? dd.kind); };
  for (let k = 0; k < 6; k++) { input.click(0); go(k === 4 ? 0.7 : 0.4); }
  go(1.0);
  assert(chain.join(' ') === 'fallingCut risingCut whirl stab slam fallingCut', `LMB ×6 walks the chain and wraps (${chain.join(' → ')})`);
  assert(Math.abs(wrapA(p.anim.cur[4])) < 1e-3, `the whirl ends on a whole turn (body yaw ${p.anim.cur[4].toFixed(3)})`);
  // LMB out of a sprint: the bounding slash keeps the run's momentum and its direction
  chain.length = 0;
  input.axis = { x: 0, y: 1 };
  input.hold('ShiftLeft');
  go(0.9);
  const sx = p.position.x, sz = p.position.z, syaw = p.yaw;
  input.click(0);
  input.release('ShiftLeft');
  input.axis = { x: 0, y: 0 };
  go(0.3);
  const sprintDist = Math.hypot(p.position.x - sx, p.position.z - sz);
  assert(chain[0] === 'sprintSlash' && sprintDist > 1.8 && sprintDist < 3.4 && Math.abs(wrapA(p.yaw - syaw)) < 0.05,
    `LMB while sprinting is the sprint slash (${chain[0]}; carried ${sprintDist.toFixed(2)} m along the run)`);
  input.click(0);
  go(0.5);
  assert(chain[1] === 'risingCut', `the sprint slash counts as hit 1: the next tap is the rising cut (${chain[1]})`);
  go(0.8);
  // LMB out of a forward roll: the low rising cut
  chain.length = 0;
  input.axis = { x: 0, y: 1 };
  go(0.3);
  input.tap('Space');
  go(0.35);
  input.axis = { x: 0, y: 0 };
  input.click(0);
  go(0.9);
  assert(chain[0] === 'rollCut', `LMB out of a roll is the roll cut (${chain[0]})`);
  // a backstep (Space with no direction) keeps the plain chain
  chain.length = 0;
  input.tap('Space');
  go(0.25);
  input.click(0);
  go(0.9);
  assert(chain[0] === 'fallingCut', `LMB out of a backstep starts the chain (${chain[0]})`);
  G.watch = null;
  go(0.6);
  input.press(0);
  go(1.4);
  input.up(0);
  go(1.0);
  assert(!bad, `rig matrices stay finite through every move (${frames} frames)`);
  assert(low > -0.02, `torn strip tips stay above the grass (lowest ${low.toFixed(3)} m)`);
  assert(tipLow > -0.06, `the steel point never sinks into the ground (lowest ${tipLow.toFixed(3)} m)`);
  assert(bendR > 0.4 && bendL > 0.4, `neither arm locks straight: the elbows keep at least ${(Math.min(bendR, bendL) * 57.3).toFixed(0)} deg of bend through the run, the roll and every attack (sword arm ${(bendR * 57.3).toFixed(0)}, off arm ${(bendL * 57.3).toFixed(0)})`);
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
  // equipment slots (ADR-042): the outfit and the weapon are gear items in slots; a loadout swap
  // rebuilds them under the same root and the animator carries on with whatever cloth there is
  {
    const { SLOTS, DEFAULT_LOADOUT, getItem } = await imp('src/entities/player/gear/index.js');
    const root = p.object3d, pos = p.position;
    const meshes = () => { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; };
    const finite = () => { let ok = true; root.traverse((o) => { const e = o.matrixWorld.elements; for (let i = 0; i < 16; i++) if (!Number.isFinite(e[i])) ok = false; }); return ok; };
    const n0 = meshes();
    assert(SLOTS.join() === 'head,chest,shoulders,arms,legs,waist,back,weapon' && SLOTS.every((sl) => DEFAULT_LOADOUT[sl] == null || getItem(DEFAULT_LOADOUT[sl])?.slot === sl) && SLOTS.every((sl) => p.loadout[sl] === (DEFAULT_LOADOUT[sl] ?? null)),
      `gear slots: ${SLOTS.join(', ')}; the default loadout fills ${SLOTS.filter((sl) => DEFAULT_LOADOUT[sl]).length} of them`);
    // the sword hand is a fist on the grip's own frame, owned by the arms slot (not by the weapon)
    const fist = p.rig.sword.children.filter((o) => o.isMesh && o.userData.slot === 'arms');
    assert(fist.length >= 1 && p.rig.slots.weapon.length > 0 && p.rig.slots.weapon.every((o) => o.userData.slot === 'weapon'), `the sword hand's fist hangs on the grip (${fist.length} arms-slot meshes on the sword joint)`);
    const drive = () => {
      input.axis = { x: 0, y: 1 };
      for (let i = 0; i < 30; i++) G.tick(DT);
      input.axis = { x: 0, y: 0 };
      input.click(0);
      for (let i = 0; i < 40; i++) G.tick(DT);
      input.tap('Space');
      for (let i = 0; i < 50; i++) G.tick(DT);
    };
    p.equip('back', null);
    p.equip('waist', null);
    drive();
    assert(p.rig.streamers.length === 0 && p.rig.coat.length === 0 && p.loadout.back === null && p.object3d === root && p.position === pos && meshes() < n0 && finite(),
      `cape and coat tails off: ${meshes()} meshes (was ${n0}), same root, the rig stays finite through a run, a swing and a roll`);
    p.setLoadout({});
    drive();
    assert(p.loadout.weapon === null && p.loadout.chest === 'base.chest' && p.rig.slots.weapon.length === 0 && finite(), `an empty loadout wears the undersuit and no weapon (${meshes()} meshes), and still animates`);
    let threw = false;
    try { p.equip('back', 'no.such.item'); } catch { threw = true; }
    assert(threw && p.loadout.back === null, 'an unknown item id throws and changes nothing');
    p.setLoadout(DEFAULT_LOADOUT);
    drive();
    assert(meshes() === n0 && p.rig.coat.length === 6 && p.rig.streamers.length === 7 && p.sweep.sword === p.rig.sword && finite(), `back in the default set: ${meshes()} meshes, 6 coat panels, 7 cloak sheets`);
    // the outfit before ADR-043 is still a loadout: bare-headed (the hair is built again), the
    // pauldron, the half-cape
    const { WANDERER_LOADOUT } = await imp('src/entities/player/gear/index.js');
    p.setLoadout(WANDERER_LOADOUT);
    drive();
    const hair = Object.values(p.rig.hair).reduce((n, j) => n + j.children.filter((o) => o.isMesh).length, 0);
    assert(p.rig.streamers.length === 4 && hair > 0 && p.rig.slots.shoulders.length > 0 && p.rig.slots.head.length === 0 && finite(),
      `the Wanderer's set still builds: 4 cape sheets, ${hair} hair meshes, the pauldron, no hood`);
    p.setLoadout(DEFAULT_LOADOUT);
    drive();
    assert(meshes() === n0 && finite(), `and back to the Shrouded set (${meshes()} meshes)`);
  }
  return G;
}

// ================================================================== scenario: two hands, the guard, the cloak, idle life
async function scenarioHeroLife() {
  out('\n== scenario HEROLIFE (two hands on every swing, the raised guard, the cloak vs the charged blade, idle actions) ==');
  const { HERO_SCALE, DIM: HD } = await imp('src/entities/player/model.js');
  const { SHROUD_SHEETS } = await imp('src/entities/player/gear/shroud.js');
  const G = build();
  const { game, input } = G;
  fightSetup(G);
  const p = game.player, d = game.dragon, r = p.rig, A = p.anim;
  p.debug.god = true;
  p.debug.teleport(d.position.x + 14, d.position.z + 14);
  const v = new THREE.Vector3(), w = new THREE.Vector3(), q = new THREE.Vector3();
  const finite = () => { let ok = true; p.object3d.traverse((o) => { const e = o.matrixWorld.elements; for (let i = 0; i < 16; i++) if (!Number.isFinite(e[i])) ok = false; }); return ok; };
  // the off hand's wrist and its place on the grip (model metres)
  const offGap = () => {
    v.set(0, -HD.foreArm, 0).applyMatrix4(r.arms.L.fore.matrixWorld);
    w.set(0, 0, -HD.offGrip).applyMatrix4(r.sword.matrixWorld);
    return v.distanceTo(w) / HERO_SCALE;
  };
  const go = (s, each) => { for (let i = 0, n = Math.round(s / DT); i < n; i++) { G.tick(DT); each?.(); } };
  go(0.5);

  // (1) two hands on every swing: through each hit's active frames both hands are on the grip, the
  // off hand within 3.5 cm of its place, closed round the grip (rig.offHand)
  {
    const seen = {};
    const probe = () => {
      const a = p.atk, def = a?.def;
      if (p.state !== 'attack' || !def || def.kind !== 'light') return;
      if (a.t < def.windup || a.t > def.windup + def.active) return;
      const S = seen[def.name] ?? (seen[def.name] = { n: 0, two: 1, gap: 0, closed: true });
      S.n++;
      S.two = Math.min(S.two, A.cur[45]);
      S.gap = Math.max(S.gap, offGap());
      S.closed &&= !!r.offHand && r.offHand.grip.visible && !r.offHand.open.visible;
    };
    for (let k = 0; k < 5; k++) { input.click(0); go(k === 4 ? 0.7 : 0.4, probe); }
    go(1.0);
    input.axis = { x: 0, y: 1 };
    input.hold('ShiftLeft');
    go(0.9);
    input.click(0);
    input.release('ShiftLeft');
    input.axis = { x: 0, y: 0 };
    go(0.9, probe);
    input.axis = { x: 0, y: 1 };
    go(0.3);
    input.tap('Space');
    go(0.35);
    input.axis = { x: 0, y: 0 };
    input.click(0);
    go(0.9, probe);
    const names = Object.keys(seen);
    out(`   ${names.map((n) => `${n} two ${seen[n].two.toFixed(2)} gap ${(seen[n].gap * 100).toFixed(1)} cm`).join(' · ')}`);
    assert(['fallingCut', 'risingCut', 'whirl', 'stab', 'sprintSlash', 'rollCut'].every((n) => seen[n]?.n > 0),
      `every light swing was probed in its active frames (${names.join(', ')})`);
    assert(names.every((n) => seen[n].two > 0.95 && seen[n].gap < 0.035 && seen[n].closed),
      'both hands on the grip through every light swing: twoHand > 0.95, the off hand within 3.5 cm of its place and closed round the grip');
    go(1.0);
    assert(!r.offHand.grip.visible && r.offHand.open.visible && A.cur[45] < 0.05, 'at rest the free hand lets go and hangs open again');
  }

  // (2) the guard: two hands, the blade raised across the body (> 40° up), the off hand on the grip
  {
    input.press(2);
    go(0.35);
    // the blade's direction from two of its points (the hero's matrices carry the drawn scale and the
    // camera lean, so a decomposed world rotation would not be the blade's)
    p.lean.on = false;
    p.object3d.updateMatrixWorld(true);
    v.set(0, 0, 0).applyMatrix4(r.sword.matrixWorld);
    q.set(0, 0, 1).applyMatrix4(r.sword.matrixWorld).sub(v).normalize();
    p.lean.on = true;
    p.object3d.updateMatrixWorld(true);
    const elev = Math.asin(Math.min(1, Math.max(-1, q.y))) * 57.3;
    out(`   block: blade ${elev.toFixed(0)}° up, twoHand ${A.cur[45].toFixed(2)}, off hand ${(offGap() * 100).toFixed(1)} cm from its place`);
    assert(p.state === 'block' && A.cur[45] > 0.95 && elev > 40 && offGap() < 0.035, `the guard: both hands, the blade raised ${elev.toFixed(0)}° (> 40°)`);
    input.up(2);
    go(0.8);
  }

  // (3) the charge: the drawn-back blade never passes through a cloak sheet (the streamer bound)
  {
    const m = new THREE.Matrix4();
    let frames = 0, hit = 0;
    const clip = () => {
      frames++;
      let any = false;
      r.streamers.forEach((S, si) => {
        const D = SHROUD_SHEETS[si];
        if (!D) return;
        for (let k = 0; k < 2; k++) {
          m.copy(S.segs[k].matrixWorld).invert();
          const L = D.len[k], R0 = k ? D.wrap + 0.25 * D.len[0] : D.wrap;
          for (let i = 0; i <= 8; i++) {
            v.set(0, 0, 0.35 + (0.75 * i) / 8).applyMatrix4(r.sword.matrixWorld).applyMatrix4(m);
            const t = -v.y / L;
            if (t < 0 || t > 1) continue;
            const wd = D.w[k] + (D.w[k + 1] - D.w[k]) * t, R2 = R0 + 0.25 * t * L;
            if (Math.abs(v.x) > wd / 2) continue;
            if (Math.abs(v.z - (Math.cos(v.x / R2) - 1) * R2) < 0.02) any = true;
          }
        }
      });
      if (any) hit++;
    };
    input.press(0);
    go(1.6, clip);
    input.up(0);
    go(1.0);
    out(`   charge: the blade touched a cloak sheet in ${hit} of ${frames} frames`);
    assert(frames > 60 && hit <= 2, `held charge: the drawn-back blade stays out of the cloak (${hit} of ${frames} frames within 2 cm of a sheet)`);
  }

  // (4) idle life: standing still he does things (at least three different ones in 25 s), every
  // frame finite and the point never in the ground; a step cuts the action within 0.25 s
  {
    go(0.5);
    const c0 = A.fidget.count, names = new Set();
    let tipLow = Infinity, bad = 0;
    go(25, () => {
      if (A.fidget.name) names.add(A.fidget.name);
      v.set(0, 0, HD.steelTip).applyMatrix4(r.sword.matrixWorld);
      tipLow = Math.min(tipLow, v.y);
      if (!finite()) bad++;
    });
    const played = A.fidget.count - c0;
    out(`   idle life: ${played} actions in 25 s (${[...names].join(', ')}); the point's lowest ${tipLow.toFixed(3)} m`);
    assert(played >= 4 && names.size >= 3 && bad === 0 && tipLow > -0.03,
      `standing still he does ${played} things in 25 s, ${names.size} different, every frame finite, the point above the grass`);
    // start one and cut it
    let waited = 0;
    while (A.fidget.k < 0 && waited < 10) { go(0.1); waited += 0.1; }
    go(0.6);
    const before = A.fidget.w;
    input.axis = { x: 0, y: 1 };
    go(0.25);
    input.axis = { x: 0, y: 0 };
    assert(before > 0.5 && A.fidget.w === 0, `a step cuts the action: weight ${before.toFixed(2)} → ${A.fidget.w.toFixed(2)} within 0.25 s`);
    // locked on (a fight), he stays on guard: no idle action starts
    p.debug.teleport(d.position.x + 6, d.position.z + 6);
    go(0.5);
    p.lockOn = true;
    const c1 = A.fidget.count;
    go(8);
    assert(A.fidget.count === c1, 'locked on, no idle action starts');
    p.lockOn = false;
  }
  return G;
}

// ================================================================== scenario: hero look (athletic build)
// The athletic build (model.js BODY, ADR-040) and the steel kept out of his body and his coat. Through a run, a
// sprint, strafes and a backpedal, stops, a roll, the light combo + slam, a charged thrust and a
// block, the DRAWN blade (to DIM.drawnTip) never sinks > 2 cm into a body part (BODY's primitives
// in each joint's frame) and passes through a coat panel's sheet on only a few of the moving frames
// (round 2: ~14 % of the run / sprint / strafe / turn frames). The game-camera depth pull
// (heroArt.pull) is gone, so the blade is depth-tested like his body.
async function scenarioHeroLook() {
  out('\n== scenario HEROLOOK (athletic build; the blade stays out of his body and his coat; no depth pull) ==');
  const { BODY, sheetOffset } = await imp('src/entities/player/model.js');
  const G = build();
  const { game, input } = G;
  fightSetup(G);
  const p = game.player, r = p.rig, d = game.dragon, D = HERO_DIM;
  p.debug.god = true;
  p.debug.teleport(d.position.x + 14, d.position.z + 14);
  // the athletic build (ADR-040): between ADR-034's lean build (a 0.34 m chest, 0.07 m thighs: "a bit
  // too lanky") and round 3's broad one (a 0.50 m chest, 0.098 m thighs: a cloaked trapezoid). Still a
  // V to a belted waist; limbs with some weight
  const chest = Math.max(...BODY.shell.map((s) => s.rx)) * 2, waist = BODY.shell[1].rx * 2;
  assert(chest >= 0.37 && chest <= 0.44 && waist >= 0.25 && waist <= 0.3 && chest / waist >= 1.35 && D.shoulder[0] >= 0.17 && D.shoulder[0] <= 0.2
    && BODY.upperArm[0] >= 0.06 && BODY.upperArm[0] <= 0.075 && BODY.thigh[0] >= 0.08 && BODY.thigh[0] <= 0.095,
    `athletic build: chest ${chest.toFixed(2)} m over a ${waist.toFixed(2)} m waist, shoulders ±${D.shoulder[0]} m, upper arm r ${BODY.upperArm[0]}, thigh r ${BODY.thigh[0]}`);
  assert(r.mats.every((m) => m.defines?.SG_HERO_PULL === undefined && !m.uniforms.uArtPull), 'no hero material is drawn nearer the camera than it is (the blade is depth-tested)');
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  const restSpine = D.pivot + 0.015 + D.pelvis[1] + D.spine[1];
  // signed depth (m, > 0 inside) of a joint-local point in an ellipsoid / a tapered capsule down −Y /
  // the torso shell (BODY.shell rings at world idle heights)
  const ell = (q, c, rr) => {
    const k = Math.hypot((q.x - c[0]) / rr[0], (q.y - c[1]) / rr[1], (q.z - c[2]) / rr[2]);
    return k > 1e-6 ? Math.hypot(q.x - c[0], q.y - c[1], q.z - c[2]) * (1 / k - 1) : 1;
  };
  const cap = (q, y0, len, r0, r1) => {
    const t = clamp((y0 - q.y) / len, 0, 1);
    return r0 + (r1 - r0) * t - Math.hypot(q.x, q.y - (y0 - t * len), q.z);
  };
  const shell = (q) => {
    const R = BODY.shell, h = q.y + restSpine;
    if (h < R[0].y || h > R[R.length - 1].y) return -1;
    let k = 0;
    while (k < R.length - 2 && R[k + 1].y < h) k++;
    const A = R[k], B = R[k + 1], u = (h - A.y) / (B.y - A.y);
    const rx = A.rx + (B.rx - A.rx) * u, rz = A.rz + (B.rz - A.rz) * u, cz = (A.cz ?? 0) + ((B.cz ?? 0) - (A.cz ?? 0)) * u;
    const qq = Math.hypot(q.x / rx, (q.z - cz) / rz);
    return qq > 1e-6 ? Math.hypot(q.x, q.z - cz) * (1 / qq - 1) : 1;
  };
  // (the sword arm's own forearm is left out: the blade's base sits in the gauntlet; the free
  // forearm only to the wrist: the free hand braces the flat in the block)
  const parts = [
    ['torso', r.spine, shell],
    ['hips', r.pelvis, (q) => ell(q, BODY.hips.c, BODY.hips.r)],
    ['head', r.head, (q) => ell(q, BODY.head.c, BODY.head.r)],
    ['right upper arm', r.arms.R.upper, (q) => cap(q, 0, D.upperArm, BODY.upperArm[0], BODY.upperArm[1])],
    ['left upper arm', r.arms.L.upper, (q) => cap(q, 0, D.upperArm, BODY.upperArm[0], BODY.upperArm[1])],
    ['left forearm', r.arms.L.fore, (q) => cap(q, 0, D.foreArm - 0.06, BODY.foreArm[0], BODY.foreArm[1])],
    ...['R', 'L'].flatMap((s) => [
      [`thigh ${s}`, r.legs[s].thigh, (q) => cap(q, 0, D.thigh, BODY.thigh[0], BODY.thigh[1])],
      [`shin ${s}`, r.legs[s].shin, (q) => cap(q, -0.02, D.shin - 0.04, BODY.shin[0], BODY.shin[1])],
    ]),
  ];
  const tip = D.drawnTip ?? D.steelTip;
  let worst = -1, worstAt = '';
  const bodyPen = () => {
    for (let z = 0.2; z <= tip + 1e-6; z += 0.05) {
      v.set(0, 0, z).applyMatrix4(r.sword.matrixWorld);
      for (const [name, J, f] of parts) {
        const pen = f(J.worldToLocal(w.copy(v)));
        if (pen > worst) {
          worst = pen;
          worstAt = `${name}, ${p.state}${p.atk?.def ? ' ' + p.atk.def.kind + (p.atk.def.combo ?? '') : ''} t ${(p.atk?.t ?? p.stateT ?? 0).toFixed(2)}`;
        }
      }
    }
  };
  // a coat segment's sheet hangs −Y from its joint, curved round the hips (radius r0 + 0.25 × depth):
  // the blade crosses it where its side of the sheet flips inside the sheet's span
  const coatCross = () => {
    for (const C of r.coat) {
      const P = C.def;
      if (P.flap) continue;
      for (let s = 0; s < 2; s++) {
        const len = P.len[s] + 0.02, Rt = C.r0 + (s ? 0.25 * P.len[0] : 0);
        let pf = 0, pin = false;
        for (let z = 0.16; z <= tip + 1e-6; z += 0.03) {
          C.segs[s].worldToLocal(w.copy(v.set(0, 0, z).applyMatrix4(r.sword.matrixWorld)));
          const t = -w.y / len, R = Rt + 0.25 * clamp(t, 0, 1) * len;
          const u = Math.asin(clamp(w.x / R, -1, 1)) * R;
          const f = w.z - (Math.cos(u / R) - 1) * R;
          const wt = P.w[s] + (P.w[s + 1] - P.w[s]) * clamp(t, 0, 1);
          const inside = t >= 0 && t <= 1 && Math.abs(u - sheetOffset(wt, P.w[0], P.skew ?? 0)) <= 0.5 * wt;
          if (inside && pin && Math.sign(f) !== Math.sign(pf)) return true;
          pf = f;
          pin = inside;
        }
      }
    }
    return false;
  };
  let frames = 0, cross = 0, locoFrames = 0, locoCross = 0;
  const LOCO = new Set(['idle', 'run', 'sprint']);
  const go = (s) => {
    for (let i = 0, n = Math.round(s / DT); i < n; i++) {
      G.tick(DT);
      frames++;
      bodyPen();
      const c = coatCross();
      if (c) cross++;
      if (LOCO.has(p.state)) {
        locoFrames++;
        if (c) locoCross++;
      }
    }
  };
  input.axis = { x: 0, y: 1 };
  go(1.2);
  input.hold('ShiftLeft');
  go(1.0);
  input.release('ShiftLeft');
  for (const [x, y] of [[1, 0], [0, -1], [-1, 0], [0, 0]]) {
    input.axis = { x, y };
    go(1.0);
  }
  input.axis = { x: 0, y: 1 };
  go(0.3);
  input.tap('Space');
  go(0.9);
  input.axis = { x: 0, y: 0 };
  go(0.5);
  for (let k = 0; k < 5; k++) {
    input.click(0);
    go(k === 4 ? 0.9 : 0.42);
  }
  go(0.8);
  // the sprint slash and the roll cut
  input.axis = { x: 0, y: 1 };
  input.hold('ShiftLeft');
  go(0.8);
  input.click(0);
  input.release('ShiftLeft');
  input.axis = { x: 0, y: 0 };
  go(1.0);
  input.axis = { x: 0, y: 1 };
  go(0.3);
  input.tap('Space');
  go(0.35);
  input.axis = { x: 0, y: 0 };
  input.click(0);
  go(1.0);
  input.press(0);
  go(1.4);
  input.up(0);
  go(1.0);
  input.press(2);
  go(0.8);
  input.up(2);
  go(0.6);
  assert(worst < 0.02, `the drawn blade never sinks > 2 cm into his body (${frames} frames; deepest ${(worst * 100).toFixed(1)} cm: ${worstAt})`);
  assert(locoCross <= Math.max(3, locoFrames * 0.05), `the blade passes through a coat panel on ${locoCross} of ${locoFrames} run / sprint / idle frames (≤ 5 %; ${cross} of ${frames} over every move)`);
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

// ================================================================== scenario: string timing / coverage
// The verifier for the melee strings (contract 1): every hit of every string, started through the
// AI's own start path (no Lab face-turn) from placements the AI would pick it at (its band), the hero
// standing still (god mode, held at his spot). Per hit: first contact - (its combat:flash + flashLead).
// Every contact must land within ±85 ms of its flash; the first hit must land from every AI pick.
async function scenarioTiming() {
  out('\n== scenario TIMING (strings: each hit lands within ±85 ms of its flash + lead, AI picks, phases 1-3) ==');
  const G = build();
  const { game } = G;
  fightSetup(G);
  const d = game.dragon, p = game.player;
  const { ATTACKS } = await imp('src/entities/dragon/attacks.js');
  const { attackWeight } = await imp('src/entities/dragon/ai.js');
  const lead = TUNING.flashLead, TOL = 0.085;
  // the strings, plus the single melee attacks they share performances with (unchanged numbers)
  const names = (process.env.ABYSS_TM || 'clawCombo,rendingFlurry,hesitantMaw,wingBuffet,tailLash,pounce,frenzy,bite,swipe,tail,stomp').split(',');
  const DISTS = [2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10, 12.5];
  const ANGS = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2, 1.5, -1.5, 1.9, -1.9, 2.5, -2.5, Math.PI];
  const report = {};
  let worst = 0, bad = 0, firstMiss = 0, picks = 0;
  const flashes = [], hits = [];
  const hp0 = d.hitPlayer.bind(d), ft0 = d.flashTell.bind(d);
  let probing = '';
  d.hitPlayer = (o, a) => { const r = hp0(o, a); if (a?.cur && a.name === probing) hits.push({ t: game.time, hit: a.cur.hit ?? 0, r }); return r; };
  d.flashTell = (a, b) => { if (a.name === probing) flashes.push({ t: game.time, hit: b.hit ?? 0 }); return ft0(a, b); };
  for (const name of names) {
    const def = ATTACKS[name];
    if (!def) { assert(false, `string ${name} exists`); continue; }
    const first = def.phase ?? TUNING.attacks[name]?.phase ?? 1;
    const R = (report[name] = { picks: 0, hits: {}, miss1: [] });
    probing = name;
    // the single attacks (measured since v0.4) on a coarser grid: half the distances and angles
    const coarse = !def.string;
    for (const phase of [first, 3].filter((v, i, a) => a.indexOf(v) === i)) {
      for (const dist of coarse ? DISTS.filter((v, i) => i % 2 === 0) : DISTS) for (const ang of coarse ? ANGS.filter((v, i) => i % 4 < 2 || v === Math.PI) : ANGS) {
        // a fresh, idle wyrm at the origin facing +Z, in this phase
        d.debug.reset();
        d.debug.startFight();
        d.debug.setAI(false);
        if (phase > 1) d.enterPhase(phase);
        d.position.set(0, 0, 0);
        d.yaw = 0;
        d.rig.snap();
        p.debug.god = true;
        const px = Math.sin(ang) * dist * SCALE, pz = Math.cos(ang) * dist * SCALE;
        p.debug.teleport(px, pz);
        run(G, 0.5, { passive: true });
        d.position.set(0, 0, 0);
        d.yaw = 0;
        p.debug.teleport(px, pz);
        G.tick(DT);
        if (!(attackWeight(def, name, d, d.sense) > 0) || d.brain.action) continue; // not an AI pick here
        picks++;
        R.picks++;
        flashes.length = 0;
        hits.length = 0;
        d.brain.startAction(def);
        for (let i = 0; i < 900 && d.brain.action?.name === name; i++) {
          G.input.axis = { x: 0, y: 0 };
          G.tick(DT);
          p.debug.teleport(px, pz); // he stands his ground (knock-backs don't move the probe)
          p.hp = p.maxHp;
        }
        const seen = new Set();
        for (const h of hits) {
          if (seen.has(h.hit)) continue;
          seen.add(h.hit);
          const f = flashes.find((x) => x.hit === h.hit);
          const dt = f ? h.t - (f.t + lead) : NaN;
          const e = (R.hits[h.hit] ||= { n: 0, lo: Infinity, hi: -Infinity, bad: [] });
          e.n++;
          if (Number.isFinite(dt)) { e.lo = Math.min(e.lo, dt); e.hi = Math.max(e.hi, dt); }
          worst = Math.max(worst, Math.abs(dt));
          if (!(Math.abs(dt) <= TOL)) { bad++; if (e.bad.length < 4) e.bad.push(`P${phase} ${dist}@${ang.toFixed(1)}: ${Number.isFinite(dt) ? Math.round(dt * 1000) : 'no flash'} ms`); }
        }
        const nb = flashes.length ? Math.max(...flashes.map((f) => f.hit)) + 1 : 0;
        for (let h = 0; h < nb; h++) (R.hits[h] ||= { n: 0, lo: Infinity, hi: -Infinity, bad: [] }).tried = (R.hits[h].tried ?? 0) + 1;
        if (!seen.has(0)) { firstMiss++; if (R.miss1.length < 6) R.miss1.push(`P${phase} ${dist}@${ang.toFixed(1)}`); }
        if (process.env.ABYSS_TMV) (R.map ||= []).push(`P${phase} ${String(dist).padStart(4)}@${ang.toFixed(1).padStart(4)}: ${[...seen].sort().join('')}/${nb} ${hits.filter((h, i, A) => A.findIndex((x) => x.hit === h.hit) === i).map((h) => { const f = flashes.find((x) => x.hit === h.hit); return f ? Math.round((h.t - f.t - lead) * 1000) : '?'; }).join(',')}`);
      }
    }
    if (R.map) out(R.map.map((l) => `      ${l}`).join('\n'));
    const rows = Object.keys(R.hits).sort((a, b) => a - b).map((k) => {
      const e = R.hits[k];
      return `h${k} ${e.n}/${e.tried ?? '?'} ${e.n ? `${Math.round(e.lo * 1000)}…${Math.round(e.hi * 1000)} ms` : ''}${e.bad.length ? ` BAD ${e.bad.join('; ')}` : ''}`;
    });
    out(`   ${name.padEnd(14)} ${String(R.picks).padStart(3)} picks · ${rows.join(' · ')}${R.miss1.length ? ` · first hit missed: ${R.miss1.join(', ')}` : ''}`);
  }
  d.hitPlayer = hp0;
  d.flashTell = ft0;
  assert(picks > 0, `string placements probed (${picks})`);
  assert(bad === 0, `every string contact within ±${TOL * 1000} ms of its flash + lead (worst ${Math.round(worst * 1000)} ms, ${bad} off)`);
  assert(firstMiss === 0, `every AI pick lands its first hit (${firstMiss} missed)`);
  return G;
}

// ================================================================== scenario: strings (contract 1)
// The data contract of every string (tells, readable first windup, room to re-press RMB between hits,
// the flash after the tell, in all three phases); the deflect chain on Rending flurry with every
// parryable hit parried (the string goes on after each non-final parry, recoils after the last, the
// posture adds up, combat:deflectChain counts); a red hit inside a string breaks a held guard.
async function scenarioStrings() {
  out('\n== scenario STRINGS (deflect chain: Rending flurry parried hit by hit; a red hit in a string vs a held guard) ==');
  const G = build();
  const { game, input } = G;
  fightSetup(G);
  const d = game.dragon, p = game.player;
  const { ATTACKS } = await imp('src/entities/dragon/attacks.js');
  const lead = TUNING.flashLead, gapMin = TUNING.minHitGap;
  // 1) the data contract, per phase (later phases shorten windups by phaseTimeScale)
  const strings = Object.keys(ATTACKS).filter((k) => ATTACKS[k].string);
  assert(strings.length >= 7, `strings registered (${strings.join(', ')})`);
  const problems = [];
  for (const name of strings) {
    const H = TUNING.attacks[name].hits;
    if (!(H[0].windup >= 0.7)) problems.push(`${name} first windup ${H[0].windup} < 0.7`);
    for (let ph = 1; ph <= 3; ph++) {
      const ts = TUNING.phaseTimeScale[ph - 1];
      H.forEach((h, i) => {
        if (!TELLS.has(h.tell)) problems.push(`${name}.${i} tell ${h.tell}`);
        if (!(h.impact <= h.active + 1e-9)) problems.push(`${name}.${i} impact past its active`);
        if (!(h.windup * ts + h.impact >= lead + DT)) problems.push(`${name}.${i} P${ph}: flash before its tell (${(h.windup * ts + h.impact).toFixed(2)} s)`);
        // the next hit that can follow this one (an optional hit may be rolled out)
        for (let j = i + 1; j < H.length; j++) {
          const n = H[j], gap = h.active - h.impact + n.windup * ts + n.impact;
          if (!(gap >= gapMin - 1e-9)) problems.push(`${name}.${i}->${j} P${ph}: ${gap.toFixed(3)} s between impacts`);
          if (!(n.chance < 1)) break;
        }
      });
    }
  }
  assert(!problems.length, `every string hit: a tell, a first windup >= 0.7 s, its flash after its tell, >= ${gapMin} s impact to impact (all phases) ${JSON.stringify(problems.slice(0, 6))}`);

  // 2) Rending flurry, every hit parried (blue hits too): the deflect chain
  settle(G);
  place(G, (4.0 * SCALE) / SIZE); // 4 model units in front: inside its AI band
  const spec = TUNING.attacks.rendingFlurry;
  const pend = [], par = [], chains = [], actAfter = [], tells = [];
  let tellN = 0;
  const post0 = d.posture;
  G.watch = (n, dd) => {
    if (dd?.attack !== 'rendingFlurry' && n !== 'combat:deflectChain') return;
    if (n === 'combat:tell') { tellN++; tells.push(dd.tell); pend.push({ at: game.time + dd.impactIn, done: false }); }
    if (n === 'combat:flash') { const e = pend.find((x) => !x.done); if (e) e.at = game.time + lead; }
    if (n === 'dragon:parried') par.push(dd);
    if (n === 'combat:deflectChain') chains.push(dd.count);
  };
  const hp0 = p.hp;
  d.brain.startAction(ATTACKS.rendingFlurry);
  let last = -1;
  for (let i = 0; i < Math.round(8 / DT); i++) {
    aimAt(G);
    input.axis = { x: 0, y: 0 };
    for (const e of pend) if (!e.done && e.at - game.time - DT <= 0.12) { e.done = true; input.click(2); }
    G.tick(DT);
    if (par.length !== last) { last = par.length; if (last > 0) actAfter.push(d.brain.action?.name ?? '-'); }
    if (!d.brain.action || (d.brain.action.name !== 'rendingFlurry' && d.brain.action.name !== 'recoil')) break;
  }
  G.watch = null;
  const want = spec.hits.reduce((s, h) => s + (POSTURE.parry[h.tell] ?? POSTURE.parry.normal), 0);
  out(`   rendingFlurry: tells [${tells.join(' ')}] · parried ${JSON.stringify(par.map((x) => [x.hit, x.last]))} · action after each parry [${actAfter.join(', ')}] · deflectChain ${JSON.stringify(chains)} · posture ${post0.toFixed(0)} → ${d.posture.toFixed(0)} (want +${want}) · hp ${hp0} → ${p.hp}`);
  assert(tellN === spec.hits.length && tells.join() === spec.hits.map((h) => h.tell).join(), `every hit announced with its own tell (${tells.join(' ')})`);
  assert(par.length === spec.hits.length && par.every((x, i) => x.hit === i && x.last === (i === spec.hits.length - 1) && x.attack === 'rendingFlurry'), `every hit parried: dragon:parried {hit, last} in order (${JSON.stringify(par.map((x) => [x.hit, x.last]))})`);
  assert(actAfter.slice(0, -1).every((n) => n === 'rendingFlurry'), `a parry on a non-final hit deflects: the string goes on (${actAfter.join(', ')})`);
  assert(actAfter[actAfter.length - 1] === 'recoil', `the last hit's parry recoils the wyrm (${actAfter[actAfter.length - 1]})`);
  assert(chains.join() === '2,3,4', `combat:deflectChain from the 2nd parry in a row (${JSON.stringify(chains)})`);
  assert(near(d.posture - post0, want, 1.5), `the parries' posture adds up (+${(d.posture - post0).toFixed(1)}, want +${want})`);
  assert(p.hp === hp0, 'no damage through four parries');
  // a hit that lands breaks the chain: the claw combo with only its last hit parried
  settle(G);
  place(G, 4.0);
  const chain2 = [];
  const pend2 = [];
  let tn = 0;
  G.watch = (n, dd) => {
    if (n === 'combat:deflectChain') chain2.push(dd.count);
    if (dd?.attack !== 'clawCombo') return;
    if (n === 'combat:tell') { tn++; pend2.push({ at: game.time + dd.impactIn, done: tn < 3, n: tn }); }
    if (n === 'combat:flash') { const e = pend2.find((x) => !x.done) ?? pend2[pend2.length - 1]; if (e) e.at = game.time + lead; }
  };
  d.brain.startAction(ATTACKS.clawCombo);
  for (let i = 0; i < Math.round(6 / DT); i++) {
    aimAt(G);
    input.axis = { x: 0, y: 0 };
    p.hp = p.maxHp;
    for (const e of pend2) if (!e.done && e.at - game.time - DT <= 0.12) { e.done = true; input.click(2); }
    G.tick(DT);
    if (!d.brain.action || (d.brain.action.name !== 'clawCombo' && d.brain.action.name !== 'recoil')) break;
  }
  G.watch = null;
  assert(chain2.length === 0, `a single parry after hits that landed is no chain (${JSON.stringify(chain2)})`);

  // 3) a red hit inside a string can't be blocked: Tail lash with the guard held from the start
  settle(G);
  d.enterPhase(2);
  place(G, 4.0);
  const res = [];
  const h0 = G.hits.length;
  input.press(2);
  run(G, 0.2, { passive: true });
  const gb0 = G.counts['player:guardBreak'] || 0;
  d.brain.startAction(ATTACKS.tailLash);
  for (let i = 0; i < Math.round(6 / DT); i++) {
    aimAt(G);
    input.axis = { x: 0, y: 0 };
    G.tick(DT);
    p.hp = p.maxHp;
    if (!d.brain.action || d.brain.action.name !== 'tailLash') break;
  }
  input.up(2);
  for (const h of G.hits.slice(h0)) if (h.attack === 'tailLash') res.push(`${h.tell}:${h.r}`);
  out(`   tailLash vs a held guard: ${res.join(' · ')} · guardBreak ${(G.counts['player:guardBreak'] || 0) - gb0}`);
  assert(res[0] === 'normal:blocked', `the string's normal claw is blocked (${res[0]})`);
  assert(res.some((r) => r === 'red:hit') && (G.counts['player:guardBreak'] || 0) > gb0, `a red hit inside the string breaks the held guard (${res.join(' · ')})`);
  return G;
}

// ================================================================== scenario: the plunge (contract 2, dragon side)
// onPlunge called directly (the player side is the plunge agent's): grounded mid-windup, airborne
// during the leap (it crashes and lands, finite), an execution on a broken wyrm, the phase gate, a
// phase transition (not cancelled), and the head point the hero rides.
async function scenarioPlungeReact() {
  out('\n== scenario PLUNGE (dragon side: onPlunge grounded / during the leap / execution / phase gate) ==');
  const G = build();
  const { game } = G;
  fightSetup(G);
  const d = game.dragon, p = game.player;
  const { ATTACKS } = await imp('src/entities/dragon/attacks.js');
  const v = new THREE.Vector3();
  const c = (n) => G.counts[n] || 0;
  let plunged = [];
  G.watch = (n, dd) => { if (n === 'dragon:plunged') plunged.push(dd); };
  p.debug.god = true;
  // the point the hero rides: on top of the drawn head
  settle(G);
  d.plungePoint(v);
  const head = d.rig.pt.head;
  assert(typeof d.plungePoint === 'function' && typeof d.onPlunge === 'function', 'dragon.plungePoint(out) + onPlunge(o) exist');
  assert([v.x, v.y, v.z].every(Number.isFinite) && near(v.x, head.x, 1e-6) && v.y > head.y + 0.5, `plungePoint = the head + up (${v.y.toFixed(2)} vs head ${head.y.toFixed(2)})`);
  // 1) grounded, in a bite's windup: damage once (exact), posture, the bite cancelled, the reaction
  place(G, 6);
  d.brain.startAction(ATTACKS.bite);
  run(G, 0.3, { passive: true });
  const hp0 = d.hp, pos0 = d.posture, hits0 = G.hits.length;
  const dealt = d.onPlunge({ damage: 90, posture: 40, point: d.plungePoint(v), execution: false });
  const again = d.onPlunge({ damage: 90, posture: 40, point: d.plungePoint(v), execution: false });
  const act = d.brain.action?.name, st = d.state;
  out(`   grounded: dealt ${dealt} (again ${again}) hp ${hp0} → ${d.hp} · posture ${pos0.toFixed(0)} → ${d.posture.toFixed(0)} · action ${act} · state ${st}`);
  assert(dealt === 90 && again === 0 && hp0 - d.hp === 90, `the plunge's damage lands once, exactly (dealt ${dealt}, then ${again}; hp −${hp0 - d.hp})`);
  assert(near(d.posture - pos0, 40, 0.5), `the plunge adds its posture (+${(d.posture - pos0).toFixed(1)})`);
  assert(act === 'plunged' && st === 'staggered' && plunged.length === 1 && plunged[0].execution === false, `the bite is cancelled: plunged reaction, staggered, dragon:plunged {execution:false} (${act}, ${st})`);
  let minHeadY = Infinity, finite = true;
  const tR = game.time;
  run(G, 3, { passive: true }, () => {
    minHeadY = Math.min(minHeadY, d.rig.pt.head.y);
    d.plungePoint(v);
    if (![v.x, v.y, v.z, d.position.x, d.position.z].every(Number.isFinite)) finite = false;
    return d.brain.action?.name !== 'plunged';
  });
  const dur = game.time - tR;
  out(`   reaction: ${dur.toFixed(2)} s, the head down to ${minHeadY.toFixed(2)} m, then ${d.brain.action?.name ?? 'idle'} / ${d.state}`);
  assert(minHeadY < 2.5 && finite, `the head is slammed to the ground (${minHeadY.toFixed(2)} m), every point finite`);
  assert(dur > 1.0 && dur < 1.8 && d.state === 'combat', `the reaction ends in ~1.35 s, back in combat (${dur.toFixed(2)} s, ${d.state})`);
  assert(!G.hits.slice(hits0).some((h) => h.attack === 'bite'), 'the cancelled bite never lands');
  // 2) airborne: during the leap's flight it crashes from where it was hit, lands finite, no slam
  settle(G);
  d.enterPhase(2);
  place(G, 10);
  plunged = [];
  const land0 = c('dragon:land'), hits1 = G.hits.length;
  d.brain.startAction(ATTACKS.leap);
  run(G, 3, { passive: true }, () => d.state === 'airborne' && d.rig.s.alt > 6);
  const alt0 = d.rig.s.alt, ax = d.position.x, az = d.position.z;
  const dealtAir = d.onPlunge({ damage: 90, posture: 40, point: d.plungePoint(v), execution: false });
  const a1 = d.brain.action;
  out(`   airborne: alt ${alt0.toFixed(1)} m · dealt ${dealtAir} · action ${a1?.name}.${a1?.phase} · state ${d.state}`);
  assert(alt0 > 6 && dealtAir === 90 && a1?.name === 'plunged' && a1.phase === 'fall' && d.state === 'airborne', `mid-leap: the plunge cancels the flight, it falls (${a1?.name}.${a1?.phase}, ${d.state})`);
  let landedAt = -1, maxAlt = 0, fin2 = true;
  run(G, 3, { passive: true }, () => {
    if (landedAt < 0 && d.state === 'staggered') landedAt = game.time;
    maxAlt = Math.max(maxAlt, d.rig.s.alt);
    if (![d.position.x, d.position.z, d.rig.s.alt, d.rig.pt.head.y].every(Number.isFinite)) fin2 = false;
    return d.brain.action?.name !== 'plunged';
  });
  const moved = Math.hypot(d.position.x - ax, d.position.z - az);
  out(`   crash: landed ${landedAt > 0 ? 'yes' : 'no'}, alt now ${d.rig.s.alt.toFixed(2)} m, root moved ${moved.toFixed(2)} m, dragon:land +${c('dragon:land') - land0}, state ${d.state}`);
  assert(landedAt > 0 && d.rig.s.alt < 0.3 && fin2 && d.state === 'combat', `it crash-lands and stands up again, finite (alt ${d.rig.s.alt.toFixed(2)}, ${d.state})`);
  assert(moved < 1.0 && c('dragon:land') - land0 === 1, `it falls where it was hit (moved ${moved.toFixed(2)} m), one dragon:land`);
  assert(!G.hits.slice(hits1).some((h) => h.attack === 'leap'), 'the cancelled leap never slams');
  // 3) an execution on a broken wyrm: big, longer, consumes the break
  settle(G);
  plunged = [];
  assert(d.debug.postureBreak() === true, 'posture break');
  run(G, 0.6, { passive: true });
  const hp2 = d.hp;
  const dealtX = d.onPlunge({ damage: 260, posture: 0, point: d.plungePoint(v), execution: true });
  const tX = game.time;
  out(`   execution: dealt ${dealtX} · broken ${d.broken} · posture ${d.posture} · ${d.brain.action?.name}`);
  assert(dealtX === 260 && hp2 - d.hp === 260 && !d.broken && d.posture === 0, `the execution deals its damage and consumes the break (dealt ${dealtX}, broken ${d.broken})`);
  assert(plunged.length === 1 && plunged[0].execution === true, 'dragon:plunged {execution:true}');
  run(G, 4, { passive: true }, () => d.brain.action?.name !== 'plunged');
  const durX = game.time - tX;
  assert(durX > 1.8 && durX < 2.4, `the execution's reaction is heavier: ~2 s (${durX.toFixed(2)} s)`);
  // 4) the phase gate: with the AI on, a plunge can't push past the next phase's threshold; the
  // transition waits for the reaction to end
  settle(G);
  d.debug.setAI(true);
  const gate = d.nextPhaseHp; // phase 2: the phase-3 gate
  d.hp = Math.round(gate) + 40;
  plunged = [];
  const p3 = c('dragon:phase3');
  d.onPlunge({ damage: 90, posture: 0, point: d.plungePoint(v), execution: false });
  const hpG = d.hp, pend = d.brain.pendingPhase;
  G.tick(DT);
  const stillPlunged = d.brain.action?.name === 'plunged';
  out(`   gate: hp ${hpG} (gate ${gate.toFixed(0)}) · pending phase ${pend} · still plunged ${stillPlunged}`);
  assert(hpG === Math.round(gate) || near(hpG, gate, 1), `the plunge stops at the phase gate (hp ${hpG}, gate ${gate.toFixed(0)})`);
  assert(pend === 3 && stillPlunged, `the phase-3 transition is pending, the reaction plays first (pending ${pend})`);
  run(G, 4, { passive: true }, () => c('dragon:phase3') > p3);
  assert(c('dragon:phase3') === p3 + 1 && d.phase === 3, `then the phase-3 transition (${d.phase})`);
  // 5) a transition is not cancelled: damage only
  const actT = d.brain.action?.name;
  const hpT = d.hp;
  const dealtT = d.onPlunge({ damage: 90, posture: 0, point: d.plungePoint(v), execution: false });
  assert(actT === 'phase3' && d.brain.action?.name === 'phase3' && dealtT === 90 && hpT - d.hp === 90, `a plunge during the transition roar: damage only (${actT} → ${d.brain.action?.name})`);
  d.debug.setAI(false);
  G.watch = null;
  return G;
}

// ================================================================== scenario: rigid batching
// render/rigidBatch.js: the hero and the wyrm are drawn with one mesh per material, plus one
// shadow mesh each (their ~320 rigid meshes stay in the graph as bones and are never drawn
// themselves); a bone follows its source mesh's world matrix and collapses to a zero matrix while
// the source (or a joint above it) is hidden; shadow casting follows the sources' LAYER_CASTER
// bit; a loadout rebuild reuses the bone slots; CONFIG.render.batch = false (the `?nobatch` URL
// flag) leaves everything as it was.
async function scenarioBatch() {
  out('\n== scenario BATCH (rigid batching: one drawn mesh per material, bones follow their source meshes) ==');
  const { rigidBones, isRigidSource, batchRigid } = await imp('src/render/rigidBatch.js');
  const { LAYER_CASTER, LAYER_CASTER_RIGID, markCaster } = await imp('src/render/pipeline.js');
  const { RIGID_MAX } = await imp('src/render/shaderLib.js');
  const G = build();
  const { game } = G;
  fightSetup(G);
  const p = game.player, d = game.dragon, reg = rigidBones(game.U);
  const view = new THREE.Layers(), shadow = new THREE.Layers(), shadowRigid = new THREE.Layers();
  shadow.set(LAYER_CASTER);
  shadowRigid.set(LAYER_CASTER_RIGID);
  const meshes = (root, pred = () => true) => { const l = []; root.traverse((o) => { if (o.isMesh && pred(o)) l.push(o); }); return l; };
  const drawn = (root, layers = view) => meshes(root, (o) => o.layers.test(layers));
  // what pipeline.render does before the passes: one matrix update, then the bones
  const sync = () => { game.scene.updateMatrixWorld(); reg.sync(); };
  const slotOf = (m) => { for (const b of reg.batches) { const i = b.sources.indexOf(m); if (i >= 0) return b.slots[i]; } return -1; };
  const bone = (m) => Array.from(reg.data.subarray(slotOf(m) * 16, slotOf(m) * 16 + 16));
  const isZero = (a) => a.length === 16 && a.every((v) => v === 0);
  const follows = (m) => { const e = m.matrixWorld.elements, b = bone(m); return b.every((v, i) => v === Math.fround(e[i])) && Math.abs(b[15] - 1) < 1e-6; };
  const shown = (m, root) => { for (let o = m; o !== root; o = o.parent) if (!o || !o.visible) return false; return true; };
  // a bone is its source's world matrix, or all zero while the source is hidden
  const live = (m, root) => (shown(m, root) ? follows(m) : isZero(bone(m)));
  sync();

  // one drawn mesh per material; every source is kept in the graph
  const heroAll = meshes(p.object3d), heroDrawn = drawn(p.object3d), heroSrc = heroAll.filter(isRigidSource);
  const wyrmAll = meshes(d.object3d), wyrmDrawn = drawn(d.object3d), wyrmSrc = wyrmAll.filter(isRigidSource);
  const heroMats = new Set(heroSrc.map((m) => m.material)).size, wyrmMats = new Set(wyrmSrc.map((m) => m.material)).size;
  out(`   hero: ${heroSrc.length} source meshes → ${heroDrawn.length} drawn (${heroMats} materials) · wyrm: ${wyrmSrc.length} → ${wyrmDrawn.length} drawn (${wyrmMats} materials + ${wyrmDrawn.filter((m) => !m.userData.rigidBatch).length} unbatched) · ${reg.count} bones of ${RIGID_MAX - 1}`);
  assert(heroSrc.length > 100 && heroDrawn.length === heroMats && heroDrawn.length <= p.rig.mats.length && heroDrawn.every((m) => m.userData.rigidBatch && m.parent === p.object3d && !m.frustumCulled),
    `the hero draws one batch per material (${heroDrawn.length} meshes for ${heroSrc.length} parts)`);
  const membranes = d.model.wings.map((w) => w.membrane.mesh);
  assert(wyrmSrc.length > 150 && wyrmDrawn.length === wyrmMats + membranes.length && membranes.every((m) => wyrmDrawn.includes(m) && !isRigidSource(m)),
    `the wyrm draws one batch per material plus its two wing membranes (${wyrmDrawn.length} meshes for ${wyrmSrc.length} parts)`);
  assert(heroAll.length === heroSrc.length + p.batch.meshes.length + 1 && p.batch.bones === heroSrc.length && d.batch.bones === wyrmSrc.length && reg.count === heroSrc.length + wyrmSrc.length
    && heroSrc.every((m) => m.geometry.attributes.position && m.visible !== undefined) && p.rig.flask.parent && isRigidSource(p.rig.flask),
    `the source meshes stay in the scene graph as bones (${reg.count} bones)`);
  // a batch holds its sources' vertices, each tagged with its bone's slot
  {
    const b = reg.batches.filter((x) => x.root === p.object3d).reduce((a, x) => (x.sources.length > a.sources.length ? x : a));
    const g = b.mesh.geometry, n = b.sources.reduce((s, m) => s + m.geometry.attributes.position.count, 0);
    const ix = b.sources.reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count), 0);
    let same = true, tagged = true, at = 0;
    b.sources.forEach((m, k) => {
      const src = m.geometry.attributes.position;
      for (let i = 0; i < src.count * 3; i++) if (g.attributes.position.array[at * 3 + i] !== Math.fround(src.array[i])) same = false;
      for (let i = 0; i < src.count; i++) if (g.attributes.aRigid.array[at + i] !== b.slots[k]) tagged = false;
      at += src.count;
    });
    let inRange = true;
    for (let i = 0; i < g.index.count; i++) if (g.index.array[i] >= n) inRange = false;
    assert(b.sources.length > 5 && g.attributes.position.count === n && g.index.count === ix && same && tagged && inRange && new Set(b.slots).size === b.sources.length && [...b.slots].every((s) => s >= 1 && s < RIGID_MAX)
      && b.sources.every((m) => Object.keys(m.geometry.attributes).every((k) => g.attributes[k]?.count === n)),
      `a batch merges its sources' geometry in their local space, tagged per bone (${n} vertices, ${b.sources.length} bones)`);
  }

  // bones follow the source meshes through the animation; hidden sources collapse
  for (let i = 0; i < 20; i++) G.tick(DT);
  sync();
  const flask = p.rig.flask;
  let bad = 0, moving = 0;
  for (const m of heroSrc) if (!live(m, p.object3d)) bad++;
  for (const m of wyrmSrc) if (!live(m, d.object3d)) bad++;
  for (const m of [...heroSrc, ...wyrmSrc]) if (!isZero(bone(m))) moving++;
  assert(bad === 0 && moving >= heroSrc.length + wyrmSrc.length - 4 && reg.data.every(Number.isFinite), `every part's bone is its world matrix (${moving} of ${heroSrc.length + wyrmSrc.length} bones shown)`);
  assert(flask.visible === false && isZero(bone(flask)), 'the hidden flask writes a zero matrix (its triangles collapse)');
  flask.visible = true;
  sync();
  assert(follows(flask) && !isZero(bone(flask)), 'the shown flask writes its world matrix');
  const fore = flask.parent;
  fore.visible = false;
  sync();
  const armHidden = meshes(fore, isRigidSource).every((m) => isZero(bone(m)));
  fore.visible = true;
  flask.visible = false;
  sync();
  assert(armHidden && isZero(bone(flask)) && follows(heroSrc.find((m) => m !== flask && m.parent === fore) ?? heroSrc[0]), 'a hidden joint collapses every part below it, and they come back with it');

  // shadows: the sources keep LAYER_CASTER (never drawn); each actor's ONE shadow mesh (all its
  // casters' triangles) is the only thing of it on LAYER_CASTER_RIGID, and is never in the world pass
  const worldOnly = (set) => set.meshes.every((m) => m.layers.test(view) && !m.layers.test(shadowRigid) && !m.layers.test(shadow));
  const casts = (set, root) => worldOnly(set) && drawn(root, shadowRigid).length === 1 && drawn(root, shadowRigid)[0] === set.shadow && set.shadow.parent === root
    && set.shadow.userData.rigidBatch && !set.shadow.layers.test(view) && !set.shadow.layers.test(shadow);
  const tris = (list) => list.reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
  assert(drawn(p.object3d, shadow).length === 0 && drawn(d.object3d, shadow).length === membranes.length && casts(p.batch, p.object3d) && casts(d.batch, d.object3d) && reg.casting === true
    && heroSrc.every((m) => (m.layers.mask & (1 << LAYER_CASTER)) !== 0) && tris([p.batch.shadow]) === tris(heroSrc) && tris([d.batch.shadow]) === tris(wyrmSrc)
    && new Set(p.batch.shadow.geometry.attributes.aRigid.array).size === heroSrc.length,
    `each actor casts its moon shadow with one mesh on LAYER_CASTER_RIGID (hero ${tris([p.batch.shadow])} triangles, wyrm ${tris([d.batch.shadow])}); only the membranes are left on LAYER_CASTER`);
  d.setShadowCasting(false);
  sync();
  const off = worldOnly(d.batch) && drawn(d.object3d, shadowRigid).length === 0 && drawn(d.object3d, shadow).length === 0 && casts(p.batch, p.object3d) && reg.casting === true;
  d.setShadowCasting(true);
  markCaster(p.object3d); // (again, after the build: must not put a source or a batch on a drawn caster layer)
  sync();
  assert(off && casts(d.batch, d.object3d) && casts(p.batch, p.object3d) && drawn(p.object3d, shadow).length === 0 && drawn(p.object3d).length === heroDrawn.length,
    'dragon.setShadowCasting and a late markCaster reach the shadow meshes, and never draw a source');
  // a hidden actor is skipped; its bones are written again when it is shown
  d.object3d.visible = false;
  p.object3d.visible = false;
  sync();
  const idle = reg.casting === false;
  d.object3d.visible = true;
  p.object3d.visible = true;
  sync();
  assert(idle && reg.casting === true, 'hidden actors cast nothing (the rigid shadow pass is skipped)');

  // a loadout rebuild frees the old rig's bones and batches
  const n0 = reg.count, top0 = reg.top, b0 = reg.batches.length;
  const stale = () => meshes(p.object3d, (o) => o.userData.rigidBatch).filter((m) => !p.batch.meshes.includes(m) && m !== p.batch.shadow).length;
  const loadout = { ...p.loadout };
  for (let i = 0; i < 4; i++) p.setLoadout(loadout);
  sync();
  assert(reg.count === n0 && reg.top === top0 && reg.batches.length === b0 && reg.sets.length === 2 && stale() === 0 && drawn(p.object3d).length === heroDrawn.length && casts(p.batch, p.object3d) && heroSrc.every((m) => !isRigidSource(m)),
    `four loadout rebuilds leave the bone count at ${reg.count} (slots reused, no stale batch)`);
  p.equip('back', null);
  sync();
  const fewer = reg.count;
  p.setLoadout(loadout);
  for (let i = 0; i < 10; i++) G.tick(DT);
  sync();
  assert(fewer < n0 && reg.count === n0 && reg.top === top0 && stale() === 0 && meshes(p.object3d, isRigidSource).every((m) => live(m, p.object3d)),
    `the cape off: ${fewer} bones; back on: ${reg.count}, every bone live`);
  // dispose puts the meshes back as they were
  const set = p.batch;
  set.dispose();
  set.dispose();
  const plain = meshes(p.object3d);
  assert(set.meshes.length === 0 && set.shadow === null && reg.sets.length === 1 && plain.every((m) => !m.userData.rigidBatch && !isRigidSource(m) && m.layers.test(view) && m.layers.test(shadow)) && drawn(p.object3d).length === plain.length && reg.count === d.batch.bones,
    `dispose() restores the plain meshes (${plain.length} drawn, casters again) and frees their bones`);
  p.setLoadout(loadout); // batched again for the rest of the run
  assert(reg.count === n0 && drawn(p.object3d).length === heroDrawn.length, 'a rebuild batches the hero again');

  // the builder's corner cases on a small actor, batched BEFORE it is marked a caster: an indexed
  // and a non-indexed part, one of them mirrored, an attribute only one has, an opted-out part and
  // a part with another material
  {
    const { createSurfaceGlyphMaterial } = await imp('src/render/materials.js');
    const root = new THREE.Group();
    const mat = createSurfaceGlyphMaterial(game.U, {});
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.setAttribute('aGUV', new THREE.BufferAttribute(new Float32Array(box.attributes.position.count * 2).fill(0.5), 2));
    const a = new THREE.Mesh(box, mat), b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4).toNonIndexed(), mat);
    const optOut = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat), other = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    b.position.set(2, 0, 0);
    b.scale.x = -1;
    optOut.userData.noBatch = true;
    root.add(a, b, optOut, other);
    game.scene.add(root);
    const set = batchRigid(game.U, root);
    const g = set.meshes[0]?.geometry, na = box.attributes.position.count, nb = b.geometry.attributes.position.count;
    const ix = g?.index.array, ia = box.index.count;
    const flipped = !!g && ix[ia] === na && ix[ia + 1] === na + 2 && ix[ia + 2] === na + 1 && ix[0] === box.index.array[0] && ix[1] === box.index.array[1] && ix[2] === box.index.array[2];
    const zeroFill = !!g && g.attributes.aGUV.array.subarray(0, na * 2).every((v) => v === 0.5) && g.attributes.aGUV.array.subarray(na * 2).every((v) => v === 0);
    assert(set.meshes.length === 1 && set.bones === 2 && isRigidSource(a) && isRigidSource(b) && !isRigidSource(optOut) && !isRigidSource(other)
      && g.attributes.position.count === na + nb && g.index.count === ia + nb && flipped && zeroFill && drawn(root).length === 3,
      'the builder merges indexed and non-indexed parts, zero-fills a missing attribute, flips a mirrored part and leaves opted-out / other-material meshes alone');
    sync();
    const before = set.shadow && drawn(root, shadowRigid).length === 0 && drawn(root, shadow).length === 0;
    markCaster(root);
    sync();
    assert(before && drawn(root, shadowRigid).length === 1 && drawn(root, shadowRigid)[0] === set.shadow && tris([set.shadow]) === tris([a, b]) && drawn(root, shadow).length === 2 && drawn(root).length === 3,
      'an actor batched before markCaster casts once it is marked (its unbatched parts on LAYER_CASTER, the rest through its shadow mesh)');
    set.dispose();
    game.scene.remove(root);
    mat.dispose();
    assert(reg.count === n0 && reg.sets.length === 2 && root.children.length === 4 && drawn(root, shadow).length === 4, 'and dispose() leaves its four meshes as plain casters');
  }

  // CONFIG.render.batch = false (`?nobatch`): nothing is batched
  CONFIG.render.batch = false;
  try {
    const G2 = build();
    const p2 = G2.game.player, d2 = G2.game.dragon, reg2 = rigidBones(G2.game.U);
    G2.game.scene.updateMatrixWorld();
    reg2.sync();
    const all = [...meshes(p2.object3d), ...meshes(d2.object3d)];
    assert(reg2.count === 0 && reg2.batches.length === 0 && reg2.sets.length === 0 && reg2.casting === false && p2.batch.meshes.length === 0 && d2.batch.meshes.length === 0 && p2.batch.shadow === null
      && all.length === heroSrc.length + wyrmSrc.length + membranes.length && all.every((m) => !m.userData.rigidBatch && !isRigidSource(m) && m.layers.test(view) && m.layers.test(shadow)),
      `CONFIG.render.batch = false leaves all ${all.length} meshes unbatched, drawn and casting as before`);
    p2.setLoadout({ ...p2.loadout });
    assert(reg2.count === 0 && p2.batch.meshes.length === 0, '... also after a loadout rebuild');
  } finally {
    CONFIG.render.batch = true;
  }
  // the URL flag itself: a fresh copy of core/config.js loaded with ?nobatch in the address
  {
    const had = 'location' in globalThis, prev = globalThis.location;
    const load = async (search, tag) => {
      globalThis.location = { search };
      return (await import(`${pathToFileURL(`${ROOT}/src/core/config.js`).href}?${tag}`)).CONFIG;
    };
    const offCfg = await load('?lab&nobatch', 'batch-off'), onCfg = await load('?lab', 'batch-on');
    if (had) globalThis.location = prev;
    else delete globalThis.location;
    assert(offCfg.render.batch === false && onCfg.render.batch === true && CONFIG.render.batch === true, '?nobatch in the URL turns CONFIG.render.batch off');
  }
  assert(CONFIG.quality.map((q) => q.shadow).join() === '1024,2048,2048', `quality presets carry a shadow map size (${CONFIG.quality.map((q) => `${q.name} ${q.shadow}`).join(', ')})`);
  return G;
}

const SCENARIOS = { gate: scenarioGate, hero: scenarioHero, batch: scenarioBatch, breath: scenarioBreath, parry: scenarioParry, block: scenarioBlock, reach: scenarioReach, red: scenarioRed, plunge: scenarioPlunge, deflect: scenarioDeflect, lab: scenarioLab, bullets: scenarioBullets, strings: scenarioStrings, plungeReact: scenarioPlungeReact, timing: scenarioTiming, fire: scenarioFire, win: scenarioWin, die: scenarioDie, touch: scenarioTouch, herolook: scenarioHeroLook, herolife: scenarioHeroLife, probe: scenarioProbe };
const runs = [];
const OPT_IN = new Set(['probe']); // run only when named
for (const [name, fn] of Object.entries(SCENARIOS)) if (SCEN === name || (SCEN === 'all' && !OPT_IN.has(name))) runs.push(await fn());
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
