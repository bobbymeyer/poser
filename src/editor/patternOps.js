// Pattern lane editing. Pure functions; none of them mutate.
// Phase 3 layout: each lane holds one pattern across the section, and the kit may play a
// second pattern (the fill) on the last bar.

import { METERS, GRIDS } from "../core/rails.js";
import { FACTORY_BY_ID, DEFAULT_PADS } from "../factory/patterns.js";

const barOf = (x) => METERS[x.meter].barTicks;
const newId = (song) => {
  let id;
  do id = `pt_${Math.random().toString(36).slice(2, 8)}`; while (song.patterns[id] || FACTORY_BY_ID[id]);
  return id;
};
const touch = (song) => ({ ...song, updated_at: new Date().toISOString() });

/** How many clips, in any section, play this pattern. */
export const linkCount = (song, id) =>
  Object.values(song.sections).reduce((n, s) => n + Object.values(s.clips).flat().filter((c) => c.pattern === id).length, 0);

/** The lane's main and fill pattern IDs in a section. */
export function lanePatterns(section, laneId) {
  const clips = [...(section.clips[laneId] || [])].sort((a, b) => a.start - b.start);
  const main = clips[0]?.pattern ?? null, last = clips.at(-1);
  return { main, fill: clips.length > 1 && last.pattern !== main ? last.pattern : null };
}

function layout(section, main, fill) {
  const bar = barOf(section), len = section.bars * bar;
  if (!main) return [];
  if (fill && section.bars >= 2) return [{ pattern: main, start: 0, len: len - bar }, { pattern: fill, start: len - bar, len: bar }];
  return [{ pattern: main, start: 0, len }];
}

function withClips(song, sectionId, laneId, main, fill) {
  const section = song.sections[sectionId];
  const clips = { ...section.clips, [laneId]: layout(section, main, fill) };
  if (!clips[laneId].length) delete clips[laneId];
  return prune(touch({ ...song, sections: { ...song.sections, [sectionId]: { ...section, clips } } }));
}

/** Drop untouched factory copies that no clip uses any more. Edited patterns are kept. */
function prune(song) {
  const patterns = { ...song.patterns };
  for (const id of Object.keys(patterns)) if (FACTORY_BY_ID[id] && !linkCount(song, id)) delete patterns[id];
  return { ...song, patterns };
}

/** Put a pattern on a lane. `entry` is `{ id, pattern }`; it is copied into the song if new. */
export function setLanePattern(song, sectionId, laneId, entry, slot = "main") {
  const patterns = song.patterns[entry.id] ? song.patterns : { ...song.patterns, [entry.id]: entry.pattern };
  const cur = lanePatterns(song.sections[sectionId], laneId);
  const next = { ...cur, [slot]: entry.id };
  return withClips({ ...song, patterns }, sectionId, laneId, next.main, next.fill);
}

/** Turn the last-bar fill on (with a pattern entry) or off (null). */
export function setFill(song, sectionId, laneId, entry) {
  if (entry) return setLanePattern(song, sectionId, laneId, entry, "fill");
  return withClips(song, sectionId, laneId, lanePatterns(song.sections[sectionId], laneId).main, null);
}

/** Change the bar count and lay every lane's clips out again for the new length. */
export function setBars(song, sectionId, bars) {
  const before = song.sections[sectionId];
  let next = { ...song, sections: { ...song.sections, [sectionId]: { ...before, bars } } };
  for (const laneId of Object.keys(before.clips)) {
    const { main, fill } = lanePatterns(before, laneId);
    next = withClips(next, sectionId, laneId, main, fill);
  }
  return next;
}

/**
 * Edit a pattern with `fn`. Every clip that uses it changes. A factory pattern is first
 * moved to a new ID, so a song never holds an altered pattern under a factory ID.
 * @returns `{ song, id }` with the pattern's (possibly new) ID.
 */
export function editPattern(song, id, fn) {
  const edited = fn(song.patterns[id]);
  if (edited === song.patterns[id]) return { song, id };
  if (!FACTORY_BY_ID[id]) return { song: touch({ ...song, patterns: { ...song.patterns, [id]: edited } }), id };
  const fresh = newId(song);
  const { [id]: _, ...rest } = song.patterns;
  const sections = Object.fromEntries(Object.entries(song.sections).map(([sid, s]) => [sid, {
    ...s,
    clips: Object.fromEntries(Object.entries(s.clips).map(([lane, list]) =>
      [lane, list.map((c) => (c.pattern === id ? { ...c, pattern: fresh } : c))])),
  }]));
  return { song: touch({ ...song, patterns: { ...rest, [fresh]: edited }, sections }), id: fresh };
}

/** Clone the lane's pattern under a new ID and point only this lane's clip at it. */
export function makeUnique(song, sectionId, laneId, slot = "main") {
  const id = lanePatterns(song.sections[sectionId], laneId)[slot];
  if (!id) return song;
  const entry = { id: newId(song), pattern: structuredClone(song.patterns[id]) };
  return setLanePattern(song, sectionId, laneId, entry, slot);
}

/** A blank pattern entry for a lane. */
export function blankPattern(song, lane) {
  const kit = lane.role === "kit";
  return { id: newId(song), pattern: {
    kind: kit ? "drum" : "pitched", role: lane.role, name: "New pattern", meter: "4/4", bars: 1, grid: kit ? "1/16" : "1/8", loop: "bar",
    ...(kit ? { hits: [] } : { steps: [] }),
  } };
}

/** Songs made before phase 3 have no kit lane; give them an empty one. */
export function ensureKit(song) {
  if (song.lanes.some((l) => l.role === "kit")) return song;
  const sf = song.soundfonts[0]?.hash ?? "";
  return { ...song, lanes: [{
    id: "l_kit", role: "kit", name: "Kit", instrument: { backend: "soundfont", sf, program: 0, drums: true },
    zones: ["zxc", "vbn"], volume: 100, pan: 64, mute: false, solo: false, latency_ms: 0,
    swing: "straight", pads: DEFAULT_PADS, choke: [[3, 4]],
  }, ...song.lanes] };
}

export const stepCount = (pattern) => (pattern.bars * barOf(pattern)) / GRIDS[pattern.grid];

// ---- drum patterns

/** Click a cell: off, normal, accent, ghost, off. */
export function cycleHit(pattern, step, pad) {
  const NEXT = { n: "a", a: "g", g: null };
  const hit = pattern.hits.find((h) => h.step === step && h.pad === pad);
  const others = pattern.hits.filter((h) => h !== hit);
  const lv = hit ? NEXT[hit.lv] : "n";
  return { ...pattern, hits: lv ? [...others, { step, pad, lv }] : others };
}

export function clearHit(pattern, step, pad) {
  const hits = pattern.hits.filter((h) => !(h.step === step && h.pad === pad));
  return hits.length === pattern.hits.length ? pattern : { ...pattern, hits };
}

// ---- pitched patterns, edited as a flat list of `{ step, tone, len, vel, oct }`

export const notesOf = (pattern) =>
  pattern.steps.flatMap((s) => s.tones.map((tone) => ({ step: s.step, tone, len: s.len, vel: s.vel, oct: s.oct || 0 })));

function withNotes(pattern, notes) {
  const groups = new Map();
  for (const n of [...notes].sort((a, b) => a.step - b.step || a.tone - b.tone)) {
    const key = `${n.step}|${n.len}|${n.vel}|${n.oct}`;
    if (!groups.has(key)) groups.set(key, { step: n.step, tones: [], len: n.len, vel: n.vel, ...(n.oct ? { oct: n.oct } : {}) });
    groups.get(key).tones.push(n.tone);
  }
  return { ...pattern, steps: [...groups.values()] };
}

const covers = (n, step, tone) => n.tone === tone && n.step <= step && step < n.step + n.len;

/** Click a cell: remove the note lying over it, or add a one-step note. */
export function toggleNote(pattern, step, tone, vel = 88) {
  const notes = notesOf(pattern);
  const hit = notes.find((n) => covers(n, step, tone));
  return withNotes(pattern, hit ? notes.filter((n) => n !== hit) : [...notes, { step, tone, len: 1, vel, oct: 0 }]);
}

/** Stretch the note that starts at (step, tone). Stops at the next note on the row and at the end. */
export function setNoteLen(pattern, step, tone, len) {
  const notes = notesOf(pattern);
  const note = notes.find((n) => n.step === step && n.tone === tone);
  if (!note) return pattern;
  const next = Math.min(stepCount(pattern), ...notes.filter((n) => n.tone === tone && n.step > step).map((n) => n.step));
  const clamped = Math.max(1, Math.min(len, next - step));
  if (clamped === note.len) return pattern;
  return withNotes(pattern, notes.map((n) => (n === note ? { ...n, len: clamped } : n)));
}

// ---- both kinds

/** Change the grid, keeping every hit at (or just before) its place in time. */
export function setGrid(pattern, grid) {
  if (grid === pattern.grid) return pattern;
  const from = GRIDS[pattern.grid], to = GRIDS[grid];
  const move = (step) => Math.floor((step * from) / to);
  if (pattern.kind === "drum") {
    const seen = new Set();
    const hits = pattern.hits.map((h) => ({ ...h, step: move(h.step) }))
      .filter((h) => !seen.has(`${h.step}|${h.pad}`) && seen.add(`${h.step}|${h.pad}`));
    return { ...pattern, grid, hits };
  }
  const seen = new Set();
  const notes = notesOf(pattern).map((n) => ({ ...n, step: move(n.step), len: Math.max(1, Math.round((n.len * from) / to)) }))
    .filter((n) => !seen.has(`${n.step}|${n.tone}`) && seen.add(`${n.step}|${n.tone}`));
  return withNotes({ ...pattern, grid }, notes);
}

/** Change the pattern length in bars. Content past the new end is dropped. */
export function setPatternBars(pattern, bars) {
  if (bars === pattern.bars) return pattern;
  const next = { ...pattern, bars }, steps = stepCount(next);
  if (pattern.kind === "drum") return { ...next, hits: pattern.hits.filter((h) => h.step < steps) };
  return withNotes(next, notesOf(pattern).filter((n) => n.step < steps).map((n) => ({ ...n, len: Math.min(n.len, steps - n.step) })));
}

/** Patch one lane (mute, solo, swing...). */
export function setLane(song, laneId, patch) {
  return touch({ ...song, lanes: song.lanes.map((l) => (l.id === laneId ? { ...l, ...patch } : l)) });
}

/** Put a library entry on a lane, taking the swing preset a groove asks for with it. */
export function applyEntry(song, sectionId, lane, entry, slot = "main") {
  const next = setLanePattern(song, sectionId, lane.id, entry, slot);
  return entry.swing && slot === "main" && lane.role === "kit" ? setLane(next, lane.id, { swing: entry.swing }) : next;
}

/** Library entries a lane can play: factory first, then patterns already edited in this song. */
export function libraryFor(song, lane, slot = "main") {
  const kit = lane.role === "kit";
  const roles = kit ? ["kit"] : lane.role === "bass" ? ["bass"] : ["pad", "arp", "comp"];
  const fits = (p) => (p.kind === "drum") === kit && (!p.role || roles.includes(p.role));
  const factory = Object.values(FACTORY_BY_ID).filter((f) => fits(f.pattern) && !!f.fill === (slot === "fill"));
  const mine = Object.entries(song.patterns).filter(([id, p]) => !FACTORY_BY_ID[id] && fits(p))
    .map(([id, pattern]) => ({ id, pattern, tag: "in this song" }));
  return { factory, mine };
}
