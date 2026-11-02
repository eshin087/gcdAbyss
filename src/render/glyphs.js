import * as THREE from 'three';

// Two glyph textures:
//  1. The WORLD atlas: 16x8 cells of 64px, mipmapped. Used by everything that places glyphs
//     in 3D (grass strokes, dragon scales, armour, particles). Look up a char with gi('^').
//  2. The GRID atlas: tiny, pixel-exact, rebuilt on resize. Used by the screen-space ASCII pass
//     that turns rocks / trees into terminal-style character grids.

export const FONT_STACK = '"JetBrains Mono", "Cascadia Mono", Consolas, "Courier New", monospace';

const CHAR_SOURCE =
  " .,'`:;-~_=+*^<>/\\|!ilIjtYVvXxyoOcaeszr0Q@#%&8$BNMWwmnuqpdbkh{}()[]?\"1234567890ACDEFGHJKLPRSTUZ·•°×";
export const CHARS = [...new Set([...CHAR_SOURCE])];
if (CHARS.length > 128) throw new Error(`glyph atlas overflow: ${CHARS.length} > 128`);

const GI = new Map(CHARS.map((c, i) => [c, i]));
/** Glyph index of a single character in the world atlas. */
export function gi(ch) {
  const i = GI.get(ch);
  if (i === undefined) throw new Error(`glyph "${ch}" is not in the atlas`);
  return i;
}
/** Glyph indices for every character of a string. */
export const gis = (str) => [...str].map(gi);

export const ATLAS_COLS = 16;
export const ATLAS_ROWS = 8;
const CELL = 64;

export async function loadFonts() {
  if (!document.fonts?.load) return;
  const timeout = new Promise((r) => setTimeout(r, 2500));
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('700 50px "JetBrains Mono"'),
        document.fonts.load('400 14px "JetBrains Mono"'),
        document.fonts.load('700 40px "Cinzel"'),
      ]),
      timeout,
    ]);
  } catch {
    /* offline: fall back to system monospace */
  }
}

export function createGlyphAtlas(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL;
  canvas.height = ATLAS_ROWS * CELL;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 50px ${FONT_STACK}`;
  CHARS.forEach((ch, i) => {
    const x = (i % ATLAS_COLS) * CELL + CELL / 2;
    const y = Math.floor(i / ATLAS_COLS) * CELL + CELL / 2 + 2;
    ctx.fillText(ch, x, y);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return { texture: tex, canvas };
}

// Screen-grid ramps. Each atlas row holds up to GRID_COLS glyphs; the ASCII pass in
// pipeline.js indexes them (row constants below must stay in sync with its shader).
//  - ramp rows (stone, leaf, smooth): 14 luminance levels x 4 variants (variant picked per cell by
//    hash, so large flat areas read as hand-typed text rather than a repeating stamp)
//  - grass row: 11 categories x 4 variants (see GRASS_CATS)
//  - directional rows (scales, strands, plates): 7 levels x 8 screen directions
//    (dir 0 = right, counter-clockwise in 45° steps, so 2 = up, 4 = left, 6 = down)
//  - edge row: 4 orientations (|, -, /, \) x 4 variants, used to outline stone silhouettes
export const GRID_LEVELS = 14;
export const GRID_VARIANTS = 4;
export const GRID_COLS = 64;
export const GRID_ROW = { stone: 0, leaf: 1, grass: 2, scales: 3, strands: 4, plates: 5, smooth: 6, edge: 7 };

const ramp = (levels) => levels.flatMap((l) => [...l.padEnd(4, ' ')]);
const directional = (levels) => levels.flatMap((l) => (l.length === 1 ? Array(8).fill(l) : [...l]));

// grass categories (4 variants each); order matters, the shader indexes by category
export const GRASS_CATS = ['empty', 'dots', 'tufts', 'upright', 'leanR', 'leanL', 'wide', 'flat', 'ash', 'ember', 'flower'];
const RAMP_ROWS = {
  // stone favours symbols over lowercase letters so rocks read as carved texture, not words
  stone: ramp([
    '    ', '.  .', '.`.,', ":.:'", ';:-:', '-=~-', '=+=-', '+*=+',
    '*+%x', '%*#x', '#%&8', '8&#$', 'B8@&', '@MW#',
  ]),
  leaf: ramp([
    '    ', '..,`', ",:.'", ':;oc', 'ocoe', 'oeao', '0oOe', 'O0Qo',
    '08O&', '8&%0', '@8&%', '@#8@', '@@#8', '@@@#',
  ]),
  // grass strokes only (no letters that read as words): dots, tufts, blades, leaning blades,
  // wide tufts, trampled, ash, embers, flowers
  grass: ramp([
    '    ', '.,`.', ",'\"`", '|¦|!', '//)/', '\\\\(\\', 'vwVY', '_-~,', '.,`:', "*'.`", '*o°·',
  ]),
  // chevrons point along the surface flow (toward the head on a dragon)
  scales: directional([' ', '.', ':', '>^^^<vvv', '>^^^<vvv', '»AAA«VVV', '»AAA«VVV']),
  // strokes along the flow: hair, cloth folds, membrane veins, blades
  strands: directional([' ', '.', "-/|\\-/|\\", "-/|\\-/|\\", "-/|\\-/|\\", '=/I\\=/I\\', '=/I\\=/I\\']),
  // bands across the flow: belly plates, armour
  plates: directional([' ', '.', ':', '|\\-/|\\-/', '|\\=/|\\=/', 'HX=XHX=X', '#']),
  smooth: ramp([
    '    ', '..  ', '..,.', ':.:.', '::;:', 'oc:o', 'ocoe', 'oOoe',
    'O0oQ', '0O8Q', '08@0', '@8@0', '@@#8', '@@@@',
  ]),
  edge: ramp(['||!|', '-_-~', '////', '\\\\\\\\']),
};

/**
 * Character set of the creature ASCII-art pass (the owner's reference images: classic image-to-text
 * art). The atlas sorts it by measured ink coverage, so the shader can index it as a density ramp.
 */
export const ART_CHARS = ' .:;irsX235hAHSGM9#&B@';

/**
 * Pixel-exact single-row atlas of ART_CHARS sorted from sparse to dense, each glyph exactly
 * cellW x cellH px. Returns { texture, count }.
 */
export function createArtAtlas(cellW, cellH) {
  const chars = [...ART_CHARS];
  const size = Math.max(6, Math.round(cellH * 0.98));
  const font = `700 ${size}px ${FONT_STACK}`;
  // measure ink coverage per glyph at the target size, then sort sparse -> dense
  const probe = document.createElement('canvas');
  probe.width = cellW;
  probe.height = cellH;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  const ink = (ch) => {
    pctx.clearRect(0, 0, cellW, cellH);
    if (ch === ' ') return 0;
    pctx.fillStyle = '#fff';
    pctx.textAlign = 'center';
    pctx.textBaseline = 'middle';
    pctx.font = font;
    pctx.fillText(ch, cellW / 2, cellH / 2 + 0.5);
    const d = pctx.getImageData(0, 0, cellW, cellH).data;
    let s = 0;
    for (let i = 3; i < d.length; i += 4) s += d[i];
    return s;
  };
  const sorted = chars.map((ch, i) => ({ ch, i, v: ink(ch) })).sort((a, b) => a.v - b.v || a.i - b.i);

  const canvas = document.createElement('canvas');
  canvas.width = sorted.length * cellW;
  canvas.height = cellH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font;
  sorted.forEach(({ ch }, col) => {
    if (ch !== ' ') ctx.fillText(ch, col * cellW + cellW / 2, cellH / 2 + 0.5);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { texture: tex, count: sorted.length };
}

/**
 * 3x5 pixel font for ART_CHARS: rows top → bottom, 3 bits each (4 = left, 2 = middle, 1 = right).
 * A browser font at 5–6 px fills the whole cell with grey, so the hero's small letters are drawn
 * from this bitmap instead.
 */
const PIXEL_3X5 = {
  ' ': [0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 2],
  ':': [0, 2, 0, 2, 0],
  ';': [0, 2, 0, 2, 4],
  i: [2, 0, 2, 2, 2],
  r: [0, 3, 4, 4, 4],
  s: [0, 3, 4, 1, 6],
  X: [5, 5, 2, 5, 5],
  2: [6, 1, 2, 4, 7],
  3: [6, 1, 2, 1, 6],
  5: [7, 4, 6, 1, 6],
  h: [4, 4, 6, 5, 5],
  A: [2, 5, 7, 5, 5],
  H: [5, 5, 7, 5, 5],
  S: [3, 4, 2, 1, 6],
  G: [3, 4, 5, 5, 3],
  M: [5, 7, 7, 5, 5],
  9: [7, 5, 7, 1, 6],
  '#': [5, 7, 5, 7, 5],
  '&': [2, 5, 2, 5, 3],
  B: [6, 5, 6, 5, 6],
  '@': [2, 5, 7, 4, 3],
};

/** Letter cell of the pixel-font art atlas at integer scale s: a 3x5 glyph + 1 px spacing. */
export const pixelArtCell = (s) => [4 * s, 6 * s];

/**
 * ART_CHARS as a pixel-font atlas (the hero's finer letter grid): each 3x5 glyph scaled by `s`,
 * top-left in its (4s x 6s) cell, so letters keep the reference's one-pixel gaps. Sorted sparse →
 * dense by lit pixels, like createArtAtlas. Returns { texture, count }.
 */
export function createPixelArtAtlas(s = 1) {
  s = Math.max(1, Math.round(s) || 1);
  const [cw, ch] = pixelArtCell(s);
  const lit = (rows) => rows.reduce((n, r) => n + (r & 1) + ((r >> 1) & 1) + ((r >> 2) & 1), 0);
  const sorted = [...ART_CHARS].map((c, i) => ({ rows: PIXEL_3X5[c] ?? PIXEL_3X5[' '], i })).sort((a, b) => lit(a.rows) - lit(b.rows) || a.i - b.i);
  const canvas = document.createElement('canvas');
  canvas.width = sorted.length * cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  sorted.forEach(({ rows }, col) => {
    rows.forEach((bits, y) => {
      for (let x = 0; x < 3; x++) if (bits & (4 >> x)) ctx.fillRect(col * cw + x * s, y * s, s, s);
    });
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { texture: tex, count: sorted.length };
}

/** Pixel-exact atlas: one row per GRID_ROW entry, each glyph exactly cellW x cellH px. */
export function createGridAtlas(cellW, cellH) {
  const cols = GRID_COLS;
  const rowNames = Object.keys(GRID_ROW);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cellW;
  canvas.height = rowNames.length * cellH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = Math.max(7, Math.round(cellH * 0.98));
  ctx.font = `700 ${size}px ${FONT_STACK}`;
  for (const name of rowNames) {
    const row = GRID_ROW[name];
    RAMP_ROWS[name].slice(0, cols).forEach((ch, col) => {
      if (ch !== ' ') ctx.fillText(ch, col * cellW + cellW / 2, row * cellH + cellH / 2 + 0.5);
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { texture: tex, cols, rows: rowNames.length };
}
