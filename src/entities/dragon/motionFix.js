import { lookOf } from '../enemies/duelist/lookSwitch.js';

// The wyrm's motion audit fixes (2026-11-28; integ.mjs `wyrmmotion`, tests/integration/wyrmMotion.mjs): the
// owner asked for every unnatural motion the audit flagged to be fixed. One switch for all of them, read live
// (the Lab's `wyrmFix` row): `?wyrmFix=0` moves the wyrm as it did before the pass, for comparison.
export const fixOn = () => lookOf('wyrmFix', 'a') !== '0';
