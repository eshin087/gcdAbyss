import * as THREE from 'three';
import { COMMON_GLSL } from './shaderLib.js';
import { gi } from './glyphs.js';

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
//   0.04..0.44   CREATURE screen-grid glyphs that follow the surface flow (opt-in `grid: true`,
//                the v0.2 look); the value packs set x 24 screen-space flow angles
//   0.5          ART      hero / wyrm: their crisp render is the SOURCE IMAGE of a fine screen-space
//                         ASCII-art grid (letters picked by brightness, coloured per cell);
//   0.48         ART_HERO the same, with the hero's own pass settings (pipeline uArt* .x)
//   0.6          LEAF     blobby foliage ramp
//   1.0          STONE    letter ramp + edge outlines
export const FLAG = { NONE: 0.0, ART_HERO: 0.48, ART: 0.5, LEAF: 0.6, STONE: 1.0 };
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
export const CREATURE_FLAG = { min: 0.04, span: 0.4, codes: 96, angles: 24 };
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
 *   ink: [r,g,b]         albedo of the source (charcoal hide, molten plates, crimson membrane)
 *   light: [gain, key, fresnel, floor]  moon + fire lights x gain, a camera key light (the reference
 *                        is evenly lit from the front), a moonlit edge rim, a flat light floor
 *   vein: [strength, share, width, plate]  molten fissures x uGlow: voronoi plates of `plate` aGUV
 *                        units, only `share` of the fissures glow (a broken, branching net), `width`
 *   glow: [gaps, all]    emissive x uGlow in the scale gaps (molten plates) / everywhere (maw, eye)
 *   under: [r,g,b,k]     warm light from below on down-facing surfaces (lava light under the jaw)
 *   membrane: [mottle, specks, tears, edgeTears]  wing membranes only (needs aEdge / aBone): dark
 *                        mottling, ember specks, holes, a ragged trailing edge
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
  uniforms.uWInk = { value: new THREE.Color(...v(w.ink, 3, [0.3, 0.29, 0.28])) };
  uniforms.uWLight = { value: new THREE.Vector4(...v(w.light, 4, [1, 0.5, 0.3, 0.02])) };
  uniforms.uWVein = { value: new THREE.Vector4(...v(w.vein, 4, [0, 0.4, 0.06, 1])) };
  // molten colour of veins / gaps / glow: a red-orange (ACES turns a (1, 0.34, 0.05) lava gold)
  uniforms.uWEmit = { value: new THREE.Color(...v(w.emit, 3, [1.0, 0.17, 0.03])) };
  uniforms.uWGlow = { value: new THREE.Vector2(...v(w.glow, 2, [0, 0])) };
  uniforms.uWUnder = { value: new THREE.Vector4(...v(w.under, 4, [1, 0.35, 0.08, 0])) };
  if (w.membrane != null) {
    defines.SG_WYRM_MEMBRANE = '';
    uniforms.uWMem = { value: new THREE.Vector4(...v(w.membrane, 4, [0.5, 0.03, 0.1, 0.4])) };
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

/**
 * Geometry attributes required: position, normal, aCol (vec3 albedo, linear), aFlag (float),
 * aSway (float, 0 = rigid), aAO (float 0..1).
 * fadeNearPlayer: canopy/foreground occluders dither away around the player on screen.
 */
export function createAsciiObjectMaterial(U, { fadeNearPlayer = false, side = THREE.FrontSide } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...pickShared(U, SHARED),
      uPlayerScreen: U.uPlayerScreen,
      uResolution: U.uResolution,
      uFadeOn: { value: fadeNearPlayer ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      ${COMMON_GLSL}
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
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float s = aSway;
        wp.x += (sin(uTime * 0.9 + wp.z * 0.15 + wp.x * 0.05) * 0.6 + sin(uTime * 2.1 + wp.x * 0.4) * 0.25) * 0.14 * s;
        wp.z += cos(uTime * 0.7 + wp.x * 0.13) * 0.08 * s;
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
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
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vG = aGUV;
#ifdef SG_AXIS
        vNO = normal; // object space: glowAxis / inkAxis stay glued to the part
#endif
#ifdef SG_WYRM_MEMBRANE
        vEdge = aEdge;
        vBone = aBone;
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
      uniform vec2 uWScale;
      uniform vec4 uWShape;
      uniform vec4 uWTip;
      uniform vec4 uWTone;
      uniform vec3 uWInk;
      uniform vec4 uWLight;
      uniform vec4 uWVein;
      uniform vec3 uWEmit;
      uniform vec2 uWGlow;
      uniform vec4 uWUnder;
  #ifdef SG_WYRM_MEMBRANE
      uniform vec4 uWMem;
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
      vec2 wScales(vec2 p, out vec3 rimT) {
        float ppx = max(max(length(dFdx(p)), length(dFdy(p))), 1e-6); // scale units per pixel
        float rimW = max(uWTone.w, 4.5 * ppx);
        float gapW = max(0.22, 5.0 * ppx);
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
        float t = clamp(dCov / max(dCov + dIn, 1e-4), 0.0, 1.0); // 0 under the overlap .. 1 at its edge
        float body = uWTone.y * (0.6 + 0.8 * hs) * (0.3 + 0.7 * t * t);
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
        float key = max(dot(n, normalize(V + vec3(0.0, 0.7, 0.0))), 0.0);
        vec3 light = lightAt(vW, n, 0.25, sh) + vec3(1.0, 0.95, 0.9) * key * uWLight.y + uMoonColor * fres * uWLight.z
          + uWLight.w + uWUnder.rgb * uWUnder.a * max(-n.y, 0.0);
        // 'down' scales (uWShape.x 1: the barrel) hang from the dorsal line toward the belly like
        // roof tiles: rows run along the body, tips toward larger |aGUV x| (around the body)
        vec2 gp = uWShape.x > 0.5 ? vec2(vG.y, -abs(vG.x)) : vG;
        vec2 gs = gp / max(uWScale, vec2(1e-4));
        vec2 jx = dFdx(gs), jy = dFdy(gs);
        vec3 rimT = vec3(0.0);
        vec2 sc = uWScale.x > 0.0 ? wScales(gs, rimT) : vec2(1.0, 0.0);
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
        // horns, spikes, claws (aGUV y = distance from the root): dark roots, bright tips, molten
        // roots on the glowing spines (uWTip: tip ramp from .x to .y, value at the root .z, root glow .w)
        float tipT = smoothstep(uWTip.x, uWTip.y, vG.y);
        sc.x *= mix(uWTip.z, 1.0, tipT);
        vec3 col = uWInk * uTint * (light * uWLight.x + uInkGlow) * sc.x;
        col += uWEmit * hot * uWTip.w * (1.0 - tipT);
  #ifdef SG_WYRM_MEMBRANE
        // tears glued to the membrane (aGUV): a few holes inside, a ragged trailing edge
        float tn = wNoise(vG * uWMem.z) * 0.6 + wNoise(vG * uWMem.z * 2.9 + 5.3) * 0.4;
        if (tn > 0.94 - uWMem.w * smoothstep(0.45, 1.0, vEdge)) discard;
        // dark mottled patches (the reference's sails are blotched deep red and near black, never a
        // flat field), darker toward the torn edge, embers along the bones, sparse ember specks
        float mo = wNoise(vG * 0.75 + 11.3) * 0.65 + wNoise(vG * 2.4 + 3.1) * 0.35;
        col *= mix(1.0 - uWMem.x, 1.0 + 0.5 * uWMem.x, smoothstep(0.32, 0.68, mo)) * (1.0 - 0.45 * smoothstep(0.5, 1.0, vEdge));
        float bone = 1.0 - smoothstep(0.0, 0.3, vBone);
        float spk = step(1.0 - uWMem.y, hash12(floor(vG / 0.075) + uSeed)) * step(0.36, mo);
        col += uWEmit * (spk * (0.3 + 0.9 * hot) + bone * bone * (0.05 + 0.9 * hot));
  #endif
        if (uWVein.x > 0.0 && hot > 0.001) {
          float vn = wVeins(vG / uWVein.w, uWVein.y, uWVein.z / uWVein.w);
          col += uWEmit * hot * uWVein.x * vn * (0.75 + 0.25 * sin(uTime * 2.3 + vG.y * 3.1));
        }
        col += uWEmit * hot * (uWGlow.x * sc.y + uWGlow.y);
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
        gl_FragColor = vec4(col, 0.04 + (code + 0.5) / 96.0 * 0.4);
      }

      void main() {
        if (uAsciiSet >= 0.0) { asciiMain(); return; }
        vec2 g = vG / uCell;
        g.x += step(1.0, mod(floor(g.y), 2.0)) * uRowShift;
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float h = hash12(cell + uSeed);
        if (uDissolve > 0.0 && h < uDissolve) discard;
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
        col += uEmissive * hot * (seam * (1.0 - m) * 0.95 + (1.0 - m) * 0.03) * pulse;
        col = mix(col, col * vec3(1.2, 0.92, 0.8) + uEmissive * 0.06 * m, hot * 0.45);

        col += vec3(1.0, 0.92, 0.85) * uFlash * (0.25 + 0.75 * m);
        col += uWarn.rgb * uWarn.a * (0.08 + 0.9 * m + rim * 2.5);
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, uFlag);
      }
    `,
    side: o.side ?? THREE.FrontSide,
    blending: THREE.NoBlending,
  });
  if (Object.keys(feat.defines).length) mat.defines = feat.defines;
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
 */
export function createCarvedGlyphMaterial(U, o = {}) {
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
  return new THREE.ShaderMaterial({
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
    },
    vertexShader: /* glsl */ `
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
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vCol = aCol;
        vAO = aAO;
        vMoss = aMoss;
        vInk = aInk;
        vEdge = aEdge;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON_GLSL}
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

        float m = 0.0;
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

        // dragon fire scorches low stones; embers glow in the glyphs
        vec2 sc = scorchAt(vW.xz);
        float low = 1.0 - smoothstep(0.3, 1.4, vW.y);
        col *= 1.0 - sc.x * 0.55 * low;
        col += vec3(1.0, 0.28, 0.04) * sc.y * sc.y * low * (0.08 + 0.5 * m);
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, 0.0);
      }
    `,
    side: o.side ?? THREE.DoubleSide,
    blending: THREE.NoBlending,
  });
}
