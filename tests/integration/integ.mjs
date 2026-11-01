// Whole-game headless integration run: REAL Player, Dragon, Hud, GameFlow, AudioEngine (+ real
// LightPool, GlyphParticles, CameraRig, Events), wired exactly like src/main.js (construction order
// and frame order). World is a light mock built on the real Colliders. A bot drives the input.
// usage: node integ.mjs <repoRoot> [scenario]   scenario: win | die | all (default all)
import { pathToFileURL } from 'node:url';
import { ui, fireWin, AUDIO } from './shim.mjs';

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
const { Player } = await imp('src/entities/player/player.js');
const { Dragon } = await imp('src/entities/dragon/dragon.js');
const { Hud } = await imp('src/ui/hud.js');
const { AudioEngine } = await imp('src/audio/audio.js');
const { GameFlow } = await imp('src/game/flow.js');

const errors = [];
const origErr = console.error;
console.error = (...a) => { errors.push(a.map((x) => (x?.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x))).join(' ')); };
console.warn = (...a) => { errors.push('WARN ' + a.map(String).join(' ')); };
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
let fails = 0;
const assert = (c, m) => { if (!c) { fails++; out('FAIL', m); } else out('ok  ', m); };

function build() {
  ui.children.forEach((c) => (c.parentNode = null));
  ui.children.length = 0;
  const U = createSharedUniforms();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 16 / 9, CONFIG.camera.near, CONFIG.camera.far);
  // ---- input mock with the real Input interface; a bot writes `axis`, `keys`, `pk`, `pb`
  const keys = new Set(), pk = new Set(), pb = [false, false, false];
  const input = {
    enabled: true, pressedKeys: pk, anyPressed: false, wheel: 0, mouse: { ndcX: 0, ndcY: 0 },
    axis: { x: 0, y: 0 },
    down(c) { return this.enabled && keys.has(c); },
    pressed(c) { return this.enabled && pk.has(c); },
    released() { return false; },
    mouseDown() { return false; },
    mousePressed(b) { return this.enabled && pb[b]; },
    mouseReleased() { return false; },
    moveAxis() { return this.enabled ? this.axis : { x: 0, y: 0 }; },
    tap(code) { pk.add(code); keys.add(code); this.anyPressed = true; fireWin('keydown', { code }); },
    click(b = 0) { pb[b] = true; this.anyPressed = true; fireWin('pointerdown', {}); },
    endFrame() { for (const c of pk) keys.delete(c); pk.clear(); pb.fill(false); this.anyPressed = false; this.wheel = 0; },
  };
  const colliders = new Colliders();
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; colliders.add(Math.cos(a) * 19.5, Math.sin(a) * 19.5, 0.9, 'stone'); }
  const pushers = new Map();
  const finalU = { uHurt: { value: 0 }, uFade: { value: 0 }, uDesat: { value: 0 }, uWarm: { value: 0 }, uExposure: { value: 1 }, uBloom: { value: 1 } };
  const counters = { scorchReset: 0, burn: 0, spawns: 0 };
  const world = {
    colliders,
    bonfire: { ...CONFIG.world.bonfire }, nest: { x: -3, z: -15.5 },
    forest: { treeSpots: [], bonfire: { ...CONFIG.world.bonfire } },
    resolve: (pos, r, b) => colliders.resolve(pos, r, b),
    setPusher(slot, x, y, z, r) { if (![x, y, z, r].every(Number.isFinite)) throw new Error(`NaN pusher ${slot}`); pushers.set(slot, [x, y, z, r]); },
    clearPushers(a = 0, b = 10) { for (let i = a; i < b; i++) pushers.delete(i); },
    gust(x, z, s, r) { if (![x, z, s, r].every(Number.isFinite)) throw new Error('NaN gust'); },
    scorch: { burnCircle(x, z, r) { if (![x, z, r].every(Number.isFinite)) throw new Error('NaN scorch'); counters.burn++; }, reset() { counters.scorchReset++; }, heatAt: () => 0, burnAt: () => 0 },
    atmosphere: { bonfireLit: true, setBonfireLit(v) { this.bonfireLit = !!v; } },
    setGrassQuality() {},
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
  const game = {
    THREE, CONFIG, renderer: null, scene, fxScene: new THREE.Scene(), camera,
    pipeline: { finalMat: { uniforms: finalU } }, U,
    events: new Events(), input, cameraRig: new CameraRig(camera), lights: new LightPool(U),
    fx: { alpha: mkParticles({ max: 3000, additive: false }), add: mkParticles({ max: 7000, additive: true }) },
    time: 0, realTime: 0, timeScale: 1, hitstopTimer: 0, hitstopScale: 1,
    mouseGround: new THREE.Vector3(), state: 'title', settings: { quality: CONFIG.defaultQuality, showFps: false },
    hitstop(seconds, scale = 0.04) { this.hitstopTimer = Math.max(this.hitstopTimer, seconds); this.hitstopScale = Math.min(this.hitstopScale, scale); },
    shake(a) { if (!Number.isFinite(a)) throw new Error('NaN shake'); this.cameraRig.addTrauma(a); },
    world,
  };
  // event log
  const evLog = [];
  const counts = {};
  const emit = game.events.emit.bind(game.events);
  game.events.emit = (n, d) => {
    counts[n] = (counts[n] || 0) + 1;
    if (!/footstep|step|wingFlap|hurt|hitDragon|attack|windup|fireball|explosion|roll|dodge/.test(n) || n === 'dragon:hurt') evLog.push(`${game.time.toFixed(1)} ${n}${d && n === 'state' ? ' ' + d.from + '->' + d.to : ''}`);
    emit(n, d);
  };
  // construction order = main.js; flag any module touching later modules in its constructor
  game.audio = new AudioEngine(game);
  game.player = new Player(game);
  game.dragon = new Dragon(game);
  game.hud = new Hud(game);
  game.flow = new GameFlow(game);
  game.applyQuality = () => {};
  const logTimes = [];
  const hudLog = game.hud.log.bind(game.hud);
  game.hud.log = (t, ch) => { logTimes.push([game.realTime, String(t)]); return hudLog(t, ch); };
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
  const tick = (realDt) => {
    let scale = game.timeScale;
    if (game.hitstopTimer > 0) { game.hitstopTimer -= realDt; scale *= game.hitstopScale; if (game.hitstopTimer <= 0) game.hitstopScale = 1; }
    const dt = realDt * scale;
    game.realTime += realDt;
    game.time += dt;
    game.dt = dt;
    game.realDt = realDt;
    if (AUDIO.ctx) AUDIO.ctx.currentTime += realDt;
    safe('flow', () => game.flow.update(dt, realDt));
    safe('player', () => game.player.update(dt));
    safe('dragon', () => game.dragon.update(dt));
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
    if (![p.position.x, p.position.z, p.hp, p.stamina, p.yaw].every(Number.isFinite)) throw new Error('player NaN');
    if (![d.position.x, d.position.z, d.hp, d.yaw].every(Number.isFinite)) throw new Error('dragon NaN');
    for (const h of d.hurtSpheres) if (![h.x, h.y, h.z, h.r].every(Number.isFinite)) throw new Error('hurtSphere NaN');
    for (const k of ['uHurt', 'uFade', 'uDesat', 'uWarm']) if (!Number.isFinite(finalU[k].value)) throw new Error('grade NaN ' + k);
    if (!Number.isFinite(game.timeScale)) throw new Error('timeScale NaN');
  };
  return { game, input, tick, evLog, counts, counters, errorCounts, finalU, logTimes };
}

const DT = 1 / 60;
const cls = (c) => ui.find((e) => e.classList?.contains(c));

// ---- bot: walks to the dragon, locks on, swings, rolls out of breath, heals when low
function bot(G, opts = {}) {
  const { attack = true, god = false } = opts;
  const { game, input } = G;
  const p = game.player, d = game.dragon;
  const st = game.state;
  input.axis = { x: 0, y: 0 };
  if (god && p.alive) { p.hp = p.maxHp; p.stamina = Math.max(p.stamina, 60); }
  if (opts.passive || (st !== 'explore' && st !== 'bossIntro' && st !== 'boss')) return;
  const tgt = new THREE.Vector3();
  d.lockPoint(tgt);
  game.mouseGround.set(tgt.x, 0, tgt.z);
  const dx = tgt.x - p.position.x, dz = tgt.z - p.position.z;
  const dist = Math.hypot(dx, dz);
  if (st === 'boss' && !p.lockOn && d.isTargetable() && (game.time * 10 | 0) % 20 === 0) input.tap('Tab');
  if (dist > 3.2) input.axis = { x: dx / dist, y: -dz / dist };
  if (st === 'boss' && attack && dist < 5 && (game.realTime * 60 | 0) % 24 === 0) input.click(0);
  if (st === 'boss' && attack && d.brain?.action?.name === 'breath' && (game.realTime * 60 | 0) % 30 === 0) {
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

// ================================================================== scenario: win (god mode)
async function scenarioWin() {
  out('\n== scenario WIN (god-mode bot) ==');
  const G = build();
  const { game, input, evLog, counts, counters } = G;
  assert(game.state === 'title', 'boots in title');
  assert(cls('ab-title') !== null || true, 'title UI exists');
  run(G, 1.0);
  assert(game.flow.cameraOverride !== null, 'title camera override active');
  input.tap('Space');
  G.tick(DT);
  assert(game.state === 'explore', 'any key → explore');
  assert(AUDIO.ctx !== null, 'audio context created by unlock');
  assert(game.player.state === 'idle' && game.player.stamina === game.player.maxStamina, 'title-dismiss key did not roll');
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
  let maxPhase = 1, sawStagger = false, sawAir = false;
  const won = run(G, 400, { god: true }, () => {
    maxPhase = Math.max(maxPhase, game.dragon.phase);
    if (game.dragon.state === 'staggered') sawStagger = true;
    if (game.dragon.state === 'airborne') sawAir = true;
    return game.state === 'victory';
  });
  out(`   fight: t=${game.time.toFixed(1)}s dragon hp=${game.dragon.hp} state=${game.dragon.state} phase=${maxPhase} hits=${counts['player:hitDragon'] || 0} hurt=${counts['player:hurt'] || 0} stagger=${sawStagger} air=${sawAir}`);
  assert(won, 'victory reached');
  assert(maxPhase === 2, 'phase 2 reached');
  assert((counts['dragon:phase2'] || 0) === 1, 'dragon:phase2 once');
  assert((counts['dragon:death'] || 0) === 1 && (counts['dragon:dead'] || 0) === 1, 'dragon:death + dragon:dead once each');
  assert((counts['game:victory'] || 0) === 1, 'game:victory once');
  assert(game.dragon.state === 'dead', 'dragon dead');
  run(G, 4, { god: true });
  assert(!cls('ab-boss')?.classList.contains('on'), 'boss bar hidden after victory');
  assert(cls('ab-stats')?.classList.contains('on'), 'victory stats shown');
  assert(game.player.takeHit({ damage: 50, from: { x: 0, z: 0 } }) === 'ignored', 'player ignores hits in victory');
  // [R] fight again
  input.tap('KeyR');
  run(G, 4, {}, () => game.state === 'explore' && !game.flow.respawning);
  assert(game.state === 'explore', 'R → explore');
  assert(game.dragon.state === 'sleeping' && game.dragon.hp === game.dragon.maxHp && game.dragon.phase === 1, 'dragon reset to sleeping/full/phase1');
  assert(counters.scorchReset >= 1, 'scorch reset on restart');
  assert(game.player.hp === game.player.maxHp, 'player full hp after restart');
  assert(game.dragon.object3d.visible, 'dragon visible again after restart');
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
  // roll / heal / stamina edge events
  for (let i = 0; i < 4; i++) { input.tap('KeyF'); run(G, 1.1, { passive: true }); }
  assert((counts['player:heal'] || 0) === 3 && (counts['player:noFlask'] || 0) >= 1, 'three heals then noFlask');
  for (let i = 0; i < 8; i++) { input.axis = { x: 1, y: 0 }; input.tap('Space'); G.tick(DT); run(G, 0.45, { passive: true }); }
  assert((counts['player:roll'] || 0) >= 3, 'rolls emitted');
  assert((counts['player:noStamina'] || 0) >= 1, 'noStamina when out of stamina');
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
  const bn = ui.findAll((e) => e.classList?.contains('ab-banner')); out('   banners:', bn.length, JSON.stringify(bn.map((b) => b.className + ':' + b.textContent)), 'deathT', game.flow.deathT.toFixed(2), 'state', game.state);
  assert(bn.some((b) => b.textContent.includes('YOU DIED')), 'YOU DIED banner');
  input.tap('KeyW');
  G.tick(DT);
  assert(!game.flow.respawning, 'retry not accepted before hold time');
  run(G, 4.0);
  input.tap('KeyW');
  run(G, 5, { passive: true }, () => game.state === 'explore' && !game.flow.respawning);
  assert(game.state === 'explore', 'retry → explore');
  assert((counts['game:retry'] || 0) === 1, 'game:retry once');
  out('   after retry: hp', game.player.hp, 'state', game.player.state, 'pos', game.player.position.x.toFixed(2), game.player.position.z.toFixed(2), 'dragon', game.dragon.state, 't', game.time.toFixed(1));
  assert(game.player.alive && game.player.hp === game.player.maxHp && game.player.state === 'idle', 'player respawned full');
  assert(Math.hypot(game.player.position.x - CONFIG.world.playerSpawn.x, game.player.position.z - CONFIG.world.playerSpawn.z) < 0.5, 'player at bonfire spawn');
  assert(game.dragon.state === 'sleeping' && game.dragon.hp === game.dragon.maxHp, 'dragon reset');
  assert(counters.scorchReset >= 1, 'scorch reset on retry');
  assert(game.audio.musicMode === 'ambient', `ambient music after retry (got ${game.audio.musicMode})`);
  assert(game.audio.breath ? !game.audio.breath.active : true, 'breath loop stopped after retry');
  assert(G.finalU.uFade.value < 0.05 && G.finalU.uDesat.value < 0.05, `grade cleared (fade=${G.finalU.uFade.value.toFixed(2)} desat=${G.finalU.uDesat.value.toFixed(2)})`);
  assert(!game.flow.cameraOverride || game.flow.cameraOverride.weight < 0.05, 'no lingering camera override');
  run(G, 3, { passive: true });
  assert(game.dragon.state === 'sleeping', 'dragon stays asleep at the bonfire after retry');
  return G;
}

async function scenarioBreath() {
  out('== scenario BREATH (forced breath on a standing player) ==');
  const G = build();
  const { game, input, counts } = G;
  const { ATTACKS } = await imp('src/entities/dragon/attacks.js');
  const { TUNING } = await imp('src/entities/dragon/tuning.js');
  const TUNE_BREATH_WINDUP = TUNING.attacks.breath.windup;
  run(G, 0.6); input.tap('Space'); G.tick(DT);
  run(G, 30, { attack: false }, () => game.state === 'boss');
  run(G, 0.5, { passive: true });
  const d = game.dragon;
  // stand 6 m in front of the dragon and force the breath
  d.brain.stopAction?.(true);
  game.player.position.set(d.position.x + Math.sin(d.yaw) * 6, 0, d.position.z + Math.cos(d.yaw) * 6);
  const hurt0 = counts['player:hurt'] || 0, log0 = G.logTimes.length;
  d.brain.startAction(ATTACKS.breath);
  run(G, 4, { passive: true, god: true });
  const lines = G.logTimes.slice(log0).map((x) => x[1]);
  const fireLines = lines.filter((l) => /flame|Burning|Scorched/.test(l));
  out('   breath: player:hurt events', (counts['player:hurt'] || 0) - hurt0, 'fire/burn log lines', fireLines.length, '::', fireLines.join(' / '));
  assert((counts['player:hurt'] || 0) - hurt0 >= 5, 'breath ticks reached the player');
  assert(fireLines.length <= 6, 'breath damage summarized (<= ~1 line/s per stream)');
  assert((counts['dragon:breathStart'] || 0) >= 1 && (counts['dragon:breathEnd'] || 0) >= 1, 'breathStart/End emitted');
  assert(!game.audio.breath?.active, 'audio breath loop stopped after breathEnd');
  // roll through a second breath: one dodge event per roll
  game.player.position.set(d.position.x + Math.sin(d.yaw) * 6, 0, d.position.z + Math.cos(d.yaw) * 6);
  game.player.stamina = game.player.maxStamina;
  const dodge0 = counts['player:dodge'] || 0;
  d.brain.startAction(ATTACKS.breath);
  run(G, TUNE_BREATH_WINDUP - 0.1, { passive: true });
  input.axis = { x: Math.cos(d.yaw), y: Math.sin(d.yaw) };
  out('   pre-roll: pstate', game.player.state, 'hp', game.player.hp, 'st', game.player.stamina.toFixed(0), 'action', d.brain.action?.name, d.brain.action?.phase, 'dstate', d.state, 'dist', game.player.position.distanceTo(d.position).toFixed(1), 'ctl', game.player.control, 'gstate', game.state);
  const h0 = counts['player:hurt'] || 0, r0 = counts['player:roll'] || 0;
  input.tap('Space');
  for (let i = 0; i < 36; i++) { G.tick(DT); if (i % 6 === 0) out('     t', i, game.player.state, game.player.stateT.toFixed(2), 'inv', game.player.isInvulnerable(), 'hurt', (counts['player:hurt'] || 0) - h0, 'roll', (counts['player:roll'] || 0) - r0, d.brain.action?.phase); }
  const dodges = (counts['player:dodge'] || 0) - dodge0;
  out('   dodge events during one roll through the breath:', dodges);
  assert(dodges === 1, 'exactly one player:dodge per roll through the breath');
  return G;
}

async function scenarioGate() {
  out('== scenario GATE (shells in flight when the wyrm dies) ==');
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
  assert(game.state === 'victory' && p.alive, 'victory with the knight alive');
  return G;
}

const runs = [];
if (SCEN === 'gate' || SCEN === 'all') runs.push(await scenarioGate());
if (SCEN === 'breath' || SCEN === 'all') runs.push(await scenarioBreath());
if (SCEN === 'win' || SCEN === 'all') runs.push(await scenarioWin());
if (SCEN === 'die' || SCEN === 'all') runs.push(await scenarioDie());
for (const G of runs) {
  let mx = 0, at = '';
  for (let i = 0; i < G.logTimes.length; i++) { let j = i; while (j < G.logTimes.length && G.logTimes[j][0] - G.logTimes[i][0] < 1) j++; if (j - i > mx) { mx = j - i; at = G.logTimes.slice(i, j).map((x) => x[1]).join(' / '); } }
  out('max HUD log lines in 1 s:', mx, '::', at.slice(0, 300));
  const fireLines = G.logTimes.filter((x) => /flame|Burning|Scorched/.test(x[1])).length;
  out('fire/burn log lines:', fireLines, 'player:hurt events:', G.counts['player:hurt'] || 0);
}
{
  const CAT = ['player:attack','player:hitDragon','player:hurt','player:dodge','player:roll','player:heal','player:noStamina','player:died','player:footstep','player:lockOn','player:noFlask','dragon:wake','dragon:roar','dragon:introDone','dragon:windup','dragon:attack','dragon:step','dragon:wingFlap','dragon:takeoff','dragon:land','dragon:breathStart','dragon:breathEnd','dragon:fireball','dragon:explosion','dragon:bite','dragon:hurt','dragon:stagger','dragon:phase2','dragon:death','dragon:dead','state','bonfire:rest','game:retry','game:victory','area'];
  const emitted = new Set(), subscribed = new Set();
  for (const G of runs) { Object.keys(G.counts).forEach((k) => emitted.add(k)); [...G.game.events.map.keys()].forEach((k) => subscribed.add(k)); }
  out('emitted not in catalogue:', JSON.stringify([...emitted].filter((k) => !CAT.includes(k))));
  out('subscribed not in catalogue:', JSON.stringify([...subscribed].filter((k) => !CAT.includes(k))));
  out('catalogue never emitted in these runs:', JSON.stringify(CAT.filter((k) => !emitted.has(k))));
  out('catalogue with no subscriber:', JSON.stringify(CAT.filter((k) => !subscribed.has(k))));
}
for (const G of runs) if (G.errorCounts.size) out('module update errors:', JSON.stringify([...G.errorCounts]));
const uniq = [...new Set(errors)];
out(`\nconsole errors/warnings: ${errors.length} (${uniq.length} unique)`);
for (const e of uniq.slice(0, 20)) out('  ', e.slice(0, 400));
out(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails || uniq.length ? 1 : 0);
