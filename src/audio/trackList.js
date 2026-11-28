// The recorded background music (CC0, OpenGameArt; ADR-117). Content is data: each level's exploring
// track and one track per boss phase (the Cinder Wyrm 3, the Ash Disciple 2, the Starless Lord 4),
// plus the shared victory and death. Files are built by scripts/audio/build-music.py into
// assets/audio/music/; assets/audio/CREDITS.md names every source. The owner picks the tracks on an
// audition page; a level or phase missing here plays the synthesised score (music.js).
//
// file, gain (linear, on the music bus), loop, loopFrom (s: where a loop restarts, after an intro),
// xfade (s: the overlap when a track loops into itself; a track mastered as a seamless loop: a few ms)

export const TRACK_ROOT = 'assets/audio/';

// The tracks are loudness-normalised (fights -18 LUFS, exploring -21); LEVEL lifts them to about the
// synth score's level on the music bus (measured: recorded music at gain 1 played ~6 dB under it).
const LEVEL = 2;
const T = (file, { gain = 1, loop = true, loopFrom = 0, xfade = 2.5 } = {}) => ({
  file: `music/${file}.mp3`,
  gain: gain * LEVEL,
  loop,
  loopFrom,
  xfade,
});

// The owner's picks on the score audition page (2026-11-15). Short loops written to repeat get a tight
// seam; longer pieces overlap their end with their start.
export const SCORE = {
  levels: {
    cinderwood: {
      explore: T('cinder-explore', { xfade: 3 }), // Creepy Forest (F), HaelDB
      phases: [
        T('cinder-p1'), // Dark Intro, Nikke
        T('cinder-p2', { xfade: 0.1 }), // Inside the Overlords Domain, KarateStudios (a loop)
        T('cinder-p3', { xfade: 3 }), // Ancient Grudge, Ruskerdax
      ],
    },
    ash: {
      explore: T('ash-explore', { xfade: 3 }), // Ambience of a Fallen Age: Ruins of an Ancient Culture, Umplix
      phases: [
        T('ash-p1', { xfade: 0.1 }), // Hunted by the Evil, Umplix (a loop)
        T('ash-p2', { loopFrom: 14.8 }), // Boss_Koto, G_P (the koto intro plays once)
      ],
    },
    starless: {
      explore: T('starless-explore', { xfade: 3 }), // Ambience of a Fallen Age: The Abyss, Umplix
      phases: [
        T('starless-p1', { xfade: 3 }), // Zodik - Deep Choir, Zodik
        T('starless-p2', { xfade: 1.5 }), // Dramatic Boss Encounter, cynicmusic
        T('starless-p3', { xfade: 0.5 }), // Final Stand (phase 3), Centurion_of_war
        T('starless-p4'), // Fall of Nightmares, nene
      ],
    },
    // The Skybreak Ring has no tracks of its own yet: it borrows these until the owner picks its
    // score on an audition page (one track per form).
    ring: {
      explore: T('ash-explore', { xfade: 3 }),
      phases: [
        T('starless-p2', { xfade: 1.5 }),
        T('starless-p3', { xfade: 0.5 }),
        T('cinder-p3', { xfade: 3 }),
      ],
    },
    // The Foxfire Terrace borrows too (ADR-147) until the owner auditions a score of its own.
    fox: {
      explore: T('cinder-explore', { xfade: 3 }),
      phases: [
        T('ash-p2', { loopFrom: 14.8 }),
        T('cinder-p2', { xfade: 0.1 }),
        T('starless-p3', { xfade: 0.5 }),
      ],
    },
    // The Windless Grove borrows too, until the owner picks its score (one track per phase).
    grove: {
      explore: T('cinder-explore', { xfade: 3 }),
      phases: [
        T('starless-p1', { xfade: 3 }),
        T('ash-p2', { loopFrom: 14.8 }),
        T('starless-p3', { xfade: 0.5 }),
      ],
    },
    // The Hall of Falling Script borrows too, until the owner picks its score (one track per phase: the
    // Sparring Hall, the Pillared Hall's guns, the Source).
    code: {
      explore: T('starless-explore', { xfade: 3 }),
      phases: [
        T('ash-p1', { xfade: 0.1 }),
        T('starless-p2', { xfade: 1.5 }),
        T('starless-p4'),
      ],
    },
    // Halcyon Plaza borrows the Obsidian Throne's score (ADR-159) until the owner picks its own by ear.
    city: {
      explore: T('starless-explore', { xfade: 3 }),
      phases: [
        T('starless-p2', { xfade: 1.5 }),
        T('starless-p3', { xfade: 0.5 }),
        T('starless-p4'),
      ],
    },
    // The Veiled Crossing borrows the Obsidian Throne's and the Skybreak Ring's scores until the owner
    // picks its own by ear (core's stand-in, wave 0)
    veil: {
      explore: T('starless-explore', { xfade: 3 }),
      phases: [
        T('starless-p2', { xfade: 1.5 }),
        T('starless-p3', { xfade: 0.5 }),
        T('starless-p4'),
      ],
    },
    // The Last Foundry borrows the Obsidian Throne's score (four phases: its last track twice) until the
    // owner picks its own by ear (core's stand-in, wave 0)
    foundry: {
      explore: T('starless-explore', { xfade: 3 }),
      phases: [
        T('starless-p2', { xfade: 1.5 }),
        T('starless-p3', { xfade: 0.5 }),
        T('starless-p4'),
        T('starless-p4'),
      ],
    },
  },
  victory: T('victory', { loop: false }), // Victory Fanfare Short, cynicmusic
  death: T('death', { loop: false }), // Death of a Ninja (Game Over), Joth
};

/** Every file the game may fetch (tests check they all exist). */
export function allTrackFiles() {
  const out = new Set();
  const add = (t) => t && out.add(t.file);
  for (const L of Object.values(SCORE.levels)) {
    add(L.explore);
    for (const p of L.phases) add(p);
  }
  add(SCORE.victory);
  add(SCORE.death);
  return [...out];
}

