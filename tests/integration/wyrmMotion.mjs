// The wyrm's motion audit (opt-in: integ.mjs `wyrmmotion`; 2026-11-28, the owner: "there are still some weird
// dragon animations and movement that looks unnatural and off ... analyze all the movements and flag the ones to
// be fixed"). Every move and every state, frame by frame, measured for what a heavy four-legged winged animal
// does not do:
//   pop     the worst one-frame change of velocity of a part (m/s gained in one frame): a snap, a teleport
//   speed   the fastest a part moves (m/s)
//   hinge   the head off the neck's last segment (deg); bend: the sharpest bend between two neck segments
//   tailK   the sharpest bend between two tail segments (deg)
//   slide   a planted foot (toe within 0.12 m of the ground, slow) skating on it (m, the worst foot, summed)
//   under   the lowest any part goes below the ground (m)
//   inside  a paw or the snout inside the trunk (the chest - hips line, m deep past its radius)
//   spin    the body turning in place (deg/s of yaw while the root moves < 0.4 m/s, worst 0.25 s)
//   stretch a limb's bone longer or shorter than at rest (x its rest length, worst)
//   wingG   a wing's finger tip below the ground (m)
// Each row is one move or state; `flags` names what crossed its limit.

export const LIMITS = Object.freeze({
  pop: { head: 4.5, paw: 5.5, foot: 3.0, wing: 9, tail: 7, body: 2.0 },
  speed: { head: 26, paw: 30, foot: 14, wing: 45, tail: 40, body: 12 },
  hinge: 48, bend: 36, tailK: 40, slide: 0.35, under: 0.15, inside: 0.25, spin: 150, stretch: 0.08, wingG: 0.15,
});

export function makeWyrmMotion({ THREE, G, DT, SCALE, place, settle }) {
  const { game } = G;
  const d = game.dragon;
  const R = d.rig, pt = R.pt;
  const V = () => new THREE.Vector3();
  const deg = (r) => (r * 180) / Math.PI;
  const ang = (a, b) => deg(Math.acos(Math.max(-1, Math.min(1, a.dot(b)))));
  const groups = () => {
    const g = { head: [pt.head, pt.snout], paw: [], foot: [], wing: [], tail: [], body: [pt.chest, pt.hips, pt.neckBase] };
    for (const a of pt.arms) g.paw.push(a.toe, a.wrist, a.elbow);
    for (const l of pt.legs) g.foot.push(l.toe, l.ankle);
    for (const w of pt.wings) g.wing.push(w.wrist, w.elbow, ...w.tips);
    const t = R.tail;
    if (t?.p) for (let i = 2; i < t.p.length; i += 3) g.tail.push(t.p[i]);
    return g;
  };
  const restLen = () => {
    const o = [];
    for (const a of pt.arms) o.push([a.shoulder, a.elbow, a.shoulder.distanceTo(a.elbow)], [a.elbow, a.wrist, a.elbow.distanceTo(a.wrist)]);
    for (const l of pt.legs) o.push([l.hip, l.knee, l.hip.distanceTo(l.knee)], [l.knee, l.ankle, l.knee.distanceTo(l.ankle)]);
    return o;
  };
  let REST = null;

  /** Record `secs` s (or until `done()`), after `start()`. Returns the row. */
  function measure(label, start, { secs = 9, done = null, minSecs = 0.5, each = null } = {}) {
    if (!REST) {
      settle(G);
      REST = restLen();
    }
    const G0 = groups();
    const names = Object.keys(G0);
    const prevP = names.map((k) => G0[k].map(() => V()));
    const prevV = names.map((k) => G0[k].map(() => V()));
    const seen = names.map((k) => G0[k].map(() => 0));
    const row = { label, at: {}, frames: 0, pop: {}, popAt: {}, speed: {}, hinge: 0, bend: 0, tailK: 0, slide: 0, under: 0, underK: '', inside: 0, insideK: '', spin: 0, stretch: 0, wingG: 0, flags: [] };
    for (const k of names) { row.pop[k] = 0; row.speed[k] = 0; row.popAt[k] = 0; }
    const lastToe = [V(), V(), V(), V()], wasPlant = [false, false, false, false];
    const yawHist = [], posHist = [];
    const a = V(), b = V(), c = V(), hf = V();
    const phaseOf = () => { const x = d.brain.action; return x ? `${x.name}/${x.phase}${x.cur?.kind ? ':' + x.cur.kind : ''}` : d.state; };
    start?.();
    const n = Math.round(secs / DT);
    for (let i = 0; i < n; i++) {
      each?.(i);
      G.tick(DT);
      game.player.debug?.heal?.();
      row.frames++;
      const T = i * DT;
      // (a hit-stop freezes the frame for a few ticks: velocities across it are not motion; start them again)
      if ((game.hitstopTimer ?? 0) > 0 || (game.timeScale ?? 1) < 0.99) {
        for (const sg of seen) sg.fill(0);
        continue;
      }
      const Gs = groups();
      names.forEach((k, gi) => {
        Gs[k].forEach((p, j) => {
          if (!Number.isFinite(p.x + p.y + p.z)) return;
          if (seen[gi][j] >= 1) {
            a.subVectors(p, prevP[gi][j]).divideScalar(DT);
            const sp = a.length();
            if (seen[gi][j] >= 2) {
              const pop = b.subVectors(a, prevV[gi][j]).length();
              if (pop > row.pop[k]) { row.pop[k] = pop; row.popAt[k] = +T.toFixed(2); row.at['pop_' + k] = `${phaseOf()} j${j}`; }
              if (process.env.GCD_POPDBG && pop > 40) console.log(`POP ${label} ${k}[${j}] t=${T.toFixed(2)} pop=${pop.toFixed(0)} prev=(${prevP[gi][j].x.toFixed(2)},${prevP[gi][j].y.toFixed(2)},${prevP[gi][j].z.toFixed(2)}) now=(${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) hitstop=${(game.hitstopTimer ?? 0).toFixed(3)} ts=${game.timeScale ?? '-'} st=${d.state} act=${d.brain.action?.name}/${d.brain.action?.phase} root=(${d.position.x.toFixed(2)},${d.position.z.toFixed(2)}) dt=${(game.lastDt ?? 0).toFixed(4)}`);
            }
            if (sp > row.speed[k]) row.speed[k] = sp;
            prevV[gi][j].copy(a);
          }
          prevP[gi][j].copy(p);
          seen[gi][j]++;
          // under the ground
          const lowOk = k === 'foot' || k === 'paw' ? -0.02 : 0;
          if (p.y < lowOk && -p.y > row.under) { row.under = -p.y; row.underK = k + j; row.at.under = +T.toFixed(2); row.at.underPh = phaseOf(); }
          if (k === 'wing' && p.y < 0 && -p.y > row.wingG) row.wingG = -p.y;
        });
      });
      // the neck and the head
      const N = R.neck, nn = N.n;
      a.subVectors(N.p[nn], N.p[nn - 1]).normalize();
      hf.copy(pt.headFwd).normalize();
      { const h = ang(a, hf); if (h > row.hinge) { row.hinge = h; row.at.hinge = +T.toFixed(2); row.at.hingePh = phaseOf(); } }
      for (let j = 1; j < nn; j++) {
        a.subVectors(N.p[j], N.p[j - 1]).normalize();
        b.subVectors(N.p[j + 1], N.p[j]).normalize();
        { const v = ang(a, b); if (v > row.bend) { row.bend = v; row.at.bend = +T.toFixed(2); row.at.bendJ = j; } }
      }
      // the tail
      const Tl = R.tail;
      if (Tl?.p) for (let j = 1; j < Tl.p.length - 1; j++) {
        a.subVectors(Tl.p[j], Tl.p[j - 1]).normalize();
        b.subVectors(Tl.p[j + 1], Tl.p[j]).normalize();
        { const v = ang(a, b); if (v > row.tailK) { row.tailK = v; row.at.tail = +T.toFixed(2); row.at.tailPh = phaseOf(); } }
      }
      // GCD_FOOTDBG=0..3 (paw L, paw R, hind L, hind R): that foot's drawn toe, its contact and its state every 4th frame
      if (process.env.GCD_FOOTDBG && i % 4 === 0) {
        const j = +process.env.GCD_FOOTDBG, l = R.gait?.limbs?.[[2, 3, 0, 1][j]];
        const t = [pt.arms[0].toe, pt.arms[1].toe, pt.legs[0].toe, pt.legs[1].toe][j], s = R.s, f = (p) => p ? `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}` : '-';
        console.log(`    ${T.toFixed(2)} toe ${f(t)} contact ${f(l?.pos)} lock ${l?.lock} free ${l?.free} step ${l?.stepping} dead ${s?.dead?.toFixed(2)} sleep ${s?.sleep?.toFixed(2)} air ${s?.airborne?.toFixed(2)} ${phaseOf()}`);
      }
      // planted feet skating (four feet: two paws, two hind)
      const toes = [pt.arms[0].toe, pt.arms[1].toe, pt.legs[0].toe, pt.legs[1].toe];
      toes.forEach((t, j) => {
        const plant = t.y < 0.12;
        if (plant && wasPlant[j]) {
          const dx = Math.hypot(t.x - lastToe[j].x, t.z - lastToe[j].z);
          if (dx / DT < 2.5 && dx > 0.002) { const v = (row['_s' + j] = (row['_s' + j] ?? 0) + dx); if (v > row.slide) { row.slide = v; row.at.slide = +T.toFixed(2); row.at.slideFoot = ['paw L', 'paw R', 'hind L', 'hind R'][j]; } }
        } else row['_s' + j] = 0;
        wasPlant[j] = plant;
        lastToe[j].copy(t);
      });
      // a paw or the snout inside the trunk (a capsule chest - hips, radius from the rig: ~ the chest's height off the belly)
      const rT = 1.0 * SCALE; // (the trunk's core: the body's hurt spheres are 1.25 - 1.35 x SCALE)
      const inTrunk = (p, nm) => {
        c.subVectors(pt.hips, pt.chest);
        const L = c.length();
        if (!(L > 0.1)) return;
        c.multiplyScalar(1 / L);
        const s = Math.max(0, Math.min(L, b.subVectors(p, pt.chest).dot(c)));
        const q = a.copy(pt.chest).addScaledVector(c, s);
        const depth = rT - q.distanceTo(p);
        if (depth > row.inside) { row.inside = depth; row.insideK = nm; row.at.inside = +T.toFixed(2); }
      };
      inTrunk(pt.arms[0].toe, 'paw L');
      inTrunk(pt.arms[1].toe, 'paw R');
      inTrunk(pt.snout, 'snout');
      // turning in place
      yawHist.push(d.yaw);
      posHist.push([d.position.x, d.position.z]);
      const w = Math.round(0.25 / DT);
      if (yawHist.length > w) {
        const y0 = yawHist[yawHist.length - 1 - w], p0 = posHist[posHist.length - 1 - w];
        let dy = d.yaw - y0;
        while (dy > Math.PI) dy -= 2 * Math.PI;
        while (dy < -Math.PI) dy += 2 * Math.PI;
        const mv = Math.hypot(d.position.x - p0[0], d.position.z - p0[1]) / 0.25;
        if (mv < 0.4 && d.state !== 'airborne' && Math.abs(deg(dy)) / 0.25 > row.spin) { row.spin = Math.abs(deg(dy)) / 0.25; row.at.spin = +T.toFixed(2); row.at.spinPh = phaseOf(); }
      }
      // stretch
      if (REST) {
        const now = restLen();
        now.forEach((r2, j) => {
          const e = Math.abs(r2[2] / REST[j][2] - 1);
          if (Number.isFinite(e)) row.stretch = Math.max(row.stretch, e);
        });
      }
      if (T > minSecs && done?.()) break;
    }
    for (const k of Object.keys(row)) if (k.startsWith('_s')) delete row[k];
    // flags
    const L = LIMITS;
    for (const k of Object.keys(row.pop)) {
      if (row.pop[k] > L.pop[k]) row.flags.push(`${k} snaps (${row.pop[k].toFixed(1)} m/s in a frame at ${row.popAt[k]} s)`);
      if (row.speed[k] > L.speed[k]) row.flags.push(`${k} too fast (${row.speed[k].toFixed(0)} m/s)`);
    }
    if (row.hinge > L.hinge) row.flags.push(`head hinged ${row.hinge.toFixed(0)}° off the neck`);
    if (row.bend > L.bend) row.flags.push(`neck kinks ${row.bend.toFixed(0)}°`);
    if (row.tailK > L.tailK) row.flags.push(`tail kinks ${row.tailK.toFixed(0)}°`);
    if (row.slide > L.slide) row.flags.push(`a planted foot skates ${row.slide.toFixed(2)} m (${row.at.slideFoot}, to ${row.at.slide} s)`);
    if (row.under > L.under) row.flags.push(`${row.underK} ${row.under.toFixed(2)} m under the ground`);
    if (row.inside > L.inside) row.flags.push(`${row.insideK} ${row.inside.toFixed(2)} m inside the body`);
    if (row.spin > L.spin) row.flags.push(`spins in place ${row.spin.toFixed(0)}°/s`);
    if (row.stretch > L.stretch) row.flags.push(`a limb bone stretches ${(row.stretch * 100).toFixed(0)} %`);
    if (row.wingG > L.wingG) row.flags.push(`a wing tip ${row.wingG.toFixed(2)} m under the ground`);
    return row;
  }

  function print(out, r) {
    const f = (o) => Object.entries(o).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' ');
    out(`  ${r.label.padEnd(16)} ${String(r.frames).padStart(4)}f  pop[${f(r.pop)}]  hinge ${r.hinge.toFixed(0)} bend ${r.bend.toFixed(0)} tail ${r.tailK.toFixed(0)} slide ${r.slide.toFixed(2)} under ${r.under.toFixed(2)} in ${r.inside.toFixed(2)} spin ${r.spin.toFixed(0)} str ${(r.stretch * 100).toFixed(0)}%`);
    if (r.flags.length) out(`      FLAG ${r.flags.join(' · ')}`);
  }
  return { measure, print, LIMITS };
}
