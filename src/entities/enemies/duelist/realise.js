// A duelist's moves, realised: shared by every boss built on duelist.js (the Ash Disciple, the
// Starless Lord). The data format is the Ash Disciple's (ashDisciple/moves.js header): a MOVE is
// { label, phase, weight [per phase], cooldown, band, recovery, recoveryKeys, beats }, a BEAT one hit,
// feint or cast with its tell, windup, optional bait hold, active frames, zone, root motion and pose
// keys. Two additions for longer, more varied strings:
//   { pick: [beat, beat, ...] }   in place of a beat: one alternative is drawn as the move starts
//   fixed: true                   on a beat: its windup is not scaled by the phase (a cast, a transition)

/** Value for the phase (1-based) from a per-phase array, or the value itself. */
export function perPhase(v, phase) {
  return Array.isArray(v) ? v[Math.min(v.length, Math.max(1, phase)) - 1] : v;
}

/**
 * The realiser for one boss: realise(name, phase, rnd) → a move as it will play this time: phase
 * scaling, drawn alternatives, rolled chances, the bait holds, absolute times per beat ({ start,
 * impact, end, flash, tellAt }) and the compiled clip. `rnd` = a 0..1 source (the game's Math.random,
 * so the seeded sims replay). `compileClip(keys, dur, phase)` → the clip (poses.js).
 */
export function makeRealise({ TUNING, MOVES, compileClip }) {
  return function realise(name, phase = 1, rnd = Math.random) {
    const def = MOVES[name];
    if (!def) return null;
    const ws = perPhase(TUNING.windupScale, phase), rs = perPhase(TUNING.recoveryScale, phase);
    const lead = perPhase(TUNING.flashLead, phase);
    const beats = [];
    const keys = [];
    let t = 0;
    def.beats.forEach((raw, i) => {
      const b = Array.isArray(raw.pick) ? raw.pick[Math.min(raw.pick.length - 1, Math.floor(rnd() * raw.pick.length))] : raw;
      if (b.chance !== undefined && b.chance < 1 && !(rnd() < b.chance)) return;
      const W = b.windup * (b.fixed ? 1 : ws);
      const H = Array.isArray(b.hold) ? b.hold[0] + (b.hold[1] - b.hold[0]) * rnd() : 0;
      const A = b.active;
      const cock = b.cock ?? 0.8;
      const start = t, impact = t + W + H, end = impact + A;
      const at = (u) => (u <= 1 ? (u <= cock ? start + u * W : start + cock * W + H + (u - cock) * W) : impact + (u - 1) * A);
      for (const [u, pose] of b.keys ?? []) keys.push({ t: at(u), ...pose });
      const C = TUNING.close;
      const close = b.close ?? (b.dash || b.leap || b.release || !b.zone ? 0 : beats.length === 0 ? C.first : C.next);
      beats.push({
        def: b, index: i, hit: beats.length, start, impact, end, W, H, A, at, close,
        tellAt: start, flash: impact - lead, feint: !!b.feint,
        announced: false, flashed: false, done: false, landed: false,
      });
      t = end;
    });
    // the realised hits (not feints) get their hit index; `last` = the move's last real hit
    let n = 0;
    for (const b of beats) if (!b.feint) b.hit = n++;
    const hits = n;
    for (const b of beats) b.last = !b.feint && b.hit === hits - 1;
    const recovery = def.recovery * rs;
    const end = t + recovery;
    for (const [r, pose] of def.recoveryKeys ?? []) keys.push({ t: t + r * recovery, ...pose });
    const clip = compileClip(keys, end, phase);
    clip.name = name;
    return { name, def, beats, hits, recoveryStart: t, end, clip, phase };
  };
}
