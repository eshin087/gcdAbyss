import * as THREE from 'three';
import { ellipsoidGeometry, limbGeometry } from '../../../render/glyphGeometry.js';
import { registerItem, getItem } from '../../player/gear/index.js';
import {
  gridGeometry, shellGeometry, skirtSheet, arcPlate, boxGeometry, bandGeometry, kiteGeometry, mergeGeometries, sub, foldLines, spike, wedge,
  limb, gripFist, looseHand, lerp, sheetOffset, partGeometry, sheetEdge, ring,
} from '../../player/heroGeo.js';

// The Starless Lord's outfit: gear items on the hero's skeleton, so he is built by the same
// buildHero(U, loadout) and driven by the same animator. An armoured dark lord (the owner: black
// plate, a closed helm, a long cape): a full harness of black plate over a black undersuit, a broad
// plate yoke over the shoulders with a lamed pauldron on each arm, a closed helm whose faceplate
// carries one slit of red light, a war-skirt under hip plates, a cape to the ankles lined in crimson,
// and the blades of red light. His own design: nothing here is copied from another work's character.
// The colours are his own material instances (lord.js _tint): `armor` / `spike` = black plate,
// `bevel` = the plates' bright edges, `trim` = gunmetal (the hilt, clasps), `coat` = black cloth (the
// cape, the skirt), `lining` = crimson inside them, `hem` = the cloth's ember-red lower edge,
// `shirt` / `pants` = the undersuit, `leather` = belts, `flask` = red light (the blades, the visor,
// the sigil on his chest).
//
// The blades (weapon space: origin = the grip centre, the main blade along +Z). One hilt carries
// every form's steel; lord.js shows what the current form ignites:
//   lordBladeA    the main blade (forms 1, 2, 3; longer in form 4)
//   lordBladeB    the staff's second blade, out of the pommel (form 3) + lordHiltB, the joined hilt
//   lordQuillons  the cross-hilt's two short side blades (form 4)
// The off-hand blade of form 2 hangs on a joint of its own (lord.js builds it from saberParts).

/** The hilt and the blades (m, weapon space). */
export const SABER = Object.freeze({
  gripBack: 0.14, // the grip runs from −gripBack …
  guard: 0.15, // … to the emitter
  tip: 1.2, // the main blade's point
  tip4: 1.36, // … in form 4 (the cross-hilted blade)
  hiltB: 0.4, // the joined hilt runs back to −hiltB (form 3)
  tipB: 1.42, // the second blade's point at −tipB (form 3)
  quillon: 0.2, // the side blades' length (form 4)
  r: 0.017, // blade radius
});

/**
 * The saber's pieces as geometries (weapon space): { hilt, grip, bladeA (origin at the emitter, along
 * +Z, 1 m long: scaled to its length), bladeB (origin at the back emitter, along −Z, 1 m), hiltB,
 * quillons }.
 */
export function saberParts() {
  const S = SABER;
  const band = (z0, z1, r, k) => sub(limbGeometry({ length: z1 - z0, r0: r, r1: r, radial: 7, rings: 1 }).translate(0, 0, z0), k);
  // the hilt: a ribbed black grip between two gunmetal collars, the emitter shroud at the blade end
  const grip = [];
  for (let k = 0; k < 6; k++) grip.push(band(-S.gripBack + 0.03 + k * 0.035, -S.gripBack + 0.03 + (k + 1) * 0.035 - 0.004, 0.0165, k & 1));
  const hilt = mergeGeometries([
    band(-S.gripBack, -S.gripBack + 0.03, 0.021, 0),
    band(S.guard - 0.05, S.guard - 0.012, 0.022, 0),
    band(S.guard - 0.012, S.guard, 0.026, 1),
    boxGeometry(0.012, 0.03, 0.05, 0, 0.022, S.guard - 0.06), // the activation stud
  ]);
  const blade = (dir) => {
    const g = limbGeometry({ length: 1, r0: S.r * 1.15, r1: S.r * 0.8, radial: 6, rings: 8 });
    if (dir < 0) g.rotateY(Math.PI);
    return g;
  };
  const hiltB = mergeGeometries([
    band(-S.hiltB, -S.hiltB + 0.014, 0.026, 1),
    band(-S.hiltB + 0.014, -S.hiltB + 0.06, 0.022, 0),
    ...[0, 1, 2, 3, 4].map((k) => band(-S.hiltB + 0.06 + k * 0.038, -S.hiltB + 0.06 + (k + 1) * 0.038 - 0.004, 0.0165, k & 1)),
  ]);
  const q = (s) => limbGeometry({ length: S.quillon, r0: S.r * 0.9, r1: S.r * 0.55, radial: 5, rings: 3 }).rotateY((s * Math.PI) / 2).translate(s * 0.02, 0, S.guard + 0.012);
  return { hilt, grip: mergeGeometries(grip), bladeA: blade(1), bladeB: blade(-1), hiltB, quillons: mergeGeometries([q(-1), q(1)]) };
}

// ---------------------------------------------------------------- his look
/**
 * The three helms rendered for the owner's pick (`?lordLook=sallet|crown|hood` in the page's URL;
 * the rest of the harness is the same):
 *   sallet  a smooth black helm with a bladed crest and a lamed tail down the nape (the default)
 *   crown   the same helm under a crown of swept-back spikes that echoes the throne's
 *   hood    the faceplate alone in the shadow of a deep hood
 */
export const LORD_LOOKS = Object.freeze(['sallet', 'crown', 'hood']);
function lookFromUrl() {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('lordLook');
    if (q && LORD_LOOKS.includes(q.toLowerCase())) return q.toLowerCase();
  } catch {
    // (no page: the headless tests)
  }
  return LORD_LOOKS[0];
}
export const LORD_LOOK = lookFromUrl();

// ---------------------------------------------------------------- head: the helm
/** A point on the faceplate (head space): `s` 0..1 across it (0 = his right edge), `t` 0..1 from the
 *  brow down to the chin, `off` m proud of the plate. A prow down the middle, the cheeks swept back. */
function maskPt(DIM, s, t, off, o) {
  const [sx, sy, sz] = DIM.skull;
  const u = s * 2 - 1, au = Math.abs(u);
  const w = lerp(0.094, 0.028, Math.pow(t, 1.4));
  const prow = 0.05 * (1 - Math.pow(au, 1.6)) * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
  o[0] = sx + u * w;
  o[1] = lerp(sy + 0.042, sy - 0.128, t);
  o[2] = sz + 0.066 + prow + 0.016 * t - 0.03 * au * au + off;
  o[3] = u * w;
  o[4] = o[1];
  return o;
}
/** A strip of the faceplate between s0..s1, its upper / lower edge t0(u) / t1(u) (u = −1..1 across). */
const maskStrip = (DIM, s0, s1, t0, t1, off, cols = 6, rows = 1) => gridGeometry(cols, rows, (s, t, o) => {
  const ss = lerp(s0, s1, s), u = ss * 2 - 1;
  maskPt(DIM, ss, lerp(t0(u), t1(u), t), off, o);
}, true);

/** The faceplate: a black prow, one slit of red light across the eyes (its inner ends dipped: a
 *  scowl), a ribbed breather down the chin. */
function buildMask(head, M, DIM, mesh) {
  const all = () => 0, end = () => 1;
  mesh(head, sub(maskStrip(DIM, 0, 1, all, end, 0, 12, 10), 1), M.armor);
  const top = (u) => 0.2 + 0.07 * (1 - Math.abs(u)), bot = (u) => top(u) + 0.062;
  mesh(head, mergeGeometries([maskStrip(DIM, 0.07, 0.445, top, bot, 0.004, 6), maskStrip(DIM, 0.555, 0.93, top, bot, 0.004, 6)]), M.flask);
  // the brow line over the slit, the cheek lines down to the chin, the ridge of the prow
  mesh(head, mergeGeometries([
    maskStrip(DIM, 0.03, 0.97, (u) => top(u) - 0.045, (u) => top(u) - 0.02, 0.005, 12),
    maskStrip(DIM, 0.485, 0.515, () => 0.02, () => 0.2, 0.005, 1, 4),
    maskStrip(DIM, 0.485, 0.515, () => 0.46, () => 0.98, 0.005, 1, 5),
  ]), M.bevel);
  const slots = [];
  for (const k of [-2, -1, 1, 2]) slots.push(sub(maskStrip(DIM, 0.5 + k * 0.085 - 0.022, 0.5 + k * 0.085 + 0.022, () => 0.56, () => 0.9 - 0.05 * Math.abs(k), 0.004, 1, 4), k & 1));
  mesh(head, mergeGeometries(slots), M.shirt);
}

/** The helm's shell (head space): open over the face, closed over the brow, round to the crown. */
function helmShell(DIM) {
  const [, sy, sz] = DIM.skull;
  return shellGeometry([
    { y: sy - 0.05, rx: 0.107, rz: 0.12, cz: sz - 0.014, gap: 0.09 },
    { y: sy - 0.005, rx: 0.11, rz: 0.123, cz: sz - 0.013, gap: 0.092 },
    { y: sy + 0.036, rx: 0.109, rz: 0.122, cz: sz - 0.012, gap: 0.07 },
    { y: sy + 0.058, rx: 0.103, rz: 0.116, cz: sz - 0.011, gap: 0.004 },
    { y: sy + 0.094, rx: 0.086, rz: 0.098, cz: sz - 0.01, gap: 0.004 },
    { y: sy + 0.122, rx: 0.052, rz: 0.06, cz: sz - 0.01, gap: 0.004 },
    { y: sy + 0.134, rx: 0.01, rz: 0.012, cz: sz - 0.01, gap: 0.003 },
  ], { sub: 2, cols: 24 });
}

/** A lame round the back of the head (head space): from yT down to yB, ±half rad about straight back. */
const napeLame = (yT, yB, rxT, rzT, rxB, rzB, cz, half, cols = 12) => gridGeometry(cols, 1, (s, t, o) => {
  const a = Math.PI + (s - 0.5) * 2 * half, rx = lerp(rxT, rxB, t), rz = lerp(rzT, rzB, t);
  o[0] = Math.sin(a) * rx;
  o[1] = lerp(yT, yB, t);
  o[2] = Math.cos(a) * rz + cz;
  o[3] = (a - Math.PI) * 0.12;
  o[4] = o[1];
}, true);

/** The sallet: the shell, a bladed crest from the brow over the crown to the nape, three lames
 *  stepping down the back of the neck and sweeping out behind. */
function buildSallet({ head, M, DIM, mesh }) {
  const [sx, sy, sz] = DIM.skull;
  mesh(head, helmShell(DIM), M.armor);
  buildMask(head, M, DIM, mesh);
  // the crest: a thin blade standing on the helm's midline, tallest behind the crown
  const crest = gridGeometry(14, 1, (s, t, o) => {
    const ph = lerp(0.42, 2.95, s);
    const h = t * (0.014 + 0.062 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 0.8) * (0.35 + 0.65 * s));
    o[0] = sx;
    o[1] = sy + 0.014 + Math.sin(ph) * (0.118 + h);
    o[2] = sz - 0.01 + Math.cos(ph) * (0.122 + h * 1.5);
    o[3] = s * 0.3;
    o[4] = t * 0.05;
  });
  mesh(head, crest, M.spike);
  const tail = [], edge = [];
  for (let i = 0; i < 3; i++) {
    const yT = sy - 0.02 - i * 0.038, yB = yT - 0.056, g = 0.011 * i;
    tail.push(sub(napeLame(yT, yB, 0.112 + g, 0.126 + g * 1.5, 0.12 + g, 0.14 + g * 1.9, sz - 0.016 - i * 0.008, 1.95 - i * 0.12), i & 1));
    edge.push(napeLame(yB + 0.007, yB - 0.002, 0.1215 + g, 0.1415 + g * 1.9, 0.1215 + g, 0.1415 + g * 1.9, sz - 0.016 - i * 0.008, 1.95 - i * 0.12));
  }
  mesh(head, mergeGeometries(tail), M.armor);
  mesh(head, mergeGeometries(edge), M.bevel);
}

/** The crowned helm: the shell and one nape lame under a crown of five swept-back spikes. */
function buildCrown({ head, M, DIM, mesh }) {
  const [sx, sy, sz] = DIM.skull;
  mesh(head, helmShell(DIM), M.armor);
  buildMask(head, M, DIM, mesh);
  mesh(head, sub(napeLame(sy - 0.02, sy - 0.1, 0.112, 0.126, 0.118, 0.136, sz - 0.016, 1.9), 1), M.armor);
  mesh(head, bandGeometry(0.108, 0.121, 0.016, 22).translate(sx, sy + 0.05, sz - 0.011), M.bevel);
  const horns = [];
  for (const s of [-1, 1]) {
    horns.push(spike(0.2, 0.024, [sx + s * 0.07, sy + 0.07, sz - 0.01], [s * 0.42, 0.72, -0.55], [0, 0.2, -1], 0.3, 5, 0.6));
    horns.push(spike(0.14, 0.02, [sx + s * 0.094, sy + 0.012, sz - 0.03], [s * 0.7, 0.35, -0.62], [0, 0.2, -1], 0.3, 5, 0.6));
  }
  horns.push(spike(0.24, 0.024, [sx, sy + 0.1, sz + 0.01], [0, 0.82, -0.57], [0, 0.2, -1], 0.34, 5, 0.5));
  mesh(head, mergeGeometries(horns), M.spike);
}

/** The hooded lord: the faceplate in the shadow of a deep hood that falls onto the yoke. */
function buildHood({ head, M, DIM, mesh }) {
  const [, sy, sz] = DIM.skull;
  buildMask(head, M, DIM, mesh);
  const g = foldLines(shellGeometry([
    { y: -0.02, rx: 0.176, rz: 0.14, cz: -0.022, gap: 0.062 },
    { y: 0.04, rx: 0.142, rz: 0.13, cz: -0.014, gap: 0.064 },
    { y: sy - 0.05, rx: 0.132, rz: 0.146, cz: sz - 0.004, gap: 0.094 },
    { y: sy + 0.01, rx: 0.136, rz: 0.158, cz: sz + 0.002, gap: 0.1 },
    { y: sy + 0.062, rx: 0.13, rz: 0.156, cz: sz - 0.002, gap: 0.078 },
    { y: sy + 0.108, rx: 0.108, rz: 0.134, cz: sz - 0.012, gap: 0.034 },
    { y: sy + 0.14, rx: 0.072, rz: 0.098, cz: sz - 0.03, gap: 0.006 },
    { y: sy + 0.158, rx: 0.014, rz: 0.03, cz: sz - 0.05, gap: 0.003 },
  ], { sub: 2, cols: 26 }), (x, y, z, u) => 0.5 + 0.6 * Math.sin(u * 60 + y * 8) - 1.3 * Math.max(0, (y - sy - 0.07) / 0.09));
  mesh(head, g, M.coat);
  mesh(head, g, M.lining);
}

// ---------------------------------------------------------------- chest: the cuirass
/** A black cuirass with a drawn chevron across the chest and the shoulder blades, three lames down
 *  the belly, a gorget and a standing collar plate, a belt, and the sigil: a ring of red light. */
function buildPlate({ spine, chest, M, BODY, REST, mesh }) {
  const ySp = (h) => h - REST.spine, yCh = (h) => h - REST.chest;
  const SHELL = BODY.shell, top = SHELL[SHELL.length - 1];
  const at = (h) => {
    let k = 0;
    while (k < SHELL.length - 2 && SHELL[k + 1].y < h) k++;
    const A = SHELL[k], B = SHELL[k + 1], u = Math.min(1, Math.max(0, (h - A.y) / (B.y - A.y)));
    return [lerp(A.rx, B.rx, u), lerp(A.rz, B.rz, u), lerp(A.cz ?? 0, B.cz ?? 0, u)];
  };
  // the undersuit: one closed black shell from the hips to the neck
  mesh(spine, shellGeometry([...SHELL, { y: top.y + 0.02, rx: 0.058, rz: 0.056 }].map((r) => ({ ...r, gap: 0, y: ySp(r.y) })), { sub: 2, cols: 24 }), M.shirt);
  // the cuirass: a barrel of plate over the ribs; its seam down the front is the shell's own hairline
  const CU = [
    { y: 1.262, rx: 0.158, rz: 0.12, cz: 0.006 },
    { y: 1.31, rx: 0.178, rz: 0.134, cz: 0.012 },
    { y: 1.37, rx: 0.203, rz: 0.146, cz: 0.02 },
    { y: 1.43, rx: 0.212, rz: 0.14, cz: 0.014 },
    { y: 1.476, rx: 0.186, rz: 0.12, cz: 0.005 },
    { y: 1.51, rx: 0.1, rz: 0.088, cz: 0 },
  ];
  // two drawn lines following a chevron: from the breastbone up to the armpits in front, from the
  // spine up to the shoulders behind
  const chev = (x) => ySp(1.352) + 0.36 * Math.abs(x);
  const cuirass = foldLines(shellGeometry(CU.map((r) => ({ ...r, gap: 0, y: ySp(r.y) })), { sub: 4, cols: 32 }), (x, y) => {
    const d = Math.min(0.09, Math.max(-0.03, chev(x) - y));
    return 0.5 + 0.4 * Math.sin((d * Math.PI) / 0.06);
  });
  mesh(spine, cuirass, M.armor);
  mesh(spine, bandGeometry(0.16, 0.122, 0.012, 28).translate(0, ySp(1.266), 0.006), M.bevel);
  // the belly: three lames stepping down to the belt
  const lames = [];
  [1.238, 1.198, 1.158].forEach((h, i) => {
    const [rx, rz, cz] = at(h);
    lames.push(sub(bandGeometry(rx + 0.016 - i * 0.002, rz + 0.016 - i * 0.002, 0.048, 28).translate(0, ySp(h), cz), i & 1));
  });
  mesh(spine, mergeGeometries(lames), M.armor);
  // the belt and its clasp
  {
    const [rx, rz, cz] = at(1.115);
    mesh(spine, bandGeometry(rx + 0.02, rz + 0.02, 0.04, 28).translate(0, ySp(1.115), cz), M.leather);
    mesh(spine, kiteGeometry(0.03, 0.034, 0.012).translate(0, ySp(1.115), rz + cz + 0.026), M.trim);
  }
  // the sigil on the breastbone: a ring of red light round a dark heart (an eclipse)
  {
    const z = 0.146 + 0.02 + 0.006, y = ySp(1.412);
    mesh(spine, ring(0.031, 0.031, 0.005, 14).rotateX(Math.PI / 2).translate(0, y, z), M.flask);
    mesh(spine, sub(ring(0.02, 0.02, 0.007, 12).rotateX(Math.PI / 2).translate(0, y, z + 0.002), 1), M.armor);
  }
  // the gorget round the throat and the standing collar plate behind the head (on the chest joint)
  mesh(chest, mergeGeometries([
    sub(bandGeometry(0.104, 0.098, 0.066, 20).translate(0, yCh(1.502), 0.004), 1),
    sub(bandGeometry(0.12, 0.11, 0.03, 20).translate(0, yCh(1.474), 0.006), 0),
  ]), M.armor);
  mesh(chest, bandGeometry(0.1055, 0.0995, 0.008, 20).translate(0, yCh(1.535), 0.004), M.bevel);
  mesh(chest, partGeometry('collar'), M.armor);
  mesh(chest, partGeometry('collar.rim'), M.bevel);
}

// ---------------------------------------------------------------- shoulders: the yoke and the pauldrons
/** A plate yoke over both shoulders (on the chest: his shoulder line whatever the arms do), and on
 *  each upper arm a cap with two lames below it and one swept point. */
function buildYoke({ chest, arms, M, BODY, REST, mesh }) {
  const yCh = (h) => h - REST.chest;
  const yoke = foldLines(shellGeometry([
    { y: yCh(1.386), rx: 0.282, rz: 0.196, cz: -0.014, gap: 0.082 },
    { y: yCh(1.43), rx: 0.27, rz: 0.186, cz: -0.012, gap: 0.072 },
    { y: yCh(1.474), rx: 0.214, rz: 0.154, cz: -0.006, gap: 0.054 },
    { y: yCh(1.514), rx: 0.128, rz: 0.11, cz: 0.0, gap: 0.038 },
  ], { sub: 3, cols: 30 }), (x, y) => 0.5 + 0.45 * Math.sin(((y - yCh(1.386)) * Math.PI) / 0.047));
  mesh(chest, yoke, M.armor);
  mesh(chest, shellGeometry([
    { y: yCh(1.379), rx: 0.2835, rz: 0.1975, cz: -0.014, gap: 0.084 },
    { y: yCh(1.39), rx: 0.2835, rz: 0.1975, cz: -0.014, gap: 0.084 },
  ], { sub: 1, cols: 30 }), M.bevel);
  // the clasps where the cape hangs from the yoke, and the chain between them
  mesh(chest, mergeGeometries([
    ring(0.022, 0.022, 0.008, 10).rotateX(Math.PI / 2).translate(0.1, yCh(1.438), 0.176),
    ring(0.022, 0.022, 0.008, 10).rotateX(Math.PI / 2).translate(-0.1, yCh(1.438), 0.176),
    boxGeometry(0.17, 0.008, 0.006, 0, yCh(1.43), 0.18),
  ]), M.trim);
  const [ua0] = BODY.upperArm;
  for (const side of [-1, 1]) {
    const { upper } = arms[side < 0 ? 'R' : 'L'];
    const ac = (side * Math.PI) / 2;
    mesh(upper, mergeGeometries([
      sub(ellipsoidGeometry(0.092, 0.07, 0.096, { widthSegs: 12, heightSegs: 8 }).translate(side * 0.014, -0.004, 0), 0),
      sub(arcPlate(-0.03, -0.118, ua0 + 0.034, ua0 + 0.027, ac, 1.95, 8), 1),
      sub(arcPlate(-0.1, -0.178, ua0 + 0.027, ua0 + 0.02, ac, 1.8, 8), 0),
    ]), M.armor);
    mesh(upper, mergeGeometries([
      arcPlate(-0.11, -0.119, ua0 + 0.0345, ua0 + 0.0345, ac, 1.95, 8),
      arcPlate(-0.17, -0.179, ua0 + 0.0275, ua0 + 0.0275, ac, 1.8, 8),
    ]), M.bevel);
    mesh(upper, spike(0.11, 0.024, [side * 0.07, 0.012, -0.012], [side * 0.8, 0.5, -0.34], [0, 1, 0], 0.3, 5, 0.5), M.spike);
  }
}

// ---------------------------------------------------------------- arms: plate sleeves and gauntlets
/** Black cloth under a plate on the upper arm, a cowter over the elbow with a point behind it, a
 *  vambrace of three lames flaring toward the elbow, gauntlets: the sword hand closed round the grip
 *  (on the `sword` joint), the free hand open or (two-handed) closed below it. */
function buildArms({ arms, sword, M, DIM, BODY, mesh }) {
  const [ua0, ua1] = BODY.upperArm, [fa0, fa1] = BODY.foreArm, HK = BODY.hand * 1.1;
  let open = null, grip = null;
  {
    const F = gripFist(HK);
    mesh(sword, mergeGeometries([F.fingers, F.thumb]), M.armor);
    mesh(sword, F.ridge, M.bevel);
  }
  for (const side of [-1, 1]) {
    const R = side < 0;
    const { upper, fore } = arms[R ? 'R' : 'L'];
    mesh(upper, mergeGeometries([
      sub(limb({ length: DIM.upperArm, r0: ua0 + 0.004, r1: ua1 + 0.004, bulge: 0.008 }), 1),
      sub(ellipsoidGeometry(...BODY.deltoid, { widthSegs: 12, heightSegs: 8 }).translate(side * 0.008, -0.02, 0), 1),
    ]), M.coat);
    // the plate on the upper arm, below the pauldron's lames
    mesh(upper, sub(limb({ length: 0.1, r0: ua0 + 0.012, r1: ua1 + 0.014, radial: 10, rings: 2, capSegs: 1 }).translate(0, -0.165, 0), 1), M.armor);
    // the cowter: a cup over the elbow, a point behind it
    mesh(fore, sub(ellipsoidGeometry(ua1 + 0.02, 0.046, ua1 + 0.024, { widthSegs: 10, heightSegs: 6 }).translate(0, 0.002, -0.01), 0), M.armor);
    mesh(fore, wedge(0.07, 0.022, [0, 0.0, -0.05], [side * 0.15, 0.5, -1], [0, 1, 0], 0.14), M.spike);
    // the vambrace: three overlapping plates stepping down to the wrist, the first flared
    const plates = [], edges = [];
    const n = 3, y0 = -0.055, y1 = -DIM.foreArm + 0.07;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), y = lerp(y0, y1, t), r = lerp(fa0, fa1, t) + (i === 0 ? 0.022 : 0.014 - 0.003 * i);
      const len = (y0 - y1) / (n - 1) + 0.03;
      plates.push(sub(limb({ length: len, r0: r, r1: r - (i === 0 ? 0.012 : 0.006), radial: 10, rings: 2, capSegs: 1 }).translate(0, y + 0.012, 0), i & 1));
      if (i < n - 1) edges.push(bandGeometry(r - 0.004, r - 0.004, 0.008, 12).translate(0, y + 0.012 - len + 0.006, 0));
    }
    mesh(fore, mergeGeometries(plates), M.armor);
    mesh(fore, mergeGeometries(edges), M.bevel);
    mesh(fore, limb({ length: 0.05, r0: fa1 - 0.002, r1: fa1, radial: 8, rings: 2, capSegs: 1 }).translate(0, -DIM.foreArm + 0.075, 0), M.shirt);
    if (R) {
      mesh(fore, ellipsoidGeometry(0.04 * HK, 0.044 * HK, 0.046 * HK, { widthSegs: 10, heightSegs: 6 }).translate(0, -DIM.foreArm + 0.022, 0.004), M.armor);
    } else {
      const H = looseHand(DIM.foreArm - 0.03, side, HK);
      open = mesh(fore, mergeGeometries([H.palm, H.fingers, H.tips, H.thumb]), M.armor);
      open.name = 'lordOpenHand';
      const F = gripFist(HK);
      grip = mesh(sword, mergeGeometries([F.fingers, F.thumb, F.ridge]).translate(0, 0, -DIM.offGrip - 0.02), M.armor);
      grip.visible = false;
    }
  }
  return { offHand: { open, grip }, keep: [open, grip] };
}

// ---------------------------------------------------------------- legs: the Wanderer's boots under thigh plates
/** The armoured boots, knee guards and greaves are the Wanderer's (gear/wanderer.js); over each
 *  thigh a cuisse of two lames. */
function buildLegs(ctx) {
  const out = getItem('wanderer.legs').build(ctx);
  const { legs, M, DIM, BODY, mesh } = ctx;
  const [th0, th1] = BODY.thigh;
  for (const side of [-1, 1]) {
    const { thigh } = legs[side < 0 ? 'R' : 'L'];
    const r = (y) => lerp(th0, th1, -y / DIM.thigh) + 0.016;
    mesh(thigh, mergeGeometries([
      sub(arcPlate(-0.075, -0.22, r(-0.075), r(-0.22), side * 0.25, 1.5, 8), 0),
      sub(arcPlate(-0.2, -0.345, r(-0.2) - 0.004, r(-0.345) - 0.004, side * 0.25, 1.35, 8), 1),
    ]), M.armor);
    mesh(thigh, mergeGeometries([
      arcPlate(-0.212, -0.221, r(-0.22) + 0.0005, r(-0.22) + 0.0005, side * 0.25, 1.5, 8),
      arcPlate(-0.336, -0.345, r(-0.345) - 0.0035, r(-0.345) - 0.0035, side * 0.25, 1.35, 8),
    ]), M.bevel);
  }
  return out;
}

// ---------------------------------------------------------------- waist: hip plates over a war-skirt
/** The war-skirt, on the coat springs (anim.js _coat): two narrow lappets in front (his legs show
 *  between and beside them), a panel at each side, two long tails behind; the same fields and the
 *  same order as the Wanderer's COAT_PANELS (gear/wanderer.js). */
export const LORD_PANELS = [
  { az: 0.5, w: [0.11, 0.135, 0.16], len: [0.29, 0.3], strips: [], fork: [], out: 0.006, flare: 0.07, skew: 0.5 }, // front-left
  { az: -0.5, w: [0.11, 0.135, 0.16], len: [0.29, 0.3], strips: [], fork: [], out: 0.006, flare: 0.07, skew: -0.5 }, // front-right
  { az: 1.52, w: [0.14, 0.2, 0.27], len: [0.35, 0.36], strips: [], fork: [], out: 0.002, flare: 0.3 }, // left
  { az: -1.52, w: [0.14, 0.2, 0.27], len: [0.35, 0.36], strips: [], fork: [], out: 0.002, flare: 0.3 }, // right
  { az: 2.5, w: [0.17, 0.27, 0.39], len: [0.4, 0.41], strips: [], fork: [], out: 0.008, flare: 0.2, skew: -0.5 }, // back-left tail
  { az: -2.5, w: [0.17, 0.27, 0.39], len: [0.4, 0.41], strips: [], fork: [], out: 0.008, flare: 0.2, skew: 0.5 }, // back-right tail
];

/** An elliptical plate round the hips (pelvis space): angle centred on `ac` (0 = front, + = his
 *  left) spanning ±half, from y0 down to y1, radii (rx, rz) growing by `flare` at the lower edge. */
const hipPlate = (y0, y1, rx, rz, flare, ac, half, cols = 6) => gridGeometry(cols, 2, (s, t, o) => {
  const a = ac + (s - 0.5) * 2 * half;
  o[0] = Math.sin(a) * (rx + flare * t);
  o[1] = lerp(y0, y1, t);
  o[2] = Math.cos(a) * (rz + flare * t);
  o[3] = a * 0.15;
  o[4] = o[1];
}, true);

function buildSkirt({ pelvis, M, DIM, REST, mesh, joint }) {
  const yPe = (h) => h - REST.pelvis;
  // the hip plates (tassets): rigid, over the tops of the cloth
  const plates = [], edges = [];
  [[0.62, 0.4], [-0.62, 0.4], [1.62, 0.5], [-1.62, 0.5], [2.62, 0.44], [-2.62, 0.44]].forEach(([ac, half], i) => {
    plates.push(sub(hipPlate(yPe(1.118), yPe(0.955), 0.166, 0.126, 0.024, ac, half), i & 1));
    edges.push(hipPlate(yPe(0.965), yPe(0.954), 0.1905, 0.1505, 0, ac, half));
  });
  mesh(pelvis, mergeGeometries(plates), M.armor);
  mesh(pelvis, mergeGeometries(edges), M.bevel);
  const coat = [];
  LORD_PANELS.forEach((P, i) => {
    const sa = Math.sin(P.az), ca = Math.cos(P.az);
    const R0 = 1 / Math.hypot(sa / DIM.coatR, ca / (DIM.coatR * 0.69)) + P.out * 0.5;
    const anchor = joint(pelvis, sa * R0, DIM.coatY, ca * R0);
    anchor.rotation.y = P.az;
    const s0 = joint(anchor);
    const sk = P.skew ?? 0, w0 = P.w[0];
    const nF = Math.max(1, Math.round(P.w[2] / 0.09)) + 0.5, fph = i * 2.3 + 0.4;
    const L0 = P.len[0], L1 = P.len[1];
    const wAt = (d) => (d < L0 ? lerp(P.w[0], P.w[1], d / L0) : lerp(P.w[1], P.w[2], Math.min(1, (d - L0) / L1)));
    const pleat = (d0) => (x, y, z, u, gy) => {
      const d = d0 - gy, w = wAt(d);
      const s = (u - sheetOffset(w, w0, sk)) / w + 0.5;
      const ph = Math.PI * 2 * nF * (s + 0.04 * Math.sin(d * 8 + i * 1.3)) + fph + Math.PI;
      return 0.5 + 0.6 * Math.sin(ph) - 0.9 * Math.max(0, 1 - d / 0.12);
    };
    const g0 = foldLines(skirtSheet(L0, P.w[0], P.w[1], R0, 0.25, 0, 151 + i, [0.003, 0.012, nF, fph], 0, 1, sk, w0), pleat(0));
    mesh(s0, g0, M.coat);
    mesh(s0, g0, M.lining);
    const s1 = joint(s0, 0, -L0, 0);
    const R1 = R0 + 0.25 * L0, fold = [0.012, 0.026, nF, fph];
    // the lower segment: black, then the ember-red lower edge to an even hem
    const g1 = foldLines(skirtSheet(L1, P.w[1], P.w[2], R1, 0.25, 0.012, 171 + i, fold, 0, 0.6, sk, w0), pleat(L0));
    mesh(s1, g1, M.coat);
    mesh(s1, g1, M.lining);
    const g2 = foldLines(skirtSheet(L1, P.w[1], P.w[2], R1, 0.25, 0.012, 171 + i, fold, 0.6, 1, sk, w0), pleat(L0));
    mesh(s1, g2, M.hem);
    mesh(s1, g2, M.lining);
    if (i < 2) {
      // the lappets' inner edges: a line of piping
      const e = i === 0 ? -1 : 1;
      mesh(s0, sheetEdge(L0, P.w[0], P.w[1], R0, e, 1, 0.25, sk, w0), M.piping);
      mesh(s1, sheetEdge(L1, P.w[1], P.w[2], R1, e, 1, 0.25, sk, w0), M.piping);
    }
    coat.push({ anchor, segs: [s0, s1], def: P, strips: [], len: [L0, L1], r0: R0 });
  });
  return { coat };
}

// ---------------------------------------------------------------- back: the cape
/**
 * The cape: five long sheets from the yoke's back and shoulders to the ankles, on the streamer
 * springs (anim.js _streamers), black outside and crimson inside, an ember-red lower edge. `at` = a
 * sheet's root on the chest joint, `ry` = the way its outer face looks (π = straight back, less =
 * toward his left), `w` = its width at the root / the seam / the hem, `len` = the two spring
 * segments, `out` = how far it stands off him at rest (tan of the angle), `wrap` = the radius it
 * curves round him at the root.
 */
export const LORD_CAPE = [
  { at: [0, 0.2, -0.17], ry: Math.PI, w: [0.2, 0.34, 0.5], len: [0.58, 0.6], out: 0.2, wrap: 0.3, seed: 5 },
  { at: [0.125, 0.204, -0.152], ry: Math.PI - 0.5, w: [0.19, 0.32, 0.47], len: [0.58, 0.59], out: 0.24, wrap: 0.28, seed: 19 },
  { at: [-0.125, 0.204, -0.152], ry: Math.PI + 0.5, w: [0.19, 0.32, 0.47], len: [0.58, 0.59], out: 0.24, wrap: 0.28, seed: 31 },
  { at: [0.236, 0.2, -0.088], ry: Math.PI - 1.08, w: [0.15, 0.26, 0.39], len: [0.55, 0.56], out: 0.3, wrap: 0.24, seed: 43 },
  { at: [-0.236, 0.2, -0.088], ry: Math.PI + 1.08, w: [0.15, 0.26, 0.39], len: [0.55, 0.56], out: 0.3, wrap: 0.24, seed: 59 },
];
/** How much the cape trails his motion (1 = a light ribbon) and how far a sheet may swing (rad). */
const CAPE_LAG = 0.55, CAPE_MAX = 1.4;

function buildCape({ chest, M, mesh, joint }) {
  const streamers = [];
  LORD_CAPE.forEach((d, i) => {
    const base = joint(chest, ...d.at);
    base.rotation.y = d.ry; // local +Z = the sheet's outer face, +X = across it
    const [w0, w1, w2] = d.w, [L0, L1] = d.len;
    const nF = Math.max(1, Math.round(w2 / 0.12)) + 0.5, ph = i * 1.9 + 0.4;
    const wAt = (dd) => (dd < L0 ? lerp(w0, w1, dd / L0) : lerp(w1, w2, Math.min(1, (dd - L0) / L1)));
    const pleat = (d0) => (x, y, z, u, gy) => {
      const dd = d0 - gy, w = wAt(dd);
      const f = Math.PI * 2 * nF * (u / w + 0.5 + 0.05 * Math.sin(dd * 7 + i * 1.7)) + ph + Math.PI;
      return 0.5 + 0.62 * (Math.sin(f) + 0.3 * Math.sin(f * 2.3 + 1.7)) - 0.9 * Math.max(0, 1 - dd / 0.16);
    };
    const s0 = joint(base);
    const g0 = foldLines(skirtSheet(L0, w0, w1, d.wrap, 0.25, 0, d.seed, [0.005, 0.02, nF, ph]), pleat(0));
    mesh(s0, g0, M.coat);
    mesh(s0, g0, M.lining);
    const s1 = joint(s0, 0, -L0, 0);
    const R1 = d.wrap + 0.25 * L0, fold = [0.02, 0.045, nF, ph];
    const g1 = foldLines(skirtSheet(L1, w1, w2, R1, 0.25, 0.03, d.seed + 7, fold, 0, 0.62), pleat(L0));
    mesh(s1, g1, M.coat);
    mesh(s1, g1, M.lining);
    const g2 = foldLines(skirtSheet(L1, w1, w2, R1, 0.25, 0.03, d.seed + 7, fold, 0.62, 1), pleat(L0));
    mesh(s1, g2, M.hem);
    mesh(s1, g2, M.lining);
    streamers.push({ segs: [s0, s1], len: d.len, out: d.out, lag: CAPE_LAG, max: CAPE_MAX, w: d.w, arm: 0 });
  });
  return { streamers };
}

// ---------------------------------------------------------------- weapon: the blades of red light
function buildSaber({ sword, M, mesh }) {
  const S = SABER, G = saberParts();
  mesh(sword, G.hilt, M.trim);
  mesh(sword, G.grip, M.shirt);
  const named = (name, geo, mat, z) => {
    const m = mesh(sword, geo, mat, 0, 0, z);
    m.name = name;
    return m;
  };
  const a = named('lordBladeA', G.bladeA, M.flask, S.guard);
  a.scale.z = S.tip - S.guard;
  const hb = named('lordHiltB', G.hiltB, M.trim, 0);
  const b = named('lordBladeB', G.bladeB, M.flask, -S.hiltB);
  b.scale.z = S.tipB - S.hiltB;
  const q = named('lordQuillons', G.quillons, M.flask, 0);
  hb.visible = b.visible = q.visible = false;
  return { keep: [a, hb, b, q] };
}

/** The off-hand saber of form 2 (lord.js hangs it on a joint at the left wrist): hilt, blade, fist. */
export function buildOffSaber(M) {
  const S = SABER, G = saberParts();
  const root = new THREE.Object3D();
  root.name = 'lordOffSaber';
  root.rotation.order = 'YXZ';
  const add = (geo, mat, z = 0, name = '') => {
    if (!geo.attributes.aPart) sub(geo, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.z = z;
    m.name = name;
    root.add(m);
    return m;
  };
  add(G.hilt, M.trim);
  add(G.grip, M.shirt);
  const F = gripFist(1.1);
  add(mergeGeometries([F.fingers, F.thumb, F.ridge]), M.armor);
  const blade = add(G.bladeA, M.flask, S.guard, 'lordBladeL');
  blade.scale.z = S.tip - S.guard;
  return { root, blade };
}

/** The set (registered into the hero's gear registry on import: gear/index.js registerItem). */
export const LORD_ITEMS = [
  { id: 'lord.helm.sallet', slot: 'head', name: 'Starless Sallet', hidesHair: true, shadowsFace: true, build: buildSallet },
  { id: 'lord.helm.crown', slot: 'head', name: 'Starless Crown', hidesHair: true, shadowsFace: true, build: buildCrown },
  { id: 'lord.helm.hood', slot: 'head', name: 'Starless Hood', hidesHair: true, shadowsFace: true, build: buildHood },
  { id: 'lord.plate', slot: 'chest', name: 'Void Cuirass', build: buildPlate },
  { id: 'lord.yoke', slot: 'shoulders', name: 'Plate Yoke', build: buildYoke },
  { id: 'lord.arms', slot: 'arms', name: 'Void Gauntlets', build: buildArms },
  { id: 'lord.legs', slot: 'legs', name: 'Void Greaves', build: buildLegs },
  { id: 'lord.skirt', slot: 'waist', name: 'War-Skirt', build: buildSkirt },
  { id: 'lord.cape', slot: 'back', name: 'Starless Cape', build: buildCape },
  { id: 'lord.saber', slot: 'weapon', name: 'Blade of Red Light', dims: SABER, build: buildSaber },
];
for (const item of LORD_ITEMS) registerItem(item);

/** What the Starless Lord wears (`look`: one of LORD_LOOKS). */
export const lordLoadout = (look = LORD_LOOK) => Object.freeze({
  head: `lord.helm.${LORD_LOOKS.includes(look) ? look : LORD_LOOKS[0]}`,
  chest: 'lord.plate',
  shoulders: 'lord.yoke',
  arms: 'lord.arms',
  legs: 'lord.legs',
  waist: 'lord.skirt',
  back: 'lord.cape',
  weapon: 'lord.saber',
});
export const LORD_LOADOUT = lordLoadout();
