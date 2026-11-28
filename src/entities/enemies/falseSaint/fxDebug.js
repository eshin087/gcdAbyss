// The False Saint's effects driven alone (the FX AGENT's file), before the moves use them: the Lab and the
// film rig call `dragon.debug.fx(name, opts)`, which calls `run(d, name, opts)` here (saint.js); FsFx.update
// then steps the timeline every frame (`step(d, drive, dt)`, fx time) until it returns false. `d` is the
// boss (d.fx the FsFx). Each driver calls the FsFx methods with the arguments of the contract (fx.js
// header), as a move will: every frame for the held ones, once for the others. Nothing here deals damage
// or breaks the world (the flights fly with `expect: false` and no onLand: drawn only).
//
// opts (all optional): x, z the target (default: the hero where he stands, or 7 m in front of him); part;
// k; n (sensors); life (afterimage). One driver per effect, and one per move that strings them together:
//   jet jets rosaryJets jetBurst afterimage dashTrail vespers sensor death shellFlake shellStrip coreVent
//   transition2 transition3 transition4 sightLine vigil passingBell absolution revelation triptych choir
//   kyrie verdict lastRite pour sparks palmHit footPlant hitMetal · 'stopAll' ends the one playing
// (the sheets: docs/looks/foundry/fs-fx-*.jpg are filmed from these)

const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const TAU = Math.PI * 2;
const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);
/** s crossed this frame (once-effects). */
const cross = (prev, t, s) => prev < s && t >= s;
const ramp = (t, a, b) => clamp01((t - a) / (b - a));

const _e = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };

/** The target spot: opts, else the hero (within 22 m), else 7 m in front of him. Writes o._tx / o._tz once. */
function target(d, o) {
  if (Number.isFinite(o._tx)) return;
  const p = d.game?.player?.position, dp = d.position, y = fin(d.yaw, 0);
  if (Number.isFinite(o.x) && Number.isFinite(o.z)) {
    o._tx = o.x;
    o._tz = o.z;
  } else if (p && Math.hypot(p.x - dp.x, p.z - dp.z) < 22) {
    o._tx = p.x;
    o._tz = p.z;
  } else {
    o._tx = dp.x + Math.sin(y) * 7;
    o._tz = dp.z + Math.cos(y) * 7;
  }
  // his line to it, and across it
  const dx = o._tx - dp.x, dz = o._tz - dp.z, l = Math.hypot(dx, dz) || 1;
  o._ux = dx / l;
  o._uz = dz / l;
  o._dist = l;
}
const eye = (d) => (d.eyePoint ? d.eyePoint(d.fx._eyeV) : _e.set(d.position.x, 2, d.position.z));

const DRIVERS = {
  jet: { dur: 1.2, frame: (d, t, o) => d.fx.jet(o.part ?? 'elbowR', fin(o.k, Math.sin(Math.min(1, t / 1.2) * Math.PI))) },
  jets: {
    dur: 1.6,
    frame: (d, t, o) => {
      const k = fin(o.k, Math.sin(Math.min(1, t / 1.6) * Math.PI));
      for (const p of ['elbowR', 'elbowL', 'back', 'calfR', 'calfL']) d.fx.jet(p, k);
    },
  },
  rosaryJets: { dur: 1.5, frame: (d, t) => { d.fx.jet('elbowR', 0.9, 0.8); d.fx.jet('elbowL', 0.9, 0.8); } },
  jetBurst: {
    dur: 0.6,
    frame: (d, t, o, prev) => {
      if (cross(prev, t, 0.02)) d.fx.jetBurst(d.position.x, d.position.z, Math.sin(d.yaw), Math.cos(d.yaw), fin(o.k, 1));
    },
  },
  afterimage: {
    dur: 1.4,
    frame: (d, t, o, prev) => {
      if (cross(prev, t, 0.02)) d.fx.afterimage(d, -Math.sin(d.yaw), -Math.cos(d.yaw), fin(o.life, 1.0));
    },
  },
  dashTrail: {
    dur: 1.0,
    frame: (d, t, o, prev) => {
      target(d, o);
      if (cross(prev, t, 0.02)) {
        const x = d.position.x, z = d.position.z, L = Math.min(10, o._dist + 2);
        d.fx.jetBurst(x, z, o._ux, o._uz, 1);
        d.fx.dashTrail(x, z, x + o._ux * L, z + o._uz * L, 1);
        d.fx.afterimage(d, o._ux, o._uz, 0.7);
      }
    },
  },
  vespers: {
    // four passes criss-crossing through the target, afterimages hanging on each line, the last from above
    dur: 3.4,
    frame: (d, t, o, prev) => {
      target(d, o);
      for (let i = 0; i < 4; i++) {
        const at = 0.1 + i * 0.7;
        if (!cross(prev, t, at)) continue;
        const a = (i * 0.9 + 0.4) * Math.PI, R = 7, cx = o._tx, cz = o._tz;
        const ax = cx - Math.cos(a) * R, az = cz - Math.sin(a) * R, bx = cx + Math.cos(a) * R, bz = cz + Math.sin(a) * R;
        d.fx.jetBurst(ax, az, Math.cos(a), Math.sin(a), 1);
        d.fx.dashTrail(ax, az, bx, bz, 1.2);
        for (let j = 0; j < 3; j++) {
          const u = 0.2 + j * 0.3;
          d.fx.afterimage(d, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 1.3, ax + (bx - ax) * u - d.position.x, az + (bz - az) * u - d.position.z);
        }
      }
      if (cross(prev, t, 2.9)) d.fx.blast(o._tx, o._tz, 2.2, 1.4);
    },
  },
  sensor: { dur: 2.0, frame: (d, t, o) => d.fx._sensorDraw(Math.max(1, Math.min(3, fin(o.n, 3))), 1) },
  death: {
    // the three sensors going out one by one (the last lit first), the core's light failing
    dur: 2.4,
    frame: (d, t, o, prev) => {
      if (prev <= 0) d.fx._sens.out.fill(false);
      const T = [0.45, 1.05, 1.65];
      for (let i = 0; i < 3; i++) if (cross(prev, t, T[i])) d.fx.sensorOut(2 - i);
      d.fx._sensorDraw(3, 1, true);
      const k = Math.max(0, 1 - t / 1.9);
      if (k > 0.02) d.fx._coreGlow(0.55 * k * (0.75 + 0.25 * Math.sin(t * 40)), false);
      if (t + 0.02 >= 2.4) d.fx._sens.out.fill(false);
    },
  },
  shellFlake: {
    dur: 1.0,
    frame: (d, t, o, prev) => {
      for (const s of [0.02, 0.35, 0.65]) {
        if (!cross(prev, t, s)) continue;
        const y = d.yaw, side = s === 0.35 ? -1 : 1;
        const pt = { x: d.position.x + Math.sin(y) * 0.2 + Math.cos(y) * 0.15 * side, y: 1.3 + s * 0.4, z: d.position.z + Math.cos(y) * 0.2 - Math.sin(y) * 0.15 * side };
        d.fx.shellFlake(pt, { x: Math.cos(y) * side, z: -Math.sin(y) * side }, fin(o.k, 0.12));
      }
    },
  },
  shellStrip: {
    dur: 1.2,
    frame: (d, t, o, prev) => {
      if (cross(prev, t, 0.02)) d.fx.shellStrip(d.position.x, 1.3, d.position.z, fin(o.k, 1));
    },
  },
  coreVent: { dur: 2.0, frame: (d, t, o) => d.fx.coreVent(fin(o.k, ramp(t, 0, 1.6))) },
  transition2: { dur: 2.3, frame: (d, t, o, prev) => transition(d, 2, t, prev) },
  transition3: { dur: 2.3, frame: (d, t, o, prev) => transition(d, 3, t, prev) },
  transition4: { dur: 2.3, frame: (d, t, o, prev) => transition(d, 4, t, prev) },
  sightLine: {
    dur: 1.6,
    frame: (d, t, o) => {
      target(d, o);
      const L = 4, cx = o._tx, cz = o._tz;
      d.fx.sightLine(cx - o._uz * L, cz + o._ux * L, cx + o._uz * L, cz - o._ux * L, ramp(t, 0, 1.5));
    },
  },
  vigil: {
    // the eye's cut: the sight line (1 s), the white-hot line drawn across the floor in a sweep, its scar
    dur: 2.6,
    frame: (d, t, o, prev) => {
      target(d, o);
      const L = 5, cx = o._tx, cz = o._tz, ax = cx - o._uz * L, az = cz + o._ux * L, bx = cx + o._uz * L, bz = cz - o._ux * L;
      if (t < 1.0) d.fx.sightLine(ax, az, bx, bz, ramp(t, 0, 1.0));
      else if (t < 1.8) {
        const u = ramp(t, 1.0, 1.8), E = eye(d);
        d.fx.laser(E.x, E.y, E.z, ax + (bx - ax) * u, 0.2, az + (bz - az) * u, 1);
      }
      if (cross(prev, t, 1.8)) d.fx.scar(ax, az, bx, bz, 0.5, 1);
    },
  },
  passingBell: {
    // a strafing pass: the cut from 4 m up, moving along a line across the floor, its scar the whole way
    dur: 2.6,
    frame: (d, t, o, prev) => {
      target(d, o);
      const L = 12, cx = o._tx, cz = o._tz, ax = cx - o._ux * L, az = cz - o._uz * L, bx = cx + o._ux * L, bz = cz + o._uz * L;
      if (t < 0.7) d.fx.sightLine(ax, az, bx, bz, ramp(t, 0, 0.7), false);
      else if (t < 2.0) {
        const u = ramp(t, 0.7, 2.0), x = ax + (bx - ax) * u, z = az + (bz - az) * u;
        d.fx.laser(x - o._ux * 1.2, 4.2, z - o._uz * 1.2, x, 0.2, z, 1);
        d.fx.jet('back', 0.8);
      }
      if (cross(prev, t, 2.0)) d.fx.scar(ax, az, bx, bz, 0.7, 1.2);
    },
  },
  absolution: {
    // the palm cannon: the iris charging (1 s, the light dimming), the beam held 1.2 s walked sideways, the trench
    dur: 3.0,
    frame: (d, t, o, prev) => {
      target(d, o);
      if (t < 1.0) d.fx.cannonCharge('palmR', ramp(t, 0, 1.0));
      const H = d.handPoint ? d.handPoint('R', d.fx._partV) : _e.set(d.position.x, 1.3, d.position.z);
      const hx = H.x, hy = H.y, hz = H.z;
      const sw = (u) => {
        const a = Math.atan2(o._uz, o._ux) + (u - 0.5) * 0.7, R = 14;
        return [hx + Math.cos(a) * R, hz + Math.sin(a) * R];
      };
      if (t >= 1.0 && t < 2.2) {
        const u = ramp(t, 1.0, 2.2), [bx, bz] = sw(u);
        d.fx.cannonBeam(hx, hy, hz, bx, 0.3, bz, 1.3, Math.min(1, (t - 1.0) / 0.1) * (t > 2.1 ? (2.2 - t) / 0.1 : 1));
      }
      if (cross(prev, t, 2.2)) {
        const [ax, az] = sw(0), [bx, bz] = sw(1);
        d.fx.cannonEnd((hx + ax) / 2, (hz + az) / 2, ax, az, 1.3);
        d.fx.cannonEnd(ax, az, bx, bz, 1.3);
      }
    },
  },
  revelation: {
    // FULL BURST: both palms and the core charge, twin beams converge on the target, then the core beam held
    // 2 s and swept about 60 degrees, the trench
    dur: 4.8,
    frame: (d, t, o, prev) => {
      target(d, o);
      if (t < 1.2) {
        const k = ramp(t, 0, 1.2);
        d.fx.cannonCharge('palmR', k);
        d.fx.cannonCharge('palmL', k);
        d.fx.cannonCharge('core', k);
      }
      if (t >= 1.2 && t < 2.0) {
        const u = ramp(t, 1.2, 2.0);
        for (const s of ['R', 'L']) {
          const H = d.handPoint ? d.handPoint(s, d.fx._partV) : _e.set(d.position.x, 1.3, d.position.z);
          const off = (s === 'R' ? 1 : -1) * 4 * (1 - u);
          d.fx.cannonBeam(H.x, H.y, H.z, o._tx - o._uz * off, 0.3, o._tz + o._ux * off, 1.0, 1);
        }
      }
      const C = d.partPoint ? d.partPoint('core', d.fx._partV) : _e.set(d.position.x, 1.4, d.position.z);
      const sw = (u) => {
        const a = Math.atan2(o._uz, o._ux) + (u - 0.5) * (Math.PI / 3), R = 18;
        return [C.x + Math.cos(a) * R, C.z + Math.sin(a) * R];
      };
      if (t >= 2.0 && t < 4.0) {
        const u = ramp(t, 2.0, 4.0), [bx, bz] = sw(u);
        d.fx.coreVent(1);
        d.fx.cannonBeam(C.x, C.y, C.z, bx, 0.3, bz, 3.2, Math.min(1, (t - 2.0) / 0.15) * (t > 3.85 ? (4.0 - t) / 0.15 : 1));
      }
      if (cross(prev, t, 4.0)) {
        const [ax, az] = sw(0), [bx, bz] = sw(1);
        d.fx.cannonEnd(ax, az, (ax + bx) / 2, (az + bz) / 2, 3.2);
        d.fx.cannonEnd((ax + bx) / 2, (az + bz) / 2, bx, bz, 3.2);
      }
    },
  },
  triptych: {
    // the forearm gun: three bolts, and one sent home (a perfect parry's)
    dur: 1.9,
    frame: (d, t, o, prev) => {
      target(d, o);
      const H = d.handPoint ? d.handPoint('R', d.fx._partV) : _e.set(d.position.x, 1.3, d.position.z);
      for (const s of [0.1, 0.35, 0.6]) {
        if (!cross(prev, t, s)) continue;
        d.fx.gunFlash(H.x, H.y, H.z, o._ux, o._uz);
        d.fx.fly({ kind: 'bolt', x: H.x, y: H.y, z: H.z, tx: o._tx, ty: 1.1, tz: o._tz, speed: 26, expect: false });
      }
      if (cross(prev, t, 1.1)) d.fx.fly({ kind: 'bolt', x: o._tx, y: 1.1, z: o._tz, tx: d.position.x, ty: 1.3, tz: d.position.z, speed: 30, back: true, expect: false, power: 1.4 });
    },
  },
  choir: {
    // THE MISSILE SWARM: the petals open, twelve arc up and come down on rings round the target, the last
    // three tracking it
    dur: 3.8,
    frame: (d, t, o, prev) => {
      target(d, o);
      if (cross(prev, t, 0.05)) d.fx.missileLaunch(d.position.x, 2.0, d.position.z, 12);
      for (let i = 0; i < 12; i++) {
        const s = 0.1 + i * 0.07;
        if (!cross(prev, t, s)) continue;
        const sh = d.partPoint ? d.partPoint(i % 2 ? 'shoulderL' : 'shoulderR', d.fx._partV) : _e.set(d.position.x, 1.8, d.position.z);
        const last = i >= 9, a = i * 2.39996, r = last ? 0 : 2.4 + 4.2 * Math.sqrt((i + 0.5) / 9);
        d.fx.fly({ kind: 'missile', x: sh.x, y: sh.y + 0.2, z: sh.z, tx: o._tx + Math.cos(a) * r, tz: o._tz + Math.sin(a) * r, T: 1.7 + (i % 4) * 0.18 + (last ? 0.5 : 0), apex: 5 + (i % 3), r: 1.3, track: last ? 0.6 : 0, expect: false });
      }
    },
  },
  kyrie: {
    // THE ARTILLERY: rows of marked shells creeping toward the target down his line, straight lanes between
    // the shells of a row, then one great shell on the target
    dur: 6.4,
    frame: (d, t, o, prev) => {
      target(d, o);
      const rows = 5, per = 5, gap = 4.0, step = 3.0, T = 1.6;
      const M = d.partPoint ? d.partPoint('mortar', d.fx._partV) : _e.set(d.position.x, 2.0, d.position.z);
      for (let r = 0; r < rows; r++) {
        const s = 0.1 + r * 0.7;
        if (!cross(prev, t, s)) continue;
        d.fx.mortarFlash(M.x, M.y, M.z, per);
        // (the far row first: rows land walking from beyond the target back toward him over it)
        const along = (rows - 1 - r) * step - 4;
        for (let i = 0; i < per; i++) {
          const across = (i - (per - 1) / 2) * gap + gap / 2;
          d.fx.fly({ kind: 'shell', x: M.x, y: M.y, z: M.z, tx: o._tx + o._ux * along - o._uz * across, tz: o._tz + o._uz * along + o._ux * across, T: T + i * 0.04, r: 1.25, expect: false });
        }
      }
      if (cross(prev, t, 3.9)) {
        d.fx.mortarFlash(M.x, M.y, M.z, 1);
        d.fx.fly({ kind: 'shell', x: M.x, y: M.y, z: M.z, tx: o._tx, tz: o._tz, T: 2.0, r: 3.0, power: 2.6, expect: false });
      }
    },
  },
  verdict: {
    // the reticle follows the target, locks, the pillar comes down, a ring shock
    dur: 3.6,
    frame: (d, t, o, prev) => {
      target(d, o);
      const p = d.game?.player?.position;
      if (t < 1.6 && p && !Number.isFinite(o.x)) {
        o._tx = p.x;
        o._tz = p.z;
      }
      if (t < 2.2) d.fx.reticle(o._tx, o._tz, ramp(t, 0, 1.6), t >= 1.6);
      if (t >= 2.2 && t < 3.3) d.fx.skyLance(o._tx, o._tz, 1.4, ramp(t, 2.2, 3.3));
      if (cross(prev, t, 2.35)) d.fx.ringShock(o._tx, o._tz, 6, 1.2);
    },
  },
  lastRite: {
    dur: 2.2,
    frame: (d, t, o, prev) => {
      if (t < 1.6) d.fx.coreVent(ramp(t, 0, 1.6));
      if (cross(prev, t, 1.65)) {
        d.fx.ringShock(d.position.x, d.position.z, 5, 1.5);
        d.fx.blast(d.position.x, d.position.z, 2.5, 1.6);
      }
    },
  },
  pour: {
    dur: 2.2,
    frame: (d, t, o) => {
      const L = d.game?.world?.forest?.foundry?.ladles?.[0];
      const x = fin(o.x, fin(L?.x, d.position.x + 3)), z = fin(o.z, fin(L?.z, d.position.z)), y = fin(L?.h, 3);
      d.fx.pour(x, y, z, Math.min(1, t / 0.2) * Math.min(1, (2.2 - t) / 0.3));
    },
  },
  sparks: {
    dur: 0.5,
    frame: (d, t, o, prev) => {
      if (cross(prev, t, 0.02)) d.fx.sparks(d.position.x, 1.2, d.position.z, Math.sin(d.yaw), Math.cos(d.yaw), fin(o.n, 16), 1);
    },
  },
  palmHit: {
    // the pack's C1: a palm, a palm, the heel-palm shove at the target's chest
    dur: 1.2,
    frame: (d, t, o, prev) => {
      target(d, o);
      for (const [s, k] of [[0.05, 1], [0.45, 1], [0.85, 1.5]]) if (cross(prev, t, s)) d.fx.palmHit(o._tx - o._ux * 0.4, 1.3, o._tz - o._uz * 0.4, o._ux, o._uz, k);
    },
  },
  footPlant: {
    // the pack's C2: a planted, sliding stop (a jet dash's landing) toward the target
    dur: 1.0,
    frame: (d, t, o, prev) => {
      target(d, o);
      if (cross(prev, t, 0.05)) d.fx.footPlant(d.position.x + o._ux * 0.3, d.position.z + o._uz * 0.3, o._ux, o._uz, 0.9, 1);
    },
  },
  hitMetal: {
    dur: 0.8,
    frame: (d, t, o, prev) => {
      for (const s of [0.02, 0.4]) {
        if (!cross(prev, t, s)) continue;
        const y = d.yaw;
        d.fx.hitSpark(d.position.x + Math.sin(y) * 0.25, 1.35, d.position.z + Math.cos(y) * 0.25, Math.cos(y), -Math.sin(y), s > 0.1);
      }
    },
  },
};

/** A transition's windup (1.8 s) then its burst. */
function transition(d, n, t, prev) {
  if (t < 1.8) d.fx.transition(n, ramp(t, 0, 1.8));
  if (cross(prev, t, 1.8)) {
    d.fx.transitionBurst(n, d.position.x, d.position.z, 4);
    d.fx.shellStrip(d.position.x, 1.3, d.position.z, 1);
  }
}

/** Start driver `name` (false: none of that name; 'stopAll' ends the one playing). */
export function run(d, name, opts = {}) {
  if (!d?.fx) return false;
  if (name === 'stopAll') {
    d.fx._drive = null;
    return true;
  }
  const D = DRIVERS[name];
  if (!D) return false;
  d.fx._drive = { D, t: 0, o: { ...(opts ?? {}) }, name };
  return true;
}

/** One frame of the timeline: false when it is over. */
export function step(d, drive, dt) {
  const prev = drive.t;
  drive.t += fin(dt);
  // (the first frame counts from -1 µs: an effect at 0.02 s fires on the first frame of a 1/60 step)
  drive.D.frame?.(d, drive.t, drive.o, prev === 0 ? -1e-6 : prev);
  return drive.t < drive.D.dur;
}

/** The drivers' names (the Lab's list) and their lengths (s). */
export const NAMES = Object.freeze(Object.keys(DRIVERS));
export const DURATIONS = Object.freeze(Object.fromEntries(Object.entries(DRIVERS).map(([k, v]) => [k, v.dur])));
void TAU;
