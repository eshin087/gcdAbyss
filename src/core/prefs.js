// Player preferences that outlive the page (the pause menu's choices). localStorage can be missing,
// full or throw (private windows, blocked site data, the headless tests): every read falls back to
// the default and every write is best-effort.

const PREFIX = 'abyss.';

/** The stored boolean `key`, or `fallback` when there is none (or storage is unavailable). */
export function loadFlag(key, fallback) {
  try {
    const v = globalThis.localStorage?.getItem(PREFIX + key);
    return v === '1' ? true : v === '0' ? false : fallback;
  } catch {
    return fallback;
  }
}

/** Store boolean `key` (silently does nothing when storage is unavailable). */
export function saveFlag(key, value) {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, value ? '1' : '0');
  } catch {
    /* best-effort */
  }
}
