// The Starless level and the Starless Lord, headless (COMBAT.md → "The Starless Lord"): the REAL
// Player, StarlessLord, Hud, GameFlow, AudioEngine and Lab (+ real LightPool, GlyphParticles,
// CameraRig, Events) wired like src/main.js for `?level=starless`; the world is a light mock on the
// real Colliders, filled by the real set (the crater: world/throneHall.js). A bot drives the input.
// usage: node lord.mjs <repoRoot> [scenario | a,b,c]   (env: GCD_SEED=n reseeds the AI; GCD_SKIP=a,b leaves those out of `all`)
//   scenario: level | data | timing | forms | spells | bounds | flow | win | all
// (the spells scenario also covers the Crushing Dark, the Rift, the Dark Star, Parting Light and the glide)
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
const { TELL, RESULT, POSTURE, DEFENSE: DEF } = await imp('src/combat/rules.js');
const { LEVELS, getLevel, levelFromSearch, applyLevel } = await imp('src/levels/index.js');
const { createThroneHall, THRONE } = await imp('src/world/throneHall.js');
const { Destructibles, STATE } = await imp('src/world/destructibles.js');
const { Scars } = await imp('src/world/scars.js');
const { Player } = await imp('src/entities/player/player.js');
const { StarlessLord } = await imp('src/entities/enemies/starlessLord/lord.js');
const { Duelist } = await imp('src/entities/enemies/duelist/duelist.js');
const { glaiveHome } = await imp('src/entities/enemies/duelist/ledger.js');
const { MOVES, MOVE_NAMES, CLIPS_BY_FORM, COUNTERS, STREAKS, TRANSITIONS, realise } = await imp('src/entities/enemies/starlessLord/moves.js');
const { TUNING } = await imp('src/entities/enemies/starlessLord/tuning.js');
const { paceOn } = await imp('src/entities/enemies/starlessLord/pace.js');
/** The cue's lead of a melee blow now: the readable pace's (ADR-251, `?lordPace=a`) or the fast pace's. */
const meleeLead = () => (paceOn() ? TUNING.pace.flashLead : TUNING.flashLead);
const { LORD_ITEMS, LORD_LOADOUT, LORD_CAPE, LORD_PANELS } = await imp('src/entities/enemies/starlessLord/gear.js');
const { Hud } = await imp('src/ui/hud.js');
const { Bindings, installActions } = await imp('src/core/bindings.js');
const { TouchControls } = await imp('src/ui/touch.js');
const { AudioEngine } = await imp('src/audio/audio.js');
const { GameFlow } = await imp('src/game/flow.js');
const { Lab } = await imp('src/dev/lab.js');
// GCD_LOOKS=ashMotion=a,lordMotion=a: look switches set for the whole run (duelist/lookSwitch.js setLook; ADR-226)
for (const kv of (process.env.GCD_LOOKS ?? '').split(',').filter(Boolean)) (await imp('src/entities/enemies/duelist/lookSwitch.js')).setLook(...kv.split('='));

const LVL = getLevel('starless');
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
/** The forms a move is used in (its weight; a counter: its own form; a transition: the form it begins). */
const formsOf = (name) => {
  const def = MOVES[name];
  if (def.transition) return [def.phase - 1];
  if (def.counter) return [COUNTERS.indexOf(name) + 1, STREAKS.indexOf(name) + 1].filter((f) => f > 0); // (a form's counter / its flurry)
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
// the crater's real colliders (the shards, the rim's slabs, the star, the dais's edge), built once
const HALL_SET = (() => {
  const c = new Colliders();
  const set = createThroneHall(createSharedUniforms(), c);
  return { set, circles: c.circles.map((k) => ({ ...k })) };
})();

/** `real`: the crater built anew with its breakables (world.destructibles, the scars, the set's
 *  ambience), for the moves that use them (ADR-109); without it the world is the mock the older
 *  scenarios were written on (the set's colliders, no pieces). */
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
  const set = real ? createThroneHall(U, colliders) : null;
  if (!set) for (const k of HALL_SET.circles) colliders.add(k.x, k.z, k.r, k.tag);
  const counters = { spawns: 0, flares: 0, burns: 0 };
  const world = {
    colliders, bonfire: { ...CONFIG.world.bonfire }, nest: { x: 0, z: THRONE.throne.z },
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
    world.update = (dt) => { world.destructibles.update(dt); world.scars.update?.(dt); set.ambience.update(dt, game); };
    set.ambience.setup(game);
  }
  game.audio = new AudioEngine(game);
  game.player = new Player(game);
  // (his rig is built on a stream of its own: every THREE object draws Math.random for its uuid, so a
  // body look with more pieces (?lordLook=b, the owner's pick) would otherwise shift the AI's seeded
  // stream and replay every fight with another seed. The picks, 2026-11-16)
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
// style (the STRATEGY measurement): 'mixed' = the above; 'dodge' = a perfect dodge of every tell, never a
// parry; 'parry' = parries, and a red blow rolled early (i-frames, outside the perfect window)
function makeDefender(G, { skill = 1, early = 0.12, style = 'mixed', rng = null, world = false } = {}) {
  const pend = [];
  const stats = { flashes: 0, parryTry: 0, dodgeTry: 0, skipped: [] };
  return {
    stats,
    onEvent(n, d) {
      if (n === 'combat:flash' && (d?.source === 'dragon' || (world && d?.source === 'world'))) {
        stats.flashes++;
        // (`rng`: the probe's own stream, so a bot's misses do not move the AI's seeded stream)
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
            // across his blade; out of a marked circle: straight away from its centre
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
/**
 * The floor breaks (2026-11-16, world/floor.js, BREAK.floor): a duel on the real set with his AI on
 * against the fencing bot (god mode), until it ends or 4 minutes have passed, the share
 * of the floor inside his bound broken (and cracked) after 30 s, 1, 2 and 4 minutes. The owner's target:
 * not all rubble early, never untouched after two minutes, 30 - 50 % broken after a whole duel.
 */
async function scenarioFloor() {
  out('\n== scenario FLOOR (a crater duel breaks the floor: the share over time) ==');
  const F = build(SEED, true);
  duel(F, { dist: 4, ai: true });
  F.defend = makeDefender(F);
  const fd = F.game.dragon, fp = F.game.player, W = F.game.world.destructibles;
  fp.debug.god = true;
  const inB = W.floor.filter((b) => Math.hypot(b.x, b.z) <= (fd.baseBound ?? 12.5));
  const at = {};
  let t = 0;
  for (const s of [30, 60, 120, 240]) {
    // (four bars: each ends in a deathblow, so the bot ends the duel itself, in 70 - 100 s of game time)
    run(F, s - t, (GG) => fencer(GG), () => fd.state === 'dead');
    t = s;
    const broken = inB.filter((b) => b.state !== STATE.INTACT).length, cracked = inB.filter((b) => b.state === STATE.INTACT && b.cracked).length;
    at[s] = broken / inB.length;
    out(`     ${s} s (${F.game.time.toFixed(0)} s): ${broken} of ${inB.length} slabs inside his bound broken (${(at[s] * 100).toFixed(0)} %; ${inB.filter((b) => b.state !== STATE.INTACT && b.by === "player").length} by the hero), ${cracked} cracked; form ${fd.phase}${fd.state === 'dead' ? ', he has fallen' : ''}; ${W.list.length - W.standing} pieces down in all`);
  }
  assert(at[30] < 0.25 && at[120] > 0, `not rubble early (${(at[30] * 100).toFixed(0)} % after 30 s, < 25 %), never untouched after two minutes (${(at[120] * 100).toFixed(0)} %)`);
  // (the owner's target 30 - 50 % after a whole duel; the band allows for the seed. 18 %, not 22 %, since the
  // merge with ADR-120: its bigger wreckage pools draw more of the seeded Math.random at the build (three's
  // uuids), and on seed 4242 the bot now ends the duel in 38 s with 21 % broken (28 % in 67 s before; with
  // the old pool sizes the merged code gives 28 % again). Seeds 7 / 99 / 1337 / 2024: 33 / 42 / 31 / 22 %)
  assert(at[240] >= 0.18 && at[240] <= 0.6, `after the duel (he fell, or 4 minutes) ${(at[240] * 100).toFixed(0)} % of the floor inside his bound is broken (18 .. 60 %; the aim 30 - 50 %)`);
  assert(!F.payload.size, `no non-finite payload in his events (${[...F.payload].join(', ')})`);
  return F;
}

async function scenarioLevel() {
  out('\n== scenario LEVEL (registry, the crater set, the boss slot) ==');
  assert(LEVELS.includes(LVL) && LVL.id === 'starless', `levels: ${LEVELS.map((l) => l.id).join(', ')}`);
  assert(levelFromSearch('?level=starless') === LVL && levelFromSearch('?lab&level=LORD') === LVL && levelFromSearch('?level=throne') === LVL, '?level=starless / lord / throne pick the level (case-insensitive)');
  for (const k of ['arrive', 'stir', 'phase2', 'phase3', 'phase4', 'victory', 'fallen', 'restReset', 'again', 'rise']) if (!LVL.text[k]) assert(false, `the level has its ${k} line`);
  assert(CONFIG.world.bonfire.z === THRONE.bonfire.z && CONFIG.world.dragonSleep.z === THRONE.throne.z + 0.5 && CONFIG.world.bossTriggerZ < THRONE.entryZ && CONFIG.world.dragonBound === THRONE.floor.r && CONFIG.world.bossFloor.zN === THRONE.floor.zN && TUNING.bound === THRONE.floor.r, 'applyLevel merged the crater layout into CONFIG.world (the bonfire, the throne, the lip, his floor)');
  const S = HALL_SET.set;
  assert(S.group?.isObject3D && Array.isArray(S.slabs) && S.slabs.length > 100 && S.bonfire && S.nest && S.sky && typeof S.ambience?.update === 'function' && typeof S.ambience?.flare === 'function', `the set has the forest's shape, a sky and its ambience (${S.slabs.length} floor slabs)`);
  let bad = 0;
  S.group.traverse((m) => { const pos = m.geometry?.attributes?.position; if (pos) for (const v of pos.array) if (!Number.isFinite(v)) bad++; });
  for (const b of S.breakables ?? []) for (const g of [...b.geos, ...(b.broken?.geos ?? [])]) for (const v of g.attributes.position.array) if (!Number.isFinite(v)) bad++;
  assert(bad === 0, `the crater has no NaN vertices (${bad})`);
  // what can be broken, lifted and thrown is listed for the destruction system, not merged into the set
  const B = S.breakables, kinds = (k) => B.filter((b) => b.kind === k).length;
  // (2026-11-16: everything but the landmarks breaks: 36 → 222. The floor's plates and the path, 105
  // (plate 81, flagstone 24); the rim's low slabs and shards and its rubble, the vents' rings, the south
  // lip's two stones, 35 trunks thrown down near the crater. The six hanging stones as they were; 2026-11-22: the trunks became what
  // the challengers left round it, world/starfallProps.js, ~70 of them within reach: graves of swords, banners, cairns, carts)
  const floor = B.filter((b) => b.floor), Lw = B.filter((b) => b.lift === 2 && b.kind !== 'hover');
  assert(Array.isArray(B) && B.length >= 180 && B.length <= 280 && kinds('shard') >= 12 && kinds('slab') >= 8 && kinds('hover') === 6 && floor.length >= 90 && kinds('vent') === 4, `its breakables: ${B?.length} (shard ${kinds('shard')}, slab ${kinds('slab')}, hover ${kinds('hover')}, floor ${floor.length}: plate ${kinds('plate')}, flagstone ${kinds('flagstone')}; rubble ${kinds('rubble')}, vent ${kinds('vent')}; swords ${kinds('swords')}, banner ${kinds('banner')}, cairn ${kinds('cairn')}, cart ${kinds('cart')})`);
  assert(B.every((b) => ['stone', 'wood', 'metal'].includes(b.mat) && Array.isArray(b.colliders) && [b.x, b.z, b.r, b.h].every(Number.isFinite) && b.r > 0 && b.h > 0 && (b.look === 'range' ? b.floor && b.range?.count > 0 : ['prop', 'grid'].includes(b.look) && b.geos.length > 0)), 'each in the contract\'s shape (ARCHITECTURE.md Destruction): its body in geometries, or a floor plate in its run of the paving mesh');
  assert(B.filter((b) => b.kind === 'hover').every((b) => b.colliders.length === 0 && b.cover === false && b.hp === Infinity && b.lift === 2) && Lw.length >= 30 && Lw.every((b) => b.colliders.length === 1 && b.broken?.geos?.length), `a hanging stone has no collider and gives no cover; what the Void may lift (${Lw.length} standing pieces, as before) has its circle and leaves rubble`);
  assert(floor.every((b) => b.colliders.length === 0 && b.lift === 3 && !b.cover && !b.topples) && B.filter((b) => !b.floor && b.kind !== 'hover' && b.lift !== 2).every((b) => b.lift <= 1), 'the floor\'s plates have no collider, cover nothing and are lifted only by a move that asks for floor (lift 3); the rest the Void does not take');
  // open: nothing tall on the near side (south of the seal's rim), no wall anywhere
  const south = B.filter((b) => b.z > 6 && b.kind !== 'hover'), tallS = Math.max(...south.map((b) => b.h));
  assert(south.length >= 4 && tallS < 3.2, `nothing tall stands south of the duel (${south.length} pieces there, the tallest ${tallS.toFixed(1)} m)`);
  assert(S.scarInk?.length === 3 && S.scarInk[0] > S.scarInk[2] * 4, 'cracks in its floor are ember red');
  assert(HALL_SET.circles.length > 100 && HALL_SET.circles.every((k) => [k.x, k.z, k.r].every(Number.isFinite)), `its colliders are finite (${HALL_SET.circles.length})`);
  // the seal is the origin and clear of colliders; the way in is open; the dais and the star are closed
  const c = new Colliders();
  for (const k of HALL_SET.circles) c.add(k.x, k.z, k.r, k.tag);
  const free = (x, z) => { const p = { x, z }; c.resolve(p, 0.45, 40); return Math.hypot(p.x - x, p.z - z) < 1e-6; };
  assert(free(0, 0) && free(6, 6) && free(-9, -9) && free(0, THRONE.entryZ + 1.2) && free(0, THRONE.entryZ - 1) && free(0, THRONE.bonfire.z - 2), 'the floor, the south lip and the path are walkable');
  assert(!free(0, THRONE.daisZ - 0.8) && !free(7.6, -4.4) && !free(THRONE.star.x, THRONE.star.z + 1.2), 'the dais, a shard and the star are not');
  // no wall: the hero can walk out of the crater between the rim's slabs, east and west as well as south
  const walk = (dx, dz) => { const p = { x: 0, z: 0 }; for (let i = 0; i < 260; i++) { p.x += dx * 0.1; p.z += dz * 0.1; c.resolve(p, 0.45, 40); } return Math.hypot(p.x, p.z); };
  assert(walk(1, 0.12) > 20 && walk(-1, 0.12) > 20 && walk(0, 1) > 20, `the crater is open: walking east, west and south from the seal leaves it (${walk(1, 0.12).toFixed(0)} / ${walk(-1, 0.12).toFixed(0)} / ${walk(0, 1).toFixed(0)} m out)`);
  // the ambience runs headless (no pipeline): setup, a flare, a few frames
  const U = createSharedUniforms();
  const g = { U, time: 0, lights: new LightPool(U), fx: { add: new GlyphParticles(U, { max: 2000 }), alpha: new GlyphParticles(U, { max: 2000, additive: false }), fire: new FireField(U, { max: 2000 }) }, pipeline: null };
  const amb = createThroneHall(U, new Colliders()).ambience;
  amb.setup(g);
  amb.flare(1);
  for (let i = 0; i < 30; i++) amb.update(DT, g);
  // (the vents' flames are heat in the fire field, the wisps and motes glyph particles)
  assert(g.fx.fire.count > 5 && g.fx.add.count + g.fx.fire.count > 20 && g.lights.lights.length === 4, `the vents burn headless (${g.fx.fire.count} blobs, ${g.fx.add.count} particles, ${g.lights.lights.length} lights)`);

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
  // the harness: black plate, the hood, the yoke, the war-skirt and the cape, drawn a head taller
  {
    const L = d.rig.loadout;
    assert(L.head === 'lord.hood' && L.chest === 'lord.plate' && L.shoulders === 'lord.yoke' && L.arms === 'lord.arms' && L.legs === 'lord.legs' && L.waist === 'lord.skirt' && L.back === 'lord.cape' && L.weapon === 'lord.saber', `he wears his own harness (${Object.values(L).join(', ')})`);
    assert(d.rig.streamers.length === LORD_CAPE.length && d.rig.coat.length === LORD_PANELS.length && d.rig.offHand?.open && d.rig.offHand?.grip, `the cape hangs on ${d.rig.streamers.length} springs, the war-skirt on ${d.rig.coat.length}`);
    assert(d.drawScale === TUNING.scale && d.anim.drawScale === TUNING.scale && TUNING.scale > 1.2, `he is drawn at ${TUNING.scale} (the animator's gait with it)`);
    // one head: the hood over the faceplate (the owner's pick of three; the two helms are gone)
    const heads = LORD_ITEMS.filter((it) => it.slot === 'head');
    assert(heads.length === 1 && heads[0].id === 'lord.hood' && heads[0].hidesHair && heads[0].shadowsFace && LORD_LOADOUT.head === 'lord.hood', `one head item: ${heads.map((h) => `${h.id} "${h.name}"`).join(', ')}`);
  }
  // the hero's outfit switch (gear/looks.js) rebuilds his rig, which rewrites the shared per-part ink:
  // the Lord's red part-19 line (his blades) is put back
  {
    const U = G.game.U, pl = G.game.player, snap = () => ['uHeroPartInk', 'uHeroPartFill', 'uHeroPartRim'].map((k) => U[k].value[19].toArray().join());
    const s0 = snap();
    pl.setLook('robe');
    pl.setLook('shroud');
    assert(snap().join('|') === s0.join('|') && U.uHeroPartInk.value[19].x > 1.5 && pl.look === 'shroud', "a hero outfit switch keeps the Lord's red part-19 line");
  }
  bad = 0;
  d.object3d.traverse((m) => { const pos = m.geometry?.attributes?.position; if (pos) for (const v of pos.array) if (!Number.isFinite(v)) bad++; });
  assert(bad === 0, `his gear has no NaN vertices (${bad})`);
  assert(d.batch.meshes.length > 0 && d.batch.meshes.length < 28, `he draws through rigid batches (${d.batch.meshes.length} meshes)`);
  assert(d.blades.A && d.blades.B && d.blades.Q && d.blades.L && d.blades.off && !d.blades.A.visible && d.lit === 0, 'every form\'s blades are built; dark while he sits');
  assert(G.game.hud.lifeEls.length === 4, 'the boss bar shows four pips');
  return G;
}

// ================================================================== scenario: moves (the second pass)
/**
 * His second-pass moves (moves.js, spells.js): every new move in every form it is in is answered by
 * what its tells promise (a defender that parries white / blue and rolls at a red flare takes no hit;
 * a hero who stands still is hit); the wheeling blade leaves his hand mid-string while the off-hand
 * blade fights on and is caught before the next main-blade blow; the orbit's stones turn round him
 * and fly into the pauses of the string; the weather falls through form 4 (not with his AI off, not
 * in form 3), never a cue within 0.3 s of a blow that asks a guard, and a rolling hero gets out; the
 * great spell's waves are rolled through; links follow where the hero is.
 */
async function scenarioMoves() {
  out('\n== scenario MOVES (the second pass: new moves answered, the thrown blade, the orbit, the weather, the great spell, links) ==');
  const NEW = ['veiledHand', 'voidVerse', 'drawnIn', 'pushOpening', 'crushingVerse', 'hollowStep', 'wheelingBlade', 'wingedPursuit', 'crossedTides', 'twinCartwheel',
    'walkingMountain', 'stoneWheel', 'starHand', 'grindingWheel', 'voidWaltz', 'thunderVerse', 'hollowCrown', 'redEclipse', 'starlessNight'];
  for (let f = 1; f <= FORMS; f++) assert(NEW.filter((n) => weightIn(MOVES[n], f) > 0).length >= 4, `form ${f} has at least four new moves`);
  const mikiriForms = [1, 2, 3, 4].filter((f) => MOVE_NAMES.some((n) => weightIn(MOVES[n], f) > 0 && MOVES[n].beats.flatMap((b) => (Array.isArray(b.pick) ? b.pick : [b])).some((b) => b.mikiri)));
  assert(mikiriForms.length === 4, `a perilous thrust in every form (${mikiriForms.join(', ')})`);
  const feints = MOVE_NAMES.filter((n) => MOVES[n].beats.some((b) => b.feint && !b.catch));
  assert(feints.length >= 1 && feints.every((n) => realise(n, 1, () => 0.5).beats.filter((b) => b.feint).every((b) => !b.def.zone)), `a feint (the hand rises, nothing comes): ${feints.join(', ')}`);
  // ---- each new move, each form: answered (no hit), and unanswered it lands
  for (const name of NEW) {
    const def = MOVES[name];
    for (const f of formsOf(name)) {
      const [lo, hi] = def.band;
      const at = Math.max(1.8, Math.min(hi - 0.4, lo + (Math.min(hi, 12) - lo) * 0.4));
      const G = build();
      duel(G, { dist: at, form: f });
      G.game.player.debug.god = true;
      G.defend = makeDefender(G);
      const d = G.game.dragon, h0 = G.hits.length;
      d.debug.trigger(name);
      run(G, 9, () => G.defend.act(), () => d.mode === 'foot' && !d.fx.shotsAlive && !d.fx.crescentsAlive && !d.fx.strikesAlive && !d.spells.busy);
      const mine = G.hits.slice(h0).filter((h) => h.attack === name || h.attack === 'starlessNight');
      const took = mine.filter((h) => h.r === RESULT.HIT).length;
      const G2 = build();
      duel(G2, { dist: at, form: f });
      G2.game.player.debug.god = true;
      const d2 = G2.game.dragon, k0 = G2.hits.length;
      d2.debug.trigger(name);
      run(G2, 9, null, () => d2.mode === 'foot' && !d2.fx.shotsAlive && !d2.fx.crescentsAlive && !d2.fx.strikesAlive && !d2.spells.busy);
      const stood = G2.hits.slice(k0).filter((h) => h.r === RESULT.HIT).length;
      const ok = took === 0 && stood >= 1 && mine.length >= 1;
      if (!ok) assert(false, `${name} form ${f} from ${at.toFixed(1)} m: answered ${took} hits of ${mine.length} contacts; standing still ${stood} hits`);
      else out(`     ${name.padEnd(16)} form ${f}: answered by its tells (${mine.length} contacts, 0 hits), a hero who stands is hit ${stood} times`);
    }
  }
  // ---- the wheeling blade: one blade in his hand, one in the air, the catch
  {
    const G = build();
    duel(G, { dist: 2.2, form: 2 });
    G.game.player.debug.god = true;
    const d = G.game.dragon;
    let outAt = -1, backAt = -1, offLit = true, mainHidden = true, wheelHit = 0;
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'wheelingBlade' && e.bullet) wheelHit++; };
    d.debug.trigger('wheelingBlade');
    const A = d.brain.act, over = A.beats[A.beats.length - 1];
    run(G, 6, () => {
      if (d.glaiveOut && outAt < 0) outAt = A.t;
      if (d.glaiveOut) { offLit &&= d.blades.L.visible; mainHidden &&= !d.blades.A.visible; }
      if (outAt >= 0 && backAt < 0 && !d.glaiveOut) backAt = A.t;
    }, () => d.mode === 'foot' && !d.spells.busy);
    assert(outAt > 0 && offLit && mainHidden && wheelHit === 1 && backAt > outAt && backAt < over.impact, `the wheeling blade: thrown ${outAt.toFixed(2)} s in, the off-hand blade lit and the main one gone while it flies, it comes in once (${wheelHit} cue), caught at ${backAt.toFixed(2)} s before the last blow (${over.impact.toFixed(2)} s)`);
    // no main-blade move while it is out
    d.glaiveOut = true;
    const w = d.weigh('tempest', MOVES.tempest, 1), w2 = d.weigh('voidPush', MOVES.voidPush, 1);
    d.glaiveOut = false;
    assert(w === 0 && w2 === 1, 'while his blade is in the air nothing that swings it is picked (the Void still is)');
  }
  // ---- the orbit
  {
    const G = build();
    duel(G, { dist: 2.6, form: 3 });
    G.game.player.debug.god = true;
    const d = G.game.dragon;
    const thrown = [];
    let rMin = 99, rMax = 0;
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'stoneWheel' && e.bullet) thrown.push(G.game.time); };
    d.debug.trigger('stoneWheel');
    const A = d.brain.act, t0 = G.game.time;
    run(G, 7, () => {
      for (const o of d.spells.orbit) if (o.s.alive && o.s.phase === 'hang') { const r = Math.hypot(o.s.x - d.position.x, o.s.z - d.position.z); rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); }
    }, () => d.mode === 'foot' && !d.spells.busy);
    const hits = A.beats.filter((b) => !b.feint && !b.def.cast).map((b) => t0 + b.impact);
    const between = thrown.filter((t) => hits.some((h, i) => i + 1 < hits.length && t + TUNING.flashLead > h && t + TUNING.flashLead < hits[i + 1])).length;
    assert(thrown.length >= 2 && Math.abs(rMin - TUNING.orbit.r) < 0.15 && Math.abs(rMax - TUNING.orbit.r) < 0.15 && between >= 2, `the orbit: stones turn round him at ${rMin.toFixed(2)} - ${rMax.toFixed(2)} m and fly one at a time (${thrown.length} cued, ${between} landing in a pause of his string)`);
  }
  // ---- his death puts out the orbit's stones and the weather's marks (the review of PR 64: they are
  // records of the fx's own pools that fly and strike on their own loops, and a death left them
  // cueing and breaking the crater after him)
  {
    const G = build(SEED, true);
    duel(G, { dist: 2.6, form: 3 });
    G.game.player.debug.god = true;
    const d = G.game.dragon, W = TUNING.weather;
    d.debug.trigger('stoneWheel');
    run(G, 3, null, () => d.spells.orbit.some((o) => o.s.alive && o.s.phase === 'hang'));
    const mark = d.fx.callStrike?.(d.position.x + 4, d.position.z, W.radius, 1.2, { damage: W.damage, knockback: W.knockback, attack: 'starlessSky' });
    const before = { stones: d.fx.shots.filter((s) => s.alive && s._mine).length, marks: d.fx.strikes.filter((s) => s.alive && s.attack === 'starlessSky').length };
    let after = 0;
    G.watch = (n, e) => { if (n === 'combat:flash' && (e?.attack === 'stoneWheel' || e?.attack === 'starlessSky')) after++; };
    d.debug.kill();
    run(G, 3);
    const left = { stones: d.fx.shots.filter((s) => s.alive && s._mine).length, marks: d.fx.strikes.filter((s) => s.alive && s.attack === 'starlessSky').length };
    assert(!!mark && before.stones >= 1 && before.marks >= 1 && left.stones === 0 && left.marks === 0 && after === 0, `his death puts out the Void still in the air: ${before.stones} orbit stones and ${before.marks} weather mark before it, ${left.stones} and ${left.marks} after, ${after} cues after it`);
  }
  // ---- the weather (form 4)
  {
    const G = build(SEED, true);
    duel(G, { dist: 3, ai: true, form: 4 });
    G.game.player.debug.god = true;
    G.defend = makeDefender(G);
    const d = G.game.dragon;
    const marks = [], guardCues = [];
    G.watch = (n, e) => {
      if (n !== 'combat:flash' || e?.source !== 'dragon') return;
      if (e.attack === 'starlessSky') marks.push(G.game.time);
      else if (e.tell === TELL.NORMAL || e.tell === TELL.BLUE) guardCues.push(G.game.time);
    };
    const h0 = G.hits.length;
    run(G, 60, () => { G.defend.act(); d.brain.pendingPhase = 0; });
    const near = marks.filter((t) => guardCues.some((g) => Math.abs(g - t) < 0.3)).length;
    const took = G.hits.slice(h0).filter((h) => h.attack === 'starlessSky' && h.r === RESULT.HIT).length;
    const gaps = marks.slice(1).map((t, i) => t - marks[i]);
    assert(marks.length >= 10 && marks.length <= 45 && near === 0, `form 4's weather: ${marks.length} strikes in 60 s (gaps ${Math.min(...gaps).toFixed(2)} - ${Math.max(...gaps).toFixed(2)} s), none cued within 0.3 s of a blow that asks a guard (${near})`);
    assert(took <= 1, `a hero who rolls out of each mark is struck ${took} times`);
    const G3 = build(SEED, true);
    duel(G3, { dist: 3, ai: false, form: 4 });
    G3.game.player.debug.god = true;
    let m3 = 0;
    G3.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'starlessSky') m3++; };
    run(G3, 12);
    const G4 = build(SEED, true);
    duel(G4, { dist: 3, ai: true, form: 3 });
    G4.game.player.debug.god = true;
    let m4 = 0;
    G4.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'starlessSky') m4++; };
    run(G4, 15, () => { G4.game.dragon.brain.pendingPhase = 0; });
    assert(m3 === 0 && m4 === 0, `no weather with his AI off (${m3}) nor in form 3 (${m4})`);
  }
  // ---- the great spell: three waves, each cued; rolled through
  {
    const G = build();
    duel(G, { dist: 7, form: 4 });
    G.game.player.debug.god = true;
    const d = G.game.dragon;
    let cues = 0;
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'starlessNight' && e.hazard) cues++; };
    d.debug.trigger('starlessNight');
    const h0 = G.hits.length;
    run(G, 7, null, () => d.mode === 'foot' && !d.spells.busy);
    const struck = G.hits.slice(h0).filter((h) => h.attack === 'starlessNight' && h.r === RESULT.HIT).length;
    assert(cues === TUNING.night.waves && struck === TUNING.night.waves, `Starless Night: ${cues} waves cued, a hero 7 m off who stands is struck by ${struck}`);
    const p = G.game.player;
    d.position.set(0, 0, -1);
    p.debug.teleport(5, -1);
    d.brain.cooldowns.starlessNight = 0;
    d.brain.act = null;
    d.debug.setAI(false);
    run(G, 0.5);
    assert(d.weigh('tempest', MOVES.tempest, 1) === 1, 'without the waves his strings weigh as ever');
    d.debug.trigger('starlessNight');
    run(G, 2.0);
    assert(d.spells.nightLive && d.weigh('tempest', MOVES.tempest, 1) === 0 && d.weigh('meridian', MOVES.meridian, 1) === 1, 'while the waves run nothing that asks a guard is picked (a dodge still is)');
  }
  {
    const G = build();
    duel(G, { dist: 6, form: 4 });
    G.game.player.debug.god = true;
    G.defend = makeDefender(G);
    const d = G.game.dragon, h0 = G.hits.length;
    d.debug.trigger('starlessNight');
    run(G, 7, () => G.defend.act(), () => d.mode === 'foot' && !d.spells.busy);
    const r = G.hits.slice(h0).filter((h) => h.attack === 'starlessNight');
    assert(r.length >= 2 && !r.some((h) => h.r === RESULT.HIT), `a hero who rolls at each flare (a perfect dodge sends him into his counter: a wave over him then misses) comes through every wave (${r.map((h) => h.r).join(', ')})`);
  }
  // ---- the budget: form 4 with everything of his live (the weather falling, Starless Night's waves,
  // every look of it): the fire field under its 6000 blobs, the additive glyphs under 6500
  for (const L of ['a', 'b', 'c']) {
    const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
    setLook('great', L);
    const G = build(SEED, true);
    duel(G, { dist: 6, ai: true, form: 4 });
    G.game.player.debug.god = true;
    G.defend = makeDefender(G);
    const d = G.game.dragon;
    let fire = 0, nights = 0;
    run(G, 40, () => {
      G.defend.act();
      d.brain.pendingPhase = 0;
      if (d.mode === 'foot' && (d.brain.cooldowns.starlessNight ?? 0) <= 0 && !d.spells.night.alive) { d.debug.trigger('starlessNight'); nights++; }
      fire = Math.max(fire, G.game.fx.fire.count);
    });
    setLook('great', null);
    out(`     ?great=${L}: 40 s of form 4, ${nights} Starless Nights, ${d.spells.stats.skyCalls} weather strikes: fire field peak ${fire}, additive glyphs peak ${G.peakAdd}`);
    assert(fire < 6000 && G.peakAdd < 6500 && nights >= 1, `?great=${L}: form 4 with the weather and the great spell fits the pools (fire ${fire} < 6000, glyphs ${G.peakAdd} < 6500)`);
  }
  // ---- links by where the hero is
  {
    const DIR = await imp('src/entities/enemies/duelist/director.js');
    const G = build();
    duel(G, { dist: 3, form: 1 });
    const d = G.game.dragon, br = d.brain;
    const R = Math.random;
    Math.random = () => 0;
    const sense = (dist, v = 0) => ({ dist, dx: 0, dz: dist, ang: 0, vx: 0, vz: v, p: { x: 0, z: dist } });
    d.yaw = 0;
    br.cooldowns = {};
    const pick = (from, s) => DIR.linkFor(br, { name: from }, s)?.to ?? null;
    const farTo = pick('litany', sense(7)), nearTo = pick('litany', sense(2.2)), spellTo = pick('voidBolt', sense(2.4)), pursueTo = DIR.linkFor(br, { name: 'veiledHand' }, sense(7), true)?.to;
    Math.random = R;
    assert(farTo === 'pushOpening' && pursueTo === 'pushOpening' && ['voidVerse', 'crushingVerse', 'reap'].includes(nearTo) && spellTo === 'voidVerse', `links follow the hero: a string ended with him far → ${farTo} (its pursuit ${pursueTo}), near → ${nearTo}; after a bolt, close in → ${spellTo}`);
    const missing = MOVE_NAMES.filter((n) => !MOVES[n].transition && !MOVES[n].streak && !d.LINKS[n]);
    assert(!missing.length, `every move has links (${missing.join(', ') || 'all'})`);
  }
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
        if (!real.every((b) => [TELL.NORMAL, TELL.BLUE, TELL.RED, TELL.BLACK].includes(b.def.tell))) assert(false, `${tag}: a tell on every real hit`);
        const first = real[0];
        // (a QUICK blow, ADR-226: a normal tell, its windup >= minQuickWindup and its glint inside it)
        const floor = first?.def.quick ? TUNING.minQuickWindup : TUNING.minFirstWindup;
        if (first?.def.quick && !(first.def.tell === TELL.NORMAL && TUNING.flashLead <= first.impact - first.tellAt + 1e-6)) assert(false, `${tag}: a quick blow is a normal one, its glint inside its windup`);
        if (!def.transition && !(first && first.impact - first.tellAt >= floor - 1e-6)) assert(false, `${tag}: first real windup ${first ? (first.impact - first.tellAt).toFixed(3) : '-'} >= ${floor}`);
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
  if (!paceOn()) assert(gaps[0] > gaps[1] && gaps[1] > gaps[2] && gaps[2] > gaps[3] && gaps[3] >= TUNING.minHitGap, `a string's hits come faster form by form: ${gaps.map((g) => g.toFixed(3)).join(' > ')} s`);
  else {
    // (ADR-251, the readable pace: every gap at rule 10's floor, the first blows still quicker form by form)
    const first = [1, 2, 3, 4].map((f) => realise(f === 1 ? 'litany' : f === 2 ? 'tempest' : f === 3 ? 'cyclone' : 'judgment', f, () => 0.2).beats.find((b) => !b.feint).impact);
    assert(gaps.every((g) => g >= TUNING.pace.gap - 1e-6) && first[0] > first[1] && first[1] > first[2] && first[2] > first[3], `the readable pace: a string's hits ${gaps.map((g) => g.toFixed(3)).join(' / ')} s apart (>= ${TUNING.pace.gap}), its first blow sooner form by form: ${first.map((t) => t.toFixed(3)).join(' > ')} s`);
  }
}

// ================================================================== scenario: timing (flash → contact)
async function scenarioTiming() {
  out('\n== scenario TIMING (every move from inside its band: each glint is a blow, on time) ==');
  let worst = 0, moves = 0;
  // (GCD_TMOVE=name: that move alone, its cues and contacts printed)
  const only = process.env.GCD_TMOVE;
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    if (def.transition) continue;
    if (def.terrain) continue; // (a move on the crater's pieces needs them: scenario TERRAIN, on the real set)
    if (only && name !== only) continue;
    for (const f of formsOf(name)) {
      const G = build();
      const d = G.game.dragon;
      const [lo, hi] = def.band;
      const at = def.counter ? 2.2 : Math.max(1.6, Math.min(hi - 0.4, lo + (Math.min(hi, 12) - lo) * 0.4));
      duel(G, { dist: at, form: f });
      G.game.player.debug.god = true;
      const flashes = [], contacts = [];
      G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon') { flashes.push(G.game.time); if (only) out(`       ${G.game.time.toFixed(3)} flash ${e.attack} ${e.tell}`); } };
      const h0 = G.hits.length;
      if (!d.debug.trigger(name)) { assert(false, `${name} form ${f}: starts`); continue; }
      run(G, 9, null, () => d.mode === 'foot' && !d.fx.shotsAlive && !d.fx.crescentsAlive && !d.fx.strikesAlive && d._storm.left === 0 && !d.spells?.busy); // (the second pass: the wheeling blade, the orbit, Starless Night)
      for (const h of G.hits.slice(h0)) if (h.r !== RESULT.IGNORED) { contacts.push(h.t); if (only) out(`       ${h.t.toFixed(3)} contact ${h.attack} ${h.kind} ${h.r}`); }
      // every contact was cued flashLead before it (± a frame and the hit-stop of the blow before)
      let w = 0;
      for (const c of contacts) {
        const fl = flashes.filter((t) => t <= c + 1e-6).pop();
        // (the readable pace, ADR-251: a melee blow is cued pace.flashLead before; a spell keeps its own lead,
        // so a blow's earlier glint may come between a thrown stone's glint and its contact: any glint of the
        // last 0.6 s that cued it on time counts)
        const leadOf = (t) => Math.min(Math.abs(c - t - TUNING.flashLead), paceOn() ? Math.abs(c - t - TUNING.pace.flashLead) : Infinity);
        const lead = fl === undefined ? Infinity : paceOn() ? Math.min(...flashes.filter((t) => t <= c + 1e-6 && t >= c - 0.6).map(leadOf)) : leadOf(fl);
        w = Math.max(w, lead);
      }
      worst = Math.max(worst, Number.isFinite(w) ? w : 9);
      moves++;
      const firstLands = contacts.length >= 1;
      if (!firstLands || !(w <= 0.09)) assert(false, `${name} form ${f} from ${at.toFixed(1)} m: ${flashes.length} flashes, ${contacts.length} contacts, worst ${(w * 1000).toFixed(0)} ms`);
      else out(`     ${name.padEnd(10)} form ${f} from ${at.toFixed(1)} m: ${flashes.length} flashes, ${contacts.length} contacts, worst ${(w * 1000).toFixed(0)} ms`);
    }
  }
  if (only) return;
  assert(moves >= 30 && worst <= 0.09, `${moves} move × form runs: every contact within ${(worst * 1000).toFixed(0)} ms of its flash + ${paceOn() ? `${TUNING.pace.flashLead} (a blow) / ${TUNING.flashLead} (a spell)` : TUNING.flashLead} s, and every move's first hit lands`);
}

// ================================================================== scenario: clashdance (his posture's recovery by HP)
// The clash dance (?clash=dance, combat/clashDance.js, ADR-247) on a boss whose recovery already scales by
// HP (posture.regenByHp, a curve from the full bar to the empty one): off, the curve as it was; on, the
// dance's steps replace it (DEFENSE.clashDance.regenByHp), never faster than the curve. duel.mjs `clashdance` has the run.
async function scenarioClashDance() {
  out('\n== scenario CLASHDANCE (the Lord: his posture recovers by the steps instead of the curve) ==');
  const { setClashMode, clashRegenK } = await imp('src/combat/clashDance.js');
  const G = build();
  const { game } = G;
  const d = game.dragon, P = TUNING.posture;
  duel(G, { dist: 6 });
  game.player.debug.god = true;
  const drain = (frac) => {
    d.hp = d.maxHp * frac;
    d.posture = 150;
    d.postureTimer = P.regenDelay + 0.01;
    d._updatePosture(0.5);
    return (150 - d.posture) / (P.regenRate * 0.5);
  };
  const fr = [1, 0.7, 0.5, 0.2, 0.05];
  try {
    setClashMode('0');
    const off = fr.map(drain);
    assert(off.every((v, i) => Math.abs(v - (P.regenByHp[1] + (P.regenByHp[0] - P.regenByHp[1]) * fr[i])) < 1e-6), `off: his curve as it was (x${off.map((v) => v.toFixed(2)).join(', x')} at ${fr.map((f) => f * 100).join(' / ')} % HP)`);
    setClashMode('dance');
    const on = fr.map(drain);
    assert(on.every((v, i) => Math.abs(v - clashRegenK(fr[i])) < 1e-6), `on: the steps replace the curve (x${on.map((v) => v.toFixed(2)).join(', x')})`);
    assert(on.every((v, i) => v <= off[i] + 1e-9), `never faster than his curve at any HP`);
  } finally {
    setClashMode('0');
    d.hp = d.maxHp;
    d.posture = 0;
  }
  return G;
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
    run(G, secs, step, () => d.mode === 'foot' && !d.fx.shotsAlive && !d.fx.crescentsAlive && !d.fx.strikesAlive && d._storm.left === 0 && !d.spells?.busy);
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
    G.defend = makeDefender(G, { early: PLAIN_LEAD + DT }); // a plain parry (a perfect one sends the bolt back; the bolt lands a step after its cue's lead)
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
  // ---- the thrown blade's way home against a red warning told while it flew away (the tuning pass,
  // 2026-11-16: a falling piece's warning given while the blade flew out, landing as it came back
  // through the hero: a white cue and a red one 0.2 s apart, once in a PACE run). Just before it
  // turns, a red impact is expected where its way home would cross the hero: it must not be cued
  // within 0.3 s of that (it waits at the turn, or comes home uncued)
  {
    const G = stage(2, 8, { god: true });
    const d = G.game.dragon, p = G.game.player;
    const cues = [];
    let redAt = -1;
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'glaive') cues.push(G.game.time + TUNING.flashLead); };
    d.debug.trigger('glaive');
    run(G, 5, () => {
      const s = d.fx.shots?.find((x) => x.alive && x.kind === 'glaive');
      if (redAt < 0 && s?.phase === 'fly' && Math.hypot(s.x - s.ox, s.z - s.oz) >= TUNING.glaive.range - 0.4) {
        const rem = (TUNING.glaive.range - Math.hypot(s.x - s.ox, s.z - s.oz)) / s.speed;
        const home = rem + 0.32 + Math.max(0, Math.hypot(p.position.x - s.x, p.position.z - s.z) - s.radius - 0.45) / s.back;
        d.brain.expect(home, TELL.RED, 'test');
        redAt = G.game.time + home;
      }
    }, () => redAt > 0 && !d.glaiveOut && d.mode === 'foot');
    const near = cues.filter((t) => t > redAt - 1.5 && Math.abs(t - redAt) < 0.3);
    assert(redAt > 0 && !near.length, `the blade's way home is not cued within 0.3 s of a red impact told while it flew away (red at ${(redAt % 100).toFixed(2)}, its cues land at ${cues.map((t) => (t % 100).toFixed(2)).join(', ')})`);
  }
  // ---- its twin (the engine pass): the WORLD's red warning (a falling piece: brain._worldCue) given
  // just after the throw, while the blade is still on its way out, landing where its way home will
  // cross the hero (and `off` s after that). _worldCue reads the way home as the ledger does
  // (ledger.glaiveHome) instead of timing the blade as if it came straight at him: the outward pass
  // keeps its cue, and the way home is not cued within the room a thing in flight gives the world's
  // warning (guard sep + margin + pad: 0.64 s; at the turn fairDelay alone clears sep + margin, 0.46:
  // with off 0.55 the blade came home cued 0.55 s from the warning before this pass)
  {
    const GG = TUNING.pressure.guard, room = GG.sep + GG.margin + GG.pad;
    for (const off of [0, 0.55]) {
      const G = stage(2, 8, { god: true });
      const d = G.game.dragon, p = G.game.player;
      const cues = [];
      let redAt = -1, outAt = -1;
      G.watch = (n, e) => { if (n === 'combat:flash' && e?.attack === 'glaive') cues.push(G.game.time + TUNING.flashLead); };
      d.debug.trigger('glaive');
      run(G, 5, () => {
        const s = d.fx.shots?.find((x) => x.alive && x.kind === 'glaive');
        if (redAt < 0 && s?.phase === 'fly' && s.age > 0.02) {
          const reach = s.radius + (p.radius ?? 0.45);
          const home = glaiveHome(s, p.position, reach, d._hilt ?? d.position);
          const along = (p.position.x - s.x) * s.dx + (p.position.z - s.z) * s.dz;
          outAt = G.game.time + Math.max(0, along - reach) / s.speed;
          if (home >= 0) {
            G.game.events.emit('combat:tell', { source: 'world', attack: 'fallingDebris', tell: TELL.RED, impactIn: home + off, x: p.position.x, z: p.position.z, hazard: true });
            redAt = G.game.time + home + off;
          }
        }
      }, () => redAt > 0 && !d.glaiveOut && d.mode === 'foot');
      const near = cues.filter((t) => Math.abs(t - redAt) < room);
      const out = cues.filter((t) => Math.abs(t - outAt) < 0.15);
      assert(redAt > 0 && !near.length && out.length === 1, `a world warning told as the blade leaves his hand, landing ${off} s after its way home crosses the hero: its outward pass keeps its cue (${out.length}), its way home is not cued within ${room.toFixed(2)} s of it (red at ${(redAt % 100).toFixed(2)}, its cues land at ${cues.map((t) => (t % 100).toFixed(2)).join(', ')})`);
    }
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
    assert(glided && top > TUNING.glide.hover * 0.8 && fast > TUNING.glide.on && d.position.y < 0.02 && d.anim.key === 'loco' && d.mode === 'foot', `across the crater he is carried (${top.toFixed(2)} m off the floor at ${fast.toFixed(1)} m/s); in reach he comes down and walks`);
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
  out('\n== scenario BOUNDS (he keeps to the crater\'s floor, and a hero backed against the rim is still in his reach) ==');
  const G = build();
  const { game } = G;
  const d = game.dragon, p = game.player, B = THRONE.floor.r, zN = THRONE.floor.zN;
  duel(G, { dist: 4, ai: true, form: 3 });
  p.debug.god = true;
  let outside = 0, melee = 0;
  const h0 = G.hits.length;
  run(G, 45, () => {
    p.debug.teleport(10.3, 10.4); // against the south-east rim, a metre past his floor
    if (d.mode !== 'intro' && d.position.y < 0.5 && (Math.hypot(d.position.x, d.position.z) > B + 1e-6 || d.position.z < zN - 1e-6)) outside++;
  });
  for (const h of G.hits.slice(h0)) if (h.r === RESULT.HIT && h.kind === 'slash') melee++;
  assert(d.bound === B && outside === 0, `45 s of form 3 against a hero at the rim: never off his floor, a circle of ${B} m south of the dais (${outside} frames outside)`);
  assert(melee >= 3, `his blade reaches the rim (${melee} blows landed there)`);
  // every form, AI on, a hero who stands in the middle: no errors, no NaN (G.tick throws), the particle pool holds
  // (and his free hand stays the duelists': rigid on the forearm, no wrist turn, no sword fingers;
  // the hero's alone has them, anim.js opts.freeHand)
  let peak = 0, wMin = 1, plain = true;
  for (let f = 1; f <= FORMS; f++) {
    const Gf = build();
    duel(Gf, { dist: 3, ai: true, form: f });
    Gf.game.player.debug.god = true;
    const df = Gf.game.dragon;
    run(Gf, 30, () => { wMin = Math.min(wMin, Math.abs(df.rig.arms.L.wrist.quaternion.w)); });
    plain &&= df.anim.freeHand === false && df.rig.offHand?.fingers === undefined && Gf.game.player.anim.freeHand === true;
    peak = Math.max(peak, Gf.peakAdd);
    if (Gf.payload.size) assert(false, `form ${f}: finite event payloads (${[...Gf.payload].join(', ')})`);
  }
  assert(peak < 6500, `30 s of every form with the AI on: the additive particle pool peaks at ${peak} of 7000`);
  assert(plain && wMin > 0.99999, `his free hand is a duelist's: no free-hand animator, no sword fingers, the wrist never turns (|w| ≥ ${wMin.toFixed(6)})`);
}

// ================================================================== scenario: flow
async function scenarioFlow() {
  out('\n== scenario FLOW (title → the south lip → the throne intro → the duel) ==');
  const G = build();
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  run(G, 0.3);
  input.tap('Enter');
  run(G, 0.5);
  if (game.state !== 'explore') game.flow.debug.toState('explore');
  run(G, 0.3);
  assert(game.state === 'explore' && d.mode === 'sleep', 'exploring; he sits');
  p.debug.teleport(0, THRONE.entryZ + 0.6);
  run(G, 0.2);
  assert(d.mode === 'sleep', 'outside the crater he does not stir');
  run(G, 3, () => { input.axis = { x: 0, y: 1 }; }, () => d.mode !== 'sleep');
  input.axis = { x: 0, y: 0 };
  assert(d.mode === 'intro' && game.state === 'bossIntro' && p.position.z < CONFIG.world.bossTriggerZ + 0.5, `over the lip, on the crater's floor, he lifts his head (hero at z ${p.position.z.toFixed(1)})`);
  let top = 0, lit = false, air = false;
  run(G, 6, () => { top = Math.max(top, d.position.y); lit = lit || d.lit > 0.9; air = air || d.state === 'airborne'; }, () => d.mode === 'foot' || d.mode === 'act');
  run(G, 0.2);
  assert(G.counts['dragon:introDone'] === 1 && game.state === 'boss', `the intro ends in the duel (${game.state})`);
  assert(lit && air && top > TUNING.intro.apex * 0.9 && G.counts['dragon:land'] >= 1, `the blade ignites and he leaps from the dais (apex ${top.toFixed(1)} m)`);
  // (on the floor, or carried a hand's breadth over it: he glides after a hero who keeps his distance)
  assert(d.position.y >= 0 && d.position.y <= TUNING.glide.hover + 1e-6 && Math.hypot(d.position.x - TUNING.intro.land.x, d.position.z - TUNING.intro.land.z) < 6 && d.position.z > THRONE.floor.zN - 1e-6, `he lands on the crater's floor by the seal (${d.position.x.toFixed(1)}, ${d.position.z.toFixed(1)})`);
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
// ================================================================== scenario: training (ADR-099)
// Every situation of the Training catalogue that applies to this boss, run by the runner itself
// (src/dev/training.js): each must play out (done, within its time) and show what it promises.
async function scenarioTraining() {
  const FLM = await imp('src/entities/player/flurry.js');
  out('\n== scenario TRAINING (every situation of the Training catalogue for this boss plays out and shows what it promises) ==');
  const G = build(SEED, true); // (the real crater: the TERRAIN situations and his terrain moves need its pieces)
  const { game } = G;
  duel(G, { dist: 4 });
  const T = game.lab.training;
  const L = T.list();
  const cats = new Set(L.map((s) => s.cat));
  out(`   ${L.length} situations in ${cats.size} categories: ${[...cats].join(', ')}`);
  const bad = [];
  let si = 0;
  for (const s of L) {
    if (s.cat === 'BOSS MOVES' && !true) continue;
    Math.random = mulberry32(SEED + 0x7a11 + 977 * si); // (each situation on a stream of its own: its result does not hang on what the ones before it drew)
    // (... and the hero flurry's figures, a stream of their own (player/flurry.js): earlier scenarios' flurries left it anywhere)
    FLM.setFigureSeed(SEED + 0x7a11 + 977 * si++);
    T.run(s.id);
    let frames = 0;
    while (T.ph !== 'done' && frames < Math.round(40 / DT)) { G.tick(DT); frames++;}
    const r = T.lastResult;
    const ok = T.ph === 'done' && r?.id === s.id && r.ok;
    if (!ok || process.env.GCD_TRACE) out(`   ${ok ? 'ok ' : 'BAD'} ${s.cat} · ${s.name}: ${T.ph} in ${(frames * DT).toFixed(1)} s · missing ${JSON.stringify(r?.missing ?? '?')} · hero ${game.player.state} streak ${game.player.streak} · boss ${game.dragon.state}`);
    if (!ok) bad.push(s.id);
  }
  T.stop();
  assert(L.length >= 20 && !bad.length, `every situation plays out and shows what it promises (${L.length - bad.length} of ${L.length}${bad.length ? `; not: ${bad.join(', ')}` : ''})`);
  // a form's change from form 1 (no form before it run first): the runner puts him in the form
  // before it (the review of PR 64: phase3() / phase4() did nothing from further back, and an empty
  // `expect` let the situation pass)
  for (const [id, n] of [['phase3l', 3], ['phase4', 4]]) {
    const G2 = build(SEED, true);
    duel(G2, { dist: 4 });
    const T2 = G2.game.lab.training, d2 = G2.game.dragon, from = d2.phase;
    T2.run(id);
    let f = 0;
    while (T2.ph !== 'done' && f < Math.round(20 / DT)) { G2.tick(DT); f++; }
    const r = T2.lastResult, done = T2.ph === 'done';
    T2.stop();
    assert(from === 1 && done && !!r?.ok && d2.phase === n, `Training's ${id} plays from form 1: form ${from} → ${d2.phase}, ${r?.ok ? 'shown' : `missing ${JSON.stringify(r?.missing ?? '?')}`}`);
  }
  return G;
}

// ================================================================== scenario: terrain (ADR-109)
// The crater's pieces in his grip, on the real set with its real breakables (build(seed, true)).
async function scenarioTerrain() {
  out('\n== scenario TERRAIN (the crater\'s pieces in his grip: Void Hurl, Glass Rain, Crown Fall) ==');
  const names = ['voidHurl', 'glassRain', 'crownFall'];
  // ---- a world without pieces: the lab stage, the other scenarios' mock
  {
    const G = build();
    duel(G, { dist: 8, form: 3 });
    const d = G.game.dragon;
    assert(names.every((n) => MOVES[n]?.terrain && d.weigh(n, MOVES[n], 1, 8) === 0 && d.debug.trigger(n) === false) && d.mode === 'foot', 'in a world without pieces his AI gives the three moves no weight and none can start');
    assert(names.every((n) => d.debug.abilities().some((a) => a.name === n)), 'they are in his abilities (the Lab, Training\'s BOSS MOVES)');
  }
  /** The real crater, the duel on, form `form`: him at (bx, bz), the hero at (hx, hz). */
  const stage = (form, hx, hz, bx = 0, bz = -4) => {
    const G = build(SEED, true);
    duel(G, { dist: 8, form });
    const d = G.game.dragon, p = G.game.player;
    p.debug.god = true;
    d.position.set(bx, 0, bz);
    p.debug.teleport(hx, hz);
    d.yaw = Math.atan2(hx - bx, hz - bz);
    run(G, 0.2);
    G.flashes = [];
    G.watch = (n, e) => { if (n === 'combat:flash' && e?.source === 'dragon' && e.hazard) G.flashes.push(G.game.time); };
    return G;
  };
  const settled = (G) => () => {
    const d = G.game.dragon;
    return d.mode === 'foot' && !d.terrain.busy && !G.game.world.destructibles.active.some((b) => b.state === STATE.FALLING || b.state === STATE.FLYING);
  };
  /** Run his move to the end; what he held on the way. */
  const play = (G, name, step = null) => {
    const D = G.game.world.destructibles, seen = new Set();
    let top = 0;
    const ok = G.game.dragon.debug.trigger(name);
    run(G, 8, () => {
      for (const b of D.list) if (b.state === STATE.HELD) { seen.add(b); top = Math.max(top, b.py); }
      step?.(G);
    }, settled(G));
    return { ok, held: [...seen], top };
  };

  // ---- the stones in the air hang by their bodies' offset (the set's ambience keeps them there)
  {
    const G = stage(1, 0, 4.5);
    const hov = G.game.world.destructibles.list.filter((b) => b.kind === 'hover');
    assert(hov.length === 6 && hov.every((b) => b.def.hover > 1 && Math.abs(b.body.position.y - b.def.hover) <= 0.15 && b.state === STATE.INTACT), `six stones hang whole, ${hov.map((b) => (b.def.hover + b.h * 0.5).toFixed(1)).join(' / ')} m up`);

    // ---- Void Hurl on a hero who stands still
    const d = G.game.dragon;
    assert(d.weigh('voidHurl', MOVES.voidHurl, 1, 8.5) > 0, 'Void Hurl: with pieces in reach his AI may pick it');
    const h0 = G.hits.length;
    const r = play(G, 'voidHurl');
    const hit = G.hits.slice(h0).filter((h) => h.attack === 'voidHurl');
    assert(r.ok && r.held.length === 1 && r.held[0].kind === 'hover' && r.top > 2.2, `Void Hurl takes ONE piece, a stone already in the air, and hangs it beside him (${r.top.toFixed(1)} m)`);
    assert(hit.length === 1 && hit[0].r === RESULT.HIT && hit[0].tell === TELL.RED && hit[0].kind === 'crush' && G.flashes.length === 1 && Math.abs(hit[0].t - G.flashes[0] - TUNING.flashLead) < 0.06, `it lands on a hero who stands still: red, cued ${(hit[0] ? hit[0].t - G.flashes[0] : NaN).toFixed(3)} s before (flashLead ${TUNING.flashLead})`);
    assert(r.held[0].state === STATE.GONE && r.held[0].body.position.y === 0 && !d.terrain.busy, 'the stone is gone where it landed; nothing of his is left in the air');
    // ---- the reset puts it back in the air
    G.game.world.restore();
    run(G, 0.1);
    assert(hov.every((b) => b.state === STATE.INTACT && Math.abs(b.body.position.y - b.def.hover) <= 0.15), 'after the reset every stone hangs again');
  }
  // ---- out of the ring: no blow
  {
    const G = stage(1, 0, 4.5);
    const D = G.game.world.destructibles, p = G.game.player;
    const h0 = G.hits.length;
    let moved = false;
    const r = play(G, 'voidHurl', () => { if (!moved && D.list.some((b) => b.state === STATE.FLYING)) { moved = true; p.debug.teleport(7, 9); } });
    assert(r.ok && moved && G.flashes.length === 1 && !G.hits.slice(h0).some((h) => h.attack === 'voidHurl'), 'a hero who leaves the ring while the stone is in the air is not hit (the ring still glints)');
  }
  // ---- cut short before the throw: what he holds drops
  {
    const G = stage(1, 0, 4.5);
    const d = G.game.dragon, D = G.game.world.destructibles;
    const h0 = G.hits.length;
    d.debug.trigger('voidHurl');
    run(G, 0.5);
    const held = D.list.find((b) => b.state === STATE.HELD);
    d.debug.stagger();
    run(G, 4, null, settled(G));
    assert(held && held.state === STATE.GONE && !d.terrain.busy && G.flashes.length === 0 && !G.hits.slice(h0).some((h) => h.attack === 'voidHurl'), 'staggered in the windup, the stone drops where it hung: no ring, no blow');
  }
  // ---- with the stones gone he tears a plate out of the floor at his feet (the second pass: the floor
  // breaks and lifts; before it, he took the nearest standing shard, and the crater's cover went first)
  {
    const G = stage(1, 0, 4.5);
    const D = G.game.world.destructibles;
    for (const b of D.list) if (b.kind === 'hover') { D.take(b); D.drop(b); }
    run(G, 1.5);
    const shards = D.list.filter((b) => b.kind === 'shard' && b.state === STATE.INTACT).length;
    const r = play(G, 'voidHurl');
    const lord = G.game.dragon.position, pc = r.held[0];
    assert(r.ok && r.held.length === 1 && pc.floor && (pc.kind === 'plate' || pc.kind === 'flagstone') && pc.state === STATE.GONE && Math.hypot(pc.x - lord.x, pc.z - lord.z) <= TUNING.terrain.floorReach + 0.01, `with no stone left in the air he tears a ${pc?.kind} out of the floor ${pc ? Math.hypot(pc.x - lord.x, pc.z - lord.z).toFixed(1) : '-'} m from him and throws it`);
    assert(D.list.filter((b) => b.kind === 'shard' && b.state === STATE.INTACT).length === shards, 'the crater\'s standing shards (its cover) are left standing');
  }
  // ---- Glass Rain
  {
    const G = stage(3, 0, 4.5);
    const d = G.game.dragon;
    assert(d.weigh('glassRain', MOVES.glassRain, 1, 8.5) > 0, 'Glass Rain: his AI may pick it in form 3');
    const h0 = G.hits.length;
    const r = play(G, 'glassRain');
    const hits = G.hits.slice(h0).filter((h) => h.attack === 'glassRain');
    const gaps = G.flashes.slice(1).map((t, i) => t - G.flashes[i]);
    assert(r.ok && r.held.length === 3 && r.held.every((b) => b.state === STATE.GONE), 'Glass Rain takes three pieces and throws them all');
    assert(G.flashes.length === 3 && gaps.every((g) => g >= TUNING.minHitGap - 0.02) && hits.length >= 1 && hits.every((h) => h.tell === TELL.RED), `three rings, each cued, ${gaps.map((g) => g.toFixed(2)).join(' and ')} s apart (>= ${TUNING.minHitGap}); ${hits.length} land on a hero who stands still`);
  }
  // ---- Crown Fall: the tall shard beside the hero comes down on him; the fall is the world's
  {
    const G = stage(2, 8.6, 4.4, 2, -2);
    const d = G.game.dragon, D = G.game.world.destructibles;
    const shard = D.list.filter((b) => b.kind === 'shard').sort((a, b) => Math.hypot(a.x - 10.2, a.z - 3.3) - Math.hypot(b.x - 10.2, b.z - 3.3))[0];
    assert(shard.topples && shard.h > 3 && d.weigh('crownFall', MOVES.crownFall, 1, 9) > 0 && d.terrain.fall.piece === shard, `Crown Fall: the hero 2 m from a ${shard.h.toFixed(1)} m shard: his AI may pick it, for that shard`);
    const h0 = G.hits.length;
    const tells = [];
    const w = G.watch;
    G.watch = (n, e) => { w(n, e); if (n === 'combat:tell' && e?.source === 'world') tells.push(G.game.time); };
    const t0 = G.game.time;
    const r = play(G, 'crownFall');
    const hit = G.hits.slice(h0).find((h) => h.attack === 'fallingDebris');
    assert(r.ok && shard.state === STATE.BROKEN && tells.length >= 1 && hit && hit.r === RESULT.HIT && hit.tell === TELL.RED, `he wrenches it down: the world tells it (red) and it lands on a hero who stays, ${(hit ? hit.t - t0 : NaN).toFixed(2)} s after the move began`);
    assert(hit.t - tells[0] > 0.5, `the strip is marked ${(hit.t - tells[0]).toFixed(2)} s before it lands`);
    // far from every tall piece: not his move
    const G2 = stage(2, 0, 2, 0, -5);
    assert(G2.game.dragon.weigh('crownFall', MOVES.crownFall, 1, 7) === 0 && G2.game.dragon.debug.trigger('crownFall') === false, 'with the hero in the open (no tall piece within its own height of him) Crown Fall weighs nothing and does not start');
  }
  // ---- the second pass: thrown pieces show the flare only (the owner, 2026-11-16): nothing drawn on
  // the ground where they will land, the flare on the flying piece flashLead before it lands. Every way
  // his effects draw on the ground ahead of a blow is counted while the move runs or its pieces fly
  const MARKED = ['warnRing', 'ringPulse', 'hazardFlash', 'shockRing'];
  const spy = (G) => {
    const fx = G.game.dragon.fx, rec = { n: 0, flares: [] }, saved = MARKED.map((k) => fx[k]);
    MARKED.forEach((k, i) => { if (typeof saved[i] === 'function') fx[k] = (...a) => { rec.n++; return saved[i].apply(fx, a); }; });
    const tf = fx.tellFlash;
    fx.tellFlash = (tell, x, y, z, k, flare) => { rec.flares.push({ tell, x, y, z, flare, t: G.game.time }); return tf.call(fx, tell, x, y, z, k, flare); };
    rec.off = () => { MARKED.forEach((k, i) => { fx[k] = saved[i]; }); fx.tellFlash = tf; };
    return rec;
  };
  for (const [name, form] of [['voidHurl', 1], ['glassRain', 3], ['plateHalo', 3]]) {
    const G = stage(form, 0, 4.5);
    const rec = spy(G);
    const D = G.game.world.destructibles;
    const air = [];
    play(G, name, () => { for (const b of D.list) if (b.state === STATE.FLYING && !air.includes(b)) air.push(b); });
    rec.off();
    // (each flare drawn where a piece was in the air, high off the floor: not where it lands)
    assert(rec.n === 0 && rec.flares.length >= 1 && rec.flares.every((f) => f.tell === TELL.RED && f.flare && f.y >= 0.4) && G.flashes.length === rec.flares.length, `${name}: nothing drawn on the ground where it lands (${rec.n}); ${rec.flares.length} red flare(s) drawn on the flying piece${rec.flares.length > 1 ? 's' : ''} (${rec.flares.map((f) => f.y.toFixed(1)).join(' / ')} m up)`);
  }
  // ---- Void Hurl is quicker: the tell to the blow (1.0 s windup, 0.8 - 1.1 s in the air)
  {
    const G = stage(1, 0, 4.5);
    const tells = [];
    const w = G.watch;
    G.watch = (n, e) => { w(n, e); if (n === 'combat:tell' && e?.attack === 'voidHurl' && !e.hazard) tells.push(G.game.time); };
    const h0 = G.hits.length;
    play(G, 'voidHurl');
    const hit = G.hits.slice(h0).find((h) => h.attack === 'voidHurl');
    assert(tells.length === 1 && hit && hit.t - tells[0] <= 2.15, `Void Hurl: ${(hit ? hit.t - tells[0] : NaN).toFixed(2)} s from his tell to the blow on a hero 8.5 m off (2.4 s before the second pass)`);
  }

  // ---- Rupture (form 2 on): the floor tears open in a line toward the hero
  {
    const G = stage(2, 0, 5, 0, -4);
    const d = G.game.dragon, D = G.game.world.destructibles;
    assert(d.weigh('plateRupture', MOVES.plateRupture, 1, 9) > 0, 'Rupture: on the crater\'s floor his AI may pick it (form 2)');
    let exp = 0;
    const ex0 = d.brain.expect;
    d.brain.expect = (...a) => { exp++; return ex0.apply(d.brain, a); };
    const thrown = [];
    const w = G.watch;
    G.watch = (n, e) => { w(n, e); if (n === 'world:impact' && e?.kind === 'throw' && e.by === 'boss') thrown.push(e.id); };
    const h0 = G.hits.length;
    const r = play(G, 'plateRupture');
    d.brain.expect = ex0;
    const hits = G.hits.slice(h0).filter((h) => h.attack === 'plateRupture');
    assert(r.ok && thrown.length >= 4 && !d.terrain.busy, `it tears ${thrown.length} plates up out of the floor along the line, one after another`);
    // (the plates race along the line 0.2 s apart: the flare of the one that struck is the one flashLead before it)
    const off = hits[0] ? Math.min(...G.flashes.map((t) => Math.abs(hits[0].t - t - TUNING.flashLead))) : NaN;
    assert(hits.length === 1 && hits[0].r === RESULT.HIT && hits[0].tell === TELL.RED && off < 0.06 && exp >= 1, `a hero who stands on the line is struck once (red), ${(off * 1000).toFixed(0)} ms off a flare + ${TUNING.flashLead} s (${G.flashes.length} flares for the plates that could reach him); told to the ledger (x${exp})`);
  }
  for (const [hx, hz, bx, bz] of [[0, 5, 0, -4], [6, 3, -2, -3], [-5, 8, 1, 0]]) {
    // off the line: he steps 3 m aside as the hand comes down; a roll at the flare
    for (const how of ['aside', 'roll']) {
      const G = stage(2, hx, hz, bx, bz);
      const d = G.game.dragon, p = G.game.player, inp = G.input;
      const h0 = G.hits.length;
      let done = false;
      const w = G.watch;
      let rollNow = false;
      G.watch = (n, e) => { w(n, e); if (how === 'roll' && n === 'combat:flash' && e?.attack === 'plateRupture') rollNow = true; };
      play(G, 'plateRupture', () => {
        // (the roll pressed on the frame after the flare's event, as a player's would be)
        if (rollNow) { rollNow = false; p.debug.god = false; const ax = hx - bx, az = hz - bz, l = Math.hypot(ax, az); inp.axis = { x: -az / l, y: -ax / l }; inp.tap('Space'); }
        if (how === 'aside' && !done && d.terrain.rupt.live) {
          done = true;
          const ax = hx - bx, az = hz - bz, l = Math.hypot(ax, az);
          p.debug.teleport(p.position.x - (az / l) * 3, p.position.z + (ax / l) * 3);
        }
      });
      inp.axis = { x: 0, y: 0 };
      const hits = G.hits.slice(h0).filter((h) => h.attack === 'plateRupture' && h.r === RESULT.HIT);
      assert(hits.length === 0, `Rupture at a hero at (${hx}, ${hz}), him at (${bx}, ${bz}): ${how === 'aside' ? 'a hero 3 m off the line' : 'a roll at the flare'} is not struck`);
    }
  }

  // ---- Falling Halo (forms 3 and 4): a ring of plates lifted round the hero, dropped on him in turn
  {
    const G = stage(3, 0, 4.5, 0, -4);
    const d = G.game.dragon;
    assert(d.weigh('plateHalo', MOVES.plateHalo, 1, 8.5) > 0, 'Falling Halo: his AI may pick it in form 3');
    const thrown = [];
    const w = G.watch;
    G.watch = (n, e) => { w(n, e); if (n === 'world:impact' && e?.kind === 'throw' && e.by === 'boss') thrown.push(G.game.time); };
    const h0 = G.hits.length;
    let ring = null, top = 0;
    const r = play(G, 'plateHalo', () => {
      const H = d.terrain.halo;
      if (H.live && !ring) ring = { cx: H.cx, cz: H.cz, n: H.n, away: Math.atan2(H.cx - d.position.x, H.cz - d.position.z), angs: H.p.slice(0, H.n).map((q) => Math.atan2(q.x0 - H.cx, q.z0 - H.cz)) };
      top = Math.max(top, ...r0(d));
    });
    function r0(dd) { return dd.terrain.halo.p.map((q) => (q.piece ? q.piece.py : 0)); }
    const hits = G.hits.slice(h0).filter((h) => h.attack === 'plateHalo');
    const gapFree = ring ? ring.angs.every((a) => Math.abs(Math.atan2(Math.sin(a - ring.away), Math.cos(a - ring.away))) > TUNING.terrain.halo.gapArc / 2 - 0.05) : false;
    assert(r.ok && ring && ring.n === 4 && thrown.length === 4 && top > 2.2 && G.flashes.length >= 1, `form 3: ${ring?.n} plates torn up round him, up to ${top.toFixed(1)} m, dropped in turn (${G.flashes.length} flares)`);
    assert(gapFree, 'the ring is open on the side away from the Lord (his way out)');
    assert(hits.length >= 1 && hits.every((h) => h.tell === TELL.RED), `a hero who stands is struck (${hits.length}, red)`);
  }
  for (const [hx, hz, bx, bz, form] of [[0, 4.5, 0, -4, 3], [5, 5, -1, -3, 4], [-6, 2, 1, -2, 4]]) {
    for (const how of ['roll', 'run']) {
      const G = stage(form, hx, hz, bx, bz);
      const d = G.game.dragon, p = G.game.player, inp = G.input;
      const h0 = G.hits.length;
      let t0 = -1;
      const w = G.watch;
      const log = [];
      G.watch = (n, e) => { w(n, e); if (n === 'combat:flash' && e?.attack === 'plateHalo') log.push(`F${G.game.time.toFixed(2)}@${p.position.x.toFixed(1)},${p.position.z.toFixed(1)}:${p.state}`); if (n === 'player:hurt') log.push(`H${G.game.time.toFixed(2)}`); if (how === 'roll' && n === 'combat:flash' && e?.attack === 'plateHalo') rollNow = true; };
      let rollNow = false;
      play(G, 'plateHalo', () => {
        if (rollNow) { rollNow = false; p.debug.god = false; const ax = p.position.x - bx, az = p.position.z - bz, l = Math.hypot(ax, az) || 1; inp.axis = { x: ax / l, y: -az / l }; inp.tap('Space'); }
        if (t0 < 0 && d.terrain.halo.live) t0 = G.game.time;
        // run: out through the opening (away from him) a quarter second after the plates start to rise
        if (how === 'run' && t0 >= 0 && G.game.time - t0 > 0.25) { const ax = hx - bx, az = hz - bz, l = Math.hypot(ax, az); inp.axis = { x: ax / l, y: -az / l }; }
      });
      inp.axis = { x: 0, y: 0 };
      const hits = G.hits.slice(h0).filter((h) => h.attack === 'plateHalo' && h.r === RESULT.HIT);
      assert(hits.length === 0, `Falling Halo (form ${form}) round a hero at (${hx}, ${hz}): ${how === 'roll' ? 'a roll at each flare' : 'running out through the opening as it rises'} is not struck (${hits.length})`);
      if (hits.length && process.env.GCD_TDBG) out('       ', log.join(' '), 'hits', hits.map((h) => h.t.toFixed(2)).join(' '), 'ring', d.terrain.halo.cx.toFixed(1), d.terrain.halo.cz.toFixed(1));
    }
  }

  // ---- his AI uses them in a fight, and nothing breaks
  {
    const G = stage(3, 0, 5);
    const d = G.game.dragon;
    d.debug.setAI(true);
    const used = {};
    let moves = 0;
    const w = G.watch;
    G.watch = (n, e) => { w(n, e); if (n === 'dragon:windup' && e?.name) { moves++; if (MOVES[e.name]?.terrain) used[e.name] = (used[e.name] || 0) + 1; } };
    run(G, 90, () => { if (Math.hypot(G.game.player.position.x, G.game.player.position.z) > 9) G.game.player.debug.teleport(0, 5); });
    const n = Object.values(used).reduce((a, b) => a + b, 0);
    assert(moves >= 20 && n >= 2 && n <= moves * 0.4, `90 s of form 3 with the AI on: ${moves} moves, ${n} of them on the crater's pieces (${Object.entries(used).map(([k, v]) => `${k} ${v}`).join(', ')})`);
    if (G.payload.size) assert(false, `finite event payloads (${[...G.payload].join(', ')})`);
  }
  // ---- every answer works, standing still does not: a roll at the glint (or as the ring appears),
  // running out of the ring a quarter second after it appears, running one way the whole time
  const rows = terrainAnswers();
  for (const r of rows) out(`     ${r.name}: ` + Object.entries(r).filter(([k]) => k !== 'name').map(([k, v]) => `${k} ${v}`).join(' · '));
  assert(rows.every((r) => r.stand >= 1), 'a hero who stands still is hit by each of them');
  assert(rows.every((r) => Object.entries(r).every(([k, v]) => k === 'name' || k === 'stand' || v === 0)), 'and escapes each of them with any answer: roll, run out of the ring or strip, keep running');
}

/** The terrain moves against heroes who answer them (scenario TERRAIN): hits taken per answer. */
function terrainAnswers() {
  /** answer: 'stand' | 'roll' (at the glint) | 'run' (out of the ring when it appears, after `react` s) |
   *  'line' (running east the whole time) | 'rollRing' (a roll away from the ring when it appears) */
  const trial = (move, form, hx, hz, bx, bz, answer, react = 0.25) => {
    const G = build(SEED, true);
    duel(G, { dist: 8, form });
    const d = G.game.dragon, p = G.game.player, inp = G.input;
    p.debug.god = true;
    d.position.set(bx, 0, bz);
    p.debug.teleport(hx, hz);
    d.yaw = Math.atan2(hx - bx, hz - bz);
    run(G, 0.2);
    const h0 = G.hits.length;
    let ringT = -1, ringX = 0, ringZ = 0, glints = 0, rolled = 0;
    const seenMarks = new Set();
    let wantRoll = false;
    G.watch = (n, e) => {
      if (n === 'combat:flash' && e?.source === 'dragon' && e.hazard && answer === 'roll') { glints++; wantRoll = true; }
    };
    let T0 = G.game.time;
    if (!d.debug.trigger(move)) return { ok: false };
    T0 = G.game.time;
    run(G, 8, () => {
      const t = G.game.time;
      if (wantRoll) {
        // (a roll away from the ring, sideways when he stands at its centre; a tap with no direction is a backstep)
        const m = d.terrain.marks.find((k) => k.alive && k.flashed) ?? { x: p.position.x - 1, z: p.position.z };
        const ex = p.position.x - m.x, ez = p.position.z - m.z, el = Math.hypot(ex, ez);
        inp.axis = el < 0.05 ? { x: 1, y: 0 } : { x: ex / el, y: -ez / el };
        wantRoll = false;
        inp.tap('Space');
        rolled++;
      }
      // a new ring
      for (const m of d.terrain.marks) {
        if (m.alive && !seenMarks.has(m) ) { seenMarks.add(m); m._seenAt = t; ringT = t; ringX = m.x; ringZ = m.z; }
        if (!m.alive) seenMarks.delete(m);
      }
      if (answer === 'line') inp.axis = { x: 1, y: 0 };
      else if ((answer === 'run' || answer === 'rollRing') && ringT >= 0 && t - ringT >= react) {
        const dx = p.position.x - ringX, dz = p.position.z - ringZ, l = Math.hypot(dx, dz);
        const ax = l < 0.05 ? 1 : dx / l, az = l < 0.05 ? 0 : dz / l;
        inp.axis = { x: ax, y: -az };
        if (answer === 'rollRing' && t - ringT < react + 0.02) { inp.tap('Space'); rolled++; }
      }
    }, () => G.game.time - T0 > 1 && d.mode === 'foot' && !d.terrain.busy && !G.game.world.destructibles.active.some((b) => b.state === STATE.FALLING || b.state === STATE.FLYING));
    inp.axis = { x: 0, y: 0 };
    const hits = G.hits.slice(h0).filter((h) => h.attack === move || h.attack === 'fallingDebris');
    return { ok: true, hits: hits.filter((h) => h.r === RESULT.HIT).length, rolled };
  };
  const rows = [];
  for (const [move, form, hx, hz, bx, bz] of [['voidHurl', 1, 0, 4.5, 0, -4], ['voidHurl', 1, 0, 2, 0, -2], ['voidHurl', 1, 4, 8, -2, -6], ['glassRain', 3, 0, 4.5, 0, -4], ['glassRain', 3, 0, 8, 0, -6]]) {
    const r = {};
    for (const a of ['stand', 'roll', 'run', 'rollRing', 'line']) r[a] = trial(move, form, hx, hz, bx, bz, a).hits;
    rows.push({ name: `${move} hero (${hx}, ${hz}) lord (${bx}, ${bz})`, ...r });
  }
  // Crown Fall: stand / run sideways out of the strip when the fall starts
  {
    const r = {};
    for (const a of ['stand', 'roll', 'run']) {
      const G = build(SEED, true);
      duel(G, { dist: 8, form: 2 });
      const d = G.game.dragon, p = G.game.player, inp = G.input;
      p.debug.god = true;
      d.position.set(2, 0, -2);
      p.debug.teleport(8.6, 4.4);
      run(G, 0.2);
      const h0 = G.hits.length;
      let tellT = -1, dirx = 0, dirz = 0;
      G.watch = (n, e) => {
        if (n === 'combat:tell' && e?.source === 'world' && tellT < 0) { tellT = G.game.time; const F = d.terrain; dirx = -F.fall.dz || 1; dirz = F.fall.dx || 0; }
        if (n === 'combat:flash' && e?.source === 'world' && a === 'roll') G._rollNow = true;
      };
      d.debug.trigger('crownFall');
      const T0 = G.game.time;
      let fdx = 0, fdz = 0;
      const F0 = { ...d.terrain.fall };
      run(G, 6, () => {
        if (d.terrain.fall.piece) { fdx = d.terrain.fall.dx; fdz = d.terrain.fall.dz; }
        if (a === 'run' && tellT >= 0 && G.game.time - tellT > 0.25) inp.axis = { x: -F0.dz, y: -F0.dx };
        if (G._rollNow) { G._rollNow = false; inp.axis = { x: -F0.dz, y: -F0.dx }; inp.tap('Space'); }
      }, () => G.game.time - T0 > 1 && d.mode === 'foot' && !G.game.world.destructibles.active.some((b) => b.state === STATE.FALLING));
      inp.axis = { x: 0, y: 0 };
      r[a] = G.hits.slice(h0).filter((h) => h.r === RESULT.HIT).length;
    }
    rows.push({ name: 'crownFall hero beside a 3.6 m shard', ...r });
  }
  return rows;
}

// ================================================================== scenario: flare (ADR-118)
// His moments: the flare is the only sign; Severance parried is countered; Nightfall (the charged
// blow) on a held guard; every form has the three new moves.
// GCD_FX=a,b,... runs only those parts of FXLOOKS (tests/run.mjs runs them as processes of their
// own: the scenario is the longest task of the suite): a switch's name (every option of it through
// the moves it draws), spy (main's look at '0', the picks with nothing set), fight-before /
// fight-shipped (fight: both; 60 s of form 4 with the AI on), same (SPELLS + TERRAIN print the same under every
// look; same-spells / same-terrain: one of the two; same-terrain@a, @b, @ship: TERRAIN under '0' and
// that one look). Unset: all of them. `!part` leaves a part out of the rest (run.mjs's main fxlooks
// task: `!same-terrain@a,...`, so a new part lands there by itself). The check of the defaults at the
// top runs in every part.
const FX_LIST = (process.env.GCD_FX ?? '').split(',').filter(Boolean);
const FX_ONLY = new Set(FX_LIST.filter((k) => !k.startsWith('!')));
const FX_NOT = new Set(FX_LIST.filter((k) => k.startsWith('!')).map((k) => k.slice(1)));
// a part, named from the widest to the narrowest (same, same-terrain, same-terrain@a): picked when any
// of its names is asked for (or nothing is), left out when any is excluded
const fxPart = (...keys) => (!FX_ONLY.size || keys.some((k) => FX_ONLY.has(k))) && !keys.some((k) => FX_NOT.has(k));
async function scenarioFxlooks() {
  out('\n== scenario FXLOOKS (his look options: ?star= ?sky= ?ignite= ?void= ?presence=; every option runs, its peak, and no look moves the game; the picks as the defaults) ==');
  const { setLook, lookOf, PICKED } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const { LORD_LOOKS } = await imp('src/entities/enemies/starlessLord/fx.js');
  const NAMES = Object.keys(LORD_LOOKS);
  const OPTS = { star: ['0', 'a', 'b'], sky: ['0', 'a', 'b'], ignite: ['0', 'a', 'b'], void: ['0', 'a'], presence: ['0', 'a'] };
  // (forced together with his: the crescents' qi (fxash's, drawn by him too) and his body (read when his rig is built))
  const force = (o) => { for (const n of [...NAMES, 'qi', 'lordLook']) setLook(n, o?.[n] ?? null); };
  // the crater as it was before this pass (what main drew): every redraw '0'
  const BEFORE = { star: '0', sky: '0', ignite: '0', void: '0', presence: '0', qi: '0', lordLook: '0' };
  force({});
  // LORD_LOOKS is each call site's `def` ('0': a redraw, what main drew; presence is new); with nothing
  // set every one draws the owner's pick (lookSwitch PICKED, 2026-11-16)
  const now = Object.fromEntries(NAMES.map((n) => [n, lookOf(n, LORD_LOOKS[n])]));
  assert(NAMES.every((n) => OPTS[n] && OPTS[n].includes(PICKED[n])) && LORD_LOOKS.star === '0' && LORD_LOOKS.sky === '0' && LORD_LOOKS.ignite === '0' && LORD_LOOKS.void === '0' && LORD_LOOKS.presence === 'a' && NAMES.every((n) => now[n] === PICKED[n]) && lookOf('lordLook', '0', 'b') === PICKED.lordLook,
    `the switches, their call sites' defaults ${JSON.stringify(LORD_LOOKS)} (a redraw: '0'), and what is drawn with nothing set: the picks ${JSON.stringify(now)}, body ${lookOf('lordLook', '0', 'b')}`);
  // 1. every option of every switch, through the moves it draws, for their whole life: no throw, no
  //    NaN (the pools and G.tick throw on one), the fire field's and the additive pool's peaks
  //    (caps: the measured peaks, 2026-11-16, with room; the field holds 6000, the pool 7000)
  const CASES = {
    star: [[4, 'star', 3.4]],
    sky: [[4, 'storm', 5]],
    void: [[4, 'tide', 3], [1, 'voidPush', 2.5], [3, 'rift', 2.5], [2, 'glaive', 4.5], [3, 'debris', 3.5], [1, 'grip', 3], [1, 'grasp', 3], [1, 'voidBolt', 2.5], [4, 'rend', 3], [4, 'storm', 5], [4, 'star', 3.4]],
    presence: [[2, 'tempest', 4], [3, 'cyclone', 4]],
  };
  const CAP = { star: 2600, sky: 2600, ignite: 3600, void: 3200, presence: 1600 };
  // the shipped option (the owner's pick) under its own cap: re-measured 2026-11-16 on the picks,
  // star a 544, sky a 1211, ignite a 1504, void a 1211, presence a 952; about 1.5x each
  const CAP_SHIPPED = { star: 900, sky: 1900, ignite: 2300, void: 1900, presence: 1450 };
  const peaks = {};
  for (const name of NAMES.filter((n) => fxPart(n))) {
    for (const opt of OPTS[name]) {
      force({ [name]: opt });
      let fire = 0, add = 0, ok = true;
      try {
        if (name === 'ignite') {
          for (const f of [2, 3, 4]) {
            const G = build();
            duel(G, { dist: 3, form: f - 1 });
            const d = G.game.dragon;
            G.game.player.debug.god = true;
            d.debug.postureBreak();
            run(G, 0.1);
            d.onExecute({});
            run(G, 4.2, () => { fire = Math.max(fire, G.game.fx.fire.count); add = Math.max(add, G.game.fx.add.count); });
            ok &&= d.phase === f && d.lit > 0.9;
          }
          // and his death (?void= draws it; here: the fourth deathblow in every ignite option too)
          const G = build();
          duel(G, { dist: 3, form: 4 });
          G.game.dragon.debug.postureBreak();
          run(G, 0.1);
          G.game.dragon.onExecute({});
          run(G, 3, () => { fire = Math.max(fire, G.game.fx.fire.count); });
        } else {
          for (const [f, mv, secs] of CASES[name]) {
            const G = build();
            duel(G, { dist: mv === 'storm' || mv === 'star' ? 3 : 6, form: f });
            G.game.player.debug.god = true;
            ok &&= G.game.dragon.debug.trigger(mv) !== false;
            run(G, secs, () => { fire = Math.max(fire, G.game.fx.fire.count); add = Math.max(add, G.game.fx.add.count); });
          }
          if (name === 'void') {
            const G = build();
            duel(G, { dist: 3, form: 4 });
            G.game.dragon.debug.postureBreak();
            run(G, 0.1);
            G.game.dragon.onExecute({});
            run(G, 3.5, () => { fire = Math.max(fire, G.game.fx.fire.count); add = Math.max(add, G.game.fx.add.count); });
            ok &&= G.game.dragon.mode === 'dying' || G.game.dragon.mode === 'dead';
          }
        }
      } catch (e) {
        ok = false;
        out('   ', String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
      }
      peaks[`${name}=${opt}`] = fire;
      const cap = opt === PICKED[name] ? CAP_SHIPPED[name] : CAP[name];
      assert(ok && fire < cap && add < 6500, `?${name}=${opt}${opt === PICKED[name] ? ' (shipped)' : ''}: runs its whole life clean; peaks: fire field ${fire} blobs (cap ${cap}), additive glyphs ${add}`);
    }
  }
  // 2. '0' (?looks=old) draws what main drew: today's functions run, the redraws do not; with nothing
  //    set the picks are drawn: the redraws run, today's functions do not (spied on one LordFx)
  const spy = (o) => {
    force(o);
    const G = build();
    duel(G, { dist: 3, form: 4 });
    G.game.player.debug.god = true;
    const fx = G.game.dragon.fx, calls = {};
    for (const k of ['_drawStar', '_drawStarA', '_drawMark', '_drawMarkA', '_starBurst', '_starBurstA', '_strikeA', '_drawCrescentA', '_bladeField', 'gather', '_igniteA']) {
      const f = fx[k];
      fx[k] = function (...a) { calls[k] = (calls[k] || 0) + 1; return f.apply(this, a); };
    }
    G.game.dragon.debug.trigger('star');
    run(G, 3.4);
    G.game.dragon.debug.trigger('storm');
    run(G, 5);
    G.game.dragon.debug.trigger('tide');
    run(G, 2);
    return calls;
  };
  if (fxPart('spy')) {
    const calls = spy(BEFORE);
    const today = calls._drawStar > 0 && calls._starBurst === 1 && calls._drawMark > 0;
    const none = !calls._drawStarA && !calls._drawMarkA && !calls._starBurstA && !calls._strikeA && !calls._drawCrescentA && !calls._bladeField && !calls.gather && !calls._igniteA;
    assert(today && none, `every look at '0' (?looks=old): main's look is drawn (star ${calls._drawStar} frames + its burst, the sky's marks ${calls._drawMark}) and none of the redraws (${JSON.stringify(calls)})`);
    const ship = spy({});
    const picks = ship._drawStarA > 0 && ship._starBurstA === 1 && ship._drawMarkA > 0 && ship._strikeA > 0 && ship._drawCrescentA > 0 && ship._bladeField > 0;
    const old = !ship._drawStar && !ship._drawMark && !ship._starBurst;
    assert(picks && old, `with nothing set the picks are drawn (the starless sun ${ship._drawStarA} frames + its burst, the sky's marks ${ship._drawMarkA}, ${ship._strikeA} strikes, crescents, blades of light) and none of main's star / marks (${JSON.stringify(ship)})`);
  }
  // 2b. a form-4 fight with the AI on, every look before this pass and as shipped: the fire field's
  //     and the additive pool's peaks (the room the fourth form's weather has to work in)
  for (const lk of ['before', 'shipped'].filter((k) => fxPart('fight', `fight-${k}`))) {
    force(lk === 'before' ? BEFORE : {});
    const G = build();
    duel(G, { dist: 3, ai: true, form: 4 });
    G.game.player.debug.god = true;
    let fire = 0, add = 0, sum = 0, n = 0;
    run(G, 60, () => { const c = G.game.fx.fire.count; fire = Math.max(fire, c); sum += c; n++; add = Math.max(add, G.game.fx.add.count); });
    // (caps re-measured 2026-11-16: shipped 2292 (mean 337), before 3631 - 4303 (seed stream); the
    // shipped cap 3400 = about 1.5x its measurement, the old looks keep 5000)
    const cap = lk === 'before' ? 5000 : 3400;
    assert(fire < cap && add < 6500, `60 s of form 4, AI on, every look ${lk === 'before' ? 'as before this pass' : 'as shipped (the picks)'}: the fire field peaks at ${fire} < ${cap} of 6000 blobs (mean ${(sum / Math.max(1, n)).toFixed(0)}), the additive pool at ${add} of 7000`);
  }
  force({});
  // 3. no look moves the game: the SPELLS and TERRAIN scenarios print the same numbers (every
  //    damage, distance and count) with every look at '0', at 'a', and at 'b' where there is one
  let SAME = [];
  const capture = async (o) => {
    force(o);
    const w = process.stdout.write.bind(process.stdout), f0 = fails;
    let text = '';
    process.stdout.write = (s) => { text += s; return true; };
    try {
      for (const sc of SAME) await sc();
    } finally {
      process.stdout.write = w;
    }
    const f = fails - f0;
    fails = f0;
    return { text, f };
  };
  // (each scenario is compared on its own, and each look against '0' on its own, so tests/run.mjs can
  // run them as processes of their own: `same-spells`, `same-terrain@a` ...; `same`: all of them)
  const LOOKS = {
    a: { ...Object.fromEntries(NAMES.map((n) => [n, 'a'])), qi: 'b', lordLook: 'c' },
    b: { star: 'b', sky: 'b', ignite: 'b', void: 'a', presence: 'a', qi: 'c', lordLook: 'a' },
    ship: {},
  };
  // (SPELLS presses a plain parry on purpose: it replays here with ?parry=two, as its own entry does; ADR-279)
  const RULES1 = await imp('src/combat/rules.js');
  const spellsTwo = async () => {
    const m0 = RULES1.PARRY_KIND.mode;
    RULES1.setParryKind('two');
    try {
      return await scenarioSpells();
    } finally {
      RULES1.setParryKind(m0);
    }
  };
  for (const [key, title, fn] of [['spells', 'SPELLS', spellsTwo], ['terrain', 'TERRAIN', scenarioTerrain]]) {
    const looks = Object.keys(LOOKS).filter((l) => fxPart('same', `same-${key}`, `same-${key}@${l}`));
    if (!looks.length) continue;
    SAME = [fn];
    const base = await capture(BEFORE);
    const diff = (x) => {
      const A = base.text.split('\n'), B = x.text.split('\n');
      const i = A.findIndex((l, k) => l !== B[k]);
      return i < 0 ? 'same' : `first difference: "${A[i]}" / "${B[i]}"`;
    };
    const got = looks.map((l) => [l, null]);
    for (const g of got) g[1] = await capture(LOOKS[g[0]]);
    assert(base.text.length > 500 && got.every(([, x]) => x.text === base.text), `${title} prints the same before this pass ('0') as under ${looks.map((l) => (l === 'ship' ? 'the shipped looks' : `every look at '${l}'`)).join(', ')} (his body and the qi too) (${base.text.split('\n').length} lines; ${got.map(([l, x]) => `${l}: ${diff(x)}`).join('; ')})`);
    assert(base.f === 0 && got.every(([, x]) => x.f === 0), `and it passes under every one (${[base, ...got.map(([, x]) => x)].map((x) => x.f).join(' / ')} failed)`);
  }
  force({});
  out(`    fire field peaks: ${JSON.stringify(peaks)}`);
}

async function scenarioFlare() {
  out('\n== scenario FLARE (his moments: the flare alone, the counter, the charged blow; every form) ==');
  const { DEFENSE, GUARD } = await imp('src/combat/rules.js');
  const flat = (n) => MOVES[n].beats.flatMap((b) => (Array.isArray(b.pick) ? b.pick : [b]));
  const inForm = (n, f) => (Array.isArray(MOVES[n].weight) ? MOVES[n].weight[f - 1] : MOVES[n].weight) > 0 && MOVES[n].phase <= f;
  for (const f of [1, 2, 3, 4]) {
    const parry = MOVE_NAMES.filter((n) => inForm(n, f) && flat(n).some((b) => b.flare && b.tell === TELL.BLUE));
    const black = MOVE_NAMES.filter((n) => inForm(n, f) && flat(n).some((b) => b.tell === TELL.BLACK));
    const red = MOVE_NAMES.filter((n) => inForm(n, f) && flat(n).some((b) => b.tell === TELL.RED && b.zone && !b.cast));
    assert(parry.includes('severance') && black.length === 1 && black[0] === 'nightfall' && red.includes('meridian'), `form ${f}: parry moments ${parry.join(', ')}; charged ${black.join(', ')}; ${red.length} moves with a red blow of his own`);
  }
  const G = build();
  duel(G, { dist: 3.0 });
  const { game, input } = G;
  const d = game.dragon, p = game.player;
  const play = (name, dist, act = null, max = 6) => {
    settle(G);
    d.position.set(0, 0, -2);
    d.yaw = 0;
    place(G, dist);
    run(G, 0.3);
    p.guard = p.maxGuard;
    p.streak = 0;
    const ev = [];
    let flashT = null, warnPre = 0, rings = 0, charges = 0;
    const fx = d.fx, wr = fx.warnRing, ch = fx.charge;
    fx.warnRing = (...a) => { rings++; return wr.apply(fx, a); };
    fx.charge = (...a) => { charges++; return ch.apply(fx, a); };
    const h0 = G.hits.length, hp0 = p.hp;
    G.watch = (n, e) => { ev.push([n, e ? { ...e } : e]); if (n === 'combat:flash' && e?.attack === name && flashT === null) flashT = game.time; };
    d.debug.trigger(name);
    run(G, max, () => {
      game.mouseGround.set(d.position.x, 0, d.position.z);
      if (flashT === null && d.mode === 'act') warnPre = Math.max(warnPre, d.warn);
      act?.(flashT);
    }, () => flashT !== null && game.time > flashT + 1.6 && p.state !== 'flurry' && game.hitstopTimer <= 0);
    G.watch = null;
    fx.warnRing = wr;
    fx.charge = ch;
    input.up(1);
    return { ev, flashT, warnPre, rings, charges, hits: G.hits.slice(h0), lost: hp0 - p.hp, has: (n) => ev.some((x) => x[0] === n), get: (n) => ev.find((x) => x[0] === n)?.[1], all: (n) => ev.filter((x) => x[0] === n).map((x) => x[1]) };
  };
  const at = (fT, lead) => fT !== null && game.time >= fT + meleeLead() - lead - DT;
  // Red Meridian: two red blows, nothing on the floor, nothing on him before the cue
  p.debug.god = true;
  const mer = play('meridian', 3.0);
  p.debug.god = false;
  const mf = mer.all('combat:flash').filter((e) => e.attack === 'meridian');
  assert(mf.length === 2 && mf.every((e) => e.tell === TELL.RED && e.flare === true) && mer.rings === 0 && mer.warnPre === 0, `Red Meridian: two red flares (${mf.length}), no ring on the floor (${mer.rings}), no glow before the first cue (${mer.warnPre.toFixed(2)})`);
  // Severance parried: the counter
  let pressed = false;
  // a plain parry: Severance is also a `lock` blow, and a perfect parry of it locks the blades first
  // (the press PLAIN_LEAD before the blow's own impact: the glint's lead is the fast pace's 0.26 s or the
  // readable pace's 0.35 s, ADR-251, and the realised beat knows which)
  const sev = play('severance', 5.0, (fT) => {
    const A = d.brain.act, b = A?.name === 'severance' ? A.beats.find((x) => !x.feint && x.impact > A.t - 1e-6) : null;
    if (!pressed && fT !== null && b && b.impact - A.t <= PLAIN_LEAD + DT) { pressed = true; input.up(1); input.click(1); }
  });
  // (the answer to a blue flare parried: the counter cut, or, in the default deathblow mode, the combo that replaces it)
  const dbEnd = sev.get('player:flurryEnd')?.art === 'deathblow' ? sev.get('player:flurryEnd') : null;
  const cnt = sev.get('player:flareCounter') ?? (dbEnd ? { damage: dbEnd.damage, strikes: dbEnd.strikes } : null);
  assert(sev.get('combat:flash')?.flare === true && sev.get('player:parry')?.flare === true && sev.get('dragon:parried')?.last === true && !!cnt && cnt.damage > 0 && sev.lost === 0,
    `Severance (a blue flare) parried: his move ends and the hero counters (${cnt?.strikes} blow(s), the last ${cnt?.damage?.toFixed(0)}; DEFENSE.flareCounter ${DEFENSE.flareCounter.damage} before his posture rule)`);
  // Nightfall on a held guard: the meter gone, no damage; unanswered it lands
  let g0 = null;
  const night = play('nightfall', 3.0, () => { input.press(1); if (g0 === null && G.hits.some((h) => h.attack === 'nightfall')) g0 = p.guard; });
  const nh = night.hits.find((h) => h.attack === 'nightfall');
  assert(night.get('combat:tell')?.tell === TELL.BLACK && night.has('combat:charge') && night.charges > 20 && night.warnPre > 0.5, `Nightfall: tell black, the charge drawn through its windup (${night.charges} frames), his body darkening (${night.warnPre.toFixed(2)})`);
  assert(nh?.r === RESULT.BLOCKED && night.lost === 0 && g0 === 0 && night.get('player:guardOpen')?.black === true && Math.abs(p.staggerLen - GUARD.black.openDur) < 1e-6, `on a held guard it is stopped (${nh?.r}), no HP lost, the guard meter gone (${g0}) and the guard knocked open`);
  const bare = play('nightfall', 3.0);
  assert(bare.hits.find((h) => h.attack === 'nightfall')?.r === RESULT.HIT && bare.lost > 25, `unanswered it lands: ${bare.lost.toFixed(0)} HP`);
  return G;
}

// ================================================================== scenario: pace (the director's meter)
// A god-mode defender that never attacks, driven by combat:flash (his thrown things send no tell):
// the guard held through a normal / blue blow, a roll 0.28 s before a red / black one (out of a
// hazard's ring: away from its centre). The hero roams between standoffs (2.5 / 5 / 9 m, a new one
// every 4 s), in the REAL crater (the terrain moves are in). Per seed and per form (all four), GCD_PSECS s each (default 120), seeds GCD_PSEEDS (default 4242,7,99): cues a
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
            // (a roll keeps him in the crater, as a player keeps to the arena: a roll that would end
            // past the boss's floor (12 m round the seal, or north of the dais's edge) goes the other
            // way across. The tuning pass, 2026-11-16: the hero used to roll out behind the throne,
            // where nothing of his reaches (up to a fifth of form 4 spent there))
            let wx = e.hazard ? dx / l : -dz / l, wz = e.hazard ? dz / l : dx / l;
            const out = (ax, az) => Math.hypot(p.x + ax * 3, p.z + az * 3) > 12 || p.z + az * 3 < -9.5;
            if (out(wx, wz)) {
              const k = (-p.x * -wz + -p.z * wx) >= 0 ? 1 : -1;
              const sx = -wz * k, sz = wx * k;
              if (!out(sx, sz)) { wx = sx; wz = sz; } else if (!out(-wx, -wz)) { wx = -wx; wz = -wz; }
            }
            input.axis = { x: wx, y: -wz };
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
  out('\n== scenario PACE (a steady defender in god mode vs his AI, per form: cues, gaps, mix, chains, conflicts) ==');
  const DIR = await imp('src/entities/enemies/duelist/director.js');
  const P = TUNING.pressure ?? null;
  const SECS = Number(process.env.GCD_PSECS ?? 120);
  const SEEDS = (process.env.GCD_PSEEDS ?? '4242,7,99').split(',').map(Number).filter(Number.isFinite);
  const pp = (v, ph) => (Array.isArray(v) ? v[Math.min(v.length, Math.max(1, ph)) - 1] : v);
  // his flurry is as long as its count (until the second pass the realise wrapper dropped `opts`:
  // every flurry was the authored four blows, whatever DEFENSE.foeStreak counted)
  {
    const A = realise(STREAKS[0], 1, mulberry32(1), { count: 6 });
    const G = build();
    duel(G, { dist: 2.5, ai: false });
    let cnt = null;
    G.watch = (n, e) => { if (n === 'dragon:flurry') cnt = e.count; };
    G.game.dragon.brain.startStreak(6);
    G.watch = null;
    assert(A?.hits === 6 && cnt === 6, `his flurry is as long as its count: realise with count 6 → ${A?.hits} blows, startStreak(6) → dragon:flurry count ${cnt}`);
  }
  const CATS = DIR.CATEGORIES;
  const answer = (tell) => (tell === TELL.RED || tell === TELL.BLACK ? 'dodge' : 'guard');
  const skip = (name) => !MOVES[name] || MOVES[name].transition || MOVES[name].counter;
  const rows = [];
  let lastG = null, NPH = 0;
  // (GCD_PFORMS=3 or 2,3: only those forms, measured, nothing asserted)
  const ONLY = process.env.GCD_PFORMS ? process.env.GCD_PFORMS.split(',').map(Number) : null;
  for (const seed of SEEDS) {
    for (let ph = 1; ; ph++) {
      if (ONLY && ph <= TUNING.forms && !ONLY.includes(ph)) continue;
      const G = (lastG = build(seed, true));
      const { game } = G;
      const d = game.dragon, p = game.player;
      NPH = TUNING.forms;
      if (ph > NPH) break;
      duel(G, { dist: 3, ai: true, form: ph });
      p.debug.god = true;
      p.debug.noRiposte = true;
      G.defend = paceDefender(G);
      Math.random = mulberry32(seed * 7 + ph);
      const flashes = [], acts = [], cats = {}, busyT = [];
      const modeT = {}, spent = {};
      let hurt = 0, frames = 0, busy = 0, chained = 0, chainLen = 0, chainMax = 0, prevAct = null, prevMode = d.mode;
      const s0 = { ...(d.brain.stats ?? {}) };
      const dbg = [];
      G.watch = (n, e) => {
        if (process.env.GCD_PDBG && /dragon:windup|combat:flash|combat:tell|dragon:parried|dragon:guard/.test(n)) dbg.push([game.time, `${n.split(':')[1]} ${e?.name ?? e?.attack ?? ''} ${e?.tell ?? ''}${n === 'combat:tell' ? ` in ${e.impactIn?.toFixed(2)}` : ''} [${d.mode} ${d.brain.act?.name ?? ''} h${d.brain.stats?.holds} d${d.brain.stats?.delays}]`]);
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
          const k = Math.hypot(gx, gz) > 12 ? 12 / Math.hypot(gx, gz) : 1;
          const dx = gx * k - p.position.x, dz = Math.max(-9.5, gz * k) - p.position.z, l = Math.hypot(dx, dz);
          G.input.axis = l > 0.6 ? { x: dx / l, y: -dz / l } : { x: 0, y: 0 };
        }
        game.mouseGround.set(d.position.x, 0, d.position.z);
        G.tick(DT);
        if (d.brain.pendingPhase > ph) d.brain.pendingPhase = 0;
        frames++;
        if (process.env.GCD_PFOOT && ph === 4 && d.mode === 'foot' && frames % 60 === 0 && Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z) > 15) out(`      far ${(game.time - t0).toFixed(1)} boss ${d.position.x.toFixed(1)},${d.position.z.toFixed(1)} hero ${p.position.x.toFixed(1)},${p.position.z.toFixed(1)} ${p.state} vel ${d.groundVel?.x?.toFixed?.(1)} ${d.state ?? ''} ${d.brain.seek ? 'seek' : ''}`);
        { const k = d.mode === 'react' ? `react:${d.brain.react?.kind}` : d.mode === 'act' ? (d.brain.act && d.brain.act.t >= d.brain.act.recoveryStart ? 'act:recovery' : 'act') : d.mode === 'foot' ? (Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z) > TUNING.move.band[1] + 0.3 ? `foot:closing${process.env.GCD_PFOOT ? `:${d.spells?.nightLive ? 'night' : d.brain.gapT > 0 ? 'gap' : 'none'}:${Math.min(16, Math.floor(Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z) / 4) * 4)}m` : ''}` : 'foot') : d.mode; modeT[k] = (modeT[k] || 0) + game.dt; if (d.mode === 'act' && d.brain.act) spent[d.brain.act.name] = (spent[d.brain.act.name] || 0) + game.dt; }
        // chained: a move that starts straight out of another (no footwork, no reaction between)
        const a = d.brain.act;
        if (d.mode === 'act' && a && a !== prevAct && !a.def.transition && !a.def.counter) {
          if (prevMode === 'act' && prevAct) { chained++; chainLen++; chainMax = Math.max(chainMax, chainLen); } else chainLen = 0;
        }
        if (d.mode !== 'act') chainLen = 0;
        prevAct = d.mode === 'act' ? a : null;
        prevMode = d.mode;
        if (d.fx.crescentsAlive || d.fx.shotsAlive || d.fx.strikesAlive || d.terrain?.busy || d._storm?.left > 0) busy++;
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
            if (process.env.GCD_PDBG) out(`      CONFLICT F${ph} ${(flashes[i][0] - t0).toFixed(2)}: ${dbg.filter((x) => x[0] > flashes[i][0] - 2.5 && x[0] < flashes[j][0] + 0.4).map((x) => `${(x[0] - t0).toFixed(2)} ${x[1]}`).join(' | ')}`);
          }
        }
      }
      const st = d.brain.stats ?? {};
      const dlt = (k) => (st[k] ?? 0) - (s0[k] ?? 0);
      const dodgeCues = flashes.filter((f) => answer(f[1]) === 'dodge').length;
      rows.push({ seed, ph, T, cues: flashes.length, dodge: dodgeCues / (flashes.length || 1), perMin: (flashes.length * 60) / T, gapMax, gapAt, cats, picks: acts.length, chained, chainMax, conflicts, conflictAt, inner, innerAt: [...innerAt], busy: busy / frames, holds: dlt('holds'), feints: dlt('feints'), told: dlt('toldFeints'), delays: dlt('delays'), links: dlt('links'), cuts: dlt('cuts'), rests: dlt('rests'), hurt, modeT });
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
    out(`         time: ${Object.entries(r.modeT).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${((v * 100) / r.T).toFixed(0)}%`).join(' · ')}`);
    out(`         longest gap at ${r.gapAt}${r.conflicts ? ` · CONFLICTS ${r.conflictAt.slice(0, 6).join(' · ')}` : ''}${r.inner ? ` · inner: ${r.innerAt.join(', ')}` : ''}`);
  }
  const mean = (ph, k) => { const rs = rows.filter((r) => r.ph === ph); return rs.reduce((a, r) => a + r[k], 0) / (rs.length || 1); };
  for (let ph = 1; ph <= NPH; ph++) out(`   mean P${ph}: ${mean(ph, 'perMin').toFixed(1)} cues/min (${(mean(ph, 'perMin') * (1 - mean(ph, 'dodge'))).toFixed(1)} to guard or parry, ${(mean(ph, 'perMin') * mean(ph, 'dodge')).toFixed(1)} to dodge: ${(mean(ph, 'dodge') * 100).toFixed(0)} %) · field busy ${(mean(ph, 'busy') * 100).toFixed(0)} % · longest gap ${Math.max(...rows.filter((r) => r.ph === ph).map((r) => r.gapMax)).toFixed(2)} s (mean ${mean(ph, 'gapMax').toFixed(2)}) · ${mean(ph, 'chained').toFixed(1)} chained of ${mean(ph, 'picks').toFixed(1)} moves · conflicts ${rows.filter((r) => r.ph === ph).reduce((a, r) => a + r.conflicts, 0)}`);
  if (!P?.meter || ONLY) { out(`   (${ONLY ? 'GCD_PFORMS: some forms only' : 'no TUNING.pressure.meter'}: measured only, nothing asserted)`); return lastG; }
  const A = P.meter;
  // (as Shen Hui's meter: `rampMean`, the ramp of the seeds' mean; per seed the floor `ramp` is looser:
  // one seed's form swings 5 - 15 % between builds, the mean of several far less)
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

async function scenarioWin() {
  out('\n== scenario WIN (a fencing bot in god mode: parries, rolls, cuts in his openings, gives the deathblows) ==');
  const G = build();
  const MK = attachMarks(G.game); // (the floor marks the fight leaves: they change nothing in it)
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
  marksCheck(MK, 'lord', out, assert);
  const dmg = G.hits.filter((h) => h.r === RESULT.HIT).reduce((a, h) => a + (h.damage ?? 0), 0);
  if (skill < 1) {
    out(`     probe (skill ${skill}): ${taken} hits for ${dmg.toFixed(0)} damage in ${T.toFixed(0)} s (the hero has 160 HP and 5 flasks of 70)`);
    return;
  }
  assert(won && blows === 4, `the bot beats all four forms (${blows} deathblows)`);
  // (the second pass, 2026-11-16: 49 / 54 / 63 / 64 s on seeds 1337 / 4242 / 99 / 7; it was over 55 s.
  // More blows to parry in his strings fill his posture sooner against a bot that parries them all;
  // the lower bound moved from 55 to 40 s)
  assert(T > 40 && T < 300, `the fight takes a bot that answers every tell ${T.toFixed(0)} s`);
}

// ================================================================== scenarios: probe / defend (opt-in)
/** A mortal fencer (no god mode): it answers a share of his cues (makeDefender's skill, its own
 *  random stream), cuts in his openings, gives the deathblows, and drinks a flask below `drinkAt` HP
 *  when nothing is due within 0.9 s. `attack: false`: a pure defender (it never swings; the riposte
 *  of a parried last blow still answers by itself). */
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
  // (it drinks as a player would: in his openings (a reaction, a break) or out of his reach (over 6 m),
  // with nothing cued; a drink takes 0.85 s, and a blow it cannot see coming yet may still catch it)
  const opening = d.broken || d.mode === 'react';
  if (p.hp < drinkAt && p.flasks > 0 && (opening || dist > 6) && !G.defend.dueWithin(0.7) && ['idle', 'run', 'block'].includes(p.state) && tick % 6 === 0) { input.up(1); input.tap('KeyF'); return; }
  if (dist > 2.6 && !busy) input.axis = { x: dx / dist, y: -dz / dist };
  if (!attack) {
    // (a pure defender still gives the deathblow: a broken lord left alone rises with a fifth of his bar)
    if (execute && d.broken && dist < 3.2 && tick % 12 === 0) input.click(0);
    return;
  }
  const a = d.brain.act;
  const open = d.broken || (d.mode === 'react' && ['recoil', 'stagger', 'flinch', 'reeling', 'trampled'].includes(d.brain.react?.kind)) || (a && a.t > a.recoveryStart) || p.critTimer > 0;
  if (!busy && dist < 3.2 && (open ? tick % 20 === 0 : tick % 70 === 0)) input.click(0);
}

/** One mortal run: returns what it measured (hurt from player:hurt, so after the hero's own rules). */
function mortalRun(seed, { skill, form = 1, secs = 600, attack = true, oneForm = false, execute = true } = {}) {
  const G = build(seed, true);
  const { game } = G;
  const d = game.dragon, p = game.player;
  // (his AI starts once the bot is watching: a blow already on its way as the duel is staged is not cued to it)
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
      // why it landed: a cue the bot chose to miss ('missed'), a cue it answered ('ANSWERED': a bug
      // or the bot's own fault: look), or no cue of that attack in the 1.5 s before ('uncued')
      const atk = curAtk ?? '';
      const t = game.time;
      const why = G.defend?.stats.skipped.some((x) => x[0] > t - 1.5 && x[1] === atk) ? 'missed' : flashT.some((x) => x[0] > t - 1.5 && x[1] === atk) ? 'ANSWERED' : 'uncued';
      hurt.push([t, e.damage, atk || d.brain.act?.name || d.mode, form + formAt.length - 1, why]);
    }
    if (ev === 'combat:flash' && (e?.source === 'dragon' || e?.source === 'world')) flashT.push([game.time, e.attack]);
    if (ev === 'dragon:postureBreak') breaks.push(`posture@${(d.hp / TUNING.hp * 100).toFixed(0)}%`);
    if (ev === 'player:parry') { n.parries++; if (e?.perfect) n.perfect++; }
    if (ev === 'player:perfectDodge') n.dodges++;
    if (ev === 'player:heal') n.heals++;
    if (ev === 'dragon:plunged') n.blows++;
    if (/^dragon:phase[234]$/.test(ev)) formAt.push(game.time);
  };
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
  // the worst second: the most damage inside any 1 s window
  let worst1 = 0, worst1At = '';
  for (let i = 0; i < hurt.length; i++) {
    let s = 0;
    const at = [];
    for (let j = i; j < hurt.length && hurt[j][0] - hurt[i][0] <= 1; j++) { s += hurt[j][1]; at.push(hurt[j][2]); }
    if (s > worst1) { worst1 = s; worst1At = at.join('+'); }
  }
  const worst = hurt.reduce((m, h) => (h[1] > m[1] ? h : m), [0, 0, '']);
  const perForm = formAt.map((t, i) => ((formAt[i + 1] ?? game.time) - t));
  const why = hurt.reduce((m, h) => ((m[h[4]] = (m[h[4]] || 0) + h[1]), m), {});
  const answered = hurt.filter((h) => h[4] !== 'missed').map((h) => `${h[2]} ${h[1].toFixed(0)} ${h[4]} @${(h[0] - t0).toFixed(1)}`);
  return { seed, skill, outcome, T, why, answered, breaks, form: d.phase, bar: d.hp / TUNING.hp, hp: p.hp, flasks: p.maxFlasks - p.flasks, heals: n.heals, hits: hurt.length, dmg: hurt.reduce((a, h) => a + h[1], 0), worst: worst[1], worstBy: worst[2], worst1, worst1At, perForm, ...n, byMove: hurt.reduce((m, h) => ((m[h[2]] = (m[h[2]] || 0) + h[1]), m), {}) };
}

/** PROBE: mortal bots that answer 95 / 85 / 70 % of his cues (GCD_PSKILLS), three seeds each
 *  (GCD_PRSEEDS), whole fights (10 minutes at most): wins, the fight's length and each form's,
 *  hits and damage taken, flasks, the worst blow and the worst second. Reported, not asserted. */
async function scenarioProbe() {
  out('\n== scenario PROBE (mortal bots, whole fights: answer a share of his cues, cut in his openings, drink below 60 HP) ==');
  const skills = (process.env.GCD_PSKILLS ?? '0.95,0.85,0.7').split(',').map(Number);
  const seeds = (process.env.GCD_PRSEEDS ?? '4242,7,99').split(',').map(Number);
  const all = [];
  for (const skill of skills) {
    for (const seed of seeds) {
      const r = mortalRun(seed, { skill });
      all.push(r);
      out(`   skill ${skill} seed ${String(seed).padEnd(4)} ${r.outcome.padEnd(4)} ${r.T.toFixed(0).padStart(4)} s · form ${r.form} bar ${(r.bar * 100).toFixed(0)} % · forms ${r.perForm.map((x) => x.toFixed(0)).join(' / ')} s · breaks ${r.breaks.join(' ') || '-'} · damage missed / answered / uncued ${['missed', 'ANSWERED', 'uncued'].map((k) => (r.why[k] ?? 0).toFixed(0)).join(' / ')} · hits ${r.hits} for ${r.dmg.toFixed(0)} · flasks ${r.flasks} · worst blow ${r.worst.toFixed(1)} (${r.worstBy}) · worst second ${r.worst1.toFixed(1)} (${r.worst1At}) · parries ${r.parries} (perfect ${r.perfect}) · perfect dodges ${r.dodges} · deathblows ${r.blows}`);
      if (process.env.GCD_PRMOVES) out(`        damage by move: ${Object.entries(r.byMove).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · ')}${r.answered.length ? `
        not missed by choice: ${r.answered.join(' · ')}` : ''}`);
    }
  }
  return all;
}

/** DEFEND: a mortal pure defender (answers 95 %, never swings, drinks its flasks) against each form
 *  for GCD_DSECS s (default 120; the form is held). The owner's rule: defensive play must not be
 *  punished: it must live through two minutes of every form. */
async function scenarioDefend() {
  out('\n== scenario DEFEND (a mortal pure defender, 95 %, two minutes of each form) ==');
  const secs = Number(process.env.GCD_DSECS ?? 120);
  const seeds = (process.env.GCD_PRSEEDS ?? '4242,7,99').split(',').map(Number);
  const skill = Number(process.env.GCD_DSKILL ?? 0.95);
  for (const seed of seeds) {
    for (let form = 1; form <= FORMS; form++) {
      const r = mortalRun(seed, { skill, form, secs, attack: false, oneForm: true, execute: false });
      out(`   seed ${String(seed).padEnd(4)} form ${form}: ${r.outcome === 'died' ? `DIED at ${r.T.toFixed(0)} s` : `alive after ${r.T.toFixed(0)} s, ${r.hp.toFixed(0)} HP`} · damage missed / answered / uncued ${['missed', 'ANSWERED', 'uncued'].map((k) => (r.why[k] ?? 0).toFixed(0)).join(' / ')} · hits ${r.hits} for ${r.dmg.toFixed(0)} · flasks ${r.flasks} · worst blow ${r.worst.toFixed(1)} (${r.worstBy}) · worst second ${r.worst1.toFixed(1)} (${r.worst1At}) · parries ${r.parries} · his bar ${(r.bar * 100).toFixed(0)} %`);
      if (process.env.GCD_PRMOVES) out(`        damage by move: ${Object.entries(r.byMove).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · ')}${r.answered.length ? `
        not missed by choice: ${r.answered.join(' · ')}` : ''}`);
    }
  }
}

// ================================================================== scenario: strategy (opt-in)
/** Which defence wins? Three god-mode fencers that differ only in how they answer a tell. Not a
 *  pass / fail check: node lord.mjs . strategy */
async function scenarioStrategy() {
  out('\n== scenario STRATEGY (mixed / parry-only / dodge-only, god mode) ==');
  for (const style of ['mixed', 'parry', 'dodge']) {
    for (const seed of [4242, 7]) {
      const G = build(seed);
      const { game } = G;
      const d = game.dragon;
      duel(G, { dist: 3, ai: true });
      G.defend = makeDefender(G, { style });
      const n = { perfect: 0, parries: 0 };
      G.watch = (ev) => {
        if (ev === 'player:perfectDodge') n.perfect++;
        if (ev === 'player:parry') n.parries++;
      };
      const t0 = game.time;
      const won = run(G, 420, () => fencer(G), () => d.mode === 'dead');
      G.watch = null;
      const taken = G.hits.filter((h) => h.r === RESULT.HIT);
      out(`     ${style.padEnd(5)} seed ${String(seed).padEnd(4)} ${won ? 'WON ' : 'time'} ${(game.time - t0).toFixed(0).padStart(3)} s  form ${d.phase}  hits taken ${String(taken.length).padStart(2)} (${Math.round(taken.reduce((a, h) => a + (h.damage || 0), 0))} dmg)  parries ${String(n.parries).padStart(3)}  perfect dodges ${String(n.perfect).padStart(2)}`);
      G.defend = null;
    }
  }
}

// ================================================================== run
const S = {
  level: scenarioLevel,
  floor: scenarioFloor,
  data: scenarioData,
  moves: scenarioMoves,
  timing: scenarioTiming,
  forms: scenarioForms,
  clashdance: scenarioClashDance,
  spells: scenarioSpells,
  bounds: scenarioBounds,
  flow: scenarioFlow,
  terrain: scenarioTerrain,
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
  training: scenarioTraining,
  flare: scenarioFlare,
  fxlooks: scenarioFxlooks,
  swordmotion: scenarioSwordMotion,
  lordform: scenarioLordForm,
  lordref: scenarioLordRef,
};
// (one parry, ADR-279: ?parry=one, the default, makes every parry perfect. These scenarios press a PLAIN parry on purpose
// (a perfect one would lock the blades, break him, or send a shot back): they run with ?parry=two)
{
  const RULES = await imp('src/combat/rules.js');
  for (const k of ['spells', 'flare']) {
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
/**
 * LORDREF (ADR-277): Varr Nihil after the reference pack (docs/art/character-packs-v04/varr-nihil).
 * `?lordRefMove=a` changes poses only: every move, form, branch and flurry count realised with it on and off
 * times every beat the same (start, impact, end, windup, hold, active, follow, close, flash, the move's end
 * and recovery) under the shipped switches and with them all off; the same seeded fight against the
 * defender bot lands the same blows at the same times; the sword audit's limits hold (the sword in line
 * with the forearm, the blade clear of his head and body, the arms opening). `?lordRef=a`: every blade
 * split (each with its dark slit, shown and scaled with it), no form-by-form dressing, his body whole.
 */
async function scenarioLordRef() {
  out('\n== scenario LORDREF (ADR-277: the reference pack behind ?lordRef / ?lordRefMove: the look and the poses, never the timing) ==');
  const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const rnd = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const key = (A) => JSON.stringify([A.end, A.recoveryStart, A.hits, A.beats.map((b) => [b.index, b.start, b.impact, b.end, b.W, b.H, b.A, b.S, b.F, b.close, b.flash, b.feint, b.last])]);
  let n = 0;
  const diff = [];
  for (const combo of [{}, { lordMotion: '0', lordForm: '0', lordPace: '0' }]) {
    for (const [k, v] of Object.entries(combo)) setLook(k, v);
    for (const name of MOVE_NAMES) {
      const def = MOVES[name];
      for (const f of [1, 2, 3, 4]) {
        if (def.transition && f !== def.phase) continue;
        for (let s = 1; s <= 5; s++) {
          const opts = def.streak ? { count: 2 + s } : null;
          setLook('lordRefMove', '0');
          const a = realise(name, f, rnd(s * 7919), opts);
          setLook('lordRefMove', 'a');
          const b = realise(name, f, rnd(s * 7919), opts);
          if (!a || !b) continue;
          n++;
          if (key(a) !== key(b)) diff.push(`${name} f${f} s${s}`);
        }
      }
    }
    for (const k of Object.keys(combo)) setLook(k, null);
  }
  setLook('lordRefMove', null);
  assert(!diff.length && n > 1000, `${n} realisations (every move, form, branch, flurry count; shipped switches and all off) time every beat the same with ?lordRefMove on and off (${diff.slice(0, 6).join(', ') || 'none differ'})`);
  // the same seeded fight, the same blows
  const fight = (on) => {
    setLook('lordRefMove', on ? 'a' : '0');
    const G = build(SEED + 11);
    duel(G, { dist: 3.5, ai: true, form: 1 });
    G.defend = makeDefender(G);
    const h0 = G.hits.length;
    run(G, 24, () => G.defend.act());
    setLook('lordRefMove', null);
    return G.hits.slice(h0).map((h) => `${h.t.toFixed(3)} ${h.attack} ${h.r} ${h.damage}`);
  };
  const A = fight(false), B = fight(true);
  const firstDiff = A.findIndex((h, i) => h !== B[i]);
  assert(A.length > 4 && A.length === B.length && firstDiff < 0, `a seeded 24 s fight against the defender: ${A.length} blows off, ${B.length} on, the same times, moves and results${firstDiff >= 0 ? ` (first differs: ${A[firstDiff]} / ${B[firstDiff]})` : ''}`);
  // the sword audit with the reference's poses (the shipped switches on)
  setLook('lordRefMove', 'a');
  let last = null;
  const H = { THREE, build: (...a) => (last = build(...a)), duel, run, DT, MOVES, names: ['litany', 'lunge', 'reap', 'meridian', 'voidBolt', 'tempest', 'cyclone', 'starfall', 'judgment', 'emberRise', 'vigilFall'], formOf: (nm) => Math.min(4, Math.max(1, MOVES[nm].phase ?? 1)), setForm: null };
  const rows = swordAudit(H);
  printAudit(rows, out);
  const ok = rows.filter((r) => !r.fail);
  assert(ok.length === H.names.length, `${ok.length} of ${H.names.length} moves audited`);
  const wr = Math.max(...ok.map((r) => r.wrist.max)), gh = Math.min(...ok.map((r) => r.gap.head)), gb = Math.min(...ok.map((r) => r.gap.body));
  assert(wr <= 62, `the sword in line with the forearm with the reference's poses: the wrist at most ${wr}° (≤ 62)`);
  assert(gh >= 0.08 && gb >= 0.08, `the blade clear of him with the reference's poses: ${gh.toFixed(2)} m from his head, ${gb.toFixed(2)} m from his body at the closest (≥ 0.08)`);
  setLook('lordRefMove', null);
  // the look
  setLook('lordRef', 'a');
  setLook('lordRefMove', 'a');
  const G = build(SEED + 3);
  duel(G, { dist: 4, ai: true, form: 1 });
  const d = G.game.dragon;
  const cores = d.blades.cores ?? [];
  const dressed = !!d.rig.root.userData.dress;
  run(G, 4);
  d.debug.setForm(4);
  run(G, 4);
  const synced = cores.every(([b, c]) => c.visible === b.visible && Math.abs(c.scale.z - b.scale.z) < 1e-6);
  setLook('lordRef', null);
  setLook('lordRefMove', null);
  assert(cores.length === 4 && synced && !dressed, `?lordRef=a: ${cores.length} split blades, each slit shown and scaled with its blade (${synced}); no form-by-form dressing (${!dressed}); 8 s of a fight in forms 1 and 4, nothing NaN`);
  return last;
}
/**
 * SWORDMOTION (ADR-226): the sword motion pass behind `?lordMotion=a`. On: his sword held in line with his
 * forearm (the audit's wrist ≤ 62° in every frame of the moves below, the hero's bar 60), the blade
 * clear of his head and body, the arms opening at the end of a blow (an elbow past 148°); each blue / red
 * blade blow holds its tell pose (the point still within 8 cm through the hold); the windups, impacts and
 * ends of every move exactly as with the switch off (only poses change); the quick blows' windup
 * TUNING.minQuickWindup and picked only while it is on. Off: as before.
 */
async function scenarioSwordMotion() {
  out('\n== scenario SWORDMOTION (the sword motion pass, ADR-226: the grip, the held tell poses, the quick blows; on and off) ==');
  const { setLook } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  setLook('lordMotion', 'a');
  let last = null;
  const H = { THREE, build: (...a) => (last = build(...a)), duel, run, DT, MOVES, names: ['litany', 'cadence', 'meridian', 'voidBolt', 'tempest', 'mill', 'judgment', 'emberRise', 'vigilFall'], formOf: (n) => Math.min(4, Math.max(1, MOVES[n].phase ?? 1)), setForm: null };
  const rows = swordAudit(H);
  printAudit(rows, out);
  const ok = rows.filter((r) => !r.fail);
  assert(ok.length === H.names.length, `${ok.length} of ${H.names.length} moves audited`);
  const wr = Math.max(...ok.map((r) => r.wrist.max)), gh = Math.min(...ok.map((r) => r.gap.head)), gb = Math.min(...ok.map((r) => r.gap.body)), el = Math.min(...ok.filter((r) => !MOVES[r.name].beats.every((b) => b.bolt || b.cast || b.pull || b.grip)).map((r) => r.elbow[1])); // (a spell: the sword arm does not strike)
  assert(wr <= 62, `the sword in line with the forearm: the wrist at most ${wr}° (≤ 62; the hero ≤ 60; before the pass 85 - 128)`);
  assert(gh >= 0.08 && gb >= 0.08, `the blade clear of him: ${gh.toFixed(2)} m from his head, ${gb.toFixed(2)} m from his body at the closest (≥ 0.08)`);
  assert(el >= 148, `every move opens the arm: the widest elbow at least ${el}° (≥ 148; before 131 - 145)`);
  const held = [['meridian', 1], ['scissor', 2]].map(([n, f]) => [n, heldTip(H, n, { form: f })]);
  assert(held.every(([, h]) => !h.fail && h.n >= 6 && h.far < 0.08), `the tell pose is held: the point wanders ${held.map(([n, h]) => `${n} (${h.tell}) ${h.far?.toFixed(3)} m over ${h.n} frames`).join(', ')} (< 0.08)`);
  // the timings: only poses change
  let same = 0, diff = [];
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    if (def.motionOnly) continue;
    for (const ph of [1, 2, 3, 4]) {
      if ((def.phase ?? 1) > ph) continue;
      setLook('lordMotion', 'a');
      const a = realise(name, ph, () => 0.37);
      setLook('lordMotion', '0');
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
  setLook('lordMotion', '0');
  const off = quick.map((n) => d.weigh(n, MOVES[n], 1, 2));
  setLook('lordMotion', 'a');
  const on = quick.map((n) => d.weigh(n, MOVES[n], 1, 2));
  const fast = quick.every((n) => MOVES[n].beats.every((b) => b.quick && b.fixed && b.tell === TELL.NORMAL && b.windup === TUNING.minQuickWindup));
  assert(quick.length >= 2 && fast && off.every((w) => w === 0) && on.every((w) => w > 0), `${quick.length} quick blows (${quick.join(', ')}): normal, ${TUNING.minQuickWindup} s windups; weighed 0 with the switch off, ${on.join(' / ')} on`);
  setLook('lordMotion', null);
  return last;
}
/**
 * LORDFORM (ADR-251): his form behind `?lordForm=a`, measured at each blow's impact (swordAudit.mjs, the impact
 * table): a thrust lands on a long arm (the elbow past 150°, before 121 - 140°) with the point on the arm's line
 * (≤ 8°, before 18 - 23°) and the lunge's front knee bent (≤ 120°, before 176° locked); a low sweep turns on his
 * feet (they never cross: before -0.73 m); a two-handed overhead comes down on a diagonal (the point's path
 * ≤ 65° off level, before 71 - 80°); the front foot is down at most cuts. Every move's windups, impacts and ends
 * the same to the frame on and off (only poses change). Void Lightning's and the ignitions' looks (`?boltFx`
 * / `?igniteFx`, every option) finite and cheap (< 300 blobs over today's peak).
 */
async function scenarioLordForm() {
  out('\n== scenario LORDFORM (the form pass, ADR-251: thrusts, lunges, sweeps, overheads, the footfall; the specials\' looks) ==');
  const { setLook, lookOf: lookOfF } = await imp('src/entities/enemies/duelist/lookSwitch.js');
  const keep = lookOfF('lordForm', '0');
  setLook('lordForm', 'a');
  let last = null;
  const H = { THREE, build: (...a) => (last = build(...a)), duel, run, DT, MOVES, names: ['lunge', 'riposte', 'reap', 'meridian', 'severance', 'grasp', 'litany'], formOf: () => 1 };
  const rows = swordAudit(H);
  printImpacts(rows, out);
  const ok = rows.filter((r) => !r.fail);
  assert(ok.length === H.names.length, `${ok.length} of ${H.names.length} moves audited`);
  const imps = ok.flatMap((r) => r.impacts.map((x) => ({ ...x, name: r.name })));
  const spell = (x) => { const raw = MOVES[x.name].beats[x.i]; return !!raw && (raw.pick ?? [raw]).some((b) => b.bolt || b.pull || b.grip); };
  const thr = imps.filter((x) => x.thrust && !spell(x));
  const thrOk = thr.filter((x) => x.elbow >= 150 && x.armLine <= 8);
  assert(thr.length >= 3 && thrOk.length === thr.length, `thrusts on a long straight arm: ${thr.map((x) => `${x.name} b${x.i} ${x.elbow}°/${x.armLine}°`).join(', ')} (elbow ≥ 150, off the line ≤ 8)`);
  const lungeR = ok.find((r) => r.name === 'lunge').impacts[0];
  assert(Math.min(lungeR.knR, lungeR.knL) <= 120, `the lunge on a bent front knee: ${lungeR.knR}° / ${lungeR.knL}° (one ≤ 120; before both 176)`);
  const sweeps = ok.filter((r) => r.name === 'reap' || r.name === 'meridian');
  assert(sweeps.every((r) => r.feet.cross >= 0), `the low sweeps turn on his feet: crossing ${sweeps.map((r) => `${r.name} ${r.feet.cross} m`).join(', ')} (≥ 0; before -0.73)`);
  const over = ['severance', 'grasp'].map((n) => ok.find((r) => r.name === n)).map((r) => r.impacts.find((x) => x.tell === 'blue'));
  assert(over.every((x) => x && x.tilt <= 65), `overheads on a diagonal: the point's path ${over.map((x) => x?.tilt).join(' / ')}° off level (≤ 65; before 71 - 80)`);
  const cuts = imps.filter((x) => !x.thrust);
  const down = cuts.filter((x) => /down/.test(x.front)).length;
  assert(down / cuts.length >= 0.75, `the front foot down as the blow lands: ${down} of ${cuts.length} cuts (≥ 75 %)`);
  // the timings: only poses change
  let same = 0;
  const diff = [];
  for (const name of MOVE_NAMES) {
    const def = MOVES[name];
    for (const ph of [1, 2, 3, 4]) {
      if ((def.phase ?? 1) > ph) continue;
      setLook('lordForm', 'a');
      const A = realise(name, ph, () => 0.37);
      setLook('lordForm', '0');
      const B = realise(name, ph, () => 0.37);
      if (!A || !B) continue;
      const k = (X) => X.beats.map((x) => `${x.start.toFixed(4)}/${x.impact.toFixed(4)}/${x.end.toFixed(4)}`).join(' ') + ` ${X.end.toFixed(4)}`;
      if (k(A) === k(B)) same++;
      else diff.push(`${name} P${ph}`);
    }
  }
  assert(!diff.length && same > 100, `${same} realisations time every beat the same on and off (${diff.join(', ') || 'none differ'})`);
  // the specials' looks: every option draws, finite, and costs the field little more than today
  const peaks = [];
  for (const [move, sw, form] of [['voidBolt', 'boltFx', 1], ['ignite2', 'igniteFx', 1], ['ignite4', 'igniteFx', 3]]) {
    const base = [];
    for (const o of ['0', 'a', 'b', 'c']) {
      setLook(sw, o);
      const G = build();
      duel(G, { dist: move === 'voidBolt' ? 6 : 3, form });
      const { game } = G;
      const d = game.dragon, p = game.player;
      p.debug.god = true;
      run(G, 0.5);
      const trig = d.debug.trigger(move);
      let peak = 0, bad = false;
      run(G, 3.2, () => {
        p.hp = p.maxHp;
        peak = Math.max(peak, game.fx.fire.count);
        if (!Number.isFinite(d.position.x + d.position.y + d.position.z)) bad = true;
      });
      base.push(peak);
      peaks.push(`${sw}=${o} ${move} ${peak}${bad ? ' NaN' : ''}${trig ? '' : ' (not triggered)'}`);
      assert(!bad && trig, `${sw}=${o} (${move}): triggered, finite throughout`);
      last = G;
    }
    assert(base.slice(1).every((x) => x - base[0] < 300), `${move}'s looks cost the field < 300 blobs over today's ${base[0]} (${base.slice(1).join(' / ')})`);
    setLook(sw, null);
  }
  out(`     blob peaks: ${peaks.join(' | ')}`);
  setLook('lordForm', /lordForm=/.test(process.env.GCD_LOOKS ?? '') ? keep : null);
  return last;
}
/** AUDIT (opt-in, ADR-226): every move's sword motion in its own form (tests/integration/swordAudit.mjs). */
async function scenarioAudit() {
  out('\n== scenario AUDIT (every move in its form: the sword wrist, the blade off his body, facing, elbows, the free hand, feet, pops) ==');
  const only = (process.env.GCD_AUDIT ?? '').split(',').filter(Boolean);
  const names = MOVE_NAMES.filter((n) => !only.length || only.includes(n));
  const rows = swordAudit({ THREE, build, duel, run, DT, MOVES, names, formOf: (n) => Math.min(4, Math.max(1, MOVES[n].phase ?? 1)) });
  printAudit(rows, out);
  if (process.env.GCD_AUDIT_IMPACT) printImpacts(rows, out);
  if (process.env.GCD_AUDIT_JSON) fs.writeFileSync(process.env.GCD_AUDIT_JSON, JSON.stringify(rows, null, 1));
}
/**
 * FORMAUDIT (opt-in, ADR-251): every move in EVERY form it is used in (a move compiled round another form's
 * guard is not the move he plays there), through the sword audit (GCD_AUDIT_IMPACT=1 prints its impact
 * table), and two things the shared audit does not read: the planted feet's true slide (an ankle on the floor
 * in both frames, within 1.5 cm of its height standing, its travel summed: a step in the air is not a slide)
 * and, in form 2, the off-hand blade's arm: the left elbow at each off-hand blow's impact and the angle of
 * that blade off the left forearm (the hero holds ≤ 60°). `GCD_AUDIT=a,b` picks moves, GCD_AUDIT_FORMS=1,2
 * forms, GCD_AUDIT_JSON a file for the rows.
 */
const phaseOfA = (a, t) => {
  for (const b of a.beats) {
    if (t < b.start) continue;
    const i = b.index ?? a.beats.indexOf(b);
    if (t < b.impact - 0.12) return `b${i} windup`;
    if (t <= b.impact + 0.06) return `b${i} strike`;
    if (t <= b.end + 1e-6) return `b${i} active`;
  }
  return t < (a.recoveryStart ?? a.end) ? 'follow' : 'recovery';
};
async function scenarioFormAudit() {
  out('\n== scenario FORMAUDIT (every move in every form it is used in: the sword audit, the true slide, the off-hand arm) ==');
  const only = (process.env.GCD_AUDIT ?? '').split(',').filter(Boolean);
  const forms = (process.env.GCD_AUDIT_FORMS ?? '1,2,3,4').split(',').map(Number);
  const DEG = 180 / Math.PI;
  const usedIn = (n, f) => {
    const def = MOVES[n];
    if (def.transition) return def.phase === f;
    if (def.counter || def.streak || weightIn(def, f) === 0) return (def.phase ?? 1) === f && weightIn(def, f) === 0 && (def.counter || def.streak);
    return weightIn(def, f) > 0;
  };
  const rowsAll = [];
  for (const f of forms) {
    const names = MOVE_NAMES.filter((n) => (!only.length || only.includes(n)) && usedIn(n, f) && !MOVES[n].transition && !MOVES[n].terrain);
    if (!names.length) continue;
    const rows = swordAudit({ THREE, build, duel, run, DT, MOVES, names, formOf: () => f });
    rows.forEach((r) => (r.form = f));
    rowsAll.push(...rows);
    printAudit(rows, out);
    if (process.env.GCD_AUDIT_IMPACT) printImpacts(rows, out);
  }
  // the true slide and the off-hand arm: one more pass per move (its own build, the audit's set-up)
  out('   move              f   slide(m, feet on the floor)   off-hand: elbow @impacts / blade off the forearm max');
  const v = new THREE.Vector3(), w = new THREE.Vector3(), q = new THREE.Vector3();
  for (const f of forms) {
    for (const n of MOVE_NAMES.filter((x) => (!only.length || only.includes(x)) && usedIn(x, f) && !MOVES[x].transition && !MOVES[x].terrain)) {
      const def = MOVES[n];
      const G = build();
      const band = def.band ?? [0, 4];
      const dist = Math.min(7, Math.max(1.6, (band[0] + Math.min(band[1], 8)) / 2));
      duel(G, { dist, form: f });
      const { game } = G;
      const d = game.dragon, p = game.player;
      p.debug.god = true;
      run(G, 0.6);
      d.position.set(0, 0, 0);
      d.yaw = Math.PI / 2;
      p.debug.teleport(dist, 0);
      run(G, 0.7);
      if (!d.debug.trigger(n)) continue;
      const A = d.brain.act, R = d.rig, foot0 = 0.07 * TUNING.scale + 0.015;
      let slide = 0, prev = null, wristL = 0, after = -1;
      const left = [], slideAt = {};
      for (let i = 0; i < 1500; i++) {
        p.hp = p.maxHp;
        p.debug.teleport(p.position.x, p.position.z);
        const inAct = d.brain.act === A;
        if (!inAct && after < 0) after = 0;
        if (after >= 0 && after++ > 14) break;
        R.root.updateMatrixWorld(true);
        const fr = { R: new THREE.Vector3().setFromMatrixPosition(R.legs.R.foot.matrixWorld), L: new THREE.Vector3().setFromMatrixPosition(R.legs.L.foot.matrixWorld), y: d.position.y };
        const air = d.position.y > 0.05 || !!d.brain.leap || (inAct && !!A.beats.find((b) => (b.def.dash || b.def.flit || b.def.blink) && A.t >= b.start && A.t <= b.end + 0.1));
        if (prev && !air && !prev.air) for (const k of ['R', 'L']) if (fr[k].y < foot0 && prev[k].y < foot0) {
          const m = Math.hypot(fr[k].x - prev[k].x, fr[k].z - prev[k].z);
          slide += m;
          const ph = inAct ? phaseOfA(A, A.t) : 'blend out';
          slideAt[ph] = (slideAt[ph] ?? 0) + m;
        }
        fr.air = air;
        prev = fr;
        // the off-hand blade's line against the left forearm (form 2)
        const off = d.blades?.off;
        if (f === 2 && off) {
          const el = v.setFromMatrixPosition(R.arms.L.fore.matrixWorld).clone(), wr = w.setFromMatrixPosition((R.arms.L.wrist ?? R.arms.L.fore).matrixWorld).clone();
          const fore = wr.clone().sub(el).normalize();
          const bl = q.set(0, 0, 1).transformDirection(off.matrixWorld).normalize();
          const a = Math.acos(Math.max(-1, Math.min(1, fore.dot(bl)))) * DEG;
          wristL = Math.max(wristL, a);
          if (inAct) for (const b of A.beats) {
            if (!b.def.left || b.feint || b._audL || A.t < b.impact) continue;
            b._audL = true;
            const sh = new THREE.Vector3().setFromMatrixPosition(R.arms.L.upper.matrixWorld);
            const u1 = sh.sub(el).normalize(), u2 = wr.clone().sub(el).normalize();
            left.push(`${Math.round(Math.acos(Math.max(-1, Math.min(1, u1.dot(u2)))) * DEG)}°/${Math.round(a)}°`);
          }
        }
        G.tick(DT);
      }
      const row = rowsAll.find((r) => r.name === n && r.form === f);
      const worst = Object.entries(slideAt).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, m]) => `${k} ${m.toFixed(2)}`).join(', ');
      if (row) Object.assign(row, { trueSlide: +slide.toFixed(2), slideAt: worst, offHand: { impacts: left, wristMax: Math.round(wristL) } });
      out(`   ${n.padEnd(17)} ${f}   ${String(slide.toFixed(2)).padStart(5)} (${worst})   ${f === 2 ? `${left.join(' ') || '-'} / ${Math.round(wristL)}°` : ''}`);
    }
  }
  if (process.env.GCD_AUDIT_JSON) fs.writeFileSync(process.env.GCD_AUDIT_JSON, JSON.stringify(rowsAll, null, 1));
}
const OPT_IN = { strategy: scenarioStrategy, probe: scenarioProbe, defend: scenarioDefend, audit: scenarioAudit, formaudit: scenarioFormAudit }; // run only when named
// `all`, one scenario or a comma list; GCD_SKIP (a comma list) leaves scenarios out of `all`
// (tests/run.mjs runs the long ones as processes of their own, so a new scenario lands in `all`)
const SKIP = new Set((process.env.GCD_SKIP ?? '').split(',').map((s) => s.trim()).filter(Boolean));
for (const k of SKIP) if (!S[k]) { out(`unknown scenario in GCD_SKIP: ${k}`); process.exit(2); }
for (const k of SCEN.split(',')) if (OPT_IN[k]) S[k] = OPT_IN[k];
const list = SCEN === 'all' ? Object.keys(S).filter((k) => !SKIP.has(k)) : SCEN.split(',');
if (SCEN === 'all' && SKIP.size) out(`\n(not run here, GCD_SKIP: ${[...SKIP].join(', ')})`);
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
