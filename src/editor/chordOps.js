// Chord lane editing. Pure functions over a section's `chords` array; none of them mutate.
// Chords tile the lane from tick 0 with no gaps and no overlaps. The caret sits between
// blocks: typing writes at the caret, and the block before the caret is the active one.

import { METERS, PPQ } from "../core/rails.js";
import { resolveChord } from "../core/theory.js";

export const BEAT = PPQ;
const MIN_SPLIT = PPQ / 2;

export const sectionLength = (section) => section.bars * METERS[section.meter].barTicks;

/** Length of the next typed chord: the section divided by 4, at least one bar. */
export const defaultLength = (section) => Math.max(1, Math.floor(section.bars / 4)) * METERS[section.meter].barTicks;

/** Sort and close any gaps or overlaps, so the rest of the editor can rely on tiling. */
export function normalize(chords) {
  const out = [];
  for (const c of [...chords].sort((a, b) => a.start - b.start)) {
    const prev = out.at(-1);
    const start = prev ? prev.start + prev.len : 0;
    const end = Math.max(c.start + c.len, start + 1);
    out.push({ ...c, start, len: end - start });
  }
  return out;
}

/** How many chords start inside the section. The rest are kept but inactive. */
export const visibleCount = (chords, len) => chords.filter((c) => c.start < len).length;

/** Type a chord ID at the caret: replace the block there, or append one of `sticky` length. */
export function enter(chords, len, caret, id, sticky) {
  const n = visibleCount(chords, len);
  if (caret < n) {
    const next = [...chords];
    next[caret] = { start: chords[caret].start, len: chords[caret].len, chord: id };
    return { chords: next, caret: caret + 1 };
  }
  const start = chords.length ? chords.at(-1).start + chords.at(-1).len : 0;
  if (start >= len) return { chords, caret };
  return { chords: [...chords, { start, len: Math.min(sticky, len - start), chord: id }], caret: caret + 1 };
}

/** Delete the block before the caret. Its neighbour grows to fill the space. */
export function remove(chords, caret) {
  const i = caret - 1;
  if (i < 0 || i >= chords.length) return { chords, caret };
  const gone = chords[i], next = chords.filter((_, k) => k !== i);
  if (i < next.length) {
    if (i > 0) next[i - 1] = { ...next[i - 1], len: next[i - 1].len + gone.len };
    else next[0] = { ...next[0], start: 0, len: next[0].len + gone.len };
  }
  return { chords: next, caret: i };
}

/** Split the block before the caret in half. The caret lands between the halves. */
export function split(chords, caret) {
  const i = caret - 1, c = chords[i];
  if (!c || c.len / 2 < MIN_SPLIT || c.len % 2) return { chords, caret };
  const half = c.len / 2, next = [...chords];
  next.splice(i, 1, { ...c, len: half }, { ...c, start: c.start + half, len: half });
  return { chords: next, caret };
}

/**
 * Drag the right edge of block `i` to `tick`. The edge is shared with the next block, so
 * one grows as the other shrinks. Snaps to the beat. Returns the new sticky length.
 */
export function moveBoundary(chords, len, i, tick) {
  const c = chords[i], after = chords[i + 1];
  if (!c) return { chords, sticky: null };
  const max = after ? after.start + after.len - BEAT : len;
  const edge = Math.max(c.start + BEAT, Math.min(max, Math.round(tick / BEAT) * BEAT));
  if (edge === c.start + c.len) return { chords, sticky: c.len };
  const next = [...chords];
  next[i] = { ...c, len: edge - c.start };
  if (after) next[i + 1] = { ...after, start: edge, len: after.start + after.len - edge };
  return { chords: next, sticky: edge - c.start };
}

/** Set or clear options on block `i`. Falsy values remove the field. */
export function setOptions(chords, i, patch) {
  if (!chords[i]) return chords;
  const c = { ...chords[i] };
  for (const [k, v] of Object.entries(patch)) { if (v) c[k] = v; else delete c[k]; }
  const next = [...chords];
  next[i] = c;
  return next;
}

/** Climb (+1) or descend (-1) the extension ladder on block `i`: triad, 7, 9. */
export function climb(chords, i, dir, context) {
  const c = chords[i];
  if (!c || c.chord === "rest") return chords;
  const { ext, maxExt } = resolveChord(c, context);
  const want = Math.max(5, Math.min(maxExt, ext + 2 * dir));
  return setOptions(chords, i, { ext: want === 5 ? 0 : want });
}

/** Step the inversion of block `i` up or down, between root position and second inversion. */
export function invert(chords, i, dir) {
  const c = chords[i];
  if (!c || c.chord === "rest") return chords;
  return setOptions(chords, i, { inv: Math.max(0, Math.min(2, (c.inv || 0) + dir)) });
}
