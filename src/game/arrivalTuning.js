// THE ARRIVAL's numbers (arrival.js): the shot each level opens with as the player enters it from the
// title. One block per level id; a level without one gets DEFAULT.
//
//   look {x, z}    where the shot looks as it opens (ground metres): north of the spawn by as much as keeps
//                  the hero in the frame's lower third (he can move during the hold), the arena filling the
//                  rest (the camera always looks north: what lies north of this point fills the frame)
//   end {x, z}     where it has drifted to when the hold is over: a slow drift (~7 m) back toward the
//                  hero; the release then carries the camera the rest of the way and settles behind him
//   zoom           m added to the camera's distance (36 at the desktop's default zoom; the title is +8)
//   weight         0..1: how far the camera's focus goes from the hero to the shot (1 = all the way)
//   hold           s the shot holds before it lets go (real time; a pause holds it too)
//   inLambda       how fast the camera eases from the title's framing into the shot
//   outLambda      how fast it settles behind the hero when the hold is over
//   skipLambda     ... and when the player moved, attacked or dodged first (a quicker ease, never a snap)
//   front          a gust front sent across the level as the shot opens (wind.front's options; null:
//                  none), `delay` s after the shot opens
//   mobile         the phone: its camera is closer and its extra zoom is capped (cameraRig
//                  mobileMaxExtraZoom 3), so it leans further toward the shot instead of pulling out

const DEFAULT = Object.freeze({
  look: { x: 0, z: 0 },
  end: { x: 0, z: 10 },
  zoom: 14,
  weight: 1,
  hold: 3,
  inLambda: 2.4,
  outLambda: 1.2,
  skipLambda: 2.2,
  front: { strength: 1, speed: 9, width: 12, delay: 0.3 },
  mobile: { zoom: 3, weight: 1 },
});

const level = (o) => Object.freeze({ ...DEFAULT, ...o });

export const ARRIVAL_TUNING = Object.freeze({
  DEFAULT,
  // the moonlit clearing: the stone circle, the flagstones and the sleeping wyrm beyond, the tree wall
  // round it all; a night breeze crosses the meadow as the shot opens
  cinderwood: level({ look: { x: 0.8, z: 11.8 }, end: { x: 0.7, z: 14.8 }, zoom: 26 }),
  // the burned sect: the courtyard through its gate, the kneeling disciple in the middle; the ash moves
  ash: level({ look: { x: 0.4, z: 22.3 }, end: { x: 0.5, z: 25.3 }, zoom: 26, front: { strength: 1.1, speed: 11, width: 10, delay: 0.3 } }),
  // the crater: the seal, the throne and the fallen star; nothing moves but a slow draw toward the star
  starless: level({ look: { x: 0.4, z: 16.3 }, end: { x: 0.5, z: 19.3 }, zoom: 26, front: { strength: 0.5, speed: 5, width: 16, delay: 0.5, dirX: 0, dirZ: -1 } }),
  // the ring on the badlands at dusk: the plateau wind runs west to east across it
  ring: level({ look: { x: 0.4, z: 19.3 }, end: { x: 0.5, z: 22.3 }, zoom: 26, front: { strength: 1.2, speed: 12, width: 12, delay: 0.3, dirX: 1, dirZ: 0 } }),
  // the hill shrine: the round paving, the lanterns, the great fox and the spirit gate either side
  fox: level({ look: { x: 0.4, z: 20.3 }, end: { x: 0.5, z: 23.3 }, zoom: 26, front: { strength: 0.8, speed: 7, width: 14, delay: 0.5 } }),
  // the Windless Grove: no wind, ever. The shot is closer and longer: the grove holds its breath
  grove: level({ look: { x: 0.4, z: 12.8 }, end: { x: 0.5, z: 15.3 }, zoom: 17, hold: 3.4, front: null }),
  // the Veiled Crossing: the shot opens on the fallen tower lying across the north and the scramble's
  // bars, then drifts back down the avenue to the man standing in the middle of it, hands in his
  // pockets; a cold breath of air down the street (east to west)
  veil: level({ look: { x: 0, z: 1 }, end: { x: 0.3, z: 7 }, zoom: 26, hold: 3.4, front: { strength: 0.6, speed: 6, width: 14, delay: 0.5, dirX: -1, dirZ: 0 } }),
  // the Last Foundry (core's stand-in): the shot opens on the pour and the kneeling man at its edge, then
  // drifts back down the casting floor; furnace air drawn north toward the pour
  foundry: level({ look: { x: 0, z: -12 }, end: { x: 0.3, z: -4 }, zoom: 26, hold: 3.4, front: { strength: 0.5, speed: 5, width: 14, delay: 0.5, dirX: 0, dirZ: -1 } }),
});

export const arrivalTuning = (id) => ARRIVAL_TUNING[id] ?? ARRIVAL_TUNING.DEFAULT;
