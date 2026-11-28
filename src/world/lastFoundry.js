import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createDragonObjectMaterial, createCarvedGlyphMaterial, createPropArtMaterial } from '../render/materials.js';
import { markCaster } from '../render/pipeline.js';
import { mulberry32, range } from '../core/rng.js';
import { CONFIG } from '../core/config.js';
import { TAU } from '../core/math.js';
import { TELL } from '../combat/rules.js';
import { FIRE_PALETTES } from '../render/firePalettes.js';
import { carve, mul, slabGeometry, SLAB_LOOK, buildFlagstone, buildBonfire, buildRubble, geosHeight } from './forest.js';
import { breakableFloor } from './floor.js';
import { addSlabRims } from '../render/dragonFloor.js';
import { LetterBatch } from './life/letterBatch.js';
import {
  FD_COL, plateTone, buildColumn, buildGantryHead, buildJibPost, buildJib, buildLadle, buildPress, buildConveyor, buildFrame,
  buildTank, buildTankWreck, buildIngots, buildGirder, buildPipeRack, buildCatwalk, buildFurnace, buildWall, buildSlagHeap,
  buildPourKerb, buildHusk, buildHulk, buildMound,
} from './foundryProps.js';

// THE LAST FOUNDRY (`?level=foundry`; ADR-285): a steel mill at the end of a war with the machines, at
// night, still running with no one left to feed it. The game camera looks down at 58 degrees from the
// south: the casting floor fills the frame, the pour glows along its top edge, the cranes' arms and the
// ladles hang at its sides; the blast furnace, the press and the line stand past the floor's edges.
//
// THE PLACE (FOUNDRY below; builders in world/foundryProps.js):
//   the casting floor   a square of riveted steel plates 30 m across on the origin (half 15, cell 1.5:
//                       400 plates, every one a floor piece, world/floor.js); a few gratings, the plates
//                       by the pour warmer. The boss keeps to floor.r 13.8. A path of plates south to the
//                       bonfire (0, 33).
//   THE POUR            north (x -12 .. 12, z -21 .. -17): an open channel of molten steel (heat in the
//                       fire field over a crust, its `foundry` palette), kerbed; colliders along it: nobody
//                       walks in it. He kneels at its edge (wait: 0, -11, facing north).
//   the ladles          four crucibles hung on chains (they swing on the level's wind: hang.js 'rope') from
//                       the arms of four jib cranes at the floor's sides; a jib's post `holds` its arm.
//   the press           a forging press east-north-east (its base `holds` its head), a billet glowing on
//                       its die; the line west: a conveyor carrying six UNFINISHED FRAMES (his kind, headless
//                       or half built: thrown by him, `lift` 1); the blast furnace beyond the pour, its tap
//                       hole lit, a runner down to the pour; I-beam columns at the hall's sides (each `holds`
//                       a run of the crane runway), pipe racks venting steam (a LetterBatch: tiny faint
//                       letters), gas tanks that BURST (a fuse, then a blast: Halcyon Plaza's cars are the
//                       precedent), ingot stacks, loose girders, slag heaps, a catwalk over the pour, the
//                       broken walls east and west; past them the wreck field (static scenery past
//                       FOUNDRY.staticR, where no blow reaches: machine husks, a tracked hulk, rubble).
//
// EVERYTHING BREAKS (ADR-107, ADR-132; ARCHITECTURE "Making a new object destructible"): every piece above
// is in `breakables` with a finite hp, a material and its footprint. LEFT WHOLE ON PURPOSE (the brief's
// list): the bonfire (not listed); the blast furnace's body (listed, hp Infinity: it chips, never breaks);
// the pour's kerb and its crust (not listed: the channel is the level's hazard, not scenery). The wreck
// field past FOUNDRY.staticR is a static mesh (the city's precedent: never on a blow's path).
//
// THE HAZARD SURFACE (returned as `foundry`; game.world.forest.foundry; the boss's terrain handler deals the
// pools' damage, this file draws them and ignites the world round them):
//   ladles                 the four: { x, z, h, def (its breakable def), piece (the live piece, once seen), full,
//                          jib (its arm's def) } (`full` false once it has spilled)
//   ladleNear(x, z, r)     the nearest FULL ladle within r m of (x, z), or null
//   drop(ladle, why)       cut its chain: the piece breaks (its crucible bursts, the steel pours down) and it
//                          spills (a pool under it, now); false when it was not full. `why` 'hero' / 'player':
//                          the hero's (the blow is the player's)
//   molten.add(x, z, { r, life, why })  → a pool record { alive, x, z, r, t, life, why, id, acc } (a fixed pool
//                          of FOUNDRY_TUNING.molten.max: the oldest is reused when all are live); it ignites
//                          the world round it and leaves a charred mark on the floor (world.groundBlow)
//   molten.pools           the fixed array of records (read `alive`)
//   molten.at(x, z)        the live pool covering (x, z), or null
//   reset()                the fight's reset: every ladle full and hung, no pool, the tanks' fuses out, the
//                          light back to phase 1 (the boss's reset calls it)
//   tanks                  the gas tanks' fuses (read only: { def, state 'idle' | 'fuse' | 'done', t, by })
//   boom(x, z, by)         a tank-sized blast at (x, z) now (a thrown tank landing)
// A ladle whose piece breaks by ANY blow spills by itself, and one whose jib comes down drops (the set's
// update sees both). A gas tank that breaks burns for FOUNDRY_TUNING.tank.fuse s (cued red as the city's
// cars are), then bursts: world.impact (a ring of bites), fire, the hero inside its reach (blockable; a
// roll clears it), and HIM through `boss.onBlast(damage, posture, x, z)` when the hero broke it.
//
// THE LIGHT (ambience; the Skybreak Ring's is the precedent): by the boss's phase (game.dragon.phase, eased;
// `setPhase(n)` drives it without a boss): 1 a quiet furnace glow; 2 colder, warning lamps blinking on the
// jib posts; 3 red alarm light, a red beacon turning round the hall; 4 the furnace roars, sparks rain, the
// sky flashes with the barrage. `ambience.flare(k)`, `ambience.dim(k)`, `ambience.state` { w, flash, dim,
// phase, heat, steam }. Its own LCG streams (never Math.random).

const HALF = 15;
const CELL = 1.5;

/** The foundry's layout (levels/foundry.js and the boss read it). */
export const FOUNDRY = Object.freeze({
  half: HALF, // the casting floor is |x|, |z| <= half
  cell: CELL,
  entryZ: HALF + 0.4, // where the hero steps onto the floor (its south edge)
  bonfire: Object.freeze({ x: 0, z: 33 }),
  floor: Object.freeze({ r: 13.8 }), // the circle the boss keeps to
  wait: Object.freeze({ x: 0, z: -11, yaw: Math.PI }), // he kneels at the pour's edge, facing north (his back to the arrival)
  bound: 40, // the hero's bound round the origin
  // the ladles: their crucibles' middles at h m, hung from the jibs' arms at `top` m
  ladles: Object.freeze([[-12.5, -6.5], [12.5, -6.5], [-12.5, 5.5], [12.5, 5.5]].map(([x, z]) => Object.freeze({ x, z, h: 3, top: 6.3 }))),
  pour: Object.freeze({ x0: -12, x1: 12, z0: -21, z1: -17 }),
  press: Object.freeze({ x: 20.5, z: -9 }),
  line: Object.freeze({ x: -19.5, z0: -12, z1: 10 }),
  // the gas tanks: one in each corner of the floor (within a blast of his circle) and one by the press
  tanks: Object.freeze([[11.8, -11.8], [-11.8, -11.8], [11.8, 11.6], [-11.8, 11.6], [18.4, -14.8]].map(([x, z]) => Object.freeze({ x, z }))),
  columns: Object.freeze([[-16.6, -16.4], [16.6, -16.4], [-16.6, -2.5], [16.6, -1.5], [-16.6, 7.5], [16.6, 15.6]].map(([x, z]) => Object.freeze({ x, z }))),
  furnace: Object.freeze({ x: 0, z: -30, r: 5 }),
  jibPostX: 17.0, // the jib cranes' posts stand at |x| = this, level with their ladles
  staticR: 30, // past this: the wreck field, a static mesh (no blow reaches it)
});

/** What the pieces are worth (POWER: 1 fells a tree; metal takes a cut at 0.3), the pools', the tanks' and
 *  the light's numbers (content is data). */
export const FOUNDRY_TUNING = Object.freeze({
  // structure (hp). A ladle's chain: three or four of the hero's heavy cuts, one of his blows
  ladle: 0.5, press: 6, pressHead: 4.5, frame: 0.8, conveyor: 2.2, tankHp: 0.9, column: 3.2, gantry: 2.4, jibPost: 3, jib: 1.8,
  ingots: 2.2, girder: 2.4, pipes: 2.6, catwalk: 2.2, wall: 4.5, slag: 1.6,
  molten: Object.freeze({
    max: 8, r: 2.2, life: 14, spill: Object.freeze({ r: 2.6, life: 16 }), ignite: 1, glow: 10,
    // the drawing: blobs a pool may print a frame (x quality), the spread (s to its full size), the
    // crust (heat of its middle at birth -> by its end), the rim's heat, the last `fade` s it goes dark
    cell: 0.7, cap: 120, spread: 0.45, heat: Object.freeze([2.7, 0.55]), rim: Object.freeze([2.3, 0.95]), fade: 2.5,
    mark: 0.8, // the floor's charred mark (world.groundBlow 'blast', hot) at this power
    stream: 0.9, // s the steel pours from a burst crucible down to the floor
  }),
  tank: Object.freeze({
    fuse: 0.9, // it burns this long once broken, then it bursts
    blast: Object.freeze({ r: 3.2, power: 1.6 }), // world.impact (kind blast, fire)
    hero: Object.freeze({ r: 2.6, damage: 16, knockback: 4 }), // blockable; a roll clears it
    boss: Object.freeze({ r: 3.6, damage: 90, posture: 24 }), // when the hero broke it (his circle's edge is 2.7 m from a corner tank)
    chain: Object.freeze({ max: 2, per: 0.5 }),
  }),
  // the pour's surface: one-frame heat blobs on a grid (x quality), their heat (crust .. molten)
  pour: Object.freeze({ cell: 0.8, heat: Object.freeze([0.8, 2.5]), flow: 0.35, size: 1.15 }),
  // the steam and the fumes (tiny faint letters: a LetterBatch): letters a second per vent / along the pour
  steam: Object.freeze({ max: 700, vent: 9, pour: 22, life: Object.freeze([2.6, 4.2]), rise: Object.freeze([0.7, 1.2]), alpha: 0.3, color: Object.freeze([0.5, 0.52, 0.55]), fume: Object.freeze([0.5, 0.34, 0.22]) }),
  // phase 4: sparks a second raining round the focus; the sky's far flashes (s apart)
  sparks: 34, flashes: Object.freeze([2.4, 5.5]),
});

/** The light by his phase [P1 a quiet furnace glow, P2 colder, P3 red alarm, P4 the furnace roars]. */
const LIGHT = [
  { moon: [0.74, 0.5, 0.36], dir: [-0.4, 0.8, 0.45], ambient: [0.085, 0.058, 0.046], fogColor: [0.03, 0.013, 0.008], fogNear: 30, fogFar: 64, furnace: 1.6, pour: 1.1, alarm: 0, lamps: 0 },
  { moon: [0.52, 0.57, 0.72], dir: [-0.5, 0.75, 0.4], ambient: [0.055, 0.06, 0.076], fogColor: [0.012, 0.014, 0.022], fogNear: 30, fogFar: 62, furnace: 1.1, pour: 0.9, alarm: 0, lamps: 1 },
  { moon: [0.95, 0.22, 0.15], dir: [-0.25, 0.8, 0.5], ambient: [0.1, 0.032, 0.03], fogColor: [0.035, 0.006, 0.005], fogNear: 28, fogFar: 58, furnace: 1.3, pour: 1.0, alarm: 1, lamps: 0 },
  { moon: [1.3, 0.62, 0.26], dir: [0.2, 0.75, 0.6], ambient: [0.13, 0.07, 0.04], fogColor: [0.05, 0.018, 0.006], fogNear: 26, fogFar: 56, furnace: 2.6, pour: 1.3, alarm: 0.45, lamps: 0 },
];

const PLATE = [0.12, 0.12, 0.13];
const EARTH = [0.1, 0.08, 0.065];
const edgeBand = (px, py, pz, nx, ny) => (ny > 0.5 && ny < 0.95 ? 1 : 0);
const PAVING_LOOK = { gain: 0.74, lumScale: 1.5, edge: 0.18, inkFloor: 0.02, base: 0.05, crackAmount: 0.06, strokeLevels: [9, 9], topGlyphs: ['    ', '.   ', '. . ', '.:. ', ':.:.', ';:.:'], dp: { k: 0.85, sat: 0.6, tint: [1, 1, 1], top: 0.08 } };

/** A plate of the floor at (x, z), w x d, its corners jittered a little. */
function plate(rng, x, z, w, d, col) {
  const j = 0.02;
  const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, b]) => [a + range(rng, -j, j), b + range(rng, -j, j)]);
  const g = slabGeometry(pts, { top: 0.035, inset: 0.05, drop: 0.03, bottom: -0.2 });
  g.translate(x, 0, z);
  carve(g, { col, ao: 0.85, moss: 0, edge: edgeBand });
  let r = 0;
  for (const [px, pz] of pts) r = Math.max(r, Math.hypot(px, pz));
  return { geo: g, outline: pts.map(([px, pz]) => [x + px, z + pz]), r };
}

/**
 * The set. Built on a quiet Math.random (three names every object with a random uuid; the seeded sims
 * replay Math.random: foxTerrace.js's note): its own build draws nothing from it.
 */
export function createLastFoundry(U, colliders) {
  const r = Math.random;
  let s = 0x2f0d4a11;
  Math.random = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  try {
    return buildFoundry(U, colliders);
  } finally {
    Math.random = r;
  }
}

function buildFoundry(U, colliders) {
  const T = FOUNDRY_TUNING;
  // streams: the floor's layout; the props; the rubble; the floor's remains (world/floor.js); the scenery
  const rng = mulberry32(CONFIG.seed + 7101), pr = mulberry32(CONFIG.seed + 7102), br = mulberry32(CONFIG.seed + 7103), fr = mulberry32(CONFIG.seed + 7104), sr = mulberry32(CONFIG.seed + 7105);
  const group = new THREE.Group();
  group.name = 'lastFoundry';
  const stoneGeos = [], slabGeos = [], propGeos = [], sceneryGeos = [];
  const slabs = [], bare = [];
  const floor = [];
  const breakables = [];
  const vents = [];

  const addSlab = (sl, x, z, col, kind, walk = true) => {
    slabGeos.push(sl.geo);
    slabs.push({ x, z, r: sl.r, outline: sl.outline });
    if (walk) floor.push({ geo: sl.geo, outline: sl.outline, x, z, r: sl.r * 0.87, col, kind });
  };
  /** A standing piece (prop art). `cr`: its collider (0: none); `stub` false: nothing left standing. */
  const piece = (kind, x, z, rr, geos, extra = {}) => {
    const { stub = true, cr = rr, ctag = 'stone', mat = 'metal', broken, h, cs: own, ...rest } = extra;
    const cs = own ?? (cr > 0 ? [colliders.add(x, z, cr, ctag)] : []);
    const def = {
      kind, mat, look: 'prop', x, z, r: Math.max(0.3, rr), h: h ?? geosHeight(geos), geos, colliders: cs,
      broken: broken !== undefined ? broken : stub ? { geos: buildRubble(br, x, z, Math.max(0.3, rr) * 0.7, { col: mul(FD_COL.rust, 1.2), h: range(br, 0.2, 0.4) }), r: 0 } : null,
      lift: 0, ...rest,
    };
    breakables.push(def);
    return def;
  };

  // ---- the casting floor: 20 x 20 riveted plates (a few gratings; warmer by the pour)
  const n = Math.round((2 * HALF) / CELL);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -HALF + (i + 0.5) * CELL, z = -HALF + (j + 0.5) * CELL;
      const grate = (i + 3 * j) % 11 === 0 || ((i === 6 || i === 13) && j % 3 === 1);
      const tone = plateTone(PLATE, i, j, z < -11 ? 'hot' : grate ? 'grate' : 'plate');
      addSlab(plate(rng, x, z, CELL - 0.07, CELL - 0.07, tone), x, z, tone, 'plate');
    }
  }
  // ---- the way in: plates down to the bonfire
  const BF = FOUNDRY.bonfire;
  for (let z = HALF + 1.0; z < BF.z - 1.6; z += range(rng, 0.95, 1.3)) {
    const x = range(rng, -0.5, 0.5), w = range(rng, 0.9, 1.4), d = range(rng, 0.7, 1.1);
    const sl = buildFlagstone(rng, x, z, w, d, rng() * Math.PI * 2);
    const col = (px, py, pz) => mul(FD_COL.steel, 0.75 + 0.3 * Math.abs(Math.sin(px * 3.1 + pz * 1.7)));
    addSlab({ geo: sl.geo, outline: sl.outline, r: Math.max(w, d) * 0.6 }, x, z, col, 'flagstone');
  }
  propGeos.push(...buildBonfire(rng, BF.x, BF.z));
  colliders.add(BF.x, BF.z, 0.75, 'bonfire');
  bare.push({ x: BF.x, z: BF.z, r: 2.4 });

  // ---- the pour: the kerbed channel north of the floor (left whole), colliders along it
  const P = FOUNDRY.pour;
  stoneGeos.push(...buildPourKerb(pr, P.x0, P.x1, P.z0, P.z1));
  {
    const pz = (P.z0 + P.z1) / 2, pd = P.z1 - P.z0;
    for (let x = P.x0 + 0.8; x <= P.x1 - 0.8 + 1e-6; x += 1.6) colliders.add(x, pz, pd / 2, 'stone');
  }

  // ---- the jib cranes and their ladles (a post holds its arm; the ladle hangs from the arm's tip)
  const ladles = [];
  for (const L of FOUNDRY.ladles) {
    const side = Math.sign(L.x), px = side * FOUNDRY.jibPostX, reach = Math.abs(px - L.x);
    const armY = L.top + 0.27; // (the arm's underside: the trolley's hook block sits under it)
    const jibGeos = buildJib(pr, px, L.z, armY, reach, side > 0 ? Math.PI : 0);
    const jib = {
      kind: 'jib', mat: 'metal', look: 'prop', x: (px + L.x) / 2, z: L.z, r: reach / 2 + 0.3, y0: armY - 1.4, h: 2.0, geos: jibGeos, colliders: [],
      hp: T.jib, weight: 1.4, topples: true, cover: false, lift: 0, fallOff: 0.6, fallT: 1.0, wreck: true,
    };
    const postGeos = buildJibPost(pr, px, L.z, armY + 0.45);
    const post = piece('jibPost', px, L.z, 0.35, postGeos, { cr: 0.3, ctag: 'trunk', hp: T.jibPost, weight: 1.6, topples: true, cover: true, holds: jib, broken: { geos: buildRubble(br, px, L.z, 0.35, { col: FD_COL.paint, h: 0.5 }), r: 0 } });
    breakables.push(jib);
    const spout = Math.atan2(-L.x, -L.z);
    const lg = buildLadle(pr, L.x, L.z, L.h, L.top, spout);
    // (a steel shell lined with refractory: it breaks as stone does, so the hero's blade bites its chain at
    // stone's 0.7, not steel's 0.3; its burst is the steel's heat and a few sparks, the set's)
    const def = { kind: 'ladle', mat: 'stone', look: 'prop', x: L.x, z: L.z, r: 0.8, h: L.top + 0.1, geos: lg.geos, colliders: [], hp: T.ladle, weight: 1.2, topples: false, cover: false, lift: 0, wreck: false, broken: { geos: lg.stub, r: 0 } };
    breakables.push(def);
    ladles.push({ x: L.x, z: L.z, h: L.h, def, piece: undefined, full: true, jib, post, skip: false, pourT: 0, pourAcc: 0 });
  }

  // ---- the hall's columns, each holding a run of the crane runway
  const beacons = [];
  for (const { x, z } of FOUNDRY.columns) {
    const H = 9;
    const head = { kind: 'gantry', mat: 'metal', look: 'prop', x, z, r: 2.2, y0: H - 0.35, h: 1.2, geos: buildGantryHead(pr, x, z, H, 4.2), colliders: [], hp: T.gantry, weight: 1.8, topples: true, cover: false, lift: 0, fallOff: 0.8, fallT: 1.2, wreck: true };
    piece('column', x, z, 0.42, buildColumn(pr, x, z, H), { cr: 0.38, ctag: 'trunk', hp: T.column, weight: 2, topples: true, cover: true, holds: head, fallT: 1.3, broken: { geos: buildColumn(br, x, z, range(br, 0.9, 1.6)), r: 0.3 } });
    breakables.push(head);
    beacons.push({ x, z, y: H + 1.05, def: head });
  }

  // ---- the press (east-north-east): the base holds the head; a billet glows on the die
  const press = [];
  {
    const { x, z } = FOUNDRY.press;
    const p = buildPress(pr, x, z);
    const head = { kind: 'pressHead', mat: 'metal', look: 'prop', x, z, r: 2.1, y0: 3.5, h: 6.1, geos: p.head, colliders: [], hp: T.pressHead, weight: 3, topples: true, cover: true, lift: 0, fallOff: 1, fallT: 1.5, blocks: 3, wreck: true };
    const base = piece('press', x, z, 2.3, p.base, { cr: 2.2, hp: T.press, weight: 3, topples: false, cover: true, holds: head, broken: { geos: p.ruin, r: 1.9 } });
    breakables.push(head);
    press.push({ x, y: 1.85, z, def: base, head });
    vents.push({ x: x + 2.1, y: 7.6, z: z + 0.6, k: 0.6, def: head });
  }

  // ---- the line (west): six runs of conveyor, an unfinished frame clamped on each
  {
    const Ln = FOUNDRY.line, len = (Ln.z1 - Ln.z0) / 6;
    for (let k = 0; k < 6; k++) {
      const z = Ln.z0 + (k + 0.5) * len;
      // (a run 3.7 m long: its footprint the middle 2.8 m, two circles hold the hero off it end to end)
      const cs = [colliders.add(Ln.x, z - 1.1, 1.0, 'stone'), colliders.add(Ln.x, z + 1.1, 1.0, 'stone')];
      piece('conveyor', Ln.x, z, 1.4, buildConveyor(pr, Ln.x, z, len, [0]), { cs, hp: T.conveyor, weight: 1.6, topples: false, cover: false });
      // (his brothers: headless, one-armed, half-shelled; facing the floor)
      const fk = [0, 2, 1, 0, 1, 2][k];
      breakables.push({
        kind: 'frame', mat: 'metal', look: 'prop', x: Ln.x, z, r: 0.42, y0: 0.82, h: 1.85, geos: buildFrame(pr, Ln.x, 0.82, z, Math.PI / 2, fk), colliders: [],
        hp: T.frame, weight: 0.8, topples: true, fallT: 0.6, fallOff: 0.2, cover: false, lift: 1, wreck: false, broken: null,
      });
    }
  }
  // two frames fallen off the line onto the floor's west edge (in his reach: `relic`)
  for (const [x, z, yaw, fk] of [[-13.9, -9.6, 0.4, 0], [-14.1, 2.2, -0.3, 2]]) {
    breakables.push({ kind: 'frame', mat: 'metal', look: 'prop', x, z, r: 0.75, h: 0.5, geos: buildFrame(pr, x, 0, z, yaw, fk, { lie: 1 }), colliders: [], hp: T.frame, weight: 0.8, topples: false, cover: false, lift: 1, wreck: false, broken: null });
  }

  // ---- the gas tanks (they burst: the ambience's fuses)
  const tanks = [];
  for (const { x, z } of FOUNDRY.tanks) {
    const yaw = Math.atan2(-x, -z);
    const def = piece('tank', x, z, 0.75, buildTank(pr, x, z, yaw), { cr: 0.62, hp: T.tankHp, weight: 1, topples: false, cover: true, lift: 1, broken: { geos: buildTankWreck(br, x, z, yaw), r: 0 }, wreck: false });
    tanks.push(def);
  }

  // ---- ingot stacks, loose girders, slag heaps (round the floor's edges: his throwables)
  for (const [x, z, yaw] of [[13.7, -9.2, 0.3], [13.9, 8.9, -0.2], [-9.2, 14.2, 0.1], [9.6, -14.3, 1.2]]) {
    piece('ingots', x, z, 0.72, buildIngots(pr, x, z, yaw), { cr: 0.62, hp: T.ingots, weight: 1.4, topples: false, cover: false, lift: 1, broken: { geos: buildIngots(br, x, z, yaw, 1), r: 0 }, wreck: false });
  }
  for (const [x, z, yaw] of [[-13.6, 8.4, 0.25], [8.4, 14.3, Math.PI / 2 + 0.15], [-8.2, -14.4, Math.PI / 2 - 0.1], [14.0, -2.6, 0.08]]) {
    piece('girder', x, z, 1.3, buildGirder(pr, x, z, yaw), { cr: 0, hp: T.girder, weight: 1.6, topples: false, cover: false, lift: 1, stub: false, wreck: false });
  }
  for (const [x, z, rr] of [[-17.6, -21.5, 1.6], [16.4, -22.6, 1.4], [-9.4, 22.6, 1.2], [22.6, 13.2, 1.5]]) {
    piece('slag', x, z, rr, buildSlagHeap(pr, x, z, rr), { cr: rr * 0.7, mat: 'stone', hp: T.slag, weight: 1.2, topples: false, cover: false, wreck: false, broken: { geos: buildRubble(br, x, z, rr * 0.6, { col: FD_COL.slag, h: 0.25 }), r: 0 } });
  }

  // ---- the pipe racks (east, south-east), venting steam
  for (const [x, z, yaw] of [[21.6, 0.2, 0], [21.6, 4.8, 0], [18.6, 19.2, Math.PI / 2], [23.2, 19.2, Math.PI / 2]]) {
    const p = buildPipeRack(pr, x, z, yaw, 4.6, true);
    const ca = yaw ? [x - 1.9, z] : [x, z - 1.9], cb = yaw ? [x + 1.9, z] : [x, z + 1.9];
    const def = { kind: 'pipes', mat: 'metal', look: 'prop', x, z, r: 2.3, h: geosHeight(p.geos), geos: p.geos, colliders: [colliders.add(ca[0], ca[1], 0.9, 'stone'), colliders.add(cb[0], cb[1], 0.9, 'stone')], hp: T.pipes, weight: 1.6, topples: false, cover: true, lift: 0, wreck: true, broken: { geos: buildRubble(br, x, z, 1.1, { col: FD_COL.rust, h: 0.4 }), r: 0 } };
    breakables.push(def);
    if (p.vent) vents.push({ x: p.vent[0], y: p.vent[1], z: p.vent[2], k: 1, def });
  }

  // ---- the catwalk over the pour's north kerb (four runs); legs' colliders at the joints
  {
    const cz = P.z0 - 1.6, w = (P.x1 - P.x0) / 4;
    for (let k = 0; k < 4; k++) {
      const x = P.x0 + (k + 0.5) * w;
      piece('catwalk', x, cz, w / 2, buildCatwalk(pr, x, cz, w - 0.2, 3.2), { cr: 0, hp: T.catwalk, weight: 1.2, topples: false, cover: false, wreck: true });
    }
    // (the inner legs' circles reach the pour's, so no gap between them wedges the hero; the end legs stand clear)
    for (let k = 1; k < 4; k++) colliders.add(P.x0 + k * w, P.z0 - 0.75, 0.9, 'trunk');
  }

  // ---- the blast furnace beyond the pour (left whole: it chips), its tap hole and the runner to the pour
  const furnace = FOUNDRY.furnace;
  {
    const geos = buildFurnace(pr, furnace.x, furnace.z, { r: furnace.r, runTo: P.z0 - furnace.z });
    breakables.push({ kind: 'furnace', mat: 'stone', look: 'prop', x: furnace.x, z: furnace.z, r: furnace.r * 1.06, h: geosHeight(geos), geos, colliders: [colliders.add(furnace.x, furnace.z, furnace.r * 1.08, 'stone')], hp: Infinity, topples: false, cover: true, lift: 0, wreck: false, broken: null });
    // (the runner's edge: nobody walks the trough)
    colliders.add(furnace.x, P.z0 - 2.6, 1.0, 'stone');
    vents.push({ x: furnace.x, y: 16.5, z: furnace.z, k: 2.2, def: null, smoke: true });
  }

  // ---- the broken walls, east and west; some knocked down to a stub
  const WALL_Z = [-19.4, -12.6, -5.8, 1.0, 7.8, 14.6];
  for (const side of [-1, 1]) {
    WALL_Z.forEach((z, k) => {
      const x = side * 25, low = (k + (side > 0 ? 1 : 0)) % 3 === 2, h = range(pr, 3.2, 4.4);
      const w = buildWall(pr, x, z, Math.PI / 2, 5.6, h, low);
      // (two circles hold the hero off it; they go with it: what is left is a low ruin he steps over)
      const cs = [-1.4, 1.4].map((dz) => colliders.add(x, z + dz, 1.25, 'stone'));
      piece('wall', x, z, 2.8, w.geos, { cs, mat: 'stone', hp: T.wall, weight: 2.2, topples: false, cover: true, wreck: false, broken: { geos: w.ruin, r: 0 } });
    });
  }

  // ---- the wreck field past the walls (static: no blow reaches it), with colliders where the hero can walk
  {
    const S = FOUNDRY.staticR;
    for (const [x, z, yaw] of [[-31.5, -10, 0.6], [32, 6, -1.1], [-33, 14, 2.2], [30.6, -19, 0.3], [-29.5, -24, -0.9], [34, 22, 1.4]]) {
      sceneryGeos.push(...buildHusk(sr, x, z, yaw, 1.3 + 0.3 * sr()));
      colliders.add(x, z, 1.2, 'stone');
    }
    for (const [x, z, yaw] of [[-34, 0, 0.35], [33, -6, -0.5]]) {
      sceneryGeos.push(...buildHulk(sr, x, z, yaw));
      for (const d of [-1.8, 1.8]) colliders.add(x + Math.sin(yaw) * d, z + Math.cos(yaw) * d, 2.1, 'stone');
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU + sr() * 0.2, rr = range(sr, S + 1, S + 9);
      const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
      if (z > 24 && Math.abs(x) < 8) continue; // (the yard by the bonfire stays open)
      const m = range(sr, 0.8, 1.8);
      sceneryGeos.push(...buildMound(sr, x, z, m));
      colliders.add(x, z, m * 0.9, 'stone');
    }
    // the north wall behind the furnace, broken in places
    for (let k = 0; k < 7; k++) {
      const x = -18 + k * 6, z = -38.5 + range(sr, -0.4, 0.4);
      if (sr() < 0.25) continue;
      sceneryGeos.push(...buildWall(sr, x, z, 0, 5.6, range(sr, 3.5, 6), sr() < 0.3).geos);
      for (const dx of [-2, 0, 2]) colliders.add(x + dx, z, 1.25, 'stone');
    }
  }

  // ---- meshes
  const mat = createDragonObjectMaterial(U, { fadeNearPlayer: true, side: THREE.DoubleSide });
  const stoneMat = createPropArtMaterial(U, { fadeNearPlayer: true, gain: 0.92 });
  const slabMat = createCarvedGlyphMaterial(U, { ...SLAB_LOOK, ...PAVING_LOOK, viewPitch: CONFIG.camera.pitch });
  const add = (geos, m, name) => {
    if (!geos.length) return null;
    const mesh = new THREE.Mesh(mergeGeometries(geos), m);
    mesh.name = name;
    group.add(mesh);
    return mesh;
  };
  add(propGeos, mat, 'props');
  add(stoneGeos, stoneMat, 'pour');
  add(sceneryGeos, stoneMat, 'wreckField');
  const slabMesh = add(slabGeos, slabMat, 'paving');
  markCaster(group);
  breakables.push(...breakableFloor({ slabs: floor, slabGeos, slabMesh, mat: slabMat, rng: fr, group, earth: EARTH }).defs);
  addSlabRims(group, slabMat);

  const foundry = createHazards(ladles, tanks);
  const ambience = makeAmbience(foundry, { ladles, beacons, press, vents, furnace, posts: ladles.map((L) => L.post) });
  return {
    group, treeSpots: [], bare, slabs, nest: { x: FOUNDRY.wait.x, z: FOUNDRY.wait.z }, bonfire: { x: BF.x, z: BF.z },
    material: mat, stoneMaterial: stoneMat, slabMaterial: slabMat,
    breakables,
    foundry,
    /** The light by his phase (the boss's transition calls it; the ambience also follows his phase). */
    setPhase(k) {
      return foundry._light.setPhase(k);
    },
    /** A tank-sized blast at (x, z) now (a thrown tank landing). */
    boom: (x, z, by = 'boss') => foundry.boom(x, z, by),
    scarInk: [0.3, 0.16, 0.08],
    grass: { ash: 0.85, height: 0.3, density: (x, z) => (Math.abs(x) < HALF + 1.5 && Math.abs(z) < HALF + 1.5 ? 0 : Math.hypot(x, z) > 27 ? 0.05 : 0.025) },
    floorCarry: mul(PLATE, 1.4),
    sky: { ...LIGHT[0], moonDir: LIGHT[0].dir, moonColor: LIGHT[0].moon },
    ambience,
    FOUNDRY, FOUNDRY_TUNING,
  };
}

// ---------------------------------------------------------------- the hazards (logic)
const tellRec = { source: 'world', attack: 'tankBurst', tell: TELL.RED, impactIn: 0, x: 0, z: 0, hazard: true };
const flashRec = { source: 'world', attack: 'tankBurst', tell: TELL.RED, x: 0, y: 0.8, z: 0, hazard: true };
const blastEvt = { x: 0, z: 0, r: 0, by: 'boss' };
const heroHit = { damage: 0, from: { x: 0, z: 0 }, knockback: 0, knockdown: false, kind: 'blast', tell: TELL.RED, parryable: false, blockable: true, attack: 'tankBurst', perfect: false, plunge: false };
const blastO = { kind: 'blast', by: 'boss', dx: NaN, dz: NaN, y: 0.8, src: -1, fire: 1, scar: true };
const dropO = { kind: 'blunt', by: 'boss', y: 3, src: -1 };
const markO = { kind: 'blast', power: 0.8, r: 2, hot: true, by: 'boss' };

function createHazards(ladles, tankDefs) {
  const M = FOUNDRY_TUNING.molten, B = FOUNDRY_TUNING.tank;
  const pools = Array.from({ length: M.max }, () => ({ alive: false, x: 0, z: 0, r: 0, t: 0, life: 0, why: '', id: -1, acc: 0 }));
  const fuses = tankDefs.map((def) => ({ def, piece: null, state: 'idle', t: 0, by: 'boss', told: false, flashed: false, quiet: false, wait: 0 }));
  const booms = [];
  let nextId = 0, map = null;
  const pieceOf = (game, def) => {
    const D = game?.world?.destructibles;
    if (!D?.list) return null;
    if (!map) {
      map = new Map();
      for (const b of D.list) if (b.def) map.set(b.def, b);
    }
    return map.get(def) ?? null;
  };
  const byOf = (why) => (why === 'hero' || why === 'player' ? 'player' : why === 'world' ? 'world' : 'boss');
  const F = {
    ladles,
    tanks: fuses,
    _game: null,
    _light: { phase: 1, setPhase(k) { this.phase = Math.max(1, Math.min(4, Math.round(Number(k) || 1))); return this.phase; } },
    /** effects the ambience draws (one per spill: the steel pouring down from the crucible) */
    _pours: [],
    ladleNear(x, z, r = 4) {
      let best = null, bd = Infinity;
      for (const L of ladles) {
        if (!L.full) continue;
        const dd = Math.hypot(L.x - x, L.z - z);
        if (dd <= r && dd < bd) {
          bd = dd;
          best = L;
        }
      }
      return best;
    },
    drop(L, why = 'boss') {
      if (!L?.full) return false;
      const W = F._game?.world, D = W?.destructibles;
      // (its piece breaks: a blow at the crucible's height, more than it can take)
      if (D?.strike) {
        dropO.by = byOf(why);
        dropO.y = L.h;
        dropO.src = D.swing?.() ?? -1;
        D.strike(L.x, L.z, 0.6, 2, dropO);
      }
      F._spill(L, why);
      return true;
    },
    _spill(L, why) {
      L.full = false;
      L.pourT = M.stream;
      L.pourAcc = 0;
      F._burst?.(L.x, L.h, L.z);
      F.molten.add(L.x, L.z, { r: M.spill.r, life: M.spill.life, why: why || 'ladle' });
    },
    molten: {
      pools,
      add(x, z, o = {}) {
        if (!Number.isFinite(x + z)) return null;
        let Pl = pools.find((p) => !p.alive);
        if (!Pl) Pl = pools.reduce((a, b) => (b.id < a.id ? b : a));
        Pl.alive = true;
        Pl.x = x;
        Pl.z = z;
        Pl.r = Number.isFinite(o.r) && o.r > 0 ? o.r : M.r;
        Pl.life = Number.isFinite(o.life) && o.life > 0 ? o.life : M.life;
        Pl.t = 0;
        Pl.acc = 0;
        Pl.why = o.why ?? '';
        Pl.id = nextId++;
        const W = F._game?.world;
        try {
          W?.ignite?.(x, z, Pl.r, M.ignite);
          markO.r = Pl.r;
          markO.power = M.mark;
          markO.by = byOf(Pl.why);
          W?.groundBlow?.(x, z, markO);
        } catch (err) {
          console.error('[foundry] a pool on the world', err);
        }
        return Pl;
      },
      at(x, z) {
        for (const p of pools) if (p.alive && Math.hypot(p.x - x, p.z - z) < p.r) return p;
        return null;
      },
    },
    /** A tank's blast at (x, z) now (a thrown tank landing). */
    boom(x, z, by = 'boss') {
      if (!Number.isFinite(x + z)) return false;
      explode(x, z, by, false);
      return true;
    },
    reset() {
      for (const L of ladles) {
        L.full = true;
        L.skip = true;
        L.pourT = 0;
      }
      for (const p of pools) p.alive = false;
      for (const f of fuses) {
        f.state = 'idle';
        f.t = f.wait = 0;
        f.told = f.flashed = f.quiet = false;
      }
      booms.length = 0;
      map = null;
      F._light.phase = 1;
    },
    /** Every frame (the ambience's update): the pools age; a ladle whose piece broke (or whose jib fell)
     *  spills; a broken tank burns down its fuse and bursts. */
    update(dt, game) {
      F._game = game;
      for (const p of pools) if (p.alive && (p.t += dt) >= p.life) p.alive = false;
      const D = game?.world?.destructibles;
      if (!D?.list) return;
      for (const L of ladles) {
        if (L.pourT > 0) L.pourT -= dt;
        if (L.piece === undefined || L.piece === null) L.piece = pieceOf(game, L.def);
        const b = L.piece;
        if (!b) continue;
        if (L.skip) {
          // (after a reset, until the world's restore has stood it up again)
          if (b.state === 0) L.skip = false;
          continue;
        }
        if (!L.full) continue;
        if (b.state !== 0) F._spill(L, b.by === 'player' ? 'hero' : 'ladle');
        else {
          const j = pieceOf(game, L.jib);
          if (j && j.state !== 0) F.drop(L, 'world');
        }
      }
      tankFuses(dt, game);
    },
  };

  // ---- the tanks: a broken tank burns, then bursts (two bangs per B.chain.per at most)
  const tankFuses = (dt, g) => {
    const boss = g.boss ?? g.dragon, now = g.time ?? 0;
    for (let i = booms.length - 1; i >= 0; i--) if (now - booms[i] > B.chain.per) booms.splice(i, 1);
    const Fi = g.fx?.fire;
    for (const f of fuses) {
      const b = f.piece ?? (f.piece = pieceOf(g, f.def));
      if (!b) continue;
      if (f.state === 'idle') {
        if (b.state === 2) {
          f.state = 'fuse';
          f.t = 0;
          f.by = b.by === 'player' ? 'player' : 'boss';
          f.told = f.flashed = f.quiet = false;
        } else if (b.state >= 3) f.state = 'done'; // (held or thrown: its blast is the thrower's, `boom`)
        continue;
      }
      if (f.state !== 'fuse') continue;
      f.t += dt;
      const left = B.fuse - f.t;
      if (!f.told) {
        f.told = true;
        tellRec.impactIn = Math.max(0.05, left);
        tellRec.x = b.x;
        tellRec.z = b.z;
        g.events?.emit?.('combat:tell', tellRec);
      }
      if (!f.flashed && left <= 0.3) {
        f.flashed = true;
        // (the boss's fairness guard: a blow of his already cued that needs the other answer near the bang)
        if (boss?.brain?.worldClash?.(Math.max(0.05, left), TELL.RED)) f.quiet = true;
        else {
          flashRec.x = b.x;
          flashRec.z = b.z;
          g.events?.emit?.('combat:flash', flashRec);
        }
      }
      if (Fi && hz() < 0.8) {
        const k = Math.min(1, f.t / B.fuse);
        fb.x = b.x + (hz() - 0.5) * 0.9;
        fb.y = 0.6 + hz() * 0.6;
        fb.z = b.z + (hz() - 0.5) * 0.9;
        fb.vx = fb.vz = 0;
        fb.vy = 1.2 + hz() * 1.6;
        fb.life = 0.3 + hz() * 0.3;
        fb.size = 0.55 + 0.6 * k;
        fb.sizeEnd = 1.0;
        fb.heat = 0.6 + 0.7 * k;
        fb.heatEnd = 0;
        fb.kind = 'fire';
        Fi.spawn(fb);
      }
      if (left <= 0) {
        if (booms.length >= B.chain.max) {
          f.wait += dt;
          continue; // (the chain cap: it waits its turn)
        }
        f.state = 'done';
        booms.push(now);
        explode(b.x, b.z, f.by, f.quiet);
      }
    }
  };

  let hs = 0x1b873593;
  const hz = () => (hs = (Math.imul(hs, 1664525) + 1013904223) >>> 0) / 4294967296;
  const fb = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0.4, size: 0.6, sizeEnd: 1, heat: 0.8, heatEnd: 0, drag: 0, gravity: 0, kind: 'fire' };
  const dp = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 0.15, sizeEnd: 0.08, glyph: '.', color: [1, 1, 1], colorEnd: [0, 0, 0], alpha: 1, alphaEnd: 0, drag: 1.2, flicker: 0.2, spin: 0, rot: 0, gravity: -12 };
  const DEBRIS = [0.5, 0.42, 0.34], DEBRIS_END = [0.1, 0.08, 0.06], SPARK = [1.6, 0.6, 0.15], SPARK_END = [0.4, 0.05, 0.01];
  /** A tank's blast at (x, z), caused by `by`: the world, the fire, the hero inside its reach, him. */
  const explode = (x, z, by, quiet) => {
    const game = F._game;
    if (!game) return;
    const W = game.world, Fi = game.fx?.fire, q = W?.destructibles?.q ?? 1;
    blastO.by = by;
    blastO.src = W?.destructibles?.swing?.() ?? -1;
    W?.impact?.(x, z, B.blast.r, B.blast.power, blastO);
    if (Fi) {
      const nn = Math.round(46 * q);
      for (let i = 0; i < nn; i++) {
        const a = hz() * TAU, sp = 1.5 + hz() * 5, up = 1 + hz() * 5;
        fb.x = x + Math.cos(a) * 0.4;
        fb.y = 0.6 + hz() * 0.8;
        fb.z = z + Math.sin(a) * 0.4;
        fb.vx = Math.cos(a) * sp;
        fb.vy = up;
        fb.vz = Math.sin(a) * sp;
        fb.life = 0.45 + hz() * 0.5;
        fb.size = 1.0 + hz() * 0.8;
        fb.sizeEnd = 2.2;
        fb.heat = 1.1 + hz() * 0.6;
        fb.heatEnd = 0;
        fb.drag = 2.4;
        fb.gravity = -1;
        fb.kind = i % 5 === 0 ? 'smoke' : 'fire';
        Fi.spawn(fb);
      }
      fb.drag = fb.gravity = 0;
    }
    const A = game.fx?.add;
    if (A) {
      const nn = Math.round(24 * q);
      for (let i = 0; i < nn; i++) {
        const a = (i / nn) * TAU + hz() * 0.3, sp = 5 + hz() * 7;
        dp.x = x;
        dp.y = 0.6;
        dp.z = z;
        dp.vx = Math.cos(a) * sp;
        dp.vy = 2 + hz() * 5;
        dp.vz = Math.sin(a) * sp;
        dp.life = 0.5 + hz() * 0.5;
        dp.glyph = i % 3 ? '*+.' : "+x'";
        dp.color = i % 3 ? DEBRIS : SPARK;
        dp.colorEnd = i % 3 ? DEBRIS_END : SPARK_END;
        dp.spin = (hz() - 0.5) * 8;
        A.spawn(dp);
      }
    }
    game.shake?.(0.45);
    F._flash?.(0.5);
    blastEvt.x = x;
    blastEvt.z = z;
    blastEvt.r = B.blast.r;
    blastEvt.by = by;
    game.events?.emit?.('world:blast', blastEvt);
    // the hero inside its reach: blockable, a roll clears it (never when the fairness guard quieted it)
    const p = game.player;
    if (!quiet && p?.alive && p.position && Math.hypot(p.position.x - x, p.position.z - z) < B.hero.r + (p.radius ?? 0.45)) {
      heroHit.damage = B.hero.damage;
      heroHit.knockback = B.hero.knockback;
      heroHit.from.x = x;
      heroHit.from.z = z;
      try {
        p.takeHit?.(heroHit);
      } catch (err) {
        console.error('[foundry] the blast on the hero failed', err);
      }
    }
    // him: a tank the hero broke is a weapon against him too
    const d = game.boss ?? game.dragon;
    if (by === 'player' && d?.position && d.mode !== 'dead' && d.mode !== 'dying' && Math.hypot(d.position.x - x, d.position.z - z) < B.boss.r) {
      try {
        if (typeof d.onBlast === 'function') d.onBlast(B.boss.damage, B.boss.posture, x, z);
        else d.takeHit?.({ damage: B.boss.damage, exact: true, posture: B.boss.posture, heavy: true, part: 'body', dir: { x: d.position.x - x, z: d.position.z - z } });
      } catch (err) {
        console.error('[foundry] the blast on the boss failed', err);
      }
    }
  };
  F._explode = explode;
  return F;
}

// ---------------------------------------------------------------- the light, the heat, the steam
const blob = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0.05, size: 0.6, sizeEnd: 0.6, heat: 0.5, heatEnd: 0.5, drag: 0, gravity: 0, kind: 'fire' };
const spark = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 0.13, sizeEnd: 0.08, glyph: ".'", color: [1.8, 0.7, 0.18], colorEnd: [0.5, 0.08, 0.01], alpha: 1, alphaEnd: 0, drag: 0.3, flicker: 0.4, spin: 0, rot: 0, gravity: -5 };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The foundry's light, its molten glow, its lamps and its steam (atmosphere.js runs it). */
function makeAmbience(F, { ladles, beacons, press, vents, furnace, posts }) {
  let seed = 0x5a17c3e9;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const T = FOUNDRY_TUNING, M = T.molten;
  const st = { w: [1, 0, 0, 0], phase: 1, flash: 0, dim: 0, dimWant: 0, dimHold: 0, t: 0, hold: 0, heat: 0, steamAcc: 0, pourAcc: 0, sparkAcc: 0, nextFlash: 3, palette: false, lights: [], steam: 0 };
  const cur = { moon: [0, 0, 0], dir: [0, 0, 0], ambient: [0, 0, 0], fogColor: [0, 0, 0], fogNear: 0, fogFar: 0, furnace: 0, pour: 0, alarm: 0, lamps: 0 };
  let game = null, batch = null, map = null;
  const pieceOf = (def) => {
    const D = game?.world?.destructibles;
    if (!def || !D?.list) return null;
    if (!map) {
      map = new Map();
      for (const b of D.list) if (b.def) map.set(b.def, b);
    }
    return map.get(def) ?? null;
  };
  const standing = (def) => {
    const b = pieceOf(def);
    return !b || (b.state === 0 && !b.absent);
  };
  // a crucible bursting: a spray of sparks off its mouth (glyph particles: small things that fly)
  F._burst = (x, y, z) => {
    const A = game?.fx?.add, q = game?.world?.destructibles?.q ?? 1;
    if (!A) return;
    const nn = Math.round(28 * q);
    for (let i = 0; i < nn; i++) {
      const a = rnd() * TAU, sp = 2 + rnd() * 5;
      spark.x = x;
      spark.y = y + 0.4;
      spark.z = z;
      spark.vx = Math.cos(a) * sp;
      spark.vy = 1 + rnd() * 4;
      spark.vz = Math.sin(a) * sp;
      spark.life = 0.5 + rnd() * 0.6;
      spark.gravity = -12;
      A.spawn(spark);
    }
    spark.gravity = -5;
  };
  F._flash = (k) => {
    st.flash = Math.max(st.flash, Math.min(1.5, k));
  };
  const blend = () => {
    for (const k of ['moon', 'dir', 'ambient', 'fogColor']) for (let i = 0; i < 3; i++) cur[k][i] = LIGHT[0][k][i] * st.w[0] + LIGHT[1][k][i] * st.w[1] + LIGHT[2][k][i] * st.w[2] + LIGHT[3][k][i] * st.w[3];
    for (const k of ['fogNear', 'fogFar', 'furnace', 'pour', 'alarm', 'lamps']) cur[k] = LIGHT[0][k] * st.w[0] + LIGHT[1][k] * st.w[1] + LIGHT[2][k] * st.w[2] + LIGHT[3][k] * st.w[3];
  };
  const write = (U) => {
    if (!U?.uMoonColor?.value) return;
    // (phase 4: the furnace's roar breathes in the light)
    const roar = 1 + st.w[3] * 0.12 * Math.sin(st.t * 7.3) * Math.sin(st.t * 2.1);
    const f = st.flash, d = (1 - 0.7 * st.dim) * roar;
    U.uMoonColor.value.setRGB(cur.moon[0] * d + 1.4 * f, cur.moon[1] * d + 0.8 * f, cur.moon[2] * d + 0.4 * f);
    U.uAmbient?.value?.setRGB(cur.ambient[0] * d + 0.15 * f, cur.ambient[1] * d + 0.08 * f, cur.ambient[2] * d + 0.04 * f);
    U.uFogColor?.value?.setRGB(cur.fogColor[0] * d, cur.fogColor[1] * d, cur.fogColor[2] * d);
    U.uMoonDir?.value?.set(cur.dir[0], cur.dir[1], cur.dir[2]).normalize();
    if (U.uFogNear) U.uFogNear.value = cur.fogNear;
    if (U.uFogFar) U.uFogFar.value = cur.fogFar;
  };

  /** The steam's batch (tiny faint letters), built on a quiet stream (three names its objects with uuids). */
  const buildSteam = (g) => {
    if (batch || !g?.pipeline?.registerParticles || !g?.U) return;
    const mr = Math.random;
    let qs = 0x6e3a91c7;
    const quiet = () => (qs = (Math.imul(qs, 1664525) + 1013904223) >>> 0) / 4294967296;
    Math.random = quiet;
    try {
      batch = new LetterBatch(g, T.steam.max, ".,'`-~:", { additive: false, spawned: T.steam.max, rand: quiet });
    } catch (err) {
      console.error('[foundry] the steam', err);
      batch = null;
    } finally {
      Math.random = mr;
    }
    if (!batch) return;
    st.glyphs = ['.', ',', "'", '`', '~', '-'].map((c) => batch.col(c) || batch.col('.'));
    g.pipeline.registerParticles(batch);
  };
  const sp = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 3, col: 0, color: [0, 0, 0], colorEnd: [0, 0, 0], alpha: 0.3, alphaEnd: 0, drag: 0.25, gravity: 0, flicker: 0 };
  const wv = { x: 0, z: 0, k: 0 };
  const puff = (x, y, z, col, k, rise) => {
    const S = T.steam;
    const w = game?.world?.life?.wind?.at?.(x, z, wv) ?? null;
    sp.x = x + (rnd() - 0.5) * 0.4;
    sp.y = y + rnd() * 0.3;
    sp.z = z + (rnd() - 0.5) * 0.4;
    sp.vx = (w ? w.x : 0.5) * 0.7 + (rnd() - 0.5) * 0.3;
    sp.vz = (w ? w.z : 0) * 0.7 + (rnd() - 0.5) * 0.3;
    sp.vy = rise * (S.rise[0] + rnd() * (S.rise[1] - S.rise[0]));
    sp.life = S.life[0] + rnd() * (S.life[1] - S.life[0]);
    sp.col = st.glyphs[Math.floor(rnd() * st.glyphs.length)];
    const b = 0.7 + 0.3 * rnd();
    for (let i = 0; i < 3; i++) {
      sp.color[i] = col[i] * b * k;
      sp.colorEnd[i] = col[i] * b * 0.4;
    }
    sp.alpha = S.alpha * (0.6 + 0.4 * rnd());
    sp.alphaEnd = 0;
    batch.spawn(sp);
  };

  return {
    /** the light now: { w: [p1..p4], flash, dim, phase, heat (blobs printed last frame), steam (letters) } */
    get state() {
      return { w: st.w.slice(), flash: st.flash, dim: st.dim, phase: st.phase, heat: st.heat, steam: st.steam };
    },
    setup(g) {
      game = g;
      F._game = g;
      blend();
      write(g.U);
      // the furnace's light, the pour's two (low: they take only the slots the fight leaves free), the alarm
      const L = g.lights;
      if (L?.add) {
        st.lights.push({ k: 'furnace', l: L.add({ x: furnace.x, y: 2.6, z: furnace.z + furnace.r + 0.8, color: [1, 0.45, 0.15], intensity: 1.6, radius: 15, flicker: 0.25, low: true }) });
        for (const x of [-7, 7]) st.lights.push({ k: 'pour', l: L.add({ x, y: 0.9, z: -19, color: [1, 0.5, 0.18], intensity: 1.1, radius: 9, flicker: 0.15, low: true }) });
        st.lights.push({ k: 'alarm', l: L.add({ x: 0, y: 6, z: 0, color: [1, 0.12, 0.06], intensity: 0, radius: 13, flicker: 0, low: true }) });
      }
      buildSteam(g);
    },
    setVisible(on) {
      if (batch?.mesh) batch.mesh.visible = !!on;
    },
    /** A flash of the phase's light (k 0..1): a change, a great blow, a shell's burst. */
    flare(k = 1) {
      const v = Math.min(1.5, Math.max(0, Number(k) || 0));
      if (v > st.flash) st.flash = v;
    },
    /** The light pulled down by k (0..1) while it is called each frame (it lets go 0.2 s after). */
    dim(k = 1) {
      const v = Number(k);
      st.dimWant = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
      st.dimHold = 0.2;
    },
    update(dt, g) {
      if (!(dt > 0)) return;
      game = g;
      st.t += dt;
      try {
        F.update(dt, g);
      } catch (err) {
        console.error('[foundry] hazards', err);
      }
      // (the molten steel's palette on the fire slot, once: the level's heat; a boss's own swap wins after)
      if (!st.palette && g.fx?.fire?.setPalette) {
        st.palette = true;
        g.fx.fire.setPalette('fire', FIRE_PALETTES.foundry ?? FIRE_PALETTES.fire);
      }
      if (map && g.world?.destructibles?.list && map.size === 0) map = null;
      const boss = g.dragon;
      const bp = Number(boss?.phase);
      const ph = Math.min(4, Math.max(1, Math.round(Number.isFinite(bp) && boss?.mode !== 'sleep' ? Math.max(bp, 1) : F._light.phase || 1)));
      if (ph < st.phase) {
        st.w.fill(0);
        st.w[0] = 1;
        st.flash = 0;
        st.dim = st.dimWant = 0;
        map = null;
      }
      st.phase = ph;
      const k = 1 - Math.exp(-dt * 0.9);
      for (let i = 0; i < 4; i++) st.w[i] += ((i === ph - 1 ? 1 : 0) - st.w[i]) * k;
      if (st.dimHold > 0) st.dimHold -= dt;
      else st.dimWant = 0;
      st.dim += (st.dimWant - st.dim) * (1 - Math.exp(-dt * 4));
      st.flash = st.flash > 0.004 ? st.flash * Math.exp(-dt * 6) : 0;
      // phase 4: the sky flashes far off now and then (the barrage's own flares come from his effects)
      if (st.w[3] > 0.5 && (st.nextFlash -= dt) <= 0) {
        st.nextFlash = T.flashes[0] + rnd() * (T.flashes[1] - T.flashes[0]);
        st.flash = Math.max(st.flash, 0.22 + 0.2 * rnd());
      }
      blend();
      write(g.U);
      // the lights
      const alarmA = st.t * 1.6;
      for (const o of st.lights) {
        const l = o.l;
        if (!l) continue;
        if (o.k === 'furnace') l.intensity = cur.furnace * (1 + 0.15 * st.w[3] * Math.sin(st.t * 9));
        else if (o.k === 'pour') l.intensity = cur.pour;
        else if (o.k === 'alarm') {
          l.intensity = cur.alarm * 1.8;
          l.x = Math.sin(alarmA) * 11;
          l.z = Math.cos(alarmA) * 11;
        }
      }
      this._heat(dt, g, alarmA);
      this._steam(dt, g);
    },
    /** The heat in the fire field: the pour, the pools, the ladles, the furnace, the billet, the lamps. */
    _heat(dt, g, alarmA) {
      const Fi = g.fx?.fire;
      if (!Fi) return;
      const q = g.world?.destructibles?.q ?? 1, t = st.t;
      // (what is re-drawn every frame lives one frame: DuelFx._frame's rule, so the heat never stacks)
      st.hold -= dt;
      let life = 0;
      if (!(st.hold > 0)) {
        life = Math.max(0.011, dt * 1.5);
        st.hold = life - dt;
      }
      let n = 0;
      blob.vx = blob.vy = blob.vz = 0;
      blob.drag = blob.gravity = 0;
      blob.kind = 'fire';
      if (life > 0) {
        blob.life = life;
        // ---- the pour: a grid of heat over the crust, slow currents of brighter steel running along it
        const PO = T.pour, P = FOUNDRY.pour, c = PO.cell / Math.max(0.5, Math.sqrt(q));
        for (let x = P.x0 + c / 2; x < P.x1; x += c) {
          for (let z = P.z0 + 0.5; z < P.z1 - 0.3; z += c) {
            const flow = Math.sin(x * 0.55 - t * PO.flow * 2.2 + Math.sin(z * 1.3 + t * 0.4) * 1.4) * 0.5 + Math.sin(x * 1.7 + z * 2.1 + t * 0.9) * 0.25;
            blob.x = x;
            blob.y = 0.34;
            blob.z = z;
            blob.size = blob.sizeEnd = PO.size;
            blob.heat = blob.heatEnd = PO.heat[0] + (PO.heat[1] - PO.heat[0]) * clamp01(0.5 + flow) * (0.85 + 0.15 * (cur.pour / 1.1));
            Fi.spawn(blob);
            n++;
          }
        }
        // ---- the pools: a hot rim, a crust that cools in from it as the pool ages; the last seconds go dark
        for (const p of F.molten.pools) {
          if (!p.alive) continue;
          const age = clamp01(p.t / p.life), fade = clamp01((p.life - p.t) / M.fade), grow = clamp01(p.t / M.spread);
          const R = p.r * (0.35 + 0.65 * grow);
          const cell = M.cell / Math.max(0.5, Math.sqrt(q));
          let budget = Math.round(M.cap * q);
          // the rim
          const nr = Math.max(6, Math.round((TAU * R) / cell));
          for (let i = 0; i < nr && budget > 0; i++, budget--) {
            const a = (i / nr) * TAU + p.id;
            blob.x = p.x + Math.cos(a) * R * 0.92;
            blob.y = 0.16;
            blob.z = p.z + Math.sin(a) * R * 0.92;
            blob.size = blob.sizeEnd = cell * 1.6;
            blob.heat = blob.heatEnd = (M.rim[0] + (M.rim[1] - M.rim[0]) * age) * fade * (0.85 + 0.15 * Math.sin(t * 5 + i));
            Fi.spawn(blob);
            n++;
          }
          // the middle: crust patches (darker) drifting over the hot steel
          for (let gx = -R; gx <= R && budget > 0; gx += cell) {
            for (let gz = -R; gz <= R && budget > 0; gz += cell) {
              const d = Math.hypot(gx, gz);
              if (d > R * 0.82) continue;
              const crust = clamp01(0.5 + 0.5 * Math.sin(gx * 2.3 + p.id * 1.7 + t * 0.6) * Math.sin(gz * 2.1 - t * 0.5));
              blob.x = p.x + gx;
              blob.y = 0.16;
              blob.z = p.z + gz;
              blob.size = blob.sizeEnd = cell * 1.6;
              blob.heat = blob.heatEnd = (M.heat[0] + (M.heat[1] - M.heat[0]) * age) * (1 - 0.45 * crust * age) * fade;
              Fi.spawn(blob);
              n++;
              budget--;
            }
          }
        }
        // ---- the full ladles: the steel's face at their mouths
        for (const L of ladles) {
          if (!L.full || !standing(L.def)) continue;
          for (let i = 0; i < 3; i++) {
            blob.x = L.x + Math.cos(i * 2.1 + t) * 0.25;
            blob.y = L.h + 0.68;
            blob.z = L.z + Math.sin(i * 2.1 + t) * 0.25;
            blob.size = blob.sizeEnd = 0.55;
            blob.heat = blob.heatEnd = 1.1 + 0.2 * Math.sin(t * 3 + i);
            Fi.spawn(blob);
            n++;
          }
        }
        // ---- the furnace: its tap hole and the runner down to the pour (the roar in phase 4)
        {
          const fz = furnace.z + furnace.r * 1.02, roar = 1 + 0.6 * st.w[3];
          for (let i = 0; i < 4; i++) {
            blob.x = furnace.x + (i - 1.5) * 0.35;
            blob.y = 0.5 + (i % 2) * 0.7;
            blob.z = fz + 0.5;
            blob.size = blob.sizeEnd = 0.8;
            blob.heat = blob.heatEnd = (0.95 + 0.25 * Math.sin(t * 6 + i)) * roar;
            Fi.spawn(blob);
            n++;
          }
          for (let z = fz + 0.4; z < FOUNDRY.pour.z0 - 0.3; z += 0.7) {
            blob.x = furnace.x;
            blob.y = 0.55;
            blob.z = z;
            blob.size = blob.sizeEnd = 0.7;
            blob.heat = blob.heatEnd = 0.85 + 0.2 * Math.sin(z * 2 - t * 3);
            Fi.spawn(blob);
            n++;
          }
        }
        // ---- the billet on the press's die
        for (const pr of press) {
          if (!standing(pr.def)) continue;
          blob.x = pr.x;
          blob.y = pr.y;
          blob.z = pr.z;
          blob.size = blob.sizeEnd = 0.75;
          blob.heat = blob.heatEnd = 0.7 + 0.1 * Math.sin(t * 2);
          Fi.spawn(blob);
          n++;
        }
        // ---- phase 2: the warning lamps on the jib posts blink amber
        if (cur.lamps > 0.05) {
          posts.forEach((def, i) => {
            if (!standing(def) || Math.sin(t * 5.2 + i * 1.6) < 0.2) return;
            const b = pieceOf(def);
            blob.x = b ? b.x : 0;
            blob.y = FOUNDRY.ladles[0].top + 0.95;
            blob.z = b ? b.z : 0;
            blob.size = blob.sizeEnd = 0.38;
            blob.heat = blob.heatEnd = 0.55 * cur.lamps;
            Fi.spawn(blob);
            n++;
          });
        }
        // ---- phase 3: the red beacons on the columns' heads, lit round the hall in turn
        if (cur.alarm > 0.05) {
          for (const bc of beacons) {
            if (!standing(bc.def)) continue;
            const a = Math.atan2(bc.x, bc.z), on = Math.cos(a - alarmA);
            if (on < 0.3) continue;
            blob.x = bc.x;
            blob.y = bc.y;
            blob.z = bc.z;
            blob.size = blob.sizeEnd = 0.45;
            blob.heat = blob.heatEnd = 0.5 * cur.alarm * on;
            Fi.spawn(blob);
            n++;
          }
        }
      }
      // ---- the steel pouring down from a burst crucible (a falling stream, not one-frame)
      for (const L of ladles) {
        if (!(L.pourT > 0)) continue;
        L.pourAcc += dt * 40 * q;
        while (L.pourAcc >= 1) {
          L.pourAcc -= 1;
          blob.x = L.x + (rnd() - 0.5) * 0.5;
          blob.y = L.h + (rnd() - 0.3) * 0.5;
          blob.z = L.z + (rnd() - 0.5) * 0.5;
          blob.vx = (rnd() - 0.5) * 0.6;
          blob.vy = -4 - rnd() * 2;
          blob.vz = (rnd() - 0.5) * 0.6;
          blob.life = 0.45;
          blob.size = 0.55;
          blob.sizeEnd = 0.35;
          blob.heat = 1.2;
          blob.heatEnd = 0.9;
          blob.gravity = -9;
          Fi.spawn(blob);
          n++;
        }
        blob.vx = blob.vy = blob.vz = 0;
        blob.gravity = 0;
        blob.sizeEnd = blob.size;
      }
      // ---- phase 4: sparks rain round the focus (glyph particles: small things that fly)
      const A = g.fx?.add, foc = g.U?.uFocus?.value;
      if (A && foc && st.w[3] > 0.05) {
        st.sparkAcc += dt * T.sparks * st.w[3] * q;
        while (st.sparkAcc >= 1) {
          st.sparkAcc -= 1;
          spark.x = foc.x + (rnd() - 0.5) * 34;
          spark.z = foc.z + (rnd() - 0.5) * 24 - 3;
          spark.y = 7 + rnd() * 5;
          spark.vx = (rnd() - 0.5) * 1.2;
          spark.vy = -2 - rnd() * 2;
          spark.vz = (rnd() - 0.5) * 1.2;
          spark.life = 1.2 + rnd() * 0.8;
          A.spawn(spark);
        }
      }
      st.heat = n;
    },
    /** The steam off the pipe racks and the press, the fumes off the pour (tiny faint letters). */
    _steam(dt, g) {
      if (!batch) return;
      const S = T.steam, q = g.world?.destructibles?.q ?? 1;
      batch.begin();
      st.steamAcc += dt * S.vent * q;
      while (st.steamAcc >= 1) {
        st.steamAcc -= 1;
        for (const v of vents) {
          if (v.def && !standing(v.def)) continue;
          if (rnd() > v.k / 2.2 + 0.25) continue;
          puff(v.x, v.y, v.z, v.smoke ? S.fume : S.color, v.smoke ? 0.8 : 1, v.smoke ? 1.6 : 1);
        }
      }
      st.pourAcc += dt * S.pour * q * (1 + st.w[3]);
      const P = FOUNDRY.pour;
      while (st.pourAcc >= 1) {
        st.pourAcc -= 1;
        puff(P.x0 + rnd() * (P.x1 - P.x0), 0.5, P.z0 + 0.4 + rnd() * (P.z1 - P.z0 - 0.8), S.fume, 0.9, 0.8);
      }
      batch.flow(dt, st.t);
      batch.end();
      st.steam = batch.count;
    },
  };
}
