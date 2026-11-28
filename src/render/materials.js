import * as THREE from 'three';
import { DP_FLOOR_GLSL, DP_FLOOR_MAIN, DP_FLOOR_PRINT, dpFloorLook, dpFloorUniforms, lazySlabRim } from './dragonFloor.js';
import { COMMON_GLSL, HERO_PARTS, RIGID_VERT_GLSL, WIND_GLSL, WIND_FRONTS_LEN } from './shaderLib.js';
import { gi } from './glyphs.js';
import { LET_GO_GLSL, letGoUniforms } from './letGo.js';

// Material families (see STYLE.md):
//  - AsciiObject: trees, bones, the bonfire. Writes a FLAG in alpha so the post pass converts the
//    object into a screen-space character grid (stone ramp for flag≈1, leaf ramp for flag≈0.6).
//  - SurfaceGlyph: creatures and the player. Glyphs are laid out ON the surface (in aGUV space,
//    meters), oriented along the body, chosen by lighting — "arranged symbols" for scales/armour.
//    v0.3: crisp glyphs on near-black gaps + a moonlit silhouette outline (see STYLE.md).
//  - CarvedGlyph: static rock (stones, boulders, flagstones). Crisp glyphs on a world-fixed,
//    camera-facing lattice, chosen by facet light, with contour hatching, cracks and moss.

// Alpha flag values written into the scene target (decoded by the ASCII pass in pipeline.js):
//   0            NONE     pass-through (particles never reach the scene target)
//   0.04..0.41   CREATURE screen-grid glyphs that follow the surface flow (opt-in `grid: true`,
//                the v0.2 look); the value packs set x 24 screen-space flow angles (span 0.37 since
//                ADR-130: the player's own hero window sits at 0.42..0.45, above it)
//   0.5          ART      hero / wyrm: their crisp render is the SOURCE IMAGE of a fine screen-space
//                         ASCII-art grid (letters picked by brightness, coloured per cell);
//   0.48         ART_HERO the same, with the hero's own pass settings (pipeline uArt* .x)
//   0.57         ART_PROP background objects (stone, metal, bone): the same fine letters as the wyrm,
//                         on a grid counted from the ground (pipeline uProp*; ADR-100)
//   0.6          LEAF     blobby foliage ramp
//   1.0          STONE    letter ramp + edge outlines
/**
 * The fire rising inside the wyrm before a breath (Dragon._riseHeat): the charge's glow (uGlowRise,
 * each wyrm material's share of the throat charge) does not light the whole throat at once. It
 * FILLS from the deep chest (uWyrmHeatFrom.xyz) out to a front (uWyrmHeat.xyz) that climbs the neck
 * to the maw; uWyrmHeat.w = how much of that rule holds (0: the charge glows everywhere, as before).
 * `soft` = the front's edge (m). Round the front itself (`radius` m, strength uWyrmHeatFrom.w) the
 * glow is x (1 + glow), the gaps between the scales take `gap` of the part's ember colour, the
 * scales `hide` and everything `flat`: the digits on the dark hide brighten as it passes. Calm: a
 * tell, not a flash.
 */
export const WYRM_HEAT = { soft: 1.0, radius: 2.0, glow: 0.6, gap: 2.4, hide: 0.5, flat: 0.07 };

export const FLAG = { NONE: 0.0, ART_HERO: 0.48, ART: 0.5, ART_PROP: 0.57, LEAF: 0.6, STONE: 1.0 };
/**
 * Hero ink-line art (materials with `heroArt`): instead of FLAG.ART_HERO they write a PART ID into
 * alpha, a0 + id × step (id = part × 2 + the geometry's aPart sub-id 0/1), still inside the pass's
 * hero window (0.46, 0.49). The art pass draws a bright ink line wherever two neighbouring cells
 * show different parts (the higher id draws it) or a depth step (the nearer side draws it). Step 0.0006
 * is ≥ 2 half-float ulps there; parts 0..19 (each part's line tint: U.uHeroPartInk).
 * `heroSelf` (the PLAYER's rig only; the human bosses share everything else) writes the same ids
 * `self` lower, in a window of their own (0.42, 0.45): the art pass tells his pixels from a boss's
 * by it and prints him on his own letter cell (pipeline.js "the hero's letters follow his size").
 */
export const HERO_ART = { a0: 0.4632, step: 0.0006, parts: HERO_PARTS, self: 0.04 };
export const ASCII_SETS = { scales: 0, strands: 1, plates: 2, smooth: 3 };
/**
 * Surface-glyph defaults per `ascii` set: 4-glyph ramp (dark → bright) and cell size in aGUV
 * meters. Cells must stay >= ~6 screen px at the default camera (~35-50 px/m) or the glyphs blur
 * into a solid texture (the v0.1 hero used 0.06 m cells: 2-3 px).
 */
export const SURFACE_SETS = {
  scales: { glyphs: '.v^A', cell: [0.2, 0.24], rowShift: 0.5 },
  strands: { glyphs: '.:|I', cell: [0.14, 0.2], rowShift: 0.5 },
  plates: { glyphs: '.-=#', cell: [0.24, 0.18], rowShift: 0 },
  smooth: { glyphs: '.:o0', cell: [0.1, 0.1], rowShift: 0 },
};
export const CREATURE_FLAG = { min: 0.04, span: 0.37, codes: 96, angles: 24 };
/** Surface-glyph `levels` table size: up to 6 light levels × 8 per-cell variants. */
export const SURFACE_LEVELS = { max: 6, variants: 8 };
/** Defaults of the optional surface-glyph features (see createSurfaceGlyphMaterial). */
export const SURFACE_FEATURE_DEFAULTS = {
  glowBias: 1,
  glowRange: [0, 0.75],
  inkAxisChance: 0.6,
  inkRange: [0, 0.75],
  crackScale: 2.5,
  crackWidth: 1,
};

// `levels` → packed glyph indices (vec4 × 2 per level, -1 = empty cell) + variant counts.
// Every glyph goes through gi(), so a glyph missing from the world atlas throws at construction.
function surfaceLevels(levels) {
  const { max, variants } = SURFACE_LEVELS;
  if (!Array.isArray(levels) || levels.length < 1 || levels.length > max) {
    throw new Error(`surface glyph levels: expected 1..${max} strings (dark → bright), got ${JSON.stringify(levels)}`);
  }
  const ids = new Array(max * variants).fill(-1);
  const counts = new Array(max).fill(1);
  levels.forEach((s, l) => {
    if (typeof s !== 'string') throw new Error(`surface glyph levels[${l}] is not a string: ${JSON.stringify(s)}`);
    const chars = [...s];
    if (chars.length > variants) {
      throw new Error(`surface glyph levels[${l}] "${s}" has ${chars.length} variants (max ${variants})`);
    }
    chars.forEach((ch, v) => {
      try {
        ids[l * variants + v] = ch === ' ' ? -1 : gi(ch);
      } catch (e) {
        throw new Error(`surface glyph levels[${l}] "${s}": ${e.message}`);
      }
    });
    counts[l] = Math.max(chars.length, 1); // '' = one empty variant
  });
  const packed = [];
  for (let i = 0; i < ids.length; i += 4) packed.push(new THREE.Vector4(ids[i], ids[i + 1], ids[i + 2], ids[i + 3]));
  return { packed, counts, n: levels.length };
}
function unitAxis(a, name) {
  const v = Array.isArray(a) && a.length === 3 ? new THREE.Vector3(+a[0], +a[1], +a[2]) : null;
  const len = v ? v.length() : NaN;
  if (!(Number.isFinite(len) && len > 1e-6)) {
    throw new Error(`surface glyph ${name}: expected a non-zero object-space [x, y, z], got ${JSON.stringify(a)}`);
  }
  return v.divideScalar(len);
}
function range2(r, name) {
  if (!(Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[1] > r[0])) {
    throw new Error(`surface glyph ${name}: expected [lo, hi] with lo < hi, got ${JSON.stringify(r)}`);
  }
  return new THREE.Vector2(r[0], r[1]);
}
// Optional features compile in through `defines` only when their option is present, so a
// material without them runs exactly the pre-existing shader (same program, same pixels).
function surfaceFeatures(o, cell) {
  const D = SURFACE_FEATURE_DEFAULTS;
  const defines = {};
  const uniforms = {};
  if (o.levels != null) {
    const t = surfaceLevels(o.levels);
    defines.SG_LEVELS = '';
    uniforms.uLvGlyph = { value: t.packed };
    uniforms.uLvCount = { value: t.counts };
    uniforms.uLvN = { value: t.n };
  }
  if (o.levelInk != null) {
    const li = o.levelInk;
    if (!Array.isArray(li) || li.length < 1 || li.length > SURFACE_LEVELS.max || !li.every((c) => Array.isArray(c) && c.length === 3 && c.every(Number.isFinite))) {
      throw new Error(`surface glyph levelInk: expected 1..${SURFACE_LEVELS.max} [r, g, b] colours, got ${JSON.stringify(li)}`);
    }
    defines.SG_LEVEL_INK = '';
    uniforms.uLevelInk = {
      value: Array.from({ length: SURFACE_LEVELS.max }, (_, i) => new THREE.Vector3(...li[Math.min(i, li.length - 1)])),
    };
  }
  if (o.glowAxis != null) {
    defines.SG_GLOW_AXIS = '';
    uniforms.uGlowAxis = { value: unitAxis(o.glowAxis, 'glowAxis') };
    uniforms.uGlowBias = { value: o.glowBias ?? D.glowBias };
    uniforms.uGlowRange = { value: range2(o.glowRange ?? D.glowRange, 'glowRange') };
  }
  const inkAxis = o.inkAxis ?? o.inkAltAxis;
  if (inkAxis != null) {
    defines.SG_INK_AXIS = '';
    uniforms.uInkAxis = { value: unitAxis(inkAxis, 'inkAxis') };
    uniforms.uInkAxisChance = { value: o.inkAxisChance ?? D.inkAxisChance };
    uniforms.uInkRange = { value: range2(o.inkRange ?? D.inkRange, 'inkRange') };
  }
  if (defines.SG_GLOW_AXIS != null || defines.SG_INK_AXIS != null) defines.SG_AXIS = '';
  const seamAxis = o.seamAxis ?? 'both';
  if (!['both', 'x', 'y'].includes(seamAxis)) throw new Error(`surface glyph seamAxis: 'both' | 'x' | 'y', got ${JSON.stringify(seamAxis)}`);
  const crack = o.crack ?? 'grid';
  if (crack === 'voronoi') {
    defines.SG_VORONOI = '';
    const k = o.crackScale ?? D.crackScale;
    const w = o.crackWidth ?? D.crackWidth;
    if (!(k > 0 && w > 0)) throw new Error(`surface glyph crackScale / crackWidth must be > 0 (got ${k}, ${w})`);
    // seamAxis stretches the fissure cells so most fissures run along that aGUV direction
    const sx = seamAxis === 'x' ? 3 : 1;
    const sy = seamAxis === 'y' ? 3 : 1;
    uniforms.uCrackCell = { value: new THREE.Vector2(cell[0] * k * sx, cell[1] * k * sy) };
    // fissure distance (F2 - F1 ≈ 2 × distance, in crack-cell x units) → glyph-cell units, / width
    uniforms.uCrackK = { value: (0.5 * k * sx) / w };
  } else if (crack !== 'grid') {
    throw new Error(`surface glyph crack: 'grid' | 'voronoi', got ${JSON.stringify(crack)}`);
  } else if (seamAxis === 'y') defines.SG_SEAM_Y = '';
  else if (seamAxis === 'x') defines.SG_SEAM_X = '';
  if (o.wyrm != null) wyrmFeatures(o.wyrm, defines, uniforms);
  // the hero's ink-line art source (see SG_HERO_ART in the fragment shader)
  if (o.heroArt != null) {
    const h = o.heroArt;
    const part = Math.round(h.part ?? 0);
    if (!(part >= 0 && part < HERO_ART.parts)) throw new Error(`surface glyph heroArt.part: 0..${HERO_ART.parts - 1}, got ${h.part}`);
    defines.SG_HERO_ART = '';
    defines.HERO_A0 = (HERO_ART.a0 - (o.heroSelf ? HERO_ART.self : 0)).toFixed(4);
    if (o.heroSelf) defines.SG_HERO_SELF = ''; // (the player's rig: the bosses' print, uBossPrint, leaves him alone)
    defines.HERO_AS = HERO_ART.step.toFixed(4);
    uniforms.uArtFill = { value: new THREE.Color(...(h.fill ?? [0.1, 0.1, 0.11])) };
    uniforms.uArtSpec = { value: new THREE.Vector2(h.spec ?? 0, h.specPow ?? 20) };
    uniforms.uArtRim = { value: h.rim ?? 1 };
    uniforms.uArtGlowK = { value: h.glow ?? 0 };
    uniforms.uArtSub = { value: h.sub ?? 0 }; // shade of a fold field's shadow side (model.js foldLines)
    uniforms.uArtOwn = { value: 0 }; // 1: this material keeps its own fill under the bosses' print (uBossPrint: no shared tone, no pale hem, no falloff; Halcyon's ?halRef, ADR-289)
    uniforms.uArtPart = { value: part * 2 };
    // cloth folds: [bands per metre across aGUV x (rad), depth 0..1, wander down aGUV y]
    if (h.folds != null) {
      const [fq, fd, fw] = h.folds;
      if (![fq, fd, fw].every(Number.isFinite)) throw new Error(`surface glyph heroArt.folds: [freq, depth, wander], got ${JSON.stringify(h.folds)}`);
      defines.SG_HERO_FOLDS = '';
      uniforms.uArtFold = { value: new THREE.Vector3(fq, fd, fw) };
    }
  }
  return { defines, uniforms };
}

/**
 * Wyrm ASCII-art source (option `wyrm`, the dragon's materials only): in art mode (FLAG.ART with
 * uArtSolid) the part renders `wyrmMain` instead of the smooth lit ink, the image the art pass
 * turns into letters (the owner's red-black dragon reference). All fields optional:
 *   scale: [w, h]        overlapping shingle scales in aGUV units (w across, h per row; tips point
 *                        toward -aGUV y); omit for smooth parts (spikes, bones, membranes)
 *   scaleDir: 'along' (default) | 'down' (rows along aGUV y, tips toward larger |aGUV x|: roof-tile
 *                        scales hanging from the dorsal line, for parts mapped around the body axis)
 *   strokes: 'rim' (default with scale) | 'axis' | 'none': where the art pass draws stroke glyphs
 *                        (- / | \) in the edge's screen direction: along the scale rims, or along the
 *                        part (aGUV y: spikes, claws, bones). Encoded as alpha = flag + 0.01 x code.
 *   tip: [y0, y1, root, glow]  horns / spikes / claws (aGUV y = distance from the root): value ramps
 *                        from `root` at y0 to 1 at y1 (bright tips), molten glow x uGlow at the root
 *   tone: [gap, body, rim, rimWidth]  value over a scale: under the covering scale's edge (the black
 *                        gap), the scale body, its free-edge rim; rimWidth in rows
 *   gap: [rows, px]      width of that black gap: at least `rows` of a scale row and `px` screen pixels
 *   ink: [r,g,b]         albedo of the source (charcoal hide, molten plates, crimson membrane)
 *   rimInk: [r,g,b]      albedo of the scale rims (default: ink), e.g. gold rims on molten plates
 *   light: [gain, key, fresnel, floor]  moon + fire lights x gain, a key light fixed to the camera
 *                        (`key` direction: the reference's light, the same from every view), a moonlit
 *                        edge rim, a flat light floor
 *   key: [right, up, toward]  the key light's direction in camera space (screen right, screen up,
 *                        toward the viewer): [-0.6, 0.9, 1] lights the upper-left faces of every form
 *   envSat: 0..1         saturation of the moonlight and ambient on the part (default 1; 0 = neutral
 *                        grey); fire light keeps its colour
 *   vein: [strength, share, width, plate]  molten fissures x uGlow: voronoi plates of `plate` aGUV
 *                        units, only `share` of the fissures glow (a broken, branching net), `width`
 *   crack: [strength, share, lo, hi]  molten cracks x uGlow IN THE SCALE GAPS (needs `scale`): jagged
 *                        lines that follow the scale outlines, wandering across the hide in a few long
 *                        runs plus `share` of single scales, only on surfaces facing down (world normal:
 *                        smoothstep(lo, hi, -n.y), e.g. [-0.4, 0.6]: none on the back, some on the
 *                        flanks, full under the belly / throat / tail)
 *   vary: 0..1           per-scale brightness variation of the scale bodies (default 0.8; lower = a
 *                        calmer hide, the reference's even charcoal)
 *   glow: [gaps, all]    emissive x uGlow in the scale gaps (molten plates) / everywhere (maw, eye)
 *   under: [r,g,b,k]     warm light from below on down-facing surfaces (lava light under the jaw)
 *   membrane: [mottle, specks, tears, edgeTears]  wing membranes only (needs aEdge / aBone): dark
 *                        mottling, ember specks, holes, a ragged trailing edge
 *   boneGlow: [width, base, hot]  membranes: the orange streaks along the finger bones, `width` model
 *                        units out from a bone, emissive `base` + `hot` x uGlow (default [0.3, 0.05, 0.9])
 */
function wyrmFeatures(w, defines, uniforms) {
  const v = (a, n, d) => (Array.isArray(a) && a.length === n && a.every(Number.isFinite) ? a : d);
  defines.SG_WYRM = '';
  uniforms.uWScale = { value: new THREE.Vector2(...v(w.scale, 2, [0, 0])) };
  // x: 1 = 'down' scales (tips toward larger |aGUV x|: barrel parts mapped around the body axis);
  // y: stroke glyphs for the art pass, 0 none, 1 along the scale rims, 2 along the part (aGUV y)
  // z: 'axis' strokes only where the fresnel term reaches it (the part's outline; 0 = everywhere)
  const strokes = { none: 0, rim: 1, axis: 2 }[w.strokes ?? (w.scale ? 'rim' : 'none')] ?? 0;
  uniforms.uWShape = { value: new THREE.Vector4(w.scaleDir === 'down' ? 1 : 0, strokes, w.strokeEdge ?? 0.12, 0) };
  // [y0, y1, root value, root glow]: value ramps from `root value` at aGUV y0 to 1 at y1 (no ramp:
  // [-2, -1, 1, 0]); root glow x uGlow below y1 (molten spine roots)
  uniforms.uWTip = { value: new THREE.Vector4(...v(w.tip, 4, [-2, -1, 1, 0])) };
  uniforms.uWTone = { value: new THREE.Vector4(...v(w.tone, 4, [0.0, 0.2, 1.0, 0.2])) };
  uniforms.uWGap = { value: new THREE.Vector2(...v(w.gap, 2, [0.22, 5])) };
  uniforms.uWInk = { value: new THREE.Color(...v(w.ink, 3, [0.3, 0.29, 0.28])) };
  uniforms.uWRimInk = { value: new THREE.Color(...v(w.rimInk ?? w.ink, 3, [0.3, 0.29, 0.28])) };
  uniforms.uWLight = { value: new THREE.Vector4(...v(w.light, 4, [1, 0.5, 0.3, 0.02])) };
  uniforms.uWKey = { value: new THREE.Vector3(...v(w.key, 3, [0, 0.7, 1])) };
  uniforms.uWEnvSat = { value: Number.isFinite(w.envSat) ? w.envSat : 1 };
  uniforms.uWVein = { value: new THREE.Vector4(...v(w.vein, 4, [0, 0.4, 0.06, 1])) };
  uniforms.uWCrack = { value: new THREE.Vector4(...v(w.crack, 4, [0, 0, -0.4, 0.6])) };
  uniforms.uWVary = { value: Number.isFinite(w.vary) ? w.vary : 0.8 };
  // molten colour of veins / gaps / glow: a red-orange (ACES turns a (1, 0.34, 0.05) lava gold)
  uniforms.uWEmit = { value: new THREE.Color(...v(w.emit, 3, [1.0, 0.17, 0.03])) };
  uniforms.uWGlow = { value: new THREE.Vector2(...v(w.glow, 2, [0, 0])) };
  uniforms.uWUnder = { value: new THREE.Vector4(...v(w.under, 4, [1, 0.35, 0.08, 0])) };
  if (w.membrane != null) {
    defines.SG_WYRM_MEMBRANE = '';
    uniforms.uWMem = { value: new THREE.Vector4(...v(w.membrane, 4, [0.5, 0.03, 0.1, 0.4])) };
    uniforms.uWMemBone = { value: new THREE.Vector3(...v(w.boneGlow, 3, [0.3, 0.05, 0.9])) };
  }
}

function pickShared(U, names) {
  const out = {};
  for (const n of names) out[n] = U[n];
  return out;
}
const SHARED = [
  'uTime', 'uMoonDir', 'uMoonColor', 'uAmbient', 'uFogColor', 'uFogNear', 'uFogFar', 'uFocus',
  'uCamPos', 'uPLPos', 'uPLCol', 'uPLRad', 'uShadowMap', 'uShadowMatrix', 'uShadowTexel',
  'uGlyphAtlas', 'uScorch', 'uScorchBounds',
];
// shared by surface-glyph materials only (declared in their own shader, not COMMON_GLSL)
const SURFACE_SHARED = ['uArtSolid', 'uArtHeroEdge', 'uArtHeroKey'];
// ... and by the hero's ink-line art source only (`heroArt`)
const HERO_ART_SHARED = ['uCamRight', 'uCamUp', 'uArtHeroLight', 'uArtHeroRim', 'uArtHeroCel', 'uHeroSolid', 'uBossPrint', 'uBossHero'];

/**
 * Geometry attributes required: position, normal, aCol (vec3 albedo, linear), aFlag (float),
 * aSway (float, 0 = rigid), aAO (float 0..1).
 * fadeNearPlayer: canopy/foreground occluders dither away around the player on screen.
 */
export function createAsciiObjectMaterial(U, { fadeNearPlayer = false, side = THREE.FrontSide, rigid = false } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...pickShared(U, SHARED),
      uPlayerScreen: U.uPlayerScreen,
      uResolution: U.uResolution,
      uFadeOn: { value: fadeNearPlayer ? 1 : 0 },
      uBoneTex: U.uBoneTex ?? { value: null }, // rigid batches' bone matrices (RIGID_VERT_GLSL)
      // the living world's wind (WIND_GLSL; an older uniforms object without it: the wind is off)
      uWind: U.uWind ?? { value: new THREE.Vector4(0, 0, 0, 0) },
      uWindFronts: U.uWindFronts ?? { value: Array.from({ length: WIND_FRONTS_LEN }, () => new THREE.Vector4()) },
    },
    vertexShader: /* glsl */ `
      ${COMMON_GLSL}
      ${RIGID_VERT_GLSL}
      ${WIND_GLSL}
      attribute vec3 aCol;
      attribute float aFlag;
      attribute float aSway;
      attribute float aAO;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vCol;
      varying float vFlag;
      varying float vAO;
      void main() {
        mat4 mm = rigidMatrix();
        vec4 wp = mm * vec4(position, 1.0);
        float s = aSway;
        if (!windOn()) {
          // (the living world's wind off: exactly the old sway)
          wp.x += (sin(uTime * 0.9 + wp.z * 0.15 + wp.x * 0.05) * 0.6 + sin(uTime * 2.1 + wp.x * 0.4) * 0.25) * 0.14 * s;
          wp.z += cos(uTime * 0.7 + wp.x * 0.13) * 0.08 * s;
        } else if (s > 0.0) {
          // the shared wind: lean and rock along it by its strength here; a front passing this point
          // bends the bough further and stirs it crosswise (the upwind side of a canopy goes first)
          vec4 Tr = uWindFronts[WIND_SLOTS * 2 + 3]; // lean, rock, front, stir
          vec2 wd = windDirAt(wp.xz);
          float spN = uWind.z / (uWind.z + 2.5);
          vec2 fd;
          float edge;
          float fk = windFronts(wp.xz, fd, edge);
          float rock = sin(uTime * 0.9 + wp.z * 0.15 + wp.x * 0.05) * 0.6 + sin(uTime * 2.1 + wp.x * 0.4) * 0.25;
          float stir = sin(uTime * 3.4 + wp.y * 1.7 + wp.x * 0.9) + 0.5 * sin(uTime * 5.3 + wp.z * 1.3);
          vec2 d = wd * (spN * (Tr.x + Tr.y * rock)) + fd * (fk * Tr.z) + vec2(-fd.y, fd.x) * (stir * fk * Tr.w);
          wp.xz += d * s;
        }
        vW = wp.xyz;
        vN = normalize(mat3(mm) * normal);
        vCol = aCol;
        vFlag = aFlag;
        vAO = aAO;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_GLSL}
      uniform vec4 uPlayerScreen;
      uniform vec2 uResolution;
      uniform float uFadeOn;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vCol;
      varying float vFlag;
      varying float vAO;
      void main() {
        if (uFadeOn > 0.5) {
          vec2 sp = gl_FragCoord.xy / uResolution;
          vec2 d = (sp - uPlayerScreen.xy) * vec2(uResolution.x / uResolution.y, 1.0);
          float viewDepth = 1.0 / gl_FragCoord.w;
          if (viewDepth < uPlayerScreen.z - 1.5) {
            float t = smoothstep(0.17, 0.07, length(d));
            if (bayer4(gl_FragCoord.xy * 0.5) < t * 0.92) discard;
          }
        }
        vec3 n = normalize(gl_FrontFacing ? vN : -vN);
        float sh = shadowAt(vW + n * 0.18);
        vec3 L = lightAt(vW, n, 0.3, sh);
        vec3 col = vCol * L * vAO;
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, vFlag);
      }
    `,
    side,
    blending: THREE.NoBlending,
  });
  rigidCapable(mat, rigid);
  return mat;
}

/**
 * A world material whose vertex shader places each vertex with `rigidMatrix()`: a geometry without
 * `aRigid` reads 0 = the mesh's own modelMatrix, so one program draws a set's merged static mesh and
 * the batched breakables (world/destructibles.js). Only a material built with `rigid: true` is
 * tagged for `batchRigid` (a set's static material must never be picked up by an actor's batch).
 */
function rigidCapable(mat, rigid) {
  mat.defaultAttributeValues = { ...mat.defaultAttributeValues, aRigid: [0] };
  mat.index0AttributeName = 'position'; // an attribute without an array never sits on location 0
  if (rigid) mat.userData.rigid = true;
}

/**
 * Surface glyph material. Geometry needs `aGUV` (vec2, meters: x = around, y = along; glyphs
 * point toward +y). Use helpers in glyphGeometry.js to generate it.
 *
 * Options (all optional):
 *   base:  [r,g,b] dark "skin" between glyphs (linear)
 *   ink:   [r,g,b] glyph colour,  inkAlt: second glyph colour mixed per cell (altChance 0..1)
 *   glyphs: string of 4 chars ordered dark→bright, e.g. '.v^A' (picked by local lighting)
 *   cell:  [w,h] meters per glyph cell;  rowShift: 0.5 = brick/scale offset per row
 *   gain:  glyph brightness multiplier;  lumScale: how fast glyphs climb the 4-step ramp
 *   rim:   moon-coloured rim light strength (keeps silhouettes readable on dark grass)
 *   emissive: [r,g,b] crack glow colour (driven by uniforms.uGlow 0..1 at runtime)
 *   glowMask: 0..1 how much this part participates in uGlow
 *   side: THREE side;  flag: FLAG value (default FLAG.ART: creatures are converted to ASCII art)
 *   artGain: brightness of the smooth ASCII-art source (default 1): bright-inked bodies (the wyrm) use
 *          < 1 so the letter ramp keeps its mid tones instead of saturating to '@B&'
 *   outline: moonlit silhouette line strength, independent of ink (default 1.1) — keeps near-black
 *          parts (the hero's coat) readable on dark grass; 0 for large bodies (reads as plastic)
 *   glyphZoom: < 1 draws each glyph larger inside its cell (less atlas padding → denser, crisper
 *          rows of symbols; default 0.72)
 * Runtime uniforms you can animate: uGlow, uInkGlow (glyphs self-lit), uFlash (hit flash 0..1),
 * uDissolve (0..1, per-cell disintegration), uTint (multiplies ink), uWarn (vec4: rgb colour,
 * a = strength 0..1+) — a danger glow on glyphs and silhouette rim (red dodge-only tells).
 *
 * ascii: 'scales'|'strands'|'plates'|'smooth' — picks glyph ramp + cell defaults (SURFACE_SETS);
 *   `glyphs` / `cell` / `rowShift` still override. grid: true renders the part through the v0.2
 *   screen character grid instead (lit ink + encoded flow direction, decoded by the ASCII pass).
 *
 * Optional features (each compiles in only when its option is given; without them the shader and
 * the pixels are exactly the pre-existing ones). They apply to the crisp path, not `grid: true`.
 *   levels: ['', ".'", ':;', 'AV', 'A8BD', '80B@'] — 1..6 strings, dark → bright, each listing up to
 *          8 glyph VARIANTS for that light level; one variant is picked per cell by hash. A space
 *          (or '') is an empty cell. Overrides `glyphs`. Level = floor(clamp(light × lumScale +
 *          jitter) × count), the same mapping as the 4-glyph ramp, but the light is taken at the
 *          CELL CENTRE, so every glyph is drawn whole (the 4-glyph ramp picks per pixel and can cut
 *          a glyph in two at a light step; `levels: ['.', 'v', '^', 'A']` is that ramp, whole).
 *          Every glyph is checked with gi() (throws on a glyph missing from the world atlas).
 *   levelInk: [[r,g,b], ...] — ink colour per light level (dark → bright; the last repeats), e.g. a
 *          dim grey for the darkest level and near white for the brightest. Replaces `ink`
 *          (inkAlt still mixes in by chance). Works with `levels` or the 4-glyph ramp.
 *   glowAxis: [x,y,z] — OBJECT-space direction (glued to the part as it animates): uGlow (seams,
 *          warm tint) and uInkGlow concentrate on the side whose normal faces it, e.g. [0,-1,0]
 *          for a molten underside on one mesh. glowBias 0..1 (default 1) = how strictly (0 = even),
 *          glowRange [lo, hi] = band of cos(normal, axis) over which it fades in (default [0, 0.75]:
 *          nothing on surfaces at 90° or more, full from ~41° off the axis).
 *   inkAxis: [x,y,z] (alias inkAltAxis) — OBJECT-space direction: cells facing it pick `inkAlt`
 *          with chance inkAxisChance (default 0.6), fading to `altChance` elsewhere over inkRange
 *          (default [0, 0.75]), e.g. more orange alt glyphs on the lower flanks. Decided per cell
 *          (cell-centre normal), so a glyph is never half alt.
 *   crack: 'grid' (default: seams on the glyph cell borders) | 'voronoi' (irregular fissures from
 *          a 2D cellular noise on aGUV, width jittered per plate). crackScale = fissure plate size
 *          in glyph cells (default 2.5), crackWidth = width multiplier (default 1).
 *   seamAxis: 'both' (default) | 'y' | 'x' — 'y': seams run along aGUV y only (between columns:
 *          radiating veins without cross-hatching; use rowShift 0 so they stay continuous);
 *          'x': along aGUV x only (between rows). With crack 'voronoi' it stretches the plates 3×
 *          along that axis so most fissures follow it.
 */
export function createSurfaceGlyphMaterial(U, o = {}) {
  const set = o.ascii != null ? SURFACE_SETS[o.ascii] ?? SURFACE_SETS.scales : null;
  const g = [...(o.glyphs ?? set?.glyphs ?? '.v^A')].map(gi);
  while (g.length < 4) g.push(g[g.length - 1]);
  const asciiSet = o.grid && o.ascii != null ? ASCII_SETS[o.ascii] ?? 0 : -1;
  const feat = surfaceFeatures(o, o.cell ?? set?.cell ?? [0.22, 0.26]);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...pickShared(U, SHARED),
      ...pickShared(U, SURFACE_SHARED),
      uBoneTex: U.uBoneTex ?? { value: null }, // rigid batches' bone matrices (RIGID_VERT_GLSL)
      ...(o.wyrm != null ? pickShared(U, ['uCamRight', 'uCamUp']) : {}), // the wyrm source's key light
      ...(o.wyrm != null ? letGoUniforms(U) : {}), // the wyrm dissolves letter by letter (letGo.js)
      // the fire rising in the wyrm's throat (Dragon._applyMaterials): xyz = where the front of heat
      // is (world), w = its strength; shared by every wyrm material
      ...(o.wyrm != null
        ? {
            uWyrmHeat: (U.uWyrmHeat ??= { value: new THREE.Vector4(0, 0, 0, 0) }),
            uWyrmHeatFrom: (U.uWyrmHeatFrom ??= { value: new THREE.Vector4(0, 0, 0, 0) }),
            uGlowRise: { value: 0 }, // this material's share of the throat charge (WYRM_HEAT)
          }
        : {}),
      ...(o.heroArt != null ? pickShared(U, HERO_ART_SHARED) : {}),
      ...feat.uniforms,
      uAsciiSet: { value: asciiSet },
      uBase: { value: new THREE.Color(...(o.base ?? [0.016, 0.014, 0.016])) },
      uInk: { value: new THREE.Color(...(o.ink ?? [0.55, 0.5, 0.46])) },
      uInkAlt: { value: new THREE.Color(...(o.inkAlt ?? o.ink ?? [0.55, 0.5, 0.46])) },
      uAltChance: { value: o.altChance ?? 0 },
      uGlyphs: { value: new THREE.Vector4(g[0], g[1], g[2], g[3]) },
      uCell: { value: new THREE.Vector2(...(o.cell ?? set?.cell ?? [0.22, 0.26])) },
      uRowShift: { value: o.rowShift ?? set?.rowShift ?? 0.5 },
      uGain: { value: o.gain ?? 2.4 },
      uLumScale: { value: o.lumScale ?? 1.5 },
      uRim: { value: o.rim ?? 0.35 },
      uOutline: { value: o.outline ?? 1.1 },
      uGlyphZoom: { value: o.glyphZoom ?? 0.72 },
      uEmissive: { value: new THREE.Color(...(o.emissive ?? [1.0, 0.3, 0.05])) },
      uGlow: { value: 0 },
      uGlowMask: { value: o.glowMask ?? 1 },
      uInkGlow: { value: o.inkGlow ?? 0 },
      uFlash: { value: 0 },
      uDissolve: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uWarn: { value: new THREE.Vector4(1, 0.1, 0.05, 0) },
      uSeed: { value: o.seed ?? Math.random() * 97 },
      uFlag: { value: o.flag ?? FLAG.ART },
      uArtGain: { value: o.artGain ?? 1 },
    },
    vertexShader: /* glsl */ `
      ${RIGID_VERT_GLSL}
      attribute vec2 aGUV;
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vG;
#ifdef SG_AXIS
      varying vec3 vNO;
#endif
#ifdef SG_WYRM_MEMBRANE
      attribute float aEdge; // wing membrane: 0 inside -> 1 on the free trailing edge (membrane.js)
      attribute float aBone; // 0 on a finger / the arm edge -> 1 mid-panel
      varying float vEdge;
      varying float vBone;
#endif
#ifdef SG_HERO_ART
      attribute float aPart;
      varying float vPart;
#endif
      void main() {
        // the mesh's own matrix, or its bone's when it is drawn as part of a rigid batch
        mat4 mm = rigidMatrix();
        vec4 wp = mm * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(mm) * normal);
        vG = aGUV;
#ifdef SG_AXIS
        vNO = normal; // object space: glowAxis / inkAxis stay glued to the part
#endif
#ifdef SG_WYRM_MEMBRANE
        vEdge = aEdge;
        vBone = aBone;
#endif
#ifdef SG_HERO_ART
        vPart = aPart;
#endif
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_GLSL}
      uniform vec3 uBase;
      uniform vec3 uInk;
      uniform vec3 uInkAlt;
      uniform float uAltChance;
      uniform vec4 uGlyphs;
      uniform vec2 uCell;
      uniform float uRowShift;
      uniform float uGain;
      uniform float uLumScale;
      uniform float uRim;
      uniform float uOutline;
      uniform float uGlyphZoom;
      uniform vec3 uEmissive;
      uniform float uGlow;
      uniform float uGlowMask;
      uniform float uInkGlow;
      uniform float uFlash;
      uniform float uDissolve;
      uniform vec3 uTint;
      uniform vec4 uWarn;
      uniform float uSeed;
      uniform float uFlag;
      uniform float uArtSolid;
      uniform float uArtHeroEdge;
      uniform float uArtHeroKey;
      uniform float uArtGain;
      uniform float uAsciiSet;
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vG;
#ifdef SG_LEVELS
      uniform vec4 uLvGlyph[12]; // 6 levels x 8 variants (2 vec4 per level), -1 = empty cell
      uniform float uLvCount[6];
      uniform float uLvN;
#endif
#ifdef SG_AXIS
      varying vec3 vNO;
      // 0..1: how squarely the visible side of object-space normal no faces axis, over cosine band r
      float sgAxisW(vec3 no, vec3 axis, vec2 r) {
        no = (gl_FrontFacing ? no : -no) * inversesqrt(max(dot(no, no), 1e-12));
        return smoothstep(r.x, r.y, dot(no, axis));
      }
#endif
#ifdef SG_GLOW_AXIS
      uniform vec3 uGlowAxis;
      uniform float uGlowBias;
      uniform vec2 uGlowRange;
#endif
#ifdef SG_HERO_ART
      uniform vec3 uArtFill;
      uniform vec2 uArtSpec;
      uniform float uArtRim;
      uniform float uArtGlowK;
      uniform float uArtSub;
      uniform float uArtOwn;
      uniform float uArtPart;
      uniform vec4 uBossPrint;
      uniform vec4 uBossHero;
      uniform vec3 uCamRight;
      uniform vec3 uCamUp;
      uniform vec4 uArtHeroLight;
      uniform vec3 uArtHeroRim;
      uniform vec3 uArtHeroCel;
      uniform float uHeroSolid;
      varying float vPart;
#endif
#ifdef SG_HERO_FOLDS
      uniform vec3 uArtFold;
#endif
#ifdef SG_INK_AXIS
      uniform vec3 uInkAxis;
      uniform float uInkAxisChance;
      uniform vec2 uInkRange;
#endif
#if defined(SG_LEVEL_INK) || defined(SG_INK_AXIS)
  #ifdef SG_LEVEL_INK
      uniform vec3 uLevelInk[6];
      vec3 sgInk(float li) { return uLevelInk[int(clamp(li, 0.0, 5.0))]; }
  #else
      vec3 sgInk(float li) { return uInk; }
  #endif
#endif
#if defined(SG_LEVELS) || defined(SG_INK_AXIS)
      // Screen-pixel offset from this fragment to the centre of its glyph cell. Per-cell choices
      // (level, alt ink) use values extrapolated there with screen derivatives, so one cell never
      // draws half of one glyph and half of another. Derivatives come from the unshifted aGUV
      // (continuous across rows); the clamp keeps grazing silhouettes sane.
      vec2 sgToCentre(vec2 g, vec2 cell) {
        vec2 gu = vG / uCell;
        vec2 gx = dFdx(gu), gy = dFdy(gu);
        vec2 dc = cell + 0.5 - g;
        float det = gx.x * gy.y - gx.y * gy.x;
        vec2 sp = abs(det) > 1e-12 ? vec2(dc.x * gy.y - dc.y * gy.x, gx.x * dc.y - gx.y * dc.x) / det : vec2(0.0);
        return clamp(sp, -64.0, 64.0);
      }
#endif
#ifdef SG_VORONOI
      uniform vec2 uCrackCell;
      uniform float uCrackK;
      vec2 sgHash22(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.xx + p3.yz) * p3.zy);
      }
      // cheap 2D cellular noise: x = F2 - F1 (0 on a fissure), y = hash of the nearest plate
      vec2 sgCells(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        float d1 = 8.0, d2 = 8.0;
        vec2 id = i;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 o = vec2(float(x), float(y));
            vec2 r = o + 0.12 + 0.76 * sgHash22(i + o + uSeed) - f;
            float d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; id = i + o; } else if (d < d2) { d2 = d; }
          }
        }
        return vec2(sqrt(d2) - sqrt(d1), hash12(id + uSeed * 1.7));
      }
#endif
#ifdef SG_WYRM
      // ---- wyrm ASCII-art source (option wyrm; see wyrmFeatures). The owner's reference dragon:
      // dark charcoal hide of overlapping shingle scales whose free edges catch the light, molten
      // fissures and glowing gaps on the chest / throat / undersides, crimson torn membranes.
      ${LET_GO_GLSL}
      uniform vec4 uWyrmHeat;
      uniform vec4 uWyrmHeatFrom;
      uniform float uGlowRise;
      uniform vec2 uWScale;
      uniform vec4 uWShape;
      uniform vec4 uWTip;
      uniform vec4 uWTone;
      uniform vec2 uWGap;
      uniform vec3 uWInk;
      uniform vec3 uWRimInk;
      uniform vec4 uWLight;
      uniform vec3 uWKey;
      uniform float uWEnvSat;
      uniform vec3 uCamRight;
      uniform vec3 uCamUp;
      uniform vec4 uWVein;
      uniform vec4 uWCrack;
      uniform float uWVary;
      uniform vec3 uWEmit;
      uniform vec2 uWGlow;
      uniform vec4 uWUnder;
  #ifdef SG_WYRM_MEMBRANE
      uniform vec4 uWMem;
      uniform vec3 uWMemBone;
      varying float vEdge;
      varying float vBone;
  #endif
      float wNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
        float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      vec2 wHash22(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.xx + p3.yz) * p3.zy);
      }
      // Overlapping shingle scales in scale units (p = aGUV / size, tips toward -y), rows offset by
      // half a scale. Each visible scale is a pointed diamond: its lower V is its own free edge (a
      // bright rim), its upper half lies under the two scales above, whose edges shade it (the black
      // gap). Rim and gap stay at least ~one letter cell wide on screen (the art pass averages 4
      // samples per 5 x 8 px cell), and scales smaller than ~1.5 letters fade to a dim mean (at a
      // distance they would only alias into noise). Each plate is shaded like a convex scale: dark
      // under the overlap, lighter toward its free edge. Returns x = value (gap .. rim), y = gap mask;
      // rimT = the free edge's tangent in p space (xy) and the rim mask (z), for the stroke glyphs.
      // The free (tip) edge of a scale above its row bottom: a pointed leaf, steeper at the sides.
      float wEdge(float ax) { return -0.45 + 1.15 * ax + 2.4 * ax * ax * ax; }
      float wEdgeD(float ax) { return 1.15 + 7.2 * ax * ax; }
      // Screen direction of the p-space direction t (p = aGUV-derived coords): the stroke glyph code
      // the art pass draws there: 1 '-', 2 '/', 3 '|', 4 '\\' (screen y up)
      float wStroke(vec2 t, vec2 jx, vec2 jy) {
        float det = jx.x * jy.y - jy.x * jx.y;
        if (abs(det) < 1e-14) return 0.0;
        vec2 s = vec2(t.x * jy.y - jy.x * t.y, jx.x * t.y - t.x * jx.y) / det;
        float a = mod(atan(s.y, s.x), 3.14159265);
        return 1.0 + mod(floor(a / 0.7853982 + 0.5), 4.0);
      }
      // sInfo: the scale the point lies on (its grid id xy, its hash z) and the distance to its gap in
      // gap widths (w): the molten cracks pick scales and glow a few gap widths around the gap
      vec2 wScales(vec2 p, out vec3 rimT, out vec4 sInfo) {
        float ppx = max(max(length(dFdx(p)), length(dFdy(p))), 1e-6); // scale units per pixel
        float rimW = max(uWTone.w, 4.5 * ppx);
        float gapW = max(uWGap.x, uWGap.y * ppx);
        float lod = smoothstep(0.11, 0.2, ppx); // fades as a scale shrinks from ~9 to ~5 px across
        // a slow warp: rows wobble and scales vary a little, hand-drawn rather than a fishnet lattice
        p += (vec2(wNoise(p * 0.31 + uSeed), wNoise(p.yx * 0.27 + uSeed + 7.7)) - 0.5) * vec2(0.5, 0.36);
        float row = floor(p.y);
        float px = p.x + 0.5 * mod(row, 2.0);
        vec2 f = vec2(fract(px) - 0.5, p.y - row);
        float ax = abs(f.x);
        float eC = wEdge(ax), eO = wEdge(0.5 - ax); // this row's / the offset rows' edge here
        float dOwn = f.y - eC; // > 0: on this row's scale (above its free edge)
        float dUp = f.y - 1.0 - eO; // > 0: on the upper row's scale (it lies on top)
        float xo = floor(p.x + 0.5 * mod(row + 1.0, 2.0)); // the offset rows' scale index here
        float dIn, dCov; // above its own free edge / below the edge of the scale covering it
        float axl; // |x| from the centre line of the scale the point is on
        vec2 id, tg;
        if (dUp > 0.0) { dIn = dUp; dCov = 2.0 + eC - f.y; axl = 0.5 - ax; id = vec2(xo, row + 1.0); tg = vec2(f.x > 0.0 ? -1.0 : 1.0, wEdgeD(0.5 - ax)); }
        else if (dOwn > 0.0) { dIn = dOwn; dCov = -dUp; axl = ax; id = vec2(floor(px), row); tg = vec2(f.x > 0.0 ? 1.0 : -1.0, wEdgeD(ax)); }
        else { dIn = f.y + 1.0 - eO; dCov = -dOwn; axl = 0.5 - ax; id = vec2(xo, row - 1.0); tg = vec2(1.0, 0.0); }
        float hs = hash12(id + uSeed * 0.37);
        sInfo = vec4(id, hs, mix(dCov / max(gapW, 1e-4), 9.0, lod)); // (no cracks once scales alias)
        float t = clamp(dCov / max(dCov + dIn, 1e-4), 0.0, 1.0); // 0 under the overlap .. 1 at its edge
        float body = uWTone.y * (1.0 + uWVary * (hs - 0.5)) * (0.3 + 0.7 * t * t);
        // the free edge catches the light most at its tip: a bright chevron per scale that fades
        // toward the shoulders (a continuous rim drew a fishnet lattice over the hide)
        float rim = (1.0 - smoothstep(0.0, rimW, dIn)) * (1.0 - 0.8 * smoothstep(0.16, 0.46, axl)) * (0.55 + 0.45 * fract(hs * 7.3));
        float gap = 1.0 - smoothstep(0.0, gapW, dCov);
        float v = mix(mix(body, uWTone.z * (0.8 + 0.4 * hs), rim), uWTone.x, gap);
        rimT = vec3(tg, rim * (1.0 - gap) * (1.0 - lod));
        return mix(vec2(v, gap), vec2(uWTone.y * 0.7 + uWTone.z * 0.05, 0.2), lod);
      }
      // molten fissures: a voronoi net (p in plate units) of which only a share of the edges glow,
      // so the cracks branch and break off instead of closing into cells; w = width in plate units
      float wVeins(vec2 p, float share, float w) {
        vec2 i = floor(p), f = fract(p);
        float d1 = 8.0, d2 = 8.0;
        vec2 id1 = i, id2 = i;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 o = vec2(float(x), float(y));
            vec2 r = o + 0.15 + 0.7 * wHash22(i + o + uSeed) - f;
            float d = dot(r, r);
            if (d < d1) { d2 = d1; id2 = id1; d1 = d; id1 = i + o; }
            else if (d < d2) { d2 = d; id2 = i + o; }
          }
        }
        float on = step(hash12(id1 + id2 + uSeed * 0.71), share);
        return on * (1.0 - smoothstep(w * 0.5, w, sqrt(d2) - sqrt(d1)));
      }
      void wyrmMain() {
        vec3 n = normalize(gl_FrontFacing ? vN : -vN);
        float sh = shadowAt(vW + n * 0.1);
        vec3 V = normalize(uCamPos - vW);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        // key light fixed to the camera (uWKey: screen right, screen up, toward the viewer)
        vec3 kd = uCamRight * uWKey.x + uCamUp * uWKey.y + V * uWKey.z;
        float key = max(dot(n, kd * inversesqrt(max(dot(kd, kd), 1e-8))), 0.0);
        // the lava's light comes from below but wraps up the flanks (the reference's lower scales are
        // rimmed orange, the upper ones silver)
        // the blue moon (and ambient) is desaturated toward its own brightness (uWEnvSat 0 = grey):
        // the reference's hide, horns and bones are neutral to warm greys, never lavender; fire light
        // keeps its colour
        float ndl = max((dot(n, uMoonDir) + 0.25) / 1.25, 0.0);
        vec3 env = ambientAt(n) + uMoonColor * (ndl * sh + fres * uWLight.z);
        env = mix(vec3(luma(env)), env, uWEnvSat) + pointLights(vW, n, 0.25);
        vec3 light = env + vec3(1.0, 0.95, 0.9) * key * uWLight.y
          + uWLight.w + uWUnder.rgb * uWUnder.a * clamp((0.35 - n.y) / 1.35, 0.0, 1.0);
        // 'down' scales (uWShape.x 1: the barrel) hang from the dorsal line toward the belly like
        // roof tiles: rows run along the body, tips toward larger |aGUV x| (around the body)
        vec2 gp = uWShape.x > 0.5 ? vec2(vG.y, -abs(vG.x)) : vG;
        vec2 gs = gp / max(uWScale, vec2(1e-4));
        vec2 jx = dFdx(gs), jy = dFdy(gs);
        vec3 rimT = vec3(0.0);
        vec4 sInfo = vec4(0.0, 0.0, 0.0, 9.0);
        vec2 sc = uWScale.x > 0.0 ? wScales(gs, rimT, sInfo) : vec2(1.0, 0.0);
        // stroke glyph code for the art pass (alpha = flag + 0.01 x code): scale rims draw '\ /'
        // along their edge (the reference's scale outlines), thin parts (uWShape.y 2: spikes, claws,
        // bones) draw strokes along their length
        float stroke = 0.0;
        float axisS = wStroke(vec2(0.0, 1.0), dFdx(vG), dFdy(vG));
        // thin parts: strokes along their silhouette (outlined horns and claws with letters inside;
        // a wide horn filled with strokes read as a hatched plank); uWShape.z = fresnel threshold
        if (uWShape.y > 1.5 && fres >= uWShape.z) stroke = axisS;
        else if (uWShape.y > 0.5 && uWShape.y < 1.5 && rimT.z > 0.5) stroke = wStroke(rimT.xy, jx, jy);
        float hot = uGlow * uGlowMask;
        // the fire rising in the throat (WYRM_HEAT): the charge's glow fills from the deep chest out
        // to the front, which is a little hotter and shows through the gaps between the scales
        float rise = 0.0, fill = 1.0;
        if (uWyrmHeat.w > 0.0) {
          float rf = distance(uWyrmHeat.xyz, uWyrmHeatFrom.xyz);
          fill = mix(1.0, 1.0 - smoothstep(rf - ${WYRM_HEAT.soft.toFixed(2)}, rf + ${(WYRM_HEAT.soft * 0.3).toFixed(2)}, distance(vW, uWyrmHeatFrom.xyz)), uWyrmHeat.w);
          vec3 hd = (vW - uWyrmHeat.xyz) / ${WYRM_HEAT.radius.toFixed(2)};
          rise = uWyrmHeatFrom.w * exp(-dot(hd, hd));
        }
        hot += uGlowRise * uGlowMask * fill * (1.0 + ${WYRM_HEAT.glow.toFixed(2)} * rise);
        // horns, spikes, claws (aGUV y = distance from the root): dark roots, bright tips, molten
        // roots on the glowing spines (uWTip: tip ramp from .x to .y, value at the root .z, root glow .w)
        float tipT = smoothstep(uWTip.x, uWTip.y, vG.y);
        sc.x *= mix(uWTip.z, 1.0, tipT);
        vec3 col = mix(uWInk, uWRimInk, clamp(rimT.z, 0.0, 1.0)) * uTint * (light * uWLight.x + uInkGlow) * sc.x;
        col += uWEmit * hot * uWTip.w * (1.0 - tipT);
  #ifdef SG_WYRM_MEMBRANE
        // tears glued to the membrane (aGUV): a few holes inside, a ragged trailing edge
        float tn = wNoise(vG * uWMem.z) * 0.6 + wNoise(vG * uWMem.z * 2.9 + 5.3) * 0.4;
        if (tn > 0.94 - uWMem.w * smoothstep(0.45, 1.0, vEdge)) discard;
        // dark mottled patches (the reference's sails are blotched deep red and near black, never a
        // flat field), darker toward the torn edge, embers along the bones, sparse ember specks
        float mo = wNoise(vG * 0.75 + 11.3) * 0.65 + wNoise(vG * 2.4 + 3.1) * 0.35;
        col *= mix(1.0 - uWMem.x, 1.0 + 0.5 * uWMem.x, smoothstep(0.32, 0.68, mo)) * (1.0 - 0.45 * smoothstep(0.5, 1.0, vEdge));
        float bone = 1.0 - smoothstep(0.0, uWMemBone.x, vBone);
        vec2 sq = vG / 0.075;
        float spk = step(1.0 - uWMem.y, hash12(floor(sq) + uSeed)) * step(0.36, mo) * (1.0 - smoothstep(0.22, 0.45, length(fract(sq) - 0.5))); // round embers, not squares
        col += uWEmit * (spk * (0.3 + 0.9 * hot) + bone * bone * (uWMemBone.y + uWMemBone.z * hot));
  #endif
        if (uWVein.x > 0.0 && hot > 0.001) {
          float vn = wVeins(vG / uWVein.w, uWVein.y, uWVein.z / uWVein.w);
          col += uWEmit * hot * uWVein.x * vn * (0.75 + 0.25 * sin(uTime * 2.3 + vG.y * 3.1));
        }
        // molten cracks in the scale gaps (the reference: jagged orange lines along the scale outlines on
        // the chest, throat, belly, inner legs and tail underside; none across the back): a smooth noise
        // over the scale grid picks winding runs of scales (its 0.5 isoline) plus a share of single ones,
        // and their gap glows, faded in on down-facing surfaces
        // (the glow spreads ~2.5 gap widths from the gap's middle: a thin hot core and a halo, wide
        // enough to light the letters across it, where the gap alone only nicked a pixel of them)
        float cg = 1.0 - smoothstep(0.0, 2.5, sInfo.w);
        if (uWCrack.x > 0.0 && hot > 0.001 && cg > 0.001) {
          float uw = smoothstep(uWCrack.z, uWCrack.w, -n.y);
          float nf = wNoise(sInfo.xy * 0.31 + uSeed * 1.3);
          float run = 1.0 - smoothstep(0.05, 0.11, abs(nf - 0.5));
          float one = step(1.0 - uWCrack.y, fract(sInfo.z * 13.17));
          col += uWEmit * hot * uWCrack.x * (cg * cg + sc.y) * 0.5 * max(run, one) * uw * (0.8 + 0.2 * sin(uTime * 2.3 + sInfo.z * 6.28));
        }
        col += uWEmit * hot * (uWGlow.x * sc.y + uWGlow.y);
        col += uWEmit * rise * (${WYRM_HEAT.gap.toFixed(2)} * sc.y + ${WYRM_HEAT.hide.toFixed(2)} * sc.x + ${WYRM_HEAT.flat.toFixed(3)});
        col += vec3(1.0, 0.92, 0.85) * uFlash * (0.15 + 0.6 * sc.x);
        col += uWarn.rgb * uWarn.a * (0.1 + 0.8 * sc.x + fres * 2.0);
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, uFlag + 0.01 * stroke);
      }
#endif

      // Grid mode: lit colour + (set, screen flow angle) packed into alpha for the ASCII pass.
      void asciiMain() {
        vec2 wc = floor(vG / vec2(0.3, 0.3));
        float h = hash12(wc + uSeed);
        if (uDissolve > 0.0 && h < uDissolve) discard;
        vec3 n = normalize(gl_FrontFacing ? vN : -vN);
        float sh = shadowAt(vW + n * 0.1);
        vec3 L = lightAt(vW, n, 0.25, sh);
        vec3 V = normalize(uCamPos - vW);
        float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0) * uRim;
        vec3 inkC = mix(uInk, uInkAlt, step(1.0 - uAltChance, fract(h * 7.31))) * uTint;
        // the rim floor (not scaled by ink) keeps near-black materials (the hero's coat) outlined
        vec3 col = inkC * (L * uGain * 0.55 + rim * uMoonColor * 1.5) + rim * uMoonColor * 0.12 + inkC * uInkGlow;
        col += uEmissive * uGlow * uGlowMask * (0.35 + 0.65 * step(0.72, fract(h * 3.7)));
        col += vec3(1.0, 0.92, 0.85) * uFlash * 0.8;
        col += uWarn.rgb * uWarn.a * (0.6 + rim * 2.0);
        col = applyFog(col, vW);
        // direction in which aGUV.y grows, in screen pixels (y up)
        vec2 gv = vec2(dFdx(vG.y), dFdy(vG.y));
        float ang = (dot(gv, gv) > 1e-10) ? atan(gv.y, gv.x) : 1.5707963;
        float a = fract(ang / 6.2831853 + 1.0);
        float ai = mod(floor(a * 24.0 + 0.5), 24.0);
        float code = uAsciiSet * 24.0 + ai;
        gl_FragColor = vec4(col, 0.04 + (code + 0.5) / 96.0 * 0.37);
      }

      void main() {
        if (uAsciiSet >= 0.0) { asciiMain(); return; }
        vec2 g = vG / uCell;
        g.x += step(1.0, mod(floor(g.y), 2.0)) * uRowShift;
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float h = hash12(cell + uSeed);
#ifdef SG_WYRM
        // the wyrm lets go a whole letter cell of the art grid at a time, once its letter has fallen
        if (uDissolve > 0.0 && uDissolve >= letGoAt(floor((gl_FragCoord.xy - uWyrmGrid.zw) / uWyrmGrid.xy)) + LG_WINDOW) discard;
#else
        if (uDissolve > 0.0 && h < uDissolve) discard;
#endif
#ifdef SG_WYRM
        if (uArtSolid * step(0.46, uFlag) * step(uFlag, 0.55) > 0.5) { wyrmMain(); return; } // wyrm art source
#endif

        vec3 n = normalize(gl_FrontFacing ? vN : -vN);
        float sh = shadowAt(vW + n * 0.1);
        vec3 L = lightAt(vW, n, 0.25, sh);
        vec3 V = normalize(uCamPos - vW);
        // ASCII-art source (FLAG.ART; FLAG.ART_HERO below 0.49): smooth shading for the art pass
        float artW = uArtSolid * step(0.46, uFlag) * step(uFlag, 0.55);
        float heroArt = artW * step(uFlag, 0.49);
        float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0) * uRim * (1.0 - heroArt);

        float lum = luma(L) * uLumScale + (h - 0.5) * 0.4;
#if defined(SG_LEVELS) || defined(SG_INK_AXIS)
        vec2 sp = sgToCentre(g, cell);
#endif
#ifdef SG_LEVELS
        // per-cell variants: the level follows the light at the cell centre (whole glyphs), the
        // variant is picked by the cell hash
        vec3 wC = vW + dFdx(vW) * sp.x + dFdy(vW) * sp.y;
        vec3 nC = vN + dFdx(vN) * sp.x + dFdy(vN) * sp.y;
        nC = (gl_FrontFacing ? nC : -nC) * inversesqrt(max(dot(nC, nC), 1e-12));
        float lumC = luma(lightAt(wC, nC, 0.25, shadowAt(wC + nC * 0.1))) * uLumScale + (h - 0.5) * 0.4;
        float li = clamp(floor(clamp(lumC, 0.0, 0.999) * uLvN), 0.0, 5.0);
        int lv = int(li);
        float nv = uLvCount[lv];
        int vi = lv * 8 + int(min(floor(fract(h * 13.37 + 0.31) * nv), nv - 1.0));
        float idx = uLvGlyph[vi / 4][vi % 4];
        vec2 fz = (f - 0.5) * uGlyphZoom + 0.5;
        vec2 gdx = dFdx(g) * uGlyphZoom;
        vec2 gdy = dFdy(g) * uGlyphZoom;
        float m = 0.0; // empty cell (index -1): only the dark base shows
        if (idx >= 0.0) m = smoothstep(0.2, 0.7, glyphGrad(idx, fz, gdx, gdy));
#else
        float li = floor(clamp(lum, 0.0, 0.999) * 4.0);
        float idx = li < 0.5 ? uGlyphs.x : li < 1.5 ? uGlyphs.y : li < 2.5 ? uGlyphs.z : uGlyphs.w;
        // glyph scaled up inside its cell + sharpened coverage: crisp symbols, not soft grey fill
        vec2 fz = (f - 0.5) * uGlyphZoom + 0.5;
        float m = smoothstep(0.2, 0.7, glyphGrad(idx, fz, dFdx(g) * uGlyphZoom, dFdy(g) * uGlyphZoom));
#endif

#if defined(SG_LEVEL_INK) || defined(SG_INK_AXIS)
  #ifdef SG_INK_AXIS
        // alt ink more likely where the cell-centre object-space normal faces uInkAxis
        vec3 nOC = vNO + dFdx(vNO) * sp.x + dFdy(vNO) * sp.y;
        float altP = mix(uAltChance, uInkAxisChance, sgAxisW(nOC, uInkAxis, uInkRange));
  #else
        float altP = uAltChance;
  #endif
        vec3 inkC = mix(sgInk(li), uInkAlt, step(1.0 - altP, fract(h * 7.31))) * uTint;
#else
        vec3 inkC = mix(uInk, uInkAlt, step(1.0 - uAltChance, fract(h * 7.31))) * uTint;
#endif
        // near-black gaps between glyphs: the body reads as arranged symbols, not a solid mesh
        vec3 base = uBase * (L * 0.7 + 0.01);
#ifdef SG_GLOW_AXIS
        // glow concentrated on the side facing uGlowAxis (object space), e.g. a molten underside
        float glowW = mix(1.0, sgAxisW(vNO, uGlowAxis, uGlowRange), uGlowBias);
        vec3 ink = inkC * (L * uGain + rim * uMoonColor * 2.0) + inkC * uInkGlow * glowW;
#else
        vec3 ink = inkC * (L * uGain + rim * uMoonColor * 2.0) + inkC * uInkGlow;
#endif
        // the hero's art source also gets a fixed key light from the camera's upper left
        ink += inkC * (heroArt * uArtHeroKey * max(dot(n, normalize(V + vec3(-0.5, 0.9, 0.0))), 0.0));
        // smooth shading reads as clean light-to-dark letter gradients
        vec3 col = mix(mix(base, ink, m), ink * uArtGain, artW);
        // moonlit silhouette line (not scaled by ink): a thin cool edge around the whole shape
        // (steep falloff: a wide one shades whole cones/flares grey and reads as a plastic mesh).
        // The hero's art source darkens toward its silhouettes instead (the reference's dim edges).
        float facing = max(dot(n, V), 0.0);
        float edgeL = pow(1.0 - facing, 6.0);
        col += uMoonColor * edgeL * uOutline * (0.35 + 0.65 * sh) * (1.0 - heroArt);
        col *= 1.0 - heroArt * uArtHeroEdge * (1.0 - facing) * (1.0 - facing);
#ifdef SG_HERO_ART
        // The hero's ink-line art source (the owner's reference: anime line art turned into ASCII):
        // a dim, flat fill per part (a soft key light from the camera's upper left + a share of the
        // scene light, so fire warms him and the moon cools him), white glints on metal, and a cool
        // blue-lavender rim on the screen's left. The art pass draws the bright ink lines itself, at
        // the part edges this material encodes in alpha (see HERO_ART).
        vec3 kd = normalize(V - uCamRight * 0.55 + uCamUp * 0.8);
        float kn = max(dot(n, kd), 0.0);
        // cel shading: a lit tone and a shadow tone with a short step between them
        kn = mix(kn, smoothstep(uArtHeroCel.x, uArtHeroCel.y, kn) * (0.55 + 0.45 * kn), uArtHeroCel.z);
        // the bosses printed the hero's way (ADR-194, uBossPrint; a human boss's rig only, never the
        // player's): his cloth / hair / plate fills are lifted to the hero's lit letter body (the colour
        // kept at y: 0 grey, 1 his own), and below his knee the cloth breaks into the hero's pale
        // dotted hem along a ragged line. The face, the eyes and what glows keep their own fill.
        vec3 artFill = uArtFill;
        float hemK = 0.0;
        float bossCloth = 0.0;
#ifndef SG_HERO_SELF
        if (uBossPrint.x > 0.5 && uArtOwn < 0.5) {
          float pidB = floor(uArtPart * 0.5 + 0.25);
          if (pidB > 2.5 && pidB < 16.5) {
            float mxB = max(max(uArtFill.r, uArtFill.g), max(uArtFill.b, 1e-3));
            vec3 hueB = uArtFill / mxB;
            float tl = 0.1 + 0.14 * min(dot(uArtFill, vec3(0.2126, 0.7152, 0.0722)) / 0.7, 1.0);
            vec3 fGrey = (vec3(tl * 0.65) + hueB * (tl * 0.4375)) * 1.8;
            vec3 fOwn = (vec3(tl * 0.425) + hueB * (tl * 1.6575)) * 1.5;
            artFill = mix(fGrey, fOwn, uBossPrint.y);
            // the hem: every part but the trousers, the hair, the plate and the crest (5, 11, 12, 15)
            if (abs(pidB - 5.0) > 0.5 && abs(pidB - 11.0) > 0.5 && abs(pidB - 12.0) > 0.5 && abs(pidB - 15.0) > 0.5) {
              float rag = sin(vW.x * 17.0 + vW.z * 5.0) * 0.6 + sin(vW.z * 23.0 - vW.x * 7.0) * 0.4;
              hemK = step(vW.y, uBossPrint.z + uBossPrint.w + 0.08 * rag);
              vec3 lav = vec3(0.486, 0.459, 0.675);
              artFill = mix(artFill, mix(lav, lav * 0.55 + hueB * 0.189, uBossPrint.y), hemK);
            }
            bossCloth = 1.0;
          }
        }
#endif
        vec3 fillC = artFill * (uArtHeroLight.x + uArtHeroLight.y * kn + L * uArtHeroLight.z);
#ifndef SG_HERO_SELF
        // shaded like the hero (ADR-220, uBossHero.x; a boss's cloth / hair / plate only): his own colours
        // and brightness where the key light (upper left) catches him and on his shoulders, falling off
        // toward dark marks on the shadow side and down his body, as the hero's cloak does (a grey upper
        // top over a dark body). The hem keeps its pale letters; his head and hat, the face, the eyes and
        // what glows: untouched.
        if (bossCloth > 0.5 && uBossHero.x > 0.0) {
          float shLit = smoothstep(0.12, 0.62, kn);
          float shUp = clamp((vW.y - uBossPrint.z - 0.55) / 1.0, 0.0, 1.0);
          float shHead = smoothstep(1.45, 1.6, vW.y - uBossPrint.z); // (his head and what he wears on it: as they are)
          float shK = max(max(shLit * mix(0.45, 1.0, shUp), hemK), shHead);
          fillC *= mix(1.0 - 0.85 * uBossHero.x, 1.0, shK);
        }
#endif
#ifdef SG_HERO_FOLDS
        // cloth folds (the reference's coat: dark fold streaks running down it between lit ridges):
        // bands across aGUV x that wander down y. The art pass prints a dark band as sparse letters
        // and draws a crease line on the lit side of each step. They fade out from 8 to 16 m, where a
        // band would be narrower than a letter (the game camera is 24–54 m away).
        float fph = vG.x * uArtFold.x + sin(vG.y * 6.0 + vG.x * 2.3) * uArtFold.z;
        float fdk = smoothstep(0.45, 0.9, sin(fph) * 0.5 + 0.5) * (1.0 - smoothstep(8.0, 16.0, length(uCamPos - vW)));
        fillC *= 1.0 - uArtFold.y * fdk;
#endif
        // drawn folds (model.js foldLines): the valley side of a fold field's ink line falls in shadow;
        // a plain sub-piece (aPart exactly 1) is left alone
        fillC *= 1.0 - uArtSub * smoothstep(0.5, 0.8, vPart) * step(vPart, 0.95);
        // glints from a light well off the view axis (upper left), only where the surface curves
        // (normal change per metre: domes, rims, cylinders): the reference's streaks of white on
        // the armour, never a whole flat plate lit up
        vec3 gd = normalize(V * 0.3 - uCamRight * 0.7 + uCamUp * 0.65);
        float curv = length(fwidth(vN)) / max(length(fwidth(vW)), 1e-5);
        fillC += vec3(pow(max(dot(n, normalize(gd + V)), 0.0), uArtSpec.y) * uArtSpec.x * uArtHeroLight.w * smoothstep(2.0, 7.0, curv));
        fillC += uArtHeroRim * (pow(1.0 - facing, 2.0) * smoothstep(0.05, 0.75, dot(n, -uCamRight)) * uArtRim);
        fillC = fillC * uTint + inkC * uInkGlow * uArtGlowK;
        col = mix(col, fillC, heroArt);
        if (uHeroSolid > 0.5) {
          // look-dev (Lab model viewer → Solid, U.uHeroSolid): the bare geometry, plain-lit and
          // untagged (alpha 0), so the ASCII pass passes it through and geometry problems show apart
          // from renderer ones. Clay grey tinted toward the part's hue; the two sub-pieces of a part
          // (aPart: panels, locks, lames) shade apart so they stay distinct; glowing parts keep a hint
          // (stays under the bloom threshold after the final pass's exposure: geometry, not glow)
          float mxF = max(max(uArtFill.r, uArtFill.g), uArtFill.b);
          vec3 albS = mix(vec3(0.3), uArtFill / max(mxF, 1e-3) * 0.3, 0.45) * (floor(vPart + 0.5) > 0.5 ? 0.72 : 1.0);
          vec3 kdS = normalize(V - uCamRight * 0.55 + uCamUp * 0.8);
          float dS = max(dot(n, kdS), 0.0);
          vec3 cS = albS * (0.1 + 0.05 * n.y + 0.85 * dS);
          cS += vec3(0.12) * pow(max(dot(n, normalize(kdS + V)), 0.0), 30.0) * min(uArtSpec.x, 1.0);
          cS += uArtHeroRim * pow(1.0 - facing, 3.0) * 0.12;
          cS += inkC * uInkGlow * uArtGlowK * 0.08;
          gl_FragColor = vec4(cS, 0.0);
          return;
        }
#endif

        // molten seams: thin hot cracks between scale rows/columns, the glyphs stay readable
#ifdef SG_VORONOI
        // irregular fissures between cellular plates; width jittered per plate, pulse per plate
        vec2 vc = sgCells(vG / uCrackCell);
        float edge = vc.x * uCrackK / mix(0.45, 1.6, vc.y);
        float seam = 1.0 - smoothstep(0.012, 0.075, edge);
        float pulse = 0.6 + 0.4 * sin(uTime * 3.3 + vc.y * 6.283);
#else
  #if defined(SG_SEAM_Y)
        float edge = min(f.x, 1.0 - f.x); // seams run along aGUV y (between columns) only
  #elif defined(SG_SEAM_X)
        float edge = min(f.y, 1.0 - f.y); // seams run along aGUV x (between rows) only
  #else
        float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  #endif
        float seam = 1.0 - smoothstep(0.012, 0.075, edge);
        float pulse = 0.6 + 0.4 * sin(uTime * 3.3 + h * 6.283);
#endif
#ifdef SG_GLOW_AXIS
        float hot = uGlow * uGlowMask * glowW;
#else
        float hot = uGlow * uGlowMask;
#endif
#ifdef SG_WYRM
        hot += uGlowRise * uGlowMask; // (the patterned look-dev render: the whole throat charge)
#endif
        col += uEmissive * hot * (seam * (1.0 - m) * 0.95 + (1.0 - m) * 0.03) * pulse;
        col = mix(col, col * vec3(1.2, 0.92, 0.8) + uEmissive * 0.06 * m, hot * 0.45);

        col += vec3(1.0, 0.92, 0.85) * uFlash * (0.25 + 0.75 * m);
        col += uWarn.rgb * uWarn.a * (0.08 + 0.9 * m + rim * 2.5);
        col = applyFog(col, vW);
#ifdef SG_HERO_ART
        gl_FragColor = vec4(col, HERO_A0 + (mix(uArtPart, 16.0, hemK) + floor(vPart + 0.5)) * HERO_AS);
#else
        gl_FragColor = vec4(col, uFlag);
#endif
      }
    `,
    side: o.side ?? THREE.FrontSide,
    blending: THREE.NoBlending,
  });
  if (Object.keys(feat.defines).length) mat.defines = feat.defines;
  // Rigid batching (rigidBatch.js): the vertex shader takes each vertex's matrix from the bone
  // texture when the geometry carries aRigid ≥ 1; a geometry without the attribute reads 0 = its own
  // modelMatrix. One program draws both (no material clone: the uniforms stay the shared objects).
  mat.userData.rigid = true;
  mat.defaultAttributeValues = { ...mat.defaultAttributeValues, aRigid: [0] };
  mat.index0AttributeName = 'position'; // an attribute without an array never sits on location 0
  // a hero geometry without the aPart attribute reads sub-id 0
  if (o.heroArt != null) mat.defaultAttributeValues.aPart = [0];
  return mat;
}

/**
 * Carved-glyph defaults (stones, boulders, flagstones). Ramps are 6 dark → bright levels, each a
 * string of 4 per-cell variants; a space is an empty cell (a dark gap). `topGlyphs` is used on
 * facets that face up (slab tops, caps), `sideGlyphs` on the rest. `crackGlyphs` and
 * `strokeGlyphs` are ordered by screen direction: horizontal, rising diagonal, vertical, falling
 * diagonal. Strokes hatch the mid-lit side facets along their contour (`/` on a rock's left flank,
 * `|` down a standing stone's side, `\` on the right flank), so every facet reads as a carved plane.
 */
export const CARVED_DEFAULTS = {
  sideGlyphs: [': ;.', ';:.,', ':;:-', '=;%:', '%#=&', '#8@%'],
  topGlyphs: ['.  .', '. ,.', ':-;.', '=:~;', '=%#-', '#=%&'],
  mossGlyphs: ',;"*',
  crackGlyphs: '-/|\\',
  strokeGlyphs: '-/|\\',
  strokeLevels: [2, 3],
  cell: [0.22, 0.28],
};
const CARVED_LEVELS = 6;

/**
 * THE SCRIPT WAVE (ADR-157; shaderLib.js uScript / uScriptF: only the Hall of Falling Script sets them).
 * Inside a prop's own silhouette (prop art) and on the floor (carved), the letters brighten in waves
 * that fall down each screen column of letters, the hue eased toward green with the strength; a
 * front (a ring round uScript.yz, radius uScript.w, width uScriptF.x) at uScriptF.y; uScriptF.z shifts
 * every letter that many cells sideways (deja vu's stutter). The whole of it is behind `uScript.x > 0 ||
 * uScriptF.y > 0` (and the shift behind uScriptF.z != 0): at 0 the shaders draw exactly what they did.
 *
 * `SCRIPT_GRID`: the prop letters' cell (px) and their grid's anchor (px), so a wave runs down a
 * column of letters and not across two. Shared by every prop material; the set that sets the wave
 * points its values at the pipeline's own vectors (pipeline.artCell, asciiMat uPropAnchor).
 */
export const SCRIPT_GRID = Object.freeze({ cell: { value: new THREE.Vector2(5, 8) }, anchor: { value: new THREE.Vector2(0, 0) } });
/** GLSL (after COMMON_GLSL): the strength at a world point, and one column's wave at a cell. */
const SCRIPT_GLSL = /* glsl */ `
uniform vec4 uScript;
uniform vec4 uScriptF;
const vec3 SCRIPT_GREEN = vec3(0.1, 1.0, 0.36);
float scriptK(vec3 wp) {
  float k = uScript.x;
  if (uScript.w > 0.0 && uScriptF.y > 0.0) {
    float d = abs(length(wp.xz - uScript.yz) - uScript.w);
    k = max(k, uScriptF.y * (1.0 - smoothstep(0.0, max(uScriptF.x, 0.01), d)));
  }
  return k;
}
// the wave at letter cell c (x: its column, y: its row, counted up the screen): x = the trail's
// light (1 at the head, falling off up the column), y = 1 on the head cell, z = the pass (a whole
// number that changes each time a head goes by: a letter re-rolls on it)
vec3 scriptWaveAt(vec2 c) {
  float hc = hash12(vec2(c.x, 7.13));
  float speed = 7.0 + 9.0 * hc;
  float period = 16.0 + 26.0 * fract(hc * 13.7);
  float s = (c.y + uTime * speed) / period + hc * 5.3;
  float ph = fract(s) * period;
  float trail = 3.0 + 6.0 * fract(hc * 31.1);
  return vec3(exp(-ph / trail), step(ph, 1.0), floor(s));
}
`;
/** GLSL (vertex): what the stutter's sideways shift needs. */
const SCRIPT_VERT = /* glsl */ `
uniform vec4 uScriptF;
uniform vec2 uScriptCell;
uniform vec2 uResolution;
`;
/** GLSL (vertex, after gl_Position): every letter `uScriptF.z` cells sideways (deja vu). */
const SCRIPT_SHIFT = /* glsl */ `
if (uScriptF.z != 0.0) gl_Position.x += uScriptF.z * uScriptCell.x * 2.0 / max(uResolution.x, 1.0) * gl_Position.w;
`;
/** The script wave's uniforms for a material (the shared ones; the set writes them). */
function scriptUniforms(U) {
  return {
    uScript: U.uScript ?? { value: new THREE.Vector4() },
    uScriptF: U.uScriptF ?? { value: new THREE.Vector4(2, 0, 0, 0) },
    uScriptCell: SCRIPT_GRID.cell,
    uScriptAnchor: SCRIPT_GRID.anchor,
  };
}

// (the dragon print's props and trees: render/dragonProps.js. Imported here, under names of their own, so
// another piece of this file may import the same modules without a clash)
import { DRAGON_PRINT_GLSL as DPP_PRINT_GLSL, dragonPrintUniforms as dppPrintUniforms } from './dragonPrint.js';
import { DRAGON_PRINT_FX_GLSL as DPP_FX_GLSL, DP_FX_U as DPP_FX_U } from './dragonPrintFx.js';
import { DP_PROPS, DP_TREES, DP_RELIEF_GLSL, DP_FX_PRELUDE_GLSL, DP_ENCODE_GLSL, dpPropsLook, dpTreesLook } from './dragonProps.js';

/**
 * Prop art source (FLAG.ART_PROP, ADR-100): the smooth lit image of a background object, which the
 * art pass prints in the wyrm's fine letters (a dark body, brighter letters where a face or an edge
 * catches the light, an outline of stroke glyphs). For static stone / metal / bone geometry baked in
 * world space: pillars, walls, standing stones, boulders, statues, the throne.
 *
 * Geometry attributes (the CarvedGlyph set, so a set's `stones` geometries need no change): position,
 * normal (flat facet normals read best: each facet is one tone), aCol (vec3 albedo, linear), aAO
 * (0..1), aEdge (0..1 edge band that catches the light). aMoss / aInk may be present and are ignored.
 *
 * Options: gain (source brightness, default 1), key (camera-fixed key light from the viewer's upper
 * left, default 0.5: the form reads the same from every side, like the wyrm's), edge (aEdge band
 * strength, default 1), fadeNearPlayer (dither away in front of the player), side.
 *
 * `dp` ('0' | 'a' | 'b', default the `?dpProps` switch, render/dragonProps.js): the DRAGON PRINT's source
 * instead (dragonPropFrag): a relief (chisel facets, bumps, cracks) lit by the moon and the shadow map
 * by the dragon ground's law, its ink in rgb and its tone in alpha. '0' draws exactly the source above.
 */
export function createPropArtMaterial(U, o = {}) {
  const hang = o.hang ?? null;
  const dpk = o.dp ?? dpPropsLook();
  const DP = DP_PROPS[dpk] ?? null;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...pickShared(U, SHARED),
      uPlayerScreen: U.uPlayerScreen,
      uResolution: U.uResolution,
      uCamRight: U.uCamRight,
      uCamUp: U.uCamUp,
      uFadeOn: { value: o.fadeNearPlayer ? 1 : 0 },
      uGain: { value: o.gain ?? 1 },
      uKey: { value: o.key ?? 0.5 },
      uEdge: { value: o.edge ?? 1 },
      uBoneTex: U.uBoneTex ?? { value: null }, // rigid batches' bone matrices (RIGID_VERT_GLSL)
      ...(hang ? hangUniforms(U, hang) : {}),
      ...scriptUniforms(U),
      ...(DP ? dragonPropUniforms(DP) : {}),
    },
    vertexShader: /* glsl */ `
      ${RIGID_VERT_GLSL}${hang ? HANG_VERT_GLSL : ''}
      ${SCRIPT_VERT}
      attribute vec3 aCol;
      attribute float aAO;
      attribute float aEdge;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vCol;
      varying float vAO;
      varying float vEdge;${DP ? DP_VARYINGS : ''}
      void main() {
        mat4 mm = rigidMatrix();
        vec4 wp = mm * vec4(position, 1.0);${hang ? HANG_MAIN_GLSL : ''}
        vW = wp.xyz;
        vN = normalize(mat3(mm) * normal);${hang ? HANG_NORMAL_GLSL : ''}
        vCol = aCol;
        vAO = aAO;
        vEdge = aEdge;${DP ? DP_VARYINGS_MAIN : ''}
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${SCRIPT_SHIFT}
      }
    `,
    fragmentShader: DP ? dragonPropFrag() : /* glsl */ `
      ${COMMON_GLSL}
      ${SCRIPT_GLSL}
      uniform vec2 uScriptCell;
      uniform vec2 uScriptAnchor;
      uniform vec4 uPlayerScreen;
      uniform vec2 uResolution;
      uniform vec3 uCamRight;
      uniform vec3 uCamUp;
      uniform float uFadeOn;
      uniform float uGain;
      uniform float uKey;
      uniform float uEdge;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vCol;
      varying float vAO;
      varying float vEdge;
      void main() {
        if (uFadeOn > 0.5) {
          vec2 sp = gl_FragCoord.xy / uResolution;
          vec2 d = (sp - uPlayerScreen.xy) * vec2(uResolution.x / uResolution.y, 1.0);
          float viewDepth = 1.0 / gl_FragCoord.w;
          if (viewDepth < uPlayerScreen.z - 1.5) {
            float t = smoothstep(0.17, 0.07, length(d));
            if (bayer4(gl_FragCoord.xy * 0.5) < t * 0.92) discard;
          }
        }
        vec3 n = normalize(gl_FrontFacing ? vN : -vN);
        float sh = shadowAt(vW + n * 0.12);
        vec3 L = lightAt(vW, n, 0.2, sh);
        // the key light: fixed to the camera, from the viewer's upper left (the wyrm's light)
        vec3 keyDir = normalize(-0.5 * uCamRight + 0.9 * uCamUp + cross(uCamRight, uCamUp));
        float key = max(dot(n, keyDir), 0.0);
        L += uMoonColor * uKey * key * key * (0.35 + 0.65 * sh);
        vec3 col = vCol * L * vAO * uGain;
        // an edge band catches the light: brighter letters along a chamfer or a rim
        col += vCol * vEdge * uEdge * (luma(L) + 0.08) * 0.9;
        // dragon fire scorches low stones; embers glow on them
        vec2 sc = scorchAt(vW.xz);
        float low = 1.0 - smoothstep(0.3, 1.4, vW.y);
        col *= 1.0 - sc.x * 0.55 * low;
        col += vec3(1.0, 0.28, 0.04) * sc.y * sc.y * low * 0.3;
        if (uScript.x > 0.0 || uScriptF.y > 0.0) {
          // THE SCRIPT WAVE (SCRIPT_GLSL): the letter cell this pixel prints in, its column's wave
          float k = scriptK(vW);
          vec3 w = scriptWaveAt(floor((gl_FragCoord.xy - uScriptAnchor) / max(uScriptCell, vec2(1.0))));
          float L = luma(col);
          col = mix(col, SCRIPT_GREEN * (L * 1.5 + 0.004), min(k, 1.0) * 0.85);
          col *= 1.0 + k * (2.4 * w.x + 2.6 * w.y);
          col += SCRIPT_GREEN * k * (0.012 * w.x + 0.03 * w.y);
        }
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, ${FLAG.ART_PROP.toFixed(2)});
      }
    `,
    side: o.side ?? THREE.DoubleSide,
    blending: THREE.NoBlending,
  });
  rigidCapable(mat, o.rigid === true);
  if (hang) mat.defaultAttributeValues = { ...mat.defaultAttributeValues, aHang: [0, 0] };
  if (DP) mat.userData.dragonPrint = dpk;
  return mat;
}

// ---- THE DRAGON PRINT's sources (render/dragonProps.js): a material hands the art pass its INK (rgb) and its
// TONE (alpha, inside the props' flag window), lit by the dragon ground's law on a relief of its own
/** GLSL (vertex): the piece's own position (the relief rides with it) and its turn into the world. */
const DP_VARYINGS = `
      varying vec3 vO;
      varying mat3 vR;`;
const DP_VARYINGS_MAIN = `
        vO = position;
        vR = mat3(mm);`;
/** The uniforms dragonPropFrag reads (a prop look of DP_PROPS). */
function dragonPropUniforms(P) {
  return {
    ...dppPrintUniforms(),
    ...DPP_FX_U,
    uDpRelief: { value: new THREE.Vector4(P.facet, P.size, P.bump, P.bumpF) },
    uDpCrack: { value: new THREE.Vector4(P.crack, P.crackK, P.crackDark, 0) },
    uDpLaw: { value: new THREE.Vector4(P.law[0], P.law[1], P.edge, P.ao) },
    uDpInk: { value: P.ink },
    uDpKey: { value: P.key },
  };
}
/**
 * GLSL (fragment, createPropArtMaterial's `dp`): the dragon ground's law (world/ground.js look b) on a prop.
 * The tone = how the relief's normal meets the moon (from uDpLaw.x to .y), x the shadow map, x a drifting
 * cloud's shade, + the fire's light; the ink = the body x (0.2 + 1.5 tone) x the light there, so a lit face
 * prints dense bright digits and a face turned away dim dots, like a crest and a trough of the ground. The
 * fx hooks (dpCloud, dpContact, dpRipple) reach it as they reach the ground.
 */
function dragonPropFrag() {
  return /* glsl */ `
      ${COMMON_GLSL}
      ${SCRIPT_GLSL}
      ${DPP_PRINT_GLSL}
      ${DP_FX_PRELUDE_GLSL}
      ${DPP_FX_GLSL}
      ${DP_RELIEF_GLSL}
      ${DP_ENCODE_GLSL}
      uniform vec2 uScriptCell;
      uniform vec2 uScriptAnchor;
      uniform vec4 uPlayerScreen;
      uniform vec2 uResolution;
      uniform float uFadeOn;
      uniform float uGain;
      uniform float uEdge;
      uniform vec4 uDpRelief;
      uniform vec4 uDpCrack;
      uniform vec4 uDpLaw;
      uniform float uDpInk;
      uniform float uDpKey;
      uniform vec3 uCamRight;
      uniform vec3 uCamUp;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vCol;
      varying float vAO;
      varying float vEdge;
      varying vec3 vO;
      varying mat3 vR;
      void main() {
        if (uFadeOn > 0.5) {
          vec2 sp = gl_FragCoord.xy / uResolution;
          vec2 d = (sp - uPlayerScreen.xy) * vec2(uResolution.x / uResolution.y, 1.0);
          float viewDepth = 1.0 / gl_FragCoord.w;
          if (viewDepth < uPlayerScreen.z - 1.5) {
            float t = smoothstep(0.17, 0.07, length(d));
            if (bayer4(gl_FragCoord.xy * 0.5) < t * 0.92) discard;
          }
        }
        vec3 n = normalize(gl_FrontFacing ? vN : -vN);
        // the relief, in the piece's own space (it rides with a carried or falling piece)
        vec3 no = normalize(transpose(vR) * n);
        float crack;
        vec3 s = dpStone(vO, no, uDpRelief, uDpCrack, crack);
        vec3 N = dpBump(n, vR * s);
        float sh = shadowAt(vW + n * 0.12);
        float cloud = dpCloud(vW.xz);
        vec3 PL = pointLights(vW + n * 0.05, N, 0.5);
        float t = clamp((dot(N, uMoonDir) - uDpLaw.x) / (uDpLaw.y - uDpLaw.x), 0.0, 1.0) * sh * cloud;
        // the camera-fixed key light (today's props' and the wyrm's, from the viewer's upper left): a face turned to
        // the camera but away from the moon still reads
        vec3 keyDir = normalize(-0.5 * uCamRight + 0.9 * uCamUp + cross(uCamRight, uCamUp));
        float key = max(dot(N, keyDir), 0.0);
        t = t * 0.85 + luma(PL) * 2.0 + uDpKey * key * key * (0.35 + 0.65 * sh);
        // a chamfer or a rim catches the moon; the hollows low on the piece stay dim
        t += vEdge * uEdge * uDpLaw.z * sh;
        t *= mix(1.0, vAO, uDpLaw.w);
        t *= 1.0 - crack * uDpCrack.z;
        float low = 1.0 - smoothstep(0.0, 0.6, vW.y);
        t *= 1.0 - dpContact(vW.xz) * low;
        float rip = dpRipple(vW.xz, hash13(floor(vO * 7.0)));
        t = clamp(t + rip * 0.35, 0.0, 1.0);
        vec3 L = ambientAt(N) + uMoonColor * (max(uMoonDir.y, 0.0) * 0.85 * sh) + PL; // (a cloud dims the tone only, as on the ground)
        vec3 col = vCol * uGain * (0.2 + 1.5 * t + rip * 0.8) * L * uDpInk;
        // dragon fire scorches low stones; embers glow on them
        vec2 sc = scorchAt(vW.xz);
        float lowS = 1.0 - smoothstep(0.3, 1.4, vW.y);
        col *= 1.0 - sc.x * 0.55 * lowS;
        t *= 1.0 - sc.x * 0.4 * lowS;
        col += vec3(1.0, 0.28, 0.04) * sc.y * sc.y * lowS * 0.3;
        if (uScript.x > 0.0 || uScriptF.y > 0.0) {
          // THE SCRIPT WAVE (SCRIPT_GLSL): the letter cell this pixel prints in, its column's wave
          float k = scriptK(vW);
          vec3 w = scriptWaveAt(floor((gl_FragCoord.xy - uScriptAnchor) / max(uScriptCell, vec2(1.0))));
          float Lc = luma(col);
          col = mix(col, SCRIPT_GREEN * (Lc * 1.5 + 0.004), min(k, 1.0) * 0.85);
          col *= 1.0 + k * (2.4 * w.x + 2.6 * w.y);
          col += SCRIPT_GREEN * k * (0.012 * w.x + 0.03 * w.y);
          t = clamp(t + k * (0.5 * w.x + 0.5 * w.y), 0.0, 1.0);
        }
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, dpEncode(t));
      }
    `;
}

/**
 * The dragon print for what the ascii-object material draws (render/dragonProps.js): the trees (FLAG.STONE trunks,
 * boughs and stumps: bark; FLAG.LEAF crowns: leaves) under `trees` (default the `?dpTrees` switch), the prop art
 * painted on a set's mesh (FLAG.ART_PROP: bones, the bonfire, the landmarks) under `props` (default `?dpProps`).
 * It IS createAsciiObjectMaterial (same options, same vertex shader: the wind's sway, the rigid batch), with two
 * varyings added for the relief and its own fragment; a part whose switch is off draws exactly that material's
 * source. Both off: createAsciiObjectMaterial itself is returned.
 */
export function createDragonObjectMaterial(U, o = {}) {
  const T = DP_TREES[o.trees ?? dpTreesLook()] ?? null;
  const P = DP_PROPS[o.props ?? dpPropsLook()] ?? null;
  const mat = createAsciiObjectMaterial(U, o);
  if (!T && !P) return mat;
  const vs = mat.vertexShader, a = 'varying vec3 vW;', b = 'vW = wp.xyz;';
  if (!vs.includes(a) || !vs.includes(b)) throw new Error('createDragonObjectMaterial: the ascii-object vertex shader has changed');
  mat.vertexShader = vs.replace(a, a + DP_VARYINGS).replace(b, b + DP_VARYINGS_MAIN);
  const t = T ?? DP_TREES.a, p = P ?? DP_PROPS.a;
  Object.assign(mat.uniforms, dragonPropUniforms(p), {
    uDpBark: { value: new THREE.Vector4(t.bark, t.barkF, t.furrow, t.inkBark) },
    uDpLeaf: { value: new THREE.Vector4(t.leaf, t.leafF, t.sprig, t.hollow) },
    uDpTreeLaw: { value: new THREE.Vector4(t.barkLaw[0], t.barkLaw[1], t.leafLaw[0], t.leafLaw[1]) },
    uDpTreeInk: { value: new THREE.Vector4(t.inkLeaf, t.ao, t.shade, t.key) },
    uCamRight: U.uCamRight ?? { value: new THREE.Vector3(1, 0, 0) },
    uCamUp: U.uCamUp ?? { value: new THREE.Vector3(0, 1, 0) },
  });
  mat.defines = { ...(mat.defines ?? {}), DP_T: T ? 1 : 0, DP_P: P ? 1 : 0 };
  mat.fragmentShader = /* glsl */ `
      ${COMMON_GLSL}
      ${DPP_PRINT_GLSL}
      ${DP_FX_PRELUDE_GLSL}
      ${DPP_FX_GLSL}
      ${DP_RELIEF_GLSL}
      ${DP_ENCODE_GLSL}
      uniform vec4 uPlayerScreen;
      uniform vec2 uResolution;
      uniform float uFadeOn;
      uniform vec4 uDpRelief;
      uniform vec4 uDpCrack;
      uniform vec4 uDpLaw;
      uniform float uDpInk;
      uniform vec4 uDpBark;
      uniform vec4 uDpLeaf;
      uniform vec4 uDpTreeLaw;
      uniform vec4 uDpTreeInk;
      uniform float uDpKey;
      uniform vec3 uCamRight;
      uniform vec3 uCamUp;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vCol;
      varying float vFlag;
      varying float vAO;
      varying vec3 vO;
      varying mat3 vR;
      void main() {
        if (uFadeOn > 0.5) {
          vec2 sp = gl_FragCoord.xy / uResolution;
          vec2 d = (sp - uPlayerScreen.xy) * vec2(uResolution.x / uResolution.y, 1.0);
          float viewDepth = 1.0 / gl_FragCoord.w;
          if (viewDepth < uPlayerScreen.z - 1.5) {
            float t = smoothstep(0.17, 0.07, length(d));
            if (bayer4(gl_FragCoord.xy * 0.5) < t * 0.92) discard;
          }
        }
        vec3 n = normalize(gl_FrontFacing ? vN : -vN);
        bool leaf = abs(vFlag - ${FLAG.LEAF.toFixed(2)}) < 0.02;
        bool bark = vFlag > 0.9;
        bool prop = abs(vFlag - ${FLAG.ART_PROP.toFixed(2)}) < 0.01;
        if (!((DP_T == 1 && (leaf || bark)) || (DP_P == 1 && prop))) {
          // (this part's switch is off: createAsciiObjectMaterial's source)
          float sh = shadowAt(vW + n * 0.18);
          vec3 L = lightAt(vW, n, 0.3, sh);
          vec3 col = vCol * L * vAO;
          col = applyFog(col, vW);
          gl_FragColor = vec4(col, vFlag);
          return;
        }
        // the relief, in the piece's own space (at rest: a crown keeps its clumps as it sways)
        vec3 no = normalize(transpose(vR) * n);
        float deep = 0.0;
        vec3 s = vec3(0.0), No = no;
        vec2 law;
        float ink, ao, wrap = 0.5, shade = 1.0, keyK = 0.0;
        if (leaf) {
          No = dpLeaf(vO, no, uDpLeaf.x, 1.0 / uDpLeaf.y, uDpLeaf.z, deep);
          deep *= uDpLeaf.w;
          law = uDpTreeLaw.zw; ink = uDpTreeInk.x; ao = uDpTreeInk.y; wrap = 0.7; shade = uDpTreeInk.z;
        } else if (bark) {
          s = dpBark(vO, no, uDpBark.x, uDpBark.y, deep);
          deep *= uDpBark.z;
          law = uDpTreeLaw.xy; ink = uDpBark.w; ao = uDpTreeInk.y; keyK = uDpTreeInk.w;
        } else {
          s = dpStone(vO, no, uDpRelief, uDpCrack, deep);
          deep *= uDpCrack.z;
          law = uDpLaw.xy; ink = uDpInk; ao = uDpLaw.w; keyK = uDpKey;
        }
        vec3 N = leaf ? normalize(vR * No) : dpBump(n, vR * s);
        float sh = mix(1.0, shadowAt(vW + n * 0.18), shade);
        float cloud = dpCloud(vW.xz);
        vec3 PL = pointLights(vW + n * 0.05, N, wrap);
        float t = clamp((dot(N, uMoonDir) - law.x) / (law.y - law.x), 0.0, 1.0) * sh * cloud;
        // the camera-fixed key light (today's props' and the wyrm's, from the viewer's upper left): a face turned to
        // the camera but away from the moon still reads
        vec3 keyDir = normalize(-0.5 * uCamRight + 0.9 * uCamUp + cross(uCamRight, uCamUp));
        float key = max(dot(N, keyDir), 0.0);
        t = t * 0.85 + luma(PL) * 2.0 + keyK * key * key * (0.35 + 0.65 * sh);
        t *= mix(1.0, vAO, ao);
        t *= 1.0 - deep;
        float low = 1.0 - smoothstep(0.0, 0.6, vW.y);
        t *= 1.0 - dpContact(vW.xz) * low;
        float rip = dpRipple(vW.xz, hash13(floor(vO * 7.0)));
        t = clamp(t + rip * 0.35, 0.0, 1.0);
        vec3 L = ambientAt(N) + uMoonColor * (max(uMoonDir.y, 0.0) * 0.85 * sh) + PL; // (a cloud dims the tone only, as on the ground)
        vec3 col = vCol * (0.2 + 1.5 * t + rip * 0.8) * L * ink;
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, leaf ? dpEncodeLeaf(t) : dpEncode(t));
      }
    `;
  mat.userData.dragonPrint = { trees: T ? (o.trees ?? dpTreesLook()) : '0', props: P ? (o.props ?? dpPropsLook()) : '0' };
  return mat;
}

/** The hanging pieces' uniforms (createPropArtMaterial `hang`: world/hangTuning.js HANG.shader). */
function hangUniforms(U, h) {
  return {
    uTime: U.uTime,
    uWind: U.uWind ?? { value: new THREE.Vector4(0, 0, 0, 0) },
    uWindFronts: U.uWindFronts ?? { value: Array.from({ length: WIND_FRONTS_LEN }, () => new THREE.Vector4()) },
    uHang: { value: new THREE.Vector4(h.lean ?? 0.5, h.half ?? 2.2, h.ripple ?? 0.07, h.rate ?? 5.5) },
    uHang2: { value: new THREE.Vector4(h.along ?? 2.2, h.down ?? 1.6, h.front ?? 2.4, h.wobble ?? 0.22) },
    // a blow's shock (world/hang.js hangKick, the living world's tremor): shared by every hanging
    // material, made with the first one (all zero: nothing is added)
    uHangKick: U.uHangKick ?? (U.uHangKick = { value: Array.from({ length: HANG_KICK_LEN }, () => new THREE.Vector4(0, 0, 0, 0)) }),
  };
}

/** Kick slots in uHangKick (world/hang.js writes them) x 2 vec4 each: (x, z, t0, amp rad), (reach m, decay 1/s, rate rad/s, speed m/s). */
export const HANG_KICKS = 2;
export const HANG_KICK_LEN = HANG_KICKS * 2;

/**
 * What hangs answers the wind (prop art with `hang`; world/hang.js): `aHang` x = m below the line the
 * vertex hangs from, y = its give (< 0: it swings as one piece on its line, a rope and its weight).
 * The air there (the prevailing wind and the fronts passing, the grass's own WIND_GLSL) leans it
 * downwind about its line (the drop swung through the lean, so it keeps its length) and runs a ripple
 * across it crosswise, travelling downwind; both grow with the drop. Only a piece standing at home and
 * upright moves (its bone's up axis vertical, its base on the ground): felled, carried or thrown, it
 * is still. The wind off (windOn() false): nothing is added, the program's result is the old one.
 */
const HANG_VERT_GLSL = /* glsl */ `
uniform float uTime;
${WIND_GLSL}
attribute vec2 aHang;
uniform vec4 uHang;  // lean (rad), half (drag for half of it), ripple (m), rate (rad/s)
uniform vec4 uHang2; // along (rad/m), down (rad/m), front (m/s per strength), wobble
uniform vec4 uHangKick[${HANG_KICK_LEN}]; // per kick: (x, z, t0, amp rad), (reach m, decay 1/s, rate rad/s, speed m/s)
bool hangKicked() {
  float k = 0.0;
  for (int i = 0; i < ${HANG_KICKS}; i++) k += uHangKick[i * 2].w;
  return k > 0.0;
}
// a blow's shock: the swing (rad, away from the blow along the returned way) it gives a piece at p now
vec2 hangKickAt(vec2 p) {
  vec2 kv = vec2(0.0);
  for (int i = 0; i < ${HANG_KICKS}; i++) {
    vec4 K = uHangKick[i * 2];
    if (K.w <= 0.0) continue;
    vec4 Q = uHangKick[i * 2 + 1];
    vec2 e = p - K.xy;
    float d = length(e);
    float f = max(0.0, 1.0 - d / max(Q.x, 0.1));
    float age = uTime - K.z - d / max(Q.w, 1.0);
    if (f <= 0.0 || age <= 0.0 || age * Q.y > 4.0) continue;
    kv += (d > 0.2 ? e / d : vec2(1.0, 0.0)) * (K.w * f * f * exp(-age * Q.y) * sin(age * Q.z));
  }
  return kv;
}
vec3 hangOffset(vec3 p, mat4 mm, vec3 n, inout vec3 tilt) {
  vec3 up = mm[1].xyz;
  float ul = length(up);
  float gate = ul > 1e-4 ? smoothstep(0.985, 0.998, up.y / ul) : 0.0;
  gate *= 1.0 - smoothstep(0.03, 0.12, abs(mm[3].y));
  if (gate <= 0.0) return vec3(0.0);
  float h = aHang.x, give = abs(aHang.y);
  // the shock of a blow nearby: a swing away from it that rings down (a paper strip, lighter, more)
  vec3 ko = vec3(0.0);
  vec2 kv = hangKickAt(mm[3].xz) * (aHang.y > 0.0 ? min(1.35, sqrt(give)) : 0.8);
  float ka = length(kv);
  if (ka > 1e-4) ko = vec3(kv.x / ka * sin(ka), 1.0 - cos(ka), kv.y / ka * sin(ka)) * h;
  vec2 fd;
  float edge;
  float fk = windFronts(p.xz, fd, edge);
  vec2 v = windDirAt(p.xz) * uWind.z + fd * (fk * uHang2.z);
  float s = length(v);
  if (s < 1e-4) return ko * gate;
  vec2 dir = v / s;
  // (each piece its own phase, from where it stands)
  float ph = fract(sin(dot(mm[3].xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
  // (drag grows with the square of the air: a breath barely stirs it, a gust takes it)
  float drag = s * give;
  float k = drag * drag / (drag * drag + uHang.y * uHang.y);
  float th = uHang.x * k * (1.0 + uHang2.w * (0.6 * sin(uTime * 0.83 + ph) + 0.4 * sin(uTime * 1.91 + ph * 1.7)));
  vec3 o = vec3(dir.x * sin(th), 1.0 - cos(th), dir.y * sin(th)) * h;
  if (aHang.y > 0.0) {
    float arg = dot(p.xz, dir) * uHang2.x + h * uHang2.y - uTime * uHang.w * sqrt(give) + ph;
    // (the ripple answers the air more readily than the lean: a slow draw still stirs the cloth)
    float a = uHang.z * (h / (h + 0.35)) * (drag / (drag + uHang.y)) * (1.0 + 0.8 * edge);
    vec3 side = vec3(-dir.y, 0.0, dir.x);
    o += side * (a * sin(arg));
    // the ripple's slope turns the cloth's facets (its letters change with the light: the ripple reads
    // face on, where its offset runs toward the eye)
    float c = a * cos(arg) * gate;
    tilt -= dot(n, side) * (vec3(dir.x, 0.0, dir.y) * (c * uHang2.x) - vec3(0.0, c * uHang2.y, 0.0));
  }
  return (o + ko) * gate;
}
`;
const HANG_MAIN_GLSL = /* glsl */ `
        vec3 hangTilt = vec3(0.0);
        if (aHang.x > 0.0 && (windOn() || hangKicked())) wp.xyz += hangOffset(wp.xyz, mm, normalize(mat3(mm) * normal), hangTilt);`;
const HANG_NORMAL_GLSL = /* glsl */ `
        vN = normalize(vN + hangTilt);`;

/**
 * Carved glyph material for rocks: crisp glyphs fixed on the stone, chosen by light (lit facets
 * dense, shadow sides sparse), over a dark slab of the stone's own hue, with world-fixed crack
 * lines, moss patches and moonlit chamfer edges. Renders directly (alpha = FLAG.NONE), so the
 * screen-grid ASCII pass leaves it alone.
 *
 * Glyph lattice: cells live on a plane perpendicular to the default camera view (fixed yaw,
 * `viewPitch`), anchored in WORLD space — upright, the same size on every facet and seam-free, but
 * they never re-pick as the camera moves or zooms (no swimming). Rows get random sideways offsets
 * so columns never line up into text. Only for static geometry baked in world space.
 *
 * Geometry attributes: position, normal (flat facet normals read best), aCol (vec3 albedo,
 * linear), aAO (0..1), aMoss (0..1 moss tendency), aInk (per-vertex ink multiplier, 1 = full),
 * aEdge (0..1 moonlit edge band, e.g. slab chamfers).
 *
 * Options (all optional): sideGlyphs / topGlyphs (ramps), mossGlyphs, crackGlyphs, strokeGlyphs
 * (4 each; see CARVED_DEFAULTS), strokeLevels [from, to] (ramp levels hatched with strokes; [9, 9]
 * turns hatching off), cell [w,h] lattice meters (keep >= ~6 screen px at the default camera),
 * viewPitch (rad, default 58° = CONFIG.camera.pitch), gain (ink brightness), lumScale (how fast
 * glyphs climb the ramp: level = 1 - exp(-light * lumScale), a soft knee so moonlit tops and
 * dimmer flanks both land on it), jitter (per-cell ramp randomness), inkFloor (keeps shadow-side
 * glyphs faintly visible), base (dark slab brightness vs ink), mossInk [r,g,b], crackAmount 0..1,
 * edge (chamfer line strength), glyphZoom, fadeNearPlayer (dither away in front of the player),
 * side (THREE side, default DoubleSide).
 *
 * THE DRAGON PRINT (`?dpFloor=a|b`, render/dragonFloor.js): the floor printed as the dragon ground is, on
 * the ground's own lattice (the ramps, strokes, cell and glyphZoom above are then unused; gain, crackAmount,
 * mossInk, edge-band attributes and the script wave still count). `dpFloor`: '0' | 'a' | 'b' (default:
 * the switch), `dp`: the set's own numbers (DP_FLOOR's keys).
 */
export function createCarvedGlyphMaterial(U, o = {}) {
  const dpLook = o.dpFloor != null ? ({ a: 1, b: 2 }[o.dpFloor] ?? 0) : dpFloorLook();
  const toRamp = (rows) => {
    const out = [];
    for (let l = 0; l < CARVED_LEVELS; l++) {
      const s = (rows[Math.min(l, rows.length - 1)] ?? ' ').padEnd(4, ' ');
      for (let v = 0; v < 4; v++) out.push(s[v] === ' ' ? -1 : gi(s[v]));
    }
    return out;
  };
  const four = (str) => {
    const g = [...str].map(gi);
    while (g.length < 4) g.push(g[g.length - 1]);
    return new THREE.Vector4(g[0], g[1], g[2], g[3]);
  };
  const pitch = o.viewPitch ?? (58 * Math.PI) / 180;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...pickShared(U, SHARED),
      uPlayerScreen: U.uPlayerScreen,
      uResolution: U.uResolution,
      uFadeOn: { value: o.fadeNearPlayer ? 1 : 0 },
      uLatU: { value: new THREE.Vector3(1, 0, 0) },
      uLatV: { value: new THREE.Vector3(0, Math.cos(pitch), -Math.sin(pitch)) },
      uCell: { value: new THREE.Vector2(...(o.cell ?? CARVED_DEFAULTS.cell)) },
      uSideRamp: { value: toRamp(o.sideGlyphs ?? CARVED_DEFAULTS.sideGlyphs) },
      uTopRamp: { value: toRamp(o.topGlyphs ?? CARVED_DEFAULTS.topGlyphs) },
      uMossGlyphs: { value: four(o.mossGlyphs ?? CARVED_DEFAULTS.mossGlyphs) },
      uCrackGlyphs: { value: four(o.crackGlyphs ?? CARVED_DEFAULTS.crackGlyphs) },
      uStrokeGlyphs: { value: four(o.strokeGlyphs ?? CARVED_DEFAULTS.strokeGlyphs) },
      uStrokeLevels: { value: new THREE.Vector2(...(o.strokeLevels ?? CARVED_DEFAULTS.strokeLevels)) },
      uMossInk: { value: new THREE.Color(...(o.mossInk ?? [0.03, 0.058, 0.028])) },
      uGain: { value: o.gain ?? 3.4 },
      uLumScale: { value: o.lumScale ?? 4.0 },
      uJitter: { value: o.jitter ?? 0.3 },
      uInkFloor: { value: o.inkFloor ?? 0.13 },
      uBase: { value: o.base ?? 0.12 },
      uCrack: { value: o.crackAmount ?? 1 },
      uEdge: { value: o.edge ?? 0 },
      uGlyphZoom: { value: o.glyphZoom ?? 0.72 },
      ...scriptUniforms(U),
      ...(dpLook ? dpFloorUniforms(dpLook, o.dp, pitch) : {}),
    },
    defines: { DP_FLOOR: dpLook },
    vertexShader: /* glsl */ `
      ${SCRIPT_VERT}
      attribute vec3 aCol;
      attribute float aAO;
      attribute float aMoss;
      attribute float aInk;
      attribute float aEdge;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vCol;
      varying float vAO;
      varying float vMoss;
      varying float vInk;
      varying float vEdge;
#if DP_FLOOR > 0
      attribute float aRim;
      varying float vRim;
#endif
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vCol = aCol;
        vAO = aAO;
        vMoss = aMoss;
        vInk = aInk;
        vEdge = aEdge;
#if DP_FLOOR > 0
        vRim = aRim;
#endif
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${SCRIPT_SHIFT}
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_GLSL}
      ${SCRIPT_GLSL}
      #define CG_LEVELS ${CARVED_LEVELS}
      uniform vec4 uPlayerScreen;
      uniform vec2 uResolution;
      uniform float uFadeOn;
      uniform vec3 uLatU;
      uniform vec3 uLatV;
      uniform vec2 uCell;
      uniform float uSideRamp[CG_LEVELS * 4];
      uniform float uTopRamp[CG_LEVELS * 4];
      uniform vec4 uMossGlyphs;
      uniform vec4 uCrackGlyphs;
      uniform vec4 uStrokeGlyphs;
      uniform vec2 uStrokeLevels;
      uniform vec3 uMossInk;
      uniform float uGain;
      uniform float uLumScale;
      uniform float uJitter;
      uniform float uInkFloor;
      uniform float uBase;
      uniform float uCrack;
      uniform float uEdge;
      uniform float uGlyphZoom;
      varying vec3 vW;
      varying vec3 vN;
      varying vec3 vCol;
      varying float vAO;
      varying float vMoss;
      varying float vInk;
      varying float vEdge;
#if DP_FLOOR > 0
      ${DP_FLOOR_GLSL}
#endif

      // smooth value noise on the lattice plane (cell-centre lookups keep each cell's glyph whole)
      float cgNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
        float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float pick4(vec4 g, float k) { return k < 0.5 ? g.x : k < 1.5 ? g.y : k < 2.5 ? g.z : g.w; }

      void main() {
        if (uFadeOn > 0.5) {
          vec2 sp = gl_FragCoord.xy / uResolution;
          vec2 d = (sp - uPlayerScreen.xy) * vec2(uResolution.x / uResolution.y, 1.0);
          float viewDepth = 1.0 / gl_FragCoord.w;
          if (viewDepth < uPlayerScreen.z - 1.5) {
            float t = smoothstep(0.17, 0.07, length(d));
            if (bayer4(gl_FragCoord.xy * 0.5) < t * 0.92) discard;
          }
        }
        vec3 n = normalize(gl_FrontFacing ? vN : -vN);
#if DP_FLOOR > 0
        ${DP_FLOOR_MAIN}
#else

        // world-fixed lattice on the view-aligned plane; each row slides by a random amount
        vec2 q = vec2(dot(vW, uLatU), dot(vW, uLatV));
        vec2 gc = q / uCell;
        float row = floor(gc.y);
        float shift = hash12(vec2(row, 41.7));
        vec2 g = vec2(gc.x + shift, gc.y);
        vec2 cell = floor(g);
        vec2 f = fract(g);
        vec2 cq = vec2(cell.x + 0.5 - shift, cell.y + 0.5) * uCell; // cell centre, lattice meters
        float h = hash12(cell);
        float vari = floor(fract(h * 13.37 + 0.31) * 4.0);

        float sh = shadowAt(vW + n * 0.12);
        vec3 L = lightAt(vW, n, 0.2, sh) * vAO;
        float lum = 1.0 - exp(-luma(L) * uLumScale) + (h - 0.5) * uJitter;
        float lvf = clamp(floor(lum * float(CG_LEVELS)), 0.0, float(CG_LEVELS - 1));
        int ri = int(lvf) * 4 + int(vari);
        bool top = n.y > 0.8;
        float idx = top ? uTopRamp[ri] : uSideRamp[ri];
        vec3 ink = vCol * uGain * vInk;

        // hatching: mid-lit side facets get strokes along their screen contour (left flank '/',
        // vertical side '|', right flank '\'); facets whose contour runs flat keep the ramp, so
        // no rows of dashes appear. ~1 cell in 4 keeps its ramp glyph to stay hand-made.
        vec2 ns = vec2(dot(n, uLatU), dot(n, uLatV));
        if (!top && lvf >= uStrokeLevels.x && lvf <= uStrokeLevels.y && length(ns) > 0.3 && fract(h * 5.71) > 0.25) {
          vec2 t = vec2(-ns.y, ns.x);
          float k = mod(floor(mod(atan(t.y, t.x), 3.14159265) / 0.7853982 + 0.5), 4.0);
          if (k > 0.5) idx = pick4(uStrokeGlyphs, k);
        }

        // moss: clumps on up-facing / low parts, dim green glyphs
        float mossN = cgNoise(cq * 1.7 + 3.1) * 0.8 + hash12(cell + 7.7) * 0.2;
        if (mossN > 1.0 - vMoss * 0.42) {
          idx = pick4(uMossGlyphs, min(lvf * 0.67, 3.0));
          ink = uMossInk * uGain;
        }

        // cracks: meandering iso-lines of a world-fixed noise, only in some regions. On tops they
        // are a line of stroke glyphs following the crack; on (hatched) sides a dark empty seam.
        float region = smoothstep(0.5, 0.7, cgNoise(cq * 0.42 + 11.0)) * uCrack;
        if (region > 0.0) {
          vec2 p = cq * 1.5 + 5.0;
          float c0 = cgNoise(p);
          vec2 gr = vec2(cgNoise(p + vec2(0.03, 0.0)) - c0, cgNoise(p + vec2(0.0, 0.03)) - c0) / 0.03 * 1.5;
          float dist = abs(c0 - 0.5) / max(length(gr), 1e-3);
          if (dist < uCell.x * 0.5 * region) {
            vec2 t = vec2(-gr.y, gr.x);
            float a = mod(atan(t.y, t.x), 3.14159265);
            idx = top ? pick4(uCrackGlyphs, mod(floor(a / 0.7853982 + 0.5), 4.0)) : -1.0;
            ink = vCol * uGain * vInk * 0.8;
          }
        }
#endif

        float sk = 0.0;
        vec3 sw = vec3(0.0);
        if (uScript.x > 0.0 || uScriptF.y > 0.0) {
          // THE SCRIPT WAVE (SCRIPT_GLSL) down the lattice's columns: where it runs, a cell re-rolls
          // its letter into a digit each time a head goes by, the ink eased toward green
          sk = scriptK(vW);
          sw = scriptWaveAt(cell);
          // (digits 1 - 7 and 9 sit together in the atlas: CHARS)
          if (sw.x > 1.0 - 0.75 * min(sk, 1.0)) idx = ${gi('1')}.0 + floor(hash12(cell + sw.z * 1.7) * 7.99);
          ink = mix(ink, SCRIPT_GREEN * (luma(ink) + 0.05), min(sk, 1.0) * 0.8) * (1.0 + sk * (1.2 * sw.x + 1.8 * sw.y));
        }
        float m = 0.0;
#if DP_FLOOR > 0
        vec3 col;
        ${DP_FLOOR_PRINT}
#else
        if (idx >= 0.0) {
          // small sideways nudge per cell: glyphs never sit in perfect typeset columns
          vec2 fz = (f - vec2((fract(h * 7.13) - 0.5) * 0.2, 0.0) - 0.5) * uGlyphZoom + 0.5;
          m = smoothstep(0.2, 0.7, glyphGrad(idx, fz, dFdx(gc) * uGlyphZoom, dFdy(gc) * uGlyphZoom));
        }
        vec3 base = vCol * (L * uBase + 0.006);
        vec3 col = mix(base, ink * (L + uInkFloor), m);
        // moonlit chamfer: a thin edge that catches the light, chipped (broken per cell)
        float chip = step(0.3, hash12(cell + 3.3));
        col += vCol * (L + uInkFloor) * uGain * 0.45 * vEdge * uEdge * chip;
#endif

        // dragon fire scorches low stones; embers glow in the glyphs
        vec2 sc = scorchAt(vW.xz);
        float low = 1.0 - smoothstep(0.3, 1.4, vW.y);
        col *= 1.0 - sc.x * 0.55 * low;
        col += vec3(1.0, 0.28, 0.04) * sc.y * sc.y * low * (0.08 + 0.5 * m);
        if (sk > 0.0) col = mix(col, SCRIPT_GREEN * luma(col) * 1.4, min(sk, 1.0) * 0.6);
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, 0.0);
      }
    `,
    side: o.side ?? THREE.DoubleSide,
    blending: THREE.NoBlending,
  });
  // the dragon print's rim (dragonFloor.js addSlabRim): a set gives its meshes theirs when it builds them;
  // any other geometry drawn with this material gets it on its first draw
  if (dpLook) mat.onBeforeRender = (renderer, scene, camera, geometry, object) => lazySlabRim(scene, geometry, object);
  return mat;
}
