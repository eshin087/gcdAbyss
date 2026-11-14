import { clamp, wrapAngle, smoothstep, turnToward } from '../../../core/math.js';
import { TELL, RESULT } from '../../../combat/rules.js';
import { perPhase } from './realise.js';

// A duelist's mind and timeline: the Ash Disciple's (docs/specs/ash-disciple.md §3), shared by every
// human boss built on duelist.js. Everything it knows about one boss comes from the actor's kit
// (d.kit: { TUNING, MOVES, MOVE_NAMES, CLIP, realise, transitions }); what only one boss does is a
// hook on the actor (d.brainFrame, d.afterPose, d.onRelease, d.onCast, d.beatMotion,
// d.onTransitionEnd). Modes (d.mode):
//   sleep    kneeling in meditation (state 'sleeping'); flow calls startIntro, or a strike wakes him
//   intro    rises, flicks the jian, salutes; then 'dragon:introDone' (state 'waking')
//   foot     footwork between moves: circling / closing / backing off, guard up after a raise delay
//   act      a move (realise.js): per beat the tell at its windup start, the glint flashLead
//            before its impact, root motion (travel / dash / leap), the zone tested through the
//            active frames (one hit per beat); a `release` / `cast` beat hands its impact to the actor
//   react    a reaction clip: clash, flinch, backstep, sidestep, stagger, recoil, executed
//   broken   posture broken: on one knee for breakTime (state 'staggered')
//   dying    the death clip, then the ash; finishDeath() → 'dead'
// A phase's transition is the move kit.transitions[phase] (the disciple's 'kindle'), started as soon
// as he is free once that phase's gate is hit.

const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const ease = (u) => u * u * (3 - 2 * u);
/** The windup fraction u (0..1, 1..2 in the active frames) of beat b at move time t (holds included). */
function uAt(b, t) {
  const W = b.W, H = b.H, cock = b.def.cock ?? 0.8, s = t - b.start;
  if (t >= b.impact) return 1 + clamp((t - b.impact) / Math.max(1e-4, b.A), 0, 1);
  if (s <= cock * W) return clamp(s / Math.max(1e-4, W), 0, 1);
  if (s <= cock * W + H) return cock;
  return clamp(cock + (s - cock * W - H) / Math.max(1e-4, W), 0, 1);
}
/** Piecewise-linear [[u, v], ...] at u. */
function track(keys, u) {
  if (!keys?.length) return 0;
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const [u0, v0] = keys[i - 1], [u1, v1] = keys[i];
      return v0 + (v1 - v0) * ease((u - u0) / Math.max(1e-4, u1 - u0));
    }
  }
  return keys[keys.length - 1][1];
}

const REACT_BASE = {
  clash: { travel: -0.15 },
  flinch: { travel: -0.12 },
  sidestep: { side: 1.8 },
  stagger: { travel: -0.7 },
  recoil: { travel: -0.55 },
  executed: { travel: -1.4 },
  reeling: { travel: -1.0 },
  trampled: { travel: -0.5 },
  lock: { travel: 0 },
};
/** Reactions that leave him open (state 'staggered': the camera, the HUD, the bots read it). */
const OPEN = new Set(['stagger', 'recoil', 'executed', 'reeling', 'trampled']);

export class DuelBrain {
  constructor(d) {
    this.d = d;
    const K = d.kit;
    this.K = K;
    this.T = K.TUNING;
    this.M = K.MOVES;
    this.names = K.MOVE_NAMES;
    this.C = K.CLIP;
    /** reaction clips' root motion (kit.REACT adds / overrides) */
    this.R = { ...REACT_BASE, backstep: { travel: -this.T.move.backstep.dist }, ...(K.REACT ?? {}) };
    /** reactions that leave him open */
    this.open = new Set([...OPEN, ...(K.OPEN ?? [])]);
    this.aiEnabled = true;
    this._ld = { dx: 0, dz: 0, dist: 0, ang: 0 };
    this.reset();
  }

  reset() {
    this.cooldowns = {};
    this.last = [null, null];
    this.gapT = 1.2;
    this.strafeDir = 1;
    this.strafeT = 2;
    this.raiseT = 0;
    this.counter = { n: 0, t: -9, pending: false };
    this.struck = { n: 0, t: -9 };
    this.backCool = 0;
    this.sideCool = 0;
    this.pendingPhase = 0;
    this.pendingBreak = false;
    this.wakeFallback = -1;
    this.act = null;
    this.react = null;
    this.modeT = 0;
    this.clip = this.C.meditate;
    this.clipT = 0;
    this.leap = null;
    this.zone = null;
    const d = this.d;
    d.mode = 'sleep';
    d.state = 'sleeping';
    d.anim?.play?.('duel', 0.01);
  }

  // ---------------------------------------------------------------- queries
  /** His guard covers his front: in footwork (after the raise delay), through a clash, and through
   *  the first part of each windup (until TUNING.guard.windupOpen of it: the blade is still between
   *  you; past it he has committed to the strike and it can be traded). */
  guardUp() {
    const d = this.d;
    if (d.broken) return false;
    if (d.mode === 'foot') return this.raiseT <= 0;
    if (d.mode === 'act') {
      const a = this.act;
      const b = a?.beats.find((x) => a.t < x.end + 1e-6);
      return !!b && a.t < b.impact && uAt(b, a.t) < this.T.guard.windupOpen && !a.def.transition;
    }
    return d.mode === 'react' && (this.react?.kind === 'clash' || this.react?.kind === 'backstep');
  }

  _sense() {
    const d = this.d, pl = d.game.player, p = pl?.position;
    if (!p || !Number.isFinite(p.x + p.z)) return null;
    const dx = p.x - d.position.x, dz = p.z - d.position.z;
    // the hero's own movement (his intent, not his displacement: steady through a hit-stop), capped
    let vx = Number.isFinite(pl.vel?.x) ? pl.vel.x : 0, vz = Number.isFinite(pl.vel?.z) ? pl.vel.z : 0;
    const v = Math.hypot(vx, vz);
    if (v > 9) {
      vx *= 9 / v;
      vz *= 9 / v;
    }
    return { dx, dz, dist: Math.hypot(dx, dz), ang: Math.atan2(dx, dz), p, vx, vz };
  }

  /** Where the hero will be `secs` from now if he keeps moving (relative to him): leads every
   *  step-in, windup track and dash, so a running hero is met, not chased. */
  _lead(s, secs, out = this._ld) {
    const k = clamp(secs, 0, 0.5);
    out.dx = s.dx + s.vx * k;
    out.dz = s.dz + s.vz * k;
    out.dist = Math.hypot(out.dx, out.dz);
    out.ang = Math.atan2(out.dx, out.dz);
    return out;
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    const d = this.d;
    this.modeT += dt;
    this.clipT += dt;
    if (this.raiseT > 0) this.raiseT -= dt;
    if (this.backCool > 0) this.backCool -= dt;
    if (this.sideCool > 0) this.sideCool -= dt;
    for (const k in this.cooldowns) if (this.cooldowns[k] > 0) this.cooldowns[k] -= dt;
    d.warn = Math.max(0, d.warn - dt * 6.4 * (d.warn > 0.4 ? 1 : 0));
    this.zone = null;
    switch (d.mode) {
      case 'sleep':
        this._sleep(dt);
        break;
      case 'intro':
        if (this.modeT >= this.clip.dur) this._toCombat();
        break;
      case 'foot':
        this._foot(dt);
        break;
      case 'act':
        this._act(dt);
        break;
      case 'react':
        this._react(dt);
        break;
      case 'broken':
        this._broken(dt);
        break;
      case 'dying':
        this._dying(dt);
        break;
      default:
        break;
    }
    d.brainFrame?.(dt);
  }

  /** After the pose (the blade's points are fresh): the actor's swing trails and body FX. */
  afterPose(dt) {
    const d = this.d;
    if (d.mode === 'dead') return;
    d.afterPose?.(dt, this.act);
  }

  _sleep(dt) {
    const d = this.d;
    d.groundVelSet(0, 0);
    if (this.wakeFallback > 0) {
      this.wakeFallback -= dt;
      if (this.wakeFallback <= 0) this.startIntro();
    }
  }

  // ---------------------------------------------------------------- mode changes
  _play(clip, blend = 0.12) {
    this.clip = clip;
    this.clipT = 0;
    this.d.anim.play('duel', blend, true);
  }

  startIntro() {
    const d = this.d;
    if (d.mode !== 'sleep') return;
    d.mode = 'intro';
    d.state = 'waking';
    this.modeT = 0;
    this._play(this.C.intro, 0.05);
    d.emit('dragon:wake');
    d.fx.dust(d.position.x, d.position.z, 0.8);
  }

  /** Skip the intro: straight into the duel (Lab, flow's debug 'boss'). */
  startFight() {
    const d = this.d;
    if (d.mode === 'dying' || d.mode === 'dead') return false;
    if (d.mode === 'sleep' || d.mode === 'intro') this._toCombat();
    return true;
  }

  _toCombat() {
    const d = this.d;
    const wasIntro = d.mode === 'intro' || d.mode === 'sleep';
    this._toFoot(0.6);
    this.raiseT = 0;
    if (wasIntro) d.emit('dragon:introDone');
  }

  _toFoot(gap = null) {
    const d = this.d;
    d.mode = 'foot';
    d.state = 'combat';
    this.act = null;
    this.react = null;
    this.leap = null;
    d.position.y = 0;
    this.modeT = 0;
    this.raiseT = this.T.guard.raiseDelay;
    const G = perPhase(this.T.idleGap, d.phase);
    this.gapT = gap ?? G[0] + (G[1] - G[0]) * Math.random();
    this.clip = null;
    this.clipT = 0;
    d.anim.play('loco', 0.18);
    if (this.pendingBreak) {
      this.pendingBreak = false;
      d._break();
    }
  }

  /** Start a move now. Returns false if it can't (unknown, he is down). */
  startAct(name, phase = this.d.phase) {
    const d = this.d;
    if (d.mode === 'dying' || d.mode === 'dead' || d.mode === 'broken') return false;
    const A = this.K.realise(name, phase, Math.random);
    if (!A) return false;
    A.t = 0;
    A.chain = 0;
    A.striking = null;
    A.root = { x: d.position.x, z: d.position.z };
    A.travelled = 0;
    this.act = A;
    this.react = null;
    this.leap = null;
    d.mode = 'act';
    d.state = 'combat';
    this.modeT = 0;
    this._play(A.clip, 0.1);
    const def = A.def;
    this.cooldowns[name] = def.cooldown ?? 0;
    this.last[1] = this.last[0];
    this.last[0] = name;
    if (def.transition) {
      const n = def.phase ?? 2;
      d.enterPhase(n);
      d.emit(`dragon:phase${n}`);
      d.emit('dragon:roar', { strength: 0.6 });
    } else d.emit('dragon:windup', { name });
    return true;
  }

  /** A reaction clip (cancels a move). */
  startReact(kind) {
    const d = this.d;
    if (d.mode === 'dying' || d.mode === 'dead' || d.mode === 'sleep') return false;
    const clip = this.C[kind];
    if (!clip) return false;
    if (d.mode === 'act' && this.act?.def?.transition && kind !== 'executed') return false; // the kindling holds
    this.act = null;
    this.leap = null;
    d.position.y = 0;
    d.mode = 'react';
    d.state = this.open.has(kind) ? 'staggered' : 'combat';
    d.warn = 0;
    const R = this.R[kind] ?? {};
    this.react = { kind, clip, t: 0, travel: R.travel ?? 0, side: R.side ? R.side * (Math.random() < 0.5 ? -1 : 1) : 0, moved: 0 };
    this.modeT = 0;
    this._play(clip, kind === 'clash' || kind === 'flinch' ? 0.05 : 0.08);
    return true;
  }

  /** The blade lock (a perfect parry of a `lock` blow): blades crossed until the hero's push is
   *  decided (player.startBladeLock → disciple.onLockEnd). False if the hero can't lock. */
  startLock() {
    const d = this.d, p = d.game.player, L = this.T.lock;
    if (typeof p?.startBladeLock !== 'function') return false;
    if (!this.startReact('lock')) return false;
    const ok = p.startBladeLock(d, { start: L.start, push: L.push, decay: perPhase(L.decay, d.phase), dur: L.dur, hold: L.hold });
    if (!ok) {
      this.startReact('recoil');
      return false;
    }
    d.emit('dragon:windup', { name: 'bladeLock' });
    // the camera closes in on the crossed blades (no slow motion: the push is in real time); the
    // lock's end (won: the reeling moment) replaces it, a loss lets it ease out over the counter
    d._cinematic('lock', { ...L.camera, slowmo: 1, dur: L.dur });
    return true;
  }

  startBroken() {
    const d = this.d;
    this.act = null;
    this.react = null;
    this.leap = null;
    d.position.y = 0;
    d.mode = 'broken';
    d.state = 'staggered';
    this.modeT = 0;
    this.counter.pending = false;
    this._play(this.C.broken, 0.1);
  }

  startDeath() {
    const d = this.d;
    this.act = null;
    this.react = null;
    this.leap = null;
    d.position.y = 0;
    d.mode = 'dying';
    d.state = 'dying';
    this.modeT = 0;
    this._play(this.C.death, 0.12);
  }

  /** Lab: the next phase's transition now (HP down to the gate if it is above). `n` must be the
   *  phase after the current one. */
  forcePhase(n = this.d.phase + 1) {
    const d = this.d, mv = this.K.transitions?.[n];
    if (!mv || n !== d.phase + 1 || d.mode === 'dying' || d.mode === 'dead') return false;
    if (d.mode === 'sleep' || d.mode === 'intro') this._toCombat();
    d.hp = Math.min(d.hp, d.nextPhaseHp);
    this.pendingPhase = 0;
    return this.startAct(mv, d.phase);
  }
  forcePhase2() {
    return this.forcePhase(2);
  }

  /** Lab: force a move now (wakes him into the duel first). False while he can't. */
  trigger(name) {
    const d = this.d;
    if (!this.M[name]) return false;
    if (d.mode === 'dying' || d.mode === 'dead' || d.mode === 'broken') return false;
    if (d.mode === 'sleep' || d.mode === 'intro') this._toCombat();
    if (this.M[name].transition) return this.forcePhase(this.M[name].phase ?? 2);
    if (this.M[name].phase > d.phase) return false;
    return this.startAct(name);
  }

  // ---------------------------------------------------------------- footwork
  _foot(dt) {
    const d = this.d, s = this._sense();
    const M = this.T.move;
    if (!s) {
      d.groundVelSet(0, 0);
      return;
    }
    d.yaw = turnToward(d.yaw, s.ang, perPhase(M.turn, d.phase) * dt);
    if (this.pendingPhase > d.phase) {
      const mv = this.K.transitions?.[this.pendingPhase];
      this.pendingPhase = 0;
      if (mv && this.startAct(mv, d.phase)) return;
    } else this.pendingPhase = 0;
    if (!this.aiEnabled) {
      d.groundVelSet(0, 0);
      return;
    }
    if (this.counter.pending) {
      this.counter.pending = false;
      this.startAct(this.K.counterMove?.(d.phase) ?? 'riposte');
      return;
    }
    // a charged thrust levelled at him: sometimes he steps out of its line
    const pl = d.game.player;
    if (pl?.state === 'charge' && fin(pl.chargeK) > 0.55 && this.sideCool <= 0 && s.dist < 6) {
      this.sideCool = 3;
      if (Math.random() < 0.45) {
        this.startReact('sidestep');
        return;
      }
    }
    // a hero drinking a flask is punished: no breather, the moves that close distance favoured
    const punish = pl?.state === 'heal';
    this.gapT -= dt;
    if (punish) this.gapT = Math.min(this.gapT, 0);
    if (this.gapT <= 0) {
      const name = this._choose(s.dist, punish);
      if (name) {
        this.startAct(name);
        return;
      }
    }
    // movement: inside striking range he circles (guard up) while the breather runs; outside it he
    // closes: a run, and past sprintAt a sprint (faster than the hero's): kiting him doesn't work
    let speed = 0, dirX = 0, dirZ = 0;
    const fx = s.dx / (s.dist || 1), fz = s.dz / (s.dist || 1);
    if (s.dist > M.sprintAt || (punish && s.dist > M.band[1])) {
      speed = M.sprint;
      dirX = fx;
      dirZ = fz;
    } else if (s.dist > M.band[1]) {
      speed = M.run;
      dirX = fx;
      dirZ = fz;
    } else if (s.dist < M.near && this.backCool <= 0) {
      this.backCool = 2.4;
      if (Math.random() < M.backChance) {
        this.startReact('backstep');
        return;
      }
    } else {
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeDir = Math.random() < 0.7 ? -this.strafeDir : this.strafeDir;
        this.strafeT = M.strafeSwitch[0] + (M.strafeSwitch[1] - M.strafeSwitch[0]) * Math.random();
      }
      // circling, drifting in or out toward the middle of the band
      const mid = (M.band[0] + M.band[1]) / 2, inward = clamp((s.dist - mid) / 0.8, -1, 1) * 0.6;
      speed = M.walk;
      dirX = -fz * this.strafeDir + fx * inward;
      dirZ = fx * this.strafeDir + fz * inward;
      const l = Math.hypot(dirX, dirZ) || 1;
      dirX /= l;
      dirZ /= l;
    }
    const x0 = d.position.x, z0 = d.position.z;
    d.moveBy(dirX * speed * dt, dirZ * speed * dt);
    // pressed against a wall while circling: circle the other way
    if (speed > 0 && speed <= M.walk && Math.hypot(d.position.x - x0, d.position.z - z0) < speed * dt * 0.3) this.strafeDir = -this.strafeDir;
    d.groundVelSet((d.position.x - x0) / dt, (d.position.z - z0) / dt);
  }

  /** A weighted pick of the moves he can use from `dist` (phase, band, cooldown; recent picks damped).
   *  `punish` (the hero drinks): the moves that cover ground (a dash, a leap, the qi) weigh more. */
  _choose(dist, punish = false) {
    const d = this.d;
    let total = 0;
    const pool = [];
    for (const name of this.names) {
      const def = this.M[name];
      if (def.counter || def.transition || def.phase > d.phase || def.manual) continue;
      if ((this.cooldowns[name] ?? 0) > 0) continue;
      const [lo, hi] = def.band;
      if (dist < lo || dist > hi) continue;
      let w = perPhase(def.weight, d.phase);
      if (!(w > 0)) continue;
      if (this.last[0] === name) w *= 0.3;
      else if (this.last[1] === name) w *= 0.65;
      if (punish && (def.gapCloser || def.beats.some((b) => b.dash?.max >= 3 || b.leap || b.release))) w *= this.T.punish.weight;
      pool.push([name, w]);
      total += w;
    }
    if (!(total > 0)) return null;
    let r = Math.random() * total;
    for (const [name, w] of pool) {
      r -= w;
      if (r <= 0) return name;
    }
    return pool[pool.length - 1][0];
  }

  // ---------------------------------------------------------------- the move timeline
  _act(dt) {
    const d = this.d, a = this.act;
    a.t += dt;
    const t = a.t;
    const s = this._sense();
    // the beat that owns this moment (its windup or active frames), else the next one
    let cur = null;
    for (const b of a.beats) {
      if (t < b.end + 1e-6) {
        cur = b;
        break;
      }
    }
    a.striking = cur && !cur.feint && t >= cur.impact - 0.12 ? cur : a.striking && t <= a.striking.end + 0.12 ? a.striking : null;
    // tells: the announcement at each real beat's windup start, the glint flashLead before its impact
    for (const b of a.beats) {
      if (b.feint) continue;
      if (!b.announced && t >= b.tellAt) {
        b.announced = true;
        const p = d.tellPoint(b.def.part, d._v2);
        d.emit('combat:tell', { source: 'dragon', attack: a.name, tell: b.def.tell, impactIn: Math.max(0.05, b.impact - t), x: p.x, z: p.z });
        if (b.def.tell === TELL.RED) d.warn = Math.max(d.warn, 0.1);
      }
      if (!b.flashed && t >= b.flash && !b.def.release && !b.def.cast?.selfCue) {
        b.flashed = true;
        const p = d.tellPoint(b.def.part, d._v2);
        // perilous: a thrust a mikiri answers (its own read: the deep low coil, the held beat)
        d.emit('combat:flash', { source: 'dragon', attack: a.name, tell: b.def.tell, x: p.x, y: p.y, z: p.z, perilous: !!b.def.mikiri });
        d.fx.tellFlash(b.def.tell, p.x, p.y, p.z);
        if (b.def.tell === TELL.RED) d.warn = 1.6;
        if (b.def.ring) d.fx.ringPulse(d.position.x, d.position.z, b.def.ring);
      }
    }
    if (cur && !cur.feint) {
      // a red windup glows hotter toward its glint
      if (cur.def.tell === TELL.RED && t < cur.flash) d.warn = Math.max(d.warn, 0.1 + 0.28 * smoothstep(cur.start, cur.flash, t));
      // the red ground warning of an area, from the windup start to the impact
      if (cur.def.ring && t < cur.impact) {
        const k = clamp((t - cur.start) / Math.max(0.05, cur.impact - cur.start), 0, 1);
        const c = this.leap?.beat === cur ? this.leap.target : d.position;
        d.fx.warnRing(c.x, c.z, cur.def.ring, k, dt);
      }
    }
    // a string's next hit: if the hero is gone out of its reach (it can step in `close` m, dash its
    // `dash.max`), the string stops there and he gives chase instead of cutting at air
    if (cur && !cur.checked && cur.hit > 0 && t >= cur.start && s && this.aiEnabled) {
      cur.checked = true;
      if (s.dist > this._reach(cur) + 0.5) {
        this._toFoot(0);
        return;
      }
    }
    if (cur) this._motion(cur, t, dt, s);
    // the hits: the zone through the active frames, one result per beat
    for (const b of a.beats) {
      if (b.feint || b.done || t < b.impact) continue;
      if (!b.struck) {
        b.struck = true; // the impact's first frame: the actor's own FX (a bolt, a shock ring)
        d.onImpact?.(b, s, a);
      }
      if (b.def.release) {
        b.done = true;
        d.onRelease?.(b, s, a);
        continue;
      }
      if (b.def.cast) {
        b.done = true;
        d.onCast?.(b, s, a);
        if (this.act !== a) return;
        continue;
      }
      if (t > b.end + dt * 0.5) {
        b.done = true; // a whiff
        continue;
      }
      this.zone = b.def.zone;
      if (s && this._inZone(b.def.zone, s)) {
        const r = d.hitPlayer({
          damage: b.def.damage, knockback: b.def.knockback, knockdown: !!b.def.knockdown, kind: 'slash', tell: b.def.tell, attack: a.name,
          from: { x: d.position.x, z: d.position.z }, mikiri: !!b.def.mikiri, beat: b,
        });
        if (r !== RESULT.IGNORED) {
          b.done = true;
          b.landed = r === RESULT.HIT;
          if (r === RESULT.HIT || r === RESULT.BLOCKED) a.chain = 0;
          if (b.def.ring) d.game.shake?.(0.25);
        }
        if (this.act !== a) return; // a parry recoiled him
      }
    }
    if (this.act === a && t >= a.end) {
      if (a.def.transition) d.onTransitionEnd?.(a);
      // PBZ pace: he often flows straight into another move (TUNING.chain), no footwork between
      if (!a.def.transition && !a.def.counter && this.aiEnabled && !this.pendingPhase && s && Math.random() < perPhase(this.T.chain, d.phase)) {
        const next = this._choose(s.dist);
        if (next && next !== a.name && this.startAct(next)) return;
      }
      this._toFoot();
    }
  }

  /** Root motion of the current beat: tracking the hero in the windup, travel, dash, leap. */
  _motion(b, t, dt, s) {
    const d = this.d, D = b.def, u = uAt(b, t);
    const trackUntil = D.track ?? 0.75;
    const left = Math.max(b.impact - t, dt);
    const L = s ? this._lead(s, left) : null;
    if (L && u < trackUntil && !this.leap) d.yaw = turnToward(d.yaw, L.ang, perPhase(this.T.move.trackTurn, d.phase) * dt);
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
    const x0 = d.position.x, z0 = d.position.z;
    // close-in: through the windup he steps in toward the hero (at most b.close m), arriving at the
    // impact where the zone reaches him: a cut is never thrown at air, and the lunge reads as the tell
    if (b.close > 0 && L && u >= 0.15 && t < b.impact && !this.leap) {
      const gap = L.dist - this._ideal(D.zone);
      const budget = b.close - (b.closed ?? 0);
      if (gap > 0.02 && budget > 0) {
        const step = Math.min(Math.min(gap / left, this.T.close.speed) * dt, budget, gap);
        b.closed = (b.closed ?? 0) + step;
        d.moveBy((L.dx / (L.dist || 1)) * step, (L.dz / (L.dist || 1)) * step);
      }
    }
    if (D.travel) {
      const prev = b._trav ?? 0, now = track(D.travel, u);
      b._trav = now;
      d.moveBy(fx * (now - prev), fz * (now - prev));
    }
    if (D.dash && u >= D.dash.from) {
      if (!b._dash) {
        const ax = L ? L.dx : fx, az = L ? L.dz : fz, dist = L ? L.dist : 0;
        const l = Math.hypot(ax, az) || 1;
        if (s) d.yaw = Math.atan2(ax, az);
        b._dash = { x: d.position.x, z: d.position.z, dx: ax / l, dz: az / l, len: clamp(dist - D.dash.stop, 0, D.dash.max), done: 0 };
      }
      const k = ease(clamp((u - D.dash.from) / Math.max(1e-4, D.dash.to - D.dash.from), 0, 1));
      const want = b._dash.len * k, step = want - b._dash.done;
      b._dash.done = want;
      d.moveBy(b._dash.dx * step, b._dash.dz * step);
    }
    if (D.leap) this._leap(b, u, s);
    else if (D.lift) d.position.y = Math.max(0, track(D.lift, u));
    d.beatMotion?.(b, u, s, dt);
    d.groundVelSet((d.position.x - x0) / Math.max(dt, 1e-4), (d.position.z - z0) / Math.max(dt, 1e-4));
  }

  /** How far off a zone wants the hero at the impact (its centre of reach). */
  _ideal(z) {
    if (!z) return 1.5;
    if (z.kind === 'ring') return z.r * 0.55;
    return z.r * (z.kind === 'line' ? 0.72 : 0.66);
  }

  /** The furthest the hero can be at beat b's windup start and still be hit (zone + step-in + dash). */
  _reach(b) {
    if (b.def.release || b.def.cast) return Infinity; // a thrown thing reaches him wherever he is
    const z = b.def.zone, pr = this.d.game.player?.radius ?? 0.45;
    return (z?.r ?? 2) + pr + (b.close ?? 0) + (b.def.dash?.max ?? 0);
  }

  /** Heaven-Splitting Fall: the ring follows the hero until `lock`, he comes down on it at u = 1. */
  _leap(b, u, s) {
    const d = this.d, L = b.def.leap;
    if (u < L.from) return;
    if (!this.leap || this.leap.beat !== b) {
      this.leap = { beat: b, x: d.position.x, z: d.position.z, target: { x: d.position.x, z: d.position.z } };
      d.emit('dragon:takeoff');
    }
    const J = this.leap;
    if (s && u < L.lock) {
      // the landing spot follows the hero, inside his bound
      const B = d.bound;
      let tx = s.p.x, tz = s.p.z;
      const r = Math.hypot(tx, tz);
      if (r > B) {
        tx *= B / r;
        tz *= B / r;
      }
      J.target.x = tx;
      J.target.z = tz;
      d.clampTarget?.(J.target); // (a boss whose floor is not a circle)
    }
    const k = clamp((u - L.from) / Math.max(1e-4, 1 - L.from), 0, 1);
    const e = ease(k);
    d.position.x = J.x + (J.target.x - J.x) * e;
    d.position.z = J.z + (J.target.z - J.z) * e;
    d.position.y = u >= 1 ? 0 : L.apex * 4 * k * (1 - k);
    const dx = J.target.x - J.x, dz = J.target.z - J.z;
    if (dx * dx + dz * dz > 0.04 && u < 1) d.yaw = Math.atan2(dx, dz);
    d.state = d.position.y > 0.4 ? 'airborne' : 'combat';
    if (u >= 1 && !J.landed) {
      J.landed = true;
      d.state = 'combat';
      d.emit('dragon:land', { x: d.position.x, z: d.position.z });
      d.fx.dust(d.position.x, d.position.z, 1.6);
      d.game.world?.gust?.(d.position.x, d.position.z, 1.2, 5);
    }
  }

  /** Is the hero inside the zone (his position and facing, the hero's radius)? */
  _inZone(z, s) {
    if (!z) return false;
    const d = this.d, pr = d.game.player?.radius ?? 0.45;
    if (d.position.y > 0.6) return false; // still in the air
    if (z.kind === 'ring') return s.dist <= z.r + pr;
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
    const along = s.dx * fx + s.dz * fz, across = -s.dx * fz + s.dz * fx;
    if (z.kind === 'line') return along >= -pr && along <= z.r + pr && Math.abs(across) <= z.w / 2 + pr;
    // sector
    if (s.dist > z.r + pr) return false;
    if (s.dist < pr + 0.3) return true;
    return Math.abs(wrapAngle(s.ang - d.yaw)) <= z.ang + Math.asin(Math.min(1, pr / Math.max(s.dist, 1e-3)));
  }

  /** The Lab's hitbox overlay: the zone being tested this frame as a sphere. */
  zoneDebug() {
    const z = this.zone, d = this.d;
    if (!z) return null;
    const r = z.r ?? 1;
    if (z.kind === 'ring') return { x: d.position.x, y: 0.6, z: d.position.z, r };
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
    return { x: d.position.x + fx * r * 0.55, y: 1.0, z: d.position.z + fz * r * 0.55, r: r * 0.5 };
  }

  // ---------------------------------------------------------------- reactions
  _react(dt) {
    const d = this.d, R = this.react;
    R.t += dt;
    const k = clamp(R.t / Math.max(0.05, Math.min(R.clip.dur, 0.45)), 0, 1);
    const want = ease(k);
    const step = want - R.moved;
    R.moved = want;
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
    const x0 = d.position.x, z0 = d.position.z;
    if (R.travel) d.moveBy(fx * R.travel * step, fz * R.travel * step);
    if (R.side) d.moveBy(-fz * R.side * step, fx * R.side * step);
    d.groundVelSet((d.position.x - x0) / Math.max(dt, 1e-4), (d.position.z - z0) / Math.max(dt, 1e-4));
    if (R.kind === 'lock') {
      // held until the hero's push is decided (onLockEnd); a lock the hero never resolves times out
      if (R.t > this.T.lock.dur + 1.5) this._toFoot(0.2);
      return;
    }
    if (R.t >= R.clip.dur) {
      this._toFoot(R.kind === 'clash' || R.kind === 'backstep' || R.kind === 'sidestep' ? 0.25 : null);
      // a clash or a flinch: the guard is straight back up (a cut does not open him for the next one)
      if (R.kind === 'clash' || R.kind === 'flinch' || R.kind === 'backstep' || R.kind === 'sidestep') this.raiseT = 0;
    }
  }

  /** A strike his guard turned: counter likelier with each one in a row. */
  onGuarded() {
    const d = this.d, C = this.counter, G = this.T.guard;
    if (d.mode === 'act') return; // turned aside in his windup: his own strike goes on
    if (d.time - C.t > G.countWindow) C.n = 0;
    C.t = d.time;
    C.n++;
    const p = G.counterChance[Math.min(G.counterChance.length - 1, C.n - 1)] ?? 1;
    if (this.aiEnabled && Math.random() < p) {
      C.pending = true;
      C.n = 0;
    }
    if (d.mode === 'foot' || (d.mode === 'react' && this.react?.kind === 'clash')) this.startReact('clash');
  }

  /** A strike landed on him outside his guard: in footwork he flinches, and breaks off after a few. */
  onStruck(heavy) {
    const d = this.d, S = this.struck, F = this.T.flinch;
    // caught in his recovery: knocked out of it (a heavy blow staggers him)
    const a = this.act;
    if (d.mode === 'act' && a && !a.def.transition && a.t >= a.recoveryStart) {
      this.startReact(heavy ? 'stagger' : 'flinch');
      return;
    }
    if (d.mode !== 'foot' && !(d.mode === 'react' && (this.react?.kind === 'flinch' || this.react?.kind === 'clash'))) return;
    if (d.time - S.t > F.window) S.n = 0;
    S.t = d.time;
    S.n++;
    if (S.n >= F.breakOff && this.aiEnabled) {
      S.n = 0;
      this.startReact('backstep');
      return;
    }
    this.startReact(heavy ? 'stagger' : 'flinch');
  }

  _broken() {
    const d = this.d;
    d.groundVelSet(0, 0);
    if (this.modeT >= this.T.posture.breakTime) {
      d.endBreak();
      this._toFoot(0.4);
    }
  }

  _dying(dt) {
    const d = this.d;
    d.groundVelSet(0, 0);
    const T = this.clip?.dur ?? 2.4;
    if (this.modeT > T * 0.6) {
      const k = clamp((this.modeT - T * 0.6) / 1.6, 0, 1);
      d.dissolve = k;
      const c = d._hs[1];
      d.fx.ashRise(c.x, c.y, c.z, 1 - k * 0.5, dt);
    }
    if (this.modeT > T * 0.6 + 1.7) d.finishDeath();
  }
}
