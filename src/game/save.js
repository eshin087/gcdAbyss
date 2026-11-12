// The save: what the player keeps between visits (ADR-054). One JSON record in localStorage under
// SAVE_KEY. Today it holds the techniques (which are learned, which are in the slots); later
// sections (settings, cleared bosses) join the same record. Every access is guarded: a browser
// without storage (private mode, blocked site data, the headless tests) keeps the save in memory
// for this page load and never throws.

export const SAVE_KEY = 'abyss.save.v1';
export const SAVE_VERSION = 1;

/** The storage to use: localStorage when the page may touch it, else null. */
function storage() {
  try {
    const s = globalThis.localStorage;
    return s && typeof s.getItem === 'function' && typeof s.setItem === 'function' ? s : null;
  } catch {
    return null; // reading the property itself throws when site data is blocked
  }
}

/** The stored record (a plain object; {} when there is none or it does not parse). */
export function loadSave() {
  const s = storage();
  if (!s) return {};
  try {
    const raw = s.getItem(SAVE_KEY);
    const o = raw ? JSON.parse(raw) : null;
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/**
 * Merge `patch` (top-level sections) into the stored record and write it. Returns true when it was
 * written to storage (false: no storage, quota, blocked; the caller keeps its state in memory).
 */
export function writeSave(patch) {
  const s = storage();
  if (!s || !patch || typeof patch !== 'object') return false;
  try {
    const rec = { ...loadSave(), ...patch, v: SAVE_VERSION };
    s.setItem(SAVE_KEY, JSON.stringify(rec));
    return true;
  } catch {
    return false;
  }
}
