import { CONFIG } from '../core/config.js';
import { TAU } from '../core/math.js';
import { el, num } from './dom.js';

// Top-right minimap (canvas 2D). The static clearing (canopies, stone ring, boulders, nest) is
// baked once into an offscreen layer; the live layer (bonfire flicker, dragon, player arrow) is
// redrawn at ~30 Hz. North (world -Z) is up, +X is right — the same as the game camera.

const SIZE = 170; // CSS px
const RANGE = 40; // meters from map centre to edge
const DRAW_HZ = 30;
const SLEEPY = new Set(['sleeping', 'dying', 'dead']);

export class Minimap {
  constructor(game, parent) {
    this.game = game;
    this.root = el('div', 'ab-map ab-panel ab-play', null, parent);
    el('div', 'ab-map-zone', 'CINDERWOOD HOLLOW', this.root);
    this.canvas = el('canvas', '', null, this.root);
    this.dpr = Math.min(2, Math.max(1, num(window.devicePixelRatio, 1)));
    this.canvas.width = this.canvas.height = Math.round(SIZE * this.dpr);
    this.ctx = this.canvas.getContext('2d');
    this.coordEl = el('div', 'ab-map-line', '', this.root);
    this.fpsEl = el('div', 'ab-map-line fps', '', this.root);
    this.scale = (SIZE / 2 - 5) / RANGE; // px per meter
    this.layer = null;
    this.layerTried = false;
    this.t = 0;
    this.drawAcc = 1;
    this.textAcc = 1;
    this._coord = '';
    this._fps = '';
    this._fpsOn = null;
  }

  update(dt) {
    this.t += dt;
    if (!this.layerTried) {
      this.layerTried = true;
      try {
        this.layer = this._bake();
      } catch (err) {
        console.warn('[hud] minimap bake failed', err);
      }
    }
    this.drawAcc += dt;
    if (this.drawAcc >= 1 / DRAW_HZ && this.ctx) {
      this.drawAcc = 0;
      this._draw();
    }
    this.textAcc += dt;
    if (this.textAcc >= 0.12) {
      this.textAcc = 0;
      this._text();
    }
  }

  _text() {
    const g = this.game;
    const p = g.player?.position;
    if (p) {
      const s = `X ${num(p.x).toFixed(1)}  ·  Z ${num(p.z).toFixed(1)}`;
      if (s !== this._coord) {
        this._coord = s;
        this.coordEl.textContent = s;
      }
    }
    const on = !!g.settings?.showFps;
    if (on !== this._fpsOn) {
      this._fpsOn = on;
      this.fpsEl.classList.toggle('on', on);
    }
    if (on) {
      const q = CONFIG.quality[g.settings.quality]?.name ?? '';
      const s = `FPS ${Math.round(num(g.fps))}  ·  ${q}`;
      if (s !== this._fps) {
        this._fps = s;
        this.fpsEl.textContent = s;
      }
    }
  }

  _bake() {
    const g = this.game;
    const cv = document.createElement('canvas');
    cv.width = cv.height = this.canvas.width;
    const c = cv.getContext('2d');
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const C = SIZE / 2, R = C - 1.5, s = this.scale;
    const arena = CONFIG.world.arenaRadius;

    c.save();
    c.beginPath();
    c.arc(C, C, R, 0, TAU);
    c.clip();
    // forest floor + clearing
    c.fillStyle = '#060b0c';
    c.fillRect(0, 0, SIZE, SIZE);
    const grd = c.createRadialGradient(C, C, 0, C, C, arena * s);
    grd.addColorStop(0, 'rgba(36, 54, 50, 0.95)');
    grd.addColorStop(1, 'rgba(22, 35, 33, 0.95)');
    c.fillStyle = grd;
    c.beginPath();
    c.arc(C, C, (arena + 0.8) * s, 0, TAU);
    c.fill();
    // southern path out of the clearing
    c.fillStyle = 'rgba(22, 35, 33, 0.95)';
    c.fillRect(C - 4.2 * s, C + (arena - 3) * s, 8.4 * s, 20 * s);
    // faint 10 m grid
    c.strokeStyle = 'rgba(207, 214, 230, 0.045)';
    c.lineWidth = 1;
    for (let m = -RANGE; m <= RANGE; m += 10) {
      const v = Math.round(C + m * s) + 0.5;
      c.beginPath();
      c.moveTo(v, 0);
      c.lineTo(v, SIZE);
      c.moveTo(0, v);
      c.lineTo(SIZE, v);
      c.stroke();
    }
    // canopies (overlapping translucent blobs read as a forest mass)
    const spots = g.world?.forest?.treeSpots;
    const circles = g.world?.colliders?.circles ?? [];
    if (Array.isArray(spots) && spots.length) {
      c.fillStyle = 'rgba(46, 78, 64, 0.42)';
      for (const t of spots) {
        if (Math.hypot(t.x, t.z) > RANGE + 6) continue;
        c.beginPath();
        c.arc(C + t.x * s, C + t.z * s, Math.max(2, num(t.r, 2.5) * s * 0.8), 0, TAU);
        c.fill();
      }
    }
    // arena edge
    c.setLineDash([2, 3]);
    c.strokeStyle = 'rgba(207, 214, 230, 0.22)';
    c.beginPath();
    c.arc(C, C, arena * s, 0, TAU);
    c.stroke();
    c.setLineDash([]);
    // trunks, stones, boulders
    for (const k of circles) {
      const x = C + k.x * s, y = C + k.z * s;
      if (k.tag === 'trunk') {
        c.fillStyle = 'rgba(96, 128, 108, 0.75)';
        c.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
      } else if (k.tag === 'stone') {
        c.fillStyle = '#b4bccb';
        c.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
      } else if (k.tag === 'boulder') {
        c.fillStyle = 'rgba(132, 142, 158, 0.85)';
        c.beginPath();
        c.arc(x, y, Math.max(1.2, num(k.r, 1) * s * 0.75), 0, TAU);
        c.fill();
      }
    }
    // the nest (bones)
    const nest = g.world?.nest;
    if (nest) {
      c.fillStyle = 'rgba(214, 200, 176, 0.6)';
      c.font = '700 10px "JetBrains Mono", monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('×', C + nest.x * s, C + nest.z * s);
    }
    c.restore();

    // rim + north marker
    c.strokeStyle = 'rgba(207, 214, 230, 0.38)';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(C, C, R, 0, TAU);
    c.stroke();
    c.fillStyle = 'rgba(6, 9, 14, 0.9)';
    c.beginPath();
    c.arc(C, 8, 6.5, 0, TAU);
    c.fill();
    c.stroke();
    c.fillStyle = '#eef1f8';
    c.font = '700 9px "JetBrains Mono", monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', C, 8.5);
    return cv;
  }

  _draw() {
    const g = this.game, c = this.ctx, s = this.scale, C = SIZE / 2;
    const maxR = RANGE - 1.5;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, SIZE, SIZE);
    if (this.layer) c.drawImage(this.layer, 0, 0, SIZE, SIZE);
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    // bonfire
    const bf = g.world?.bonfire;
    if (bf) {
      c.globalAlpha = 0.72 + 0.28 * Math.sin(this.t * 9.1) * Math.sin(this.t * 5.3);
      c.fillStyle = '#ff8a3d';
      c.font = '700 9px "JetBrains Mono", monospace';
      c.fillText('▲', C + bf.x * s, C + bf.z * s);
      c.globalAlpha = 1;
    }

    // dragon (only once awake)
    const d = g.dragon;
    if (d?.position && d.state && !SLEEPY.has(d.state)) {
      let x = num(d.position.x), z = num(d.position.z);
      const r = Math.hypot(x, z);
      if (r > maxR) {
        x *= maxR / r;
        z *= maxR / r;
      }
      const mx = C + x * s, my = C + z * s;
      const pulse = (this.t * 1.3) % 1;
      c.globalAlpha = 1 - pulse;
      c.strokeStyle = '#ff4a2e';
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(mx, my, 3.5 + pulse * 8, 0, TAU);
      c.stroke();
      c.globalAlpha = 1;
      c.fillStyle = d.phase >= 3 ? '#ffd08a' : d.phase === 2 ? '#ff8a3d' : '#ff4a2e';
      c.beginPath();
      c.arc(mx, my, 3.4, 0, TAU);
      c.fill();
    }

    // player arrow, pointing along yaw (facing = (sin yaw, cos yaw) in x/z = right/down on the map)
    const p = g.player;
    if (p?.position) {
      let x = num(p.position.x), z = num(p.position.z);
      const r = Math.hypot(x, z);
      if (r > maxR) {
        x *= maxR / r;
        z *= maxR / r;
      }
      const yaw = num(p.yaw, Math.PI);
      const dx = Math.sin(yaw), dy = Math.cos(yaw);
      const px = -dy, py = dx;
      const mx = C + x * s, my = C + z * s;
      c.beginPath();
      c.moveTo(mx + dx * 6.5, my + dy * 6.5);
      c.lineTo(mx - dx * 3.5 + px * 3.8, my - dy * 3.5 + py * 3.8);
      c.lineTo(mx - dx * 1.6, my - dy * 1.6);
      c.lineTo(mx - dx * 3.5 - px * 3.8, my - dy * 3.5 - py * 3.8);
      c.closePath();
      c.fillStyle = '#f2f5fb';
      c.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      c.lineWidth = 1;
      c.fill();
      c.stroke();
    }
  }
}
