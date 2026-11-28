import * as THREE from 'three';
import { ellipsoidGeometry } from '../../../render/glyphGeometry.js';
import { registerItem } from '../../player/gear/index.js';
import { panelSkirt } from '../../player/gear/sheet.js';
import { shapedHand, fistHand } from '../../player/gear/handShape.js';
import {
  gridGeometry, shellGeometry, bandGeometry, sub, foldLines, lerp, limb, gripFist, orient, arcPlate, boxGeometry, ring,
} from '../../player/heroGeo.js';
import { shatter, walls, cells, nearestCell, facet, merge, jag } from './bodyArt.js';
import { fsLookNow } from './look.js';

// The False Saint's gear (the BODY AGENT's file; ADR-286): the hero's skeleton (buildHero, the same
// animator) carrying TWO LAYERS, aligned, at one height in every phase (the owner's reference sheets,
// docs/art/false-saint-reference-v01; BRIEF "The body"):
//   the DISGUISE   olive synthetic skin (the face, the neck, the hands), short black hair, an asymmetric
//                  charcoal jacket to the upper thigh closing on a diagonal to his left hip, a short collar
//                  over a pale stone-grey shirt, a pale seam over both shoulders and down the sleeves, slim
//                  black trousers, black boots (the boots stay: the frame's feet are boots too)
//   the FRAME      under it: a faceted titanium head with a diagonal black sensor slot and three pale-cyan
//                  sensors, two overlapping jaw plates, a woven neck; a solid thoracic shell of titanium
//                  plates over woven microfilament, smoked-ceramic abdominal plates; plated arms with
//                  nested gimbal joints at the elbows, metal hands; plated hips, thighs and shins
//                  and the weapons: the elbow boosters, the right palm's iris, the right forearm's gun, the
//                  shoulder petals over missile cells, the back and calf thrusters, the back's mortar tubes,
//                  the core slit under the left collarbone
// THE REVEAL: the disguise is cut into SHARDS, each a piece of one shell part (shell.js PARTS: headR ...
// shinL) with a threshold `t`: a shard is gone while d.shell.part(its part) >= t (look.js dressSaint, when
// the shell's version moves). Each part's shards are cells over its surface (bodyArt.js cells /
// nearestCell: jagged edges), their thresholds rising with the distance from the part's WOUND (`O`), so a
// wound grows from where the reference starts it (the right cheek and temple, the right forearm, the
// left collarbone ...) and old damage stays. Every cut edge of the laminate has a pale rim (bodyArt.js
// walls, the `facing` material) that shows once the neighbour has gone; torn cloth tears on a finer,
// more ragged line than chipped skin. The frame under a part shows from the part's first chip (look.js).
// The thresholds are tuned so the shell's phase floors (shell.js FLOORS) draw the reference's milestones:
//   P2 the right cheek / temple to titanium, the right forearm bare, a crack at the left collarbone
//   P3 the right head and jaw, the right chest and arm, both legs mostly plated; a skin island on the
//      left cheek, the jacket on the left shoulder, a skin flake at the right thigh
//   P4 all but one scrap of jacket at the left hip and skin flakes at the left shoulder
//
// One `fs.*` item per slot (the hero's gear registry): fs.head (face, hair, the head's frame), fs.jacket
// (the jacket's torso, collar and shirt; the thoracic frame; the core, the back thrusters, the mortar),
// fs.arms (the sleeves, the hands; the arms' frame; boosters, iris, gun, petals), fs.legs (trousers,
// boots; the legs' frame; the calf thrusters), fs.skirt (the jacket's skirt: four sprung panels).
// Every switched mesh is kept out of the static merge and listed in the rig's dress record
// (root.userData.fsDress, dressOf below); look.js drives it.
//
// THE BODY CONTRACT (what the rules, the fx and the moves read; names unchanged after wave 0):
//   gear.js   FS_LOADOUT   the loadout (player/gear slots → item ids; weapon null: bare-handed)
//             FS_FIST      his "blade": { guard, tip } along the sword joint's +Z (the right hand)
//   look.js   tintSaint(M)              his colours, once after the rig is built (the kit's _tint)
//             dressSaint(d, dt)         every frame (the kit's dress): reads d.dressPhase (1..4), d.shell
//                                       (shell.js: part(name), exposure, version) and the weapon values
//             eyePoint(d, out)          his (right) eye as drawn (world; finite even with no rig)
//             handPoint(d, side, out)   his right ('R') / left ('L') hand as drawn (world)
//             partPoint(d, name, out)   where a weapon of his frame is, as drawn (world): 'palmR' the
//                                       cannon iris, 'palmL', 'elbowR' / 'elbowL' the boosters, 'shoulderR' /
//                                       'shoulderL' the missile cells, 'back' the back thrusters ('backR',
//                                       'backL' each), 'calfR' / 'calfL' the calf thrusters, 'core' the
//                                       chest's core slit, 'mortar' the mortar tubes' mouths, 'gunR' the
//                                       forearm gun's muzzle, 'eye', 'head', 'chest', 'handR', 'handL'
//             fsLettersOn()             his letters follow his size as the hero's (the kit's `letters`)
//   the actor (saint.js) carries:
//             d.dressPhase   1..4: the dress shown (core sets it at a transition's impact)
//             d.shell        the shell (shell.js FsShell)
//             d.eyePoint(out), d.handPoint(side, out), d.partPoint(name, out)   the same points
//   the weapons' values the moves drive (fields on d, 0..1, 0 / undefined = closed; look.js reads them):
//             d.fsJetK (both elbow boosters; d.fsJetR / d.fsJetL one side), d.fsPalmK (the right palm's
//             iris), d.fsGunK (the right forearm's gun), d.fsPetalK (the shoulder petals over the missile
//             cells), d.fsThrustK (the back and calf thrusters), d.fsCoreK (the core slit), d.fsTubeK (the
//             mortar tubes), d.eyesK (the sensors' light: how many are lit follows d.dressPhase),
//             A weapon under a part that still has its shell does not show (look.js).
//   the hand shapes (the v04 pack's hand details; strings on d, set by the pose / move code, read every frame):
//             d.fsHandR, d.fsHandL   'open' | 'reach' (drawn as open: the palm's contact) | 'guard' (half-
//                                    curled: the guard, the default; 'relax' draws as it) | 'clench' (a fist: the
//                                    booster punch only); d.fsFistR > 0.5 is the same as fsHandR 'clench'.
//                                    The left hand's grip on the sword joint (two-handed) is the animator's.

// ================================================================= the build's quiet stream
// (three names every geometry and mesh with a uuid drawn from Math.random: the body is built on a stream of
// its own so a seeded fight is never shifted by what he wears: memory note seeded-rng-shifts-with-new-objects)
let QS = 0x5a17e5;
function quietly(fn) {
  return (ctx) => {
    const mr = Math.random;
    let s = (QS = (QS + 0x9e3779b1) >>> 0);
    Math.random = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    try {
      return fn(ctx);
    } finally {
      Math.random = mr;
    }
  };
}

// ================================================================= the dress record
/** The dressing record on his rig: what look.js switches. */
export function dressOf(root) {
  return (root.userData.fsDress ??= {
    kind: 'fs', ver: -1,
    shards: [], // { part, t, meshes, gone }
    frame: [], // { parts, meshes, on }
    hands: [], // { part, t, skin: [meshes], metal: [meshes], kind: 'open' | 'fist' | 'grip', side, shown, want }
    weapons: {}, // name → { ... } (look.js)
    sensors: [], // { mesh, cover: [entries], i }
    eyes: [], // the human eyes (in shards)
    pts: {}, // name → Object3D marker (partPoint)
    cover: {}, // part → (x, y, z) → its shard there (in that part's cloth joint space)
    wk: {}, // the weapon values last drawn
  });
}

/** A shard entry of `part` gone at `t`. */
function shard(R, part, t) {
  const e = { part, t, meshes: [], gone: false };
  R.shards.push(e);
  return e;
}

/** piecewise-linear table [[u, t], ...] at u */
function tOf(tab, u) {
  if (u <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (u <= tab[i][0]) {
      const [u0, t0] = tab[i - 1], [u1, t1] = tab[i];
      return u1 > u0 ? lerp(t0, t1, (u - u0) / (u1 - u0)) : t1;
    }
  }
  return tab[tab.length - 1][1];
}

/**
 * Cut the layers of one part (on one joint) into shards: `cfg` = { n (shards), O (the wound: joint
 * space), R (m: the wound's reach), tAt (threshold table over the distance / R), amp (edge raggedness),
 * freq, depth (the laminate rim's depth; 0 none) }; layers = [{ g, mat, wall }]. Returns { key, ents }.
 */
function shardPart(R, ctx, joint, part, layers, cfg, keep) {
  const seeds = cells(layers[0].g, cfg.n, cfg.O);
  const key = nearestCell(seeds, cfg.amp ?? 0.3, cfg.freq ?? 1);
  const ents = seeds.map((s) => {
    const u = Math.min(1, Math.hypot(s[0] - cfg.O[0], s[1] - cfg.O[1], s[2] - cfg.O[2]) / cfg.R);
    return shard(R, part, Math.max(0.01, tOf(cfg.tAt, u) + 0.012 * jag(s[0] * 3, s[1] * 3, s[2] * 3)));
  });
  for (const L of layers) {
    for (const [k, g] of shatter(L.g, key)) {
      const m = ctx.mesh(joint, g, L.mat);
      ents[k].meshes.push(m);
      keep.push(m);
    }
    if (L.wall && (cfg.depth ?? 0.01) > 0) {
      for (const [k, g] of walls(L.g, key, cfg.depth ?? 0.01)) {
        const m = ctx.mesh(joint, g, ctx.M.facing);
        ents[k].meshes.push(m);
        keep.push(m);
      }
    }
  }
  if (!R.cover[part]) R.cover[part] = (x, y, z) => ents[key(x, y, z)];
  return { key, ents };
}

/** The frame's pieces of one item, merged per (part list, joint, material) into one mesh each. */
class FrameAcc {
  constructor(ctx, R, keep) {
    this.ctx = ctx;
    this.R = R;
    this.keep = keep;
    this.m = new Map();
  }
  put(parts, joint, g, mat) {
    const P = Array.isArray(parts) ? parts : [parts];
    const k = `${P.join('+')}|${joint.uuid}|${mat.uuid}`;
    let e = this.m.get(k);
    if (!e) this.m.set(k, (e = { parts: P, joint, mat, gs: [] }));
    e.gs.push(g);
    return g;
  }
  flush() {
    for (const e of this.m.values()) {
      const g = merge(e.gs);
      if (!g) continue;
      const mesh = this.ctx.mesh(e.joint, g, e.mat);
      mesh.visible = false;
      this.keep.push(mesh);
      this.R.frame.push({ parts: e.parts, meshes: [mesh], on: false });
    }
    this.m.clear();
  }
}

/** An empty marker joint (partPoint reads its world position; not a mesh: no bone). */
function marker(R, name, parent, x = 0, y = 0, z = 0) {
  const o = new THREE.Object3D();
  o.name = `fs.pt.${name}`;
  o.position.set(x, y, z);
  parent.add(o);
  R.pts[name] = o;
  return o;
}

/** A pivot (Object3D) at `at` whose local +Y runs along `dir` (and +Z toward `out`, when given). */
function pivot(parent, at, dir, out = null) {
  const o = new THREE.Object3D();
  o.position.set(at[0], at[1], at[2]);
  const y = new THREE.Vector3(...dir).normalize();
  const z = out ? new THREE.Vector3(...out) : Math.abs(y.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  parent.add(o);
  return o;
}

/** A thruster nozzle along its pivot's +Y: a short flared bell (its mouth at y = len). */
function nozzleGeo(len, r0, r1) {
  return merge([
    sub(limb({ length: len, r0, r1, radial: 10, rings: 2, capSegs: 1 }).rotateX(Math.PI).translate(0, 0, 0), 0),
    sub(ring(r1 * 1.08, r1 * 1.08, 0.004, 12).translate(0, len, 0), 1),
  ]);
}

const ySp = (h) => h - 1.035; // world idle height → spine space (REST.spine)
const yCh = (h) => h - 1.225; // → chest space (REST.chest)

// ================================================================= the head
// Head space (before BODY.headScale 1.08): the skull centre (0, 0.14, 0.005); the face looks down +Z;
// his left is +X. The body's own face (model.js) is taken off and rebuilt here in pieces that can chip.
const SKULL = [0, 0.14, 0.005];

// ---- the v04 pass (the owner's anchor.png: the face and the hair; ADR-286)
/** The hair (anchor.png): short, black, SIDE-PARTED on his left and swept over to his right, a lock falling
 *  over his right brow, cut close above the ears and at the nape. One shell over the skull (and over the
 *  frame's cranium under it), its strands drawn as lines running with the sweep; no spikes. */
const HAIR = {
  c: [0, 0.15, -0.008], r: [0.092, 0.106, 0.1], // the shell's base ellipsoid (head space)
  // the hairline: [azimuth (0 his front, + his left), elevation on the base ellipsoid]
  line: [[-Math.PI, -0.79], [-2.0, -0.3], [-1.5, 0.12], [-1.05, 0.2], [-0.72, 0.13], [-0.36, 0.06], [-0.08, 0.36], [0.12, 0.52], [0.45, 0.5], [1.0, 0.25], [1.5, 0.12], [2.0, -0.3], [Math.PI, -0.79]],
  part: 0.032, // the part's x (his left of the middle)
};
/** piecewise-linear [[a, v], ...] at a */
function tabAt(T, a) {
  if (a <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (a <= T[i][0]) return lerp(T[i - 1][1], T[i][1], (a - T[i - 1][0]) / (T[i][0] - T[i - 1][0]));
  return T[T.length - 1][1];
}
function hairGeo() {
  const { c, r, line, part } = HAIR;
  const g = gridGeometry(56, 16, (u, t, o) => {
    const a = -Math.PI + u * Math.PI * 2;
    // (the ends: the hairline breaks into short pointed locks, longer over the brow and at the nape)
    const tooth = Math.pow(0.5 + 0.5 * Math.sin(a * 11 + 1.3 + 0.6 * Math.sin(a * 3)), 3);
    const eh = tabAt(line, a) + 0.03 * jag(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0.2) - 0.1 * tooth;
    const e = lerp(1.52, eh, Math.pow(t, 0.85));
    const ce = Math.cos(e), dx = Math.sin(a) * ce, dy = Math.sin(e), dz = Math.cos(a) * ce;
    let x = c[0] + dx * r[0], y = c[1] + dy * r[1], z = c[2] + dz * r[2];
    // (toward the hairline the shell comes down onto the skin: the ends lie on the head, not a cap's brim)
    const w = 0.75 * Math.pow(t, 3);
    x = lerp(x, SKULL[0] + dx * 0.079, w);
    y = lerp(y, SKULL[1] + dy * 0.101, w);
    z = lerp(z, SKULL[2] + dz * 0.091, w);
    // the volume: thin at the ends, full on top and on the swept (right) side, lifted off the part; a groove
    // at the part
    let v = lerp(0.03, 0.004, Math.pow(t, 1.3));
    if (x < part) v += 0.012 * Math.max(0, dy) * Math.min(1, (part - x) / 0.05);
    if (dz > -0.3 && dy > 0.3) v -= 0.014 * Math.exp(-(((x - part) / 0.008) ** 2));
    // the lock over his right brow: carried forward and down at the front hairline
    const lock = Math.exp(-(((a + 0.42) / 0.3) ** 2)) * Math.pow(t, 2.5);
    v += 0.008 * lock;
    x += dx * v;
    y += dy * v - 0.01 * lock;
    z += dz * v + 0.01 * lock;
    o[0] = x;
    o[1] = y;
    o[2] = z;
    o[3] = a * 0.1;
    o[4] = y;
  });
  // (the strands: lines that run with the sweep, from the part over to his right and back, and down the sides)
  foldLines(g, (x, y, z) => {
    const s = (x - HAIR.part) * 0.55 + z * 0.9 - y * 0.25;
    return 0.5 + 0.62 * Math.sin(s * 150 + 0.4 * Math.sin(x * 90));
  });
  // (outward: the winding is checked once, at build)
  const p = g.attributes.position, n = g.attributes.normal;
  const k = 40, ox = p.getX(k) - c[0], oy = p.getY(k) - c[1], oz = p.getZ(k) - c[2];
  if (ox * n.getX(k) + oy * n.getY(k) + oz * n.getZ(k) < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) {
      const tmp = ix[i + 1];
      ix[i + 1] = ix[i + 2];
      ix[i + 2] = tmp;
    }
    g.computeVertexNormals();
  }
  return g;
}

/** The face's planes (anchor.png): narrow, the cheekbones high and defined, the cheeks hollow under them, a
 *  brow ridge over the eyes. Moves the skull's vertices (head space) in or out from the skull's axis. */
function sculptFace(g) {
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (z < 0.01) continue;
    const ax = Math.abs(x), front = Math.min(1, (z - 0.01) / 0.05);
    const cheek = Math.exp(-(((y - 0.118) / 0.011) ** 2)) * Math.exp(-(((ax - 0.054) / 0.016) ** 2));
    const hollow = Math.exp(-(((y - 0.088) / 0.013) ** 2)) * Math.exp(-(((ax - 0.05) / 0.017) ** 2));
    const brow = Math.exp(-(((y - 0.15) / 0.008) ** 2)) * Math.exp(-(((ax - 0.03) / 0.022) ** 2));
    const k = (0.0045 * cheek - 0.006 * hollow + 0.003 * brow) * front;
    const l = Math.hypot(x, z - SKULL[2]) || 1;
    P.setXYZ(i, x * (1 - 0.03 * front) + (x / l) * k, y, z + ((z - SKULL[2]) / l) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A brow (anchor.png: straight, dark, a little lifted toward the outer end) over the eye at x0 .. x1, lying
 *  on the skin a hair proud of it. */
function browGeo(sd) {
  return gridGeometry(8, 1, (u, t, o) => {
    const ax = lerp(0.014, 0.05, u), x = sd * ax;
    const y = 0.1495 + 0.004 * u - 0.0015 * (1 - u) + (t - 0.5) * lerp(0.0062, 0.0042, u);
    const zz = 0.005 + 0.09 * Math.sqrt(Math.max(0.02, 1 - (ax / 0.076) ** 2 - ((y - 0.14) / 0.1) ** 2));
    o[0] = x;
    o[1] = y;
    o[2] = zz + 0.0055 - 0.004 * u;
    o[3] = x;
    o[4] = y;
  }, sd < 0);
}

/** The V-jaw (model.js's recipe, finer). */
function jawGeo(k = 1, segs = [16, 10]) {
  const jaw = ellipsoidGeometry(0.05 * k, 0.04 * k, 0.056 * k, { widthSegs: segs[0], heightSegs: segs[1] });
  const jp = jaw.attributes.position;
  for (let i = 0; i < jp.count; i++) {
    const z = jp.getZ(i), y = jp.getY(i);
    const s = 1 - 0.45 * Math.max(0, z / (0.056 * k)) * Math.max(0, -y / (0.04 * k) + 0.3);
    jp.setX(i, jp.getX(i) * s);
  }
  jaw.computeVertexNormals();
  return jaw;
}

/** The sensor slot (head space): a dark band across the faceplate from his right cheekbone up to his
 *  left temple, on the plate's surface; `pt(s)` a point along its middle. */
const SLOT = { x0: -0.074, y0: 0.108, x1: 0.074, y1: 0.164, h: 0.014 };
const FACE = { c: SKULL, r: [0.072, 0.094, 0.084] }; // the faceplate (x, y, z radii)
function faceZ(x, y, out = 0.002) {
  const u = 1 - (x / FACE.r[0]) ** 2 - ((y - FACE.c[1]) / FACE.r[1]) ** 2;
  return FACE.c[2] + FACE.r[2] * Math.sqrt(Math.max(0.02, u)) + out;
}
const slotPt = (s, lift = 0.003) => {
  const x = lerp(SLOT.x0, SLOT.x1, s), y = lerp(SLOT.y0, SLOT.y1, s);
  return [x, y, faceZ(x, y, lift)];
};
/** Where the three sensors sit along the slot: the first at his right eye's outer corner (phase 2). */
export const SENSOR_AT = Object.freeze([0.17, 0.36, 0.63]);

function buildHead(ctx) {
  const { head, M, BODY } = ctx;
  const R = dressOf(ctx.root);
  const keep = [];
  // the body's face goes (its skin, its eyes): rebuilt below in pieces
  for (const c of [...head.children]) {
    if (c.isMesh && !c.userData.slot && (c.material === M.skin || c.material === M.eye)) {
      head.remove(c);
      c.geometry.dispose();
    }
  }
  // ---- the disguise: skin (the face, the jaw, the ears, the neck), split down the middle
  const skull = sculptFace(orient.up(ellipsoidGeometry(0.078, 0.09, 0.1, { widthSegs: 32, heightSegs: 24 })).translate(...SKULL));
  const jaw = jawGeo(1, [20, 12]).translate(SKULL[0], SKULL[1] - 0.066, SKULL[2] + 0.016);
  const neck = limb({ length: 0.12, r0: BODY.neck[0], r1: BODY.neck[1], radial: 18, rings: 6, capSegs: 1 }).translate(0, 0.1, 0);
  const ears = [-1, 1].map((s) => ellipsoidGeometry(0.012, 0.024, 0.018, { widthSegs: 8, heightSegs: 6 }).translate(s * 0.08, SKULL[1] - 0.014, SKULL[2] - 0.008));
  // (v04: a straight narrow nose, its ridge outlined, between the eyes and down to the tip)
  const nose = sub(ellipsoidGeometry(0.0085, 0.024, 0.012, { widthSegs: 8, heightSegs: 6 }).rotateX(-0.18).translate(0, 0.112, 0.091), 1);
  const face = merge([skull, jaw, neck, ...ears, nose]);
  const sides = {
    R: shatter(face, (x) => (x < 0 ? 0 : null)).get(0),
    L: shatter(face, (x) => (x >= 0 ? 0 : null)).get(0),
  };
  // the right cheek and temple go first (phase 2's chip), then the right half (phase 3); the left from the
  // temple and the brow (phase 3), the cheek's island last (phase 4)
  const cut = {
    R: shardPart(R, ctx, head, 'headR', [{ g: sides.R, mat: M.skin, wall: true }], {
      n: 7, O: [-0.058, 0.118, 0.07], R: 0.14, amp: 0.4, freq: 3.6, depth: 0.007,
      tAt: [[0, 0.04], [0.42, 0.76], [0.43, 0.84], [1, 0.99]],
    }, keep),
    L: shardPart(R, ctx, head, 'headL', [{ g: sides.L, mat: M.skin, wall: true }], {
      n: 7, O: [0.05, 0.19, 0.06], R: 0.15, amp: 0.4, freq: 3.6, depth: 0.007,
      tAt: [[0, 0.1], [0.42, 0.33], [0.43, 0.5], [1, 0.84]],
    }, keep),
  };
  // the eyes (v04, anchor.png: almond, a pale white round a dark iris, under a straight dark brow; model.js's
  // were dark holes) go with the skin round them; the brows too
  for (const ex of [0.031, -0.031]) {
    const p = [SKULL[0] + ex, SKULL[1] - 0.011, SKULL[2] + 0.0885];
    const side = ex < 0 ? 'R' : 'L', sd = Math.sign(ex);
    const ent = cut[side].ents[cut[side].key(...p)];
    const white = ctx.mesh(head, ellipsoidGeometry(0.0128, 0.0052, 0.0042, { widthSegs: 10, heightSegs: 4 }).rotateZ(sd * 0.08), M.piping, ...p);
    const iris = ctx.mesh(head, ellipsoidGeometry(0.0058, 0.0054, 0.0036, { widthSegs: 8, heightSegs: 4 }), M.eye, p[0] - sd * 0.0012, p[1] + 0.0004, p[2] + 0.0016);
    const brow = ctx.mesh(head, sub(browGeo(sd), 1), M.hair);
    ent.meshes.push(white, iris);
    cut[side].ents[cut[side].key(sd * 0.032, 0.151, 0.088)].meshes.push(brow);
    R.eyes.push(iris);
    keep.push(white, iris, brow);
  }
  // ---- the hair (v04: hairGeo, the anchor's side part; was the hero's mop): black, split down the middle,
  // three pieces a side
  const hm = hairGeo();
  const hairSide = (side, g) => shatter(g, (x) => ((x < 0) === (side === 'R') ? 0 : null)).get(0);
  for (const side of ['R', 'L']) {
    const gm = hairSide(side, hm);
    if (!gm) continue;
    const layers = [{ g: gm, mat: M.hair }];
    shardPart(R, ctx, head, side === 'R' ? 'headR' : 'headL', layers, side === 'R'
      ? { n: 3, O: [-0.09, 0.15, 0.05], R: 0.2, amp: 0.2, tAt: [[0, 0.82], [1, 0.97]], depth: 0 }
      : { n: 3, O: [0.09, 0.2, 0.0], R: 0.2, amp: 0.2, tAt: [[0, 0.52], [1, 0.84]], depth: 0 }, keep);
  }
  // ---- the frame: a faceted titanium faceplate and jaw plates, a smoked-ceramic cranium, the slot
  const F = new FrameAcc(ctx, R, keep);
  const bySide = (g, f) => {
    for (const side of ['R', 'L']) {
      const part = shatter(g, (x) => ((x < 0) === (side === 'R') ? 0 : null)).get(0);
      if (part) f(side === 'R' ? 'headR' : 'headL', part);
    }
  };
  const plate = facet(orient.up(ellipsoidGeometry(FACE.r[0], FACE.r[2], FACE.r[1], { widthSegs: 9, heightSegs: 7 })).translate(...FACE.c));
  bySide(plate, (p, g) => F.put(p, head, sub(g, 0), M.armor));
  const cran = facet(ellipsoidGeometry(0.088, 0.098, 0.094, { widthSegs: 9, heightSegs: 7 }).translate(0, 0.162, -0.016));
  bySide(cran, (p, g) => F.put(p, head, sub(g, 1), M.spike));
  // a crest down the middle (the brow over the crown to the nape), and an angular plate on each cheek
  // under the slot: the enclosed head's planes, outlined
  const crest = gridGeometry(2, 16, (u, t, o) => {
    const th = lerp(0.35, 2.7, t), w = (u - 0.5) * 0.016 * (1.2 - 0.5 * t);
    o[0] = w;
    o[1] = 0.162 + Math.sin(th) * 0.1;
    o[2] = -0.016 + Math.cos(th) * 0.096;
    o[3] = u;
    o[4] = t;
  }, true);
  F.put(['headR', 'headL'], head, sub(facet(crest), 0), M.bevel);
  for (const sd of [-1, 1]) {
    const cheek = gridGeometry(4, 3, (u, t, o) => {
      const x = sd * lerp(0.022, 0.066, u), y = lerp(0.112, 0.074, t) - (sd < 0 ? 0.012 : 0.0) * (1 - u) + 0.012 * u * (sd > 0 ? 1 : 0);
      o[0] = x;
      o[1] = y;
      o[2] = faceZ(x, y, 0.0035) - 0.004 * t;
      o[3] = x;
      o[4] = y;
    }, sd > 0);
    F.put(sd < 0 ? 'headR' : 'headL', head, sub(facet(cheek), 1), M.bevel);
  }
  // two overlapping jaw plates: the jaw (titanium) and a graphite mandible plate over it
  const jp = facet(jawGeo(0.94, [10, 7]).translate(SKULL[0], SKULL[1] - 0.066, SKULL[2] + 0.014));
  bySide(jp, (p, g) => F.put(p, head, sub(g, 1), M.armor));
  const mand = facet(ellipsoidGeometry(0.046, 0.02, 0.044, { widthSegs: 10, heightSegs: 5 }).translate(0, SKULL[1] - 0.08, SKULL[2] + 0.022));
  bySide(mand, (p, g) => F.put(p, head, sub(g, 0), M.spike));
  // the slot: a black band, faintly proud of the plate
  const slot = gridGeometry(24, 2, (s, t, o) => {
    const x = lerp(SLOT.x0, SLOT.x1, s), y = lerp(SLOT.y0, SLOT.y1, s) + (t - 0.5) * SLOT.h * (1 - 0.5 * Math.abs(s - 0.5));
    o[0] = x;
    o[1] = y;
    o[2] = faceZ(x, y, 0.0025);
    o[3] = x;
    o[4] = y;
  });
  bySide(slot, (p, g) => F.put(p, head, sub(g, 1), M.eye));
  // the woven neck
  F.put(['headR', 'headL'], head, foldLines(limb({ length: 0.13, r0: 0.046, r1: 0.042, radial: 14, rings: 3, capSegs: 1 }).translate(0, 0.1, 0), (x, y, z, u) => 0.5 + 0.6 * Math.sin(u * 60)), M.lining);
  // two titanium cords up the sides of the neck
  for (const sd of [-1, 1]) F.put(sd < 0 ? 'headR' : 'headL', head, sub(facet(arcPlate(0.09, -0.02, 0.047, 0.044, sd * 1.35, 0.35, 3)), 1), M.armor);
  F.flush();
  // the three sensors along the slot (one mesh each: look.js lights them by phase, grows them with the
  // camera's distance so each still fills a letter cell at the game camera, puts them out at his death)
  SENSOR_AT.forEach((s, i) => {
    const p = slotPt(s, 0.0045);
    const m = ctx.mesh(head, ellipsoidGeometry(0.0046, 0.0042, 0.003, { widthSegs: 8, heightSegs: 5 }), M.flask, ...p);
    m.visible = false;
    keep.push(m);
    const side = p[0] < 0 ? 'R' : 'L';
    R.sensors.push({ mesh: m, i, cover: [cut[side].ents[cut[side].key(...p)]], part: side === 'R' ? 'headR' : 'headL' });
    marker(R, `sensor${i}`, head, ...p);
  });
  marker(R, 'eyeHuman', head, SKULL[0] - 0.032, SKULL[1] - 0.012, SKULL[2] + 0.1);
  marker(R, 'head', head, 0, 0.13, 0.01);
  return { keep };
}

// ================================================================= the jacket's torso, collar and shirt
/** The jacket over the torso (world idle heights): the hero's shell a little proud, closed, up to the
 *  collar. */
const JACKET = [
  { y: 1.09, rx: 0.158, rz: 0.12 },
  { y: 1.21, rx: 0.142, rz: 0.108 },
  { y: 1.3, rx: 0.166, rz: 0.118, cz: 0.008 },
  { y: 1.37, rx: 0.192, rz: 0.13, cz: 0.014 },
  { y: 1.43, rx: 0.204, rz: 0.126, cz: 0.01 },
  { y: 1.475, rx: 0.178, rz: 0.11, cz: 0.003 },
  { y: 1.505, rx: 0.1, rz: 0.082 },
  { y: 1.522, rx: 0.068, rz: 0.064 },
];
/** The ring at height y (world) of a ring list (rx, rz, cz interpolated). */
function ringAt(rings, y) {
  for (let i = 1; i < rings.length; i++) {
    if (y <= rings[i].y || i === rings.length - 1) {
      const A = rings[i - 1], B = rings[i], u = Math.min(1, Math.max(0, (y - A.y) / (B.y - A.y)));
      return { rx: lerp(A.rx, B.rx, u), rz: lerp(A.rz, B.rz, u), cz: lerp(A.cz ?? 0, B.cz ?? 0, u) };
    }
  }
  return rings[rings.length - 1];
}
/** A point on a ring list's surface at angle a (0 his front, + his left), height y (world), `out` m proud
 *  → spine space. */
function onShell(rings, a, y, out = 0) {
  const r = ringAt(rings, y);
  return [Math.sin(a) * (r.rx + out), ySp(y), Math.cos(a) * (r.rz + out) + r.cz];
}
/** A strip on a ring list's surface along a path p(s) → [a, y], `w` wide (across: up the body), `out` proud. */
function shellStrip(rings, path, w, out, n = 24) {
  return gridGeometry(n, 1, (s, t, o) => {
    const [a, y] = path(s);
    const [x, yy, z] = onShell(rings, a, y + (t - 0.5) * w, out);
    o[0] = x;
    o[1] = yy;
    o[2] = z;
    o[3] = s;
    o[4] = yy;
  });
}
/** The diagonal close: from the collar at his right down to his left hip (angle, height). */
const CLOSE = (s) => [lerp(-0.42, 0.95, s), lerp(1.5, 1.1, s)];

function buildJacket(ctx) {
  const { spine, chest, M } = ctx;
  const R = dressOf(ctx.root);
  const keep = [];
  const rings = JACKET.map((r) => ({ ...r, y: ySp(r.y), gap: 0 }));
  // the closed shell, the diagonal overlap's crease drawn into it, the flap's edge a ribbon over it
  const shell = foldLines(shellGeometry(rings, { sub: 4, cols: 36 }), (x, y, z) => {
    if (z < 0.02) return 0.5;
    const s = Math.min(1, Math.max(0, (ySp(1.5) - y) / 0.4));
    const [a] = CLOSE(s);
    // (a narrow shaded strip under the flap's edge: the crease line and the overlap's shadow, the rest
    // of the front plain cloth)
    const dv = Math.atan2(x, z) - a;
    return dv > 0 && dv < 0.09 ? 0.7 : 0.3;
  });
  const flap = sub(shellStrip(JACKET, CLOSE, 0.016, 0.0035, 30), 1);
  const cloth = merge([shell, flap]);
  // the pale seams over both shoulders (from the collar out to the shoulder's point)
  const seams = merge([-1, 1].map((sd) => gridGeometry(10, 1, (s, t, o) => {
    const y = lerp(1.508, 1.42, s), r = ringAt(JACKET, y);
    const a = sd * Math.PI * 0.5 + (t - 0.5) * 0.009 / r.rx;
    const [x, yy, z] = onShell(JACKET, a, y, 0.003);
    o[0] = x;
    o[1] = yy;
    o[2] = z;
    o[3] = s;
    o[4] = yy;
  })));
  const half = (g, side) => shatter(g, (x) => ((x < 0) === (side === 'R') ? 0 : null)).get(0);
  const cut = {};
  for (const side of ['R', 'L']) {
    const part = side === 'R' ? 'chestR' : 'chestL';
    const cfg = side === 'R'
      ? { n: 6, O: [-0.07, ySp(1.5), 0.06], R: 0.46, amp: 0.4, freq: 2.2, depth: 0.014, tAt: [[0, 0.32], [1, 0.97]] }
      : { n: 6, O: [0.09, ySp(1.47), 0.08], R: 0.46, amp: 0.4, freq: 2.2, depth: 0.014, tAt: [[0, 0.1], [0.18, 0.24], [0.19, 0.36], [1, 0.94]] };
    const layers = [{ g: half(cloth, side), mat: M.coat, wall: true }];
    const sg = half(seams, side);
    if (sg) layers.push({ g: sg, mat: M.piping });
    cut[side] = shardPart(R, ctx, spine, part, layers, cfg, keep);
  }
  // the short collar (jacket) over the pale stone-grey shirt's collar (chest space): each half a shard
  for (const side of ['R', 'L']) {
    const part = side === 'R' ? 'chestR' : 'chestL';
    const sgn = side === 'R' ? -1 : 1;
    const arc = side === 'R' ? [-Math.PI, 0] : [0, Math.PI];
    const coll = shellGeometry([{ y: yCh(1.505), rx: 0.072, rz: 0.066 }, { y: yCh(1.545), rx: 0.064, rz: 0.06 }], { sub: 2, cols: 12, arc });
    const shirt = shellGeometry([{ y: yCh(1.51), rx: 0.06, rz: 0.058, cz: 0.004 }, { y: yCh(1.556), rx: 0.054, rz: 0.054, cz: 0.004 }], { sub: 1, cols: 10, arc });
    const ec = shard(R, part, side === 'R' ? 0.5 : 0.9), es = shard(R, part, side === 'R' ? 0.58 : 0.93);
    for (const [g, mat, e] of [[coll, M.collar, ec], [shirt, M.shirt, es]]) {
      const m = ctx.mesh(chest, sub(g, 1), mat);
      e.meshes.push(m);
      keep.push(m);
    }
    void sgn;
  }
  // ---- the frame: a solid thoracic shell of titanium plates over woven microfilament, smoked-ceramic
  // abdominal plates, the woven waist showing between them
  const F = new FrameAcc(ctx, R, keep);
  const inner = (d) => JACKET.slice(0, 7).map((r) => ({ ...r, y: ySp(r.y), rx: r.rx - d, rz: r.rz - d, gap: 0 }));
  const woven = foldLines(shellGeometry(inner(0.026), { sub: 3, cols: 30 }), (x, y, z, u) => 0.5 + 0.6 * Math.sin(u * 70 + y * 30));
  for (const side of ['R', 'L']) {
    const part = side === 'R' ? 'chestR' : 'chestL';
    const sgn = side === 'R' ? -1 : 1;
    const g = half(woven, side);
    if (g) F.put(part, spine, g, M.lining);
    const at = (a0, a1) => (sgn < 0 ? [-a1, -a0] : [a0, a1]);
    const plates = (y0, y1, a0, a1, d, mat, k) => {
      const rr = inner(d).filter(() => true);
      const band = [ringAt(rr.map((r) => ({ ...r, y: r.y + 1.035 })), y0), ringAt(rr.map((r) => ({ ...r, y: r.y + 1.035 })), y1)];
      const g2 = shellGeometry([{ y: ySp(y0), ...band[0] }, { y: ySp(y1), ...band[1] }], { sub: 2, cols: 8, arc: at(a0, a1) });
      F.put(part, spine, sub(facet(g2), k), mat);
    };
    // the pectoral plate, the collarbone plate, the side and the back
    plates(1.32, 1.47, 0.08, 1.2, 0.014, M.armor, 0);
    plates(1.47, 1.505, 0.1, 1.35, 0.012, M.armor, 1);
    plates(1.24, 1.46, 1.3, 1.95, 0.016, M.armor, 1);
    plates(1.22, 1.48, 1.98, 3.08, 0.014, M.armor, 0);
    // the abdominal plates: three rows, a gap of woven between them
    plates(1.255, 1.31, 0.06, 0.62, 0.016, M.spike, 1);
    plates(1.19, 1.245, 0.06, 0.6, 0.018, M.spike, 0);
    plates(1.125, 1.18, 0.06, 0.58, 0.02, M.spike, 1);
    plates(1.13, 1.3, 0.7, 1.25, 0.022, M.spike, 0);
  }
  F.flush();
  // ---- the weapons of the torso (look.js opens them)
  const W = R.weapons;
  // the core slit under his left collarbone: a small recessed ivory slit, a titanium lip round it
  {
    const [x, y, z] = onShell(JACKET, 0.48, 1.425, -0.012);
    const p = pivot(spine, [x, y, z], [0, 1, 0], [Math.sin(0.48), 0, Math.cos(0.48)]);
    const slit = ctx.mesh(p, ellipsoidGeometry(0.024, 0.0055, 0.004, { widthSegs: 10, heightSegs: 4 }), M.gem, 0, 0, 0.003);
    const lip = ctx.mesh(p, sub(ring(0.03, 0.011, 0.003, 12).rotateX(Math.PI / 2), 1), M.trim, 0, 0, 0.001);
    slit.visible = lip.visible = false;
    keep.push(slit, lip);
    W.core = { meshes: [slit, lip], slit, cover: [cut.L.ents[cut.L.key(x, y, z)]] };
    marker(R, 'core', p, 0, 0, 0.012);
  }
  // the back thrusters: two nozzles at the shoulder blades, aimed down and back
  for (const side of ['R', 'L']) {
    const s = side === 'R' ? -1 : 1;
    const [x, y, z] = onShell(JACKET, s * 2.72, 1.33, -0.02);
    const p = pivot(spine, [x, y, z], [s * 0.15, -0.55, -0.82]);
    const n = ctx.mesh(p, nozzleGeo(0.06, 0.024, 0.034), M.trim);
    n.visible = false;
    keep.push(n);
    W[`back${side}`] = { meshes: [n], pivot: p, cover: [cut[side].ents[cut[side].key(x, y, z)]] };
    marker(R, `back${side}`, p, 0, 0.07, 0);
  }
  marker(R, 'back', spine, 0, ySp(1.33), -0.14);
  // the mortar tubes: three, folded flat down the upper back; they rise to point up and back
  {
    const [x, y, z] = onShell(JACKET, Math.PI, 1.45, -0.012);
    const p = pivot(spine, [x, y, z], [0, -1, 0], [0, 0, -1]);
    const tubes = merge([-1, 0, 1].map((i) => sub(limb({ length: 0.15, r0: 0.019, r1: 0.021, radial: 10, rings: 2, capSegs: 1 }).rotateX(Math.PI).translate(i * 0.042, 0, 0.022), i & 1)));
    const mt = ctx.mesh(p, tubes, M.trim);
    const block = ctx.mesh(p, sub(boxGeometry(0.15, 0.05, 0.03, 0, 0.012, 0.012), 0), M.armor);
    mt.visible = block.visible = false;
    keep.push(mt, block);
    W.mortar = { meshes: [mt, block], pivot: p, rest: p.quaternion.clone(), cover: [cut.R.ents[cut.R.key(x - 0.04, y, z)], cut.L.ents[cut.L.key(x + 0.04, y, z)]] };
    marker(R, 'mortar', p, 0, 0.16, 0.022);
  }
  marker(R, 'chest', spine, 0, ySp(1.36), 0.06);
  return { keep };
}

// ================================================================= the arms and hands
/** The right hand open (sword space: the heel at the joint, the fingers along +Z, the palm to +X, the
 *  thumb up +Y): the guard's open hand, the palm strike's. */
function openHandR(k = 1, curl = 0.32) {
  const H = shapedHand(0, -1, k, curl);
  return merge([H.palm, H.fingers, H.tips, H.thumb]).rotateX(-Math.PI / 2).translate(0, 0, -0.03);
}

function buildArms(ctx) {
  const { arms, sword, M, DIM, BODY } = ctx;
  const R = dressOf(ctx.root);
  const keep = [];
  const [ua0, ua1] = BODY.upperArm, [fa0, fa1] = BODY.foreArm, HK = BODY.hand;
  const W = R.weapons;
  const F = new FrameAcc(ctx, R, keep);
  for (const side of ['R', 'L']) {
    const s = side === 'R' ? -1 : 1;
    const { upper, fore } = arms[side];
    const P = { arm: `arm${side}`, fore: `fore${side}`, hand: `hand${side}` };
    // ---- the sleeves (the jacket's), the pale seam down the top of each
    const up = merge([
      sub(limb({ length: DIM.upperArm, r0: ua0 + 0.005, r1: ua1 + 0.005, bulge: 0.005, radial: 16, rings: 8 }), 1),
      sub(ellipsoidGeometry(BODY.deltoid[0] + 0.004, BODY.deltoid[1] + 0.004, BODY.deltoid[2] + 0.004, { widthSegs: 16, heightSegs: 10 }).translate(s * 0.006, -0.018, 0), 0),
    ]);
    // (over the deltoid's crown and down its outer side, then straight down the sleeve to the elbow)
    const dx = BODY.deltoid[0] + 0.0075, dy = BODY.deltoid[1] + 0.0075;
    const seamU = merge([
      gridGeometry(1, 8, (u, t, o) => {
        const el = lerp(1.35, 0.1, t);
        o[0] = s * (0.006 + Math.cos(el) * dx);
        o[1] = -0.018 + Math.sin(el) * dy;
        o[2] = (u - 0.5) * 0.009;
        o[3] = u;
        o[4] = o[1];
      }, s < 0),
      gridGeometry(1, 10, (u, t, o) => {
        const y = lerp(-0.03, -DIM.upperArm + 0.012, t);
        o[0] = s * (lerp(ua0, ua1, -y / DIM.upperArm) + 0.0085);
        o[1] = y;
        o[2] = (u - 0.5) * 0.009;
        o[3] = u;
        o[4] = y;
      }, s < 0),
    ]);
    const cutU = shardPart(R, ctx, upper, P.arm, [{ g: up, mat: M.coat, wall: true }, { g: seamU, mat: M.piping }], side === 'R'
      ? { n: 5, O: [0, -0.27, -0.03], R: 0.34, amp: 0.4, freq: 2.2, depth: 0.012, tAt: [[0, 0.3], [1, 0.97]] }
      : { n: 5, O: [0, -0.27, -0.03], R: 0.34, amp: 0.4, freq: 2.2, depth: 0.012, tAt: [[0, 0.22], [1, 0.68]] }, keep);
    const y1 = -DIM.foreArm + 0.055;
    const fo = merge([
      sub(limb({ length: 0.09, r0: ua1 + 0.004, r1: ua1, radial: 16, rings: 3 }), 1),
      sub(limb({ length: -y1 - 0.03, r0: fa0 + 0.005, r1: fa1 + 0.007, radial: 16, rings: 8, bulge: 0.003 }).translate(0, -0.05, 0), 0),
    ]);
    const cutF = shardPart(R, ctx, fore, P.fore, [{ g: fo, mat: M.coat, wall: true }], side === 'R'
      ? { n: 5, O: [0, -0.24, 0.03], R: 0.3, amp: 0.4, freq: 2.2, depth: 0.012, tAt: [[0, 0.05], [1, 0.9]] }
      : { n: 5, O: [0, -0.24, 0.03], R: 0.3, amp: 0.4, freq: 2.2, depth: 0.012, tAt: [[0, 0.42], [1, 0.97]] }, keep);
    // ---- the hands: skin, and the metal hand under it (look.js shows one; the animator picks which hand)
    const skinT = side === 'R' ? { palm: 0.84, wrist: 0.86 } : { palm: 0.48, wrist: 0.5 };
    // the wrist (skin) under the cuff, the frame's wrist under it
    const wrist = ellipsoidGeometry(0.03 * HK, 0.042 * HK, 0.032 * HK, { widthSegs: 12, heightSegs: 7 });
    const ws = ctx.mesh(fore, wrist.clone(), M.skin, 0, -DIM.foreArm + 0.035, 0.004);
    const wm = ctx.mesh(fore, facet(wrist.clone().scale(0.94, 1, 0.94)), M.armor, 0, -DIM.foreArm + 0.035, 0.004);
    keep.push(ws, wm);
    R.hands.push({ part: P.hand, t: skinT.wrist, skin: [ws], metal: [wm], side, wrist: true });
    // each hand shape (the v04 pack's hand details: open, guard, clench; reach draws as open, relax as guard) in
    // skin and in metal; look.js shows the one the pose asks for (d.fsHandR / d.fsHandL) in the right layer
    const shapes = (parent, geos) => {
      const h = { part: P.hand, t: skinT.palm, side, shapes: {}, shape: '' };
      for (const [name, g] of Object.entries(geos)) {
        const sm = ctx.mesh(parent, g, M.skin);
        const mm = ctx.mesh(parent, g.clone().scale(0.97, 0.97, 0.97), M.armor);
        sm.visible = mm.visible = false;
        keep.push(sm, mm);
        h.shapes[name] = { skin: sm, metal: mm };
      }
      R.hands.push(h);
      return h;
    };
    if (side === 'R') {
      // the right hand on the sword joint (the pose turns it: `sw`); the clench is the fist round the
      // sword joint's axis (the booster punch)
      const Fi = gripFist(HK);
      R.handR = shapes(sword, {
        open: openHandR(1.06, 0.06), guard: openHandR(1.04, 0.5),
        clench: merge([Fi.fingers, Fi.thumb, Fi.ridge]),
      });
      // the palm's iris (the cannon): a titanium ring and an ivory centre on the palm (+X)
      const ip = pivot(sword, [0.02, 0.002, 0.018], [1, 0, 0], [0, 1, 0]);
      const irisRing = ctx.mesh(ip, sub(ring(0.02, 0.02, 0.0025, 14), 1), M.trim);
      const irisC = ctx.mesh(ip, ellipsoidGeometry(0.011, 0.011, 0.0035, { widthSegs: 10, heightSegs: 4 }).rotateX(Math.PI / 2), M.gem, 0, 0.001, 0);
      irisRing.visible = irisC.visible = false;
      keep.push(irisRing, irisC);
      W.iris = { meshes: [irisRing, irisC], ring: irisRing, centre: irisC, pivot: ip };
      marker(R, 'palmR', ip, 0, 0.012, 0);
    } else {
      // the left hand: open on the free wrist (the animator's `offHand.open`), closed on the grip when it
      // comes there (`offHand.grip`): the reference's open guard hand
      // (the animator shows `offHand.open` or `offHand.grip`: here each is a group, so the shape and the
      // layer inside it stay ours)
      const wj = arms.L.wrist ?? fore, wp = arms.L.wrist?.position;
      const gOpen = new THREE.Object3D(), gGrip = new THREE.Object3D();
      wj.add(gOpen);
      sword.add(gGrip);
      gGrip.visible = false;
      const lh = (curl, k = 1.04) => {
        const H = shapedHand(DIM.foreArm - 0.03, 1, k, curl);
        const g = merge([H.palm, H.fingers, H.tips, H.thumb]);
        if (wp) g.translate(-wp.x, -wp.y, -wp.z);
        return g;
      };
      const FL = fistHand(DIM.foreArm - 0.03, 1, 1);
      const fl = merge([FL.palm, FL.fingers, FL.tips, FL.thumb]);
      if (wp) fl.translate(-wp.x, -wp.y, -wp.z);
      R.handL = shapes(gOpen, { open: lh(0.06, 1.06), guard: lh(0.5), clench: fl });
      const Fi = gripFist(HK);
      R.handLGrip = shapes(gGrip, { clench: merge([Fi.fingers, Fi.thumb, Fi.ridge]).translate(0, 0, -DIM.offGrip) });
      R.handLGrip.fixed = 'clench';
      R.offHand = { open: gOpen, grip: gGrip };
      marker(R, 'palmL', wj, -0.022, -(DIM.foreArm - 0.03) + (wp ? -wp.y : 0) - 0.05, 0);
    }
    // ---- the frame: plated arms over woven microfilament, nested gimbal joints at the elbows
    F.put(P.arm, upper, foldLines(limb({ length: DIM.upperArm, r0: ua0 - 0.014, r1: ua1 - 0.012, radial: 12, rings: 3 }), (x, y, z, u) => 0.5 + 0.6 * Math.sin(u * 60)), M.lining);
    F.put(P.arm, upper, sub(facet(ellipsoidGeometry(BODY.deltoid[0] - 0.01, BODY.deltoid[1] - 0.01, BODY.deltoid[2] - 0.01, { widthSegs: 9, heightSegs: 6 }).translate(s * 0.006, -0.018, 0)), 0), M.armor);
    F.put(P.arm, upper, sub(facet(arcPlate(-0.06, -0.25, ua0 - 0.004, ua1 - 0.003, s * Math.PI * 0.5, 0.95, 6)), 1), M.armor);
    F.put(P.arm, upper, sub(facet(arcPlate(-0.07, -0.24, ua0 - 0.006, ua1 - 0.005, 0, 0.6, 4)), 0), M.spike);
    F.put(P.fore, fore, foldLines(limb({ length: DIM.foreArm - 0.04, r0: fa0 - 0.014, r1: fa1 - 0.012, radial: 12, rings: 3 }), (x, y, z, u) => 0.5 + 0.6 * Math.sin(u * 60)), M.lining);
    F.put(P.fore, fore, sub(facet(arcPlate(-0.03, -DIM.foreArm + 0.07, fa0 - 0.004, fa1 - 0.002, s * Math.PI * 0.55, 1.0, 6)), 1), M.armor);
    F.put(P.fore, fore, sub(facet(arcPlate(-0.04, -DIM.foreArm + 0.08, fa0 - 0.006, fa1 - 0.004, -s * Math.PI * 0.4, 0.9, 5)), 0), M.armor);
    // the elbow's gimbal: two nested non-circular rings, crossed
    F.put(P.fore, fore, sub(ring(0.05, 0.036, 0.008, 14).rotateZ(Math.PI / 2), 1), M.bevel);
    F.put(P.fore, fore, sub(ring(0.04, 0.03, 0.007, 12).rotateX(Math.PI / 2).rotateZ(0.4 * s), 0), M.bevel);
    // ---- the weapons of the arm
    // the elbow booster: a nozzle at the back of the elbow, aimed back up the forearm
    {
      const at = [0, 0.004, -0.04];
      const p = pivot(fore, at, [0, 0.55, -0.84]);
      const n = ctx.mesh(p, nozzleGeo(0.05, 0.02, 0.03), M.trim);
      n.visible = false;
      keep.push(n);
      W[`elbow${side}`] = { meshes: [n], pivot: p, cover: [cutF.ents[cutF.key(...at)], cutU.ents[cutU.key(0, -DIM.upperArm + 0.01, -0.04)]] };
      marker(R, `elbow${side}`, p, 0, 0.06, 0);
    }
    // the shoulder petals: three smoked-ceramic plates over the deltoid, hinged at the top; they open
    // outward on a block of missile cells
    {
      const petals = [];
      for (const [az, len, w] of [[-0.75, 0.085, 0.034], [0, 0.095, 0.04], [0.75, 0.085, 0.034]]) {
        const ox = s * Math.cos(az), oz = Math.sin(az);
        const top = [s * 0.006 + ox * 0.03, 0.04, oz * 0.03];
        const p = pivot(upper, top, [ox * 0.55, -0.83, oz * 0.55], [ox, 0.3, oz]);
        // a curved plate hanging down its pivot's +Y... (built along +Y, bowed out +Z)
        const g = gridGeometry(6, 5, (u, t, o) => {
          const x = (u - 0.5) * 2 * w * (1 - 0.45 * t), y = t * len, z = 0.012 * Math.cos((u - 0.5) * 2.4) + 0.006 * t;
          o[0] = x;
          o[1] = y;
          o[2] = z;
          o[3] = x;
          o[4] = y;
        }, true);
        const m = ctx.mesh(p, sub(facet(g), petals.length & 1), M.spike);
        m.visible = false;
        keep.push(m);
        petals.push({ m, p, rest: p.quaternion.clone() });
      }
      const cellsBox = foldLines(boxGeometry(0.05, 0.045, 0.035, s * 0.05, -0.005, 0), (x, y, z) => 0.5 + 0.6 * Math.sin(y * 210) * Math.sin(z * 190 + 0.5));
      const cb = ctx.mesh(upper, cellsBox, M.trim);
      cb.visible = false;
      keep.push(cb);
      const c0 = cutU.ents[cutU.key(s * 0.06, 0.03, 0)];
      W[`petals${side}`] = { petals, cells: cb, meshes: [...petals.map((x) => x.m), cb], cover: [c0] };
      marker(R, `shoulder${side}`, upper, s * 0.075, 0.0, 0);
    }
    // the right forearm's gun: a barrel along the outer forearm under a housing plate that opens
    if (side === 'R') {
      const p = pivot(fore, [s * (fa0 + 0.002), -0.1, 0.0], [0, -1, 0], [s, 0, 0]);
      const barrel = ctx.mesh(p, sub(limb({ length: 0.15, r0: 0.012, r1: 0.011, radial: 10, rings: 2, capSegs: 1 }).rotateX(Math.PI), 0), M.trim, 0, -0.02, -0.004);
      const hp = new THREE.Object3D();
      hp.position.set(0, 0, 0.002);
      p.add(hp);
      const housing = ctx.mesh(hp, sub(facet(boxGeometry(0.034, 0.14, 0.008, 0, 0.06, 0.008)), 1), M.armor);
      barrel.visible = housing.visible = false;
      keep.push(barrel, housing);
      W.gun = { meshes: [barrel, housing], barrel, housing: hp, cover: [cutF.ents[cutF.key(s * fa0, -0.12, 0)], cutF.ents[cutF.key(s * fa0, -0.2, 0)]] };
      marker(R, 'gunR', barrel, 0, 0.16, 0);
    }
    marker(R, `hand${side}`, fore, 0, -DIM.foreArm, 0);
  }
  F.flush();
  return { offHand: R.offHand, keep };
}

// ================================================================= the legs
function buildLegs(ctx) {
  const { pelvis, legs, M, DIM, BODY } = ctx;
  const R = dressOf(ctx.root);
  const keep = [];
  const W = R.weapons;
  const F = new FrameAcc(ctx, R, keep);
  // ---- the trousers' seat (the hip part, under the jacket's skirt)
  const [hx, hy, hz] = BODY.hips.r;
  const seat = orient.up(ellipsoidGeometry(hx + 0.004, hz + 0.004, hy + 0.006, { widthSegs: 20, heightSegs: 12 })).translate(...BODY.hips.c);
  shardPart(R, ctx, pelvis, 'hip', [{ g: seat, mat: M.pants }], { n: 4, O: [-0.12, 0.0, 0.08], R: 0.3, amp: 0.35, freq: 2, depth: 0.01, tAt: [[0, 0.3], [1, 0.74]] }, keep);
  F.put('hip', pelvis, sub(facet(orient.up(ellipsoidGeometry(hx - 0.008, hz - 0.008, hy - 0.004, { widthSegs: 10, heightSegs: 6 })).translate(...BODY.hips.c)), 0), M.armor);
  F.put('hip', pelvis, foldLines(bandGeometry(0.125, 0.09, 0.08, 20).translate(0, 0.1, -0.004), (x, y, z, u) => 0.5 + 0.6 * Math.sin(u * 70)), M.lining);
  const [th0, th1, thB] = BODY.thigh, [sh0, sh1, shB] = BODY.shin, Ft = BODY.foot;
  for (const side of ['R', 'L']) {
    const s = side === 'R' ? -1 : 1;
    const { thigh, shin, foot } = legs[side];
    const P = { leg: `leg${side}`, shin: `shin${side}` };
    // ---- the trousers: slim, black
    const tg = limb({ length: DIM.thigh, r0: th0 + 0.002, r1: th1 + 0.002, bulge: thB, radial: 16, rings: 9 });
    // (the left leg: a, the second sheet's 03, both legs plated in phase 3; `?fsLook=b`, the first sheet's
    // 03, the left trouser whole until phase 4)
    const b = fsLookNow() === 'b';
    const cutT = shardPart(R, ctx, thigh, P.leg, [{ g: tg, mat: M.pants }], side === 'R'
      ? { n: 6, O: [0, -0.4, 0.06], R: 0.46, amp: 0.42, freq: 2.2, depth: 0.012, tAt: [[0, 0.12], [1, 0.69]] }
      : { n: 6, O: [0, -0.4, 0.06], R: 0.46, amp: 0.42, freq: 2.2, depth: 0.012, tAt: b ? [[0, 0.32], [1, 0.95]] : [[0, 0.08], [1, 0.62]] }, keep);
    const sg = merge([
      limb({ length: DIM.shin - 0.07, r0: th1 + 0.002, r1: sh1 + 0.01, bulge: shB, radial: 16, rings: 8 }),
      sub(limb({ length: 0.03, r0: sh1 + 0.012, r1: sh1 + 0.013, radial: 16, rings: 1, capSegs: 1 }).translate(0, -DIM.shin + 0.1, 0), 1),
    ]);
    const cutS = shardPart(R, ctx, shin, P.shin, [{ g: sg, mat: M.pants }], side === 'R'
      ? { n: 5, O: [0, -0.2, 0.06], R: 0.34, amp: 0.42, freq: 2.2, depth: 0.012, tAt: [[0, 0.22], [1, 0.95]] }
      : { n: 5, O: [0, -0.2, 0.06], R: 0.34, amp: 0.42, freq: 2.2, depth: 0.012, tAt: b ? [[0, 0.47], [1, 0.97]] : [[0, 0.12], [1, 0.9]] }, keep);
    // ---- the boots (black, always: the frame's feet are boots too)
    ctx.mesh(shin, sub(limb({ length: 0.11, r0: sh1 + 0.006, r1: sh1 + 0.004, radial: 14, rings: 2, capSegs: 1 }).translate(0, -DIM.shin + 0.11, 0), 1), M.welt);
    ctx.mesh(foot, ellipsoidGeometry(Ft.r[0] * 0.96, Ft.r[1] * 0.86, Ft.r[2] * 1.02, { widthSegs: 12, heightSegs: 7 }).translate(Ft.c[0], Ft.c[1] - 0.004, Ft.c[2] + 0.008), M.welt);
    ctx.mesh(foot, sub(boxGeometry(Ft.r[0] * 1.7, 0.012, Ft.r[2] * 1.9, Ft.c[0], Ft.c[1] - Ft.r[1] * 0.78, Ft.c[2] + 0.01), 1), M.welt);
    // ---- the frame: plated thigh and shin over woven microfilament, the knee's gimbal
    F.put(P.leg, thigh, foldLines(limb({ length: DIM.thigh, r0: th0 - 0.014, r1: th1 - 0.012, radial: 12, rings: 4 }), (x, y, z, u) => 0.5 + 0.6 * Math.sin(u * 60)), M.lining);
    F.put(P.leg, thigh, sub(facet(arcPlate(-0.03, -DIM.thigh + 0.05, th0 - 0.004, th1 - 0.004, 0, 0.95, 6)), 1), M.armor);
    F.put(P.leg, thigh, sub(facet(arcPlate(-0.05, -DIM.thigh + 0.08, th0 - 0.005, th1 - 0.005, s * Math.PI * 0.55, 0.7, 5)), 0), M.armor);
    F.put(P.leg, thigh, sub(facet(arcPlate(-0.06, -DIM.thigh + 0.1, th0 - 0.007, th1 - 0.006, Math.PI, 0.85, 5)), 0), M.spike);
    // (below the knee everything is titanium or the woven calf in the trousers' black: the boss print's
    // pale hem never takes them)
    F.put(P.shin, shin, limb({ length: DIM.shin - 0.1, r0: th1 - 0.012, r1: sh1 - 0.006, bulge: shB, radial: 12, rings: 4 }), M.pants);
    F.put(P.shin, shin, sub(facet(arcPlate(-0.02, -DIM.shin + 0.12, th1 - 0.002, sh1 + 0.002, 0, 1.05, 6)), 1), M.armor);
    F.put(P.shin, shin, sub(facet(arcPlate(-0.04, -DIM.shin + 0.16, th1 - 0.004, sh1, s * Math.PI * 0.6, 0.6, 4)), 0), M.armor);
    F.put(P.shin, shin, sub(ring(0.055, 0.045, 0.009, 14).rotateZ(Math.PI / 2), 0), M.armor);
    // ---- the calf thruster: a nozzle at the back of the calf, aimed down and back
    {
      const at = [0, -0.17, -(sh0 - 0.004)];
      const p = pivot(shin, at, [0, -0.78, -0.62]);
      const n = ctx.mesh(p, nozzleGeo(0.055, 0.022, 0.032), M.armor);
      n.visible = false;
      keep.push(n);
      W[`calf${side}`] = { meshes: [n], pivot: p, cover: [cutS.ents[cutS.key(...at)]] };
      marker(R, `calf${side}`, p, 0, 0.065, 0);
    }
    // the right thigh's last skin flake (phase 3): synthetic skin left on the plates
    if (side === 'R') {
      const fl = gridGeometry(5, 4, (u, t, o) => {
        const a = s * Math.PI * 0.5 + (u - 0.5) * 0.9, y = lerp(-0.12, -0.2, t);
        const r = lerp(th0, th1, -y / DIM.thigh) - 0.001 + 0.002 * Math.sin(u * 9 + t * 7);
        o[0] = Math.sin(a) * r;
        o[1] = y + 0.012 * Math.sin(u * 11);
        o[2] = Math.cos(a) * r;
        o[3] = a * r;
        o[4] = y;
      }, true);
      const e = shard(R, P.leg, 0.86);
      const m = ctx.mesh(thigh, sub(fl, 1), M.skin);
      e.meshes.push(m);
      e.patch = true;
      keep.push(m);
    }
    void cutT;
  }
  // the left shoulder's skin flakes (phase 4): on the left deltoid, under the sleeve
  {
    const up = ctx.arms.L.upper;
    const fl = gridGeometry(6, 4, (u, t, o) => {
      const az = (u - 0.5) * 1.6, el = lerp(0.85, 0.35, t);
      const rx = BODY.deltoid[0] - 0.001, ry = BODY.deltoid[1] - 0.001, rz = BODY.deltoid[2] - 0.001;
      const k = 1 + 0.02 * Math.sin(u * 13 + t * 5);
      o[0] = 0.006 + Math.cos(el) * Math.cos(az) * rx * k;
      o[1] = -0.018 + Math.sin(el) * ry * k;
      o[2] = Math.cos(el) * Math.sin(az) * rz * k;
      o[3] = az * 0.07;
      o[4] = o[1];
    }, false, (i, j) => (i + j * 3) % 5 === 2 || (i === 0 && j > 1) || (i === 5 && j < 2));
    const e = shard(R, 'armL', 0.995);
    const m = ctx.mesh(up, sub(fl, 1), M.skin);
    e.meshes.push(m);
    e.patch = true;
    keep.push(m);
  }
  F.flush();
  return { keep };
}

// ================================================================= the jacket's skirt
// Four panels from the waist to the upper thigh (sheet.js panelSkirt, the animator's coat springs): the
// two fronts overlapping toward his left hip (the diagonal close's end), two at the back. Each panel is
// one shard of the `hip` part: the right front goes first, the left front (the scrap at his left hip)
// last of all.
const SKIRT = [
  { az: 0.5, w: [0.27, 0.27, 0.275], len: [0.14, 0.12], out: 0.012, t: 0.995, front: true },
  { az: -0.62, w: [0.25, 0.25, 0.255], len: [0.14, 0.11], out: 0.004, t: 0.18, front: true },
  { az: 2.25, w: [0.29, 0.29, 0.295], len: [0.14, 0.12], out: 0.006, t: 0.62 },
  { az: -2.25, w: [0.29, 0.29, 0.295], len: [0.14, 0.12], out: 0.006, t: 0.4 },
];
function buildSkirt(ctx) {
  const R = dressOf(ctx.root);
  const keep = [];
  const defs = SKIRT.map((p) => ({ ...p, strips: [], fork: [], flare: 0.03, breeze: 0.01, idleFlare: 0.01, cone: 0.1, jag: 0.004 }));
  // (the skirt's inside is the collar's inner cloth: his `lining` is the woven frame)
  const { coat } = panelSkirt({ ...ctx, M: { ...ctx.M, lining: ctx.M.collarIn } }, defs, { seed: 1700 });
  coat.forEach((C, i) => {
    const e = shard(R, 'hip', SKIRT[i].t);
    for (const sg of C.segs) for (const m of sg.children) if (m.isMesh) {
      // (a fitted jacket's skirt: no pleats, one plain panel; a line only round its edges)
      const a = m.geometry.attributes.aPart;
      if (a && !m.geometry.userData.fsFlat) {
        a.array.fill(0);
        a.needsUpdate = true;
        m.geometry.userData.fsFlat = true;
      }
      e.meshes.push(m);
      keep.push(m);
    }
  });
  R.skirt = coat;
  return { coat, keep };
}

// ================================================================= the items
const ITEMS = [
  { id: 'fs.head', slot: 'head', name: 'Synthetic Face and Hair', hidesHair: true, build: buildHead },
  { id: 'fs.jacket', slot: 'chest', name: 'Asymmetric Jacket', build: buildJacket },
  { id: 'fs.arms', slot: 'arms', name: 'Jacket Sleeves and Hands', build: buildArms },
  { id: 'fs.legs', slot: 'legs', name: 'Trousers and Boots', build: buildLegs },
  { id: 'fs.skirt', slot: 'waist', name: 'Jacket Skirt', build: buildSkirt },
];
/** The set (registered into the hero's gear registry on import: gear/index.js registerItem). */
export const FS_ITEMS = ITEMS.map((it) => ({ ...it, build: quietly(it.build) }));
for (const item of FS_ITEMS) registerItem(item);

/** What he wears (no `weapon`: bare-handed; the right hand hangs on the sword joint). */
export const FS_LOADOUT = Object.freeze({
  head: 'fs.head', chest: 'fs.jacket', shoulders: null, arms: 'fs.arms', legs: 'fs.legs', waist: 'fs.skirt', back: null, weapon: null,
});

/** His "blade": the right hand along the sword joint's +Z (Tian Lei's and Bai Wuji's measure). */
export const FS_FIST = Object.freeze({ guard: -0.06, tip: 0.075 });

