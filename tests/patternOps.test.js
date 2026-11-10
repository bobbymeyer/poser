import { describe, it, expect } from "vitest";
import { FACTORY, FACTORY_BY_ID } from "../src/factory/patterns.js";
import { newProject } from "../src/editor/template.js";
import { enter, setOptions } from "../src/editor/chordOps.js";
import {
  setLanePattern, setFill, setBars, editPattern, makeUnique, blankPattern, ensureKit, lanePatterns, linkCount, stepCount,
  cycleHit, clearHit, notesOf, toggleNote, setNoteLen, setGrid, setPatternBars,
} from "../src/editor/patternOps.js";
import { validateSong } from "../src/core/validate.js";
import { resolveSong } from "../src/core/resolve.js";
import { songSchema } from "../src/core/schema.js";
import Ajv from "ajv";

const BAR = 1920;
const withChords = (song, ids = ["I", "V", "VI", "IV"]) => {
  let s = { chords: [], caret: 0 };
  for (const id of ids) s = enter(s.chords, 8 * BAR, s.caret, id, 2 * BAR);
  song.sections.s_1.chords = s.chords;
  return song;
};

describe("factory patterns", () => {
  const validate = new Ajv().compile({ ...songSchema.properties.patterns.additionalProperties });
  it("has about ten, and every one is a valid pattern", () => {
    expect(FACTORY.length).toBeGreaterThanOrEqual(10);
    for (const f of FACTORY) {
      expect(validate(f.pattern), `${f.id} ${JSON.stringify(validate.errors)}`).toBe(true);
      const steps = stepCount(f.pattern);
      for (const h of f.pattern.hits || []) expect(h.step).toBeLessThan(steps);
      for (const s of f.pattern.steps || []) expect(s.step + s.len).toBeLessThanOrEqual(steps);
    }
    expect(new Set(FACTORY.map((f) => f.id)).size).toBe(FACTORY.length);
  });
  it("covers the grooves named in the mockup, each with a kick on the downbeat", () => {
    for (const id of ["pt_rock16", "pt_four", "pt_boombap", "pt_halftime", "pt_shuffle"])
      expect(FACTORY_BY_ID[id].pattern.hits.some((h) => h.step === 0 && h.pad === 1)).toBe(true);
  });
});

describe("new project", () => {
  it("is valid and plays a full groove once chords are typed", () => {
    const song = withChords(newProject());
    song.sections.s_1.chords = setOptions(song.sections.s_1.chords, 3, { ext: 7 });
    expect(validateSong(song)).toMatchObject({ ok: true, errors: [] });
    const r = resolveSong(song);
    const count = (lane) => r.notes.filter((n) => n.lane === lane).length;
    expect(count("l_kit")).toBeGreaterThan(80);
    expect(count("l_bass")).toBe(48);
    expect(count("l_pad")).toBe(32);
    expect(r.notes.filter((n) => n.lane === "l_kit" && n.tick >= 7 * BAR).some((n) => n.pitch === 45)).toBe(true); // fill toms
    const pad = (tick) => new Set(r.notes.filter((n) => n.lane === "l_pad" && n.tick === tick).map((n) => n.pitch % 12));
    expect(pad(0)).toEqual(new Set([0, 4, 7]));
    expect(pad(6 * BAR)).toEqual(new Set([5, 9, 0, 4])); // IV7: the fourth tone is the seventh
  });
  it("a shuffle groove swings the 8ths of every lane, fill included", () => {
    let song = withChords(newProject());
    song = setLanePattern(song, "s_1", "l_kit", FACTORY_BY_ID.pt_shuffle);
    song.lanes[0].swing = "shuffle";
    const r = resolveSong(song);
    const ticks = (lane, from, to) => [...new Set(r.notes.filter((n) => n.lane === lane && n.tick >= from && n.tick < to).map((n) => n.tick - from))];
    expect(ticks("l_kit", 0, 480)).toEqual([0, 320]);
    expect(ticks("l_bass", 0, 960)).toEqual([0, 480, 800]);
    expect(ticks("l_kit", 7 * BAR, 7 * BAR + 480)).toEqual([0, 320]); // fill hats on 16ths 0 and 2 ride the same warp
  });
});

describe("lane patterns", () => {
  it("sets the main pattern, keeps the fill, and prunes unused factory copies", () => {
    const song = setLanePattern(newProject(), "s_1", "l_kit", FACTORY_BY_ID.pt_four);
    expect(song.sections.s_1.clips.l_kit).toEqual([{ pattern: "pt_four", start: 0, len: 7 * BAR }, { pattern: "pt_fill1", start: 7 * BAR, len: BAR }]);
    expect(song.patterns.pt_four).toEqual(FACTORY_BY_ID.pt_four.pattern);
    expect(song.patterns.pt_rock16).toBeUndefined();
    expect(validateSong(song).ok).toBe(true);
  });
  it("turns the fill off and on", () => {
    const off = setFill(newProject(), "s_1", "l_kit", null);
    expect(off.sections.s_1.clips.l_kit).toEqual([{ pattern: "pt_rock16", start: 0, len: 8 * BAR }]);
    expect(off.patterns.pt_fill1).toBeUndefined();
    const on = setFill(off, "s_1", "l_kit", FACTORY_BY_ID.pt_fill1);
    expect(lanePatterns(on.sections.s_1, "l_kit")).toEqual({ main: "pt_rock16", fill: "pt_fill1" });
  });
  it("re-lays clips when the bar count changes", () => {
    const song = setBars(newProject(), "s_1", 4);
    expect(song.sections.s_1.clips.l_kit[1]).toEqual({ pattern: "pt_fill1", start: 3 * BAR, len: BAR });
    expect(song.sections.s_1.clips.l_bass).toEqual([{ pattern: "pt_bass8", start: 0, len: 4 * BAR }]);
    expect(setBars(song, "s_1", 1).sections.s_1.clips.l_kit).toEqual([{ pattern: "pt_rock16", start: 0, len: BAR }]);
  });
  it("editing a factory pattern moves it to a new ID and repoints every clip", () => {
    const base = newProject();
    const { song, id } = editPattern(base, "pt_rock16", (p) => cycleHit(p, 3, 1));
    expect(id).not.toBe("pt_rock16");
    expect(song.patterns.pt_rock16).toBeUndefined();
    expect(song.sections.s_1.clips.l_kit[0].pattern).toBe(id);
    expect(song.patterns[id].name).toBe("Rock 16");
    expect(base.patterns.pt_rock16).toEqual(FACTORY_BY_ID.pt_rock16.pattern);
    const again = editPattern(song, id, (p) => cycleHit(p, 5, 1));
    expect(again.id).toBe(id);
    expect(validateSong(again.song).ok).toBe(true);
    expect(editPattern(song, id, (p) => p).song).toBe(song);
  });
  it("make unique clones the pattern for one lane", () => {
    const song = newProject();
    song.sections.s_2 = structuredClone(song.sections.s_1);
    expect(linkCount(song, "pt_bass8")).toBe(2);
    const next = makeUnique(song, "s_2", "l_bass");
    const id = next.sections.s_2.clips.l_bass[0].pattern;
    expect(id).not.toBe("pt_bass8");
    expect(next.patterns[id]).toEqual(song.patterns.pt_bass8);
    expect(linkCount(next, "pt_bass8")).toBe(1);
  });
  it("gives older songs an empty kit lane and can start a blank pattern", () => {
    const old = newProject();
    old.lanes = old.lanes.filter((l) => l.role !== "kit");
    delete old.sections.s_1.clips.l_kit;
    const song = ensureKit(old);
    expect(song.lanes[0].role).toBe("kit");
    expect(ensureKit(song)).toBe(song);
    const withBlank = setLanePattern(song, "s_1", "l_kit", blankPattern(song, song.lanes[0]));
    expect(validateSong(withBlank)).toMatchObject({ ok: true, errors: [] });
  });
});

describe("drum grid", () => {
  const p = FACTORY_BY_ID.pt_rock16.pattern;
  const lv = (pat, step, pad) => pat.hits.find((h) => h.step === step && h.pad === pad)?.lv ?? null;
  it("cycles off, normal, accent, ghost, off", () => {
    let q = cycleHit(p, 1, 5); expect(lv(q, 1, 5)).toBe("n");
    q = cycleHit(q, 1, 5); expect(lv(q, 1, 5)).toBe("a");
    q = cycleHit(q, 1, 5); expect(lv(q, 1, 5)).toBe("g");
    q = cycleHit(q, 1, 5); expect(lv(q, 1, 5)).toBe(null);
    expect(q.hits.length).toBe(p.hits.length);
  });
  it("right-click clears", () => {
    expect(lv(clearHit(p, 0, 1), 0, 1)).toBe(null);
    expect(clearHit(p, 1, 1)).toBe(p);
  });
  it("changing the grid keeps hits in place", () => {
    const t = setGrid(p, "1/32");
    expect(stepCount(t)).toBe(32);
    expect(lv(t, 8, 2)).toBe("n");
    expect(setGrid(t, "1/16")).toEqual({ ...p, hits: t.hits.map((h) => ({ ...h, step: h.step / 2 })) });
    const coarse = setGrid(p, "1/8");
    expect(coarse.hits.filter((h) => h.pad === 2).map((h) => h.step)).toEqual([2, 6, 7]);
    expect(setGrid(p, "1/16")).toBe(p);
  });
});

describe("step editor", () => {
  const p = FACTORY_BY_ID.pt_bass8.pattern;
  it("flattens steps to notes and back without loss", () => {
    const arp = FACTORY_BY_ID.pt_bass_r5o.pattern;
    expect(notesOf(arp).filter((n) => n.oct === 1).map((n) => n.step)).toEqual([3, 7]);
    expect(notesOf(toggleNote(toggleNote(arp, 5, 2), 5, 2))).toEqual(notesOf(arp));
  });
  it("adds a note, and removes the note under a click", () => {
    const added = toggleNote(p, 5, 2, 112);
    expect(notesOf(added)).toContainEqual({ step: 5, tone: 2, len: 1, vel: 112, oct: 0 });
    expect(notesOf(toggleNote(p, 1, 1)).some((n) => n.step === 0 && n.tone === 1)).toBe(false); // step 1 is under the long note at 0
  });
  it("groups chord tones that share a step", () => {
    const chord = toggleNote(toggleNote({ ...p, steps: [] }, 0, 1), 0, 3);
    expect(chord.steps).toEqual([{ step: 0, tones: [1, 3], len: 1, vel: 88 }]);
  });
  it("stretches a note up to the next one on its row, or the end", () => {
    expect(notesOf(setNoteLen(p, 0, 1, 99)).find((n) => n.step === 0).len).toBe(2); // next root is at step 2
    expect(notesOf(setNoteLen(p, 7, 2, 99)).find((n) => n.step === 7).len).toBe(1);
    expect(notesOf(setNoteLen(p, 3, 3, 3)).find((n) => n.step === 3).len).toBe(3);
    expect(setNoteLen(p, 5, 5, 2)).toBe(p);
  });
  it("changes grid and length", () => {
    const fine = setGrid(p, "1/16");
    expect(notesOf(fine).map((n) => [n.step, n.len])).toEqual([[0, 4], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]]);
    const two = setPatternBars(p, 2);
    expect(stepCount(two)).toBe(16);
    expect(setPatternBars(toggleNote(two, 12, 1), 1).steps).toEqual(p.steps);
  });
});
