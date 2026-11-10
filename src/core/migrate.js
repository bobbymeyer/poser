// Format migrations. Each entry takes a song at that format_version and returns it one version on.
// `migrate` runs them in order, so a file from any older build opens in this one.

import { FORMAT_VERSION, DEGREES } from "./rails.js";

const MIGRATIONS = {
  // 1 -> 2: degree chord IDs are stored in upper case, as the spec always said (version 1 files in
  // the wild hold "vi"). Lower-case "iv" was the borrowed minor iv and stays as it is.
  1(song) {
    const fix = (id) => (id !== "iv" && DEGREES.includes(String(id).toUpperCase()) ? String(id).toUpperCase() : id);
    const sections = Object.fromEntries(Object.entries(song.sections || {}).map(([sid, s]) =>
      [sid, { ...s, chords: (s.chords || []).map((c) => ({ ...c, chord: fix(c.chord) })) }]));
    return { ...song, sections, format_version: 2 };
  },
};

/** @returns `{ song, from }` where `from` is the version the file arrived in. Never mutates. */
export function migrate(song) {
  const from = song.format_version;
  let cur = song;
  while (cur.format_version < FORMAT_VERSION) {
    const step = MIGRATIONS[cur.format_version];
    if (!step) throw new Error(`No migration from format ${cur.format_version}`);
    cur = step(cur);
  }
  return { song: cur, from };
}
