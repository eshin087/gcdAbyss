import { CONFIG } from '../core/config.js';
import { CINDERWOOD } from './cinderwood.js';
import { ASHFALL } from './ashfall.js';
import { STARLESS } from './starless.js';
import { SKYBREAK } from './skybreak.js';
import { WINDLESS } from './grove.js';
import { FOXFIRE } from './foxfire.js';
import { SCRIPTHALL } from './scripthall.js';
import { HALCYON } from './halcyon.js';
import { VEIL } from './veil.js';
import { FOUNDRY_LEVEL } from './foundry.js';
import { createTrainingRoom, ROOM_WORLD } from '../world/trainingRoom.js';

// Levels (docs/specs/ash-disciple.md §1, ARCHITECTURE.md → Levels). One level is built per page
// load; `?level=<id>` picks it and switching level reloads the page, so nothing is ever torn down.
// A level definition:
//   id, aliases        URL ids (`?level=ash`)
//   name, sub          the area banner (and the title screen's picker)
//   world              overrides merged into CONFIG.world at boot, before any module is built
//   buildSet(U, colliders)  the static environment (world.js; createForest's shape)
//   createBoss(game)   the boss that fills the boss slot (game.dragon === game.boss)
//   text               the flow's lines: arrive[], stir, phase2, phase3, victory, fallen, restReset,
//                      phase4, again, rise (GameFlow falls back to Cinderwood's)

export const LEVELS = Object.freeze([CINDERWOOD, ASHFALL, STARLESS, SKYBREAK, FOXFIRE, WINDLESS, SCRIPTHALL, HALCYON, VEIL, FOUNDRY_LEVEL]);
export const DEFAULT_LEVEL = CINDERWOOD;

/** The level with this id or alias (case-insensitive), or null. */
export function getLevel(id) {
  if (typeof id !== 'string' || !id) return null;
  const k = id.trim().toLowerCase();
  return LEVELS.find((L) => L.id === k || L.aliases?.includes(k)) ?? null;
}

/** The level a URL query string asks for (`?level=ash`); the default when absent or unknown. */
export function levelFromSearch(search) {
  let id = null;
  try {
    id = new URLSearchParams(search ?? '').get('level');
  } catch {
    id = null;
  }
  return getLevel(id) ?? DEFAULT_LEVEL;
}

/**
 * The level on the training room instead of its own set (`?stage=lab`; ADR-099): the same boss, the lab stage's floor and layout (world/trainingRoom.js). Any other URL
 * returns `level` unchanged.
 */
export function withStage(level, search) {
  let q = null;
  try {
    q = new URLSearchParams(search ?? '');
  } catch {
    q = null;
  }
  if (!level || q?.get('stage') !== 'lab') return level;
  return Object.freeze({
    ...level,
    name: 'Training Room',
    sub: `${level.name} · lab stage`,
    stage: 'lab',
    world: ROOM_WORLD,
    buildSet: createTrainingRoom,
  });
}

/** Merge the level's world overrides into CONFIG.world (call once, before building any module). */
export function applyLevel(level) {
  const W = level?.world;
  if (!W) return;
  for (const [k, v] of Object.entries(W)) CONFIG.world[k] = v && typeof v === 'object' ? { ...v } : v;
}

/** `href` with `?level=<id>` set (the other query parameters, e.g. `?lab`, are kept; `?rush` is not:
 *  a level's own page is never a boss rush page, game/rush.js rushUrl). */
export function levelUrl(id, href) {
  const u = new URL(href);
  u.searchParams.delete('rush');
  if (id === DEFAULT_LEVEL.id) u.searchParams.delete('level');
  else u.searchParams.set('level', id);
  return u.toString();
}
