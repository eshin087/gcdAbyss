import * as THREE from 'three';
import { el, num } from './dom.js';

// World-anchored overlays: small white name tags above the player and the (awake) dragon, plus the
// rotating lock-on reticle. Projected with the game camera each frame and moved with transforms only.

const AWAKE_HIDDEN = new Set(['sleeping', 'dying', 'dead']);

class Tag {
  constructor(layer, className, text) {
    this.node = el('div', className, null, layer);
    this.label = el('span', '', text, this.node);
    this.on = false;
    this.x = -1e4;
    this.y = -1e4;
  }
  show(on) {
    if (on === this.on) return;
    this.on = on;
    this.node.classList.toggle('on', on);
  }
  moveTo(x, y) {
    if (Math.abs(x - this.x) < 0.3 && Math.abs(y - this.y) < 0.3) return;
    this.x = x;
    this.y = y;
    this.node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  }
}

export class NameTags {
  constructor(game, parent) {
    this.game = game;
    this.layer = el('div', 'ab-tags ab-play', null, parent);
    this.player = new Tag(this.layer, 'ab-tag', 'Wanderer');
    this.dragon = new Tag(this.layer, 'ab-tag foe', 'Vaelgrim');
    this.reticle = new Tag(this.layer, 'ab-tag ab-reticle', '◇');
    this.v = new THREE.Vector3();
    this.lock = new THREE.Vector3();
    this.w = window.innerWidth || 1;
    this.h = window.innerHeight || 1;
    addEventListener('resize', () => {
      this.w = window.innerWidth || 1;
      this.h = window.innerHeight || 1;
    });
  }

  /** Project world (x,y,z) into the tag; hides it when behind the camera or off-screen. */
  _place(tag, x, y, z) {
    const cam = this.game.camera;
    if (!cam || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return tag.show(false);
    const v = this.v.set(x, y, z).project(cam);
    if (!(v.z > -1 && v.z < 1) || v.x < -1.08 || v.x > 1.08 || v.y < -1.08 || v.y > 1.12) return tag.show(false);
    tag.moveTo((v.x * 0.5 + 0.5) * this.w, (0.5 - v.y * 0.5) * this.h);
    tag.show(true);
  }

  update() {
    const g = this.game;
    const st = g.state;
    const visible = st !== 'title';

    const p = g.player;
    if (visible && p?.position) {
      this._place(this.player, num(p.position.x), num(p.position.y) + 2.2, num(p.position.z));
    } else this.player.show(false);

    const d = g.dragon;
    const awake = !!(d?.state && !AWAKE_HIDDEN.has(d.state));
    let lockOk = false;
    if (visible && d && (awake || p?.lockOn)) {
      if (typeof d.lockPoint === 'function') {
        try {
          d.lockPoint(this.lock);
          lockOk = Number.isFinite(this.lock.x) && Number.isFinite(this.lock.y) && Number.isFinite(this.lock.z);
        } catch {
          lockOk = false;
        }
      }
      if (!lockOk && d.position) {
        this.lock.copy(d.position);
        this.lock.y += 2;
        lockOk = true;
      }
    }

    if (visible && awake && lockOk) this._place(this.dragon, this.lock.x, this.lock.y + 2, this.lock.z);
    else this.dragon.show(false);

    const targetable = typeof d?.isTargetable === 'function' ? !!d.isTargetable() : awake;
    if (visible && p?.lockOn && targetable && lockOk) this._place(this.reticle, this.lock.x, this.lock.y, this.lock.z);
    else this.reticle.show(false);
  }
}
