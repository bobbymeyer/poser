// Sections and the arrangement. Pure functions; none of them mutate.
// A section is a definition; the arrangement is a row of instances that point at definitions.
// Instances of the same section are linked: they share everything except leads.

import { TONICS } from "../core/rails.js";
import { setBars, prune } from "./patternOps.js";

export const SECTION_TEMPLATES = [
  { name: "Intro", bars: 4 }, { name: "Verse", bars: 8 }, { name: "Chorus", bars: 8 }, { name: "Bridge", bars: 8 }, { name: "Outro", bars: 4 },
];

const touch = (song) => ({ ...song, updated_at: new Date().toISOString() });
const newId = (prefix, taken) => {
  let id;
  do id = `${prefix}_${Math.random().toString(36).slice(2, 8)}`; while (taken(id));
  return id;
};
const sectionKey = (song) => newId("s", (id) => !!song.sections[id]);
const instanceKey = (song) => newId("i", (id) => song.arrangement.some((a) => a.id === id));
const names = (song) => new Set(Object.values(song.sections).map((s) => s.name));
const stem = (name) => name.replace(/\s+\d+$/, "");

export const instanceCount = (song, sectionId) => song.arrangement.filter((a) => a.section === sectionId).length;

/** `name` if no section has it, otherwise the first free "Name 2", "Name 3"... */
export function freeName(song, name) {
  const taken = names(song);
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${stem(name)} ${n}`)) return `${stem(name)} ${n}`;
}

/** The name a bake of this section would get: "Chorus" -> "Chorus 2" -> "Chorus 3". */
export function bakeName(song, sectionId) {
  const taken = names(song), base = stem(song.sections[sectionId].name);
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/**
 * Add a new section after instance `index`, from a template `{ name, bars }`. It takes its
 * key, tempo and lane patterns from the section at `index` and starts with no chords.
 */
export function addSection(song, index, template) {
  const from = song.sections[song.arrangement[index].section];
  const id = sectionKey(song);
  const section = { ...structuredClone(from), name: freeName(song, template.name), chords: [] };
  let next = { ...song, sections: { ...song.sections, [id]: section } };
  next = setBars(next, id, template.bars);
  const arrangement = [...song.arrangement];
  arrangement.splice(index + 1, 0, { id: instanceKey(song), section: id, leads: {} });
  return touch({ ...next, arrangement });
}

/** Insert another instance of the section at `from`, at position `at`. It is linked; leads start empty. */
export function copyLinked(song, from, at = from + 1) {
  const arrangement = [...song.arrangement];
  arrangement.splice(at, 0, { id: instanceKey(song), section: song.arrangement[from].section, leads: {} });
  return touch({ ...song, arrangement });
}

/** Move the instance at `from` so that it ends up at index `to`. */
export function moveInstance(song, from, to) {
  if (from === to || to < 0 || to >= song.arrangement.length) return song;
  const arrangement = [...song.arrangement];
  arrangement.splice(to, 0, ...arrangement.splice(from, 1));
  return touch({ ...song, arrangement });
}

/**
 * Bake: deep-copy the section of instance `index` under a new ID and name, and repoint that
 * instance at the copy. The instance keeps its leads; the other instances stay on the original.
 */
export function bake(song, index) {
  const inst = song.arrangement[index], id = sectionKey(song);
  const section = { ...structuredClone(song.sections[inst.section]), name: bakeName(song, inst.section) };
  const arrangement = song.arrangement.map((a, i) => (i === index ? { ...a, section: id } : a));
  return touch({ ...song, sections: { ...song.sections, [id]: section }, arrangement });
}

/** Remove an instance. A section with no instances left is removed with it. The song keeps at least one. */
export function removeInstance(song, index) {
  if (song.arrangement.length < 2) return song;
  const gone = song.arrangement[index].section;
  const arrangement = song.arrangement.filter((_, i) => i !== index);
  let sections = song.sections;
  if (!arrangement.some((a) => a.section === gone)) { sections = { ...song.sections }; delete sections[gone]; }
  return prune(touch({ ...song, sections, arrangement }));
}

/**
 * One row per instance for the strip and the overview: counts, and what changed against the
 * instance before it (key lift in semitones, mode, tempo).
 */
export function describeArrangement(song) {
  const seen = new Map();
  return song.arrangement.map((inst, index) => {
    const s = song.sections[inst.section];
    const prev = index ? song.sections[song.arrangement[index - 1].section] : null;
    const ordinal = (seen.get(inst.section) || 0) + 1;
    seen.set(inst.section, ordinal);
    const lift = prev ? ((TONICS[s.tonic] - TONICS[prev.tonic] + 18) % 12) - 6 : 0;
    return {
      index, id: inst.id, sectionId: inst.section, name: s.name, bars: s.bars, tonic: s.tonic, mode: s.mode, bpm: s.bpm, meter: s.meter,
      ordinal, count: instanceCount(song, inst.section),
      lift, keyChanged: !!prev && (lift !== 0 || prev.mode !== s.mode), tempoChanged: !!prev && prev.bpm !== s.bpm,
    };
  });
}
