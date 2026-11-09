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

/** Letter cell of the wyrm art grid at integer scale s: a 4 x 6 glyph + 1 px column / 2 px row gaps. */
export const wyrmArtCell = (s) => [5 * s, 8 * s];

/**
 * Pixel-exact single-row atlas: a blank, the WYRM_SETS dim / mid / bright letters, then the 4
 * WYRM_STROKES. Each glyph scaled by `s`, one pixel in from the cell's top-left. Returns
 * { texture, sets: [mid start, bright start, stroke start] (atlas columns; dim starts at 1), total }.
 */
export function createWyrmArtAtlas(s = 1) {
  s = Math.max(1, Math.round(s) || 1);
  const [cw, ch] = wyrmArtCell(s);
  const row = (str) => [...str].map((c) => ({ rows: FONT_4X6[c] ?? FONT_4X6[' '] }));
  const { dim, mid, bright } = WYRM_SETS;
  const glyphs = [...row(' '), ...row(dim), ...row(mid), ...row(bright), ...row(WYRM_STROKES)];
  const sets = [1 + dim.length, 1 + dim.length + mid.length, 1 + dim.length + mid.length + bright.length];
  const canvas = document.createElement('canvas');
  canvas.width = glyphs.length * cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const on = (rows, x, y) => y >= 0 && y < 6 && x >= 0 && x < 4 && (rows[y] & (8 >> x)) !== 0;
  glyphs.forEach(({ rows }, col) => {
    // a soft halo on the stroke's neighbours (the reference's letters are anti-aliased, not 1 px
    // hairlines: at 0.12 the hide read as sparse wire text, at 0.24 as the reference's dense, soft
    // digit field); never into the right gap column, so letters stay apart
    ctx.fillStyle = 'rgba(255,255,255,0.24)';
    for (let y = -1; y <= 6; y++) {
      for (let x = 0; x < 4; x++) {
        if (on(rows, x, y)) continue;
        if (on(rows, x - 1, y) || on(rows, x + 1, y) || on(rows, x, y - 1) || on(rows, x, y + 1)) ctx.fillRect(col * cw + x * s, (y + 1) * s, s, s);
      }
    }
    ctx.fillStyle = '#fff';
    rows.forEach((bits, y) => {
      for (let x = 0; x < 4; x++) if (bits & (8 >> x)) ctx.fillRect(col * cw + x * s, (y + 1) * s, s, s);
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
