// The library: progressions, ready-made sections and saved patterns. Pure functions.
// Entries a user saves get "lib_" IDs and are treated like factory ones: a song never holds an
// altered copy under a library ID, so the library always hands out what was saved.

import { METERS } from "../core/rails.js";
import { LIBRARY_VERSION, FACTORY, FACTORY_PROGRESSIONS, FACTORY_SECTIONS } from "../factory/patterns.js";
import { freeName } from "./arrangeOps.js";

const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
const touch = (song) => ({ ...song, updated_at: new Date().toISOString() });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lengthOf = (section) => section.bars * METERS[section.meter].barTicks;

/** A progression laid across a section: repeated to fill it, cut at the end. */
export function tileProgression(prog, section) {
  const len = lengthOf(section), span = prog.bars * METERS[section.meter].barTicks, out = [];
  for (let t = 0; t < len; t += span) {
    for (const c of prog.chords) {
      if (t + c.start >= len) break;
      out.push({ ...c, start: t + c.start, len: Math.min(c.len, len - t - c.start) });
    }
  }
  return out;
}

/** The chords of a section as a library progression. */
export function progressionFrom(section, name) {
  const len = lengthOf(section), bar = METERS[section.meter].barTicks;
  const chords = section.chords.filter((c) => c.start < len).map((c) => ({ ...c, len: Math.min(c.len, len - c.start) }));
  const end = chords.length ? chords.at(-1).start + chords.at(-1).len : 0;
  return { id: uid("lib"), name, tag: "your library", bars: Math.max(1, Math.ceil(end / bar)), chords };
}

/** A pattern of the song as a library entry. */
export const patternEntry = (song, patternId) =>
  ({ id: uid("lib"), tag: "your library", pattern: structuredClone(song.patterns[patternId]) });

/** A section of the song, with the patterns it plays, as a library entry. */
export function sectionEntry(song, sectionId) {
  const section = structuredClone(song.sections[sectionId]);
  const used = [...new Set(Object.values(section.clips).flat().map((c) => c.pattern))];
  return { id: uid("lib"), name: section.name, tag: "your library", section, patterns: Object.fromEntries(used.map((p) => [p, structuredClone(song.patterns[p])])) };
}

/**
 * Add a library section after instance `index`. Its patterns come with it; one whose ID the song
 * already uses for something different is brought in under a new ID. Clips for lanes the song
 * does not have are left out.
 */
export function addLibrarySection(song, index, entry) {
  const patterns = { ...song.patterns }, rename = new Map();
  for (const [id, pattern] of Object.entries(entry.patterns)) {
    if (!patterns[id]) patterns[id] = structuredClone(pattern);
    else if (!same(patterns[id], pattern)) {
      let fresh;
      do fresh = uid("pt"); while (patterns[fresh]);
      patterns[fresh] = structuredClone(pattern);
      rename.set(id, fresh);
    }
  }
  const lanes = new Set(song.lanes.map((l) => l.id));
  const clips = Object.fromEntries(Object.entries(entry.section.clips).filter(([lane]) => lanes.has(lane))
    .map(([lane, list]) => [lane, list.map((c) => ({ ...c, pattern: rename.get(c.pattern) ?? c.pattern }))]));
  let sid;
  do sid = uid("s"); while (song.sections[sid]);
  const section = { ...structuredClone(entry.section), name: freeName(song, entry.section.name), clips };
  const arrangement = [...song.arrangement];
  arrangement.splice(index + 1, 0, { id: uid("i"), section: sid, leads: {} });
  // Drop any pattern that came along only for a lane this song lacks.
  const used = new Set([...Object.values(song.sections), section].flatMap((s) => Object.values(s.clips).flat().map((c) => c.pattern)));
  for (const id of Object.keys(entry.patterns)) if (!used.has(rename.get(id) ?? id) && !song.patterns[id]) delete patterns[rename.get(id) ?? id];
  return touch({ ...song, patterns, sections: { ...song.sections, [sid]: section }, arrangement });
}

/** Factory and user entries together, in the shape of `src/factory/library.json`. */
export function exportLibrary(user) {
  const strip = ({ tag, ...rest }) => ({ ...rest, tag: tag === "your library" ? "" : tag });
  return {
    library_version: LIBRARY_VERSION,
    patterns: [...FACTORY, ...user.patterns.map(strip)],
    progressions: [...FACTORY_PROGRESSIONS, ...user.progressions.map(strip)],
    sections: [...FACTORY_SECTIONS, ...user.sections.map(strip)],
  };
}
