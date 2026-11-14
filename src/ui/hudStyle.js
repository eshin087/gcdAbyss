import { TELL_STYLE } from '../combat/rules.js';

// HUD stylesheet, injected from JS so the module owns its look (style.css stays foundation-only).
// Ansenjeo-style MMO UI: tiny monospace text, thin 1px borders, translucent dark panels.
// Tell colours come from TELL_STYLE (src/combat/rules.js) so HUD, FX and the Lab agree.

/** '#rrggbb' -> 'rgba(r, g, b, a)'. */
function rgba(hex, a) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const n = parseInt(full, 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const BLUE = TELL_STYLE.blue.css;
const RED = TELL_STYLE.red.css;
const WHITE = TELL_STYLE.normal.css;
const CYAN = '#7ff6ff';

const CSS = `
.ab-root {
  --ab-ink: #cfd6e6;
  --ab-dim: #7d879c;
  --ab-faint: #4f586b;
  --ab-ember: #ff8a3d;
  --ab-blood: #b3261e;
  --ab-gold: #d8b86a;
  --ab-line: rgba(207, 214, 230, 0.18);
  --ab-panel: rgba(6, 9, 14, 0.72);
  --ab-mono: 'JetBrains Mono', 'Cascadia Mono', Consolas, 'Courier New', monospace;
  --ab-serif: 'Cinzel', 'Trajan Pro', Georgia, serif;
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  font-family: var(--ab-mono);
  font-size: 11px;
  line-height: 1.35;
  color: var(--ab-ink);
  letter-spacing: 0.02em;
  -webkit-font-smoothing: antialiased;
}
.ab-root * { box-sizing: border-box; }
.ab-panel {
  background: var(--ab-panel);
  border: 1px solid var(--ab-line);
}
.ab-play { transition: opacity 0.9s ease; }
.ab-root[data-state='title'] .ab-play { opacity: 0; }
.ab-root[data-state='dead'] .ab-play { opacity: 0.28; }

.ab-key {
  display: inline-block;
  min-width: 15px;
  padding: 0 4px;
  margin: 0 1px;
  border: 1px solid rgba(207, 214, 230, 0.38);
  border-radius: 2px;
  background: rgba(207, 214, 230, 0.05);
  color: #e8ecf5;
  font-size: 10px;
  line-height: 13px;
  text-align: center;
  letter-spacing: 0;
}

/* ---------- bars ---------- */
.ab-bar {
  position: relative;
  flex: 1;
  height: 6px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid var(--ab-line);
}
.ab-bar > .chunk,
.ab-bar > .fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  transform-origin: 0 50%;
  will-change: transform;
}
.ab-bar.hp > .fill { background: linear-gradient(180deg, #d4483c, #8a1912); }
.ab-bar.hp > .chunk { background: rgba(255, 228, 210, 0.78); }
.ab-bar.hp.low > .fill { animation: ab-pulse 0.9s ease-in-out infinite; }
.ab-bar.flash { animation: ab-flash 0.55s ease-out; }
@keyframes ab-pulse { 50% { filter: brightness(1.55); } }
@keyframes ab-flash {
  0%, 100% { border-color: var(--ab-line); box-shadow: none; }
  25% { border-color: #ff8a3d; box-shadow: 0 0 7px rgba(255, 138, 61, 0.75); }
}

/* ---------- player frame (top-left) ---------- */
.ab-pf {
  position: absolute;
  left: 14px;
  top: 12px;
  width: 252px;
  padding: 7px 10px 7px;
  z-index: 2;
}
.ab-pf-head { display: flex; justify-content: space-between; align-items: baseline; }
.ab-pf-name { font-size: 12px; font-weight: 700; letter-spacing: 0.16em; color: #eef1f8; }
.ab-pf-lv { font-size: 10px; color: var(--ab-dim); }
.ab-pf-sub { font-size: 10px; color: var(--ab-dim); margin: 0 0 6px; }
.ab-row { display: flex; align-items: center; gap: 6px; height: 14px; }
.ab-row .lbl { width: 16px; font-size: 10px; color: var(--ab-dim); }
.ab-row .val {
  width: 64px;
  text-align: right;
  font-size: 10px;
  color: var(--ab-ink);
  font-variant-numeric: tabular-nums;
}
.ab-row .val.dim { color: var(--ab-dim); }
.ab-pf-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; height: 15px; }
.ab-pips { display: inline-block; letter-spacing: 0.14em; font-size: 11px; }
.ab-pips .full { color: var(--ab-gold); text-shadow: 0 0 6px rgba(216, 184, 106, 0.45); }
.ab-pips .empty { color: #4a5263; }
.ab-pips.flash { animation: ab-shake 0.4s ease-out; }
@keyframes ab-shake {
  20% { transform: translateX(-2px); color: #ff8a3d; }
  40% { transform: translateX(2px); }
  60% { transform: translateX(-1px); }
}
.ab-lock {
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--ab-ember);
  opacity: 0;
  transition: opacity 0.18s;
}
.ab-lock.on { opacity: 1; }
/* crit window (after a Ghostep): hidden row that lights up cyan */
.ab-crit { margin-top: 2px; opacity: 0; transition: opacity 0.12s; }
.ab-crit.on { opacity: 1; }
.ab-crit .clbl {
  width: 64px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: ${CYAN};
  white-space: nowrap;
}
.ab-crit.on .clbl { animation: ab-crit-glow 0.5s ease-in-out infinite alternate; }
.ab-bar.crit { height: 4px; border-color: ${rgba(CYAN, 0.35)}; }
.ab-bar.crit > .fill {
  background: linear-gradient(90deg, ${rgba(CYAN, 0.55)}, ${CYAN});
  box-shadow: 0 0 6px ${rgba(CYAN, 0.8)};
}
@keyframes ab-crit-glow {
  from { text-shadow: 0 0 3px ${rgba(CYAN, 0.5)}; }
  to { text-shadow: 0 0 9px ${rgba(CYAN, 1)}, 0 0 2px #fff; }
}

/* ---------- minimap (top-right) ---------- */
.ab-map {
  position: absolute;
  right: 14px;
  top: 12px;
  width: 190px;
  padding: 6px 9px 7px;
  text-align: center;
  z-index: 2;
}
.ab-map-zone { font-size: 10px; letter-spacing: 0.22em; color: #e6ebf5; margin-bottom: 5px; }
.ab-map canvas { display: block; width: 170px; height: 170px; margin: 0 auto; }
.ab-map-line { font-size: 10px; color: var(--ab-dim); margin-top: 3px; font-variant-numeric: tabular-nums; }
.ab-map-line.fps { color: #9fd18b; display: none; }
.ab-map-line.fps.on { display: block; }

/* ---------- log (bottom-left) ---------- */
.ab-log {
  position: absolute;
  left: 14px;
  bottom: 14px;
  width: 330px;
  padding-bottom: 6px;
  z-index: 2;
}
.ab-tabs { display: flex; border-bottom: 1px solid var(--ab-line); pointer-events: auto; }
.ab-root[data-state='title'] .ab-tabs { pointer-events: none; }
.ab-tab {
  padding: 3px 9px;
  font-size: 10px;
  color: var(--ab-dim);
  cursor: pointer;
  border-right: 1px solid var(--ab-line);
}
.ab-tab:hover { color: var(--ab-ink); }
.ab-tab.on { color: #eef1f8; background: rgba(207, 214, 230, 0.07); }
.ab-lines {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-height: 118px;
  padding: 5px 9px 0;
}
.ab-ln {
  font-size: 11px;
  line-height: 15px;
  padding: 0.5px 0;
  word-break: break-word;
  animation: ab-in 0.25s ease-out, ab-age 1.4s ease 12s forwards;
}
.ab-ln .ts { color: var(--ab-faint); margin-right: 6px; }
.ab-ln .cnt { color: var(--ab-dim); margin-left: 6px; }
.ab-ln.ch-system { color: var(--ab-dim); }
.ab-ln.ch-combat { color: var(--ab-ink); }
.ab-ln.ch-combat b { color: #f4d7a6; font-weight: 700; }
.ab-ln.ch-warn { color: var(--ab-ember); }
.ab-ln.ch-warn b { font-weight: 700; }
.ab-ln.ch-lore { color: var(--ab-gold); }
@keyframes ab-in { from { opacity: 0; transform: translateX(-6px); } }
@keyframes ab-age { to { opacity: 0.32; } }

/* ---------- boss bar (bottom-centre) ---------- */
.ab-boss {
  position: absolute;
  left: 50%;
  bottom: 46px;
  width: min(44vw, calc(100vw - 700px));
  min-width: 280px;
  transform: translateX(-50%);
  opacity: 0;
  transition: opacity 1.1s ease;
  z-index: 3;
}
.ab-boss.on { opacity: 1; }
.ab-boss-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 4px; }
.ab-boss-name {
  font-family: var(--ab-serif);
  font-weight: 500;
  font-size: 13px;
  letter-spacing: 0.22em;
  color: #ebe3d3;
  text-shadow: 0 1px 2px #000, 0 0 10px rgba(0, 0, 0, 0.9);
  white-space: nowrap;
}
.ab-boss-dmg {
  font-size: 12px;
  color: #f4e8d0;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 2px #000, 0 0 8px rgba(0, 0, 0, 0.9);
  opacity: 0;
  transition: opacity 0.5s ease;
}
.ab-boss-dmg.on { opacity: 1; transition: opacity 0.06s; }
.ab-bar.boss { height: 7px; border-color: rgba(207, 214, 230, 0.26); background: rgba(12, 4, 4, 0.72); }
.ab-bar.boss > .fill { background: linear-gradient(180deg, #c7362b, #75130e); }
.ab-bar.boss > .chunk { background: rgba(238, 204, 150, 0.85); }
.ab-boss.p2 .ab-bar.boss > .fill { background: linear-gradient(180deg, #ffa24f, #c2410c); }
.ab-boss.p2 .ab-bar.boss { box-shadow: 0 0 9px rgba(255, 138, 61, 0.45); border-color: rgba(255, 138, 61, 0.45); }
.ab-boss.p3 .ab-bar.boss > .fill { background: linear-gradient(180deg, #fff0c4, #ff8f2a); }
.ab-boss.p3 .ab-bar.boss { box-shadow: 0 0 12px rgba(255, 210, 140, 0.55); border-color: rgba(255, 222, 170, 0.55); }
.ab-bar.boss > .tick { position: absolute; top: 0; bottom: 0; width: 1px; margin-left: -1px; background: rgba(255, 236, 214, 0.6); pointer-events: none; }
.ab-boss.p2 .ab-boss-name { color: #ffd2a4; }
/* posture: thin gold bar under the HP bar, grows from the centre toward a break */
.ab-boss-post { position: relative; display: flex; justify-content: center; margin-top: 3px; }
.ab-bar.post {
  flex: none;
  width: 62%;
  height: 4px;
  border-color: rgba(216, 184, 106, 0.3);
  background: rgba(10, 8, 2, 0.7);
  transition: box-shadow 0.12s, border-color 0.12s;
}
.ab-bar.post > .fill {
  transform-origin: 50% 50%;
  transform: scaleX(0);
  background: linear-gradient(180deg, #f3d98e, #a07a2a);
  transition: filter 0.12s;
}
.ab-bar.post.hot { border-color: rgba(255, 214, 120, 0.6); box-shadow: 0 0 6px rgba(255, 196, 90, 0.45); }
.ab-bar.post.hit > .fill { filter: brightness(1.8); }
.ab-bar.post.break { animation: ab-post-break 0.7s ease-out; }
@keyframes ab-post-break {
  0% { box-shadow: 0 0 0 rgba(255, 220, 140, 0); }
  15% { box-shadow: 0 0 16px rgba(255, 226, 150, 1); border-color: #fff3c9; }
  100% { box-shadow: 0 0 0 rgba(255, 220, 140, 0); }
}
.ab-broken {
  position: absolute;
  left: 50%;
  top: 100%;
  margin-top: 3px;
  transform: translateX(-50%);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4em;
  padding-left: 0.4em;
  color: #ffe09a;
  text-shadow: 0 0 8px rgba(255, 200, 90, 0.9), 0 1px 2px #000;
  opacity: 0;
  transition: opacity 0.15s;
}
.ab-boss.broken .ab-broken { opacity: 1; animation: ab-pulse 0.5s ease-in-out infinite; }
.ab-boss.broken .ab-bar.post > .fill { animation: ab-pulse 0.5s ease-in-out infinite; }

/* ---------- interaction prompt ---------- */
.ab-prompt {
  position: absolute;
  left: 50%;
  bottom: 94px;
  transform: translateX(-50%);
  padding: 5px 14px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.25s ease;
  z-index: 3;
}
.ab-prompt.on { opacity: 1; }
/* victory: the boss bar is gone and the record panel sits below centre, so drop "[R] Fight again" */
.ab-root[data-state='victory'] .ab-prompt { bottom: 40px; }

/* ---------- world-anchored name tags ---------- */
.ab-tags { position: absolute; inset: 0; overflow: hidden; z-index: 1; }
.ab-tag { position: absolute; left: 0; top: 0; visibility: hidden; will-change: transform; }
.ab-tag.on { visibility: visible; }
.ab-tag > span {
  display: block;
  transform: translate(-50%, -100%);
  font-size: 11px;
  white-space: nowrap;
  color: #f4f6fb;
  text-shadow: 0 0 2px #000, 0 1px 2px #000, 0 0 7px rgba(0, 0, 0, 0.9);
}
.ab-tag.foe > span { color: #ffd6c8; }

/* ---------- screen-edge cues: red (dodge-only timing flash) / cyan (Ghostep) ---------- */
.ab-edges { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.ab-edge { position: absolute; opacity: 0; will-change: opacity; }
.ab-edge.l { left: 0; top: 0; bottom: 0; width: 16vw; background: linear-gradient(90deg, ${rgba(RED, 0.55)}, ${rgba(RED, 0)}); }
.ab-edge.r { right: 0; top: 0; bottom: 0; width: 16vw; background: linear-gradient(270deg, ${rgba(RED, 0.55)}, ${rgba(RED, 0)}); }
.ab-edge.t { left: 0; right: 0; top: 0; height: 16vh; background: linear-gradient(180deg, ${rgba(RED, 0.5)}, ${rgba(RED, 0)}); }
.ab-edge.b { left: 0; right: 0; bottom: 0; height: 16vh; background: linear-gradient(0deg, ${rgba(RED, 0.5)}, ${rgba(RED, 0)}); }
.ab-edge-cool {
  position: absolute;
  inset: 0;
  opacity: 0;
  box-shadow: inset 0 0 18vh ${rgba(CYAN, 0.45)};
  background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 55%, ${rgba('#2a6f8a', 0.25)});
  will-change: opacity;
}

/* ---------- call-outs over the player + damage numbers ---------- */
.ab-calls { position: absolute; inset: 0; overflow: hidden; z-index: 2; }
.ab-call, .ab-num {
  position: absolute;
  left: 0;
  top: 0;
  visibility: hidden;
  transform-origin: 0 0;
  will-change: transform, opacity;
}
.ab-call.on, .ab-num.on { visibility: visible; }
.ab-call > .t, .ab-num > .t {
  position: relative;
  display: block;
  transform: translate(-50%, -100%);
  white-space: nowrap;
  font-weight: 800;
  text-shadow: 0 0 2px #000, 0 1px 2px #000;
}
.ab-call > .t { font-size: clamp(14px, 1.15vw, 19px); letter-spacing: 0.24em; padding-left: 0.24em; }
.ab-call > .streak {
  position: absolute;
  left: -70px;
  width: 140px;
  top: -11px;
  height: 2px;
  transform: scaleX(0);
  background: linear-gradient(90deg, ${rgba(CYAN, 0)}, ${rgba(CYAN, 0.95)} 45%, #ffffff 50%, ${rgba(CYAN, 0.95)} 55%, ${rgba(CYAN, 0)});
  box-shadow: 0 0 8px ${rgba(CYAN, 0.9)};
}
.ab-call.k-parry > .t { color: #fff6e6; text-shadow: 0 0 10px rgba(255, 226, 170, 0.95), 0 0 2px #000, 0 1px 2px #000; }
.ab-call.k-return > .t { color: #ffd98a; font-size: clamp(16px, 1.3vw, 22px); text-shadow: 0 0 12px rgba(255, 196, 90, 1), 0 0 24px rgba(255, 150, 40, 0.6), 0 0 2px #000; }
.ab-call.k-deflect > .t { color: #e8f4ff; font-size: clamp(16px, 1.3vw, 22px); text-shadow: 0 0 12px ${rgba(BLUE, 1)}, 0 0 24px ${rgba(BLUE, 0.6)}, 0 0 2px #000; }
.ab-call.k-ghostep > .t { color: ${CYAN}; font-size: clamp(16px, 1.3vw, 22px); font-style: italic; text-shadow: 0 0 12px ${rgba(CYAN, 1)}, -8px 0 10px ${rgba(CYAN, 0.45)}, 0 0 2px #000; }
.ab-call.k-gbreak > .t { color: #ff6a55; text-shadow: 0 0 10px ${rgba(RED, 0.95)}, 0 0 2px #000, 0 1px 2px #000; }
.ab-call.k-block > .t { color: #b9c3d8; font-size: 11px; font-weight: 700; letter-spacing: 0.3em; }
.ab-num > .t { font-size: 12px; color: #f2e9d8; font-variant-numeric: tabular-nums; }
.ab-num.k-heavy > .t { font-size: 14px; color: #ffd08a; }
.ab-num.k-crit > .t { font-size: clamp(15px, 1.2vw, 19px); color: ${CYAN}; text-shadow: 0 0 9px ${rgba(CYAN, 0.95)}, 0 0 2px #000, 0 1px 2px #000; }

/* ---------- small mid-screen banner (POSTURE BROKEN) ---------- */
.ab-mini {
  position: absolute;
  left: 50%;
  top: 34%;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translateX(-50%);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  z-index: 4;
}
.ab-mini.on { visibility: visible; }
.ab-mini .txt {
  display: flex;
  align-items: center;
  gap: 14px;
  font-family: var(--ab-serif);
  font-size: clamp(17px, 1.6vw, 26px);
  letter-spacing: 0.32em;
  padding-left: 0.32em;
  color: #ffe09a;
  white-space: nowrap;
  text-shadow: 0 0 14px rgba(255, 196, 90, 0.75), 0 1px 3px #000;
}
.ab-mini .txt::before,
.ab-mini .txt::after { content: ''; width: 70px; height: 1px; background: linear-gradient(90deg, rgba(255, 224, 154, 0), rgba(255, 224, 154, 0.85)); }
.ab-mini .txt::after { background: linear-gradient(270deg, rgba(255, 224, 154, 0), rgba(255, 224, 154, 0.85)); }
.ab-mini .sub { margin-top: 4px; font-size: 10px; letter-spacing: 0.3em; color: #d7c08a; text-shadow: 0 1px 2px #000; }
.ab-reticle > span {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin: -13px 0 0 -13px;
  font-size: 22px;
  line-height: 1;
  color: #fff4ea;
  text-shadow: 0 0 6px rgba(255, 138, 61, 0.95), 0 0 2px #000;
  /* centred by the negative margin; the base tag translate must not leak into the spin keyframes */
  transform: none;
  animation: ab-spin 2.6s linear infinite;
}
@keyframes ab-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* ---------- centre banners ---------- */
.ab-banner {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  opacity: 0;
  visibility: hidden;
  z-index: 5;
}
.ab-banner .band {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 160px;
  transform: translateY(-50%);
  background: linear-gradient(180deg, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.74) 30%, rgba(0, 0, 0, 0.74) 70%, rgba(0, 0, 0, 0));
}
.ab-banner .txt {
  position: relative;
  display: flex;
  align-items: center;
  gap: 22px;
  font-family: var(--ab-serif);
  font-weight: 500;
  white-space: nowrap;
  letter-spacing: var(--ls, 0.3em);
  will-change: transform;
}
.ab-banner .txt .t { padding-left: var(--ls, 0.3em); }
.ab-banner .sub {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  top: 50%;
  margin-top: 54px;
  font-size: 12px;
  letter-spacing: 0.32em;
  color: #b9b2a6;
  white-space: nowrap;
}
.ab-banner .sub.blink { animation: ab-blink 1.8s ease-in-out infinite; }
.ab-banner.k-death .txt {
  --ls: 0.34em;
  font-size: clamp(44px, 6.2vw, 96px);
  color: #b3261e;
  text-shadow: 0 0 26px rgba(130, 10, 6, 0.55);
}
.ab-banner.k-victory .txt {
  --ls: 0.22em;
  font-size: clamp(32px, 4.4vw, 68px);
  color: var(--ab-gold);
  text-shadow: 0 0 22px rgba(216, 184, 106, 0.35);
}
.ab-banner.k-bonfire .txt {
  --ls: 0.42em;
  font-size: clamp(30px, 3.6vw, 54px);
  color: #ffc27a;
  text-shadow: 0 0 20px rgba(255, 138, 61, 0.5);
}
.ab-banner.k-phase .txt {
  --ls: 0.24em;
  font-size: clamp(20px, 2.4vw, 34px);
  color: var(--ab-ember);
  text-shadow: 0 0 18px rgba(255, 90, 20, 0.65);
}
.ab-banner.k-area { top: 27%; }
.ab-banner.k-area .band { display: none; }
.ab-banner.k-area .txt {
  --ls: 0.5em;
  font-size: clamp(17px, 1.8vw, 27px);
  color: #ece5d6;
  text-shadow: 0 0 10px rgba(0, 0, 0, 0.9), 0 1px 2px #000;
}
.ab-banner.k-area .txt::before,
.ab-banner.k-area .txt::after {
  content: '';
  width: 90px;
  height: 1px;
  background: linear-gradient(90deg, rgba(236, 229, 214, 0), rgba(236, 229, 214, 0.75));
}
.ab-banner.k-area .txt::after { background: linear-gradient(270deg, rgba(236, 229, 214, 0), rgba(236, 229, 214, 0.75)); }
.ab-banner.k-area .sub { margin-top: 26px; font-size: 11px; color: #9a9384; }

/* ---------- victory record ---------- */
.ab-stats {
  position: absolute;
  left: 50%;
  top: calc(50% + 84px);
  width: 300px;
  padding: 9px 14px 10px;
  transform: translateX(-50%);
  opacity: 0;
  transition: opacity 1.2s ease;
  z-index: 6;
}
.ab-stats.on { opacity: 1; }
.ab-stats-title { text-align: center; font-size: 10px; letter-spacing: 0.3em; color: var(--ab-gold); margin-bottom: 6px; }
.ab-stats .row { display: flex; justify-content: space-between; font-size: 11px; line-height: 17px; }
.ab-stats .row .k { color: var(--ab-dim); }
.ab-stats .row .v { color: #eef1f8; font-variant-numeric: tabular-nums; }

/* ---------- help + hint ---------- */
.ab-help {
  position: absolute;
  right: 14px;
  top: 262px;
  width: 252px;
  padding: 8px 12px 10px;
  opacity: 0;
  transform: translateX(10px);
  transition: opacity 0.2s ease, transform 0.2s ease;
  z-index: 10; /* above the title overlay and the pause dimmer (H works on every screen) */
}
.ab-help.on { opacity: 1; transform: none; }
.ab-help-title { display: flex; justify-content: space-between; font-size: 10px; letter-spacing: 0.2em; color: var(--ab-dim); margin-bottom: 7px; }
.ab-hint { position: absolute; right: 14px; bottom: 12px; font-size: 10px; color: var(--ab-faint); z-index: 2; }
.ab-hint .ab-key { color: var(--ab-dim); border-color: rgba(207, 214, 230, 0.2); }
.ab-ctrls { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; text-align: left; font-size: 10.5px; }
.ab-ctrls .k { text-align: right; white-space: nowrap; }
.ab-ctrls .a { color: var(--ab-dim); line-height: 15px; }
.ab-help-sub { margin: 9px 0 3px; font-size: 10px; letter-spacing: 0.2em; color: var(--ab-dim); }
.ab-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 2px 14px; margin-top: 8px; font-size: 10.5px; color: var(--ab-dim); }
.ab-help .ab-legend { justify-content: flex-start; margin-top: 2px; }
.ab-legend .it { white-space: nowrap; }
.ab-legend b { font-weight: 800; }
.ab-legend .n b { color: #ffffff; text-shadow: 0 0 5px ${rgba(WHITE, 0.9)}, 0 0 10px ${rgba(WHITE, 0.5)}; }
.ab-legend .r b { color: ${RED}; text-shadow: 0 0 6px ${rgba(RED, 0.8)}; }
.ab-legend.title { margin-top: 12px; font-size: 11px; text-shadow: 0 1px 2px #000; }
.ab-legend .hint { color: ${CYAN}; opacity: 0.8; }

/* ---------- title ---------- */
.ab-title {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 15vh;
  background:
    radial-gradient(ellipse 72% 58% at 50% 58%, rgba(3, 5, 9, 0.2), rgba(3, 5, 9, 0.84) 82%),
    linear-gradient(180deg, rgba(3, 5, 9, 0.5), rgba(3, 5, 9, 0) 28%, rgba(3, 5, 9, 0) 58%, rgba(3, 5, 9, 0.88));
  transition: opacity 1.1s ease;
  z-index: 8;
}
.ab-title.off { opacity: 0; }
.ab-title.gone { display: none; }
.ab-logo {
  margin: 0;
  font-family: 'Cascadia Mono', Consolas, Menlo, 'DejaVu Sans Mono', 'Liberation Mono', monospace;
  font-size: clamp(11px, 1.55vw, 24px);
  line-height: 1.04;
  letter-spacing: 0;
  white-space: pre;
  background: linear-gradient(180deg, #f6f1e7 0%, #ddd6c6 38%, #ff9a4a 74%, #a3231a 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 16px rgba(255, 120, 40, 0.28));
}
.ab-title-rule {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  color: var(--ab-ember);
  font-size: 10px;
}
.ab-title-rule::before,
.ab-title-rule::after { content: ''; width: 120px; height: 1px; background: linear-gradient(90deg, rgba(207, 214, 230, 0), rgba(207, 214, 230, 0.45)); }
.ab-title-rule::after { background: linear-gradient(270deg, rgba(207, 214, 230, 0), rgba(207, 214, 230, 0.45)); }
.ab-title-sub { margin-top: 12px; font-size: 12px; letter-spacing: 0.28em; color: #d9dfec; text-shadow: 0 1px 3px #000; }
/* the stage picker (levels/index.js): the current stage lit, another one reloads into it */
.ab-stage { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 16px; pointer-events: auto; }
.ab-stage .ab-btn { display: inline-flex; justify-content: center; width: auto; min-height: 0; margin: 0; font-size: 10.5px; letter-spacing: 0.16em; padding: 6px 12px; color: var(--ab-dim); border-color: rgba(207, 214, 230, 0.18); }
.ab-stage .ab-btn.on { color: #f2e7d2; border-color: var(--ab-ember); text-shadow: 0 0 8px rgba(255, 138, 61, 0.45); cursor: default; }
.ab-press {
  margin-top: 34px;
  font-size: 12px;
  letter-spacing: 0.42em;
  padding-left: 0.42em;
  color: #f2e7d2;
  text-shadow: 0 0 10px rgba(255, 138, 61, 0.4);
  animation: ab-blink 1.8s ease-in-out infinite;
}
.ab-title-ctrl {
  margin-top: 26px;
  max-width: min(780px, 92vw);
  text-align: center;
  font-size: 10.5px;
  line-height: 22px;
  color: var(--ab-dim);
  text-shadow: 0 1px 2px #000;
}
.ab-title-ctrl .item { white-space: nowrap; margin: 0 7px; }
.ab-credit {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 14px;
  text-align: center;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--ab-faint);
}
@keyframes ab-blink { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }

/* ---------- pause ---------- */
.ab-pause {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(2, 3, 6, 0.58);
  z-index: 9;
}
.ab-pause.on { display: flex; }
.ab-pause-panel { width: 360px; padding: 18px 22px 16px; text-align: center; pointer-events: auto; }
.ab-pause-title {
  font-family: var(--ab-serif);
  font-size: 22px;
  letter-spacing: 0.5em;
  padding-left: 0.5em;
  color: #ebe3d3;
  margin-bottom: 14px;
}
.ab-btn {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin: 6px 0;
  padding: 7px 10px;
  font: inherit;
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--ab-ink);
  background: rgba(207, 214, 230, 0.04);
  border: 1px solid var(--ab-line);
  cursor: pointer;
  pointer-events: auto;
  outline: none;
}
.ab-btn:hover { color: #fff; border-color: rgba(255, 138, 61, 0.6); background: rgba(255, 138, 61, 0.08); }
.ab-btn.primary { justify-content: center; gap: 8px; color: #fff; }
.ab-btn .v { color: var(--ab-gold); }
.ab-sep { height: 1px; margin: 14px 0 12px; background: var(--ab-line); }

/* ---------- gamepad in use (src/ui/gamepad.js adds html.abyss-pad) ---------- */
html:not(.abyss-pad) .pad-only { display: none !important; }
html.abyss-pad .kb-only, html.abyss-pad .tp-only { display: none !important; }
.ab-touch:not(.ab-pad) .ab-nontouch { display: none !important; }
.ab-btn.pad-focus { color: #fff; border-color: var(--ab-ember); background: rgba(255, 138, 61, 0.12); box-shadow: 0 0 0 1px rgba(255, 138, 61, 0.35); }
.ab-stage .ab-btn.pad-focus { color: #f2e7d2; border-color: var(--ab-ember); }

/* ---------- the CONTROLS (remap) panel: src/ui/remap.js ---------- */
.ab-pause.remap .ab-pause-panel { display: none; }
.ab-remap { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(2, 3, 6, 0.58); z-index: 10; }
.ab-remap.on { display: flex; }
.ab-remap-panel { width: 400px; max-height: calc(100% - 24px); overflow-y: auto; padding: 18px 22px 14px; text-align: center; pointer-events: auto; }
.ab-remap-tabs { display: flex; gap: 8px; margin-bottom: 8px; }
.ab-remap-tabs .ab-btn { justify-content: center; margin: 0; color: var(--ab-dim); }
.ab-remap-tabs .ab-btn.on { color: #fff; border-color: var(--ab-ember); }
.ab-remap-list .ab-btn { margin: 3px 0; padding: 5px 10px; font-size: 10.5px; }
.ab-remap-list .ab-btn .n { color: var(--ab-dim); }
.ab-remap-list .ab-btn .v { color: var(--ab-gold); letter-spacing: 0.08em; }
.ab-remap-list .ab-btn.wait { border-color: var(--ab-ember); background: rgba(255, 138, 61, 0.1); }
.ab-remap-list .ab-btn.wait .v { color: #fff; animation: ab-blink 1.2s ease-in-out infinite; }
.ab-remap-hint { margin: 8px 0 4px; min-height: 14px; font-size: 10px; color: var(--ab-faint); letter-spacing: 0.06em; }
.ab-remap-hint.warn { color: var(--ab-ember); }
.ab-remap-foot { display: flex; gap: 8px; }
.ab-remap-foot .ab-btn { justify-content: center; margin: 4px 0 0; }
.ab-remap-foot .ab-btn.dim { opacity: 0.45; }

/* ---------- touch devices (src/ui/touch.js adds .ab-touch; desktop never gets it) ---------- */
.ab-root:not(.ab-touch) .tp-only { display: none !important; }
.ab-touch .kb-only { display: none !important; }
.ab-touch .ab-log, .ab-touch .ab-help { display: none; }
/* the interaction prompt is a tap target ("[E] Rest" → TAP › Rest at bonfire) */
.ab-touch .ab-prompt { bottom: 40px; z-index: 7; padding: 9px 16px; border-color: rgba(255, 138, 61, 0.55); }
.ab-touch .ab-prompt.on { pointer-events: auto; touch-action: none; }
.ab-touch .ab-prompt .ab-key { display: none; }
.ab-touch .ab-prompt::before { content: 'TAP \\203A  '; color: var(--ab-ember); letter-spacing: 0.14em; }
.ab-touch .ab-pause-panel { max-height: calc(100% - 16px); overflow-y: auto; touch-action: pan-y; overscroll-behavior: contain; }
.ab-touch .ab-btn { min-height: 38px; }
/* phones in landscape (~360-430 px tall): scale the panels down, keep the thumbs' corners free */
@media (max-height: 560px) {
  .ab-touch { font-size: 10px; }
  .ab-touch .ab-pf { left: 8px; top: 6px; transform: scale(0.8); transform-origin: 0 0; }
  .ab-touch .ab-map { right: 8px; top: 6px; transform: scale(0.6); transform-origin: 100% 0; }
  .ab-touch .ab-boss { bottom: 10px; width: min(38vw, 380px); min-width: 0; }
  .ab-touch .ab-boss-name { font-size: 10px; letter-spacing: 0.12em; overflow: hidden; text-overflow: ellipsis; }
  .ab-touch .ab-boss-head { margin-bottom: 2px; }
  .ab-touch .ab-banner .band { height: 112px; }
  .ab-touch .ab-banner .sub { margin-top: 40px; font-size: 10px; }
  .ab-touch .ab-banner.k-area { top: 22%; }
  .ab-touch .ab-banner.k-area .sub { margin-top: 20px; }
  .ab-touch .ab-banner.k-victory { top: 24%; }
  .ab-touch .ab-stats { top: calc(24% + 44px); padding: 6px 12px 7px; }
  .ab-touch .ab-stats .row { line-height: 15px; font-size: 10px; }
  .ab-touch[data-state='victory'] .ab-prompt { bottom: 10px; }
  .ab-touch .ab-mini { top: 22%; }
  .ab-touch .ab-title { padding-top: 0; }
  .ab-touch .ab-logo { font-size: clamp(8px, 1.45vw, 15px); }
  .ab-touch .ab-title-rule { margin-top: 8px; }
  .ab-touch .ab-title-sub { margin-top: 6px; font-size: 10px; }
  .ab-touch .ab-press { margin-top: 16px; }
  .ab-touch .ab-title-ctrl { margin-top: 10px; font-size: 9.5px; line-height: 17px; }
  .ab-touch .ab-legend.title { margin-top: 6px; font-size: 9.5px; }
  .ab-touch .ab-credit { bottom: 5px; font-size: 9px; }
  /* below the floating LAB toggle (top centre, 36 px) when the Lab is in the page */
  .ab-touch .ab-pause { align-items: flex-end; padding-bottom: 6px; }
  .ab-touch .ab-pause-panel { width: min(420px, 92vw); max-height: calc(100% - 54px); padding: 10px 16px 12px; }
  .ab-touch .ab-pause-title { font-size: 16px; margin-bottom: 6px; }
  .ab-touch .ab-btn { margin: 5px 0; padding: 0 10px; }
  .ab-touch .ab-sep { margin: 9px 0 8px; }
  .ab-touch .ab-ctrls { font-size: 10px; }
}
`;

export function injectHudStyle() {
  if (document.getElementById('ab-hud-style')) return;
  const style = document.createElement('style');
  style.id = 'ab-hud-style';
  style.textContent = CSS;
  document.head.appendChild(style);
}
