// Run statistics for the victory record. A "run" starts at the title (or an [R] restart);
// fight time is the duration of the final (winning) attempt only.

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const clock = (s) => {
  s = Math.max(0, Math.floor(finite(s)));
  const m = Math.floor(s / 60);
  return `${m < 10 ? '0' : ''}${m}:${s % 60 < 10 ? '0' : ''}${s % 60}`;
};

export class RunStats {
  constructor() {
    this.reset();
  }

  reset() {
    this.attemptTime = 0;
    this.totalTime = 0;
    this.deaths = 0;
    this.flasksUsed = 0;
    this.damageTaken = 0;
    this.damageDealt = 0;
    this.hits = 0;
    this.dodges = 0;
    this.parries = 0;
    this.perfectDodges = 0;
    this.blocks = 0;
    this.guardBreaks = 0;
  }

  snapshot() {
    return {
      fightTime: this.attemptTime,
      totalTime: this.totalTime,
      deaths: this.deaths,
      flasksUsed: this.flasksUsed,
      damageTaken: Math.round(this.damageTaken),
      damageDealt: Math.round(this.damageDealt),
      hits: this.hits,
      dodges: this.dodges,
      parries: this.parries,
      perfectDodges: this.perfectDodges,
      blocks: this.blocks,
      guardBreaks: this.guardBreaks,
    };
  }

  rows() {
    return [
      ['Fight time', clock(this.attemptTime)],
      ['Total time', clock(this.totalTime)],
      ['Deaths', String(this.deaths)],
      ['Flasks used', String(this.flasksUsed)],
      ['Damage taken', String(Math.round(this.damageTaken))],
      ['Damage dealt', String(Math.round(this.damageDealt))],
      ['Hits landed', String(this.hits)],
      ['Parries', String(this.parries)],
      ['Ghosteps (perfect dodges)', String(this.perfectDodges)],
      ['Blocks', String(this.blocks)],
      ['Dodges', String(this.dodges)],
    ];
  }
}
