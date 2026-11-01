// Small scalar helpers. Conventions used across the game:
//  - Y is up, ground is y = 0. Screen-up is world -Z (north), screen-right is +X.
//  - Models face local +Z. A yaw of `a` points them at (sin a, 0, cos a); see yawTo().

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential approach. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const angleDiff = (from, to) => wrapAngle(to - from);
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
/** Rotate `a` toward `b` by at most `maxStep` radians. */
export const turnToward = (a, b, maxStep) => {
  const d = wrapAngle(b - a);
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
};

/** Yaw that makes a +Z-facing model look from (fx,fz) toward (tx,tz). */
export const yawTo = (fx, fz, tx, tz) => Math.atan2(tx - fx, tz - fz);

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);

/** Distance from point p to segment ab, all [x,y,z] arrays or Vector3-likes. */
export function distPointSegment(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  const t = len2 > 1e-9 ? clamp((apx * abx + apy * aby + apz * abz) / len2, 0, 1) : 0;
  const cx = ax + abx * t - px, cy = ay + aby * t - py, cz = az + abz * t - pz;
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}
