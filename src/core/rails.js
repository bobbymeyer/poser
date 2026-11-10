// The closed rails: every ID a song file may use. Files store these IDs, never raw values.
// Growing a list means bumping RAILS_VERSION; old files stay valid.

export const FORMAT_VERSION = 2;
export const RAILS_VERSION = 1;
export const PPQ = 480;

export const TONICS = {
  C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, "F#": 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11,
};

// Semitones above the tonic for scale degrees 1-7. Ordered bright to dark.
export const MODES = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

export const METERS = {
  "4/4": { num: 4, den: 4, barTicks: 1920 },
  "3/4": { num: 3, den: 4, barTicks: 1440 },
  "6/8": { num: 6, den: 8, barTicks: 1440 },
};

export const GRIDS = { "1/4": 480, "1/8": 240, "1/16": 120, "1/16t": 80, "1/32": 60 };

// Fraction of each pair of swing units taken by the first one.
export const SWINGS = { straight: 0.5, light: 0.54, medium: 0.58, shuffle: 2 / 3 };

export const DRUM_VELOCITY = { g: 45, n: 96, a: 120 };

export const DEGREES = ["I", "II", "III", "IV", "V", "VI", "VII"];
export const BORROWED = ["bIII", "bVI", "bVII", "iv", "V/V", "V/vi"];
export const ROLES = ["kit", "bass", "pad", "arp", "comp", "lead"];
export const MONO_PRIORITIES = ["last", "lowest", "highest"];
export const SUS = ["sus2", "sus4"];
