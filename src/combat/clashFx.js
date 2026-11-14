// Steel on steel, drawn the same way wherever one blade meets another: the hero's parry, a duelist's
// guard turning the hero's strike, his deflect, the grind of a blade lock. Glyph particles from the
// world atlas (STYLE.md) and one pooled light.
//
// What makes it read as a sword clash at the game camera (two figures ~70 px tall):
//   - thin streaks thrown out of the contact in the SCREEN's plane (a starburst of lines, not a
//     cloud), most of them along the way the turned blade was travelling;
//   - a cross of light laid along the two edges, so the meeting of the blades is lit as an X;
//   - a small hot core that is gone in two frames, and embers that fall and die on their own;
//   - an optional thin ring.
// Nothing here is a big bright glyph: at bloom's threshold a 1 m '*' is a white blot that hides both
// fighters for the whole freeze-frame, and the freeze-frame is the picture the player remembers.
// Sparks keep flying through a freeze-frame (game.fxDt), so nothing is pre-aged.
//
// Cosmetic noise comes from this module's own stream: the seeded sims replay the AI's Math.random.

let seed = 0x9e3779b9;
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const R = (a, b) => a + rnd() * (b - a);

/** Colour sets (linear HDR). `streak` → `end` for the lines, `ember` → `emberEnd` for the falling
 *  points, `core` the two-frame centre, `edge` the cross along the blades, `light` the pooled light. */
export const CLASH = Object.freeze({
  // the hero turns a blow: white-gold
  parry: { core: [3.2, 2.9, 2.2], streak: [2.5, 2.1, 1.3], end: [1.0, 0.42, 0.1], ember: [2.6, 1.7, 0.6], emberEnd: [0.5, 0.12, 0.02], edge: [2.1, 2.0, 1.7], ring: [1.5, 1.45, 1.3], light: [1.2, 1.0, 0.65] },
  // a heavy blow turned: the moonlit blade's cold light
  blue: { core: [2.4, 3.0, 3.8], streak: [1.5, 2.2, 3.2], end: [0.2, 0.5, 1.4], ember: [1.6, 2.3, 3.4], emberEnd: [0.15, 0.35, 1.0], edge: [1.7, 2.1, 2.6], ring: [1.3, 1.6, 2.0], light: [0.55, 0.8, 1.3] },
  // a perfect parry: gold
  perfect: { core: [3.8, 3.0, 1.4], streak: [3.2, 2.3, 0.8], end: [1.3, 0.45, 0.06], ember: [3.4, 2.3, 0.7], emberEnd: [0.7, 0.18, 0.02], edge: [2.6, 2.2, 1.2], ring: [2.2, 1.6, 0.5], light: [1.3, 0.95, 0.4] },
  // the trade clash (two cuts meet): white-hot, the biggest of them
  trade: { core: [3.0, 2.9, 2.7], streak: [2.3, 2.2, 1.95], end: [0.8, 0.5, 0.28], ember: [2.9, 2.4, 1.5], emberEnd: [0.5, 0.22, 0.06], edge: [2.3, 2.3, 2.2], ring: [2.1, 2.0, 1.8], light: [1.2, 1.1, 0.9] },
  // his guard turns the hero's strike: dull steel, few and short (a block, not an opening)
  guard: { core: [2.0, 2.1, 2.4], streak: [1.3, 1.4, 1.7], end: [0.25, 0.28, 0.4], ember: [1.1, 1.15, 1.4], emberEnd: [0.15, 0.16, 0.22], edge: [1.4, 1.5, 1.8], ring: [0.9, 0.95, 1.15], light: [0.75, 0.85, 1.1] },
  // he DEFLECTS the hero's strike (the blade is thrown back, his counter comes): hot orange-red
  deflect: { core: [3.8, 2.0, 0.8], streak: [3.2, 1.3, 0.35], end: [1.1, 0.14, 0.03], ember: [3.0, 1.0, 0.25], emberEnd: [0.6, 0.06, 0.01], edge: [2.8, 1.5, 0.6], ring: [2.6, 0.9, 0.25], light: [1.3, 0.55, 0.2] },
});

const AX = { rx: 1, ry: 0, rz: 0, ux: 0, uy: 0.53, uz: -0.85 };
/** The rendering camera's right / up axes (the fixed 58° camera's when there is none yet). */
function axes(game) {
  const Rg = game?.U?.uCamRight?.value, Up = game?.U?.uCamUp?.value;
  if (Rg && Up && Number.isFinite(Rg.x + Rg.y + Rg.z + Up.x + Up.y + Up.z) && Rg.x * Rg.x + Rg.y * Rg.y + Rg.z * Rg.z > 0.5) {
    AX.rx = Rg.x;
    AX.ry = Rg.y;
    AX.rz = Rg.z;
    AX.ux = Up.x;
    AX.uy = Up.y;
    AX.uz = Up.z;
  }
  return AX;
}
/** Screen angle (rad, from the camera's right toward its up) of a world direction; NaN if it has none. */
function screenAngle(A, x, y, z) {
  const sx = x * A.rx + y * A.ry + z * A.rz, sy = x * A.ux + y * A.uy + z * A.uz;
  return sx * sx + sy * sy > 1e-8 && Number.isFinite(sx + sy) ? Math.atan2(sy, sx) : NaN;
}

/**
 * One clash at (x, y, z).
 *   o.pal     a CLASH set (default CLASH.parry)
 *   o.power   0.5 … 1.8: how many sparks, how far (a chained deflect grows it)
 *   o.spray   { x, y, z }: the way the turned blade was going (world); the streaks favour it
 *   o.e1, o.e2  { x, y, z }: the two blades' directions (world): the cross is laid along them
 *   o.ring    0 none, 1 a thin ring, 2 a second, wider one
 *   o.embers  false: no falling embers (the lock's grind brings its own)
 *   o.light   false: no light
 */
export function clashBurst(game, x, y, z, o = {}) {
  const add = game?.fx?.add;
  if (!add || !Number.isFinite(x + y + z)) return;
  const C = o.pal ?? CLASH.parry;
  const k = Math.min(1.8, Math.max(0.4, Number.isFinite(o.power) ? o.power : 1));
  const A = axes(game);
  const dir = (a) => [A.rx * Math.cos(a) + A.ux * Math.sin(a), A.ry * Math.cos(a) + A.uy * Math.sin(a), A.rz * Math.cos(a) + A.uz * Math.sin(a)];
  const base = o.spray ? screenAngle(A, o.spray.x, o.spray.y, o.spray.z) : NaN;
  const aimed = Number.isFinite(base);

  // the streaks: a starburst of thin lines in the screen's plane
  const n = Math.round(20 * k);
  for (let i = 0; i < n; i++) {
    // two thirds ride the turned blade's way (a fan ~±50°), the rest fly all round
    const a = aimed && i % 3 ? base + R(-0.9, 0.9) * R(0.3, 1) : R(0, Math.PI * 2);
    const sp = R(6, 15) * (0.75 + 0.25 * k) * (aimed && i % 3 ? 1.15 : 0.8);
    // (born off the centre, further for a big burst: stacked on it they add up to a blot)
    const d = dir(a), o0 = R(0.1, 0.34 + 0.4 * Math.max(0, k - 1));
    add.spawn({
      x: x + d[0] * o0, y: y + d[1] * o0, z: z + d[2] * o0, vx: d[0] * sp, vy: d[1] * sp, vz: d[2] * sp,
      life: R(0.1, 0.24), size: R(0.15, 0.24), sizeEnd: 0.03, glyph: '|', rot: a - Math.PI / 2, stretch: R(1.4, 3.2),
      color: C.streak, colorEnd: C.end, alpha: 1, alphaEnd: 0, drag: R(5, 9), gravity: -4,
    });
  }
  // the cross along the two edges (or a plain X when the blades are not known)
  const e1 = o.e1 ? screenAngle(A, o.e1.x, o.e1.y, o.e1.z) : NaN, e2 = o.e2 ? screenAngle(A, o.e2.x, o.e2.y, o.e2.z) : NaN;
  const cross = [Number.isFinite(e1) ? e1 : 0.75, Number.isFinite(e2) ? e2 : -0.75];
  // (two edges nearly along one line on screen: open them into a visible X)
  let apart = Math.abs(cross[0] - cross[1]) % Math.PI;
  if (apart > Math.PI / 2) apart = Math.PI - apart;
  if (apart < 0.35) cross[1] = cross[0] + 1.1;
  for (const a of cross) {
    const d = dir(a);
    for (let j = -3; j <= 3; j++) {
      if (!j) continue;
      const off = j * 0.11 * (0.8 + 0.2 * k);
      add.spawn({
        x: x + d[0] * off, y: y + d[1] * off, z: z + d[2] * off,
        life: 0.11 - 0.012 * Math.abs(j), size: 0.2 - 0.025 * Math.abs(j), sizeEnd: 0.04, glyph: '|', rot: a - Math.PI / 2, stretch: 1.6,
        color: C.edge, colorEnd: C.end, alpha: 1, alphaEnd: 0,
      });
    }
  }
  // the core: small, two frames
  add.spawn({ x, y, z, life: 0.045, size: 0.3 * (0.85 + 0.15 * k), sizeEnd: 0.1, glyph: '*', color: C.core, colorEnd: C.streak, alpha: 1, alphaEnd: 0, rot: R(0, 1.5) });
  // embers: slower points that arc and fall, still lit
  if (o.embers !== false) {
    const m = Math.round(9 * k);
    for (let i = 0; i < m; i++) {
      const a = aimed ? base + R(-1.3, 1.3) : R(0, Math.PI * 2), sp = R(1.5, 5.5);
      const d = dir(a);
      add.spawn({
        x, y, z, vx: d[0] * sp, vy: d[1] * sp + R(1.5, 4.5), vz: d[2] * sp,
        life: R(0.45, 0.9), size: R(0.1, 0.17), sizeEnd: 0.03, glyph: ".'`•",
        color: C.ember, colorEnd: C.emberEnd, alpha: 1, alphaEnd: 0, gravity: -15, drag: 0.9, flicker: 0.35,
      });
    }
  }
  if (o.ring) clashRing(game, x, y, z, C.ring, 0.34, 1.25 * (0.85 + 0.15 * k), 0.16, 16);
  if (o.ring > 1) clashRing(game, x, y, z, C.streak, 0.26, 1.9, 0.26, 20);
  if (o.light !== false) {
    game.lights?.add?.({ x, y: Math.max(1, y), z, color: C.light, intensity: 1.7 + 0.5 * Math.min(k, 1.2), radius: 4.5 + k, life: 0.14, fade: 0.12 });
  }
}

/** A thin ring of strokes in the screen's plane, opening from r0 to r1 m in `life` s. */
export function clashRing(game, x, y, z, color, r0, r1, life, n = 16) {
  const add = game?.fx?.add;
  if (!add || !Number.isFinite(x + y + z)) return;
  const A = axes(game), sp = (r1 - r0) / life;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const dx = A.rx * ca + A.ux * sa, dy = A.ry * ca + A.uy * sa, dz = A.rz * ca + A.uz * sa;
    add.spawn({
      x: x + dx * r0, y: y + dy * r0, z: z + dz * r0, vx: dx * sp, vy: dy * sp, vz: dz * sp,
      life, size: 0.15, sizeEnd: 0.05, glyph: '-', rot: a + Math.PI / 2, stretch: 1.2,
      color, colorEnd: [color[0] * 0.3, color[1] * 0.3, color[2] * 0.3], alpha: 0.9, alphaEnd: 0, drag: 1.5,
    });
  }
}

/** Steel grinding on steel (the blade lock, every frame the blades press): a few short sparks
 *  spat out of the crossing, falling. `k` 0..1 = how hard. */
export function clashGrind(game, x, y, z, k = 1, pal = CLASH.parry) {
  const add = game?.fx?.add;
  if (!add || !Number.isFinite(x + y + z)) return;
  const A = axes(game);
  const n = rnd() < 0.5 + 0.5 * k ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const a = R(0, Math.PI * 2), sp = R(1.5, 5) * (0.6 + 0.6 * k);
    const dx = A.rx * Math.cos(a) + A.ux * Math.sin(a), dy = A.ry * Math.cos(a) + A.uy * Math.sin(a), dz = A.rz * Math.cos(a) + A.uz * Math.sin(a);
    add.spawn({
      x, y, z, vx: dx * sp, vy: dy * sp + R(0.5, 2.5), vz: dz * sp,
      life: R(0.2, 0.5), size: R(0.09, 0.16), sizeEnd: 0.03, glyph: ".'`*",
      color: pal.ember, colorEnd: pal.emberEnd, alpha: 1, alphaEnd: 0, gravity: -13, drag: 1.2, flicker: 0.4,
    });
  }
}

/**
 * The closest points of two segments a0→a1 and b0→b1 ({x, y, z} each): writes them to pa, pb and
 * returns their distance. Blades are short, so the plain clamped solution is enough.
 */
export function closestOnSegments(a0, a1, b0, b1, pa, pb) {
  const ux = a1.x - a0.x, uy = a1.y - a0.y, uz = a1.z - a0.z;
  const vx = b1.x - b0.x, vy = b1.y - b0.y, vz = b1.z - b0.z;
  const wx = a0.x - b0.x, wy = a0.y - b0.y, wz = a0.z - b0.z;
  const a = ux * ux + uy * uy + uz * uz, b = ux * vx + uy * vy + uz * vz, c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz, e = vx * wx + vy * wy + vz * wz;
  const D = a * c - b * b;
  let s = D > 1e-9 ? (b * e - c * d) / D : 0;
  s = Math.min(1, Math.max(0, s));
  let t = c > 1e-9 ? (b * s + e) / c : 0;
  if (t < 0) {
    t = 0;
    s = a > 1e-9 ? Math.min(1, Math.max(0, -d / a)) : 0;
  } else if (t > 1) {
    t = 1;
    s = a > 1e-9 ? Math.min(1, Math.max(0, (b - d) / a)) : 0;
  }
  pa.x = a0.x + ux * s;
  pa.y = a0.y + uy * s;
  pa.z = a0.z + uz * s;
  pb.x = b0.x + vx * t;
  pb.y = b0.y + vy * t;
  pb.z = b0.z + vz * t;
  return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
}
