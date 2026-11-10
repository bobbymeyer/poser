import { describe, it, expect } from "vitest";
import { enter, remove, split, moveBoundary, climb, invert, setOptions, normalize, defaultLength, sectionLength, visibleCount } from "../src/editor/chordOps.js";

const BAR = 1920, LEN = 8 * BAR;
const ids = (chords) => chords.map((c) => `${c.chord}@${c.start / BAR}+${c.len / BAR}`);
const type = (list, start = { chords: [], caret: 0 }, sticky = 2 * BAR) =>
  list.reduce((s, id) => enter(s.chords, LEN, s.caret, id, sticky), start);

describe("chord entry", () => {
  it("defaults to a quarter of the section, at least one bar", () => {
    expect(defaultLength({ bars: 8, meter: "4/4" })).toBe(2 * BAR);
    expect(defaultLength({ bars: 6, meter: "4/4" })).toBe(BAR);
    expect(defaultLength({ bars: 2, meter: "4/4" })).toBe(BAR);
    expect(sectionLength({ bars: 4, meter: "3/4" })).toBe(4 * 1440);
  });
  it("types 1-5-6-4 into four tiled blocks", () => {
    const s = type(["I", "V", "VI", "IV"]);
    expect(ids(s.chords)).toEqual(["I@0+2", "V@2+2", "VI@4+2", "IV@6+2"]);
    expect(s.caret).toBe(4);
  });
  it("does nothing when the section is full, and cuts the last block to fit", () => {
    const full = type(["I", "V", "VI", "IV"]);
    expect(enter(full.chords, LEN, 4, "II", 2 * BAR)).toEqual(full);
    const s = type(["I", "V", "VI"], undefined, 3 * BAR);
    expect(ids(s.chords)).toEqual(["I@0+3", "V@3+3", "VI@6+2"]);
  });
  it("typing mid-row replaces the block at the caret and resets its options", () => {
    const s = type(["I", "V", "VI", "IV"]);
    const withExt = setOptions(s.chords, 1, { ext: 7 });
    const r = enter(withExt, LEN, 1, "II", 2 * BAR);
    expect(ids(r.chords)).toEqual(["I@0+2", "II@2+2", "VI@4+2", "IV@6+2"]);
    expect(r.chords[1].ext).toBeUndefined();
    expect(r.caret).toBe(2);
  });
  it("delete: the previous block grows to fill the space", () => {
    const s = type(["I", "V", "VI", "IV"]);
    expect(ids(remove(s.chords, 2).chords)).toEqual(["I@0+4", "VI@4+2", "IV@6+2"]);
    expect(remove(s.chords, 2).caret).toBe(1);
    expect(ids(remove(s.chords, 4).chords)).toEqual(["I@0+2", "V@2+2", "VI@4+2"]);
    expect(ids(remove(s.chords, 1).chords)).toEqual(["V@0+4", "VI@4+2", "IV@6+2"]);
    expect(remove(s.chords, 0)).toEqual({ chords: s.chords, caret: 0 });
  });
  it("split halves the active block and leaves the caret between the halves", () => {
    const s = type(["I", "V"]);
    const r = split(s.chords, 1);
    expect(ids(r.chords)).toEqual(["I@0+1", "I@1+1", "V@2+2"]);
    expect(r.caret).toBe(1);
    expect(ids(enter(r.chords, LEN, 1, "IV", 2 * BAR).chords)).toEqual(["I@0+1", "IV@1+1", "V@2+2"]);
    const tiny = [{ start: 0, len: 240, chord: "I" }];
    expect(split(tiny, 1).chords).toBe(tiny);
  });
  it("dragging an edge moves the shared boundary and sets the sticky length", () => {
    const s = type(["I", "V", "VI", "IV"]);
    const r = moveBoundary(s.chords, LEN, 0, 3 * BAR + 100);
    expect(ids(r.chords)).toEqual(["I@0+3", "V@3+1", "VI@4+2", "IV@6+2"]);
    expect(r.sticky).toBe(3 * BAR);
    expect(ids(moveBoundary(s.chords, LEN, 0, 99 * BAR).chords)[1]).toBe("V@3.75+0.25"); // neighbour keeps a beat
    expect(ids(moveBoundary(s.chords, LEN, 1, 0).chords)[1]).toBe("V@2+0.25");
    const two = type(["I", "V"]);
    expect(ids(moveBoundary(two.chords, LEN, 1, 99 * BAR).chords)).toEqual(["I@0+2", "V@2+6"]); // last edge stops at the end
    expect(ids(enter(two.chords, LEN, 2, "IV", moveBoundary(two.chords, LEN, 0, BAR).sticky).chords).at(-1)).toBe("IV@4+1");
  });
  it("ladder and inversion respect their limits", () => {
    const ctx = { tonic: "C", mode: "ionian" };
    let c = type(["V", "III"]).chords;
    c = climb(c, 0, 1, ctx); expect(c[0].ext).toBe(7);
    c = climb(c, 0, 1, ctx); expect(c[0].ext).toBe(9);
    c = climb(c, 0, 1, ctx); expect(c[0].ext).toBe(9);
    c = climb(climb(c, 1, 1, ctx), 1, 1, ctx); expect(c[1].ext).toBe(7); // iii tops out at 7
    c = climb(climb(climb(c, 0, -1, ctx), 0, -1, ctx), 0, -1, ctx); expect("ext" in c[0]).toBe(false);
    c = invert(invert(invert(c, 0, 1), 0, 1), 0, 1); expect(c[0].inv).toBe(2);
    c = invert(invert(invert(c, 0, -1), 0, -1), 0, -1); expect("inv" in c[0]).toBe(false);
    const rest = [{ start: 0, len: BAR, chord: "rest" }];
    expect(climb(rest, 0, 1, ctx)).toBe(rest);
  });
  it("normalize closes gaps and overlaps", () => {
    const messy = [{ start: 2 * BAR, len: 2 * BAR, chord: "V" }, { start: 0, len: BAR, chord: "I" }, { start: 3 * BAR, len: 2 * BAR, chord: "IV" }];
    expect(ids(normalize(messy))).toEqual(["I@0+1", "V@1+3", "IV@4+1"]);
    expect(visibleCount(normalize(messy), 4 * BAR)).toBe(2);
  });
});

