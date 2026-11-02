// Touch-controls stylesheet, injected from JS (style.css stays foundation-only). Matches the HUD:
// JetBrains Mono, dark translucent panels, thin light borders, ember accents; the stick is an ASCII
// ring of glyphs around an '@' knob and every button wears HUD-style corner brackets.

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
html.abyss-touch, html.abyss-touch body {
  touch-action: none;
  overscroll-behavior: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
/* phones render at DPR 1 on LOW: upscale the ASCII frame with crisp pixels, not a blur */
html.abyss-touch #game { cursor: default; image-rendering: pixelated; }
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
  opacity: 0.62;
  transition: opacity 0.2s ease;
  will-change: transform;
}
.tc-stick.on { opacity: 0.95; transition: opacity 0.05s; }
.tc-disc {
  position: absolute;
  left: -64px;
  top: -64px;
  width: 128px;
  height: 128px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(6, 9, 14, 0.5) 0%, rgba(6, 9, 14, 0.38) 62%, rgba(6, 9, 14, 0) 72%);
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
  background: rgba(6, 9, 14, 0.72);
  border: 1px solid ${LINE};
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
  background: rgba(6, 9, 14, 0.46);
  border: 1px solid ${LINE};
  border-radius: 0;
  pointer-events: auto;
  touch-action: none;
  -webkit-appearance: none;
  appearance: none;
  outline: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.08s, border-color 0.08s, opacity 0.2s;
}
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
  text-shadow: 0 1px 2px #000;
}
.tc-btn .t {
  font-size: 8px;
  line-height: 10px;
  letter-spacing: 0.2em;
  padding-left: 0.2em;
  color: var(--tc-dim);
  white-space: pre;
}
.tc-btn .s { font-size: 7px; line-height: 9px; letter-spacing: 0.08em; color: rgba(125, 135, 156, 0.75); white-space: nowrap; }
.tc-btn.on {
  background: rgba(255, 138, 61, 0.2);
  border-color: rgba(255, 138, 61, 0.75);
}
.tc-btn.on::before { background: ${corners(EMBER, 8)}; }
.tc-btn.on .g { color: #ffe2cc; text-shadow: 0 0 10px rgba(255, 138, 61, 0.95), 0 1px 2px #000; }
.tc-btn.on .t { color: #ffd2a4; }
.tc-btn.dim { opacity: 0.45; }
.tc-btn.lit { border-color: rgba(255, 138, 61, 0.6); }
.tc-btn.lit .g { color: ${EMBER}; text-shadow: 0 0 8px rgba(255, 138, 61, 0.8); }

.tc-attack { right: 24px; bottom: 26px; width: 84px; height: 84px; }
.tc-attack .g { font-size: 34px; }
.tc-attack .t { font-size: 9px; }
.tc-attack.charge .t { color: var(--tc-gold); letter-spacing: 0.04em; padding-left: 0; }
.tc-attack.full .t { color: #fff3c9; text-shadow: 0 0 6px rgba(216, 184, 106, 0.9); }
.tc-dodge { right: 124px; bottom: 18px; width: 62px; height: 62px; }
.tc-block { right: 34px; bottom: 126px; width: 62px; height: 62px; }
.tc-flask { right: 122px; bottom: 102px; width: 44px; height: 44px; }
.tc-lock { right: 112px; bottom: 166px; width: 44px; height: 44px; }
.tc-pause { right: 142px; top: 10px; width: 40px; height: 40px; }
.tc-flask .g, .tc-lock .g, .tc-pause .g { font-size: 16px; }
.tc-flask .t, .tc-lock .t { font-size: 7px; letter-spacing: 0.12em; padding-left: 0.12em; }
.tc-flask .g { color: var(--tc-gold); text-shadow: 0 0 6px rgba(216, 184, 106, 0.45); }

/* taller phones / tablets: a little more room */
@media (min-height: 561px) {
  .tc-attack { right: 36px; bottom: 40px; width: 96px; height: 96px; }
  .tc-dodge { right: 150px; bottom: 30px; width: 68px; height: 68px; }
  .tc-block { right: 50px; bottom: 152px; width: 68px; height: 68px; }
  .tc-flask { right: 148px; bottom: 122px; }
  .tc-lock { right: 136px; bottom: 196px; }
  .tc-pause { right: 218px; top: 12px; }
}

/* ---------- portrait: rotate your phone ---------- */
.tc-rotate {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 24px;
  text-align: center;
  pointer-events: auto;
  touch-action: none;
  font-family: 'JetBrains Mono', 'Cascadia Mono', Consolas, 'Courier New', monospace;
  color: #cfd6e6;
  background:
    radial-gradient(ellipse 80% 60% at 50% 45%, rgba(40, 18, 8, 0.35), rgba(3, 5, 9, 0) 70%),
    rgba(3, 5, 9, 0.97);
}
.tc-rotate.on { display: flex; }
.tc-phone {
  margin: 0;
  font-family: 'JetBrains Mono', 'Cascadia Mono', Consolas, 'Courier New', monospace;
  font-size: 15px;
  line-height: 1.1;
  white-space: pre;
  color: #ddd6c6;
  text-shadow: 0 0 10px rgba(255, 138, 61, 0.35);
  animation: tc-turn 2.6s ease-in-out infinite;
}
.tc-phone b { color: ${EMBER}; font-weight: 700; }
@keyframes tc-turn {
  0%, 18% { transform: rotate(0deg); }
  48%, 72% { transform: rotate(-90deg); }
  100% { transform: rotate(0deg); }
}
.tc-rotate .h {
  font-family: 'Cinzel', 'Trajan Pro', Georgia, serif;
  font-size: 18px;
  letter-spacing: 0.32em;
  padding-left: 0.32em;
  color: #ebe3d3;
  text-shadow: 0 0 14px rgba(255, 138, 61, 0.35);
}
.tc-rotate .rule { color: ${EMBER}; font-size: 10px; letter-spacing: 0.6em; padding-left: 0.6em; }
.tc-rotate .sub { font-size: 11px; letter-spacing: 0.16em; color: #7d879c; }
`;

export function injectTouchStyle() {
  if (typeof document === 'undefined' || document.getElementById?.('ab-touch-style')) return;
  const style = document.createElement('style');
  style.id = 'ab-touch-style';
  style.textContent = CSS;
  (document.head ?? document.body)?.appendChild(style);
}
