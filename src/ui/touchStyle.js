// Touch-controls stylesheet, injected from JS (style.css stays foundation-only). Matches the HUD:
// JetBrains Mono, thin light lines, ember accents; the stick is an ASCII ring of glyphs around an
// '@' knob and every button wears HUD-style corner brackets.
// The controls are drawn ON the game, not over it (ADR-097): no filled panels, faint outlines and
// glyphs at rest (the fight shows through them), full strength only under a thumb.

const LINE = 'rgba(207, 214, 230, 0.30)';
const CORNER = 'rgba(207, 214, 230, 0.55)';
const EMBER = '#ff8a3d';
// four L-shaped corner brackets drawn with gradients (crisp 1px lines, no box-drawing font needed)
const corners = (c, s) =>
  [
    `linear-gradient(${c},${c}) top left / ${s}px 1px no-repeat`,
    `linear-gradient(${c},${c}) top left / 1px ${s}px no-repeat`,
    `linear-gradient(${c},${c}) top right / ${s}px 1px no-repeat`,
    `linear-gradient(${c},${c}) top right / 1px ${s}px no-repeat`,
    `linear-gradient(${c},${c}) bottom left / ${s}px 1px no-repeat`,
    `linear-gradient(${c},${c}) bottom left / 1px ${s}px no-repeat`,
    `linear-gradient(${c},${c}) bottom right / ${s}px 1px no-repeat`,
    `linear-gradient(${c},${c}) bottom right / 1px ${s}px no-repeat`,
  ].join(',');

const CSS = `
html.gcd-touch, html.gcd-touch body {
  touch-action: none;
  overscroll-behavior: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
/* phones render at DPR 1 on LOW: upscale the ASCII frame with crisp pixels, not a blur */
html.gcd-touch #game { cursor: default; image-rendering: pixelated; }
.tc-root {
  --tc-ink: #cfd6e6;
  --tc-dim: #7d879c;
  --tc-ember: ${EMBER};
  --tc-gold: #d8b86a;
  --tc-mono: 'JetBrains Mono', 'Cascadia Mono', Consolas, 'Courier New', monospace;
  position: absolute;
  inset: 0;
  z-index: 6;
  pointer-events: none;
  font-family: var(--tc-mono);
  color: var(--tc-ink);
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.35s ease;
}
.tc-root.off { opacity: 0; visibility: hidden; transition: opacity 0.35s ease, visibility 0s linear 0.35s; }
.tc-root.off * { pointer-events: none !important; }
/* paused: the controls show through the pause screen, inert (PAD POSITION / PAD SIZE are seen) */
.tc-root.off.peek { opacity: 0.85; visibility: visible; z-index: 40; transition: opacity 0.2s ease; }
.tc-root.off.peek .tc-stick, .tc-root.off.peek .tc-pause, .tc-root.off.peek .tc-lock { opacity: 0; }
/* model viewer hides every HUD layer; the touch layer too */
#ui.lab-mv > .tc-root { opacity: 0 !important; }

/* ---------- stick: capture zone (left thumb) + ASCII ring ---------- */
.tc-zone {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 42%;
  height: 74%;
  pointer-events: auto;
  touch-action: none;
}
.tc-stick {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  opacity: 0.4;
  transition: opacity 0.25s ease;
  will-change: transform;
}
.tc-stick.on { opacity: 0.9; transition: opacity 0.05s; }
/* the stick scales with the screen (--tc-f, CONFIG.touch.pad.fit): each part round the stick's centre */
.tc-disc, .tc-ring, .tc-centre, .tc-knob, .tc-tag { scale: var(--tc-f, 1); }
.tc-disc { transform-origin: 64px 64px; }
.tc-ring { transform-origin: 0 0; }
.tc-centre { transform-origin: 5px 8px; }
.tc-knob { transform-origin: 19px 19px; }
.tc-tag { transform-origin: 40px -78px; }
.tc-disc {
  position: absolute;
  left: -64px;
  top: -64px;
  width: 128px;
  height: 128px;
  border-radius: 50%;
  background: none;
}
.tc-ring > span {
  position: absolute;
  width: 14px;
  height: 16px;
  margin: -8px 0 0 -7px;
  text-align: center;
  font-size: 14px;
  font-weight: 700;
  line-height: 16px;
  color: rgba(207, 214, 230, 0.7);
  text-shadow: 0 0 2px #000, 0 1px 2px #000;
}
.tc-ring > span.c { color: rgba(232, 236, 245, 0.9); font-size: 11px; font-weight: 700; }
.tc-ring > span.l1 { color: ${EMBER}; text-shadow: 0 0 6px rgba(255, 138, 61, 0.8), 0 1px 2px #000; }
.tc-ring > span.l2 { color: #ffd2a4; text-shadow: 0 0 8px rgba(255, 138, 61, 1), 0 1px 2px #000; }
.tc-stick.sprint .tc-ring > span.l1, .tc-stick.sprint .tc-ring > span.l2 {
  color: var(--tc-gold);
  text-shadow: 0 0 8px rgba(216, 184, 106, 0.95), 0 1px 2px #000;
}
.tc-centre {
  position: absolute;
  left: -5px;
  top: -8px;
  width: 10px;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  color: rgba(207, 214, 230, 0.35);
}
.tc-knob {
  position: absolute;
  left: -19px;
  top: -19px;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 700;
  color: #f2e7d2;
  background: rgba(6, 9, 14, 0.12);
  border: 1px solid rgba(207, 214, 230, 0.2);
  text-shadow: 0 0 8px rgba(255, 138, 61, 0.55);
  will-change: transform;
}
.tc-knob::before {
  content: '';
  position: absolute;
  inset: -4px;
  background: ${corners(CORNER, 7)};
}
.tc-stick.on .tc-knob { border-color: rgba(255, 138, 61, 0.6); }
.tc-stick.sprint .tc-knob { color: #fff3c9; border-color: rgba(216, 184, 106, 0.8); text-shadow: 0 0 10px rgba(216, 184, 106, 0.9); }
.tc-tag {
  position: absolute;
  left: -40px;
  top: 78px;
  width: 80px;
  text-align: center;
  font-size: 9px;
  letter-spacing: 0.3em;
  padding-left: 0.3em;
  color: var(--tc-dim);
  text-shadow: 0 1px 2px #000;
}
.tc-stick.sprint .tc-tag { color: var(--tc-gold); }
.tc-stick:not(.sprint) .tc-tag { display: none; }

/* ---------- buttons (right thumb) ---------- */
.tc-btn {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 0;
  margin: 0;
  font-family: var(--tc-mono);
  color: var(--tc-ink);
  background: transparent;
  border: 1px solid rgba(207, 214, 230, 0.13);
  border-radius: 0;
  opacity: 0.62;
  pointer-events: auto;
  touch-action: none;
  -webkit-appearance: none;
  appearance: none;
  outline: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.08s, border-color 0.08s, opacity 0.25s;
}
.tc-btn.on { opacity: 1; transition: background 0.05s, border-color 0.05s, opacity 0.05s; }
.tc-btn::before {
  content: '';
  position: absolute;
  inset: -4px;
  pointer-events: none;
  background: ${corners(CORNER, 8)};
}
.tc-btn .g {
  font-size: 22px;
  line-height: 1;
  color: #eef1f8;
  text-shadow: 0 0 3px #000, 0 0 7px rgba(0, 0, 0, 0.85), 0 1px 2px #000;
}
.tc-btn .t {
  font-size: 8px;
  line-height: 10px;
  letter-spacing: 0.2em;
  padding-left: 0.2em;
  color: var(--tc-dim);
  white-space: pre;
  text-shadow: 0 0 3px #000, 0 1px 2px #000;
}
.tc-btn .s { display: none; }
.tc-btn.on {
  background: rgba(255, 138, 61, 0.14);
  border-color: rgba(255, 138, 61, 0.75);
}
.tc-btn.on::before { background: ${corners(EMBER, 8)}; }
.tc-btn.on .g { color: #ffe2cc; text-shadow: 0 0 10px rgba(255, 138, 61, 0.95), 0 1px 2px #000; }
.tc-btn.on .t { color: #ffd2a4; }
.tc-btn.dim { opacity: 0.3; }
.tc-btn.lit { border-color: rgba(255, 138, 61, 0.6); }
.tc-btn.lit .g { color: ${EMBER}; text-shadow: 0 0 8px rgba(255, 138, 61, 0.8); }

/* the pad: one pointer surface under three tiles that all touch (ui/touch.js places and sizes it
   and its tiles from CONFIG.touch.pad; --tc-k is its scale) */
.tc-pad { position: absolute; pointer-events: auto; touch-action: none; }
.tc-tile { pointer-events: none; cursor: default; box-sizing: border-box; }
.tc-tile::before { inset: 3px; opacity: 0.6; }
.tc-tile.on::before { opacity: 1; }
.tc-tile .g { font-size: calc(22px * var(--tc-k, 1)); }
.tc-tile .t { font-size: calc(8px * var(--tc-k, 1)); line-height: 1.3; }
.tc-attack .g { font-size: calc(36px * var(--tc-k, 1)); }
.tc-attack .t { font-size: calc(9px * var(--tc-k, 1)); }
.tc-heavy .g { font-size: calc(30px * var(--tc-k, 1)); }
.tc-heavy .t { font-size: calc(9px * var(--tc-k, 1)); }
.tc-heavy.charge .t { color: var(--tc-gold); letter-spacing: 0.04em; padding-left: 0; }
.tc-heavy.full .t { color: #fff3c9; text-shadow: 0 0 6px rgba(216, 184, 106, 0.9); }
/* BLOCK carries the guard meter: a gauge along its foot (--tc-gd 0..1, written by ui/touch.js) */
.tc-block::after {
  content: '';
  position: absolute;
  left: 7px;
  right: 7px;
  bottom: 4px;
  height: 2px;
  background: linear-gradient(90deg, #dfe7f5, #dfe7f5) left / calc(var(--tc-gd, 1) * 100%) 100% no-repeat, rgba(207, 214, 230, 0.16);
}
.tc-block.low::after { background: linear-gradient(90deg, #ff9a5a, #ff9a5a) left / calc(var(--tc-gd, 1) * 100%) 100% no-repeat, rgba(255, 138, 61, 0.2); }
.tc-block.low { border-color: rgba(255, 138, 61, 0.55); }
.tc-block { padding-bottom: 5px; }
/* PAD LAYOUT split (ADR-131): the guard is the left hand's, a button of its own beside the stick */
.tc-guard { display: none; box-sizing: border-box; padding-bottom: 5px; }
.tc-root.lguard .tc-guard { display: flex; }
.tc-guard .g { font-size: calc(22px * var(--tc-k, 1)); }
.tc-guard .t { font-size: calc(8px * var(--tc-k, 1)); line-height: 1.3; }
/* the left hand's GUARD is drawn like the pad's tiles (ADR-278): the same corner brackets, a fainter frame,
   and a lower resting opacity, so it sits in the picture instead of over it */
.tc-guard { opacity: 0.4; border-color: rgba(207, 214, 230, 0.07); }
.tc-guard::before { inset: 3px; opacity: 0.6; }
.tc-guard.on { opacity: 1; }
.tc-guard.on::before { opacity: 1; }
.tc-guard .s { display: none; }
.tc-guard::after {
  content: '';
  position: absolute;
  left: 7px;
  right: 7px;
  bottom: 4px;
  height: 2px;
  background: linear-gradient(90deg, #dfe7f5, #dfe7f5) left / calc(var(--tc-gd, 1) * 100%) 100% no-repeat, rgba(207, 214, 230, 0.16);
}
.tc-guard.low::after { background: linear-gradient(90deg, #ff9a5a, #ff9a5a) left / calc(var(--tc-gd, 1) * 100%) 100% no-repeat, rgba(255, 138, 61, 0.2); }
.tc-guard.low { border-color: rgba(255, 138, 61, 0.55); }
.tc-flask { box-sizing: border-box; }
/* top right, left of the small minimap (phones, either way up); sized with the screen (--tc-f) */
.tc-lock { right: calc(98px * var(--tc-f, 1)); top: 6px; width: calc(38px * var(--tc-f, 1)); height: calc(38px * var(--tc-f, 1)); }
.tc-pause { right: calc(54px * var(--tc-f, 1)); top: 6px; width: calc(38px * var(--tc-f, 1)); height: calc(38px * var(--tc-f, 1)); }
.tc-lock .g, .tc-pause .g { font-size: calc(16px * var(--tc-f, 1)); }
.tc-flask .g { font-size: calc(18px * var(--tc-k, 1)); }
.tc-flask .t, .tc-lock .t { font-size: calc(7.5px * var(--tc-k, 1)); letter-spacing: 0.12em; padding-left: 0.12em; }
.tc-lock .t { display: none; }
.tc-flask .g { color: var(--tc-gold); text-shadow: 0 0 6px rgba(216, 184, 106, 0.45); }

/* tablets: the minimap is full size there */
@media (min-height: 561px) and (min-width: 561px) {
  .tc-lock { right: 142px; top: 12px; }
  .tc-pause { right: 96px; top: 12px; }
}

/* ---------- the padlock: move the right-hand controls (ADR-270) ---------- */
.tc-padlock {
  position: absolute;
  box-sizing: border-box;
  padding: 7px;
  margin: 0;
  color: rgba(207, 214, 230, 0.55);
  background: transparent;
  border: 0;
  pointer-events: auto;
  touch-action: none;
  -webkit-appearance: none;
  appearance: none;
  outline: none;
  opacity: 0.34;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.15s, opacity 0.15s, background 0.15s;
}
.tc-padlock svg { display: block; }
.tc-root.editing .tc-padlock {
  opacity: 0.9;
  color: #ffd2a4;
}
.tc-root.off.peek .tc-padlock { opacity: 0; }
/* GUARD's padlock (ADR-278): only with the guard on the left hand */
.tc-guardlock { display: none; z-index: 2; }
.tc-root.lguard .tc-guardlock { display: block; }
.tc-root.editing .tc-guard { border-style: dashed; border-color: rgba(255, 138, 61, 0.7); background: rgba(255, 138, 61, 0.06); }
.tc-edit-hint {
  position: absolute;
  display: none;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  font-size: calc(9px * var(--tc-f, 1));
  letter-spacing: 0.24em;
  color: #ffd2a4;
  text-shadow: 0 1px 2px #000, 0 0 6px rgba(0, 0, 0, 0.9);
  pointer-events: none;
}
.tc-root.editing .tc-edit-hint { display: flex; }
.tc-edit-hint .t { animation: tc-blink 1.6s ease-in-out infinite; }
.tc-edit-reset {
  pointer-events: auto;
  touch-action: none;
  font: inherit;
  font-size: calc(9px * var(--tc-f, 1));
  letter-spacing: 0.18em;
  color: var(--tc-ink);
  background: rgba(6, 9, 14, 0.6);
  border: 1px solid rgba(207, 214, 230, 0.3);
  padding: 5px 9px;
  -webkit-appearance: none;
  appearance: none;
  outline: none;
}
/* the padlock open: the pad is a piece to drag, not buttons (dashed, ember, every tile awake) */
.tc-root.editing .tc-pad { outline: 1px dashed rgba(255, 138, 61, 0.7); outline-offset: -2px; background: rgba(255, 138, 61, 0.05); }
.tc-root.editing .tc-tile, .tc-root.editing .tc-flask { opacity: 0.9; border-style: dashed; border-color: rgba(255, 138, 61, 0.5); }
@keyframes tc-blink { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }

/* ---------- a screen held upright: the left thumb's zone is the lower left ---------- */
@media (orientation: portrait) {
  .tc-zone { width: 50%; height: 46%; }
}
/* SWIPE DODGE (ADR-271): the flick's mark, a short streak of chevrons that fades where the thumb went */
.tc-swipe {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  transform-origin: 10% 50%;
  font: 700 calc(15px * var(--tc-f, 1)) / 1 var(--ab-mono, ui-monospace, monospace);
  letter-spacing: 0.1em;
  color: #9ec8ff;
  text-shadow: 0 0 6px rgba(120, 170, 255, 0.6);
  opacity: 0;
  white-space: nowrap;
}
.tc-swipe.on { animation: tc-swipe 0.32s ease-out forwards; }
@keyframes tc-swipe { 0% { opacity: 0.95; } 100% { opacity: 0; } }

/* ---------- ADR-278: the owner's notes on the left side ----------
   No gauge line under either BLOCK (the HUD's GD meter has it; a low guard warms the glyph instead),
   ATTACK's dagger points down, and the stick and the left BLOCK drawn as one set (?leftLook=a|b|c). */
.tc-block::after, .tc-guard::after { display: none; }
.tc-block, .tc-guard { padding-bottom: 0; }
.tc-block.low .g, .tc-guard.low .g { color: #ffb27a; text-shadow: 0 0 8px rgba(255, 138, 61, 0.7), 0 1px 2px #000; }
.tc-block.low, .tc-guard.low { border-color: rgba(207, 214, 230, 0.13); }
.tc-attack .g { display: inline-block; transform: scaleY(-1); }
/* a: QUIET. The ring a faint dotted circle at the tiles' strength, the knob a bare '@' in small brackets;
   BLOCK only its corner brackets (no frame), at the stick's strength */
.look-a .tc-ring > span { color: rgba(207, 214, 230, 0.4); font-weight: 400; }
.look-a .tc-ring > span.c { color: rgba(207, 214, 230, 0.6); }
.look-a .tc-knob { background: none; border-color: transparent; }
.look-a .tc-stick.on .tc-knob { border-color: transparent; }
.look-a .tc-guard { border-color: transparent; opacity: 0.4; }
.look-a .tc-guard::before { inset: 6px; opacity: 0.55; }
/* b: A PAIR OF TILES. The stick sits in a square tile like the pad's (corner brackets, a faint frame),
   the ring's strokes are dots, and BLOCK is framed the same beside it: the left hand reads as two tiles */
.look-b .tc-disc { border-radius: 0; border: 1px solid rgba(207, 214, 230, 0.1); background: ${corners(CORNER, 10)}; }
.look-b .tc-ring > span:not(.c) { color: transparent; text-shadow: none; }
.look-b .tc-ring > span:not(.c)::after { content: '·'; color: rgba(207, 214, 230, 0.45); }
.look-b .tc-ring > span.l1:not(.c)::after, .look-b .tc-ring > span.l2:not(.c)::after { color: ${EMBER}; }
.look-b .tc-ring > span.c { color: rgba(207, 214, 230, 0.55); }
.look-b .tc-knob { background: rgba(6, 9, 14, 0.18); border-color: rgba(207, 214, 230, 0.13); }
.look-b .tc-guard { border-color: rgba(207, 214, 230, 0.13); opacity: 0.45; }
.look-b .tc-guard::before { inset: 3px; opacity: 0.6; }
/* c: GLYPHS ONLY. No ring at rest, just its four arrows; no box round the knob; BLOCK only its glyph
   and name, like a word written on the ground */
.look-c .tc-ring > span:not(.c) { opacity: 0; }
.look-c .tc-stick.on .tc-ring > span:not(.c) { opacity: 1; }
.look-c .tc-ring > span.c { color: rgba(207, 214, 230, 0.5); }
.look-c .tc-knob { background: none; border-color: transparent; }
.look-c .tc-knob::before { display: none; }
.look-c .tc-guard { border-color: transparent; opacity: 0.45; }
.look-c .tc-guard::before { display: none; }
.look-c .tc-guard.on { background: none; }
.look-c .tc-guard.on .g { color: #ffe2cc; }
`;

export function injectTouchStyle() {
  if (typeof document === 'undefined' || document.getElementById?.('ab-touch-style')) return;
  const style = document.createElement('style');
  style.id = 'ab-touch-style';
  style.textContent = CSS;
  (document.head ?? document.body)?.appendChild(style);
}
