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

// Screen-grid ramps: 14 luminance levels x 4 variants (variants are picked per cell by hash
// so large flat areas read as hand-typed text rather than a repeating stamp).
export const GRID_LEVELS = 14;
export const GRID_VARIANTS = 4;
const RAMPS = {
  stone: [
    '    ', '.`.,', ":'-.", ';~_:', '=+/\\', 'il|(', 'cvzr', 'sunx',
    'oeaw', 'pqdb', 'OQ0%', '&8$#', 'BNWM', '@MW#',
  ],
  leaf: [
    '    ', '..,`', ",:.'", ':;oc', 'ocoe', 'oeao', '0oOe', 'O0Qo',
    '08O&', '8&%0', '@8&%', '@#8@', '@@#8', '@@@#',
  ],
};
export const GRID_ROWS = ['stone', 'leaf'];

/** Pixel-exact atlas: row 0 = stone ramp, row 1 = leaf ramp. Each glyph is cellW x cellH px. */
export function createGridAtlas(cellW, cellH) {
  const cols = GRID_LEVELS * GRID_VARIANTS;
  const canvas = document.createElement('canvas');
  canvas.width = cols * cellW;
  canvas.height = GRID_ROWS.length * cellH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = Math.max(7, Math.round(cellH * 0.98));
  ctx.font = `700 ${size}px ${FONT_STACK}`;
  GRID_ROWS.forEach((name, row) => {
    RAMPS[name].forEach((level, li) => {
      [...level].forEach((ch, vi) => {
        const col = li * GRID_VARIANTS + vi;
        ctx.fillText(ch, col * cellW + cellW / 2, row * cellH + cellH / 2 + 0.5);
      });
    });
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { texture: tex, cols, rows: GRID_ROWS.length };
}
