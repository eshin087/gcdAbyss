import { TELL } from '../combat/rules.js';
import { el, num } from './dom.js';

// Screen-edge cues. The attack tells themselves live in the world (docs/COMBAT.md): the attacker
// glows red through a dodge-only windup and glints white on a parryable hit's timing cue. The HUD
// adds no text, icons or rings — only:
//   red   a brief red vignette flash (~0.25 s, fading) on the timing cue ('combat:flash') of a red
//         (dodge-only) hit, a little stronger on the attacker's side of the screen. Nothing during
//         the windup, nothing for normal / blue hits.
//   cyan  the Ghostep pulse (driven by the HUD).
// The red flash runs on game time, so slow-mo and the Lab time scale stretch it with the attack.
// A cancelled windup (stagger / posture break / death) or a reset drops it.

const RED_TIME = 0.25; // s (game time): the red flash fades out over this
const RED_PEAK = 0.85; // edge opacity at the cue (x the per-side weight)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class TellEdges {
  constructor(game, parent, projector) {
    this.game = game;
    this.proj = projector;
    this.edges = new EdgeGlow(parent);
    this.p = { x: 0, y: 0, on: false, front: false };
    this.redAt = -1; // game time of the last red timing cue (-1 = none showing)
    this.rx = NaN; // its world position (the striking part): weights the edges toward the attacker
    this.ry = NaN;
    this.rz = NaN;
    const ev = game.events;
    ev?.on('combat:flash', (d) => this._onFlash(d));
    for (const name of ['dragon:stagger', 'dragon:postureBreak', 'dragon:death']) ev?.on(name, () => this.clear());
    ev?.on('game:retry', () => this.clear());
    ev?.on('state', (e) => {
      const to = e?.to;
      // (resuming from pause keeps the flash: game time froze with it)
      if (to === 'title' || to === 'dead' || to === 'victory' || (to === 'explore' && e?.from !== 'paused')) this.clear();
    });
  }

  clear() {
    this.redAt = -1;
  }

  _onFlash(d) {
    // self-announcing fire hazards (meteors, chase pillars: d.hazard) warn with their own ground rings;
    // flashing the screen edge for each one made a meteor rain pulse the whole HUD
    if (!d || typeof d !== 'object' || d.tell !== TELL.RED || d.hazard) return;
    this.redAt = num(this.game.time);
    this.rx = num(d.x, NaN);
    this.ry = num(d.y, 2);
    this.rz = num(d.z, NaN);
  }

  update(realDt) {
    const g = this.game;
    const W = this.proj.w;
    const H = this.proj.h;
    let red = 0;
    let sx = W * 0.5;
    let sy = H * 0.5;
    // paused: the flash freezes with game time, but the edges must not glow under the menu
    if (this.redAt >= 0 && g.state !== 'paused') {
      const age = num(g.time) - this.redAt;
      if (!(age >= 0) || age >= RED_TIME) this.redAt = -1;
      else {
        const f = 1 - age / RED_TIME;
        red = RED_PEAK * f * (0.4 + 0.6 * f);
        if (this.proj.project(this.rx, this.ry, this.rz, this.p)) {
          sx = this.p.x;
          sy = this.p.y;
        }
      }
    }
    this.edges.update(realDt, red, sx, sy, W, H);
  }

  /** Cool cyan edge pulse for Ghostep (driven by the HUD). */
  ghost(amount) {
    this.edges.ghostPulse(amount);
  }
}

/** Screen-edge glows: red (direction-weighted toward the attacker) + a cool cyan Ghostep pulse. */
class EdgeGlow {
  constructor(parent) {
    this.root = el('div', 'ab-edges', null, parent);
    this.sides = ['l', 'r', 't', 'b'].map((k) => ({ node: el('div', `ab-edge ${k}`, null, this.root), op: -1 }));
    this.cool = el('div', 'ab-edge-cool', null, this.root);
    this.coolOp = -1;
    this.coolAmt = 0;
    this.red = 0;
    this.w = [0, 0, 0, 0]; // per-side weights l r t b (reused)
  }

  ghostPulse(amount = 1) {
    this.coolAmt = Math.max(this.coolAmt, clamp01(num(amount, 1)));
  }

  update(dt, target, x, y, W, H) {
    dt = num(dt, 0);
    // instant attack; the release only smooths a clear / pause (the flash's own fade is slower)
    const t = clamp01(num(target, 0));
    this.red = t >= this.red ? t : Math.max(t, this.red - dt * 6);
    const dx = Math.max(-1, Math.min(1, (num(x, W / 2) - W / 2) / (W / 2)));
    const dy = Math.max(-1, Math.min(1, (num(y, H / 2) - H / 2) / (H / 2)));
    const w = this.w;
    w[0] = 0.4 + 0.6 * Math.max(0, -dx);
    w[1] = 0.4 + 0.6 * Math.max(0, dx);
    w[2] = 0.4 + 0.6 * Math.max(0, -dy);
    w[3] = 0.4 + 0.6 * Math.max(0, dy);
    for (let i = 0; i < 4; i++) {
      const s = this.sides[i];
      const op = Math.round(this.red * w[i] * 100) / 100;
      if (op !== s.op) {
        s.op = op;
        s.node.style.opacity = String(op);
      }
    }
    if (this.coolAmt > 0) this.coolAmt = Math.max(0, this.coolAmt - dt * 1.4);
    const cop = Math.round(this.coolAmt * 100) / 100;
    if (cop !== this.coolOp) {
      this.coolOp = cop;
      this.cool.style.opacity = String(cop);
    }
  }
}
