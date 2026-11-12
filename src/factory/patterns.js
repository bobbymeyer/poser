// The factory library: patterns, chord progressions and ready-made sections, all 4/4.
// It lives in `library.json`, in the same shape the app's "Export library" writes, so content
// authored in the app can replace that file.
//
// A pattern entry is `{ id, tag, swing?, fill?, pattern }`: `pattern` is exactly what gets copied
// into a song file, `swing` is the kit preset a groove asks for, `fill` marks a last-bar fill.
// A progression is `{ id, name, tag, bars, chords }`; a section is `{ id, name, tag, section, patterns }`.

import library from "./library.json";

// Pads: 1 kick, 2 snare, 3 closed hat, 4 open hat, 5 clap, 6 crash, 7 rim, 8 low tom, 9 high tom, 10 ride.
export const PAD_NAMES = ["Kick", "Snare", "Closed hat", "Open hat", "Clap", "Crash", "Rim", "Low tom", "High tom", "Ride"];
export const DEFAULT_PADS = [36, 38, 42, 46, 39, 49, 37, 45, 50, 51];

export const LIBRARY_VERSION = library.library_version;
export const FACTORY = library.patterns;
export const FACTORY_BY_ID = Object.fromEntries(FACTORY.map((f) => [f.id, f]));
export const FACTORY_PROGRESSIONS = library.progressions;
export const FACTORY_SECTIONS = library.sections;
