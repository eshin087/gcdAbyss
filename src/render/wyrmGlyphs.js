import * as THREE from 'three';

// The wyrm's ASCII-art letters (FLAG.ART, the owner's red-black dragon reference): thin one-pixel
// strokes, 4 x 6 px glyphs in 5 x 8 px cells, so every letter keeps a black gap around it and the
// body reads as dark charcoal text with bright strokes, not as solid bars of bold browser glyphs
// (a 7 px bold font filled its 4 x 7 cell). Digits dominate, like the reference.
//
// Bitmaps: 6 rows top -> bottom, 4 bits each (8 = left column ... 1 = right column).
const FONT_4X6 = {
  ' ': [0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 4],
  ':': [0, 0, 4, 0, 0, 4],
  "'": [4, 4, 0, 0, 0, 0],
  ';': [0, 0, 4, 0, 4, 8],
  '!': [4, 4, 4, 4, 0, 4],
  r: [0, 0, 11, 12, 8, 8],
  i: [4, 0, 12, 4, 4, 14],
  v: [0, 0, 9, 9, 6, 6],
  x: [0, 0, 9, 6, 6, 9],
  c: [0, 0, 7, 8, 8, 7],
  1: [4, 12, 4, 4, 4, 14],
  7: [15, 1, 2, 4, 4, 4],
  s: [0, 0, 7, 12, 3, 14],
  2: [6, 9, 1, 2, 4, 15],
  3: [14, 1, 6, 1, 1, 14],
  4: [2, 6, 10, 15, 2, 2],
  9: [6, 9, 9, 7, 1, 6],
  6: [6, 8, 14, 9, 9, 6],
  8: [6, 9, 6, 9, 9, 6],
  5: [15, 8, 14, 1, 1, 14],
  0: [6, 9, 11, 13, 9, 6],
  A: [6, 9, 9, 15, 9, 9],
  '@': [6, 9, 11, 11, 8, 7],
  B: [14, 9, 14, 9, 9, 14],
  M: [9, 15, 15, 9, 9, 9],
  // stroke glyphs, appended after the density ramp (not part of it): the art pass draws them along
  // the scale rims (screen direction of the rim line), the reference's '\ /' scale outlines
  '-': [0, 0, 0, 15, 0, 0],
  '/': [1, 1, 2, 4, 8, 8],
  '|': [4, 4, 4, 4, 4, 4],
  '\\': [8, 8, 4, 2, 1, 1],
};

// The same letters as 3 x 5 bitmaps (rows top -> bottom, 3 bits: 4 = left ... 1 = right) for small
// screens: at 720p a 5 x 8 cell is 1/90 of the screen height and the wyrm printed in coarse, sparse
// letters next to the hero's finer 4 x 6 grid; 3 x 5 letters in 4 x 6 cells keep its density.
const FONT_3X5 = {
  ' ': [0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 2],
  ':': [0, 2, 0, 2, 0],
  "'": [2, 2, 0, 0, 0],
  ';': [0, 2, 0, 2, 4],
  '!': [2, 2, 2, 0, 2],
  r: [0, 5, 6, 4, 4],
  i: [2, 0, 6, 2, 7],
  v: [0, 0, 5, 5, 2],
  x: [0, 5, 2, 2, 5],
  c: [0, 3, 4, 4, 3],
  1: [2, 6, 2, 2, 7],
  7: [7, 1, 2, 2, 2],
  s: [3, 4, 2, 1, 6],
  2: [6, 1, 2, 4, 7],
  3: [6, 1, 2, 1, 6],
  4: [5, 5, 7, 1, 1],
  9: [2, 5, 3, 1, 2],
  6: [3, 4, 6, 5, 2],
  8: [2, 5, 2, 5, 2],
  5: [7, 4, 6, 1, 6],
  0: [2, 5, 5, 5, 2],
  A: [2, 5, 7, 5, 5],
  '@': [2, 5, 7, 4, 3],
  B: [6, 5, 6, 5, 6],
  M: [5, 7, 7, 5, 5],
  '-': [0, 0, 7, 0, 0],
  '/': [1, 1, 2, 4, 4],
  '|': [2, 2, 2, 2, 2],
  '\\': [4, 4, 2, 1, 1],
};

/**
 * The wyrm's letters in three sets, one per brightness tier of a cell (art pass, wyrmCell): light
 * glyphs for the charcoal hide, digits for lit scales, round full digits for rims and lava. Inside a
 * tier the cell's own hash picks the letter, so a letter only changes when its cell changes tier:
 * a single density ramp (22 steps) re-lettered most cells every frame while the wyrm breathed. The
 * reference is a field of whole digits whose brightness, not their density, draws the dragon.
 */
export const WYRM_SETS = { dim: '17iv!;r27', mid: '2345968017', bright: '96805A@3' };
/** Stroke glyphs after the sets, in screen-direction order: horizontal, rising, vertical, falling. */
export const WYRM_STROKES = '-/|\\';

/**
 * Letter cell of the wyrm art grid at integer scale s: a 4 x 6 glyph + 1 px column / 2 px row gaps;
 * `small` (screens under 900 px tall): a 3 x 5 glyph in a 4 x 6 cell.
 */
export const wyrmArtCell = (s, small = false) => (small ? [4, 6] : [5 * s, 8 * s]);

/** Art grid scale for a canvas H device px tall: { s, small } (see wyrmArtCell). */
export const wyrmArtScale = (H) => (H < 900 ? { s: 1, small: true } : { s: Math.max(1, Math.round(H / 1080)), small: false });

/**
 * Pixel-exact single-row atlas: a blank, the WYRM_SETS dim / mid / bright letters, then the 4
 * WYRM_STROKES. Each glyph scaled by `s`, one pixel in from the cell's top-left (`small`: the 3 x 5
 * font in 4 x 6 cells, at the cell's top-left). Returns { texture, sets: [mid start, bright start,
 * stroke start] (atlas columns; dim starts at 1), total }.
 */
export function createWyrmArtAtlas(s = 1, small = false) {
  s = small ? 1 : Math.max(1, Math.round(s) || 1);
  const [cw, ch] = wyrmArtCell(s, small);
  const FONT = small ? FONT_3X5 : FONT_4X6;
  const gw = small ? 3 : 4, gh = small ? 5 : 6, top = small ? 0 : 1, msb = small ? 4 : 8;
  const row = (str) => [...str].map((c) => ({ rows: FONT[c] ?? FONT[' '] }));
  const { dim, mid, bright } = WYRM_SETS;
  const glyphs = [...row(' '), ...row(dim), ...row(mid), ...row(bright), ...row(WYRM_STROKES)];
  const sets = [1 + dim.length, 1 + dim.length + mid.length, 1 + dim.length + mid.length + bright.length];
  const canvas = document.createElement('canvas');
  canvas.width = glyphs.length * cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const on = (rows, x, y) => y >= 0 && y < gh && x >= 0 && x < gw && (rows[y] & (msb >> x)) !== 0;
  glyphs.forEach(({ rows }, col) => {
    // a soft halo on the stroke's neighbours (the reference's letters are anti-aliased, not 1 px
    // hairlines: at 0.12 the hide read as sparse wire text, at 0.24 as the reference's dense, soft
    // digit field); never into the right gap column, so letters stay apart
    ctx.fillStyle = 'rgba(255,255,255,0.24)';
    for (let y = -top; y <= gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (on(rows, x, y)) continue;
        if (y + top >= ch) continue;
        if (on(rows, x - 1, y) || on(rows, x + 1, y) || on(rows, x, y - 1) || on(rows, x, y + 1)) ctx.fillRect(col * cw + x * s, (y + top) * s, s, s);
      }
    }
    ctx.fillStyle = '#fff';
    rows.forEach((bits, y) => {
      for (let x = 0; x < gw; x++) if (bits & (msb >> x)) ctx.fillRect(col * cw + x * s, (y + top) * s, s, s);
    });
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { texture: tex, sets, total: glyphs.length };
}
