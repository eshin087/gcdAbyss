import * as THREE from 'three';
import { CONFIG } from './core/config.js';
import { Input } from './core/input.js';
import { Events } from './core/events.js';
import { CameraRig } from './core/cameraRig.js';
import { clamp, damp } from './core/math.js';
import { createSharedUniforms } from './render/shaderLib.js';
import { createGlyphAtlas, loadFonts } from './render/glyphs.js';
import { Pipeline } from './render/pipeline.js';
import { LightPool } from './render/lights.js';
import { GlyphParticles } from './render/particles.js';
import { World } from './world/world.js';
import { Player } from './entities/player/player.js';
import { LEVELS, levelFromSearch, applyLevel, levelUrl } from './levels/index.js';
import { Hud } from './ui/hud.js';
import { TouchControls } from './ui/touch.js';
import { GamepadControls } from './ui/gamepad.js';
import { AudioEngine } from './audio/audio.js';
import { GameFlow } from './game/flow.js';
import { Lab } from './dev/lab.js';

// Boot + main loop. Builds the shared `game` context every module receives (see ARCHITECTURE.md).

async function boot() {
  await loadFonts();
  // the level (`?level=ash`; levels/index.js): its world overrides land in CONFIG.world before any
  // module reads them
  const level = levelFromSearch(location.search);
  applyLevel(level);

  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // final pass gamma-encodes itself
  renderer.setClearColor(0x000000, 1);

  const U = createSharedUniforms();
  U.uGlyphAtlas.value = createGlyphAtlas(renderer).texture;

  const scene = new THREE.Scene();
  const fxScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, CONFIG.camera.near, CONFIG.camera.far);
  const pipeline = new Pipeline(renderer, scene, fxScene, camera, U);

  const game = {
    THREE,
    CONFIG,
    level,
    // the stage picker (title screen, Lab): every level, and a reload into one of them
    levels: LEVELS.map((L) => ({ id: L.id, name: L.name })),
    pickLevel(id) {
      location.assign(levelUrl(id, location.href));
    },
    renderer,
    scene,
    fxScene,
    camera,
    pipeline,
    U,
    events: new Events(),
    input: new Input(canvas),
    cameraRig: new CameraRig(camera),
    lights: new LightPool(U),
    fx: {
      alpha: new GlyphParticles(U, { max: 3000, additive: false }),
      add: new GlyphParticles(U, { max: 7000, additive: true }),
    },
    time: 0,
    realTime: 0,
    timeScale: 1,
    debugTimeScale: 1, // Lab-only multiplier on game time
    hitstopTimer: 0,
    hitstopScale: 1,
    mouseGround: new THREE.Vector3(),
    state: 'title',
    settings: { quality: CONFIG.defaultQuality, showFps: false },
    /** Freeze-frame on impacts: time runs at `scale` for `seconds` of real time. The fighters hold
     *  the impact's pose; sparks and lights run on at CONFIG.render.fxLive of real time (fxDt). */
    hitstop(seconds, scale = 0.04) {
      this.hitstopTimer = Math.max(this.hitstopTimer, seconds);
      this.hitstopScale = Math.min(this.hitstopScale, scale);
    },
    shake(amount) {
      this.cameraRig.addTrauma(amount);
    },
    /** A zoom punch: the camera jumps `m` metres closer and springs back (a blade's clash). */
    punch(m) {
      this.cameraRig.punch(m);
    },
  };
  pipeline.registerParticles(game.fx.alpha);
  pipeline.registerParticles(game.fx.add);

  game.world = new World(game);
  game.audio = new AudioEngine(game);
  game.player = new Player(game);
  // the boss slot (ARCHITECTURE.md → Levels): the wyrm or the level's own boss; game.boss is the same
  game.dragon = level.createBoss(game);
  game.boss = game.dragon;
  game.hud = new Hud(game);
  game.gamepad = new GamepadControls(game); // inert until a pad is connected and used
  game.touch = new TouchControls(game); // inert on desktop; may pick the touch quality preset
  game.flow = new GameFlow(game);
  game.lab = new Lab(game);

  const applyQuality = () => {
    const q = CONFIG.quality[game.settings.quality];
    game.world.setGrassQuality?.(q.grass);
    pipeline.setShadowSize(q.shadow ?? CONFIG.render.shadowSize);
    const dpr = Math.min(q.dpr, devicePixelRatio || 1, CONFIG.render.maxPixelRatio);
    pipeline.setSize(innerWidth, innerHeight, dpr);
    // an upscaled canvas (LOW on a phone: a 1x render on a 3x screen) stays crisp: the hero's
    // 3x5 pixel letters blur into grey under the browser's smooth upscale
    game.renderer.domElement.style.imageRendering = dpr < (devicePixelRatio || 1) - 0.01 ? 'pixelated' : '';
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  game.applyQuality = applyQuality;
  applyQuality();
  addEventListener('resize', applyQuality);

  game.cameraRig.snap(game.player.position);

  // --- per-frame helpers
  const ray = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const focus = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const camFwd = new THREE.Vector3();
  const lock = new THREE.Vector3();

  const updateMouseGround = () => {
    ndc.set(game.input.mouse.ndcX, game.input.mouse.ndcY);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(groundPlane, tmp)) game.mouseGround.copy(tmp);
  };

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
    } else {
      // gentle look-ahead toward the mouse
      const mx = clamp(game.mouseGround.x - p.x, -8, 8);
      const mz = clamp(game.mouseGround.z - p.z, -8, 8);
      focus.x += mx * 0.18;
      focus.z += mz * 0.18;
    }
    if (game.flow.cameraOverride) {
      const o = game.flow.cameraOverride;
      focus.lerp(o.focus, o.weight);
      zoomOut = Math.max(zoomOut, o.zoom ?? 0);
    }
    // duel framing (after the flow's boss framing, which only ever pulls out): within a duelist's
    // reach the camera eases in (its TUNING.camera: `zoom` m at the desktop distance, scaled for the
    // phone's closer camera; gone `fade` m past `within`)
    const DC = d?.T?.camera;
    if (DC && game.state === 'boss' && d.isTargetable?.() && game.player.alive !== false) {
      const dist = Math.hypot(d.position.x - p.x, d.position.z - p.z);
      const k = 1 - clamp((dist - DC.within) / Math.max(0.5, DC.fade ?? 4), 0, 1);
      zoomOut += DC.zoom * k * (game.cameraRig.defaultDistance / CONFIG.camera.distance);
    }
    game.cameraRig.extraZoom = damp(game.cameraRig.extraZoom, zoomOut, 2.5, dt);
    game.cameraRig.update(dt, focus);
  };

  // View override (Lab model viewer; ARCHITECTURE.md → Lab → Model viewer):
  //   game.viewOverride = { pos, target, focus? } | null   (Vector3-likes, world metres)
  // applied AFTER the rig update: the camera sits at `pos` looking at `target`, and the fog centre,
  // light selection and shadow box follow `focus` (default `target`) instead of the player. The rig
  // keeps running underneath, so clearing the override snaps back to the game camera. A missing,
  // non-finite or degenerate override is ignored for that frame: it can never throw or feed NaN.
  const viewFocus = new THREE.Vector3();
  const applyViewOverride = () => {
    const o = game.viewOverride;
    if (!o) return null;
    const p = o.pos, t = o.target, f = o.focus ?? t;
    if (!p || !t || !f) return null;
    const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z;
    if (!Number.isFinite(dx + dy + dz + f.x + f.z) || dx * dx + dy * dy + dz * dz < 1e-6) return null;
    camera.position.set(p.x, p.y, p.z);
    camera.lookAt(t.x, t.y, t.z);
    camera.updateMatrixWorld();
    return viewFocus.set(f.x, Number.isFinite(f.y) ? f.y : 0, f.z);
  };

  const updateSharedUniforms = (focusOverride) => {
    U.uTime.value = game.time;
    U.uCamPos.value.copy(camera.position);
    U.uFocus.value.copy(focusOverride ?? game.player.position);
    const m = camera.matrixWorld.elements;
    U.uCamRight.value.set(m[0], m[1], m[2]).normalize();
    U.uCamUp.value.set(m[4], m[5], m[6]).normalize();
    U.uBladeUp.value.set(0, 1, 0).lerp(U.uCamUp.value, 0.55).normalize();
    // player screen position + view depth for canopy fade
    tmp.copy(game.player.position);
    tmp.y += 1.0;
    camera.getWorldDirection(camFwd);
    const depth = tmp.clone().sub(camera.position).dot(camFwd);
    tmp.project(camera);
    U.uPlayerScreen.value.set(tmp.x * 0.5 + 0.5, tmp.y * 0.5 + 0.5, depth, 0);
  };

  // --- loop
  let last = performance.now();
  let fpsAcc = 0, fpsFrames = 0;
  game.fps = 0;
  const frame = (now) => {
    requestAnimationFrame(frame);
    const realDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fpsAcc += realDt;
    fpsFrames++;
    if (fpsAcc > 0.5) {
      game.fps = Math.round(fpsFrames / fpsAcc);
      fpsAcc = 0;
      fpsFrames = 0;
    }
    tick(realDt);
  };

  // A failing module must not freeze the whole frame: log its first few errors and carry on.
  const errorCounts = new Map();
  const safe = (name, fn) => {
    try {
      fn();
    } catch (err) {
      const n = (errorCounts.get(name) ?? 0) + 1;
      errorCounts.set(name, n);
      if (n <= 3) console.error(`[${name}] update failed`, err);
    }
  };

  const tick = (realDt) => {
    let scale = game.timeScale;
    let fxScale = scale;
    if (game.hitstopTimer > 0) {
      game.hitstopTimer -= realDt;
      scale *= game.hitstopScale;
      // a freeze-frame holds the fighters, not the sparks: particles and lights run on (never
      // slower than the game, never while the game itself stands still: a pause)
      fxScale = Math.max(scale, fxScale * CONFIG.render.fxLive);
      if (game.hitstopTimer <= 0) game.hitstopScale = 1;
    }
    const dbg = game.debugTimeScale ?? 1;
    const dt = realDt * scale * dbg;
    const fxDt = realDt * fxScale * dbg;
    game.realTime += realDt;
    game.time += dt;
    game.dt = dt;
    game.fxDt = fxDt;
    game.realDt = realDt;

    if (game.input.wheel) game.cameraRig.zoom(game.input.wheel);
    updateMouseGround();
    safe('gamepad', () => game.gamepad.update(realDt)); // pad aim overrides mouseGround
    safe('touch', () => game.touch.update(realDt)); // touch aim overrides mouseGround

    safe('lab', () => game.lab.update(realDt));
    safe('flow', () => game.flow.update(dt, realDt));
    safe('player', () => game.player.update(dt));
    safe('dragon', () => game.dragon.update(dt));
    safe('lab', () => game.lab.postUpdate?.()); // hitbox overlay matches this frame
    safe('camera', () => updateCameraFocus(realDt));
    let viewAt = null;
    safe('view', () => (viewAt = applyViewOverride()));
    updateSharedUniforms(viewAt);
    safe('world', () => game.world.update(dt));
    game.lights.update(fxDt, viewAt ?? game.player.position);
    game.fx.alpha.update(fxDt, game.time);
    game.fx.add.update(fxDt, game.time);
    safe('hud', () => game.hud.update(realDt));
    safe('audio', () => game.audio.update(realDt));

    pipeline.updateShadowCamera(viewAt ?? game.cameraRig.focus);
    pipeline.render();
    safe('lab', () => game.lab.postRender?.()); // the model viewer's sheet reads the frame back
    if (inspect.rect) inspect.draw();
    game.input.endFrame();
  };
  requestAnimationFrame(frame);

  // Dev aid: advance the simulation manually (works even when rAF is throttled), e.g.
  // window.__tick(1 / 60, 120) runs two seconds of game time.
  window.__tick = (dt = 1 / 60, frames = 1) => {
    for (let i = 0; i < frames; i++) tick(Math.min(0.05, dt));
    return { state: game.state, time: +game.time.toFixed(2) };
  };

  // Dev aid: window.__inspect(x, y, w, h) magnifies a device-pixel region of the live frame
  // into a full-window overlay (nearest-neighbour); window.__inspect() hides it.
  const inspect = {
    rect: null,
    canvas: null,
    draw() {
      const [x, y, w, h] = this.rect;
      const c = this.canvas;
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(renderer.domElement, x, y, w, h, 0, 0, w, h);
    },
  };
  window.__inspect = (x, y, w, h) => {
    if (x === undefined) {
      inspect.rect = null;
      inspect.canvas?.remove();
      inspect.canvas = null;
      return 'off';
    }
    if (!inspect.canvas) {
      inspect.canvas = document.createElement('canvas');
      inspect.canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;z-index:50;background:#000;pointer-events:none';
      document.body.appendChild(inspect.canvas);
    }
    inspect.rect = [x, y, w, h];
    return [renderer.domElement.width, renderer.domElement.height];
  };
  window.__game = game; // handy for debugging in the console
}

boot().catch((err) => {
  console.error(err);
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:0;margin:0;padding:24px;color:#f88;background:#000;font:14px monospace;white-space:pre-wrap;z-index:99';
  el.textContent = `ABYSS failed to start:\n\n${err?.stack || err}`;
  document.body.appendChild(el);
});
