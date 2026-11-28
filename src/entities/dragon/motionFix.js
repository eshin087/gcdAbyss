import { lookOf } from '../enemies/duelist/lookSwitch.js';

// The wyrm's motion audit fixes (2026-11-28; integ.mjs `wyrmmotion`, tests/integration/wyrmMotion.mjs): the
// owner asked for every unnatural motion the audit flagged to be fixed. One switch for all of them, read live
// (the Lab's `wyrmFix` row): `?wyrmFix=0` moves the wyrm as it did before the pass, for comparison.
// (headless: GCD_NOFIX=1 runs a suite with the fixes off, for a before / after)
const NOFIX = !!globalThis.process?.env?.GCD_NOFIX;
export const fixOn = () => !NOFIX && lookOf('wyrmFix', 'a') !== '0';
