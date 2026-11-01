import * as THREE from 'three';
import { TELL_STYLE } from '../combat/rules.js';
import { el, num } from './dom.js';

// Combat tell indicators (Phantom-Blade-Zero style). On 'combat:tell' a mark appears above the
// attacker at windup start and stays until just after impact:
//   blue   ◆ PARRY  — a closing ring shows the time left to impact
//   red    ! DODGE  — pulsing glow, closing ring, and the screen edges pulse red (stronger on the
//                     attacker's side) so the cue is seen even when the attacker is off-centre
//   normal +        — a small white glint, no text
// 'combat:flash' (the timing cue, ~0.35 s before impact) pops the mark. One mark per attacker —
// the latest tell wins. A stagger / posture break / death, a parry (for hits still ahead) or the
// dragon going back to sleep drops its mark. The timeline runs on game time, so slow-mo, pause and
// the Lab time scale stretch it consistently with the attack itself. Off-screen attackers get an
// edge-clamped mark with an arrow pointing at them.

const ANCHOR_UP = 3; // m above the attacker's lock point (contract)
const FADE = 0.25; // s: fade-out after impact
const DEFAULT_IMPACT = 1.0; // s, when the event carries no usable impactIn
const MAX_LIFE = 8; // s: safety net for marks whose impact never comes
const POP = 0.16; // s: pop-in
const RING_FROM = 2.7; // ring scale at windup start (closes to 1 at impact)
const EDGE_PX = 52; // off-screen marks are clamped this far inside the window
const SOURCES_MAX = 6;
const CANCEL_AHEAD = 0.1; // s: on a parry, marks whose impact is further ahead than this are dropped
// the dragon cannot be winding up an attack in these states (reset / rest / Lab reset emit no event)
const DRAGON_IDLE = new Set(['sleeping', 'dying', 'dead']);

const easeOutBack = (t) => {
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

class Mark {
  constructor(layer) {
    this.node = el('div', 'ab-tell', null, layer);
    this.arrowWrap = el('div', 'ab-tell-arrow', null, this.node);
    el('span', '', '▲', this.arrowWrap);
    this.inner = el('div', 'in', null, this.node);
    const box = el('div', 'gbox', null, this.inner);
    this.ring = el('div', 'ring', null, box);
    this.glyph = el('span', 'gl', '', box);
    this.label = el('div', 'lb', '', this.inner);
    this.source = null;
    this.tell = 'normal';
    this.active = false;
    this.t0 = 0;
    this.impactAt = 0;
    this.span = 1;
    this.flashAt = -1;
    this.x = NaN;
    this.z = NaN;
    this.alpha = 0; // current opacity (read by the edge glow)
    this.sx = 0; // last screen position (read by the edge glow)
    this.sy = 0;
    // last written values (skip redundant DOM writes)
    this._pos = '';
    this._in = '';
    this._op = -1;
    this._ring = '';
    this._ringOp = -1;
    this._arrow = '';
    this._edge = null;
    this._flash = null;
  }

  start(source, tell, impactIn, now, x, z) {
    const style = TELL_STYLE[tell] ?? TELL_STYLE.normal;
    this.source = source;
    this.tell = tell;
    this.active = true;
    this.t0 = now;
    const imp = num(impactIn, DEFAULT_IMPACT);
    this.span = Math.max(0.15, Math.min(6, imp > 0 ? imp : DEFAULT_IMPACT));
    this.impactAt = now + this.span;
    this.flashAt = -1;
    this.x = num(x, NaN);
    this.z = num(z, NaN);
    this.node.className = `ab-tell on t-${tell}`;
    this.glyph.textContent = style.glyph || '+';
    this.label.textContent = style.label || '';
    this._op = -1;
    this._ringOp = -1;
    this._in = '';
    this._ring = '';
    this._edge = null;
    this._flash = null;
  }

  flash(now) {
    if (!this.active) return;
    this.flashAt = now;
  }

  hide() {
    if (!this.active) return;
    this.active = false;
    this.alpha = 0;
    this.node.className = 'ab-tell';
  }
}

export class TellMarks {
  constructor(game, parent, projector) {
    this.game = game;
    this.proj = projector;
    this.layer = el('div', 'ab-tells ab-play', null, parent);
    this.edges = new EdgeGlow(parent);
    this.marks = [];
    this.anchor = new THREE.Vector3();
    this.p = { x: 0, y: 0, on: false, front: false };
    this.hasRed = false;
    const ev = game.events;
    ev?.on('combat:tell', (d) => this._onTell(d));
    ev?.on('combat:flash', (d) => this._onFlash(d));
    // a cancelled windup never lands: drop the attacker's mark
    for (const name of ['dragon:stagger', 'dragon:postureBreak', 'dragon:death']) ev?.on(name, () => this.clear('dragon'));
    // a parry ends the attacker's string: the parried hit's mark fades out, a later hit's mark goes
    ev?.on('dragon:parried', () => this._cancelAhead('dragon'));
    ev?.on('game:retry', () => this.clear());
    ev?.on('state', (e) => {
      const to = e?.to;
      // (resuming from pause keeps the marks: the windup is frozen, not cancelled)
      if (to === 'title' || to === 'dead' || to === 'victory' || (to === 'explore' && e?.from !== 'paused')) this.clear();
    });
  }

  /** True while any mark is visible (the dragon name tag dims under it). */
  get active() {
    for (const m of this.marks) if (m.active) return true;
    return false;
  }

  clear(source = null) {
    for (const m of this.marks) if (m.active && (source === null || m.source === source)) m.hide();
  }

  _cancelAhead(source) {
    const now = num(this.game.time);
    for (const m of this.marks) if (m.active && m.source === source && m.impactAt - now > CANCEL_AHEAD) m.hide();
  }

  _onTell(d) {
    if (!d || typeof d !== 'object') return;
    const tell = TELL_STYLE[d.tell] ? d.tell : 'normal';
    const source = String(d.source ?? 'dragon');
    const now = num(this.game.time);
    let mark = this.marks.find((m) => m.source === source);
    if (!mark) mark = this.marks.find((m) => !m.active);
    if (!mark) {
      if (this.marks.length < SOURCES_MAX) {
        mark = new Mark(this.layer);
        this.marks.push(mark);
      } else {
        // all slots busy: recycle the oldest
        mark = this.marks.reduce((a, b) => (a.t0 <= b.t0 ? a : b));
      }
    }
    mark.start(source, tell, d.impactIn, now, d.x, d.z);
  }

  _onFlash(d) {
    if (!d || typeof d !== 'object') return;
    const source = String(d.source ?? 'dragon');
    const mark = this.marks.find((m) => m.active && m.source === source);
    if (mark) mark.flash(num(this.game.time));
  }

  /** World anchor of a mark: the dragon's lock point, else the event position, + ANCHOR_UP. */
  _anchor(mark) {
    const a = this.anchor;
    const d = this.game.dragon;
    if (mark.source === 'dragon' && d) {
      let ok = false;
      if (typeof d.lockPoint === 'function') {
        try {
          d.lockPoint(a);
          ok = Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
        } catch {
          ok = false;
        }
      }
      if (!ok && d.position) {
        a.set(num(d.position.x), 2.4, num(d.position.z));
        ok = Number.isFinite(a.x) && Number.isFinite(a.z);
      }
      if (ok) {
        a.y += ANCHOR_UP;
        return a;
      }
    }
    if (Number.isFinite(mark.x) && Number.isFinite(mark.z)) return a.set(mark.x, 2.5 + ANCHOR_UP, mark.z);
    return null;
  }

  update(realDt) {
    const g = this.game;
    const now = num(g.time);
    const rt = num(g.realTime);
    const W = this.proj.w;
    const H = this.proj.h;
    const dragonIdle = DRAGON_IDLE.has(g.dragon?.state);
    let red = 0;
    let rx = W * 0.5;
    let ry = H * 0.5;
    for (const m of this.marks) {
      if (!m.active) continue;
      const age = now - m.t0;
      const toImpact = m.impactAt - now;
      if (toImpact < -FADE || age > MAX_LIFE || age < -1 || (dragonIdle && m.source === 'dragon')) {
        m.hide();
        continue;
      }
      const a = toImpact < 0 ? clamp01(1 + toImpact / FADE) : 1;

      // --- position (edge-clamped when off-screen)
      const anchor = this._anchor(m);
      const p = this.p;
      if (!anchor || !this.proj.project(anchor.x, anchor.y, anchor.z, p)) {
        m.hide();
        continue;
      }
      let x = p.x;
      let y = p.y;
      const edge = !p.on;
      if (edge) {
        x = Math.min(W - EDGE_PX, Math.max(EDGE_PX, x));
        y = Math.min(H - EDGE_PX, Math.max(EDGE_PX + 20, y));
      }
      m.sx = p.x;
      m.sy = p.y;
      const pos = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      if (pos !== m._pos) {
        m._pos = pos;
        m.node.style.transform = pos;
      }
      if (edge !== m._edge) {
        m._edge = edge;
        m.node.classList.toggle('edge', edge);
      }
      if (edge) {
        // arrow orbits the clamped mark, pointing from the screen centre toward the attacker
        const deg = (Math.atan2(p.x - W * 0.5, -(p.y - H * 0.5)) * 180) / Math.PI;
        const rot = `rotate(${deg.toFixed(0)}deg)`;
        if (rot !== m._arrow) {
          m._arrow = rot;
          m.arrowWrap.style.transform = rot;
        }
      }

      // --- scale: pop-in, then a punch on the flash (the timing cue)
      const pin = clamp01(age / POP);
      let s = pin < 1 ? 0.5 + 0.5 * easeOutBack(pin) : 1;
      const flashed = m.flashAt >= 0 && now >= m.flashAt;
      if (flashed) s *= 1 + 0.55 * Math.exp(-(now - m.flashAt) * 8);
      if (toImpact < 0) s *= 1 + 0.25 * (1 - a);
      const inT = `translate(-50%, ${edge ? -50 : -100}%) scale(${s.toFixed(3)})`;
      if (inT !== m._in) {
        m._in = inT;
        m.inner.style.transform = inT;
      }
      const flashOn = flashed && toImpact > -0.05;
      if (flashOn !== m._flash) {
        m._flash = flashOn;
        m.node.classList.toggle('flash', flashOn);
      }
      const op = Math.round(a * 100) / 100;
      if (op !== m._op) {
        m._op = op;
        m.inner.style.opacity = String(op);
      }
      m.alpha = a;

      // --- closing ring (blue / red): reaches the glyph exactly at impact
      if (m.tell !== 'normal') {
        const left = clamp01(toImpact / m.span);
        const rs = 1 + (RING_FROM - 1) * left;
        const ring = `scale(${rs.toFixed(3)})`;
        if (ring !== m._ring) {
          m._ring = ring;
          m.ring.style.transform = ring;
        }
        const ro = Math.round((toImpact > 0 ? 0.3 + 0.7 * (1 - left) : a) * 100) / 100;
        if (ro !== m._ringOp) {
          m._ringOp = ro;
          m.ring.style.opacity = String(ro);
        }
      }

      // --- red screen-edge pulse: subtle while winding up, strong on the flash
      if (m.tell === 'red') {
        let r = 0.16 + 0.12 * (0.5 + 0.5 * Math.sin(rt * Math.PI * 2 * 3.2));
        if (flashed) r += 0.62 * Math.exp(-(now - m.flashAt) * 5);
        r *= a;
        if (r > red) {
          red = r;
          rx = p.x;
          ry = p.y;
        }
      }
    }
    // paused: the marks freeze with game time, but the edges must not keep throbbing under the menu
    this.edges.update(realDt, g.state === 'paused' ? 0 : red, rx, ry, W, H);
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
    // fast attack, softer release (no flicker when a mark is replaced)
    const t = clamp01(num(target, 0));
    this.red = t > this.red ? t : Math.max(t, this.red - dt * 2.5);
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
