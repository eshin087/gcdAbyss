import * as THREE from 'three';
import { CONFIG } from '../../core/config.js';
import { clamp, damp, dampAngle, turnToward, wrapAngle, smoothstep, lerp } from '../../core/math.js';
import { markCaster } from '../../render/pipeline.js';
import { batchRigid } from '../../render/rigidBatch.js';
import { TELL, RESULT, DEFENSE, GUARD, tellDefaults, facingDelta, dodgeOnly, tellOf, perfectParryWindow } from '../../combat/rules.js';
import { buildHero, setHeroGlyphScale, installLean, tintHero, LEAN, PLAYER_SCALE, BLADE_BASE, HERO_INK, DIM } from './model.js';
import { HERO_LOOKS, DEFAULT_LOOK, LOOK_IDS, getLook } from './gear/looks.js';
import { HeroAnimator, ROLL_SLIDE } from './anim.js';
import { LIGHT, HEAVY, heavyAfter, SPRINT_ATK, ROLL_ATK, THRUST, CLEAVE, ONE_BREATH, CHARGE, REACH, HIT_FEEL, feel, chargeStats, bandHit, SwordSweep } from './combat.js';
import { PlayerFx, EDGE_GLINT } from './fx.js';
import { SlashFx, slashMode } from './slashFx.js';
import './combos.js'; // (`?combo=`: four light combos for the ending slash, worn on LIGHT at load)
import { DEFAULT_LOADOUT, swordFromUrl } from './gear/index.js';
import { CLASH, clashBurst, clashGrind, closestOnSegments } from '../../combat/clashFx.js';
import { CUT_LOOK } from '../../combat/cutFx.js';
import { CONTACT, ContactBody, contactOn, findContact, newPin, pinAt, pinStep } from '../../combat/contact.js';
import { HitReact } from '../enemies/duelist/react.js';
import { impactK } from '../../combat/impact.js';
import { Flurry } from './flurry.js';
import { riposteMode, startRiposteCut, riposteTakeHit, riposteCutLanded, riposteContact } from './riposteCut.js';
import { newDeathblowState, armDeathblow, tickDeathblow, deathblowTakeHit, deathblowLanded, deathblowClaims } from './deathblow.js';
import { deathblowFxUpdate, deathblowFxClear } from '../../combat/deathblowFx.js';
import { deathblowMatrixUpdate, deathblowMatrixClear } from '../../combat/deathblowMatrix.js';
import { SwordMystic } from './swordMystic.js';
import { BREAK, SCAR } from '../../world/breakTuning.js';
import { chipLook, cutStops } from '../../world/destructibles.js';
import { mowSwing } from '../../world/grass.js';

// The Wanderer. Owns input → state machine → movement/collision → animation → sword hits → FX.
// Contract: docs/ARCHITECTURE.md (Player). Combat rules: docs/COMBAT.md + src/combat/rules.js.
// No stamina (v0.2): pacing comes from attack recovery, roll recovery and the enemy's patterns.
// Moveset (combat.js, ADR-041): LMB chain falling cut → rising backhand → whirl → stab → two-handed
// slam (finisher, ground shards); LMB out of a sprint = the sprint slash, out of a forward roll = the
// roll cut; HEAVY (RMB / R2) = the chain's heavy branch (combat.js HEAVY, ADR-115); hold HEAVY =
// crouched charge, release = the dashing cleave. Swings hit giant targets through
// a vertical reach band and step in toward a hurt surface ahead (REACH).
// A perfect dodge is answered by the flurry (flurry.js, ADR-091): as many blows as the streak of
// perfect dodges counts, flash cuts and then an art; the plunge below is the wyrm's first art.

export const TUNE = {
  runSpeed: 4.6,
  sprintSpeed: 7.2, // unlimited
  healSpeed: 1.4,
  accel: 14, // damp lambda toward a faster target velocity
  decel: 18, // ... toward a slower one
  turnRate: 16,
  maxHp: 160,
  maxFlasks: 5,
  roll: { dur: 0.6, dist: 4.2, iframes: [0.04, 0.4], attackAfter: 0.42, rollAfter: 0.5, moveAfter: 0.52, landAt: 0.48 },
  backstep: { dur: 0.4, dist: 1.6, iframes: [0.03, 0.22], attackAfter: 0.28, rollAfter: 0.32, moveAfter: 0.34, landAt: 0.3 },
  // THE LONG SECOND (ADR-158; Xin Yi's reward, game.unlocks 'longSecond', ?tech=lean): guard held, then
  // dodge with no direction: he leans back in place under the blow (no travel: he stays in reach),
  // i-frames longer than the backstep's, free to cut after attackAfter; a perfect one slows time
  // `slowmo` s (the Ghostep's 0.6) and leaves `ghosts` afterimages
  lean: { dur: 0.42, dist: 0, iframes: [0.03, 0.34], attackAfter: 0.24, rollAfter: 0.36, moveAfter: 0.36, landAt: 0.3, slowmo: 0.9, ghosts: 3 },
  heal: { dur: 0.85, at: 0.5, amount: 70 },
  staggerDur: 0.4,
  knockdownDur: 1.3,
  getUpIframes: 0.5, // last part of the knockdown
  knockdownTurn: 11, // rad/s: he turns square to the blow as he falls
  minStaggerDamage: 5, // no-knockback hits below this only flash
  chipGuard: 0.6, // s: after a no-knockback hit, further ones (breath ticks every 0.15 s) don't re-stagger
  defaultPush: 0.35, // m of slide on a stagger without knockback
  knockbackDecay: 6, // slide velocity decay; slide distance = knockback meters
  // a boss's hold (hold(): a stagger that cannot be cancelled) is at most this long (the owner's cap on
  // anything that locks the hero: 1.2 s)
  holdMax: 1.2,
  // THROWN THROUGH THE WORLD (a hit's `wjCrash`, Bai Wuji's): while his slide is faster than `minSpeed`
  // m/s (for at most `max` s), a breakable piece he meets takes a world.impact of the hit's power (one
  // per piece per throw, at most `pieces`); each one slows the slide x `keep`
  crash: { minSpeed: 3, max: 1.5, pieces: 6, keep: 0.6, reach: 0.12 },
  burnDps: 4,
  burnTick: 0.5,
  buffer: 0.3, // input buffer for roll / attacks / heal
  lockRange: 40,
  lockBreak: 50,
  pusher: 0.8,
  pusherRoll: 1.3,
  pusherDown: 1.0,
  windupSteer: 9, // rad/s of steering allowed during attack windups
  // a light's step in: a push-off and a brake (smoothstep) from `pre` s before the coil to `end` of
  // the active frames, so ~90 % of it is done as the front foot plants (anim.js lungeFeet, 0.45 of
  // the active frames) and the rest is a short skid. It was a constant-speed box to the end of the
  // active frames, and a third of every lunge slid the body on past the planted foot. A held light
  // released late starts its step at the release (`atk.relT`), at least `min` s long
  lungeShape: { pre: 0.08, end: 0.7, min: 0.1 },
  attackDamp: 30, // 1/s: in an attack the root's velocity follows `want` through this filter (_integrate)
  // a roll (and a guard) cancels a swing at ANY point: its windup, the cut itself, the recovery
  // (owner, 2026-11-14: "being able to animation cancel from a swing to a guard or dodge instantly").
  // A flask still waits for this fraction of the recovery
  rollCancel: 0.35,
  moveCancel: 0.6, // fraction of attack recovery after which movement input ends it
  // --- v0.2 defence (the windows themselves live in combat/rules.js DEFENSE)
  blockTurn: 12, // rad/s-ish damp toward the aim while blocking
  blockStun: 0.25, // s guard-stagger after blocking a blue tell
  chipPush: 0.15, // fraction of block pushback applied per stream tick (fire breath)
  blockEventGap: 0.4, // s: blocked stream ticks are reported at most this often (summed damage)
  parryDur: 0.3, // s of the deflect flick
  returnStop: 0.05, // s hit-stop of a perfectly parried bullet (light 0.03 < this < melee 0.08)
  parryCancel: 0.07, // s into the parry after which an attack / roll may cancel it (riposte; was 0.12)
  // the deflect chain (parries in rhythm against a multi-hit string): parries at most this far
  // apart count up (sparks, the clang's pitch, the snap side); each one slides the hero back a little
  deflectChainGap: 1.1,
  deflectPush: 0.16, // m
  guardLinger: [0.32, 0.6], // s after a parry: the guard stays up between taps, then eases down
  guardBreakDur: 0.45, // s stumble before the knockdown
  ghostepDur: 0.32, // s of the Ghostep reappear pose
  ghostepCancel: 0.08, // s into the Ghostep after which attack / roll / block may cancel it
  ghostepIframes: 0.3,
  ghostepMaxRange: 12, // attacker farther than this: slow-mo + crit without the teleport
  ghostepAssist: 1.2, // s of aim assist toward the attacker after a Ghostep (no lock-on)
  ghostepFade: 3.2, // 1/s fade of the reappear dissolve / cold tint
  // the duel's moments (a duelist offers them; the Ash Disciple): a roll INTO a perilous thrust
  // (hit.mikiri) started at most mikiriWindow s before its impact steps on the blade; the counter
  // pose lasts mikiriDur (attack / roll may cancel it after mikiriCancel)
  mikiriWindow: 0.3,
  mikiriToward: 0.55, // the roll's direction · against the attacker's facing (his thrust's line) must be at least this
  mikiriDur: 0.55,
  mikiriCancel: 0.18,
  // impact (owner, 2026-11-12: "epic sword clashes", "more impactful hit stun, not weightless"): a
  // blade's parry freezes the frame (normal / blue / perfect, s at ×0.02), throws a shockwave ring and
  // kicks the camera; a PERFECT one adds a short slow motion (flow.cinematic) and a white flash. A
  // blow that lands on the hero freezes it too (hurtStop / hurtStopBig).
  // (2026-11-14: the freeze is short inside a string, so a seven-cut exchange keeps its rhythm, and
  // long only where the exchange turns: the last blow, a heavy one, a perfect parry. The fighters hold
  // the contact pose while the sparks fly on, game.fxDt; the camera punches in `parryPunch` m.)
  parryStop: { chain: 0.05, normal: 0.075, blue: 0.095, last: 0.11, perfect: 0.14 },
  parryPunch: { normal: 1.5, blue: 2.2, last: 2.6, perfect: 3.6 },
  perfectParry: { slowmo: 0.35, dur: 0.36, zoom: -2.5, weight: 0.25 },
  // the bounce: a duelist's guard DEFLECTS the hero's strike (attacker → onGuarded { deflect }): the
  // blade is thrown back and he gives ground. A guard or a dodge cancels it at once (his counter is
  // coming); an attack only after bounceAttack s
  bounceDur: 0.42,
  bounceAttack: 0.28,
  bouncePush: 0.9, // m
  // the trade clash (DEFENSE.trade: his blow meets the hero's own cut): both blades thrown back, the
  // hero `tradePush` m (the same bounce: the next blow of a string cannot be traded too, it must be
  // guarded or dodged); a freeze of tradeStop s (a heavy cut: × 1.2), a camera punch
  tradePush: 0.55,
  tradeStop: 0.12,
  tradePunch: 3.2,
  // the blade lock (startBladeLock): the two close to `lockDist` m, blades crossed between them
  // (the hero's grip follows the crossing, `lockFit` of the gap a frame); the pair slides `lockSlide`
  // m toward whoever is losing over the meter's whole range
  lockDist: 1.3,
  lockSlide: 0.9,
  lockFit: 0.35,
  hurtStop: 0.085,
  hurtStopBig: 0.13,
  plungeFade: 7, // 1/s: the plunge's reappear above the head resolves faster (it hangs only briefly)
  rollCoatKick: 0.7, // the coat tails fly out as the dodge starts
  gemGlintEvery: 1.8, // s between idle glints of the violet gem (± 40 %)
  // the blade flares where the game camera can see it (part 17's pass gains: at 36 m the blade is one
  // 4 px cell, mostly silhouette line, and the art pass compresses its glow): × (1 + strike) through a
  // strike's window ([light, heavy]), + hit ([light, heavy or crit]) on a landed cut, held through the
  // freeze and cooling in `fall` s of game time; `line` = how much of the gain the ink and rim lines
  // take; `halo` = how much the flare lifts the dot halo
  // (2026-11-21, ADR-130: `strike` 0.12 / 0.2 -> 4.2 / 4.6 with the dark blade below: the steel is
  // plain at rest and white through the cut, as bright there as the old blade always was. `cool` =
  // 1/s the light leaves the steel once nothing lights it)
  bladeFlare: { strike: [4.2, 4.6], hit: [0.5, 0.75], fall: 0.12, line: 0.5, halo: 0.6, cool: 30 },
  // how bright the steel is at rest, against HERO_INK.blade (model.js): `line` its ink and rim lines,
  // `fill` its letters, `far` their gain at the game camera, `halo` the dot halo and the streak at the
  // point (0: none). The flare above multiplies these, so a dim blade still lights when it cuts.
  // The owner's pick of three (ADR-130): dark steel, drawn like his armour, until it cuts. All 1 was
  // the white blade with a glow that he carried everywhere
  bladeLook: { line: 0.32, fill: 0.6, far: 0.5, halo: 0 },
};

const CONTROL = new Set(['explore', 'bossIntro', 'boss']);
// the states a riposte may start from (the parry's flick, a held guard, standing free)
const RIPOSTE_FROM = new Set(['parry', 'block', 'idle', 'run', 'sprint']);
const LOCO = new Set(['idle', 'run', 'sprint']);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
// plunge phases (DEFENSE.plunge; the animator reads player.plungeAnim)
export const PL = Object.freeze({ VANISH: 0, HANG: 1, DIVE: 2, RIDE: 3, FLIP: 4, LAND: 5 });
// the landing search turns the spring-off direction by these (rad) when the body is in the way
const LAND_TURNS = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8, 2.4, -2.4, Math.PI];
const PLUNGE_BEHIND_TURN = 1.0; // rad off the nose: a hero who came from behind lands front-side
const PLUNGE_RIDE_MAX = 40; // m/s: the rider eases through a jump of the head (never teleports)
const PLUNGE_HANG_TRACK = 7; // m/s: the hang point drifts after a moving head at most this fast
// cross-fade (s) into each plunge phase's pose: the impact lands almost at once
const PL_BLEND = [0.02, 0.03, 0.05, 0.025, 0.06, 0.05];
// the shared per-part ink every rig on the page reads (model.js createHeroMaterials rewrites it on
// every build; setLoadout puts it back)
const PART_UNIFORMS = ['uHeroPartInk', 'uHeroPartFill', 'uHeroPartRim'];

const GHOST_PTS = 420; // points of his body an afterimage is drawn from (_sampleBody)

export class Player {
  constructor(game) {
    this.game = game;
    this.name = 'gcd'; // the hero (ADR-195): the name tag over his head
    /** His drawn size (model metres → world; model.js PLAYER_SCALE, ADR-064): the lean and the
     *  animator's foot planner read it. */
    this.drawScale = PLAYER_SCALE;
    // the outfit (gear/looks.js; main.js reads `?heroLook=`): its loadout, and its colours on this
    // rig's own materials. ?sword= (the owner's pick of the sword looks, gear/moonblade.js) swaps the
    // outfit's weapon
    this.look = getLook(game.heroLook)?.id ?? DEFAULT_LOOK;
    const sword = swordFromUrl(), lo = HERO_LOOKS[this.look].loadout;
    this.rig = buildHero(game.U, sword ? { ...lo, weapon: sword } : lo, { self: true });
    game.onModelBuilt?.('player'); // (see Dragon: the headless sims reseed their random stream here)
    tintHero(this.rig.materials, HERO_LOOKS[this.look].tint);
    this.object3d = this.rig.root;
    this.position = this.object3d.position;
    this.radius = 0.45;
    this.yaw = Math.PI;

    this.maxHp = TUNE.maxHp;
    this.hp = this.maxHp;
    this.maxFlasks = TUNE.maxFlasks;
    this.flasks = this.maxFlasks;
    this.state = 'idle';
    this.stateT = 0;
    this.lockOn = false;
    this.critTimer = 0;

    this.time = 0;
    // blows that landed on him (a hit, a guard broken; not a contact stream's chip): the clash dance's run
    // starts over when it moves (combat/clashDance.js; ADR-247)
    this.hurtN = 0;
    this.control = false;
    this.intent = { x: 0, z: 0, len: 0, sprint: false };
    this.buf = { action: null, t: 0 };
    // the HEAVY button's press (game time held): held past CHARGE.hold it is the charge (ADR-115; it
    // was the attack button's until the heavy button came: a light no longer waits to see if it is held)
    this.hb = { held: false, t: 0 };
    this.rmb = { held: false, upT: -Infinity, parryT: -Infinity, edge: false, chain: false };
    this.vel = { x: 0, z: 0 }; // own movement
    this.want = { x: 0, z: 0 }; // desired movement this frame
    this.kb = { x: 0, z: 0 }; // knockback slide
    // the throw through the world (a hit's `wjCrash`, TUNE.crash): on while the slide carries him
    this.crash = { on: false, power: 0, damage: 0, t: 0, n: 0, hits: [], by: null };
    this._crashNear = [];
    this.groundVel = { x: 0, z: 0 }; // actual displacement / dt (drives the gait)
    // { def, t, hit, prevT, pending, damage, poise, charge, gust, lunge, travel, impact, relT, hitAt,
    //   cutDir, glintZ, shaped, svx, svz }
    // (relT: the attack clock at a held light's release, 0 = never held; hitAt: at the landed,
    // unguarded hit, −1 = none. anim.js reads both: the root's step, the bite. Internal: shaped =
    // this frame's `want` is a light's shaped step, svx / svz = the step's velocity _integrate landed
    // the root on last frame: the step's filter pre-compensation)
    this.atk = null;
    this.gemT = 0.6; // s to the next idle gem glint
    this.chargeK = 0; // 0..1 while charging (anim + glow)
    this.chargeFull = false;
    this.releaseK = 0; // charge of the thrust in flight (blade glow, thrust pose)
    this.recoil = 0; // block impact 0..1 (anim)
    this.blockStunT = 0;
    this.blockEvt = { t: -Infinity, attack: null, stream: false, acc: 0 };
    this.iframeT = 0; // Ghostep i-frames
    // perfect dodges, parries and clashes in a row (DEFENSE.flurry): the next perfect dodge (or
    // parried last blow) is answered with one blow more; a blow that hurts him ends it. streakT: s
    // since the last one (DEFENSE.flurry.keepStreak)
    this.streak = 0;
    this.streakT = 0;
    this.parryRun = 0; // ?parryRiposte=deathblow: the perfect parries of blows since the foe's posture was last empty
    this.db = newDeathblowState(); // the deathblow's own state (deathblow.js)
    // the guard meter (combat/rules.js GUARD, ADR-095): a blocked blow costs guard, not HP; it
    // refills by itself once guardWait (s) has run out. staggerLen: how long this stagger lasts
    this.maxGuard = GUARD.max;
    this.guard = GUARD.max;
    this.guardWait = 0;
    this.staggerLen = TUNE.staggerDur;
    this.slowmoPending = 0; // Ghostep slow-mo waiting for a harsher freeze to end (s)
    // a riposte waiting for the parry's own freeze to end (flurry.js `riposte`; DEFENSE.flurry)
    this.riposte = { att: null, t: 0, attack: null, tell: TELL.NORMAL, counter: false };
    this.assist = { target: null, t: 0 };
    this.ghostFx = 0; // 1 → 0 after a Ghostep: dissolve-in + cold tint
    this.rollBack = false;
    this.rollLean = false; // (a backstep that is the Long Second: TUNE.lean)
    this.rollDir = { x: 0, z: -1 };
    this.rollAim = { x: 0, z: 0, set: false }; // a buffered dodge's own direction (a touch swipe; ADR-271)
    this.healApplied = false;
    this.burnT = 0;
    this.burnAcc = 0;
    this.burnGlow = 0;
    this.burnLight = null;
    this.healLight = null;
    this.flash = 0;
    this.diedEmitted = false;
    this.onceMask = 0;
    this.enterN = 0; // bumps on every state entry (dodge events are per roll / get-up)
    this.dodgeN = -1;
    this.dodgeKey = '';
    this.chipGuard = 0;
    this.shotStunT = 0; // s a bullet's flinch still guards him from another (hit.stun, ADR-169)
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._lock = new THREE.Vector3();
    this._hit = { sphere: null, x: 0, y: 0, z: 0 };
    // the drawn contact of the last landed cut (_contactPoint): the point (x, y, z), where it lies
    // along the hit segment (f), the blade's travel there (cx, cy, cz; world, last frame → this one),
    // its ground-plane direction (gx, gz, unit) and the blade's own direction (ex, ey, ez, unit)
    this._cut = { x: 0, y: 0, z: 0, f: 0, cx: 0, cy: 0, cz: 0, gx: 0, gz: 1, ex: 0, ey: 0, ez: 1 };
    this._cA = new THREE.Vector3();
    this._cB = new THREE.Vector3();
    this._cS = new THREE.Vector3();
    this._cP = new THREE.Vector3();
    this._tip = new THREE.Vector3();
    this._tipPrev = new THREE.Vector3();
    this._gem = new THREE.Vector3();
    this._gemPrev = new THREE.Vector3();
    this.gemVel = { x: 0, y: 0, z: 0 }; // the hilt's own velocity: glints ride with the gem
    this.glyphScale = 1; // hero glyph-cell scale from the view distance (model.js setHeroGlyphScale)
    this.viewDist = 36; // camera → hero distance (m), sampled each frame
    this.bladeFar = 1; // 0 close-up … 1 game camera: how much the blade self-lights
    this.bladeFlare = 0; // 0..0.75: a landed cut's flare of the steel (TUNE.bladeFlare; any area may raise it)
    this.bladeHot = 0; // 0..1: how lit the steel is by what he is doing (a strike, the charge, the flurry, the plunge)
    this._ghostSegs = new Float32Array(16 * 6);
    // the afterimage's figure: points on his body as it was last drawn (world; _sampleBody)
    this._ghostPts = new Float32Array(GHOST_PTS * 3);
    this._ghostSrc = null; // { key, list: [{ mesh, idx }] }: which vertices of which meshes are sampled
    // the plunge (state 'plunge', DEFENSE.plunge): the attacker, the phase clock, the head point
    // this frame, the spring-off direction (dx, dz: from the head toward the landing side), the
    // ride offset, the flip's start and landing. position.y carries the visual lift while it runs.
    this.pl = {
      att: null, exec: false, phase: PL.VANISH, t: 0, hit: false, dealt: 0, ox: 0, oz: 0, dx: 0, dz: 1,
      pt: new THREE.Vector3(), off: new THREE.Vector3(), from: new THREE.Vector3(), land: new THREE.Vector3(),
      hitPt: { x: 0, y: 0, z: 0 }, flipDur: 0.5, fxT: 0, streak: false,
    };
    this.plungeAnim = { phase: PL.VANISH, u: 0, t: 0, exec: false, h: 0 }; // read by anim.js
    // the parry chain (TUNE.deflectChainGap); perfect = the last parry was within DEFENSE.perfectParryWindow
    // side / high / nudge: where the deflect pose puts the blade (anim.js deflectPose): on the side
    // the blow's steel is, raised for a blow from above (high > 0) or hung point-down for a low cut
    // (high < 0), the grip moved (nx, ny, nz, body axes, model metres) until the two blades touch
    this.deflect = { n: 0, t: -Infinity, side: 1, perfect: false, high: 0, nx: 0, ny: 0, nz: 0, gap0: 0, gap: 0 };
    this._cp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.tradeT = -Infinity; // when the last trade clash was (DEFENSE.trade.rearm)
    this.quickUntil = -Infinity; // a light started before this is the counter cut (DEFENSE.perfectParry)
    this.guardHold = 0; // 0..1: the guard lingers between parries (anim.js)
    // hit reactions (anim.js; ADR-083)
    this.hitPush = { x: 0, z: -1 }; // the way the last blow drove him, in his own axes (z − = back, x + = his left)
    this.kdProne = false; // the knockdown fell him on his FRONT (the blow came from behind)
    this.kdYaw = 0; // the facing the knockdown turns him to as he falls (square to the blow)
    this.downFrom = 0; // s into the knockdown at which he was killed (the death on the ground)
    this.deadDown = false; // he died where he lay
    this.bladeLock = null; // { att, meter, push, decay, dur } while blades are locked (startBladeLock)

    // Lab hooks (ARCHITECTURE.md: debug = { god, infiniteFlasks, attackSpeed, heal(), teleport(x, z) })
    this.debug = {
      god: false,
      infiniteFlasks: false,
      // the stance he stands in (stances.js): true holds the fight stance, false at ease; null = the
      // game decides (the fight stance while locked on or in a boss fight)
      fightStance: null,
      // a multiplier on the attack clock: every swing's windup, cut and recovery run this much
      // faster (its lunge covers the same ground). 1 in play; the Lab's slider tries other paces
      attackSpeed: 1,
      heal: () => this._debugHeal(),
      teleport: (x, z) => this._teleport(x, z),
      kill: () => this._debugKill(), // used by flow.debug.toState('dead') when present
      // Lab / captures: start the plunge on the dragon now (any range; also in the air)
      plunge: (execution = false) => this._debugPlunge(execution),
      // the art the next flurries end on (flurry.js ARTS; null = one at random), the streak set by
      // hand, and a flurry of `strikes` blows on the boss now (`art`: for this one only)
      flurryArt: null,
      noRiposte: false, // true: a parried last blow is not answered with the riposte
      flurryAny: false, // true: every perfect dodge is answered with the flurry (DEFENSE.flurry.on 'any')
      streak: (n) => this._debugStreak(n),
      flurry: (strikes = 3, art = null) => this._debugFlurry(strikes, art),
    };

    this.anim = new HeroAnimator(this.rig, this, null, { freeHand: true });
    this.anim.onFootstep = (side, dust) => this._footstep(side, dust);
    this.fx = new PlayerFx(game, this.rig);
    this.slashFx = new SlashFx(this); // every swing's instant slash line (slashFx.js; ?slash=arc: the crescent)
    this.mystic = new SwordMystic(this); // the sword's green flame (on by default; ?mystic=0 = nothing drawn)
    this.flurry = new Flurry(this, TUNE);
    // camera lean (model.js LEAN): visual only; hits and the dragon's aim use unleaned positions
    this.lean = installLean(this.object3d, this.drawScale);
    this.sweep = new SwordSweep(this.rig.sword, (v) => this.unlean(v));
    // CONTACT (?contact=a): his body answers where a blow met it (the duelists' HitReact, drawn only: after
    // the sword's sweep is read, off again before the animator runs)
    this.hitReact = new HitReact(this);

    markCaster(this.object3d);
    // one draw call per material instead of one per mesh (render/rigidBatch.js)
    this.batch = batchRigid(game.U, this.object3d);
    game.scene.add(this.object3d);
    const s = CONFIG.world.playerSpawn;
    this.respawn(s.x, s.z);
  }

  // ------------------------------------------------------------------ contract
  get alive() {
    return this.state !== 'dead' && this.hp > 0;
  }

  /** RMB held and able to block (a blue-tell guard-stagger keeps the guard up). */
  get blocking() {
    return this.state === 'block' || (this.state === 'parry' && this.rmb.held);
  }

  /** Clip time for the animator: attacks run on their own clock (a held light pauses at the coil). */
  get animT() {
    return this.atk && (this.state === 'attack' || this.state === 'heavy') ? this.atk.t - fin(this.atk.show, 0) : this.stateT;
  }

  /** True while the blade is cutting (a light / heavy swing's active frames): bullets.js cuts bullets on it. */
  isSwinging() {
    const a = this.atk;
    if (!a || a.pending || !a.def || (this.state !== 'attack' && this.state !== 'heavy')) return false;
    return a.t >= a.def.windup && a.t <= a.def.windup + a.def.active + 0.04;
  }

  /**
   * The hand feels a cut on something small the boss sends at him (the wyrm's brood, dragon/brood.js,
   * ADR-197: it tests his blade itself, as bullets.js does): a short hit-stop, sparks along the cut
   * (dx, dz), a jolt of the camera. Nothing else (no damage dealt, no streak).
   */
  feelCut(x, y, z, dx = 0, dz = 0, heavy = false) {
    if (!Number.isFinite(x + y + z)) return;
    this._hitstop(heavy ? 0.075 : 0.05, 0.05);
    this.fx.sparks(x, y, z, fin(dx), fin(dz), heavy);
    this.game.shake?.(heavy ? 0.22 : 0.14);
  }

  /** What the animator's flurry clip reads (flurry.js `anim`). */
  get flurryAnim() {
    return this.flurry.anim;
  }

  isInvulnerable() {
    if (!this.alive) return true;
    if (this.state === 'plunge' || this.state === 'flurry') return true; // the whole move (takeHit ignores hits in it)
    if (this.state === 'lock') return true; // blades locked
    if (this.iframeT > 0) return true; // Ghostep / the plunge's landing
    if (this.state === 'roll') {
      const R = this._rollTune();
      return this.stateT >= R.iframes[0] && this.stateT <= R.iframes[1];
    }
    if (this.state === 'knockdown') return this.stateT >= TUNE.knockdownDur - TUNE.getUpIframes;
    return false;
  }

  /**
   * Resolve an incoming hit (docs/COMBAT.md), in order: ignored → perfect dodge (the plunge, or
   * the Ghostep) → i-frames → parry → block / guard break → hit. Returns a RESULT value.
   * `hit.plunge === false` (hazards) keeps a perfect dodge from turning into the plunge.
   */
  takeHit(hit = {}) {
    hit = hit && typeof hit === 'object' ? hit : {};
    const hp0 = this.hp, was = this.alive;
    const r = this._takeHit(hit);
    // every blow he answers is announced (the move telemetry, game/telemetry.js): what it was, how
    // it was answered and what it cost. `stream`: a contact tick (breath, burning ground), not a blow
    if (r !== RESULT.IGNORED && was) {
      this._emit('combat:answer', {
        attack: typeof hit.attack === 'string' && hit.attack ? hit.attack : String(hit.kind ?? 'blow'),
        tell: tellOf(hit.tell),
        result: r, damage: Math.max(0, fin(hp0) - fin(this.hp)), dead: !this.alive,
        stream: !hit.bullet && !hit.steel && !(fin(hit.knockback, 0) > 0) && !hit.knockdown && fin(hit.damage, 0) <= 8,
        perfect: r === RESULT.PARRIED && !!this.deflect?.perfect,
      });
    }
    return r;
  }

  _takeHit(hit) {
    if (!this.alive) return RESULT.IGNORED;
    const g = this.game;
    if (g.state === 'victory' || g.state === 'title') return RESULT.IGNORED;
    if (this.state === 'plunge' || this.state === 'flurry') return RESULT.IGNORED; // in the air / on the head / between two blinks: out of reach
    if (this.state === 'lock') return RESULT.IGNORED; // blades locked: the push decides it
    const kind = typeof hit.kind === 'string' ? hit.kind : 'hit';
    const tell = tellOf(hit.tell);
    const def = tellDefaults(tell);
    const parryable = typeof hit.parryable === 'boolean' ? hit.parryable : def.parryable;
    const blockable = typeof hit.blockable === 'boolean' ? hit.blockable : def.blockable;
    const attack = hit.attack ?? null;
    const attacker = hit.attacker && typeof hit.attacker === 'object' ? hit.attacker : null;

    // (a) mikiri: a perilous thrust (hit.mikiri) met by a roll INTO the attacker, started at most
    // TUNE.mikiriWindow before the impact: the hero steps on the blade (attacker.onMikiri)
    if (hit.mikiri && attacker && this.state === 'roll' && !this.rollBack && this.stateT <= TUNE.mikiriWindow && this._rollToward(attacker)) {
      this._mikiri(attacker, attack);
      return RESULT.PERFECT;
    }
    // (b) perfect dodge: the roll started within the window before this impact → the plunge (or the
    // Ghostep). A stream (breath) ticks every 0.15 s, so it only counts when dodging INTO it, not
    // rolling out of it.
    const streamTick = !(fin(hit.knockback, 0) > 0) && !hit.knockdown;
    if (hit.perfect !== false && this.state === 'roll' && this.stateT <= DEFENSE.perfectDodgeWindow && !(streamTick && this.chipGuard > 0)) {
      this._perfectDodge(attacker, attack, tell, hit.plunge !== false);
      return RESULT.PERFECT;
    }
    // (c) i-frames: one event per roll / get-up per attack (a breath stream ticks many times)
    if (this.isInvulnerable()) {
      const key = `${kind}|${typeof attack === 'string' ? attack : ''}`;
      if (this.dodgeN !== this.enterN || this.dodgeKey !== key) {
        this.dodgeN = this.enterN;
        this.dodgeKey = key;
        this._emit('player:dodge', { kind });
      }
      return RESULT.DODGED;
    }

    const dmg = Math.max(0, fin(hit.damage, 0));
    const kb = clamp(fin(hit.knockback, 0), 0, 14);
    const burn = clamp(fin(hit.burn, 0), 0, 15);
    const knockdown = !!hit.knockdown;
    const chip = kb <= 0 && !knockdown; // contact damage streams (breath)

    // push direction: away from the source (fallback: backwards)
    const p = this.position;
    let nx = -Math.sin(this.yaw), nz = -Math.cos(this.yaw);
    const fx = fin(hit.from?.x, NaN), fz = fin(hit.from?.z, NaN);
    const hasFrom = Number.isFinite(fx) && Number.isFinite(fz);
    const ap = attacker?.position;
    const hasAtk = !!ap && Number.isFinite(ap.x) && Number.isFinite(ap.z);
    const sx = hasFrom ? fx : hasAtk ? ap.x : NaN, sz = hasFrom ? fz : hasAtk ? ap.z : NaN;
    const hasSrc = Number.isFinite(sx) && Number.isFinite(sz);
    if (hasSrc) {
      const dx = p.x - sx, dz = p.z - sz;
      const l = Math.hypot(dx, dz);
      if (l > 1e-3) {
        nx = dx / l;
        nz = dz / l;
      }
    }

    // (c2) a BLACK (charged) blow met on a raised guard or a parry press (ADR-118): it is stopped and
    // deals nothing, but the whole guard meter is gone and the guard is knocked open (GUARD.black)
    if (tell === TELL.BLACK && !parryable && !blockable) {
      const arc = (a) => hit.around || this._inArc(a, hasFrom, fx, fz, hasAtk ? ap : null);
      const pressed = this._canGuard() && this.time - this.rmb.parryT <= DEFENSE.parryWindow && arc(DEFENSE.parryArc);
      if (pressed || (this.blocking && arc(DEFENSE.blockArc))) {
        this._guardOpen(attack, nx, nz, true);
        return RESULT.BLOCKED;
      }
    }
    // (d) parry: RMB pressed shortly before impact, attacker in the front arc; pressed within
    // perfectParryWindow it is a perfect parry (deflect.perfect: the attacker and its bullets read it)
    if (
      parryable &&
      this._canGuard() &&
      this.time - this.rmb.parryT <= DEFENSE.parryWindow &&
      (hit.around || this._inArc(DEFENSE.parryArc, hasFrom, fx, fz, hasAtk ? ap : null))
    ) {
      const perfect = this.time - this.rmb.parryT <= perfectParryWindow(); // (?parry=one, the default: every parry; ADR-279)
      this._parry(tell, attack, hasSrc ? sx : NaN, hasSrc ? sz : NaN, !!hit.light, perfect, hit);
      return RESULT.PARRIED;
    }
    // (d2) the trade clash: a blade's blow that arrives in the hero's own cut meets it
    if (hit.steel && parryable && attacker && this._cutting() && this._inArc(DEFENSE.parryArc, hasFrom, fx, fz, hasAtk ? ap : null)) {
      this._trade(attacker, { tell, attack, last: hit.last !== false, late: true });
      return RESULT.CLASHED;
    }
    // (e) block / (f) guard break
    // (`hit.around`: a foe's flurry comes from every side in turn: a raised guard meets it from any)
    if (this.blocking && (hit.around || this._inArc(DEFENSE.blockArc, hasFrom, fx, fz, hasAtk ? ap : null))) {
      // (`breaksGuard`, ADR-144: the Sheathed's draw met on a HELD guard: no health lost, the whole
      // meter gone and the guard knocked open, as a black blow does to a guard)
      if (hit.breaksGuard && blockable) {
        this._guardOpen(attack, nx, nz, true);
        return RESULT.BLOCKED;
      }
      if (blockable) {
        this._blowBy = hit.steel || hit.melee ? attacker : null; // (CONTACT: _block poses his blow on the guard)
        this._block(dmg, tell, attack, chip, nx, nz, hit.guardCost, hit.blockPush);
        this._blowBy = null;
        return RESULT.BLOCKED;
      }
      this._streakEnd();
      this.parryRun = 0;
      this._guardBreak(dmg, kind, burn, kb, attack, nx, nz, hasSrc);
      return RESULT.HIT;
    }

    // (g) plain hit
    // (`hit.stun`, ADR-169: a bullet's FLINCH: a stagger of `stun` s that keeps the input buffer (a press
    // during it fires as it ends); while one runs, and `hit.mercy` s after it, another bullet hurts him but
    // never staggers him again. Absent on every other hit: as before)
    const stun = clamp(fin(hit.stun, 0), 0, TUNE.staggerDur);
    const stunned = stun > 0 && this.shotStunT > 0;
    const guarded = (chip && this.chipGuard > 0) || stunned;
    if (chip) this.chipGuard = TUNE.chipGuard;
    this._streakEnd(); // hurt: the streak of perfect dodges is over
    this.parryRun = 0; // (and the perfect parries toward a deathblow)
    if (!chip) this.guardWait = Math.max(this.guardWait, GUARD.regenDelay);
    if (!chip) this.hurtN++;
    this._damage(dmg);
    if (burn > 0) this.burnT = Math.max(this.burnT, burn);
    this._crashArm(hit, attacker, kb);
    this.flash = 1;
    const big = knockdown || dmg >= 25;
    // (CONTACT, ?contact=a: the blow is posed where it meets his body, the hurt drawn there)
    const met = this._strikeMet(attacker, big || tell === TELL.BLUE, false, this._v) || (hit.melee === true && this._pointMet(hit.point, hasSrc ? sx : NaN, hasSrc ? sz : NaN, this._v));
    if (!met) this.getChestPos(this._v, true);
    this.fx.hurt(this._v.x, this._v.y, this._v.z, nx, nz, big);
    if (met) this._reactTo(this._v, this.struck, nx, nz, big || tell === TELL.BLUE);
    this._emit('player:hurt', { damage: dmg, kind, hp: this.hp });

    if (this.hp <= 0) {
      this._setKb(nx, nz, kb);
      this._die();
      g.shake?.(0.5);
      this._hitstop(0.12);
      return RESULT.HIT;
    }
    g.shake?.(guarded ? 0.06 : clamp(0.3 + dmg * 0.008, 0.3, 0.6));
    if (!guarded) this._hitstop(big ? TUNE.hurtStopBig : TUNE.hurtStop, 0.02);

    // struck in the middle of a move (a swing, the charge, a roll) the reaction fades in over a
    // little longer: the pose it leaves is far from the flinch, and 3 frames threw the blade over a
    // metre in one of them
    const hot = this._midMove();
    if (knockdown) {
      if (this.state !== 'knockdown') {
        this._interrupt();
        this._fallFrom(nx, nz, hasSrc);
        this._setKb(nx, nz, Math.max(kb, 1.2));
        this._enter('knockdown', 'knockdown', hot ? 0.1 : 0.06);
      }
    } else if ((kb > 0 && !stunned) || (dmg >= TUNE.minStaggerDamage && !guarded)) {
      if (this.state !== 'knockdown' && this.state !== 'guardBreak') {
        const kept = stun > 0 ? this.buf.action : null, keptT = this.buf.t;
        this._interrupt();
        if (kept) {
          this.buf.action = kept;
          this.buf.t = keptT;
        }
        // the way the blow drives him, in his own axes: the flinch gives that way
        const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        this.hitPush.x = nx * cy - nz * sy;
        this.hitPush.z = nx * sy + nz * cy;
        this._setKb(nx, nz, Math.max(kb, TUNE.defaultPush));
        this._enter('stagger', 'stagger', hot ? 0.1 : 0.05);
        if (stun > 0) {
          this.staggerLen = stun;
          this.shotStunT = stun + clamp(fin(hit.mercy, 0), 0, 1);
        }
      }
    }
    return RESULT.HIT;
  }

  /** In the middle of a move whose pose is far from a reaction's (not standing or running). */
  _midMove() {
    const s = this.state;
    return s !== 'idle' && s !== 'run' && s !== 'sprint' && s !== 'stagger';
  }

  /** A knockdown falls AWAY from the blow: on his back when it came from the front or a side, on
   *  his front when it came from behind (ADR-083: he used to turn round to face it in one frame,
   *  whatever side it came from). The facing eases square to the blow as he falls (_tickKnockdown). */
  _fallFrom(nx, nz, hasSrc) {
    if (!hasSrc) {
      this.kdProne = false;
      this.kdYaw = this.yaw;
      return;
    }
    const toAtk = Math.atan2(-nx, -nz);
    this.kdProne = Math.cos(wrapAngle(toAtk - this.yaw)) < -0.25; // it came from behind him
    this.kdYaw = this.kdProne ? wrapAngle(toAtk + Math.PI) : toAtk;
  }

  /** Chest point, world space. Unleaned (where the body really is) unless `visual` (FX anchors). */
  getChestPos(out, visual = false) {
    out = out || new THREE.Vector3();
    this.rig.chest.getWorldPosition(out);
    if (!visual) this.unlean(out);
    out.y += 0.1;
    if (!Number.isFinite(out.x + out.y + out.z)) out.set(this.position.x, 1.3, this.position.z);
    return out;
  }

  /** Lean away from the camera: LEAN.frac × its pitch below the horizon (model.js LEAN). */
  _updateLean() {
    const L = this.lean, cam = this.game.camera;
    if (!L) return;
    L.k = 0;
    if (!cam?.matrixWorld) return;
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const h = Math.hypot(fx, fz);
    if (!(h > 1e-3) || !Number.isFinite(fy)) return;
    const a = Math.min(LEAN.max, Math.max(0, LEAN.frac * Math.atan2(-fy, h)));
    L.k = Math.tan(a);
    L.dx = fx / h;
    L.dz = fz / h;
  }

  /** World point on the drawn body (leaned, drawScale) → the same point on the upright 1.85 m
   *  gameplay body. */
  unlean(v) {
    const L = this.lean, p = this.position;
    const k = L?.k || 0;
    let x = v.x - p.x, y = v.y - p.y, z = v.z - p.z;
    x -= k * L.dx * y;
    z -= k * L.dz * y;
    const S = this.drawScale;
    v.set(p.x + x / S, p.y + y / S, p.z + z / S);
    return v;
  }

  /** Point on the upright gameplay body → where it is drawn (leaned, drawScale): the name tag. */
  leanPoint(v) {
    const L = this.lean, p = this.position;
    const k = L?.k || 0;
    const S = this.drawScale;
    const x = (v.x - p.x) * S, y = (v.y - p.y) * S, z = (v.z - p.z) * S;
    v.set(p.x + x + k * (L?.dx || 0) * y, p.y + y, p.z + z + k * (L?.dz || 0) * y);
    return v;
  }

  respawn(x, z) {
    const s = CONFIG.world.playerSpawn;
    this.position.set(fin(x, s.x), 0, fin(z, s.z));
    this.yaw = Math.PI;
    this.object3d.rotation.y = this.yaw;
    this.hp = this.maxHp;
    this.flasks = this.maxFlasks;
    this.state = 'idle';
    this.stateT = 0;
    this.onceMask = 0;
    this.vel.x = this.vel.z = 0;
    this.want.x = this.want.z = 0;
    this.kb.x = this.kb.z = 0;
    this.crash.on = false;
    this.groundVel.x = this.groundVel.z = 0;
    this.atk = null;
    this.bladeLock = null;
    this.kdProne = false;
    this.deadDown = false;
    this.downFrom = 0;
    this.rollBack = false;
    this.rollLean = false;
    this.healApplied = false;
    this.buf.action = null;
    this.hb.held = false;
    this.hb.t = 0;
    this.rmb.held = false;
    this.rmb.edge = false;
    this.rmb.upT = -Infinity;
    this.rmb.parryT = -Infinity;
    this.rmb.chain = false; // a deflect's instant re-arm doesn't survive a respawn / reset
    this.chargeK = 0;
    this.chargeFull = false;
    this.releaseK = 0;
    this.recoil = 0;
    this.blockStunT = 0;
    this.blockEvt.t = -Infinity;
    this.blockEvt.attack = null;
    this.blockEvt.stream = false;
    this.blockEvt.acc = 0;
    this.critTimer = 0;
    this.iframeT = 0;
    this.slowmoPending = 0;
    this.assist.target = null;
    this.assist.t = 0;
    this.ghostFx = 0;
    this.pl.att = null;
    this.pl.phase = PL.VANISH;
    this.streak = 0;
    this.streakT = 0;
    this.parryRun = 0;
    this.db.phase = '';
    this.db.att = null;
    deathblowFxClear?.(this.game);
    deathblowMatrixClear?.(this.game);
    this.guard = this.maxGuard;
    this.guardWait = 0;
    this.riposte.att = null;
    this.flurry.clear();
    this.tradeT = -Infinity;
    this.quickUntil = -Infinity;
    this.deflect.n = 0;
    this.deflect.t = -Infinity;
    this.deflect.perfect = false;
    this.guardHold = 0;
    this.flash = 0;
    this.bladeFlare = 0;
    this.bladeHot = 0;
    this.burnGlow = 0;
    this.chipGuard = 0;
    this.shotStunT = 0;
    this.dodgeN = -1;
    this.diedEmitted = false;
    this._clearBurn();
    if (this.healLight) {
      this.healLight.kill?.();
      this.healLight = null;
    }
    this._setLock(false);
    this.anim.reset();
    this.fx.reset();
    this.sweep.valid = false;
    this._updateMaterials(0);
    this.game.world?.setPusher?.(0, this.position.x, 0, this.position.z, TUNE.pusher);
  }

  /** The equipped gear: slot → item id or null (gear/index.js SLOTS). */
  get loadout() {
    return this.rig.loadout;
  }

  /** Put item `id` (or null: take it off) in `slot`. See setLoadout. */
  equip(slot, id) {
    return this.setLoadout({ ...this.rig.loadout, [slot]: id ?? null });
  }

  /**
   * Wear `loadout` (slot → gear item id or null; gear/README.md): the outfit and the weapon are
   * rebuilt from their items and swapped in under the same root, so `object3d` / `position` stay
   * the objects everything else holds. The animator is rebuilt with the new cloth (its pose restarts
   * from the ready stance: equip out of combat). Throws on an unknown item id or an item in the
   * wrong slot, before anything is changed. Build-time cost (allocates): never call it per frame.
   */
  setLoadout(loadout) {
    // a build rewrites the SHARED per-part ink for every rig on the page (model.js
    // createHeroMaterials): put back what was there (a boss's own, e.g. the Lord's red part 19), even
    // if the build throws
    const U = this.game.U, saved = PART_UNIFORMS.map((k) => U[k]?.value?.map((v) => v.clone()) ?? null);
    let rig;
    try {
      rig = buildHero(U, loadout, { self: true });
    } finally {
      saved.forEach((a, i) => a && U[PART_UNIFORMS[i]].value.forEach((v, j) => a[j] && v.copy(a[j])));
    }
    tintHero(rig.materials, HERO_LOOKS[this.look]?.tint);
    const root = this.object3d, old = this.rig;
    this.batch?.dispose(); // the old rig's rigid batches (their bone slots are reused below)
    for (const c of [...root.children]) root.remove(c);
    for (const c of [...rig.root.children]) root.add(c);
    rig.root = root;
    old.body?.traverse((o) => {
      if (o.isMesh) o.geometry?.dispose();
    });
    for (const m of old.mats) m.dispose();
    this.rig = rig;
    const onFootstep = this.anim.onFootstep;
    this.anim = new HeroAnimator(rig, this, null, { freeHand: true });
    this.anim.onFootstep = onFootstep;
    this.fx.rig = rig;
    this.sweep.sword = rig.sword;
    this.sweep.valid = false;
    markCaster(root);
    this.batch = batchRigid(this.game.U, root);
    this._updateMaterials(0);
    root.updateMatrixWorld(true);
    return rig.loadout;
  }

  /** Wear outfit option `id` (gear/looks.js): its loadout (the equipped weapon kept) and its colours.
   *  Throws on an unknown id and changes nothing. Build-time cost (setLoadout). */
  setLook(id) {
    const L = getLook(id);
    if (!L) throw new Error(`no hero look "${id}" (${LOOK_IDS.join(', ')})`);
    const prev = this.look;
    this.look = L.id;
    try {
      return this.setLoadout({ ...L.loadout, weapon: this.rig.loadout.weapon });
    } catch (e) {
      this.look = prev;
      throw e;
    }
  }

  restAtBonfire() {
    if (!this.alive) return;
    this.hp = this.maxHp;
    this.guard = this.maxGuard;
    this.guardWait = 0;
    this.flasks = this.maxFlasks;
    this.buf.action = null;
    this.critTimer = 0;
    this._clearBurn();
    this._setLock(false);
  }

  update(dt) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    const g = this.game;
    this.time += dt;
    const control = this.alive && CONTROL.has(g.state);
    // skip input on the first controllable frame (the click that dismissed a menu)
    this._readInput(control && this.control, dt);
    this.control = control;
    if (this.buf.action && this.time - this.buf.t > TUNE.buffer) this.buf.action = null;
    if (this.chipGuard > 0) this.chipGuard -= dt;
    if (this.shotStunT > 0) this.shotStunT -= dt;
    if (this.critTimer > 0) this.critTimer = Math.max(0, this.critTimer - dt);
    if (this.iframeT > 0) this.iframeT = Math.max(0, this.iframeT - dt);
    if (this.assist.t > 0) this.assist.t -= dt;
    // the guard meter refills by itself, whatever he is doing (GUARD)
    if (this.guardWait > 0) this.guardWait -= dt;
    else if (this.guard < this.maxGuard && this.alive) this.guard = Math.min(this.maxGuard, this.guard + GUARD.regenRate * dt);
    if (this.streak > 0 && DEFENSE.flurry.keepStreak > 0) {
      this.streakT += dt;
      if (this.streakT > DEFENSE.flurry.keepStreak) this._streakEnd();
    }
    if (this.slowmoPending > 0 && !(fin(g.hitstopTimer) > 0)) this._slowmo(this.slowmoPending);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    // between parries in rhythm the guard stays up (anim.js holds the block's arms and blade)
    const GL = TUNE.guardLinger, since = this.time - this.deflect.t;
    this.guardHold = this.alive ? 1 - smoothstep(GL[0], GL[1], since) : 0;
    this._updateLock();

    this.stateT += dt;
    this._tickRiposte(dt);
    if (this.hp <= 0 && this.state !== 'dead') this._die(); // hp zeroed from outside: never stuck half-dead
    // RMB press: raise the guard from anything that can guard (cancels windups, recoveries, a charge
    // or a held light). Pressed mid-swing / mid-roll, the request waits while RMB stays held, so the
    // guard comes up the moment it can instead of only at the end of the recovery.
    // (not inside a deathblow combo: a guard press there ended it with nothing dealt. The press waits while the
    // button stays held and the guard comes up in the finisher's tail, as after any swing; ADR-280)
    const Rb = this.rmb;
    if (Rb.edge && this.state !== 'block' && this.state !== 'parry' && this.db.phase !== 'combo' && this._canGuard()) {
      // the guard spends the held heavy press, otherwise _tickBlock would re-enter the charge at once
      if (this.state === 'charge' || this.atk?.pending) this.hb.held = false;
      this._startBlock();
    }
    if (!Rb.held || this.state === 'block' || this.state === 'parry') Rb.edge = false;
    this._tick(dt);
    this._integrate(dt);
    this._updateBurn(dt);

    this.yaw = wrapAngle(fin(this.yaw, Math.PI));
    this.object3d.rotation.y = this.yaw;
    this._updateLean();
    // the animator poses the plain upright body; the drawn one (lean, drawScale) is applied after
    this.lean.on = false;
    this.hitReact.restore(); // (CONTACT: last frame's drawn reaction off his joints)
    // (the flurry runs on real time while the world is held: so do his pose and his cloth)
    this.anim.update(this.state === 'flurry' ? this.flurry.animDt : dt);
    this.lean.on = true;
    this.object3d.updateMatrixWorld(true);
    this._combat();
    if (this.hitReact.active) {
      // (drawn only, after the sweep read the blade: his hits and guards never see it)
      this.lean.on = false;
      this.hitReact.apply(dt);
      this.lean.on = true;
      this.object3d.updateMatrixWorld(true);
    }
    this._updateFx(dt);
    this._updateMaterials(dt);

    const st = this.state;
    const r = st === 'roll' ? TUNE.pusherRoll : st === 'knockdown' || st === 'dead' || st === 'guardBreak' ? TUNE.pusherDown : TUNE.pusher;
    // (in the air the pusher's height lifts it off the grass: world.setPusher ignores y > 1.5)
    g.world?.setPusher?.(0, this.position.x, st === 'plunge' || st === 'flurry' ? fin(this.position.y) : 0, this.position.z, r);
    if (st === 'plunge') this._plungeCamera();
    else if (st === 'flurry') this.flurry.camera();
  }

  /** Ask the camera to keep the hero and the head on screen through the plunge (core/cameraRig). */
  _plungeCamera() {
    const rig = this.game.cameraRig, pl = this.pl, p = this.position;
    if (typeof rig?.keep !== 'function') return;
    rig.keep(p.x, p.y + 1.1, p.z, 1.7, true);
    rig.keep(pl.pt.x, pl.pt.y - 0.9, pl.pt.z, 2.2, true);
    if (pl.phase === PL.FLIP) rig.keep(pl.land.x, 0.9, pl.land.z, 1.4, true);
  }

  // ------------------------------------------------------------------ input + lock-on
  _readInput(control, dt) {
    const I = this.intent, inp = this.game.input, L = this.hb, Rb = this.rmb; // (L: the heavy button)
    if (!control || !inp) {
      I.x = I.z = I.len = 0;
      I.sprint = false;
      L.held = false;
      Rb.held = false;
      Rb.edge = false;
      return;
    }
    const m = inp.moveAxis();
    I.x = fin(m?.x);
    I.z = -fin(m?.y); // W = north = −Z
    I.len = Math.hypot(I.x, I.z);
    I.sprint = inp.act('sprint');
    if (inp.actPressed('dodge')) {
      this._buffer('roll');
      // a swipe says where to dodge (input.dodgeToward): it rides with the buffered press, over the stick
      const a = inp.dodgeAim, R = this.rollAim;
      R.set = !!a?.set;
      if (R.set) {
        R.x = fin(a.x);
        R.z = -fin(a.y);
      }
    }
    if (inp.actPressed('flask')) this._buffer('heal');
    if (inp.actPressed('lockOn')) this._toggleLock();

    // attack (LMB / R1 / ATTACK): a press starts a light attack at once. heavy (RMB / R2 / HEAVY): a
    // press starts the chain's heavy branch (combat.js heavyAfter); held past CHARGE.hold it is the
    // charge, the dashing cleave (ADR-115)
    if (inp.actPressed('attack')) this._buffer('light');
    if (inp.actPressed('heavy')) {
      L.held = true;
      L.t = 0;
      // (One Breath, ADR-146: a heavy press that begins with the guard up, or within 0.2 s of lowering it)
      L.guard = Rb.held || this.time - Rb.upT <= 0.2;
      this._buffer('heavy');
    } else if (L.held) {
      L.t += dt;
    }
    if (L.held && (!inp.act('heavy') || L.t >= CHARGE.maxHold)) L.held = false; // released (or auto-release)

    // block (RMB): hold = block; a press counts as a parry attempt only after a full re-arm (anti-mash). A
    // successful deflect re-arms at once (Rb.chain): the next press counts as soon as RMB was released,
    // so a string can be deflected hit after hit even with the guard held between blows; whiffed
    // presses keep the re-arm, so mashing still fails.
    if (inp.actPressed('block')) {
      if (Rb.chain || this.time - Rb.upT >= DEFENSE.parryRearm) Rb.parryT = this.time;
      Rb.chain = false;
      Rb.held = true;
      Rb.edge = true;
    }
    if (Rb.held && !inp.act('block')) {
      Rb.held = false;
      Rb.upT = this.time;
    } else if (!Rb.held && inp.act('block')) {
      Rb.held = true; // held through a pause / menu / respawn: guard again, but no parry attempt
    }
  }

  _buffer(action) {
    this.buf.action = action;
    this.buf.t = this.time;
  }

  _dragonTargetable(d) {
    return !!d && typeof d.isTargetable === 'function' && typeof d.lockPoint === 'function' && !!d.isTargetable();
  }

  _toggleLock() {
    if (this.lockOn) {
      this._setLock(false);
      return;
    }
    const d = this.game.dragon;
    if (!this._dragonTargetable(d)) return;
    d.lockPoint(this._lock);
    const dist = Math.hypot(this._lock.x - this.position.x, this._lock.z - this.position.z);
    if (dist <= TUNE.lockRange) this._setLock(true);
  }

  /** Take the lock on the boss if it can be taken now (in range, targetable); true when locked
   *  (game/flow.js: a touch fight starts locked on, ADR-270). */
  takeLock() {
    if (!this.lockOn) this._toggleLock();
    return this.lockOn;
  }

  _updateLock() {
    if (!this.lockOn) return;
    const d = this.game.dragon;
    if (!this._dragonTargetable(d)) {
      this._setLock(false);
      return;
    }
    d.lockPoint(this._lock);
    const dist = Math.hypot(this._lock.x - this.position.x, this._lock.z - this.position.z);
    if (!(dist <= TUNE.lockBreak)) this._setLock(false);
  }

  _setLock(on) {
    on = !!on;
    if (this.lockOn === on) return;
    this.lockOn = on;
    this._emit('player:lockOn', { on });
  }

  /** Yaw toward the lock target, else the Ghostep target for a moment, else the mouse. */
  _aimYaw(fallback) {
    if (!this.control) return fallback;
    const p = this.position;
    if (this.lockOn) {
      const d = this.game.dragon;
      if (d && typeof d.lockPoint === 'function') {
        d.lockPoint(this._lock);
        const dx = this._lock.x - p.x, dz = this._lock.z - p.z;
        if (Number.isFinite(dx + dz) && dx * dx + dz * dz > 1e-4) return Math.atan2(dx, dz);
      }
    }
    if (this.assist.t > 0) {
      const tg = this.assist.target;
      const tp = typeof tg?.lockPoint === 'function' ? tg.lockPoint(this._lock) : tg?.position;
      if (tp) {
        const dx = tp.x - p.x, dz = tp.z - p.z;
        if (Number.isFinite(dx + dz) && dx * dx + dz * dz > 1e-4 && dx * dx + dz * dz < 144) return Math.atan2(dx, dz);
      }
    }
    const mg = this.game.mouseGround;
    if (mg) {
      const dx = mg.x - p.x, dz = mg.z - p.z;
      if (Number.isFinite(dx + dz) && dx * dx + dz * dz > 0.09) return Math.atan2(dx, dz);
    }
    return fallback;
  }

  /** Can a guard (block / parry) be raised right now? Not mid-roll, drinking or down; a swing is
   *  cancelled by it at once. */
  _canGuard() {
    switch (this.state) {
      case 'idle':
      case 'run':
      case 'sprint':
      case 'block':
      case 'parry':
      case 'charge':
      case 'ghostep':
        return true;
      case 'bounce':
        return true;
      case 'attack':
      case 'heavy':
        // any point of a swing: its windup, the cut itself, the recovery (not the execution's thrust)
        return !this.atk?.exec;
      default:
        return false;
    }
  }

  /** Is the blow's source (attacker body or impact origin) inside the front cone `arc`? */
  _inArc(arc, hasFrom, fx, fz, ap) {
    const p = this.position, half = arc * 0.5;
    let any = false;
    if (ap) {
      any = true;
      if (Math.hypot(ap.x - p.x, ap.z - p.z) < 0.3) return true;
      if (facingDelta(this.yaw, p.x, p.z, ap.x, ap.z) <= half) return true;
    }
    if (hasFrom) {
      any = true;
      if (Math.hypot(fx - p.x, fz - p.z) < 0.3) return true;
      if (facingDelta(this.yaw, p.x, p.z, fx, fz) <= half) return true;
    }
    return !any; // no direction known: give the defender the benefit of the doubt
  }

  // ------------------------------------------------------------------ state machine
  _enter(state, animKey, blend, easeOut = false) {
    this.state = state;
    this.stateT = 0;
    this.onceMask = 0;
    this.enterN++;
    if (state === 'stagger') this.staggerLen = TUNE.staggerDur; // (_guardOpen sets its own after)
    this.anim.play(animKey, blend, easeOut);
  }

  _toLoco(blend = 0.16) {
    this.atk = null;
    this._enter('idle', 'loco', blend);
  }

  /** Drop the current action (hit reactions). */
  _interrupt() {
    this.atk = null;
    this.buf.action = null; // inputs mashed before the hit don't fire after the flinch
    this.chargeK = 0;
    this.blockStunT = 0;
  }

  _once(bit) {
    if (this.onceMask & bit) return false;
    this.onceMask |= bit;
    return true;
  }

  _tick(dt) {
    if (this.guardNudge?.k > 0) this.guardNudge.k = Math.max(0, this.guardNudge.k - dt / CONTACT.guard.nudgeBack); // (CONTACT: _guardOnto)
    switch (this.state) {
      case 'idle':
      case 'run':
      case 'sprint':
        this._tickLoco(dt);
        break;
      case 'block':
        this._tickBlock(dt);
        break;
      case 'parry':
        this._tickParry();
        break;
      case 'charge':
        this._tickCharge(dt);
        break;
      case 'iai':
        this._tickDraw(dt);
        break;
      case 'roll':
        this._tickRoll();
        break;
      case 'attack':
      case 'heavy':
        this._tickAttack(dt);
        break;
      case 'heal':
        this._tickHeal(dt);
        break;
      case 'ghostep':
        this._tickGhostep();
        break;
      case 'lock':
        this._tickLock(dt);
        break;
      case 'mikiri':
        this._tickMikiri();
        break;
      case 'bounce':
        this._tickBounce();
        break;
      case 'plunge':
        this._tickPlunge(dt);
        break;
      case 'flurry':
        this.flurry.tick(dt);
        break;
      case 'stagger':
        this.want.x = this.want.z = 0;
        if (this.stateT >= this.staggerLen) this._toLoco(0.14);
        break;
      case 'guardBreak':
        this.want.x = this.want.z = 0;
        if (this.stateT >= TUNE.guardBreakDur) {
          this.kdProne = false; // the guard was broken from the front: onto his back
          this.kdYaw = this.yaw;
          this._enter('knockdown', 'knockdown', 0.1);
        }
        break;
      case 'knockdown':
        this.want.x = this.want.z = 0;
        this._tickKnockdown(dt);
        break;
      case 'dead':
        this.want.x = this.want.z = 0;
        this._tickDead();
        break;
      default:
        this._toLoco();
    }
  }

  /** Start whatever is buffered (or a held charge), if allowed. Returns true if a new action began.
   *  An attack press near a posture-broken wyrm's head is the plunge execution instead. */
  _tryAction(allowRoll = true, allowAttack = true, allowHeal = true) {
    if (allowAttack && this.hb.held && this.hb.t >= CHARGE.hold) return this._startCharge();
    const a = this.buf.action;
    if (!a) return false;
    if (a === 'roll' && allowRoll) {
      this.buf.action = null;
      return this._startRoll();
    }
    if (a === 'light' && allowAttack) {
      this.buf.action = null;
      if (this._tryExecution()) return true;
      // out of a sprint: the bounding slash; out of a forward roll: the low rising cut
      if (this.state === 'sprint' && Math.hypot(fin(this.groundVel.x), fin(this.groundVel.z)) > TUNE.runSpeed * 1.05) return this._startAttack(SPRINT_ATK);
      if (this.state === 'roll' && !this.rollBack) return this._startAttack(ROLL_ATK);
      return this._startAttack(LIGHT[0]);
    }
    // a heavy on its own (out of a sprint or a roll too): the gap-closing thrust, HEAVY[0]
    if (a === 'heavy' && allowAttack) {
      this.buf.action = null;
      if (this._tryExecution()) return true;
      return this._startAttack(HEAVY[0]);
    }
    if (a === 'heal' && allowHeal) {
      this.buf.action = null;
      return this._startHeal();
    }
    return false;
  }

  _tickLoco(dt) {
    if (this._tryAction()) return;
    if (this.rmb.held) {
      this._startBlock();
      return;
    }
    const I = this.intent;
    const moving = I.len > 0.1;
    const sprint = moving && I.sprint;
    this.state = moving ? (sprint ? 'sprint' : 'run') : 'idle';
    const sp = sprint ? TUNE.sprintSpeed : TUNE.runSpeed;
    this.want.x = I.x * sp;
    this.want.z = I.z * sp;
    const moveYaw = moving ? Math.atan2(I.x, I.z) : this.yaw;
    const target = sprint ? moveYaw : this._aimYaw(moveYaw);
    this.yaw = dampAngle(this.yaw, target, sprint ? 10 : TUNE.turnRate, dt);
  }

  // --- block / parry -------------------------------------------------
  _startBlock(blend = 0.08) {
    this.atk = null;
    this.chargeK = 0;
    if (this.buf.action === 'light' || this.buf.action === 'heavy') this.buf.action = null;
    this._enter('block', 'block', blend);
    return true;
  }

  _tickBlock(dt) {
    if (this.blockStunT > 0) {
      // guard-stagger after a heavy (blue) blow: rooted, the guard stays up
      this.blockStunT -= dt;
      this.want.x = this.want.z = 0;
      return;
    }
    if (!this.rmb.held) {
      this._toLoco(0.12);
      return;
    }
    if (this._tryAction(true, true, true)) return; // attack / roll / drink out of the guard
    const I = this.intent;
    const sp = TUNE.runSpeed * DEFENSE.blockMoveSpeed;
    this.want.x = I.x * sp;
    this.want.z = I.z * sp;
    const moveYaw = I.len > 0.1 ? Math.atan2(I.x, I.z) : this.yaw;
    this.yaw = dampAngle(this.yaw, this._aimYaw(moveYaw), TUNE.blockTurn, dt);
  }

  _tickParry() {
    this.want.x = this.want.z = 0;
    const t = this.stateT;
    if (t >= TUNE.parryCancel && this._tryAction(true, true, false)) return; // riposte
    if (t >= TUNE.parryDur) {
      if (this.rmb.held) this._startBlock(0.12);
      else this._toLoco(0.14);
    }
  }

  /**
   * A parry (deflect). Parries in rhythm (≤ TUNE.deflectChainGap apart: a multi-hit string, Sekiro
   * style) count up the chain: the clash sparks grow, the clang rises in pitch (player:parry `chain`).
   * No lockout: the next tap can parry the next hit at once (the state allows a guard), and the guard
   * lingers between taps (guardHold). `perfect`: pressed within DEFENSE.perfectParryWindow (stored on
   * deflect.perfect for the attacker to read; a light perfect parry is a perfectly parried bullet,
   * which flies back as a shot: a gold burst, 0.05 s stop).
   *
   * The blades MEET (2026-11-14): a blow of steel (`hit.steel`) from an attacker that can say where
   * its blade met the guard (`attacker.parryContact(chest, last)` → the segment a → b and its tip's
   * travel v, drawn space; a duelist poses himself there) is met on that side (raised for a blow from
   * above), posed at once, and the grip nudged until the hero's blade lies on the blow's; the clash
   * is drawn at that crossing. The freeze-frame then shows two crossed blades. Without it (the wyrm's
   * claws, bullets, thrown things) the sides alternate as before.
   */
  _parry(tell, attack, sx, sz, light = false, perfect = false, hit = null) {
    const g = this.game, p = this.position;
    let nx = -Math.sin(this.yaw), nz = -Math.cos(this.yaw); // the pushback: away from the blow
    if (Number.isFinite(sx) && Number.isFinite(sz)) {
      const dx = sx - p.x, dz = sz - p.z;
      const l = Math.hypot(dx, dz);
      if (l > 1e-2) {
        this.yaw = Math.atan2(dx, dz);
        nx = -dx / l;
        nz = -dz / l;
      }
    }
    // ?parryRiposte=deathblow, against a duelist: the parry builds posture, not the dodge streak (deathblow.js)
    const dbFoe = !light && riposteMode() === 'deathblow' && hit?.attacker ? hit.attacker : null;
    const db = !!dbFoe && this.flurry.reach(dbFoe, true) === 'ground';
    const D = this.deflect;
    this.rmb.chain = true; // the next RMB press may parry again without the anti-mash re-arm
    D.n = this.time - D.t <= TUNE.deflectChainGap ? Math.min(99, D.n + 1) : 1;
    D.t = this.time;
    D.side = D.n & 1 ? 1 : -1;
    D.high = 0;
    D.nx = D.ny = D.nz = 0;
    D.perfect = !!perfect;
    this.atk = null;
    this.chargeK = 0;
    this.blockStunT = 0;
    // light: a deflected bullet (hit.light). The same clash, without the weight of a claw behind it
    this._setKb(nx, nz, TUNE.deflectPush * (tell === TELL.BLUE ? 1.6 : 1) * (light ? 0.25 : 1));
    // the blow's steel is met (a duelist's blade: _meetBlade); else the clash sits in front of the guard
    const M = this._meetBlade(!light && hit?.steel ? hit.attacker : null, hit?.last !== false, nx, nz);
    const cv = this._v, e1 = M.e1, e2 = M.e2, spray = M.spray, met = M.met;
    const last = hit?.last !== false; // (a string's non-final blow says `last: false`)
    const big = tell === TELL.BLUE;
    const ret = light && !!perfect; // a bullet sent back (bullets.js reads deflect.perfect)
    // a parry MOMENT (a blue flare blow, ADR-118): the blow is beaten aside in a blue burst and the
    // hero answers by himself (the counter: _tickRiposte), wherever in a string it came
    const moment = !light && !!hit?.flare && tell === TELL.BLUE;
    // a perfect parry of a blow has three looks (combat/perfectFx.js PERFECT_FEEL, the mode read now:
    // today | sharp | cinema); `PM.T` null = today's numbers below. Nothing of the rules moves
    // (a parry moment ends his string: it counts as its last blow for cinema's full beat)
    const PM = perfect && !light ? this.fx.perfectMoment?.('parry', last || moment, fin(this.streak) + 1) : null, PT = PM?.T ?? null;
    this.fx.parry(cv.x, cv.y, cv.z, big, D.n, -nx, -nz, { e1, e2, spray, perfect: !!perfect && !light, light, ring: light ? 0 : perfect || big ? 2 : last ? 1 : 0, met, feel: PM, last: !!last, streak: db ? this.parryRun + (perfect ? 1 : 0) : light ? undefined : fin(this.streak) + 1 });
    if (moment) this.fx.flareParry?.(cv.x, cv.y, cv.z, -nx, -nz);
    if (ret) this.fx.perfectParry?.(cv.x, cv.y, cv.z, -nx, -nz);
    if (light) {
      this._hitstop(ret ? TUNE.returnStop : 0.03);
      g.shake?.(ret ? 0.16 : 0.1);
    } else {
      // a blade met: a freeze-frame on the crossed blades (short inside a string, longer where the
      // exchange turns), a camera kick and punch; perfect: a beat of slow motion on top (the blade
      // lock's own moment replaces it when he locks)
      const S = TUNE.parryStop, Pn = TUNE.parryPunch;
      this._hitstop(perfect ? (PT ? PT.stop : S.perfect) : big ? Math.max(S.blue, last ? S.last : 0) : last ? S.last : D.n > 1 ? S.chain : S.normal, 0.02);
      g.shake?.(Math.min(0.5, (perfect ? (PT ? PT.shake : 0.42) : big ? 0.36 : 0.3) + 0.03 * (D.n - 1)));
      g.punch?.(perfect ? (PT ? PT.punch : Pn.perfect) : last ? Pn.last : big ? Pn.blue : Pn.normal);
      if (perfect) {
        const P = PT ? PT.beat : TUNE.perfectParry;
        g.flow?.cinematic?.({ x: cv.x, z: cv.z, slowmo: P.slowmo, dur: P.dur, zoom: P.zoom, weight: P.weight, ease: P.ease, back: P.back, kind: 'perfectParry' });
      }
    }
    // every parry gives guard back at once (GUARD.parry)
    this._guardGain((light ? GUARD.parryLight : GUARD.parry[tell] ?? GUARD.parry.normal) + (perfect ? GUARD.perfect : 0));
    // a perfect parry of a blow (not a bullet) readies the counter cut (DEFENSE.perfectParry)
    if (perfect && !light) this.quickUntil = this.time + DEFENSE.perfectParry.cutWindow;
    // (deathblow mode: a parried last blow recoils him and opens the counter cut's window, perfect or not)
    if (db && last) this.quickUntil = this.time + DEFENSE.perfectParry.cutWindow;
    if (!light) {
      // a blade met counts in the streak; meeting a string's LAST blow (or a single one) answers
      // with the riposte once this parry's freeze is over (update)
      if (db) {
        if (perfect) this.parryRun = Math.min(99, this.parryRun + 1);
      } else this._streakUp();
      const att = hit?.attacker ?? null, R = this.riposte;
      // (the deathblow: a flare moment is a blue parry, and the combo answers it: no counter cut of its own)
      R.att = !db && (last || moment) && att && hit?.melee === true && !this.debug.noRiposte ? att : null;
      if (db && !this.debug.noRiposte) armDeathblow(this, att, attack, tell, tell === TELL.BLUE);
      R.counter = moment;
      R.t = 0;
      R.attack = attack;
      R.tell = tell;
    }
    // (`feel` / `beat`: the perfect parry's look, PERFECT_FEEL's mode and cinema's 'full' | 'short'; the
    // screen reads them: flow.js). `clash`: the clash dance's run this parry makes on a duelist (his
    // clashPeek, before his onParried counts it; 0: off, or no blade / body of a duelist's: audio.js rings it)
    const clash = !light && typeof hit?.attacker?.clashPeek === 'function' ? hit.attacker.clashPeek() | 0 : 0;
    this._emit('player:parry', { tell, attack, chain: D.n, clash, light, perfect: !!perfect, last, flare: moment, feel: PM?.mode ?? 'today', beat: PM?.beat ?? '' });
  }

  /** The riposte a parried last blow asked for: starts as the parry's freeze ends, if the hero is
   *  still free and the foe in its reach; dropped by a blade lock, a hurt, or half a second. */
  _tickRiposte(dt) {
    const R = this.riposte, g = this.game;
    if (this.db.phase && tickDeathblow(this, dt)) return;
    if (this.parryRun > 0 && !(g.dragon?.posture > 0) && !g.dragon?.broken && this.db.phase !== 'combo') this.parryRun = 0; // his posture is back to empty
    if (!R.att) return;
    R.t += dt > 0 ? fin(g.realDt, dt) : 0;
    if (!this.alive || R.t > 0.5 || !RIPOSTE_FROM.has(this.state)) {
      if (this.state !== 'parry' && this.state !== 'block') R.att = null;
      else if (R.t > 0.5) R.att = null;
      return;
    }
    if (fin(g.hitstopTimer) > 0) return;
    const att = R.att;
    R.att = null;
    const kind = this.flurry.reach(att, true);
    if (!kind) return;
    const T = this.flurry._v, p = this.position;
    const tp = kind === 'air' ? (this._plungePoint(att, T) ? T : null) : att.position;
    if (!tp || !(Math.hypot(tp.x - p.x, tp.z - p.z) <= DEFENSE.flurry.riposteRange[kind])) return;
    // (?parryRiposte=planted: against a duelist he stays where he parried and cuts once: riposteCut.js)
    if (kind === 'ground' && (riposteMode() === 'planted' || riposteMode() === 'deathblow') && startRiposteCut(this, att, this.streak, R.attack, R.counter)) return;
    this.flurry.start(att, kind === 'air', this.streak, R.attack, R.tell, { riposte: true, counter: R.counter });
  }

  /** Guard given back (a parry, a cut of his own that landed). */
  _guardGain(n) {
    if (!(n > 0)) return;
    this.guard = clamp(fin(this.guard) + n, 0, this.maxGuard);
  }

  /**
   * The blow that emptied the guard meter (GUARD): it was blocked, and the guard is knocked open.
   * A short stagger (the guard break's opening pose, without its knockdown), no damage; the meter
   * starts to refill as he recovers. `black`: a charged blow met on the guard or a parry (ADR-118):
   * the whole meter at once, a longer stagger, thrown back (GUARD.black).
   */
  _guardOpen(attack, nx, nz, black = false) {
    const g = this.game;
    if (!(black && this.debug.god)) this.guard = 0;
    this.guardWait = GUARD.openDelay;
    this._bladePoint(0.4, this._v);
    this.fx.guardBreak(this._v.x, this._v.y, this._v.z, nx, nz);
    if (black) this.fx.blackBreak?.(this._v.x, this._v.y, this._v.z, nx, nz);
    this._emit('player:guardOpen', { attack, black });
    g.shake?.(black ? 0.45 : 0.3);
    if (black) this._hitstop(0.1);
    this._interrupt();
    this.recoil = 0;
    if (black) {
      this.atk = null;
      this.chargeK = 0;
      this._setKb(nx, nz, GUARD.black.push);
      if (Number.isFinite(nx + nz) && nx * nx + nz * nz > 1e-4) this.yaw = Math.atan2(-nx, -nz);
    }
    this._enter('stagger', 'guardBreak', 0.07);
    this.staggerLen = black ? GUARD.black.openDur : GUARD.openDur;
    this.anim.kickCoat?.(black ? 0.9 : 0.5);
  }

  /**
   * Lay the hero's blade on the blow's (a parry, a trade clash). `att`: an attacker that can say
   * where its blade met the guard (parryContact; null: none: the wyrm's claws, a bullet). The deflect
   * pose is taken on the blade's side (deflect.side), raised for a blow from above or hung for a low
   * cut (deflect.high), posed at once with no cross-fade (state 'parry': the freeze holds this
   * frame), and the grip nudged (deflect.nx / ny / nz) until the two blades touch. Leaves the clash's
   * point in this._v and returns { met, e1, e2 (the two blades' directions), spray (the turned
   * blade's way) }. (nx, nz) = from the blow toward the hero.
   */
  _meetBlade(att, last, nx, nz) {
    const D = this.deflect, M = this._met ?? (this._met = { met: false, e1: null, e2: null, spray: null });
    M.met = false;
    M.e1 = M.e2 = M.spray = null;
    const C = this._cp, cv = this._v;
    this.getChestPos(cv, true);
    let B = null;
    if (typeof att?.parryContact === 'function') {
      try {
        B = att.parryContact(cv, last);
      } catch (err) {
        console.error('[player] attacker.parryContact failed', err);
      }
    }
    if (B) {
      // the point of his blade nearest the hero's chest (from mid-blade to the tip)
      C[0].set(B.ax + (B.bx - B.ax) * 0.4, B.ay + (B.by - B.ay) * 0.4, B.az + (B.bz - B.az) * 0.4);
      C[1].set(B.bx, B.by, B.bz);
      closestOnSegments(C[0], C[1], cv, cv, C[2], C[3]);
      // (+x of the body is his left: left = (cos yaw, −sin yaw))
      const lat = (C[2].x - cv.x) * Math.cos(this.yaw) - (C[2].z - cv.z) * Math.sin(this.yaw);
      if (Math.abs(lat) > 0.06) D.side = lat < 0 ? 1 : -1;
      // above the chest: the overhead ward (high 0..1); below it: the hanging parry (high −1..0)
      const dy = C[2].y - cv.y;
      D.high = dy >= 0 ? smoothstep(0.12, 0.42, dy) : -smoothstep(0.12, 0.42, -dy);
    }
    this.object3d.rotation.y = this.yaw;
    this._enter('parry', 'parry', 0); // no cross-fade: the contact pose IS this frame (it is frozen)
    this._poseNow();
    // the clash: on the crossing of the two blades; without his blade, in front of the guard toward
    // the blow, on the side the blade snapped to
    if (B && this.sweep.valid) {
      const sw = this.sweep;
      let gap = closestOnSegments(sw.a, sw.b, C[0], C[1], C[2], C[3]);
      D.gap0 = gap;
      if (gap > 0.04) {
        // move the grip by the gap (body axes: x his left, z ahead; model metres) and pose again
        const S = this.drawScale || 1, c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
        const gx = C[3].x - C[2].x, gy = C[3].y - C[2].y, gz = C[3].z - C[2].z;
        D.nx = clamp((gx * c - gz * sn) / S, -0.34, 0.34);
        D.ny = clamp(gy / S, -0.34, 0.34);
        D.nz = clamp((gx * sn + gz * c) / S, -0.3, 0.34);
        this._poseNow();
        gap = closestOnSegments(sw.a, sw.b, C[0], C[1], C[2], C[3]);
      }
      D.gap = gap; // (gap0 → gap: how far apart the blades were before / after the nudge, m)
      // (still apart: his blade is out of the arm's reach; the sparks sit on the hero's steel)
      const w = gap < 0.5 ? 0.5 : 0;
      cv.set(C[2].x + (C[3].x - C[2].x) * w, C[2].y + (C[3].y - C[2].y) * w, C[2].z + (C[3].z - C[2].z) * w);
      M.e1 = C[0].set(sw.b.x - sw.a.x, sw.b.y - sw.a.y, sw.b.z - sw.a.z);
      M.e2 = C[1].set(B.bx - B.ax, B.by - B.ay, B.bz - B.az);
      // the turned blade's way: where its point was going, thrown back off the guard and up
      if (Number.isFinite(B.vx + B.vy + B.vz) && B.vx * B.vx + B.vy * B.vy + B.vz * B.vz > 1e-6) {
        const vl = Math.hypot(B.vx, B.vy, B.vz);
        M.spray = C[2].set(B.vx / vl + nx * 0.6, B.vy / vl + 0.25, B.vz / vl + nz * 0.6);
      }
      M.met = true;
    } else {
      cv.x += -nx * 0.42 + nz * D.side * 0.12;
      cv.z += -nz * 0.42 - nx * D.side * 0.12;
      if (!Number.isFinite(cv.x + cv.y + cv.z)) this._bladePoint(0.62, cv);
    }
    return M;
  }

  /**
   * CONTACT (combat/contact.js, ADR-259; ?contact=a): the blow of `att` (a duelist: strikeContact) is posed
   * where it meets him, on his drawn body, or with `guard` on his drawn blade (and on his body where it
   * would get past the blade). The meeting point goes into `out`; this.struck = the part it met ('guard'
   * on the blade). False (out untouched) when it is off or the attacker cannot say.
   */
  _strikeMet(att, heavy, guard, out) {
    this.struck = null;
    if (!contactOn() || typeof att?.strikeContact !== 'function') return false;
    const B = this._cBody ?? (this._cBody = new ContactBody(THREE));
    this.object3d.updateMatrixWorld(true);
    if (!B.fromRig(this.rig, this.drawScale || 1)) return false;
    const s = this.rig.sword, G0 = (this._cG0 ??= new THREE.Vector3()), G1 = (this._cG1 ??= new THREE.Vector3());
    G0.set(0, 0, DIM.bladeBase).applyMatrix4(s.matrixWorld);
    G1.set(0, 0, DIM.drawnTip).applyMatrix4(s.matrixWorld);
    this._cGuard = !!guard;
    // (made once: the gap of a striker to his body, or to his blade first)
    this._meetFn ??= (a, b, r, o) => {
      const gB = B.gap(a, b, r, o, r <= CONTACT.edge * 1.01 && !this._cGuard ? CONTACT.bite : 0);
      if (!this._cGuard) return gB;
      // (a guard: his blade, or the shell before his body where the blow would get past it)
      const P = this._cP, Q = this._cS;
      const gs = closestOnSegments(a, b, G0, G1, P, Q) - r - CONTACT.edge, gb = gB - CONTACT.guard.shell;
      this._cOnBlade = gs <= gb;
      if (this._cOnBlade) o?.lerpVectors(P, Q, 0.5);
      return Math.min(gs, gb);
    };
    this._cOnBlade = false;
    // (the way his steel or fist was travelling into him: the reaction's line)
    const tv = (this._cutTv ??= { x: 0, z: 0 });
    tv.x = fin(att._tip?.x - att._tipPrev?.x, 0);
    tv.z = fin(att._tip?.z - att._tipPrev?.z, 0);
    let P = null;
    try {
      P = att.strikeContact(this._meetFn, !!heavy, guard ? CONTACT.guard.bite : null);
    } catch (err) {
      console.error('[player] attacker.strikeContact failed', err);
    }
    if (!P) {
      // (a blow that never comes within CONTACT.near of him, the reach band's: not posed, but its hurt is
      // drawn on him where it points, not on his chest)
      const h = att._hilt, t = att._tip;
      if (guard || !att._tipOk || !h || !t) return false;
      const limb = typeof att._part === 'string' && att._part !== 'sword';
      const P2 = (this._cK5 ??= new THREE.Vector3());
      const g = limb ? B.gap(t, t, CONTACT.fist, P2) : B.gap(h, t, CONTACT.edge, P2);
      if (!(g < CONTACT.farFx)) return false;
      out.copy(P2);
      this.struck = B.struck;
      return true;
    }
    out.copy(P);
    this.struck = guard ? 'guard' : B.struck;
    if (guard) this._guardOnto(att, out);
    return true;
  }

  /** CONTACT: his body answers the blow that met it at `pt` (drawn) on `limb` (ContactBody's part), pushed
   *  along (nx, nz), its steel travelling this._cutTv (_strikeMet). Drawn only (HitReact). */
  _reactTo(pt, limb, nx, nz, heavy) {
    const k = impactK('react') * CONTACT.react.hero;
    if (!(k > 0) || !this.alive) return;
    const R = (this._reactHit ??= { k: 0, part: 'body', limb: null, point: null, cut: { x: 0, z: 0 }, dir: { x: 0, z: 0 }, thrust: NaN, heavy: false, crit: false, reel: 0, skid: 0, moved: { x: 0, z: 0 } });
    const tv = this._cutTv ?? null;
    R.k = k;
    R.part = limb === 'head' ? 'head' : limb?.startsWith('leg') ? 'leg' : 'body';
    R.limb = limb;
    R.point = pt;
    R.dir.x = nx;
    R.dir.z = nz;
    const tl = tv ? Math.hypot(tv.x, tv.z) : 0;
    R.cut.x = tl > 1e-4 ? tv.x / tl : nx;
    R.cut.z = tl > 1e-4 ? tv.z / tl : nz;
    R.thrust = NaN;
    R.heavy = !!heavy;
    try {
      this.hitReact.hit(R);
    } catch (err) {
      console.error('[player] the hit reaction failed', err);
    }
  }

  /** CONTACT: a blow that cannot be posed (the wyrm's jaws, claws, tail) but says what struck (`pt`): its hurt
   *  drawn on his body nearest it (within CONTACT.farFx), into `out`; this.struck the part. (sx, sz): where it
   *  came from (the reaction's line). False when off or too far. */
  _pointMet(pt, sx, sz, out) {
    this.struck = null;
    if (!contactOn() || !pt || !Number.isFinite(pt.x + pt.y + pt.z)) return false;
    const B = this._cBody ?? (this._cBody = new ContactBody(THREE));
    this.object3d.updateMatrixWorld(true);
    if (!B.fromRig(this.rig, this.drawScale || 1)) return false;
    const g = B.gap(pt, pt, CONTACT.fist, out);
    if (!(g < CONTACT.farFx)) return false;
    this.struck = B.struck;
    const tv = (this._cutTv ??= { x: 0, z: 0 });
    tv.x = Number.isFinite(sx) ? this.position.x - sx : 0;
    tv.z = Number.isFinite(sz) ? this.position.z - sz : 0;
    return true;
  }

  /** CONTACT, a block: the guard nudged onto the blow (its steel, or the striking fist), posed now, and the
   *  meeting of the two put in `out`. The nudge eases off over CONTACT.guard.nudgeBack s (_tickBlock). */
  _guardOnto(att, out) {
    const N = (this.guardNudge ??= { x: 0, y: 0, z: 0, k: 0 }), K = CONTACT.guard;
    const h = att._hilt, t = att._tip, G0 = this._cG0, G1 = this._cG1, C = this._cp;
    if (!h || !t || !Number.isFinite(h.x + t.x)) return;
    const limb = typeof att._part === 'string' && att._part !== 'sword';
    closestOnSegments(G0, G1, limb ? t : h, t, C[0], C[1]);
    const S = this.drawScale || 1, c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    const gx = C[1].x - C[0].x, gy = C[1].y - C[0].y, gz = C[1].z - C[0].z, gl = Math.hypot(gx, gy, gz);
    // (the blades already crossed: no nudge; else move the grip by the gap, at most K.nudge)
    const k = gl > 0.04 ? Math.min(1, K.nudge / gl) : 0;
    N.x = ((gx * c - gz * sn) / S) * k;
    N.y = (gy / S) * k;
    N.z = ((gx * sn + gz * c) / S) * k;
    N.k = k > 0 ? 1 : 0;
    if (N.k > 0) {
      this._poseNow();
      this.object3d.updateMatrixWorld(true);
      const s = this.rig.sword;
      G0.set(0, 0, DIM.bladeBase).applyMatrix4(s.matrixWorld);
      G1.set(0, 0, DIM.drawnTip).applyMatrix4(s.matrixWorld);
      closestOnSegments(G0, G1, limb ? t : h, t, C[0], C[1]);
    }
    out.lerpVectors(C[0], C[1], 0.5);
  }

  /** Pose the body NOW (outside the frame's own animator step): an impact's contact pose must be on
   *  screen in the frame the freeze holds, and the blade's points read from it. */
  _poseNow() {
    this.hitReact?.restore();
    this.lean.on = false;
    this.anim.update(0); // (no time passes: the cross-fade is none, the elbows are not rate-limited)
    this.lean.on = true;
    this.object3d.updateMatrixWorld(true);
    this.sweep.sample();
  }

  /**
   * The hero's strike met a duelist's guard (the duelist calls it from takeHit). `o.deflect`: he did
   * not just hold it, he threw the blade back (his counter follows): the bounce, which a guard or a
   * dodge cancels at once. A plain guard lets the chain go on (each blow still wears his posture).
   */
  onGuarded(o = {}) {
    if (!this.alive) return;
    const a = this.atk;
    if (a) a.guarded = true;
    if (!o.deflect || this.state === 'plunge' || this.state === 'lock' || a?.exec) return;
    // (`push`: the boss's own throw-back in metres: Bai Wuji's barrier, a short one)
    const push = Number(o.push);
    this._bounce(o.attacker, Number.isFinite(push) && push >= 0 ? clamp(push, 0, 6) : TUNE.bouncePush);
    this._emit('player:bounced', { heavy: !!o.heavy });
  }

  /** The blade is thrown back and he gives `push` m, away from `att`: the bounce (state 'bounce': a
   *  guard or a dodge cancels it at once, an attack after TUNE.bounceAttack). */
  _bounce(att, push) {
    const ap = att?.position, p = this.position;
    let nx = -Math.sin(this.yaw), nz = -Math.cos(this.yaw);
    if (ap && Number.isFinite(ap.x + ap.z)) {
      const dx = p.x - ap.x, dz = p.z - ap.z, l = Math.hypot(dx, dz);
      if (l > 1e-3) {
        nx = dx / l;
        nz = dz / l;
        this.yaw = Math.atan2(-nx, -nz);
      }
    }
    this.atk = null;
    this.chargeK = 0;
    this.releaseK = 0;
    this.hb.held = false;
    if (this.buf.action === 'light' || this.buf.action === 'heavy') this.buf.action = null;
    this._setKb(nx, nz, push);
    this._enter('bounce', 'bounce', 0.04);
    this.anim.kickCoat(0.5, this.anim.noise);
  }

  /** Is the hero's own cut in the air right now (DEFENSE.trade: its active frames, a few
   *  hundredths either side) and not yet landed? A blade's blow that arrives now meets it. */
  _cutting() {
    const a = this.atk;
    if (!this.canTrade() || a.pending) return false;
    if (a.hit && !a.guarded) return false; // it already bit: a plain trade of blows, as before
    const T = DEFENSE.trade, W = a.def.windup;
    return a.t >= W - T.early && a.t <= W + a.def.active + T.late;
  }

  /** Could a swing of the hero's meet a blow right now? He is swinging (not the execution), and the
   *  last trade clash is DEFENSE.trade.rearm s behind him. */
  canTrade() {
    const a = this.atk;
    if (!this.alive || !a || a.exec || !a.def || (this.state !== 'attack' && this.state !== 'heavy')) return false;
    return this.time - this.tradeT >= DEFENSE.trade.rearm;
  }

  /**
   * The trade clash (DEFENSE.trade): the hero's cut and a duelist's blow at the same moment. Neither
   * lands. The attacker is held where his blade met the hero (attacker.parryContact), the hero's cut
   * is stopped on it (_meetBlade: the contact pose of a parry), the clash is drawn on that crossing
   * (white-hot, two rings), the frame freezes, and the hero's blade is thrown back (the bounce). A
   * full cleave (`crush`: its posture reaches the attacker's TUNING.guard.crushPoise) is not thrown
   * back: it beats his blow aside and carries on.
   * Called from takeHit (his blow arrives in the hero's cut) and by the attacker (onTrade: the hero's
   * cut connects just before his blow would land). Emits 'combat:clash'. Returns { heavy, crush }.
   */
  _trade(att, o = {}) {
    const g = this.game, a = this.atk, sw = this.sweep, D = this.deflect;
    const heavy = !!a?.def?.heavy;
    const crush = heavy && fin(a?.poise) >= fin(att?.T?.guard?.crushPoise, Infinity);
    // the flash counter (DEFENSE.counter): his blow arrived as the cut only just became a cut
    const K = DEFENSE.counter;
    // (One Breath's draw counter, ADR-146: anywhere in its short cut, for its own damage and posture, no crit window)
    const drawK = !!a?.def?.drawCounter;
    const counter = (!!o.late || drawK) && !crush && !!a && (drawK || !a.hit) && a.t <= a.def.windup + (drawK ? a.def.active : K.window) && typeof att?.onCounter === 'function';
    if (a) a.traded = true;
    this.tradeT = this.time;
    this._streakUp(); // two cuts met: it counts in the streak
    const C = this._cp, cv = this._v, p = this.position, ap = att?.position;
    let nx = -Math.sin(this.yaw), nz = -Math.cos(this.yaw);
    if (ap && Number.isFinite(ap.x + ap.z)) {
      const dx = p.x - ap.x, dz = p.z - ap.z, l = Math.hypot(dx, dz);
      if (l > 1e-3) {
        nx = dx / l;
        nz = dz / l;
      }
    }
    let e1 = null, e2 = null;
    if (crush || counter) {
      // the cleave (the counter) keeps its line: his blade is held where it is nearest the hero's
      this.getChestPos(cv, true);
      let B = null;
      if (typeof att?.parryContact === 'function') {
        try {
          B = att.parryContact(cv, o.last !== false, sw.valid ? sw : null);
        } catch (err) {
          console.error('[player] attacker.parryContact failed', err);
        }
      }
      if (B && sw.valid) {
        C[0].set(B.ax, B.ay, B.az);
        C[1].set(B.bx, B.by, B.bz);
        D.gap = closestOnSegments(sw.a, sw.b, C[0], C[1], C[2], C[3]);
        cv.set((C[2].x + C[3].x) / 2, (C[2].y + C[3].y) / 2, (C[2].z + C[3].z) / 2);
        e1 = C[0].set(sw.b.x - sw.a.x, sw.b.y - sw.a.y, sw.b.z - sw.a.z);
        e2 = C[1].set(B.bx - B.ax, B.by - B.ay, B.bz - B.az);
      } else if (sw.valid) sw.point(0.7, cv);
    } else {
      // the cut is stopped ON his blade: the deflect's contact pose (as in a parry), which the
      // bounce then throws back. (His blade is low and the hero's cut high as often as not: left
      // in their swing poses the two were 0.7 m apart in the frozen frame.)
      this.yaw = Math.atan2(-nx, -nz);
      D.side = 1;
      D.high = D.nx = D.ny = D.nz = 0;
      const M = this._meetBlade(att, o.last !== false, nx, nz);
      e1 = M.e1;
      e2 = M.e2;
    }
    clashBurst(g, cv.x, Math.max(0.75, cv.y), cv.z, { pal: counter ? CLASH.perfect : CLASH.trade, power: counter ? 2 : heavy ? 1.6 : 1.35, e1, e2, ring: 2 });
    this._hitstop(counter ? K.stop : TUNE.tradeStop * (heavy ? 1.2 : 1), 0.02);
    g.shake?.(counter ? K.shake : heavy ? 0.5 : 0.4);
    g.punch?.(counter ? K.punch : TUNE.tradePunch);
    this._emit('combat:clash', { heavy, crush, counter, x: cv.x, y: cv.y, z: cv.z });
    if (counter) {
      // the cut is not thrown back: it goes through him. The damage is dealt here (final), so the
      // swing itself lands nothing more; he reels and the crit window opens on him
      a.hit = true;
      let dealt = 0;
      // (the flash chain, ?counter=chain: the attacker writes the link it was into `link` / `links`)
      const ko = { point: { x: cv.x, y: Math.max(0.75, cv.y), z: cv.z }, dir: { x: -nx, z: -nz }, attack: o.attack ?? null, ...(drawK ? { damage: a.def.damage, posture: a.def.counterPosture } : null) };
      try {
        dealt = fin(att.onCounter(ko), 0);
      } catch (err) {
        console.error('[player] attacker.onCounter failed', err);
      }
      const link = fin(ko.link, 0) | 0, links = fin(ko.links, 0) | 0, CH = DEFENSE.counterChain;
      if (link > 0 && links > 0) {
        // each link its own weight (the freeze above was the plain counter's: a link only adds to it)
        const i = Math.min(link, CH.stop.length) - 1;
        this._hitstop(CH.stop[i], 0.02);
        g.shake?.(Math.max(0, CH.shake[i] - K.shake));
        g.punch?.(CH.punch[i]);
      }
      // the crit window: the plain counter's, or the chain's last link (before it he strikes back at once)
      const last = !links || link >= links;
      if (!drawK && last) this.critTimer = Math.max(fin(this.critTimer), DEFENSE.ghostep.critWindow);
      this.bladeFlare = Math.max(this.bladeFlare, TUNE.bladeFlare.hit[1]);
      this._emit('player:counter', { attack: o.attack ?? null, damage: dealt, draw: drawK, link, links, last });
    } else if (!crush) this._bounce(att, TUNE.tradePush);
    return { heavy, crush, counter };
  }

  /** The attacker's side of a trade it resolved itself (the hero's cut connected just before its
   *  blow would have landed): the same clash. Returns { heavy, crush } or null (no cut in the air). */
  onTrade(att, o = {}) {
    if (!this.canTrade()) return null;
    return this._trade(att, o);
  }

  _tickBounce() {
    this.want.x = this.want.z = 0;
    const t = this.stateT;
    // (a guard: update() raises it on the press; held, it comes up here)
    if (this.rmb.held) {
      this._startBlock(0.06);
      return;
    }
    if (this._tryAction(true, t >= TUNE.bounceAttack, false)) return;
    if (t >= TUNE.bounceDur) this._toLoco(0.14);
  }

  /**
   * A held guard under a stream the attacker keeps on it (a beam's ticks: kiBeam.js): `cost` from the
   * guard meter and no health, a slide of `push` m along (dx, dz) (unit, away from the source; it only
   * tops the slide up), a short recoil. False (nothing changed) when the cost would empty the meter:
   * the caller then lands the tick as a blow, which the player's own block answers (the guard opens).
   */
  streamBlock(cost, push, dx, dz) {
    cost = Math.max(0, fin(cost));
    if (!this.debug?.god && fin(this.guard) - cost <= 0) return false;
    if (!this.debug?.god) {
      this.guard = Math.max(0, fin(this.guard) - cost);
      this.guardWait = Math.max(fin(this.guardWait), GUARD.regenDelay);
    }
    const kb = this.kb, v = Math.max(0, fin(push)) * TUNE.knockbackDecay, now = fin(kb.x) * fin(dx) + fin(kb.z) * fin(dz);
    if (now < v) {
      kb.x = fin(kb.x) + fin(dx) * (v - now);
      kb.z = fin(kb.z) + fin(dz) * (v - now);
    }
    this.recoil = Math.max(fin(this.recoil), 0.45);
    return true;
  }

  /** `guardCost` (optional, a hit's own: Xin Yi's Iron Rain, ADR-156): what the block costs the meter
   *  instead of GUARD.cost's (a stream of small shots must not empty it: GUARD.costMin is 8 a blow).
   *  `blockPush` (optional, a hit's own: Bai Wuji's weight): the slide in metres instead of
   *  DEFENSE.blockPushback[tell] (0 - 14). A block never costs health either way. */
  _block(dmg, tell, attack, chip, nx, nz, guardCost, blockPush) {
    const g = this.game;
    // a blow costs guard and no HP (GUARD); a contact stream (the breath's ticks, a bullet) is no
    // blow: it keeps its HP chip and leaves the meter alone
    const red = DEFENSE.blockReduction[tell] ?? DEFENSE.blockReduction.normal;
    const taken = chip ? dmg * (1 - clamp(fin(red, 0.8), 0, 1)) : 0;
    let open = false;
    if (chip) this._damage(taken);
    else if (!this.debug.god) {
      const cost = Number.isFinite(guardCost) && guardCost >= 0 ? guardCost : clamp(dmg * (GUARD.cost[tell] ?? GUARD.cost.normal), GUARD.costMin, GUARD.costMax);
      this.guard = Math.max(0, fin(this.guard) - cost);
      this.guardWait = Math.max(this.guardWait, GUARD.regenDelay);
      open = this.guard <= 0;
    }
    const own = Number(blockPush);
    const push = Number.isFinite(own) && own >= 0 && !chip ? clamp(own, 0, 14) : (DEFENSE.blockPushback[tell] ?? DEFENSE.blockPushback.normal) * (chip ? TUNE.chipPush : 1);
    this._setKb(nx, nz, Math.max(fin(this.kb.x * nx + this.kb.z * nz) / TUNE.knockbackDecay, push));
    const heavy = tell === TELL.BLUE && !chip;
    // (CONTACT, ?contact=a: his blow is posed where it meets the guard, the block drawn there)
    if (chip || !this._strikeMet(this._blowBy, heavy, true, this._v)) this._bladePoint(0.45, this._v);
    if (chip) this.chipGuard = TUNE.chipGuard; // standing in a stream: rolling out of it is no perfect dodge
    if (chip) {
      this.recoil = Math.max(this.recoil, 0.35);
      this.fx.blockChip(this._v.x, this._v.y, this._v.z);
    } else {
      this.recoil = heavy ? 1 : 0.7;
      if (heavy) this.blockStunT = TUNE.blockStun;
      this.fx.block(this._v.x, this._v.y, this._v.z, nx, nz, heavy);
      g.shake?.(heavy ? 0.28 : 0.14);
      this._hitstop(heavy ? 0.07 : 0.04);
    }
    // report: every real blow; ticks of one stream are summed and reported at most every
    // blockEventGap (a leftover from an earlier stream is not added to a different blow)
    const E = this.blockEvt;
    const sameStream = chip && E.stream && E.attack === attack;
    if (sameStream && this.time - E.t < TUNE.blockEventGap) {
      E.acc += taken;
    } else {
      this._emit('player:block', { damage: taken + (sameStream ? E.acc : 0), tell });
      E.t = this.time;
      E.attack = attack;
      E.stream = chip;
      E.acc = 0;
    }
    if (this.hp <= 0) this._die();
    else if (open) this._guardOpen(attack, nx, nz);
  }

  _guardBreak(dmg, kind, burn, kb, attack, nx, nz, hasSrc) {
    const g = this.game;
    this.guardWait = Math.max(this.guardWait, GUARD.regenDelay);
    this.hurtN++;
    this._damage(dmg);
    if (burn > 0) this.burnT = Math.max(this.burnT, burn);
    this.flash = 1;
    this._bladePoint(0.4, this._v);
    this.fx.guardBreak(this._v.x, this._v.y, this._v.z, nx, nz);
    this._emit('player:hurt', { damage: dmg, kind, hp: this.hp });
    this._emit('player:guardBreak', { attack });
    g.shake?.(0.45);
    this._hitstop(0.1);
    this._interrupt();
    this._setKb(nx, nz, Math.max(kb, 1.6));
    if (this.hp <= 0) {
      this._die();
      return;
    }
    if (hasSrc) this.yaw = Math.atan2(-nx, -nz);
    this._enter('guardBreak', 'guardBreak', 0.07);
    this.anim.kickCoat(0.8);
  }

  // --- perfect dodge: the plunge / the Ghostep ------------------------------
  /**
   * Perfect dodge reward. The streak counts up, and an attacker the flurry can reach is answered
   * with that many blows (flurry.js: the wyrm's head in the plunge's range when the hit allows it,
   * a foe with a body within the Ghostep's): flash cuts, then an art. The first perfect dodge of a
   * streak is the art alone, and one of the wyrm's arts is the plunge. Out of its reach: the
   * Ghostep, slow-mo + crits where the hero dodged (an attacker that offers no plunge: a blink
   * behind it).
   */
  _perfectDodge(attacker, attack, tell, allowPlunge = true) {
    const n = this._streakUp();
    // (ADR-102) only a red blow is answered with the flurry: a white or heavy one can be parried, so
    // its perfect dodge counts in the streak and gives the slow-mo where he stands (no crit window),
    // and the string goes on
    if (!dodgeOnly(tell) && DEFENSE.flurry.on === 'red' && !this.debug.flurryAny) {
      this._ghostep(attacker, attack, tell, false, DEFENSE.ghostep.critWindowWhite);
      return;
    }
    // (a flare blow dodged in time: a burst in its colour where he stood, as the answer begins)
    this.getChestPos(this._v, true);
    this.fx.flareDodge?.(this._v.x, this._v.y, this._v.z, tell === TELL.BLACK);
    const kind = this.flurry.reach(attacker, allowPlunge);
    if (kind && this.flurry.start(attacker, kind === 'air', n, attack, tell)) return;
    this._ghostep(attacker, attack, tell, !this._plungeable(attacker));
  }

  /** A perfect dodge: the streak counts one more (DEFENSE.flurry). Returns the count. */
  _streakUp() {
    this.streak = Math.min(99, fin(this.streak) + 1);
    this.streakT = 0;
    this._emit('player:streak', { count: this.streak, lost: 0 });
    return this.streak;
  }

  /** The streak is over (he was hurt, he died, it ran out). */
  _streakEnd() {
    const lost = this.streak;
    if (!(lost > 0)) return;
    this.streak = 0;
    this._emit('player:streak', { count: 0, lost });
  }

  /** Ghostep: slow time, open the crit window; with `teleport`, blink behind the attacker (within
   *  TUNE.ghostepMaxRange). */
  _ghostep(attacker, attack, tell, teleport = true, crit = DEFENSE.ghostep.critWindow) {
    const g = this.game, p = this.position;
    // (the Long Second's perfect lean, ADR-158: a longer slow-mo and three afterimages where he leaned)
    const lean = this.rollLean && this.state === 'roll';
    const ox = p.x, oz = p.z;
    // the way he was going (the afterimage of the sharp / cinema looks tears along it when he stays)
    const wx = this.state === 'roll' ? this.rollDir.x : fin(this.vel.x), wz = this.state === 'roll' ? this.rollDir.z : fin(this.vel.z);
    const PM = this.fx.perfectMoment?.('dodge') ?? null; // (combat/perfectFx.js: today | sharp | cinema)
    const nSegs = this._sampleGhost();
    const ap = attacker?.position;
    const hasAtk = !!ap && Number.isFinite(ap.x) && Number.isFinite(ap.z);
    let moved = false;
    if (teleport && hasAtk && Math.hypot(ap.x - ox, ap.z - oz) <= TUNE.ghostepMaxRange) {
      // behind = attacker.position − attacker forward × distance (forward from its yaw, else away from us)
      let fwd = fin(attacker.yaw, NaN);
      if (!Number.isFinite(fwd)) fwd = Math.atan2(ox - ap.x, oz - ap.z);
      // an attacker may ask for its own distance (`ghostepBehind`: a human duelist wants the hero
      // within sword reach of his back; the default suits a giant)
      const D = fin(attacker.ghostepBehind, DEFENSE.ghostep.distanceBehind);
      p.x = ap.x - Math.sin(fwd) * D;
      p.z = ap.z - Math.cos(fwd) * D;
      this._collide();
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) {
        p.x = ox;
        p.z = oz;
      } else moved = true;
    }
    if (hasAtk) {
      const dx = ap.x - p.x, dz = ap.z - p.z;
      if (dx * dx + dz * dz > 1e-4) this.yaw = Math.atan2(dx, dz);
    }
    this.vel.x = this.vel.z = this.kb.x = this.kb.z = 0;
    this.want.x = this.want.z = 0;
    this.groundVel.x = this.groundVel.z = 0;
    this.atk = null;
    this.chargeK = 0;
    this.buf.action = null;
    this.iframeT = TUNE.ghostepIframes;
    this.critTimer = Math.max(fin(this.critTimer), crit);
    this.assist.target = hasAtk ? attacker : null;
    this.assist.t = hasAtk ? TUNE.ghostepAssist : 0;
    this.ghostFx = 1;
    this.object3d.rotation.y = this.yaw;
    this._enter('ghostep', 'ghostep', 0.03);
    if (moved) {
      this.anim.teleported();
      this.sweep.valid = false;
    }
    this.anim.kickCoat(1);
    this.fx.ghostep(this._ghostSegs, nSegs, ox, oz, p.x, p.z, PM?.F ? { feel: PM, wx, wz } : undefined);
    if (lean) this._slowmo(TUNE.lean.slowmo);
    else if (PM?.F) this._slowmo(PM.F.slow?.time ?? PM.F.beat?.dur ?? DEFENSE.ghostep.slowmoTime, PM.mode);
    else this._slowmo(DEFENSE.ghostep.slowmoTime);
    if (lean) for (let i = 1; i < TUNE.lean.ghosts; i++) this.fx.ghostep(this._ghostSegs, nSegs, ox, oz, p.x, p.z);
    g.shake?.(0.15);
    g.world?.setPusher?.(0, p.x, 0, p.z, TUNE.pusher);
    // (`feel`: the look's mode, for the screen: flow.js)
    this._emit('player:perfectDodge', { attack, tell, streak: this.streak, feel: PM?.mode ?? 'today' });
    this._emit('player:ghostep', { x: p.x, z: p.z });
  }

  /** Bone segments (world) of the current pose for the Ghostep afterimage. */
  _sampleGhost() {
    const out = this._ghostSegs;
    let n = 0;
    for (const chain of this.rig.ghostChains) {
      for (let i = 0; i + 1 < chain.length && n < 16; i++) {
        chain[i].getWorldPosition(this._v);
        chain[i + 1].getWorldPosition(this._v2);
        const k = n * 6;
        out[k] = this._v.x;
        out[k + 1] = this._v.y;
        out[k + 2] = this._v.z;
        out[k + 3] = this._v2.x;
        out[k + 4] = this._v2.y;
        out[k + 5] = this._v2.z;
        n++;
      }
    }
    // the blade
    if (n < 16 && this.sweep.valid) {
      const k = n * 6, a = this.sweep.a, b = this.sweep.b;
      out[k] = a.x;
      out[k + 1] = a.y;
      out[k + 2] = a.z;
      out[k + 3] = b.x;
      out[k + 4] = b.y;
      out[k + 5] = b.z;
      n++;
    }
    // the figure the afterimage is drawn as (fx.js _afterimage): his body's own points
    this.fx.body = this._ghostPts;
    this.fx.bodyN = this._sampleBody();
    return n;
  }

  /**
   * Points on the hero's body, in the pose he was last drawn in → this._ghostPts (world). Returns
   * how many. GHOST_PTS vertices spread over his meshes by their size (picked once per rig; read
   * from the geometry each time, so the coat's cloth is where it hangs now). Never throws.
   */
  _sampleBody() {
    const out = this._ghostPts, root = this.object3d;
    let n = 0;
    try {
      const key = this.batch ?? this.rig;
      if (this._ghostSrc?.key !== key) {
        const list = [];
        let sum = 0;
        root.traverse((o) => {
          const g = o.geometry, pos = g?.attributes?.position;
          if (!o.isMesh || !pos || pos.count < 3) return;
          // (not the batches drawn in the sources' place, nor an inside face that doubles an outside)
          if (g.attributes.aRigid || o.material?.name === 'rigidShadowProxy' || o.material?.side === THREE.BackSide) return;
          if (!g.boundingSphere) g.computeBoundingSphere();
          const r = g.boundingSphere?.radius;
          if (!(r > 0) || !Number.isFinite(r)) return;
          list.push({ mesh: o, pos, w: r * r, idx: null });
          sum += r * r;
        });
        for (const s of list) {
          const k = clamp(Math.round((GHOST_PTS * 0.92 * s.w) / Math.max(1e-6, sum)), 1, Math.min(s.pos.count, 48));
          s.idx = new Uint32Array(k);
          for (let j = 0; j < k; j++) s.idx[j] = Math.min(s.pos.count - 1, Math.floor(((j + 0.5) * s.pos.count) / k));
        }
        this._ghostSrc = { key, list };
      }
      for (const s of this._ghostSrc.list) {
        let vis = true;
        for (let o = s.mesh; o && o !== root; o = o.parent) {
          if (o.visible === false) {
            vis = false;
            break;
          }
        }
        if (!vis) continue;
        const e = s.mesh.matrixWorld.elements, a = s.pos.array, st = s.pos.itemSize ?? 3;
        if (!a || s.pos.isInterleavedBufferAttribute) continue;
        for (let j = 0; j < s.idx.length && n < GHOST_PTS; j++) {
          const i = s.idx[j] * st, x = a[i], y = a[i + 1], z = a[i + 2];
          const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
          if (!Number.isFinite(wx + wy + wz)) continue;
          out[n * 3] = wx;
          out[n * 3 + 1] = wy;
          out[n * 3 + 2] = wz;
          n++;
        }
      }
    } catch (err) {
      console.error('[player] _sampleBody failed', err);
      n = 0;
    }
    return n;
  }

  // --- the duel's moments: the blade lock, the mikiri counter (a duelist offers them) ---------------
  /**
   * Blade lock: a duelist whose heavy blow the hero parried perfectly calls this. The blades cross;
   * every press of attack or guard pushes (`L.push`), the attacker pushes back (`L.decay` per s). The
   * meter (from `L.start`) reaching 1 wins, 0 loses; when `L.dur` s run out it wins if at `L.hold` or
   * above. The attacker hears onLockEnd(won).
   * Returns false when the hero can't lock (down, plunging).
   */
  /** A duelist asks before it crosses the blades on a perfect parry: true when the deathblow combo that parry
   *  armed takes it instead (deathblow.js `deathblowClaims`, `?dbLock=`; ADR-280). */
  deathblowClaims(att) {
    return deathblowClaims(this, att);
  }

  startBladeLock(att, L = {}) {
    if (!this.alive || this.state === 'plunge' || this.state === 'dead' || this.state === 'lock' || this.state === 'flurry') return false;
    this.riposte.att = null;
    this._interrupt();
    // (`dist`: the two close to it; a lock at range (a beam's head on the blade) gives its own)
    this.bladeLock = { att, meter: fin(L.start, 0.5), push: fin(L.push, 0.085), decay: fin(L.decay, 0.32), dur: fin(L.dur, 2.6), hold: fin(L.hold, 0.6), dist: Math.max(0.5, fin(L.dist, TUNE.lockDist)), shown: -1 };
    const ap = att?.position, p = this.position;
    if (ap && Number.isFinite(ap.x + ap.z)) this.yaw = Math.atan2(ap.x - p.x, ap.z - p.z);
    this.object3d.rotation.y = this.yaw;
    this.vel.x = this.vel.z = this.kb.x = this.kb.z = 0;
    this.hb.held = false;
    // (the cross-fade runs after the perfect parry's freeze, which holds the contact it was won on)
    const D = this.deflect;
    D.high = D.nx = D.ny = D.nz = 0;
    this.bladeLock.slid = this.bladeLock.meter;
    this.bladeLock.cross = new THREE.Vector3(NaN, NaN, NaN);
    this._enter('lock', 'lock', 0.1);
    this.recoil = 1;
    this._emit('player:lock', { phase: 'start' });
    return true;
  }

  /** The crossing of the locked blades (drawn space), found each frame from the two blades as they
   *  are posed: the hero's grip is moved toward it (deflect.nx / ny / nz: the lock pose reads them),
   *  the sparks of the grind fall from it. */
  _lockCross() {
    const B = this.bladeLock, sw = this.sweep, seg = B?.att?.bladeSegment?.();
    if (!B || !seg || !sw.valid) return null;
    const C = this._cp;
    const gap = closestOnSegments(sw.a, sw.b, seg.a, seg.b, C[2], C[3]);
    if (!Number.isFinite(gap)) return null;
    const S = this.drawScale || 1, c = Math.cos(this.yaw), sn = Math.sin(this.yaw), D = this.deflect, k = TUNE.lockFit;
    const gx = C[3].x - C[2].x, gy = C[3].y - C[2].y, gz = C[3].z - C[2].z;
    D.nx = clamp(D.nx + (k * (gx * c - gz * sn)) / S, -0.3, 0.3);
    D.ny = clamp(D.ny + (k * gy) / S, -0.25, 0.3);
    D.nz = clamp(D.nz + (k * (gx * sn + gz * c)) / S, -0.25, 0.3);
    D.gap = gap;
    const w = gap < 0.5 ? 0.5 : 0;
    return B.cross.set(C[2].x + gx * w, C[2].y + gy * w, C[2].z + gz * w);
  }

  _tickLock(dt) {
    const B = this.bladeLock;
    this.want.x = this.want.z = 0;
    if (!B) {
      this._toLoco(0.12);
      return;
    }
    // a press of any button pushes: a buffered light or heavy (ATTACK / HEAVY) or a guard's edge
    let pushed = false;
    if (this.buf.action === 'light' || this.buf.action === 'heavy') {
      this.buf.action = null;
      pushed = true;
    }
    if (this.rmb.edge) {
      this.rmb.edge = false;
      pushed = true;
    }
    this.hb.held = false; // a held press must not become a charge once the lock is over
    if (pushed) {
      B.meter += B.push;
      this.recoil = 1;
      // a shove: a spit of sparks off the crossing (small: a mashed flare every 0.1 s would white
      // the crossed blades out)
      const x = B.cross;
      if (Number.isFinite(x.x + x.y + x.z)) clashBurst(this.game, x.x, x.y, x.z, { pal: CLASH.parry, power: 0.5, embers: false, light: (B.pushes = (B.pushes ?? 0) + 1) % 3 === 0 });
      this.game.shake?.(0.08);
      this.game.punch?.(0.35);
      this._emit('player:lock', { phase: 'push' });
    }
    B.meter -= B.decay * dt;
    // the pair closes to the lock's distance, then slides with the push: toward him as the hero
    // gains, back onto the hero as he loses
    const ap = B.att?.position, p = this.position;
    if (ap && Number.isFinite(ap.x + ap.z)) {
      const dx = ap.x - p.x, dz = ap.z - p.z, dist = Math.hypot(dx, dz);
      if (dist > 1e-3) {
        const fx = dx / dist, fz = dz / dist;
        this.yaw = Math.atan2(dx, dz);
        const sl = (B.meter - B.slid) * TUNE.lockSlide;
        B.slid = B.meter;
        // (half the closing is the hero's: the attacker steps in the other half, brain.startLock)
        const close = clamp((dist - B.dist) * 0.5, -0.5, 0.5) * Math.min(1, dt * 9);
        p.x += fx * (sl + close);
        p.z += fz * (sl + close);
        this._collide();
        try {
          B.att.moveBy?.(fx * sl, fz * sl);
        } catch (err) {
          console.error('[player] attacker.moveBy failed', err);
        }
      }
    }
    this._lockPrompt(B);
    if (B.meter >= 1) this._endLock(true);
    else if (B.meter <= 0) this._endLock(false);
    else if (this.stateT >= B.dur) this._endLock(B.meter >= B.hold);
  }

  /** The lock's prompt and meter (HUD prompt, ASCII bar): redrawn only when it moves a notch. */
  _lockPrompt(B) {
    const n = Math.round(clamp(B.meter, 0, 1) * 10);
    if (n === B.shown) return;
    B.shown = n;
    const key = this.game.touch?.active ? 'TAP ATTACK' : 'MASH [@attack]';
    this.game.hud?.prompt?.(`${key}  [${'#'.repeat(n)}${'-'.repeat(10 - n)}]`);
  }

  _endLock(won) {
    const B = this.bladeLock;
    this.bladeLock = null;
    this.game.hud?.prompt?.(null);
    this._emit('player:lock', { phase: won ? 'won' : 'lost' });
    const x = B?.cross;
    if (x && Number.isFinite(x.x + x.y + x.z)) {
      // the blades break apart: gold when the hero throws him off, hot orange when he is thrown
      clashBurst(this.game, x.x, x.y, x.z, { pal: won ? CLASH.perfect : CLASH.deflect, power: 1.5, ring: 2, spray: { x: Math.sin(this.yaw) * (won ? 1 : -1), y: 0.4, z: Math.cos(this.yaw) * (won ? 1 : -1) } });
      this.game.punch?.(won ? 3 : 2);
    }
    this.deflect.nx = this.deflect.ny = this.deflect.nz = 0;
    if (won) {
      this.critTimer = DEFENSE.ghostep.critWindow;
      this.iframeT = 0.3;
    }
    this._toLoco(0.1);
    try {
      B?.att?.onLockEnd?.(won);
    } catch (err) {
      console.error('[player] onLockEnd failed', err);
    }
  }

  /** Is the current roll heading INTO the attacker's thrust (TUNE.mikiriToward)? Read against the
   *  way he faces (his blade's line), not his position: a dashing thrust is often already alongside
   *  the hero at the impact, where "toward him" points sideways. */
  _rollToward(att) {
    const ap = att?.position, p = this.position;
    if (!ap) return false;
    if (Number.isFinite(att.yaw)) return -(Math.sin(att.yaw) * this.rollDir.x + Math.cos(att.yaw) * this.rollDir.z) >= TUNE.mikiriToward;
    const dx = ap.x - p.x, dz = ap.z - p.z, l = Math.hypot(dx, dz);
    if (!(l > 1e-3)) return true;
    return (dx * this.rollDir.x + dz * this.rollDir.z) / l >= TUNE.mikiriToward;
  }

  /** Mikiri: rolled into a perilous thrust, the hero steps on the blade: i-frames, the crit window,
   *  a stamping counter pose; the attacker reels (onMikiri). */
  _mikiri(att, attack) {
    const p = this.position, ap = att.position;
    this._streakUp();
    this.atk = null;
    this.chargeK = 0;
    this.buf.action = null;
    this.vel.x = this.vel.z = this.kb.x = this.kb.z = 0;
    if (ap && Number.isFinite(ap.x + ap.z)) this.yaw = Math.atan2(ap.x - p.x, ap.z - p.z);
    this.object3d.rotation.y = this.yaw;
    this.iframeT = TUNE.mikiriDur;
    this.critTimer = DEFENSE.ghostep.critWindow;
    this.deflect.side = -this.deflect.side;
    this.deflect.high = this.deflect.nx = this.deflect.ny = this.deflect.nz = 0;
    this._enter('mikiri', 'parry', 0.03);
    this.anim.kickCoat(1, this.anim.noise);
    this._bladePoint(0.5, this._v);
    this.fx.parry(this._v.x, 0.35, this._v.z, true, 4, Math.sin(this.yaw), Math.cos(this.yaw));
    this.game.shake?.(0.35);
    this._emit('player:mikiri', { attack: typeof attack === 'string' ? attack : 'strike' });
    try {
      att.onMikiri?.({ attack });
    } catch (err) {
      console.error('[player] onMikiri failed', err);
    }
  }

  _tickMikiri() {
    this.want.x = this.want.z = 0;
    if (this.stateT >= TUNE.mikiriCancel && this._tryAction(true, true, false)) return;
    if (this.stateT >= TUNE.mikiriDur) this._toLoco(0.12);
  }

  _tickGhostep() {
    this.want.x = this.want.z = 0;
    const t = this.stateT;
    if (t >= TUNE.ghostepCancel) {
      if (this._tryAction(true, true, false)) return;
      if (this.rmb.held) {
        this._startBlock();
        return;
      }
    }
    if (t >= TUNE.ghostepDur) this._toLoco(0.14);
  }

  // --- the plunge (contract 2; numbers: DEFENSE.plunge) ----------------------
  // VANISH (afterimage at the dodge spot, hidden) → HANG (reappears above the head, coiled, in the
  // slow-mo) → DIVE (accelerating, blade trail) → impact: attacker.onPlunge once, hitstop, burst →
  // RIDE (keeps its offset to the head top while the head is slammed down) → FLIP (backflip arc to a
  // landing in front of the head, toward where he came from) → LAND (crouch, crit window, then free).
  // position.y is the visual lift; x / z stay the ground point under the hero. Hits are ignored and
  // body circles don't push him until LAND.

  /** Does `att` offer the plunge (plungePoint + onPlunge) and stand alive? */
  _plungeable(att) {
    return !!att && typeof att.plungePoint === 'function' && typeof att.onPlunge === 'function' &&
      att.state !== 'dying' && att.state !== 'dead' && att.state !== 'sleeping';
  }

  /** att.plungePoint into `out` (finite), else null. Never throws. */
  _plungePoint(att, out) {
    if (!att || typeof att.plungePoint !== 'function') return null;
    try {
      const r = att.plungePoint(out);
      if (r && Number.isFinite(out.x + out.y + out.z)) return out;
    } catch (err) {
      console.error('[player] plungePoint failed', err);
    }
    return null;
  }

  /** Posture-broken wyrm, attack pressed within DEFENSE.plunge.execRange of its head: execution.
   *  A broken duelist (the Ash Disciple: `onExecute`, no plunge) within its `execRange`: the lunging
   *  execution thrust (_startExecuteThrust). */
  _tryExecution() {
    const d = this.game.dragon;
    if (!d?.broken) return false;
    if (!this._plungeable(d)) return this._startExecuteThrust(d);
    if (!this._startPlunge(d, true)) return false;
    this.hb.held = false; // the press is spent: no charge waiting after the landing
    return true;
  }

  /**
   * The execution against a duelist: a full thrust that lunges to him and, on its first active frame,
   * runs him through: `d.onExecute({ damage })` instead of the sweep test (DEFENSE.plunge.execDamage;
   * the EXECUTION call-out through player:plungeHit {execution}). False when he is out of range.
   */
  _startExecuteThrust(d) {
    if (typeof d?.onExecute !== 'function' || d.state === 'dying' || d.state === 'dead') return false;
    const p = this.position, dp = d.position;
    if (!dp) return false;
    const dist = Math.hypot(dp.x - p.x, dp.z - p.z);
    if (!(dist <= fin(d.execRange, 3.2))) return false;
    this._startHeavy(THRUST, chargeStats(CHARGE.full, THRUST));
    this.yaw = Math.atan2(dp.x - p.x, dp.z - p.z);
    this.object3d.rotation.y = this.yaw;
    this.atk.exec = d;
    this.atk.travel = clamp(dist - 1.0, 0, 3);
    this.hb.held = false;
    this._emit('player:plunge', { execution: true });
    return true;
  }

  /** The execution thrust reaches him (see _startExecuteThrust). */
  _executeHit(a) {
    const d = a.exec;
    a.hit = true;
    let dealt = 0;
    try {
      dealt = fin(d.onExecute({ damage: DEFENSE.plunge.execDamage }), 0);
    } catch (err) {
      console.error('[player] onExecute failed', err);
    }
    // CONTACT (?contact=): the burst where the drawn steel enters him (it runs him through)
    const M = this._plungeEntry(d);
    // the drawn contact (the blade run into his drawn body), else his lock point
    const C = this._contactPoint(d, 'thrust', this._cut) ? this._cut : null;
    if (M && C) {
      C.x = M.x;
      C.y = M.y;
      C.z = M.z;
    }
    const pt = C ?? d.lockPoint?.(this._v) ?? this._v.set(d.position.x, 1.2, d.position.z);
    if (dealt > 0) this._emit('player:hitDragon', { damage: dealt, part: 'body', point: { x: pt.x, y: pt.y, z: pt.z }, heavy: true, crit: true, kind: 'execute', combo: 1, weight: 'execute' });
    this._emit('player:plungeHit', { damage: dealt, execution: true });
    a.hitAt = a.pin?.pin ? a.pin.tc : a.t;
    a.cutDir = this._cutDir(C, a.cutDir);
    this.bladeFlare = Math.max(this.bladeFlare, TUNE.bladeFlare.hit[1]);
    const X = THRUST.exec;
    this._hitstop(X.hitstop);
    this.game.shake?.(X.shake);
    this.game.punch?.(X.punch);
    if (C) this.game.kick?.(C.cx, C.cy, C.cz, X.kick);
    else this.game.kick?.(Math.sin(this.yaw), 0, Math.cos(this.yaw), X.kick);
    this.fx.contact(pt, 'execute', C, true, 1);
    if (C) this._edgeFlash(C, true, true, true);
  }

  /** The contact's mark on the steel (fx.edgeFlash) at contact C's height along the blade (a contact
   *  out in the arc, past the drawn steel, flashes at the point). */
  _edgeFlash(C, heavy, crit, ridge = false) {
    if (!this.rig.loadout?.weapon) return;
    const z = clamp(DIM.bladeBase + C.f * (DIM.bladeTip + REACH.tipExt - DIM.bladeBase), DIM.forte, DIM.drawnTip - 0.02);
    // the frames the freeze holds, in fx time (main.js: this frame at the full rate, the freeze at
    // fxLive, whole frames: one more of margin): the mark is gone as the blade swings on
    const g = this.game, rd = fin(g.realDt, 1 / 60), k = fin(g.timeScale, 1) * fin(g.debugTimeScale, 1);
    const hold = (rd + (Math.max(0, fin(g.hitstopTimer, 0)) + rd) * fin(CONFIG.render?.fxLive, 0.6)) * k;
    this.fx.edgeFlash(this.sweep, z, heavy, crit, ridge, hold);
  }

  /**
   * Start the plunge on `att` (false: out of range / no head point). `exec` = the posture-break
   * execution (starts at the hang, no slow-mo, no perfect-dodge events). `chain` (the flurry, whose
   * flash cuts led into it): { ox, oz } = where the hero dodged (the side he lands on); he is already
   * gone from there, and the perfect dodge has been announced.
   */
  _startPlunge(att, exec, attack = null, tell = TELL.NORMAL, anyRange = false, chain = null) {
    const g = this.game, p = this.position, P = DEFENSE.plunge, pl = this.pl;
    if (!this._plungePoint(att, pl.pt)) return false;
    const ox = chain ? fin(chain.ox, p.x) : p.x, oz = chain ? fin(chain.oz, p.z) : p.z;
    if (!anyRange && !(Math.hypot(pl.pt.x - ox, pl.pt.z - oz) <= (exec ? P.execRange : P.range))) return false;
    const nSegs = chain ? 0 : this._sampleGhost(); // the afterimage left at the dodge spot
    pl.att = att;
    pl.exec = !!exec;
    pl.ox = ox;
    pl.oz = oz;
    pl.hit = false;
    pl.dealt = 0;
    pl.fxT = 0;
    this._plungeDir(att, pl);
    pl.phase = exec ? PL.HANG : PL.VANISH;
    pl.t = 0;
    this._plungeHang(pl, 0, p);
    this.yaw = Math.atan2(-pl.dx, -pl.dz); // facing the head, his back to the landing side
    this.object3d.rotation.y = this.yaw;
    this.vel.x = this.vel.z = this.kb.x = this.kb.z = 0;
    this.want.x = this.want.z = 0;
    this.groundVel.x = this.groundVel.z = 0;
    this.atk = null;
    this.chargeK = 0;
    this.blockStunT = 0;
    this.buf.action = null;
    this.critTimer = 0; // reopened on landing
    this.iframeT = 0;
    this.assist.target = null;
    this.assist.t = 0;
    this.ghostFx = 1;
    this._enter('plunge', 'plunge', 0.02);
    this.anim.teleported();
    this.sweep.valid = false;
    this.anim.kickCoat(1, this.anim.noise);
    if (chain) this.flurry.fx.appear(p.x, p.y + 1, p.z, 0, 0, 0, 1, true);
    else this.fx.plungeBlink(this._ghostSegs, nSegs, ox, oz, p.x, p.y, p.z);
    g.world?.setPusher?.(0, p.x, p.y, p.z, TUNE.pusher);
    if (!exec) {
      this._slowmo(DEFENSE.ghostep.slowmoTime);
      g.shake?.(0.15);
      if (!chain) {
        this._emit('player:perfectDodge', { attack, tell, streak: this.streak });
        this._emit('player:ghostep', { x: p.x, z: p.z });
      }
    }
    this._plungeAnimSync();
    return true;
  }

  /**
   * The spring-off direction (unit, ground plane): from the head toward where the hero came from.
   * One who came from behind the head (over the body) springs off in front of it on his side.
   */
  _plungeDir(att, pl) {
    const pt = pl.pt, ay = fin(att?.yaw, NaN);
    const fx = Number.isFinite(ay) ? Math.sin(ay) : 0, fz = Number.isFinite(ay) ? Math.cos(ay) : 1;
    let vx = pl.ox - pt.x, vz = pl.oz - pt.z;
    const l = Math.hypot(vx, vz);
    if (l > 0.3) {
      vx /= l;
      vz /= l;
    } else {
      vx = fx; // right under the head: off along its nose
      vz = fz;
    }
    if (vx * fx + vz * fz < -0.3) {
      const side = fx * vz - fz * vx > 0 ? -1 : 1; // which side of the nose he came from
      const a = Math.atan2(fx, fz) + side * PLUNGE_BEHIND_TURN;
      vx = Math.sin(a);
      vz = Math.cos(a);
    }
    pl.dx = vx;
    pl.dz = vz;
  }

  /** The hang point above the head at hang progress u (a short rise that settles: the apex). */
  _plungeHang(pl, u, out) {
    const P = DEFENSE.plunge, rise = 0.32 * (1 - (1 - u) * (1 - u));
    return out.set(pl.pt.x + pl.dx * P.appearBack, pl.pt.y + P.appearUp + rise, pl.pt.z + pl.dz * P.appearBack);
  }

  /** Where he lands on the head: just on his side of the head top. */
  _plungeSeat(pl, out) {
    const P = DEFENSE.plunge;
    return out.set(pl.pt.x + pl.dx * P.rideBack, pl.pt.y - 0.05, pl.pt.z + pl.dz * P.rideBack);
  }

  /** Next plunge phase; the animator re-enters the clip with a short cross-fade (anim.js). */
  _plungePhase(n) {
    this.pl.phase = n;
    this.pl.t = 0;
    this._plungeAnimSync();
    this.anim.play('plunge', PL_BLEND[n] ?? 0.05);
  }

  _tickPlunge(dt) {
    const P = DEFENSE.plunge, pl = this.pl, p = this.position;
    this.want.x = this.want.z = 0;
    pl.t += dt;
    // the head this frame (the wyrm's pose of the last frame); gone (killed and removed, a reset
    // that drops the API): spring off from where he is
    const head = this._plungePoint(pl.att, pl.pt);
    if (!head && pl.phase < PL.FLIP) {
      if (pl.phase === PL.DIVE) this._plungeImpact(); // he still lands his blow
      this._plungeFlip();
    }
    switch (pl.phase) {
      case PL.VANISH:
      case PL.HANG: {
        // the apex holds still: it drifts after a moving head at PLUNGE_HANG_TRACK m/s at most (a
        // spinning tail sweep swung the head, and him with it, round in a wide arc)
        const hang = pl.phase === PL.HANG;
        this._plungeHang(pl, hang ? clamp(pl.t / P.hang, 0, 1) : 0, this._v);
        const d = this._v.distanceTo(p), max = PLUNGE_HANG_TRACK * dt;
        if (d > max && d > 1e-6) p.lerp(this._v, max / d);
        else p.copy(this._v);
        if (!hang && pl.t >= P.vanish) {
          this._plungePhase(PL.HANG);
          this.ghostFx = 1; // resolves out of the cold dissolve over the hang
        } else if (hang && pl.t >= P.hang) {
          pl.from.copy(p); // the dive starts where he hangs and pursues the head
          this._plungePhase(PL.DIVE);
          this.anim.kickCoat(0.6, this.anim.noise);
          this._emit('player:plunge', { execution: pl.exec });
        }
        break;
      }
      case PL.DIVE: {
        const u = clamp(pl.t / P.dive, 0, 1);
        this._plungeSeat(pl, this._v2);
        p.lerpVectors(pl.from, this._v2, u * u); // accelerating onto the head
        if (u >= 1) this._plungeImpact();
        break;
      }
      case PL.RIDE: {
        // riding the head down: keep the offset to its top (eased through a jump of the head)
        this._v.copy(pl.pt).add(pl.off);
        const d = this._v.distanceTo(p), max = PLUNGE_RIDE_MAX * dt;
        if (d > max && d > 1e-6) p.lerp(this._v, max / d);
        else p.copy(this._v);
        if (pl.t >= P.ride) this._plungeFlip();
        break;
      }
      case PL.FLIP: {
        const u = clamp(pl.t / pl.flipDur, 0, 1), f = pl.from, L = pl.land;
        p.x = f.x + (L.x - f.x) * u;
        p.z = f.z + (L.z - f.z) * u;
        p.y = Math.max(0, f.y * (1 - u) + P.flipUp * 4 * u * (1 - u));
        if (u >= 1) this._plungeLand();
        break;
      }
      case PL.LAND:
      default:
        // the landing crouch: free to act after landCancel (attack, roll, guard), then loco
        if (pl.t >= P.landCancel) {
          if (this._tryAction(true, true, false)) return;
          if (this.rmb.held) {
            this._startBlock(0.12);
            return;
          }
          if (pl.t >= P.land * 0.6 && this.intent.len > 0.1) {
            this._toLoco(0.16);
            return;
          }
        }
        if (pl.t >= P.land) this._toLoco(0.16);
    }
    if (!Number.isFinite(p.x + p.y + p.z)) {
      p.set(fin(pl.ox, CONFIG.world.playerSpawn.x), 0, fin(pl.oz, CONFIG.world.playerSpawn.z));
      this._plungeLand();
    }
    this._plungeAnimSync();
  }

  /** The blade meets the head: onPlunge once, the hitstop, the burst, then ride it. */
  _plungeImpact() {
    const P = DEFENSE.plunge, pl = this.pl, g = this.game, p = this.position;
    if (pl.hit) return;
    pl.hit = true;
    this._plungeSeat(pl, p);
    pl.off.subVectors(p, pl.pt);
    const exec = pl.exec;
    const damage = exec ? P.execDamage : P.damage;
    const hp = pl.hitPt;
    hp.x = pl.pt.x;
    hp.y = pl.pt.y - 0.25;
    hp.z = pl.pt.z;
    let dealt = damage;
    if (this._plungeable(pl.att)) {
      try {
        const r = pl.att.onPlunge({ damage, posture: P.posture, point: hp, execution: exec });
        if (Number.isFinite(r)) dealt = r;
      } catch (err) {
        console.error('[player] onPlunge failed', err);
      }
    } else dealt = 0;
    pl.dealt = dealt;
    this._plungePhase(PL.RIDE);
    this._hitstop(P.impactStop, 0.03);
    g.shake?.(exec ? P.execShake : P.impactShake);
    g.world?.gust?.(hp.x, hp.z, 1.4, 8);
    this.anim.kickCoat(0.9, this.anim.noise);
    // (CONTACT: the burst where the drawn steel enters the head, not at the gameplay point under it)
    const E = this._plungeEntry(pl.att);
    this.fx.plungeImpact(E ? E.x : hp.x, E ? E.y : hp.y, E ? E.z : hp.z, pl.dx, pl.dz, exec);
    if (dealt > 0) this._emit('player:hitDragon', { damage: dealt, part: 'head', point: { x: hp.x, y: hp.y, z: hp.z }, heavy: true, crit: exec, kind: 'plunge' });
    this._emit('player:plungeHit', { damage: dealt, execution: exec });
    this.flurry.burst(dealt, hp); // the cuts a flurry left hanging open on this blow
  }

  /** CONTACT: where the hero's drawn steel enters a body it runs into (the plunge's head, the execution's foe), or null (off). */
  _plungeEntry(att) {
    if (!contactOn() || !att || !this.rig.loadout?.weapon) return null;
    const B = this._cFoe ?? (this._cFoe = new ContactBody(THREE, 48));
    if (!(att.rig?.pelvis && typeof att.drawnPoint === 'function' ? B.fromRig(att.rig, fin(att.drawScale, 1)) : B.fromSpheres(att.hurtSpheres))) return null;
    this.object3d.updateMatrixWorld(true);
    const s = this.rig.sword, A0 = (this._cK0 ??= new THREE.Vector3()), A1 = (this._cK1 ??= new THREE.Vector3()), P = (this._cK2 ??= new THREE.Vector3());
    A0.set(0, 0, DIM.bladeBase).applyMatrix4(s.matrixWorld);
    A1.set(0, 0, DIM.drawnTip).applyMatrix4(s.matrixWorld);
    // (the entry: walk the steel from the hilt to the first point inside the body)
    for (let i = 0; i <= 12; i++) {
      P.lerpVectors(A0, A1, i / 12);
      if (B.gap(P, P, 0) <= 0) return P;
    }
    return null;
  }

  /** Rip the blade out and spring off: a backflip arc to a clear landing in front of the head. */
  _plungeFlip(rMin = undefined) {
    const P = DEFENSE.plunge, pl = this.pl, p = this.position;
    if (!Number.isFinite(p.y) || p.y < 0) p.y = 0;
    pl.from.copy(p);
    this._plungeLanding(pl, pl.land, rMin);
    pl.flipDur = clamp(P.flip[0] + 0.035 * Math.max(0, p.y - 2), P.flip[0], P.flip[1]);
    // facing the head (his takeoff point) from the landing: the flip carries him backward
    const fx = p.x - pl.land.x, fz = p.z - pl.land.z;
    if (fx * fx + fz * fz > 0.04) this.yaw = Math.atan2(fx, fz);
    this._plungePhase(PL.FLIP);
    this.anim.kickCoat(0.8, this.anim.noise);
    if (pl.hit) this.fx.plungeRip(pl.hitPt.x, pl.hitPt.y, pl.hitPt.z, pl.dx, pl.dz);
  }

  /** A clear landing in front of the head along the spring-off direction (turned off the body if
   *  it is in the way), clamped to the arena and resolved against the stones. `rMin`: the nearest
   *  to the head it may be (the flurry's drop-off lands beyond where he hangs). */
  _plungeLanding(pl, out, rMin = DEFENSE.plunge.landMin) {
    const P = DEFENSE.plunge, g = this.game, pt = pl.pt;
    const circles = pl.att?.bodyCircles ?? g.dragon?.bodyCircles;
    const B = CONFIG.world.playerBound;
    const base = Math.atan2(pl.dx, pl.dz);
    for (const da of LAND_TURNS) {
      const a = base + da, sx = Math.sin(a), sz = Math.cos(a);
      for (let r = clamp(fin(rMin, P.landMin), P.landMin, P.landMax); r <= P.landMax + 1e-6; r += 0.75) {
        const x = pt.x + sx * r, z = pt.z + sz * r;
        if (Math.hypot(x, z) > (g.world?.heroBound?.(x, z) ?? B) - 1) break; // farther only leaves the arena (or the ground the wall has opened: world.heroBound)
        if (this._inBody(circles, x, z, this.radius + P.landClear)) continue;
        out.set(x, 0, z);
        g.world?.resolve?.(out, this.radius, B, false, 'hero');
        if (!Number.isFinite(out.x + out.z)) continue;
        if (Math.hypot(out.x - x, out.z - z) > 1.5 || this._inBody(circles, out.x, out.z, this.radius + 0.2)) continue;
        pl.dx = sx;
        pl.dz = sz;
        return out;
      }
    }
    // cornered: come down where he is (resolve pushes him clear of stones and the arena edge)
    out.set(fin(pl.from.x, pl.ox), 0, fin(pl.from.z, pl.oz));
    g.world?.resolve?.(out, this.radius, B, false, 'hero');
    if (!Number.isFinite(out.x + out.z)) out.set(pl.ox, 0, pl.oz);
    return out;
  }

  _inBody(circles, x, z, r) {
    if (!Array.isArray(circles)) return false;
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      if (!c || !(c.r > 0) || !Number.isFinite(c.x + c.z)) continue;
      const m = c.r + r;
      if ((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) < m * m) return true;
    }
    return false;
  }

  /** Touchdown: the crouch, a short slide, the crit window, a moment of i-frames. */
  _plungeLand() {
    const P = DEFENSE.plunge, pl = this.pl, g = this.game, p = this.position;
    p.set(fin(pl.land.x, p.x), 0, fin(pl.land.z, p.z));
    this._collide();
    if (!Number.isFinite(p.x + p.z)) p.set(pl.ox, 0, pl.oz);
    p.y = 0;
    const tx = pl.pt.x - p.x, tz = pl.pt.z - p.z;
    if (Number.isFinite(tx + tz) && tx * tx + tz * tz > 0.04) this.yaw = Math.atan2(tx, tz);
    this.critTimer = DEFENSE.ghostep.critWindow;
    this.iframeT = P.landIframes;
    const tgt = this._plungeable(pl.att) ? pl.att : null;
    this.assist.target = tgt;
    this.assist.t = tgt ? TUNE.ghostepAssist : 0;
    this.vel.x = this.vel.z = 0; // the flip's momentum goes into the crouch and a short slide
    this._setKb(pl.dx, pl.dz, 0.55);
    this._plungePhase(PL.LAND);
    this.fx.plungeLand(p.x, p.z, pl.dx, pl.dz);
    this._groundMark(p.x, p.z, 'slam', SCAR.mark.hero.plunge, NaN);
    g.shake?.(0.22);
    g.world?.gust?.(p.x, p.z, 0.8, 4);
    {
      // (the living world's steps answer the landing: world/life/steps.js)
      const surface = g.world?.life?.steps?.footfall?.(p.x, p.z, { heavy: true, sprint: true, side: 0, vx: pl.dx, vz: pl.dz });
      this._emit('player:footstep', surface ? { x: p.x, z: p.z, sprint: true, surface } : { x: p.x, z: p.z, sprint: true });
    }
    this.anim.kickCoat(0.7, this.anim.noise);
  }

  /** What the animator reads (anim.js plunge block). */
  _plungeAnimSync() {
    const pl = this.pl, A = this.plungeAnim, P = DEFENSE.plunge;
    A.phase = pl.phase;
    A.t = pl.t;
    A.exec = pl.exec;
    A.h = this.position.y;
    const dur = pl.phase === PL.VANISH ? P.vanish : pl.phase === PL.HANG ? P.hang : pl.phase === PL.DIVE ? P.dive
      : pl.phase === PL.RIDE ? P.ride : pl.phase === PL.FLIP ? pl.flipDur : P.land;
    A.u = clamp(pl.t / Math.max(1e-3, dur), 0, 1);
  }

  /** Lab / captures: plunge onto the dragon now, from anywhere (even onto a flying wyrm). */
  _debugPlunge(execution = false) {
    const d = this.game.dragon;
    if (!this.alive || !this._plungeable(d) || this.state === 'plunge' || this.state === 'flurry') return false;
    return this._startPlunge(d, !!execution, 'debug', TELL.RED, true);
  }

  /** Lab / tests: the streak of perfect dodges, set by hand. */
  _debugStreak(n) {
    n = clamp(Math.round(fin(Number(n), 0)), 0, 99);
    if (n === this.streak) return n;
    const lost = n ? 0 : this.streak;
    this.streak = n;
    this.streakT = 0;
    this._emit('player:streak', { count: n, lost });
    return n;
  }

  /** Lab / captures: a flurry of `strikes` blows on the boss now, as a perfect dodge at this streak
   *  would start it (`art`: flurry.js ARTS, for this one only). False when it cannot reach it. */
  _debugFlurry(strikes = 3, art = null) {
    const d = this.game.dragon;
    if (!this.alive || this.state === 'plunge' || this.state === 'flurry' || this.state === 'lock') return false;
    const kind = this.flurry.reach(d, true);
    if (!kind) return false;
    // (a streak past the cap of blows: the flurry strikes DEFENSE.flurry.max, the tiers read the rest)
    const n = clamp(Math.round(fin(Number(strikes), 3)), 1, 99);
    this._debugStreak(n);
    const pin = this.debug.flurryArt;
    if (typeof art === 'string') this.debug.flurryArt = art;
    let ok = false;
    try {
      ok = this.flurry.start(d, kind === 'air', n, 'debug', TELL.RED);
    } finally {
      this.debug.flurryArt = pin;
    }
    return ok;
  }

  // --- roll --------------------------------------------------------------
  /** The numbers of the roll under way: the roll, the backstep, or the Long Second's lean. */
  _rollTune() {
    return this.rollLean ? TUNE.lean : this.rollBack ? TUNE.backstep : TUNE.roll;
  }

  _startRoll() {
    const A = this.rollAim;
    const I = A.set ? { x: A.x, z: A.z, len: 1 } : this.intent;
    A.set = false;
    const back = I.len <= 0.1;
    // THE LONG SECOND (ADR-158): from a held guard, no direction: the lean in place
    const lean = back && (this.state === 'block' || this.rmb.held) && !!this.game.unlocks?.has?.('longSecond');
    this.rollLean = lean;
    if (back) {
      this.rollDir.x = -Math.sin(this.yaw);
      this.rollDir.z = -Math.cos(this.yaw);
    } else {
      this.rollDir.x = I.x / I.len;
      this.rollDir.z = I.z / I.len;
      this.yaw = Math.atan2(I.x, I.z); // roll toward the input
    }
    this.rollBack = back;
    // its first frame carries on only what was already moving him its way (_tickRoll sets `want` from
    // the next frame on: the frame before's drove this one, and out of a swing that was the swing's
    // step along the old facing, 15-30 cm in one frame, forward even for a backstep). A run into a
    // roll the same way, or a roll from standing, is unchanged
    const along = Math.max(0, this.want.x * this.rollDir.x + this.want.z * this.rollDir.z);
    this.want.x = this.rollDir.x * along;
    this.want.z = this.rollDir.z * along;
    this.atk = null;
    this.chargeK = 0;
    this._enter('roll', lean ? 'lean' : back ? 'backstep' : 'roll', 0.05);
    if (!back) this.anim.kickCoat(TUNE.rollCoatKick);
    this._emit('player:roll', { backstep: back, lean });
    if (!lean) this.fx.dust(this.position.x, this.position.z, back ? 5 : 9, back ? 0.7 : 1);
    return true;
  }

  _tickRoll() {
    const R = this._rollTune();
    const t = this.stateT;
    const u = clamp(t / R.dur, 0, 1);
    // fast out of the gate, settling at the end; integrates to exactly R.dist
    const v = (R.dist / R.dur) * (0.6 + 0.8 * (1 - u));
    this.want.x = this.rollDir.x * v;
    this.want.z = this.rollDir.z * v;
    if (t >= R.landAt && this._once(1) && !this.rollBack) {
      // the living world's steps answer the roll's landing like a heavy step (world/life/steps.js); with
      // the piece off (or no living world) it is today's dust exactly
      const o = (this._rollStepO ??= { heavy: true, sprint: true, side: 0, vx: 0, vz: 0 });
      o.vx = this.rollDir.x;
      o.vz = this.rollDir.z;
      if (!this.game.world?.life?.steps?.footfall?.(this.position.x, this.position.z, o)) this.fx.dust(this.position.x, this.position.z, 7, 0.8);
    }
    if (t >= R.attackAfter && this._tryAction(t >= R.rollAfter, true, false)) return;
    if (t >= R.moveAfter && (this.intent.len > 0.1 || this.rmb.held)) {
      if (this.rmb.held) this._startBlock(0.1);
      else this._toLoco(0.12);
      return;
    }
    if (t >= R.dur) this._toLoco(0.12);
  }

  // --- attacks -----------------------------------------------------------
  _startAttack(def) {
    if (!def) return false;
    const light = def.kind === 'light';
    // the counter cut: the first light after a perfect parry winds up faster and crits
    const quick = light && this.time <= fin(this.quickUntil, -Infinity);
    this.quickUntil = -Infinity;
    this.atk = {
      def, t: 0, hit: false, prevT: 0, gust: false, impact: false, flared: false, lunge: null, travel: fin(def.travel, 0),
      quick, crit: quick,
      // hitAt: the attack clock at the contact (-1 none); cutDir: the blade's unit travel there ({x, y, z},
      // world) or null; glintZ: how far up the edge the glint has run (fx.edgeGlint)
      hitAt: -1, cutDir: null, glintZ: null,
      // a heavy press still held: it may become the charge (the swing waits at the coil). A light
      // never waits (ADR-115: the charge moved to the heavy button)
      pending: def.button === 'heavy' && this.hb.held,
      damage: fin(def.damage, 30), poise: fin(def.poise, 12), charge: 0, relT: 0, shaped: false, svx: 0, svz: 0,
    };
    this.chargeK = 0;
    if (!def.keepYaw) this.yaw = this._aimYaw(this.yaw); // commit the swing direction
    // the cross-fade IS the windup: the body eases into the coil pose
    this._enter('attack', 'attack', (def.windup * 0.85) / this._attackSpeed(), true);
    if (!this.atk.pending) this._swingStarted(def, 0);
    return true;
  }

  /** A swing really starts (a held light only once it is released): announce it, glint the gem. */
  _swingStarted(def, charge) {
    this._emit('player:attack', { kind: def.kind, combo: def.combo, charge, name: def.name ?? null });
    if (def.kind !== 'light') this.anim.kickCoat(def.dash ? 0.5 + 0.5 * charge : 0.45);
    this.rig.gem.getWorldPosition(this._gem);
    const gv = this.gemVel;
    this.fx.gemGlint(this._gem.x, this._gem.y, this._gem.z, def.kind === 'light' ? 0.6 : 1, gv.x, gv.z, gv.y);
  }

  _startCharge() {
    // (One Breath, once learned: a press begun from the guard takes the draw stance instead; locked, as before)
    if (this.hb.guard && this.game.unlocks?.has?.('oneBreath')) return this._startDraw();
    this.atk = null;
    if (this.buf.action === 'light' || this.buf.action === 'heavy') this.buf.action = null;
    this.chargeK = chargeStats(this.hb.t).k;
    this.chargeFull = false;
    this._enter('charge', 'charge', 0.16);
    this._emit('player:charge', { t: Math.max(0.25, CHARGE.full - this.hb.t) });
    return true;
  }

  _tickCharge(dt) {
    const L = this.hb;
    if (!this.control) {
      this._toLoco(0.14); // pause / cutscene mid-charge: drop it rather than fire it
      return;
    }
    const st = chargeStats(L.t);
    this.chargeK = st.k;
    if (st.k >= 1 && !this.chargeFull) {
      this.chargeFull = true;
      this._bladePoint(0.95, this._v);
      this.fx.chargeReady(this._v.x, this._v.y, this._v.z, this.position.x, this.position.z);
    }
    if (!L.held) {
      this._releaseCharge(L.t);
      return;
    }
    if (this.buf.action === 'roll') {
      this.buf.action = null;
      this._startRoll();
      return;
    }
    const I = this.intent;
    const sp = TUNE.runSpeed * CHARGE.move;
    this.want.x = I.x * sp;
    this.want.z = I.z * sp;
    const moveYaw = I.len > 0.1 ? Math.atan2(I.x, I.z) : this.yaw;
    this.yaw = dampAngle(this.yaw, this._aimYaw(moveYaw), TUNE.turnRate, dt);
  }

  /** One Breath's stance (ADR-146): the iai's coil at the right hip (the flurry's 'coil' pose); he cannot
   *  move or guard in it, a roll takes him out of it, releasing HEAVY cuts. */
  _startDraw() {
    this.atk = null;
    if (this.buf.action === 'light' || this.buf.action === 'heavy') this.buf.action = null;
    this.chargeK = 0;
    this.drawT = 0;
    const F = this.flurryAnim;
    if (F) {
      F.pose = 'coil';
      F.k = 0;
      F.u = 0;
      F.air = false;
    }
    this._enter('iai', 'flurry', 0.14);
    this._emit('player:draw', { phase: 'stance' });
    return true;
  }

  _tickDraw(dt) {
    const L = this.hb, F = this.flurryAnim;
    this.drawT = fin(this.drawT) + dt;
    if (F) {
      F.pose = 'coil';
      F.k = clamp(this.drawT / 0.3, 0, 1);
    }
    this.want.x = this.want.z = 0;
    this.yaw = dampAngle(this.yaw, this._aimYaw(this.yaw), TUNE.turnRate, dt);
    if (!this.control) {
      this._toLoco(0.14);
      return;
    }
    if (this.buf.action === 'roll') {
      this.buf.action = null;
      this._startRoll();
      return;
    }
    if (!L.held) {
      // the cut: a blink step along his aim, drawn as one line
      const D = ONE_BREATH;
      this._startHeavy(D, { k: 1, damage: D.damage, poise: D.poise, travel: D.travel });
      this.getChestPos(this._v, true);
      this.flurry?.fx?.pass?.(this._v.x + Math.sin(this.yaw) * D.travel * 0.5, this._v.y, this._v.z + Math.cos(this.yaw) * D.travel * 0.5, Math.sin(this.yaw), Math.cos(this.yaw));
      this._emit('player:draw', { phase: 'cut' });
    }
  }

  /** Release the charge: the dashing cleave, whose travel, damage and posture grow with the charge. */
  _releaseCharge(holdT) {
    this._startHeavy(CLEAVE, chargeStats(holdT, CLEAVE));
  }

  /** Start a dashing heavy (`def.dash`: the cleave, the execution's thrust) with `st` = chargeStats. */
  _startHeavy(def, st) {
    this.atk = {
      def, t: 0, hit: false, prevT: 0, gust: false, impact: false, flared: false, pending: false,
      lunge: 0, travel: st.travel, damage: st.damage, poise: st.poise, charge: st.k, relT: 0,
      hitAt: -1, cutDir: null, glintZ: null, // (as _startAttack)
    };
    this.releaseK = st.k;
    this.chargeK = 0;
    this.yaw = this._aimYaw(this.yaw);
    this._enter('heavy', 'attack', def.windup * 0.9, true);
    this._swingStarted(def, st.k);
  }

  /**
   * Step-in assist (REACH.assist): the lunge that carries a swing of `def.reach` into the nearest
   * hurt surface ahead — within `range` m and `arc` rad of the facing, at heights the reach band can
   * touch — never shorter than def.lunge nor longer than def.lunge + max.
   */
  _lungeFor(def) {
    const base = Math.max(0, fin(def.lunge, 0));
    const dr = this.game.dragon, A = REACH.assist;
    if (!this._dragonTargetable(dr) || !Array.isArray(dr.hurtSpheres)) return base;
    const p = this.position, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const top = 1.3 + REACH.up; // a swing at hero height plus the band
    let gap = Infinity;
    for (const h of dr.hurtSpheres) {
      if (!h || !(h.r > 0) || !Number.isFinite(h.x + h.y + h.z)) continue;
      const dy = h.y > top ? h.y - top : 0;
      if (dy >= h.r) continue;
      const rr = Math.sqrt(h.r * h.r - dy * dy); // horizontal radius at the band's top
      const dx = h.x - p.x, dz = h.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (!(dist > 1e-3)) continue;
      const off = Math.acos(clamp((dx * fx + dz * fz) / dist, -1, 1)) - Math.asin(clamp(rr / dist, 0, 1));
      if (off > A.arc) continue;
      gap = Math.min(gap, dist - rr);
    }
    if (!(gap < A.range)) return base;
    return clamp(gap - fin(def.reach, 2) + 0.4, base, base + A.max);
  }

  /** The Lab's attack-speed multiplier (debug.attackSpeed), 1 in play. */
  _attackSpeed() {
    const a = this.atk;
    const quick = a?.quick && a.def && a.t < a.def.windup ? DEFENSE.perfectParry.cutSpeed : 1;
    return clamp(fin(this.debug.attackSpeed, 1) * quick, 0.25, 4);
  }

  _tickAttack(dt) {
    const a = this.atk;
    if (!a) {
      this._toLoco();
      return;
    }
    const d = a.def;
    const W = d.windup, A = d.active, R = d.recovery;
    const sp = this._attackSpeed();
    dt *= sp; // the attack's own clock (the root's speeds below are scaled back, so distances hold)
    if (a.pending) {
      if (!this.hb.held) {
        a.pending = false; // tap: the swing goes ahead
        a.relT = a.t; // its step starts here (the root's step in; a late release compresses it)
        this._swingStarted(d, 0);
      } else if (this.hb.t >= CHARGE.hold) {
        this._startCharge();
        return;
      }
    }
    // a dodge cancels a swing at any point (TUNE.rollCancel's note): the windup, the cut, the recovery
    if (this.buf.action === 'roll' && !a.exec) {
      this.buf.action = null;
      if (this._startRoll()) return;
    }
    // the blade stopped on a piece it could not cut through (_bladeStops, BREAK.chip.stop): it is held
    // where it met it while the frame is frozen and for the time it sticks in the cut, then thrown back
    if (a.wstop) {
      this.want.x = this.want.z = 0;
      a.stuck -= dt;
      if (a.stuck > 0 || fin(this.game.hitstopTimer) > 0) return;
      const at = (this._stopAt ??= { position: { x: 0, z: 0 } });
      at.position.x = a.wstop.x;
      at.position.z = a.wstop.z;
      this._bounce(at, a.wpush);
      return;
    }
    a.t = a.pending ? Math.min(W, a.t + dt) : a.t + dt; // a held light waits at the coil
    const t = a.t;
    if (a.pin?.pin) a.show = pinStep(a.pin, t, dt); // (CONTACT: the swing shown held where it met him, _cutContact)
    else a.show = 0;
    if (t < W && !d.keepYaw) this.yaw = turnToward(this.yaw, this._aimYaw(this.yaw), TUNE.windupSteer * dt);
    // lunge forward through the strike (stretched by the step-in assist); a dashing heavy's root
    // travel (the cleave, the execution's thrust) is front-loaded through its active frames
    let lv = 0, shaped = false;
    if (d.dash) {
      if (t >= W && t <= W + A) lv = (a.travel / A) * (1.5 - (t - W) / A);
    } else if (a.travel > 0) {
      // a travelling light (the sprint slash): the run's momentum carries on through the windup and
      // the cut, dying out (integrates to a.travel)
      const T = W + A;
      if (!a.pending && t <= T) lv = (a.travel / T) * (1.4 - (0.8 * t) / T);
    } else {
      // (the exact share of the step this frame. Nothing while the button is still held: it may
      // become a charge; a late release starts the step there and compresses it)
      shaped = true;
      const LS = TUNE.lungeShape, l0 = Math.max(W - LS.pre, fin(a.relT, 0)), l1 = Math.max(W + A * LS.end, l0 + LS.min);
      if (!a.pending && t > l0 && t - dt < l1 && dt > 1e-6) {
        if (a.lunge === null) a.lunge = this._lungeFor(d);
        lv = (a.lunge * (smoothstep(l0, l1, t) - smoothstep(l0, l1, t - dt))) / dt;
      }
    }
    this.want.x = Math.sin(this.yaw) * lv * sp;
    this.want.z = Math.cos(this.yaw) * lv * sp;
    a.shaped = shaped; // (_integrate lands the root's velocity on this step's shape)

    if (t >= W + A) {
      const r = (t - W - A) / R;
      const b = this.buf.action;
      // (the next hit waits for the cut to carry through: `chain` of the recovery, combat.js)
      if (b === 'light' && r >= fin(d.chain, 0)) {
        this.buf.action = null;
        if (this._tryExecution()) return;
        const next = d.kind === 'light' ? LIGHT[d.combo % LIGHT.length] : LIGHT[0];
        if (this._startAttack(next)) return;
      } else if (b === 'heavy' && r >= fin(d.chain, 0)) {
        // the heavy branch: after the n-th light its own heavy (combat.js HEAVY); it ends the chain
        this.buf.action = null;
        if (this._tryExecution()) return;
        if (this._startAttack(heavyAfter(d))) return;
      } else if (b === 'heal' && r >= TUNE.rollCancel) {
        this.buf.action = null;
        if (this._startHeal()) return;
      }
      if (this.hb.held && this.hb.t >= CHARGE.hold) {
        this._startCharge();
        return;
      }
      if (r >= TUNE.moveCancel && (this.intent.len > 0.1 || this.rmb.held)) {
        if (this.rmb.held) this._startBlock(0.12);
        else this._toLoco(0.14);
        return;
      }
    }
    if (t >= W + A + R) {
      if (this.rmb.held) this._startBlock(0.14);
      else this._toLoco(0.16);
    }
  }

  // --- flask -------------------------------------------------------------
  _startHeal() {
    if (this.flasks <= 0 && !this.debug.infiniteFlasks) {
      this._emit('player:noFlask');
      return false;
    }
    if (!this.debug.infiniteFlasks) this.flasks--;
    this.healApplied = false;
    this.atk = null;
    this.chargeK = 0;
    this._enter('heal', 'heal', 0.12);
    return true;
  }

  _tickHeal(dt) {
    const I = this.intent, t = this.stateT, H = TUNE.heal;
    this.want.x = I.x * TUNE.healSpeed;
    this.want.z = I.z * TUNE.healSpeed;
    this.yaw = dampAngle(this.yaw, this._aimYaw(I.len > 0.1 ? Math.atan2(I.x, I.z) : this.yaw), 6, dt);
    if (!this.healApplied && t >= H.at) {
      this.healApplied = true;
      const before = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + H.amount);
      this._emit('player:heal', { amount: this.hp - before, flasks: this.flasks });
      const p = this.position;
      this.fx.healBurst(p.x, p.z);
      this.healLight?.kill?.();
      this.healLight = this.game.lights?.add?.({ x: p.x, y: 1.3, z: p.z, color: [0.6, 1.0, 0.35], intensity: 2.2, radius: 4.5, life: 0.9, fade: 0.6, fadeIn: 0.05 }) ?? null;
    }
    if (t >= H.dur) this._toLoco(0.15);
  }

  // --- down / dead -------------------------------------------------------
  _tickKnockdown(dt) {
    const t = this.stateT, p = this.position;
    // he turns square to the blow as he falls (at most a quarter turn, over ~0.15 s)
    if (t < 0.3 && dt > 0) this.yaw = turnToward(this.yaw, this.kdYaw, TUNE.knockdownTurn * dt);
    if (t >= 0.3 && this._once(1)) {
      // the body lands ~half a meter behind the feet (on his front: ahead of them)
      const s = this.kdProne ? 0.6 : -0.6;
      this.fx.dust(p.x + Math.sin(this.yaw) * s, p.z + Math.cos(this.yaw) * s, 12, 1.2);
      this.game.shake?.(0.15);
    }
    if (t >= TUNE.knockdownDur) this._toLoco(0.12);
  }

  _tickDead() {
    if (this.deadDown) return; // he died where he lay: no knee to drop, no body to land
    const t = this.stateT, p = this.position;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    if (t >= 0.5 && this._once(1)) this.fx.dust(p.x, p.z, 5, 0.6);
    if (t >= 1.38 && this._once(2)) {
      this.fx.dust(p.x + fx * 0.6, p.z + fz * 0.6, 14, 1.3);
      this.game.shake?.(0.12);
    }
  }

  _die() {
    if (this.state === 'dead') return;
    this.hp = 0;
    this.atk = null;
    this.buf.action = null;
    this.burnT = 0;
    this.burnAcc = 0;
    this.chargeK = 0;
    this.critTimer = 0;
    this.iframeT = 0;
    this.slowmoPending = 0;
    this.blockStunT = 0;
    this._streakEnd();
    this.parryRun = 0;
    this._setLock(false);
    // killed on the ground (falling or lying in the knockdown): he dies where he lies
    const down = this.state === 'knockdown' && this.stateT < TUNE.knockdownDur - TUNE.getUpIframes + 0.1;
    this.deadDown = down;
    this.downFrom = down ? this.stateT : 0;
    this._enter('dead', down ? 'deadDown' : 'dead', down ? 0.22 : this._midMove() ? 0.14 : 0.1);
    this.want.x = this.want.z = 0;
    if (!this.diedEmitted) {
      this.diedEmitted = true;
      this._emit('player:died');
    }
  }

  /** Lose HP unless the Lab's god mode is on (the hit still reacts and reports). */
  _damage(amount) {
    if (this.debug.god) return;
    this.hp = Math.max(0, this.hp - Math.max(0, fin(amount)));
  }

  _setKb(nx, nz, dist) {
    const v = Math.max(0, fin(dist)) * TUNE.knockbackDecay; // exp decay → total slide = dist
    this.kb.x = fin(nx) * v;
    this.kb.z = fin(nz) * v;
  }

  /**
   * HELD (a boss's hold: Bai Wuji's domain): a stagger of `sec` s (at most TUNE.holdMax) that nothing
   * cancels, no slide. Never on a hero who is down or dead, nor in a move of his own out of reach
   * (plunge, flurry, lock, the Ghostep, the mikiri). True if he is held.
   */
  hold(sec) {
    if (!this.alive || ['knockdown', 'dead', 'plunge', 'flurry', 'lock', 'ghostep', 'mikiri'].includes(this.state)) return false;
    const s = clamp(fin(Number(sec), 0), 0, TUNE.holdMax);
    if (!(s > 0)) return false;
    this._interrupt();
    this.kb.x = this.kb.z = 0;
    this.vel.x = this.vel.z = 0;
    this.want.x = this.want.z = 0;
    this.crash.on = false;
    this._enter('stagger', 'stagger', 0.06);
    this.staggerLen = s;
    return true;
  }

  /** A plain hit's throw: through the world if it carries `wjCrash` (power > 0), else no crash. */
  _crashArm(hit, attacker, kb) {
    const C = this.crash, pw = Number(hit.wjCrash);
    C.on = Number.isFinite(pw) && pw > 0 && kb > 0;
    if (!C.on) return;
    C.power = pw;
    C.damage = Math.max(0, fin(Number(hit.wjCrashDamage), 0));
    C.t = 0;
    C.n = 0;
    C.hits.length = 0;
    C.by = attacker;
  }

  /**
   * The throw through the world (TUNE.crash): each breakable piece the sliding hero meets takes one
   * world.impact of the throw's power at the contact (it breaks behind him, or holds and stops him: the
   * collision after this pushes him out as always), the slide slows, and he takes `damage` more (never
   * the last of his health). Off when the slide is slow, after TUNE.crash.max s, out of a stagger /
   * knockdown, or after TUNE.crash.pieces pieces.
   */
  _crashStep(dt) {
    const C = this.crash, K = TUNE.crash, p = this.position;
    C.t += dt;
    const sp = Math.hypot(this.kb.x, this.kb.z);
    if (!(sp >= K.minSpeed) || C.t > K.max || C.n >= K.pieces || (this.state !== 'stagger' && this.state !== 'knockdown')) {
      C.on = false;
      return;
    }
    const W = this.game.world, D = W?.destructibles;
    if (!D?.around || typeof W.impact !== 'function') return;
    const near = this._crashNear, r = this.radius;
    const n = D.around(p.x, p.z, r + K.reach, near, 8);
    const ux = this.kb.x / sp, uz = this.kb.z / sp;
    for (let i = 0; i < n; i++) {
      const b = near[i];
      if (C.hits.includes(b) || (b.y0 > 0 && b.y0 > 1.4)) continue;
      // (only a piece AHEAD of him along the throw: not one he slides away from)
      if ((b.x - p.x) * ux + (b.z - p.z) * uz < -0.2) continue;
      C.hits.push(b);
      C.n++;
      const cx = p.x + ux * r, cz = p.z + uz * r;
      const o = (this._crashO ??= { kind: 'blunt', by: 'boss', dx: 0, dz: 0, y: 0.9, src: -1 });
      o.dx = ux;
      o.dz = uz;
      o.src = D.swing?.() ?? -1;
      try {
        W.impact(cx, cz, 0.7, C.power, o);
      } catch (err) {
        console.error('[player] crash impact', err);
      }
      this.kb.x *= K.keep;
      this.kb.z *= K.keep;
      if (C.damage > 0 && this.hp > 1 && !this.debug.god) {
        const d = Math.min(C.damage, this.hp - 1);
        this._damage(d);
        this._emit('player:hurt', { damage: d, kind: 'crash', hp: this.hp });
      }
      this.game.shake?.(0.25);
      C.by?.fx?.crash?.(cx, cz, ux, uz, C.power);
      if (C.n >= K.pieces) break;
    }
  }

  /** Short freeze-frame, skipped while a longer slow-mo (Ghostep) runs so it can't turn into a freeze. */
  _hitstop(sec, scale = 0.04) {
    const g = this.game;
    if (fin(g.hitstopTimer) > sec && fin(g.hitstopScale, 1) > scale) return;
    g.hitstop?.(sec, scale);
  }

  /**
   * Ghostep slow-mo. game.hitstop keeps the harsher scale for the longer timer, so starting it during
   * a freeze already running (the leap slam freezes on landing, then strikes) would turn the whole
   * slow-mo into a freeze: wait for that freeze to end instead (update() fires the pending one).
   */
  _slowmo(sec, mode) {
    const g = this.game;
    // the perfect dodge's look (combat/perfectFx.js PERFECT_FEEL[mode].dodge; a pending one keeps
    // its mode): `slow` a hitstop slow motion of its own scale, `beat` the flow's cinematic moment
    // (its own time scale and the camera in: no long hitstop to merge with the next cut's freeze)
    const m = mode ?? (this._slowmoMode && sec === this.slowmoPending ? this._slowmoMode : null);
    this._slowmoMode = null;
    const D = m ? this.fx.perfectMoment?.('dodge', true, 0, m)?.F ?? null : null;
    if (D?.beat) {
      this.slowmoPending = 0;
      const B = D.beat, p = this.position;
      if (g.flow?.cinematic?.({ x: p.x, z: p.z, slowmo: B.slowmo, dur: B.dur, zoom: B.zoom, weight: B.weight, ease: B.ease, back: B.back, kind: 'ghostep', quiet: true })) return;
    }
    const scale = D?.slow ? D.slow.scale : DEFENSE.ghostep.slowmoScale;
    if (fin(g.hitstopTimer) > 0 && fin(g.hitstopScale, 1) < scale) {
      this.slowmoPending = sec;
      if (D) this._slowmoMode = m;
      return;
    }
    this.slowmoPending = 0;
    g.hitstop?.(sec, scale);
  }

  // ------------------------------------------------------------------ movement
  _integrate(dt) {
    if (dt <= 0) return;
    const v = this.vel, w = this.want;
    if ((this.state === 'plunge' && this.pl.phase < PL.LAND) || this.state === 'flurry') {
      // in the air / on the head / cutting through his foe: the move's own tick placed him (no body
      // push-out, no ground clamp)
      v.x = v.z = this.kb.x = this.kb.z = 0;
      this.groundVel.x = this.groundVel.z = 0;
      return;
    }
    let lambda;
    switch (this.state) {
      case 'roll':
        v.x = w.x;
        v.z = w.z;
        lambda = 0;
        break;
      case 'attack':
      case 'heavy': {
        lambda = TUNE.attackDamp;
        const a = this.atk;
        if (a?.shaped) {
          // a light's shaped step (`want`): through the filter alone it ran ~2 frames late (74 % of it
          // by the plant, still 0.8-1.4 m/s past the cut). The velocity lands ON the step's shape each
          // frame, and only what it carries beyond the shape it had last frame (atk.svx / svz: a run's
          // momentum into the swing) dies out through the filter. (`want` stays the step's own speed:
          // a roll out of the swing starts from it)
          const k = 1 - Math.exp(-lambda * dt);
          v.x = w.x + (v.x - fin(a.svx, 0)) * (1 - k);
          v.z = w.z + (v.z - fin(a.svz, 0)) * (1 - k);
          a.svx = w.x;
          a.svz = w.z;
          lambda = 0;
        }
        break;
      }
      case 'stagger':
      case 'knockdown':
      case 'guardBreak':
      case 'parry':
      case 'bounce':
      case 'ghostep':
      case 'plunge':
      case 'dead':
        lambda = 10;
        break;
      case 'heal':
        lambda = 12;
        break;
      default:
        lambda = w.x * w.x + w.z * w.z > v.x * v.x + v.z * v.z ? TUNE.accel : TUNE.decel;
    }
    if (lambda) {
      v.x = damp(v.x, w.x, lambda, dt);
      v.z = damp(v.z, w.z, lambda, dt);
    }
    const kd = Math.exp(-TUNE.knockbackDecay * dt);
    this.kb.x *= kd;
    this.kb.z *= kd;

    const p = this.position;
    const ox = p.x, oz = p.z;
    p.x += (v.x + this.kb.x) * dt;
    p.z += (v.z + this.kb.z) * dt;
    if (this.crash.on) this._crashStep(dt);
    this._collide();
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) {
      p.x = fin(ox, CONFIG.world.playerSpawn.x);
      p.z = fin(oz, CONFIG.world.playerSpawn.z);
      v.x = v.z = this.kb.x = this.kb.z = 0;
    }
    p.y = 0;
    this.groundVel.x = damp(this.groundVel.x, (p.x - ox) / dt, 20, dt);
    this.groundVel.z = damp(this.groundVel.z, (p.z - oz) / dt, 20, dt);
    if (!Number.isFinite(this.groundVel.x + this.groundVel.z)) this.groundVel.x = this.groundVel.z = 0;
  }

  _collide() {
    const p = this.position, r = this.radius;
    const circles = this.game.dragon?.bodyCircles;
    if (Array.isArray(circles)) {
      for (let i = 0; i < circles.length; i++) {
        const c = circles[i];
        if (!c || !(c.r > 0) || !Number.isFinite(c.x + c.z)) continue;
        const dx = p.x - c.x, dz = p.z - c.z;
        const min = r + c.r;
        const d2 = dx * dx + dz * dz;
        if (!(d2 < min * min)) continue;
        const d = Math.sqrt(d2);
        if (d > 1e-4) {
          p.x = c.x + (dx / d) * min;
          p.z = c.z + (dz / d) * min;
        } else {
          p.x = c.x - Math.sin(this.yaw) * min;
          p.z = c.z - Math.cos(this.yaw) * min;
        }
      }
    }
    this.game.world?.resolve?.(p, r, CONFIG.world.playerBound, false, 'hero');
  }

  // ------------------------------------------------------------------ burn status
  _updateBurn(dt) {
    // takeHit ignores damage on the title / after victory; burn must not finish the hero off there
    const st = this.game.state;
    if (this.burnT > 0 && (st === 'victory' || st === 'title')) this._clearBurn();
    if (this.burnT > 0 && this.alive) {
      this.burnAcc += TUNE.burnDps * Math.min(dt, this.burnT);
      this.burnT -= dt;
      const tick = TUNE.burnDps * TUNE.burnTick;
      while (this.burnAcc >= tick && this.alive) {
        this.burnAcc -= tick;
        this._damage(tick);
        this._emit('player:hurt', { damage: tick, kind: 'burn', hp: this.hp });
        if (this.hp <= 0) this._die();
      }
      if (this.burnT <= 0) {
        this.burnT = 0;
        this.burnAcc = 0;
      }
    }
    const k = this.burnT > 0 ? clamp(this.burnT / 1.5, 0.35, 1) : 0;
    this.fx.flames(dt, k);
    const p = this.position;
    if (k > 0) {
      if (!this.burnLight || this.burnLight.dead) {
        this.burnLight = this.game.lights?.add?.({ x: p.x, y: 1, z: p.z, color: [1, 0.45, 0.12], intensity: 1.4, radius: 3.5, flicker: 0.5, fade: 0.3, fadeIn: 0.1 }) ?? null;
      }
      this.burnLight?.set?.(p.x, 1.0, p.z);
    } else if (this.burnLight) {
      this.burnLight.kill?.();
      this.burnLight = null;
    }
  }

  _clearBurn() {
    this.burnT = 0;
    this.burnAcc = 0;
    if (this.burnLight) {
      this.burnLight.kill?.();
      this.burnLight = null;
    }
  }

  // ------------------------------------------------------------------ sword hits
  /** Point `f` (0 hilt … 1 tip) along the blade, world space (falls back to the chest). */
  _bladePoint(f, out) {
    if (this.sweep.valid) return this.sweep.point(f, out);
    return this.getChestPos(out, true);
  }

  _combat() {
    const sw = this.sweep;
    if (!sw.sample()) return;
    this.slashFx?.update(); // (the straight line where the blade passed: slashFx.js)
    const a = this.atk;
    if (a && !a.pending && (this.state === 'attack' || this.state === 'heavy')) {
      const d = a.def, t = a.t;
      const W = d.windup, end = W + d.active;
      const prevT = a.prevT;
      a.prevT = t;
      const crit = this.critTimer > 0 || !!a.crit;
      const armed = !!this.rig.loadout?.weapon;
      // any overlap of this frame with the active window counts (robust to long frames)
      if (t >= W && prevT <= end + 0.04) {
        // the hit first: a cut that lands this frame draws its contact, not the arc's glint
        if (!a.hit && prevT <= end) this._tryHit(a);
        // the blade meets the world too (ADR-107): what it sweeps through is chipped, cut down, felled
        if (prevT <= end) this._cutWorld(a, sw, prevT);
        // (the arc bites as a cut lands: white-hot for 0.06 s of the attack clock after the contact)
        // (the instant slash draws one straight line instead of the crescent: slashFx.js; ?slash=arc the crescent)
        if (!this.slashFx?.owns(a)) this.fx.trail(sw.pa, sw.pb, sw.a, sw.b, d.kind, crit, true, a.hit && a.hitAt >= 0 && a.t - a.hitAt < 0.06);
        // a glint on the arc's edge as the cut comes through (the cleave cuts late in its dash). The
        // edge runs just past the steel's point (fx.arcAt), not at the end of the reach. A landed
        // cut's core is the beat's one star: a whiff keeps the glint
        if (!a.hit && !a.glint && d.kind !== 'thrust' && t >= W + d.active * (d.kind === 'cleave' ? 0.82 : 0.6)) {
          a.glint = true;
          const f = this.fx.arcAt(d.kind);
          this._tip.lerpVectors(sw.a, sw.b, f);
          this._tipPrev.lerpVectors(sw.pa, sw.pb, f);
          this.fx.arcGlint(this._tip.x, this._tip.y, this._tip.z, this._tip.x - this._tipPrev.x, this._tip.y - this._tipPrev.y, this._tip.z - this._tipPrev.z, !!d.heavy, crit);
        }
        // the sweep's snap flares the coat tails (cosmetic: the animator's own noise, not the RNG)
        if (d.kind === 'light' && !a.flared) {
          a.flared = true;
          this.anim.kickCoat(0.32, this.anim.noise);
        }
      }
      // the grass the blade passes through low is mown, from the active window into the follow-through
      // (world/grass.js mowSwing: the scorch map's A only, the swing's clock and hit untouched)
      mowSwing(this.game, a, sw, this.fx);
      // the edge glint runs up the leading edge as the cut comes in (fx.edgeGlint): from just before
      // the active frames until the cut lands (after the hit test: never a second star on the contact
      // frame) or reaches the arc's glint on a whiff. Not the execution's thrust
      if (armed && !a.hit && d.kind !== 'thrust') {
        const G = EDGE_GLINT, g0 = W - G.lead, g1 = W + d.active * (d.kind === 'cleave' ? G.atCleave : G.at);
        if (t >= g0 && prevT <= g1) {
          const u = clamp((t - g0) / (g1 - g0), 0, 1), z = lerp(G.z[0], G.z[1], u ** G.ease);
          this.fx.edgeGlint(sw, a.glintZ ?? G.z[0], z, this.bladeFar, crit, fin(this.game.realDt, 1 / 60), d.glint === 'ridge');
          a.glintZ = z;
        }
      }
      if (d.kind === 'cleave') {
        if (!a.gust && t >= W) {
          a.gust = true; // the burst forward throws a gust through the grass and a ring of dust
          const p = this.position;
          this.game.world?.gust?.(p.x + Math.sin(this.yaw) * 1.5, p.z + Math.cos(this.yaw) * 1.5, 0.4 + 0.6 * a.charge, 4 + 2 * a.charge);
          this.fx.release(p.x, p.z, a.charge);
        }
        // the cut ends low before him: the blade's wind tears a second gust and dust out of the grass
        if (!a.impact && t >= end - 0.02) {
          a.impact = true;
          sw.point(1, this._tip);
          if (Number.isFinite(this._tip.x + this._tip.z)) {
            this.game.world?.gust?.(this._tip.x, this._tip.z, 0.8 + 0.4 * a.charge, 4 + a.charge);
            this.fx.dust(this._tip.x, this._tip.z, 8 + Math.round(6 * a.charge), 1 + 0.5 * a.charge);
            this._groundMark(this._tip.x, this._tip.z, 'cut', lerp(SCAR.mark.hero.cleave[0], SCAR.mark.hero.cleave[1], clamp(fin(a.charge, 0), 0, 1)), SCAR.mark.hero.cleaveLen);
          }
          this.anim.kickCoat(0.5 + 0.3 * a.charge, this.anim.noise);
        }
      } else if (d.kind === 'thrust') {
        if (!a.gust && t >= W) {
          a.gust = true; // the lunge throws a gust through the grass and a ring of dust
          const p = this.position;
          this.game.world?.gust?.(p.x + Math.sin(this.yaw) * 1.5, p.z + Math.cos(this.yaw) * 1.5, 0.4 + 0.6 * a.charge, 4 + 2 * a.charge);
          this.fx.release(p.x, p.z, a.charge);
          sw.point(1, this._tipPrev);
        }
        // the long cyan streak behind the driving point
        if (t >= W && prevT <= end + 0.02) {
          sw.point(1, this._tip);
          // (the deathblow's clean contact, ?dbread=c: its finisher's thrust draws no white streak over him; Shatter Web draws the line)
          if (!(a.rip?.db && this.db.rc)) this.fx.thrustStreak(this._tipPrev, this._tip, a.charge, crit);
          this._tipPrev.copy(this._tip);
        }
      } else if (d.kind === 'slam' && !a.impact && t >= end - 0.02) {
        a.impact = true;
        this._slamImpact(a);
      }
    } else if (this.state === 'plunge') this._plungeTrail(sw);
    // (the flurry draws its own cuts, flurryFx.js: carried 1 m a frame, the blade's frame-to-frame
    // arc is a wide curl that has nothing to do with the cut)
    sw.commit();
  }

  /** The dive's blade trail: the swept band between frames + a long streak behind the point (the
   *  impact frame draws the last stretch into the head). */
  _plungeTrail(sw) {
    const pl = this.pl, ph = pl.phase;
    sw.point(1, this._tip);
    if (ph === PL.DIVE || (ph === PL.RIDE && pl.streak)) {
      // (the dive carries the blade: no turn to gate on. The instant slash look keeps only the straight streak)
      if (slashMode() === 'arc') this.fx.trail(sw.pa, sw.pb, sw.a, sw.b, 'slam', pl.exec, false);
      this.fx.thrustStreak(this._tipPrev, this._tip, 1, pl.exec);
      pl.streak = ph === PL.DIVE;
    } else pl.streak = false;
    this._tipPrev.copy(this._tip);
  }

  /** The slam meets the ground: crystal shards burst at the blade's point (and hit, if the blade
   *  itself missed: d.shards = { radius, height }), a gust, a heavy shake. */
  _slamImpact(a) {
    const d = a.def, g = this.game;
    this.sweep.point(1, this._tip);
    const x = this._tip.x, z = this._tip.z;
    if (!Number.isFinite(x + z)) return;
    this.fx.slamShards(x, z, this.critTimer > 0);
    this.anim.kickCoat(0.6, this.anim.noise); // the impact's blast throws the coat tails out
    g.world?.gust?.(x, z, 1.1, 4.5);
    g.shake?.(d.shake * 0.6);
    this._emit('player:slam', { x, z });
    // the ground takes it: a crack where the point went in, and whatever stands in the shards' reach
    const wb = this._worldBlowOf(a, true);
    if (wb) g.world?.impact?.(x, z, fin(d.shards?.radius, 1.5), fin(a.damage, 60) / 110, wb);
    const S = d.shards;
    if (a.hit || !S) return;
    const dr = g.dragon;
    if (!dr || typeof dr.takeHit !== 'function' || dr.state === 'dead' || dr.state === 'dying') return;
    const spheres = dr.hurtSpheres;
    if (!Array.isArray(spheres) || !spheres.length) return;
    // (viaShards: the blade is in the ground, the shards are the contact: no drawn cut)
    if (bandHit(spheres, x, 0, z, x, 0, z, fin(S.radius, 1.5), fin(S.height, 3), 0, this._hit) > 0) this._applyHit(a, this._hit, true);
  }

  /** One of his heavy blows met the floor (world.groundBlow: a mark of its kind, `by: 'player'`; it
   *  damages nothing). The gash runs from (x, z) along his facing. */
  _groundMark(x, z, kind, power, len) {
    const w = this.game.world;
    if (!w?.groundBlow || !Number.isFinite(x + z)) return;
    const o = (this._gmo ??= { kind: 'cut', power: 0, dx: 0, dz: 1, len: NaN, by: 'player' });
    o.kind = kind;
    o.power = power;
    o.dx = Math.sin(this.yaw);
    o.dz = Math.cos(this.yaw);
    o.len = len;
    w.groundBlow(x - (kind === 'cut' ? o.dx * len * 0.35 : 0), z - (kind === 'cut' ? o.dz * len * 0.35 : 0), o);
  }

  /** This swing as a blow on the world (world.destructibles: one id per swing, so a piece takes it once). */
  _worldBlowOf(a, ground = false) {
    const D = this.game.world?.destructibles;
    if (!D?.swing) return null;
    if (a.wsrc === undefined) a.wsrc = D.swing();
    const o = (this._worldBlow ??= { kind: 'cut', by: 'player', dx: 0, dz: 0, y: 0, ya: 0, yb: 0, src: -1, scar: true });
    o.kind = a.def.heavy ? 'blunt' : 'cut'; // a heavy cut bites stone; a quick one barely marks it
    o.src = a.wsrc;
    o.scar = ground;
    return o;
  }

  /**
   * The swing against the world's breakables (ADR-107): each piece the blade sweeps through takes one
   * blow per swing, as hard as the cut (POWER = its damage / 110: a full cleave fells a tree). What
   * falls, falls away from him: stand so the thing is between you and the foe. The blade goes CLEAN
   * THROUGH (BREAK.chip.pass; the owner, 2026-11-23): the swing's clock, its pose and its reach run
   * exactly as in open air (so the same swing still meets a boss behind the piece), and the piece shows
   * the passage: its bricks knocked off where the steel crossed, thrown on along the cut, sparks off
   * stone, splinters off wood, a faint line across the face, one small jolt of the camera.
   * `?cutStop=1` (cutStops) gives back the blade that STOPS on a piece it does not cut through
   * (_bladeStops, ADR-132); `prevT`: the attack clock last frame.
   */
  _cutWorld(a, sw, prevT = NaN) {
    const o = this._worldBlowOf(a);
    if (!o) return;
    const p = this.position;
    const stops = cutStops();
    o.dx = (sw.a.x + sw.b.x) * 0.5 - p.x;
    o.dz = (sw.a.z + sw.b.z) * 0.5 - p.z;
    o.y = Math.min(sw.a.y, sw.b.y) - 0.3;
    // (the blade's own height at its two ends: a piece is bitten where the steel met it, BREAK.chip)
    o.ya = sw.a.y;
    o.yb = sw.b.y;
    // the blade's travel this frame (its middle, on the ground): what it knocks off flies on along it
    const T = this._cutT ??= { x: 0, y: 0, z: 0 };
    T.x = (sw.a.x + sw.b.x - sw.pa.x - sw.pb.x) * 0.5;
    T.y = (sw.a.y + sw.b.y - sw.pa.y - sw.pb.y) * 0.5;
    T.z = (sw.a.z + sw.b.z - sw.pa.z - sw.pb.z) * 0.5;
    const tl = Math.hypot(T.x, T.y, T.z), hl = Math.hypot(T.x, T.z);
    if (!stops && hl > 1e-4 && Number.isFinite(tl)) {
      o.tx = T.x / hl;
      o.tz = T.z / hl;
    } else o.tx = o.tz = NaN; // (the stop: its chips fly back off the face, as they did)
    const D = this.game.world.destructibles;
    const n = D.sweep(sw.a.x, sw.a.z, sw.b.x, sw.b.z, REACH.radius, fin(a.damage, 30) / 110, o);
    if (n > 0 && !a.exec && D.struck && chipLook() !== '0') {
      const S = D.struck, ST = BREAK.chip.stop;
      if (stops) {
        // (only on contact: the steel within `touch` m of the piece's footprint, the blade's thickness)
        if (S.held && S.held.h >= ST.minH && this._bladeTouches(sw, S.held, ST.touch)) {
          this._bladeStops(a, S, prevT);
          return;
        }
        // it cut the thing through: a beat of weight as the blade goes on
        if (S.broke > 0 && !a.wthrough) {
          a.wthrough = true;
          this._hitstop(ST.through, 0.05);
        }
      } else if (tl > 1e-4 && Number.isFinite(tl)) this._cutPasses(a, S, T.x / tl, T.y / tl, T.z / tl);
    }
    if (n > 0 && !a.wfelt) {
      a.wfelt = true; // the hand feels it: one small jolt per swing
      const J = BREAK.chip.pass.jolt;
      this.game.shake?.(a.def.heavy ? J[1] : J[0]);
    }
  }

  /**
   * The blade went through the pieces this frame's sweep struck (BREAK.chip.pass): each shows where the
   * steel crossed it (fx.cutPass: sparks off stone and metal, splinters off wood, the line across the
   * face). A floor slab under the edge shows nothing more; a sliced piece (bamboo) falls at the cut.
   */
  _cutPasses(a, S, tx, ty, tz) {
    const P = BREAK.chip.pass, q = fin(this.game.world?.destructibles?.q, 1), heavy = !!a.def.heavy;
    for (let i = 0; i < S.n; i++) {
      const e = S.list[i], b = e.b;
      if (!b || b.floor || b.slice) continue;
      this.fx.cutPass(e.x, e.y, e.z, b.x, b.z, fin(b.r, 0.4), tx, ty, tz, b.mat, b.M, heavy, P, q);
    }
  }

  /**
   * The cut met a piece it could not cut through (BREAK.chip.stop, ADR-132; with `?cutStop=1`): the
   * blade stops there. The attack clock goes back to the middle of this frame's travel (about where the
   * edge met it), the frame freezes, the camera shakes, steel on stone throws sparks; _tickAttack holds
   * the pose while it sticks (wood) and then throws the blade back (the bounce), away from the piece.
   */
  /** Does the blade's segment (sw.a -> sw.b, ground plane) come within `pad` m of piece b's footprint? */
  _bladeTouches(sw, b, pad) {
    const ax = sw.a.x, az = sw.a.z, ex = sw.b.x - ax, ez = sw.b.z - az, l2 = ex * ex + ez * ez;
    const t = l2 > 1e-9 ? clamp(((b.x - ax) * ex + (b.z - az) * ez) / l2, 0, 1) : 0;
    return Math.hypot(ax + ex * t - b.x, az + ez * t - b.z) <= b.r + pad;
  }

  _bladeStops(a, S, prevT) {
    const ST = BREAK.chip.stop, b = S.held, hard = b.mat !== 'wood';
    if (Number.isFinite(prevT) && prevT < a.t) a.t = prevT + (a.t - prevT) * 0.5;
    a.wstop = b;
    a.stuck = hard ? ST.stick.hard : ST.stick.wood;
    a.wpush = hard ? ST.push.hard : ST.push.wood;
    a.wfelt = true;
    this._hitstop(hard ? ST.freeze.hard : ST.freeze.wood, 0.03);
    this.game.shake?.((hard ? ST.shake.hard : ST.shake.wood) * (a.def.heavy ? 1.3 : 1));
    if (b.mat === 'stone' || b.mat === 'metal') {
      // sparks fly back off the face toward him
      const p = this.position, dx = p.x - b.x, dz = p.z - b.z, l = Math.hypot(dx, dz) || 1;
      this.fx.sparks(S.x, S.y, S.z, dx / l, dz / l, !!a.def.heavy);
    }
  }

  _tryHit(a) {
    if (a.exec) {
      this._executeHit(a);
      return;
    }
    const dr = this.game.dragon;
    if (!dr || typeof dr.takeHit !== 'function') return;
    if (dr.state === 'dead' || dr.state === 'dying') return;
    const spheres = dr.hurtSpheres;
    if (!Array.isArray(spheres) || !spheres.length) return;
    const h = this._hit;
    if (!this.sweep.test(spheres, h, fin(a.def.up, REACH.up))) {
      if (!a.rip) return;
      riposteContact(dr, h); // the planted riposte lands whatever the sweep found (its one blow)
    }
    this._applyHit(a, h);
  }

  /**
   * Deal one swing's damage at contact h {sphere, x, y, z} (the upright gameplay point the hit test
   * found). The cut is DRAWN where the drawn blade meets the drawn body (_contactPoint): the FX, his
   * spray and the damage number go there, and the camera is thrown along the cut. `viaShards`: the
   * slam's ground burst hit (the blade is in the ground: no drawn cut).
   */
  _applyHit(a, h, viaShards = false) {
    const dr = this.game.dragon;
    a.hit = true; // one hit per swing

    const d = a.def, heavy = !!d.heavy;
    const part = typeof h.sphere.part === 'string' ? h.sphere.part : 'body';
    const crit = this.critTimer > 0 || !!a.crit;
    const damage = a.rip ? a.rip.damage : a.damage * (crit ? DEFENSE.ghostep.critMult : 1); // raw: the dragon applies part multipliers
    const dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; // the facing: the shove
    const C = !viaShards && this._contactPoint(dr, d.kind, this._cut) ? this._cut : null;
    const point = C ? { x: C.x, y: C.y, z: C.z } : { x: h.x, y: h.y, z: h.z };
    const cut = C ? { x: C.gx, z: C.gz } : null; // the blade's ground-plane travel: his spray
    // (CONTACT: the part of his drawn body the drawn steel is nearest now: his reaction's limb)
    const limb = !viaShards && !a.rip ? this._limbNear(dr) : null;
    const dp = dr.position, x0 = fin(dp?.x, NaN), y0 = fin(dp?.y, NaN), z0 = fin(dp?.z, NaN);
    let dealt = damage;
    try {
      // (`reel` 2: a blow that throws a duelist out of what he is doing, the Rising Crescent)
      const r = dr.takeHit(a.rip ? (a.rip.db ? deathblowTakeHit : riposteTakeHit)(this, point, { cut }) : { damage, part, point, dir, cut, poise: a.poise, heavy, crit, swing: true, ...(d.reel ? { reel: d.reel } : null), ...(limb ? { limb } : null) });
      if (Number.isFinite(r)) dealt = r;
    } catch (err) {
      console.error('[player] dragon.takeHit failed', err);
    }
    // his shove: a duelist's takeHit moves him at once (TUNING.hitStun push), and the freeze holds the
    // frame he is drawn in after it: the cut goes with his drawn body (his spray did the same)
    const mx = fin(dp?.x, NaN) - x0, my = fin(dp?.y, NaN) - y0, mz = fin(dp?.z, NaN) - z0;
    if (Number.isFinite(mx + my + mz) && mx * mx + my * my + mz * mz < 1) {
      point.x += mx;
      point.y += my;
      point.z += mz;
      if (C) {
        C.x += mx;
        C.y += my;
        C.z += mz;
      }
    }
    // (this.atk may be gone: a deflect or a trade clash bounced him)
    const guarded = (!!a.guarded || !!a.traded) && dealt === 0;
    // CONTACT (?contact=a): the swing is posed where the drawn steel meets his drawn body, held there
    // through the freeze, then carried on; the cut is drawn at that meeting
    if (!guarded && !viaShards && this.atk === a && Number.isFinite(mx + my + mz)) {
      const M = this._cutContact(dr, mx, my, mz, heavy, false);
      if (M) {
        point.x = M.x;
        point.y = M.y;
        point.z = M.z;
        if (C) {
          C.x = M.x;
          C.y = M.y;
          C.z = M.z;
        }
      }
    }
    // (the slam's ground shards: the blade is in the ground, no cut: no cut weight, no blade sound)
    this._emit('player:hitDragon', { damage: dealt, part, point, heavy, crit, kind: d.kind, guarded, combo: d.combo ?? 1, weight: viaShards ? null : d.contact ?? (heavy ? 'slam' : 'light'), shards: viaShards });
    // turned by a guard: the guard draws the clash and sets its own freeze; no cut, no sparks of his
    if (guarded) return;
    if (dealt > 0) this._guardGain(heavy ? GUARD.hit.heavy : GUARD.hit.light);
    // (the steel flares at its own contact: not when the shards hit and the blade is in the ground)
    if (!viaShards) this.bladeFlare = Math.max(this.bladeFlare, heavy || crit ? TUNE.bladeFlare.hit[1] : TUNE.bladeFlare.hit[0]);
    // the contact, for the animator and other areas: when (the attack clock: anim.js attackPose's bite;
    // −1 = none) and which way the blade went
    a.hitAt = a.t;
    a.cutDir = this._cutDir(C, a.cutDir);
    const HF = HIT_FEEL.crit, k = fin(a.charge, 0);
    this._hitstop(fin(d.hitstop, 0.05) * (crit ? HF.stop : 1) * (d.kind === 'cleave' ? 1 + 0.3 * k : 1));
    this.game.shake?.(fin(d.shake, 0) * (crit ? HF.shake : 1));
    const pm = feel(d.punch, k) + (crit ? HF.punch : 0);
    if (pm > 0) this.game.punch?.(pm);
    const km = feel(d.kick, k) * (crit ? HF.kick : 1);
    if (km > 0 && C) this.game.kick?.(C.cx, C.cy, C.cz, km);
    if (!viaShards) this.fx.contact(point, d.contact ?? 'light', C, crit || dr.broken === true, k, !!(a.rip?.db && this.db.rc)); // (the deathblow's clean contact: the light burst)
    if (C) this._edgeFlash(C, heavy, crit, d.glint === 'ridge');
    if (d.kind === 'cleave') this.fx.cleaveImpact(point.x, point.y, point.z, C ? C.gx : dir.x, C ? C.gz : dir.z, k, crit, true);    if (a.rip) (a.rip.db ? deathblowLanded : riposteCutLanded)(this, dealt);
  }

  /**
   * CONTACT (combat/contact.js, ADR-259; ?contact=a): the hero's swing shown where his DRAWN steel meets
   * the boss: on his drawn body (a cut), or with `guard` on his blade (and before his body where it would
   * get past it). The swing's clock is searched from now (back where the steel is already through, on
   * where it is still short), he is posed there now (_poseNow: the freeze holds this frame) and the pose
   * pinned to that time (atk.pin / atk.show: animT), then carried on. (dx, dy, dz): the shove the boss was
   * given this frame (he is drawn there). Returns the meeting point (world, drawn) or null.
   */
  _cutContact(dr, dx = 0, dy = 0, dz = 0, heavy = false, guard = false, thrust = false) {
    const a = this.atk;
    if (!contactOn() || !a || (a.exec && !thrust) || !dr || !this.rig.loadout?.weapon) return null;
    const B = this._cFoe ?? (this._cFoe = new ContactBody(THREE, 48));
    const ok = dr.rig?.pelvis && typeof dr.drawnPoint === 'function' ? B.fromRig(dr.rig, fin(dr.drawScale, 1), dx, dy, dz) : B.fromSpheres(dr.hurtSpheres);
    if (!ok) return null;
    const s = this.rig.sword, K = CONTACT.hero;
    const A0 = (this._cK0 ??= new THREE.Vector3()), A1 = (this._cK1 ??= new THREE.Vector3()), P = (this._cK2 ??= new THREE.Vector3());
    const H0 = (this._cK3 ??= new THREE.Vector3()), H1 = (this._cK4 ??= new THREE.Vector3()), C = this._cp;
    // his steel (a guard): his blade as drawn, shifted with him
    const steel = guard && dr._tipOk && dr._hilt && dr._tip;
    if (steel) {
      H0.set(dr._hilt.x + dx, dr._hilt.y + dy, dr._hilt.z + dz);
      H1.set(dr._tip.x + dx, dr._tip.y + dy, dr._tip.z + dz);
    }
    const t0 = a.t, show0 = fin(a.show, 0);
    let onSteel = false;
    const at = (t) => {
      a.show = t0 - t;
      this._poseNow();
      this.object3d.updateMatrixWorld(true);
      A0.set(0, 0, DIM.bladeBase).applyMatrix4(s.matrixWorld);
      A1.set(0, 0, DIM.drawnTip).applyMatrix4(s.matrixWorld);
      const gB = B.gap(A0, A1, CONTACT.edge, P, guard || thrust ? 0 : CONTACT.bite);
      // (a thrust: its POINT shown CONTACT.exec.depth m in; the burst where the steel enters, P)
      if (thrust) return B.gap(A1, A1, 0) + CONTACT.exec.depth;
      if (!guard) return gB;
      const gs = steel ? closestOnSegments(A0, A1, H0, H1, C[0], C[1]) - 2 * CONTACT.edge : Infinity, gb = gB - CONTACT.guard.shell;
      onSteel = gs <= gb;
      if (onSteel) P.lerpVectors(C[0], C[1], 0.5);
      return Math.min(gs, gb);
    };
    let tc = NaN;
    try {
      tc = findContact(at, t0 - show0, thrust ? 0 : guard ? CONTACT.guard.bite : CONTACT.bite, K, 0);
    } catch (err) {
      console.error('[player] the cut contact failed', err);
    }
    if (!Number.isFinite(tc)) {
      a.show = show0;
      this._poseNow();
      return null;
    }
    at(tc);
    this.struckFoe = guard ? (onSteel ? 'steel' : 'guard') : B.struck;
    const P0 = (a.pin ??= newPin());
    pinAt(P0, tc, t0, guard ? K.guardHold : heavy ? K.holdHeavy : K.hold, guard ? K.guardFollow : K.follow);
    a.show = P0.show;
    this.sweep.sample(); // (the blade where it is shown: its arc runs on from last frame's to here)
    return Number.isFinite(P.x + P.y + P.z) ? P : null;
  }

  /** CONTACT: the capsule of the boss's drawn body nearest the hero's drawn steel now ('head' | 'body' |
   *  'armR' | 'armL' | 'legR' | 'legL'; null when off, or a body without capsules: the wyrm). One gap, no pose. */
  _limbNear(dr) {
    if (!contactOn() || !dr?.rig?.pelvis || typeof dr.drawnPoint !== 'function') return null;
    const B = this._cFoe ?? (this._cFoe = new ContactBody(THREE, 48));
    if (!B.fromRig(dr.rig, fin(dr.drawScale, 1))) return null;
    const s = this.rig.sword, A0 = (this._cK0 ??= new THREE.Vector3()), A1 = (this._cK1 ??= new THREE.Vector3());
    A0.set(0, 0, DIM.bladeBase).applyMatrix4(s.matrixWorld);
    A1.set(0, 0, DIM.drawnTip).applyMatrix4(s.matrixWorld);
    return Number.isFinite(B.gap(A0, A1, CONTACT.edge)) ? B.struck : null;
  }

  /** The unit world travel of the blade at contact C (into `out`, reused), or null without one. */
  _cutDir(C, out) {
    const l = C ? Math.hypot(C.cx, C.cy, C.cz) : 0;
    if (!(l > 1e-6) || !Number.isFinite(l)) return null;
    const o = out ?? { x: 0, y: 0, z: 0 };
    o.x = C.cx / l;
    o.y = C.cy / l;
    o.z = C.cz / l;
    return o;
  }

  /**
   * Where a landed cut is DRAWN (→ out; false when there is no drawn body or no blade): the hit test
   * runs on the upright gameplay bodies (unleaned, unscaled), so its point floats 13-65 px off the
   * drawn blade and the drawn body at the game camera. Here the drawn blade's stretch from
   * CUT_LOOK.from to the arc's edge (fx.arcAt) is met with the boss's DRAWN hurt spheres
   * (dr.drawnPoint, × dr.drawScale; identity without one, the wyrm): the nearest sphere to that
   * stretch; the contact is on the blade, moved CUT_LOOK.toBody of the way onto its surface (and at
   * most CUT_LOOK.offMax off it; on the blade where it is inside). Fills out { x, y, z, f (along the
   * hit segment), cx, cy, cz (the blade's travel there since last frame, less the hero's own), gx, gz
   * (its unit ground-plane direction; the facing if it has none), ex, ey, ez (the blade's unit
   * direction) }. No allocation.
   */
  _contactPoint(dr, kind, out) {
    const sw = this.sweep, H = dr?.hurtSpheres;
    if (!sw.valid || !Array.isArray(H) || !H.length) return false;
    const f0 = CUT_LOOK.from, f1 = this.fx.arcAt(kind);
    const A = this._cA.lerpVectors(sw.a, sw.b, f0), B = this._cB.lerpVectors(sw.a, sw.b, f1);
    const abx = B.x - A.x, aby = B.y - A.y, abz = B.z - A.z, l2 = abx * abx + aby * aby + abz * abz;
    if (!(l2 > 1e-8)) return false;
    const toDrawn = typeof dr.drawnPoint === 'function', sc = toDrawn ? fin(dr.drawScale, 1) : 1;
    const S = this._cS;
    let best = Infinity, bu = 0, px = 0, py = 0, pz = 0, sx = 0, sy = 0, sz = 0, br = 0, bd = 0;
    for (let i = 0; i < H.length; i++) {
      const q = H[i];
      if (!q || !(q.r > 0)) continue;
      S.set(q.x, q.y, q.z);
      if (toDrawn) dr.drawnPoint(S);
      if (!Number.isFinite(S.x + S.y + S.z)) continue;
      const r = q.r * sc;
      const u = clamp(((S.x - A.x) * abx + (S.y - A.y) * aby + (S.z - A.z) * abz) / l2, 0, 1);
      const qx = A.x + abx * u, qy = A.y + aby * u, qz = A.z + abz * u;
      const dd = Math.hypot(qx - S.x, qy - S.y, qz - S.z), g = dd - r;
      if (g < best) {
        best = g;
        bu = u;
        px = qx;
        py = qy;
        pz = qz;
        sx = S.x;
        sy = S.y;
        sz = S.z;
        br = r;
        bd = dd;
      }
    }
    if (best === Infinity) return false;
    const P = this._cP.set(px, py, pz);
    if (best > 0 && bd > 1e-6) {
      // the sphere's surface point nearest the blade, and toBody of the way there from the blade (at
      // most offMax off the surface: a wide gap is the reach band's, the cut lands on the body)
      const k = br / bd, T = Math.max(CUT_LOOK.toBody, 1 - CUT_LOOK.offMax / best);
      P.x += (sx + (px - sx) * k - px) * T;
      P.y += (sy + (py - sy) * k - py) * T;
      P.z += (sz + (pz - sz) * k - pz) * T;
    }
    out.x = P.x;
    out.y = P.y;
    out.z = P.z;
    out.f = f0 + bu * (f1 - f0);
    // the blade's travel at f since last frame (pa / pb: _combat commits after the hit), less the
    // root's own (the cleave's dash would tilt the cut forward)
    const cur = this._cA.lerpVectors(sw.a, sw.b, out.f), prev = this._cB.lerpVectors(sw.pa, sw.pb, out.f);
    const gdt = fin(this.game.dt, 0);
    out.cx = cur.x - prev.x - fin(this.groundVel.x, 0) * gdt;
    out.cy = cur.y - prev.y;
    out.cz = cur.z - prev.z - fin(this.groundVel.z, 0) * gdt;
    const gl = Math.hypot(out.cx, out.cz);
    if (gl > 1e-4) {
      out.gx = out.cx / gl;
      out.gz = out.cz / gl;
    } else {
      out.gx = Math.sin(this.yaw);
      out.gz = Math.cos(this.yaw);
    }
    const ex = sw.b.x - sw.a.x, ey = sw.b.y - sw.a.y, ez = sw.b.z - sw.a.z, el = Math.hypot(ex, ey, ez) || 1;
    out.ex = ex / el;
    out.ey = ey / el;
    out.ez = ez / el;
    return Number.isFinite(out.x + out.y + out.z + out.f + out.cx + out.cy + out.cz + out.gx + out.gz + out.ex + out.ey + out.ez);
  }

  // ------------------------------------------------------------------ fx / visuals
  /** A foot touches down (the gait's planner, the thrust dash's steps): `dust` (0..1, optional)
   *  kicks up a puff of its own size (the dash's bounding steps). */
  _footstep(side, dust = 0) {
    const leg = side < 0 ? this.rig.legs.R : this.rig.legs.L;
    leg.foot.getWorldPosition(this._v);
    const sprint = this.state === 'sprint';
    // the living world's steps (world/life/steps.js; `?life=`): the ground answers the foot, and the
    // payload says what it was. With the piece off (or no living world) it is today's step exactly.
    const o = (this._stepO ??= { sprint: false, heavy: false, side: 0, vx: 0, vz: 0, kick: 0 });
    o.sprint = sprint; o.side = side < 0 ? -1 : 1; o.vx = this.vel.x; o.vz = this.vel.z; o.kick = dust;
    const surface = this.game.world?.life?.steps?.footfall?.(this._v.x, this._v.z, o);
    const d = { x: this._v.x, z: this._v.z, sprint };
    if (surface) d.surface = surface;
    this._emit('player:footstep', d);
    if (surface) return;
    if (dust > 0) this.fx.dust(this._v.x, this._v.z, Math.round(3 + 5 * dust), 0.5 + 0.6 * dust);
    else if (sprint) this.fx.dust(this._v.x, this._v.z, 2, 0.4);
  }

  _updateFx(dt) {
    const p = this.position;
    deathblowFxUpdate?.(this.game, fin(this.game.realDt, dt));
    deathblowMatrixUpdate?.(this.game, fin(this.game.realDt, dt));
    if (this.state === 'heal') {
      const t = this.stateT;
      this.fx.healTick(dt, p.x, p.z, smoothstep(0.27, 0.5, t) * (1 - smoothstep(0.7, 0.84, t)));
    }
    if (this.healLight) {
      if (this.healLight.dead) this.healLight = null;
      else this.healLight.set?.(p.x, 1.3, p.z);
    }
    const sw = this.sweep;
    if (this.state === 'lock' && dt > 0) {
      const x = this._lockCross();
      if (x && this.stateT > 0.12) clashGrind(this.game, x.x, x.y, x.z, 0.4 + 0.6 * this.recoil);
    }
    const armed = !!this.rig.loadout?.weapon; // no weapon equipped: no blade halo, no gem glow
    // (the sword put away for a moment, anim.js stow: no halo round it, no glow at its gem)
    const stowed = this.anim?.stow > 0.5;
    // the roll's sliding kneel (the root still carries 4-6 m/s through it): dust and torn grass
    // off the shin and the planted foot, cold sparks off the point dragging behind
    if (this.state === 'roll' && !this.rollBack && dt > 0) {
      const t = this.stateT, S = ROLL_SLIDE;
      const k = smoothstep(S[0] - 0.02, S[0] + 0.03, t) * (1 - smoothstep(S[1] - 0.05, S[1], t));
      const gx = this.groundVel.x, gz = this.groundVel.z, sp = Math.hypot(gx, gz);
      if (k > 0.01 && sp > 0.3) {
        const dx = gx / sp, dz = gz / sp;
        this.rig.legs.R.shin.getWorldPosition(this._v);
        this.fx.skid(dt, 0, this._v.x, this._v.z, dx, dz, sp, k);
        this.rig.legs.L.foot.getWorldPosition(this._v);
        this.fx.skid(dt, 1, this._v.x, this._v.z, dx, dz, sp, 0.55 * k);
        if (sw.valid) {
          sw.point(1, this._v);
          if (this._v.y < 0.14) this.fx.scrape(dt, this._v.x, this._v.y, this._v.z, dx, dz, sp * k);
        }
      }
    }
    // the plunge: cold motes gathering on him through the hang, embers spurting from the wound while
    // he rides the head
    const hidden = (this.state === 'plunge' && this.pl.phase === PL.VANISH) || (this.state === 'flurry' && this.flurry.hidden);
    this.flurry.draw(dt); // the cuts it left hanging; the wake of a pass
    if (this.state === 'plunge' && dt > 0) {
      const pl = this.pl;
      if (pl.phase === PL.HANG) {
        this.getChestPos(this._v, true);
        this.fx.plungeHang(dt, this._v.x, this._v.y, this._v.z);
      } else if (pl.phase === PL.RIDE && pl.hit) {
        this.fx.plungeRide(dt, pl.hitPt.x, pl.pt.y - 0.1, pl.hitPt.z, pl.dx, pl.dz, 1 - smoothstep(0.5, 1, this.plungeAnim.u));
      }
    }
    if (sw.valid) {
      if (this.state === 'charge') this.fx.chargeTick(dt, sw.a, sw.b, this.chargeK);
      else if (this.critTimer > 0 && this.alive) this.fx.critTick(dt, sw.a, sw.b);
      // the blade's dot halo: dim at idle, brighter while it glows (strikes, charge, crit)
      if (this.alive && this.object3d.visible !== false && !hidden && armed && !stowed) {
        const bu = this.rig.materials.blade.uniforms;
        const hk = TUNE.bladeLook.halo;
        if (hk > 0) this.fx.bladeHalo(dt * Math.min(1, hk), clamp((bu.uInkGlow.value - 0.16) * 0.8 + TUNE.bladeFlare.halo * this.bladeFlare, 0.25, 2) * hk, this.bladeFar);
      }
    }
    // the violet gem: an always-on glow point, idle glints, a fast flicker while charging. Every
    // gem particle moves with the hilt's own velocity (not the root's), so nothing is left behind
    // by a swing or the lunge.
    this.rig.gem.getWorldPosition(this._gem);
    const gv = this.gemVel, gp = this._gemPrev;
    if (dt > 0 && Number.isFinite(gp.x)) {
      gv.x = clamp((this._gem.x - gp.x) / dt, -30, 30);
      gv.y = clamp((this._gem.y - gp.y) / dt, -30, 30);
      gv.z = clamp((this._gem.z - gp.z) / dt, -30, 30);
    }
    gp.copy(this._gem);
    if (this.state !== 'dead' && this.object3d.visible !== false && !hidden && armed) {
      const charging = this.state === 'charge';
      // (put away: the timer runs on, as it draws on the animator's noise, but nothing is drawn)
      if (!stowed) this.fx.gemTick(dt, this._gem.x, this._gem.y, this._gem.z, charging ? 0.5 + this.chargeK : 0.35, gv.x, gv.z, gv.y);
      this.gemT -= dt;
      if (this.gemT <= 0) {
        // (the animator's own noise: a cosmetic timer must not move the AI's seeded Math.random)
        this.gemT = charging ? 0.22 : TUNE.gemGlintEvery * (0.6 + 0.8 * this.anim.noise());
        // only while the hilt is steady: a glint left behind by a fast swing floats off the gem
        if (!stowed && (charging || LOCO.has(this.state))) this.fx.gemGlint(this._gem.x, this._gem.y, this._gem.z, charging ? 0.5 + 0.5 * this.chargeK : 0.45, gv.x, gv.z, gv.y);
      }
    }
    this.mystic?.update(dt); // (swordMystic.js; returns at once with ?mystic=0)
  }

  _updateMaterials(dt) {
    const M = this.rig.materials;
    // glyph cells follow the view distance: in-game size at the 36 m camera, a ~30-row field in
    // the Lab / showroom close-ups (hero.md §7)
    const cam = this.game.camera?.position;
    if (cam) {
      const p = this.position;
      const d = Math.hypot(cam.x - p.x, cam.y - p.y - 1.1, cam.z - p.z);
      if (Number.isFinite(d)) {
        this.viewDist = d;
        this.glyphScale = setHeroGlyphScale(this.rig.mats, d);
      }
    }
    const far = smoothstep(10, 28, this.viewDist); // 0 in close-ups … 1 at the game camera
    this.flash = Math.max(0, this.flash - dt * 6);
    const plunging = this.state === 'plunge', flurrying = this.state === 'flurry';
    // (the flurry holds its cold cast for as long as it runs: its own clock is real time)
    if (!flurrying) this.ghostFx = Math.max(0, this.ghostFx - dt * (plunging ? TUNE.plungeFade : TUNE.ghostepFade));
    const burnTarget = this.burnT > 0 ? 0.28 + 0.1 * Math.sin(this.time * 17) : 0;
    this.burnGlow = damp(this.burnGlow, burnTarget, 8, dt);
    // Ghostep / plunge reappear: cells resolve out of a cold dissolve, ink tinted blue-white (the
    // plunge's vanish: gone entirely until he reappears above the head)
    const gk = this.ghostFx;
    const dissolve = (plunging && this.pl.phase === PL.VANISH) || (flurrying && this.flurry.hidden) ? 1 : smoothstep(0.55, 1, gk) * 0.85;
    // through the hang and the dive he keeps a cold cast: it parts him from the wyrm's grey scales
    // (the flurry: a full cold cast, so the dark coat reads against the night between two blinks)
    const tk = flurrying ? 1 : plunging && (this.pl.phase === PL.HANG || this.pl.phase === PL.DIVE) ? Math.max(gk, 0.4) : gk;
    const tr = 1 + tk * 0.8, tg = 1 + tk * 1.4, tb = 1 + tk * 2.6;
    for (const m of this.rig.mats) {
      const u = m.uniforms;
      u.uFlash.value = this.flash * 0.85;
      u.uDissolve.value = dissolve;
      u.uTint.value.setRGB(tr, tg, tb);
      if (m !== M.blade && m !== M.bladeTip && m !== M.flask && m !== M.gem) u.uGlow.value = this.burnGlow;
    }
    // blade: dark faceted flats with the icy edge / ridge seams always lit (a slow shimmer),
    // flaring through every strike, rising with the charge (the thrust stays hot through its
    // follow-through) and pulsing in the crit window. At the game camera the 0.09 m blade is ~4 px
    // wide and its seams are sub-pixel, so the flats self-light more with distance: the sword stays
    // the brightest thing on the hero there, while close-ups keep dark steel with glowing edges.
    // (lean reference match: 2.3 → 1.25 × far: the self-lit blade bloomed into a halo that hid his body)
    const restInk = 0.6 + 1.0 * far;
    let ink = restInk + 0.08 * Math.sin(this.time * 2.6), glow = 1.45 + 0.15 * Math.sin(this.time * 3.7);
    const a = this.atk, st = this.state;
    if (st === 'charge') {
      const k = this.chargeK;
      ink = 1.0 + 1.6 * k + (this.chargeFull ? 0.3 * Math.sin(this.time * 18) : 0);
      glow = 1.0 + 0.8 * k;
    } else if (a && (st === 'attack' || st === 'heavy') && !a.pending) {
      const d = a.def, t = a.t;
      if (t >= d.windup - 0.06 && t <= d.windup + d.active + 0.12) {
        // relative to rest: at the game camera the rest ink is already 1.6 and the rest glow 1.45 (a
        // flat 1.6 / 1.25 left a light strike no brighter than the idle blade there, its seams dimmer)
        ink = Math.max(d.heavy ? 2.2 : 1.6, restInk + (d.heavy ? 0.6 : 0.3));
        glow = Math.max(1.45, d.heavy ? 1.6 : 1.5);
      }
      if (d.dash) {
        const fade = 1 - smoothstep(d.windup + d.active, d.windup + d.active + 0.3, t);
        ink = Math.max(ink, (1.2 + 1.4 * this.releaseK) * fade);
        glow = Math.max(glow, (1.0 + 0.6 * this.releaseK) * fade);
      }
    } else if (flurrying) {
      // the flurry: the blade blazes through every cut; an art's coil winds its light up
      const k = clamp(this.flurry.glow, 0, 1);
      ink = 1.5 + 1.3 * k + (k > 0.6 ? 0.25 * Math.sin(this.time * 40) : 0);
      glow = 1.25 + 0.5 * k;
    } else if (plunging) {
      // the plunge: the blade blazes from the hang through the ride, cooling through the flip
      const ph = this.pl.phase;
      if (ph >= PL.HANG && ph <= PL.RIDE) {
        ink = ph === PL.HANG ? 1.8 + 0.3 * Math.sin(this.time * 30) : 2.6;
        glow = ph === PL.HANG ? 1.4 : 1.7;
      } else if (ph === PL.FLIP) {
        ink = Math.max(ink, 1.6);
        glow = Math.max(glow, 1.25);
      }
    }
    if (this.critTimer > 0) {
      ink = Math.max(ink, 1.3 + 0.4 * Math.sin(this.time * 14));
      glow = Math.max(glow, 1.2);
    }
    if (!this.alive) {
      ink *= 0.5;
      glow *= 0.4;
    }
    const bu = M.blade.uniforms, tu = M.bladeTip.uniforms;
    const bdt = flurrying ? this.flurry.animDt : dt; // (the flurry's blade follows real time)
    bu.uInkGlow.value = bdt > 0 ? damp(bu.uInkGlow.value, ink, 18, bdt) : dt > 0 ? bu.uInkGlow.value : ink;
    bu.uGlow.value = bdt > 0 ? damp(bu.uGlow.value, glow, 14, bdt) : dt > 0 ? bu.uGlow.value : glow;
    tu.uInkGlow.value = bu.uInkGlow.value + 0.3; // the point stays the brightest steel
    tu.uGlow.value = bu.uGlow.value;
    // far away the chevrons grow to fill their cells, so the ~4 px blade reads as a solid cyan line
    bu.uGlyphZoom.value = tu.uGlyphZoom.value = 0.72 - 0.26 * far;
    // … and the dark steel between them lights up too (gaps are base × light)
    bu.uBase.value.setRGB(BLADE_BASE[0] + 0.2 * far, BLADE_BASE[1] + 0.36 * far, BLADE_BASE[2] + 0.5 * far);
    this.bladeFar = far;
    {
      // the flare where the game camera sees it: part 17's pass gains (the art pass compresses luma, so
      // uInkGlow alone does not read at 36 m; the fill gain is linear past the far HDR cap, and the
      // blade there is one 4 px cell of mostly silhouette line, so its ink AND rim lines flare too).
      // Part 17 is only the hero's sword (gear/wanderer.js M.blade / M.bladeTip; HERO_INK.bladeTip
      // writes it last). ABSOLUTE values every frame: another buildHero (the boss's, setLoadout) resets
      // the shared arrays; at g = 1 this writes exactly the HERO_INK base
      // The steel is dark at rest (TUNE.bladeLook) and lit by what he does with it: a strike's window
      // in full, the charge as it winds up, the flurry and the plunge's dive, a crit's window; the
      // light is there at once and leaves in a few frames (bladeHot). It goes to his OWN part tables
      // (uSelfPart*): no boss's rig reads them.
      const F = TUNE.bladeFlare, B = HERO_INK.bladeTip, P = B.part;
      const inStrike = !!a && (st === 'attack' || st === 'heavy') && !a.pending && a.t >= a.def.windup - 0.06 && a.t <= a.def.windup + a.def.active + 0.12;
      let hot = inStrike ? 1 : 0;
      if (st === 'charge') hot = Math.max(hot, clamp(this.chargeK, 0, 1));
      else if (flurrying) hot = 1;
      else if (plunging) hot = Math.max(hot, this.pl.phase >= PL.HANG && this.pl.phase <= PL.RIDE ? 1 : this.pl.phase === PL.FLIP ? 0.5 : 0);
      if (a && a.def?.dash && (st === 'attack' || st === 'heavy') && !a.pending) {
        hot = Math.max(hot, clamp(this.releaseK, 0, 1) * (1 - smoothstep(a.def.windup + a.def.active, a.def.windup + a.def.active + 0.3, a.t)));
      }
      if (this.critTimer > 0) hot = Math.max(hot, 0.5);
      if (!Number.isFinite(hot)) hot = 0;
      this.bladeHot = hot >= this.bladeHot ? hot : dt > 0 ? damp(this.bladeHot, hot, F.cool, dt) : this.bladeHot;
      const heavyLit = st === 'charge' || flurrying || plunging || !!a?.def?.heavy;
      const g0 = this.alive ? 1 + (heavyLit ? F.strike[1] : F.strike[0]) * this.bladeHot + this.bladeFlare : 1;
      // calm at the contact (combat/impactCalm.js, read at the hit: fx.calmBlade / calmFlare): the lit
      // part of the gain dimmed while the hit's flare is held; exactly g0 today and on a missed swing
      const cb = this.fx.calmBlade?.(this.bladeFlare / F.hit[0]) ?? 1, cf = this.fx.calmFlare?.(this.bladeFlare) ?? this.bladeFlare;
      const g = !this.alive || (cb === 1 && cf === this.bladeFlare) ? g0 : 1 + ((heavyLit ? F.strike[1] : F.strike[0]) * this.bladeHot + cf) * cb;
      if (Number.isFinite(g)) {
        // the streak (player/streakFx.js `bladeLine`, the aura piece): the steel's ink and rim lines held
        // a little lit at rest, more at each tier; its flats stay dark (0 = today, exactly)
        const sl = this.game.fx?.streak?.bladeLine, sk = sl > 0 && Number.isFinite(sl) ? 1 + sl / Math.max(1, g) : 1;
        const U = this.game.U, BL = TUNE.bladeLook, lk = (1 + F.line * (g - 1)) * BL.line * sk, rl = B.rimLine ?? B.line;
        const pf = U?.uSelfPartFill?.value?.[P], pi = U?.uSelfPartInk?.value?.[P], pr = U?.uSelfPartRim?.value?.[P];
        if (pf) {
          pf.x = (B.fillGain ?? 1) * g * BL.fill;
          pf.w = (B.farFill ?? 1) * BL.far;
        }
        if (pi) pi.w = B.line[3] * lk;
        if (pr) pr.w = rl[3] * lk;
      }
      // (after the write: the contact frame shows the full flare; game dt, so it holds through the freeze)
      this.bladeFlare = Math.max(0, this.bladeFlare - (Number.isFinite(dt) ? dt : 0) / F.fall);
    }
    // the violet gem breathes; burns brighter while charging and through heavy swings
    const heavyNow = st === 'charge' || flurrying || (plunging && this.pl.phase <= PL.RIDE) || (!!a && !!a.def?.heavy && (st === 'attack' || st === 'heavy'));
    const gemTarget = (heavyNow ? 1.6 : 0.8) + 0.25 * Math.sin(this.time * 2.1) + (st === 'charge' ? 0.8 * this.chargeK : 0);
    const gu = M.gem.uniforms;
    gu.uGlow.value = dt > 0 ? damp(gu.uGlow.value, gemTarget, 10, dt) : gemTarget;
    gu.uInkGlow.value = 0.45 + 0.4 * gu.uGlow.value; // saturated violet, not blown out to white
  }

  // ------------------------------------------------------------------ debug (Lab)
  _debugHeal() {
    if (!this.alive) return false;
    this.hp = this.maxHp;
    this.guard = this.maxGuard;
    this.guardWait = 0;
    this._clearBurn();
    return true;
  }

  _teleport(x, z) {
    x = Number(x);
    z = Number(z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const p = this.position;
    if (this.state === 'plunge' || this.state === 'flurry') {
      this.flurry.clear();
      this._toLoco(0.1); // a Lab teleport ends a plunge / a flurry on the ground
    }
    p.set(x, 0, z);
    this._collide();
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) p.set(x, 0, z);
    this.vel.x = this.vel.z = this.kb.x = this.kb.z = 0;
    this.want.x = this.want.z = 0;
    this.groundVel.x = this.groundVel.z = 0;
    this.sweep.valid = false;
    this.anim.teleported();
    this.game.world?.setPusher?.(0, p.x, 0, p.z, TUNE.pusher);
    return true;
  }

  _debugKill() {
    if (!this.alive) return false;
    this.hp = 0;
    this._die();
    return true;
  }

  _emit(name, data) {
    this.game.events?.emit(name, data);
  }
}
