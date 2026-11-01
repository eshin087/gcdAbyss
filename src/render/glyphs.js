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
