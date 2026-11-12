// The boss's names for the HUD's lines, from its full name ("VAELGRIM, THE CINDER WYRM",
// "SHEN HUI, THE ASH DISCIPLE"): `short` = before the comma, title-cased ("Vaelgrim", "Shen Hui");
// `title` = after it ("the Cinder Wyrm", "the Ash Disciple").
const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w);

export function bossNames(full) {
  const s = String(full || 'VAELGRIM, THE CINDER WYRM');
  const [a, b] = s.split(',');
  const short = (a ?? '').trim().split(/\s+/).map(cap).join(' ') || 'Vaelgrim';
  const words = (b ?? '').trim().split(/\s+/).filter(Boolean).map((w, i) => (i === 0 && w.toLowerCase() === 'the' ? 'the' : cap(w)));
  return { short, title: words.join(' ') || 'the foe' };
}
