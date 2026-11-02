// Lab stylesheet, injected from JS so the dev module owns its look (style.css stays foundation-only).
// Matches the HUD: tiny monospace text, 1px light borders, dark translucent panels.

import { TELL_STYLE } from '../combat/rules.js';

const CSS = `
.lab-root, .lab-badge {
  --lab-ink: #cfd6e6;
  --lab-dim: #7d879c;
  --lab-faint: #4f586b;
  --lab-line: rgba(207, 214, 230, 0.18);
  --lab-panel: rgba(6, 9, 14, 0.86);
  --lab-ember: #ff8a3d;
  --lab-blue: ${TELL_STYLE.blue.css};
  --lab-red: ${TELL_STYLE.red.css};
  --lab-normal: ${TELL_STYLE.normal.css};
  --lab-good: #9fd18b;
  --lab-mid: #e8c170;
  --lab-bad: #ff8f84;
  --lab-mono: 'JetBrains Mono', 'Cascadia Mono', Consolas, 'Courier New', monospace;
  font-family: var(--lab-mono);
  color: var(--lab-ink);
  letter-spacing: 0.02em;
  -webkit-font-smoothing: antialiased;
  user-select: none;
  -webkit-user-select: none;
}
/* below the HUD player frame (top 12px, ~102px tall with the crit row); above the HUD layers */
.lab-root {
  position: absolute;
  left: 14px;
  top: 124px;
  z-index: 40;
  width: 312px;
  max-height: calc(100% - 136px);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-y; /* phones: the panel scrolls even though the game blocks page panning */
  -webkit-overflow-scrolling: touch;
  pointer-events: auto;
  font-size: 11px;
  line-height: 1.35;
  background: var(--lab-panel);
  border: 1px solid var(--lab-line);
  scrollbar-width: thin;
  scrollbar-color: rgba(207, 214, 230, 0.25) transparent;
}
.lab-root *, .lab-badge * { box-sizing: border-box; }
.lab-root.lab-hidden, .lab-badge.lab-hidden { display: none; }

.lab-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px 4px 8px;
  background: rgba(6, 9, 14, 0.97);
  border-bottom: 1px solid var(--lab-line);
}
.lab-title { font-weight: 700; font-size: 12px; letter-spacing: 0.24em; color: var(--lab-ember); }
.lab-hint { flex: 1; font-size: 10px; color: var(--lab-faint); white-space: nowrap; }
.lab-head .lab-btn { padding: 0 6px; line-height: 15px; }
.lab-head .lab-close { min-width: 24px; font-size: 14px; line-height: 17px; }
.lab-status {
  padding: 3px 8px;
  font-size: 10px;
  color: var(--lab-dim);
  border-bottom: 1px solid var(--lab-line);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lab-status.ok { color: var(--lab-good); }
.lab-status.warn { color: var(--lab-mid); }
.lab-status.err { color: var(--lab-red); }

.lab-sec + .lab-sec { border-top: 1px solid var(--lab-line); }
.lab-sec-h {
  display: flex;
  justify-content: space-between;
  padding: 4px 8px;
  font-size: 10px;
  letter-spacing: 0.22em;
  color: var(--lab-dim);
  cursor: pointer;
}
.lab-sec-h:hover { color: var(--lab-ink); background: rgba(207, 214, 230, 0.04); }
.lab-sec.closed .lab-sec-b { display: none; }
.lab-sec-b { padding: 2px 8px 8px; }

.lab-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3px; }
.lab-grid.c4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.lab-grid.c5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.lab-grid.c6 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
/* model viewer: every HUD layer fades out (opacity, so HUD rules that force visibility on
   descendants cannot leak through); the Lab panel stays */
#ui.lab-mv > :not(.lab-root):not(.lab-badge) { opacity: 0 !important; pointer-events: none !important; }
.lab-btn {
  appearance: none;
  margin: 0;
  padding: 3px 5px;
  min-width: 0;
  font: inherit;
  font-size: 11px;
  line-height: 14px;
  color: var(--lab-ink);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: rgba(207, 214, 230, 0.05);
  border: 1px solid var(--lab-line);
  border-radius: 0;
  cursor: pointer;
}
.lab-btn:hover { background: rgba(207, 214, 230, 0.11); border-color: rgba(207, 214, 230, 0.42); }
.lab-btn:active { background: rgba(255, 138, 61, 0.22); }
.lab-btn.on { color: #ffe2cc; border-color: var(--lab-ember); background: rgba(255, 138, 61, 0.16); }
.lab-btn.danger { color: #ffb0a8; border-color: rgba(255, 74, 58, 0.45); }
.lab-btn.na { opacity: 0.4; }

.lab-abs { display: flex; flex-direction: column; gap: 2px; }
.lab-ab { display: flex; align-items: center; gap: 6px; text-align: left; }
.lab-ab.sel { border-color: var(--lab-ember); background: rgba(255, 138, 61, 0.1); }
.lab-ab .k { width: 9px; flex: none; color: var(--lab-faint); font-size: 10px; }
.lab-ab .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.lab-ab .ph { flex: none; font-size: 10px; color: var(--lab-dim); letter-spacing: 0.08em; }
.lab-chip {
  display: inline-block;
  flex: none;
  width: 8px;
  height: 8px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: var(--lab-normal);
}
.lab-chip.t-blue { background: var(--lab-blue); border-color: var(--lab-blue); box-shadow: 0 0 5px var(--lab-blue); }
.lab-chip.t-red { background: var(--lab-red); border-color: var(--lab-red); box-shadow: 0 0 5px var(--lab-red); }
.lab-chip.t-none { background: transparent; border-color: var(--lab-faint); }

.lab-row { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
.lab-row > .lab-btn { flex: none; }
.lab-lbl { flex: none; color: var(--lab-dim); font-size: 10px; }
.lab-val { flex: none; min-width: 36px; text-align: right; font-size: 10px; font-variant-numeric: tabular-nums; }
.lab-grow { flex: 1; min-width: 0; font-size: 10px; color: var(--lab-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lab-range { flex: 1; min-width: 0; height: 14px; margin: 0; accent-color: var(--lab-ember); cursor: pointer; background: transparent; }
.lab-note { margin-top: 5px; font-size: 10px; color: var(--lab-faint); }
.lab-legend { display: flex; gap: 10px; margin-top: 5px; font-size: 10px; color: var(--lab-dim); }
.lab-legend .c { color: #55e0ff; }
.lab-legend .r { color: var(--lab-red); }
.lab-legend .w { color: var(--lab-ink); }

.lab-sub {
  margin: 7px 0 3px;
  font-size: 10px;
  letter-spacing: 0.24em;
  color: var(--lab-dim);
  border-bottom: 1px dashed rgba(207, 214, 230, 0.12);
}
.lab-kv { display: grid; grid-template-columns: 62px minmax(0, 1fr); column-gap: 6px; font-size: 11px; line-height: 15px; }
.lab-kv .k { color: var(--lab-dim); }
.lab-kv .v { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.lab-next { font-size: 10px; line-height: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lab-bar { font-size: 10px; line-height: 14px; letter-spacing: 0; white-space: pre; color: var(--lab-faint); }
.lab-bar .w { color: var(--lab-normal); }
.lab-bar.t-blue .w { color: var(--lab-blue); }
.lab-bar.t-red .w { color: var(--lab-red); }
.lab-bar .e { color: var(--lab-ink); }
.lab-res { display: flex; gap: 5px; align-items: baseline; font-size: 10px; line-height: 14px; }
.lab-res .lab-chip { align-self: center; }
.lab-res .tx { flex: 1; min-width: 0; color: var(--lab-dim); }
.lab-res.good .tx { color: var(--lab-good); }
.lab-res.mid .tx { color: var(--lab-mid); }
.lab-res.bad .tx { color: var(--lab-bad); }
.lab-res .dr { flex: none; color: var(--lab-faint); }
.lab-res .dr.off { color: var(--lab-mid); }
.lab-ev { font-size: 10px; line-height: 14px; white-space: pre; overflow: hidden; text-overflow: ellipsis; color: var(--lab-dim); }
.lab-ev .ts { color: var(--lab-faint); }
.lab-ev .nm { color: var(--lab-ink); }
.lab-ev.t-blue .nm { color: var(--lab-blue); }
.lab-ev.t-red .nm { color: var(--lab-red); }

.lab-badge {
  position: absolute;
  left: 50%;
  top: 8px;
  z-index: 41;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  min-height: 22px;
  padding: 2px 10px;
  font-size: 10px;
  line-height: 14px;
  font-weight: 700;
  letter-spacing: 0.16em;
  white-space: nowrap;
  color: var(--lab-ember);
  background: rgba(6, 9, 14, 0.8);
  border: 1px solid rgba(255, 138, 61, 0.45);
  pointer-events: auto;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.lab-badge:hover { background: rgba(255, 138, 61, 0.12); border-color: rgba(255, 138, 61, 0.7); }
.lab-badge.open { color: #ffe2cc; background: rgba(255, 138, 61, 0.16); border-color: var(--lab-ember); }
.lab-badge.cheats { font-weight: 400; letter-spacing: 0.08em; }

/* touch screens: finger-sized toggle and close button */
@media (pointer: coarse) {
  .lab-badge { min-width: 64px; min-height: 36px; padding: 0 14px; font-size: 11px; }
  .lab-head .lab-close { min-width: 36px; min-height: 36px; font-size: 18px; }
}
html.abyss-touch .lab-badge { min-width: 64px; min-height: 36px; padding: 0 14px; font-size: 11px; }
html.abyss-touch .lab-head .lab-close { min-width: 36px; min-height: 36px; font-size: 18px; }
html.abyss-touch .lab-hint { display: none; }

/* small screens (phones in landscape): compact panel that always fits, scrolling inside */
@media (max-height: 560px), (max-width: 700px) {
  .lab-root { width: min(296px, calc(100vw - 12px)); max-height: calc(100% - 130px); font-size: 10px; }
  .lab-sec-h { padding: 6px 8px; }
  .lab-btn { padding: 4px 4px; font-size: 10px; }
  .lab-hint { display: none; }
  html.abyss-touch .lab-root { left: 6px; top: 86px; max-height: calc(100% - 92px); }
}
`;

const STYLE_ID = 'abyss-lab-style';

export function injectLabStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById?.(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  (document.head ?? document.body)?.appendChild(s);
}
