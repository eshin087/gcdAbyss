import { skirtSheet, tatterStrip, foldLines, ribbonCrease, lerp, sheetOffset, sheetEdge } from '../heroGeo.js';

// Cloth builders the outfits share (gear/README.md): one streamer sheet (hangSheet) and a skirt of
// coat panels on the pelvis (panelSkirt). Each returns the handle the animator springs (anim.js
// _streamers / _coat), so an item only describes its cloth as data. Build-time only (they allocate).

/**
 * One cloth sheet on the streamer springs, hung from `parent` (any joint: the chest, an upper arm,
 * the head). `ctx` = the item's build context ({ joint, mesh }). `d`:
 *   at [x, y, z]   the root, in parent space
 *   ry             the outer face's direction (rad about Y: 0 = his front, π = straight back)
 *   w [root, seam, hem], len [upper, lower] (m)
 *   out            the resting outward flare (tan of the angle; anim.js _streamers)
 *   wrap           the radius the sheet curves round at its root (sheet mode)
 *   lag (0.5), max (1.45 rad), arm? (1 / 2: hung on the right / left upper arm)
 *   inMax?         how far a segment may swing IN toward the wearer (rad; a number or [root, tip];
 *                  negative = always at least that far out). Not applied lying (anim.js)
 *   hemFrom? (1)   0..1 down the lower segment where `mats.hem` takes over from `mats.face`
 *   ribbon?        a narrow ribbon (tatterStrip) instead of a curved sheet; `fork` splits its tip;
 *                  `crease` = the drawn crease's phase (default seed × 0.7)
 *   floor?         rolling or falling, its ends stay over the grass (anim.js; a head ribbon, a long scarf)
 *   seed           the folds' and the tears' seed
 * `mats` = { face, back | null, hem }: the outer face, the inner face (a BackSide material, or null
 * for a ribbon in a DoubleSide one), the pale hem. Returns the streamer record.
 */
export function hangSheet({ joint, mesh }, parent, d, mats) {
  const base = joint(parent, d.at[0], d.at[1], d.at[2]);
  base.rotation.y = d.ry; // local +Z = the sheet's outer face, +X = across it
  const [w0, w1, w2] = d.w, [L0, L1] = d.len, seed = d.seed ?? 1;
  const hf = d.hemFrom ?? 1;
  const s0 = joint(base);
  const s1 = joint(s0, 0, -L0, 0);
  const put = (j, g, m) => {
    mesh(j, g, m);
    if (mats.back) mesh(j, g, mats.back);
  };
  if (d.ribbon) {
    const cr = d.crease ?? seed * 0.7;
    put(s0, foldLines(tatterStrip(L0 + 0.01, w0, { tip: false, curl: 0.05, seed }), ribbonCrease(w0, cr)), mats.face);
    put(s1, foldLines(tatterStrip(L1, w1, { fork: !!d.fork, tip: true, curl: 0.12, seed: seed + 5 }), ribbonCrease(w1, cr + 1.3)), hf < 1 ? mats.hem : mats.face);
  } else {
    // drawn folds fanning down the sheet (as on the cloak's sheets, shroud.js)
    const nF = Math.max(1, Math.round(w2 / 0.11)) + 0.5, ph = seed * 0.37;
    const wAt = (dd) => (dd < L0 ? lerp(w0, w1, dd / L0) : lerp(w1, w2, Math.min(1, (dd - L0) / L1)));
    const pleat = (d0) => (x, y, z, u, gy) => {
      const dd = d0 - gy, w = wAt(dd);
      const f = Math.PI * 2 * nF * (u / w + 0.5 + 0.05 * Math.sin(dd * 8 + ph * 1.7)) + ph + Math.PI;
      return 0.5 + 0.62 * (Math.sin(f) + 0.3 * Math.sin(f * 2.3 + 1.7)) - 0.9 * Math.max(0, 1 - dd / 0.14);
    };
    put(s0, foldLines(skirtSheet(L0, w0, w1, d.wrap, 0.25, 0, seed, [0.004, 0.018, nF, ph]), pleat(0)), mats.face);
    const R1 = d.wrap + 0.25 * L0, fold = [0.018, 0.04, nF, ph];
    if (hf > 0) put(s1, foldLines(skirtSheet(L1, w1, w2, R1, 0.25, 0.008, seed + 7, fold, 0, Math.min(1, hf)), pleat(L0)), mats.face);
    if (hf < 1) put(s1, foldLines(skirtSheet(L1, w1, w2, R1, 0.25, 0.008, seed + 7, fold, Math.max(0, hf), 1), pleat(L0)), mats.hem);
  }
  const im = d.inMax;
  return {
    segs: [s0, s1], len: d.len, out: d.out, lag: d.lag ?? 0.5, max: d.max ?? 1.45, w: d.w, arm: d.arm ?? 0,
    wrap: d.ribbon ? 0.02 : d.wrap,
    floor: !!d.floor,
    inMax: im == null ? undefined : typeof im === 'number' ? [im, im] : im,
  };
}

/**
 * A skirt of coat panels hung on the pelvis (the animator's `coat`, anim.js _coat): each panel is
 * an anchor on the pelvis yawed to `az` → an upper and a lower sheet → its torn strips. `PANELS` =
 * panel defs: az, w [top, join, hem], len [upper, lower], strips (lengths), fork, out, flare, edge
 * (piping down that edge: ±1), skew, slant (COAT_PANELS in wanderer.js); and, read here only,
 * `hemFrom` (0..1 down the lower sheet where the pale hem takes over; default none) and `stripHem` (the torn
 * strips in the hem's ink, not the coat's); the animator
 * also reads `breeze` / `idleFlare` (a panel's own idle stir). `seed` varies the folds and tears.
 * Returns { coat }.
 */
export function panelSkirt({ pelvis, M, DIM, mesh, joint }, PANELS, { seed = 0 } = {}) {
  const coat = [];
  PANELS.forEach((Pn, i) => {
    const sa = Math.sin(Pn.az), ca = Math.cos(Pn.az);
    const R0 = 1 / Math.hypot(sa / DIM.coatR, ca / (DIM.coatR * 0.69)) + Pn.out * 0.5;
    const anchor = joint(pelvis, sa * R0, DIM.coatY, ca * R0);
    anchor.rotation.y = Pn.az; // local +Z = outward, +X = tangent
    const s0 = joint(anchor);
    const sk = Pn.skew ?? 0, w0 = Pn.w[0], sl = Pn.slant ?? 0;
    const nF = Math.max(1, Math.round(Pn.w[2] / 0.09)) + 0.5, fph = i * 2.3 + 0.4;
    const L0 = Pn.len[0], L1 = Pn.len[1];
    const wAt = (d) => (d < L0 ? lerp(Pn.w[0], Pn.w[1], d / L0) : lerp(Pn.w[1], Pn.w[2], Math.min(1, (d - L0) / L1)));
    const pleat = (d0) => (x, y, z, u, gy) => {
      const d = d0 - gy, w = wAt(d);
      const s = (u - sheetOffset(w, w0, sk)) / w + 0.5;
      const ph = Math.PI * 2 * nF * (s + 0.04 * Math.sin(d * 8 + i * 1.3)) + fph + Math.PI;
      return 0.5 + 0.6 * Math.sin(ph) - 0.9 * Math.max(0, 1 - d / 0.1);
    };
    const cone = Pn.cone ?? 0.25; // (how fast the skirt widens down its length: m out per m down; `jag`: the hem's raggedness, m)
    const g0 = foldLines(skirtSheet(L0, Pn.w[0], Pn.w[1], R0, cone, 0, 81 + seed + i, [0.002, 0.008, nF, fph], 0, 1, sk, w0), pleat(0));
    mesh(s0, g0, M.coat);
    mesh(s0, g0, M.lining);
    const s1 = joint(s0, 0, -L0, 0);
    const R1 = R0 + cone * L0, hf = Pn.hemFrom ?? 1;
    const lower = (t0, t1) => foldLines(skirtSheet(L1, Pn.w[1], Pn.w[2], R1, cone, Pn.jag ?? 0.006, 91 + seed + i, [0.008, 0.016, nF, fph], t0, t1, sk, w0, sl), pleat(L0));
    if (hf > 0) {
      const g1 = lower(0, Math.min(1, hf));
      mesh(s1, g1, M.coat);
      mesh(s1, g1, M.lining);
    }
    if (hf < 1) {
      const g2 = lower(Math.max(0, hf), 1);
      mesh(s1, g2, M.hem);
      mesh(s1, g2, M.lining);
    }
    if (Pn.edge) {
      mesh(s0, sheetEdge(L0, Pn.w[0], Pn.w[1], R0, Pn.edge, 1, cone, sk, w0), M.piping);
      mesh(s1, sheetEdge(L1, Pn.w[1], Pn.w[2], R1, Pn.edge, 1, cone, sk, w0), M.piping);
    }
    const strips = [];
    const n = Pn.strips.length, R2 = R1 + cone * L1, wr = Pn.w[2] / Math.max(1, n);
    for (let k = 0; k < n; k++) {
      const sk01 = (k + 0.5) / n;
      const u = (sk01 - 0.5) * Pn.w[2] + sheetOffset(Pn.w[2], w0, sk);
      const a = u / R2;
      const sj = joint(s1, Math.sin(a) * R2, -L1 - sl * (sk < 0 ? 1 - sk01 : sk01), (Math.cos(a) - 1) * R2);
      sj.rotation.y = a;
      const sw = Math.max(0.06, wr * 0.9);
      // (`stripHem`: the torn strips in the pale hem's ink, as the rags of a hem that is pale itself)
      mesh(sj, tatterStrip(Pn.strips[k], sw, { fork: !!Pn.fork[k], curl: 0.2, seed: 3000 + seed + i * 31 + k * 7 }), Pn.stripHem ? M.hem : M.coat);
      strips.push({ joint: sj, len: Pn.strips[k], rest: a, phase: (i * 1.9 + k * 2.1) % (Math.PI * 2) });
    }
    coat.push({ anchor, segs: [s0, s1], def: Pn, strips, len: [L0, L1 + sl + (n ? Math.max(...Pn.strips) * 0.8 : 0)], r0: R0 });
  });
  return { coat };
}
