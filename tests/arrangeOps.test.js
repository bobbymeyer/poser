import { describe, it, expect } from "vitest";
import { newProject } from "../src/editor/template.js";
import { enter } from "../src/editor/chordOps.js";
import { editPattern, cycleHit, linkCount } from "../src/editor/patternOps.js";
import { addSection, copyLinked, moveInstance, bake, removeInstance, describeArrangement, bakeName, freeName, instanceCount, SECTION_TEMPLATES } from "../src/editor/arrangeOps.js";
import { validateSong } from "../src/core/validate.js";
import { resolveSong } from "../src/core/resolve.js";
import { exportMidi } from "../src/core/midi.js";

const BAR = 1920;
const T = Object.fromEntries(SECTION_TEMPLATES.map((t) => [t.name, t]));
const type = (song, sid, ids) => {
  let s = { chords: [], caret: 0 };
  for (const id of ids) s = enter(s.chords, song.sections[sid].bars * BAR, s.caret, id, 2 * BAR);
  return { ...song, sections: { ...song.sections, [sid]: { ...song.sections[sid], chords: s.chords } } };
};
const row = (song) => song.arrangement.map((a) => song.sections[a.section].name);
const sid = (song, i) => song.arrangement[i].section;

/** Verse, Chorus, Verse, then a baked and lifted Chorus: the phase 4 "done when". */
function build() {
  let song = type(newProject(), "s_1", ["I", "V", "VI", "IV"]);
  song = addSection(song, 0, T.Chorus);
  song = type(song, sid(song, 1), ["IV", "I", "V", "VI"]);
  song = copyLinked(song, 0, 2);
  song = copyLinked(song, 1, 3);
  song = bake(song, 3);
  const lifted = sid(song, 3);
  return { ...song, sections: { ...song.sections, [lifted]: { ...song.sections[lifted], tonic: "D", bpm: 124 } } };
}

describe("arrangement", () => {
  it("builds verse, chorus, verse, lifted chorus by baking", () => {
    const song = build();
    expect(row(song)).toEqual(["Verse", "Chorus", "Verse", "Chorus 2"]);
    expect(validateSong(song)).toMatchObject({ ok: true, errors: [] });
    expect(Object.keys(song.sections).length).toBe(3);
    const r = resolveSong(song);
    expect(r.instances.map((i) => [i.tick / BAR, i.bpm])).toEqual([[0, 112], [8, 112], [16, 112], [24, 124]]);
    const bassAt = (bar) => r.notes.find((n) => n.lane === "l_bass" && n.tick === bar * BAR).pitch % 12;
    expect([bassAt(0), bassAt(8), bassAt(16), bassAt(24)]).toEqual([0, 5, 0, 7]); // C, F, C, then G = IV of D
    expect(exportMidi(song, r).length).toBeGreaterThan(1000);
  });
  it("describes counts and what changed against the instance before", () => {
    const d = describeArrangement(build());
    expect(d.map((x) => [x.name, x.ordinal, x.count])).toEqual([["Verse", 1, 2], ["Chorus", 1, 1], ["Verse", 2, 2], ["Chorus 2", 1, 1]]);
    expect(d.map((x) => [x.keyChanged, x.tempoChanged, x.lift])).toEqual([[false, false, 0], [false, false, 0], [false, false, 0], [true, true, 2]]);
  });
  it("a new section takes key, tempo and patterns from its neighbour, with no chords", () => {
    let song = newProject();
    song.sections.s_1.tonic = "Eb"; song.sections.s_1.bpm = 96;
    song = addSection(song, 0, T.Intro);
    const intro = song.sections[sid(song, 1)];
    expect([intro.name, intro.bars, intro.tonic, intro.bpm, intro.chords]).toEqual(["Intro", 4, "Eb", 96, []]);
    expect(intro.clips.l_kit).toEqual([{ pattern: "pt_rock16", start: 0, len: 3 * BAR }, { pattern: "pt_fill1", start: 3 * BAR, len: BAR }]);
    expect(intro.clips.l_bass[0].len).toBe(4 * BAR);
    expect(linkCount(song, "pt_bass8")).toBe(2);
    expect(row(addSection(song, 1, T.Verse))).toEqual(["Verse", "Intro", "Verse 2"]);
  });
  it("linked instances share edits; a baked one does not", () => {
    let song = build();
    const verse = sid(song, 0);
    expect(sid(song, 2)).toBe(verse);
    song = type(song, verse, ["II"]);
    const r = resolveSong(song);
    const bass = (bar) => r.notes.find((n) => n.lane === "l_bass" && n.tick === bar * BAR).pitch % 12;
    expect([bass(0), bass(16)]).toEqual([2, 2]);
    expect(song.sections[sid(song, 1)].chords[0].chord).toBe("IV");
    expect(song.sections[sid(song, 3)].chords[0].chord).toBe("IV");
    expect(song.sections[sid(song, 3)]).not.toBe(song.sections[sid(song, 1)]);
  });
  it("bake keeps the instance's leads and leaves the others alone", () => {
    let song = copyLinked(newProject(), 0);
    song.arrangement[1].leads = { l_x: { notes: [{ start: 0, len: 480, deg: 1, acc: 0, oct: 0, vel: 90, pass: 1 }] } };
    const baked = bake(song, 1);
    expect(baked.arrangement[1].leads).toEqual(song.arrangement[1].leads);
    expect(baked.arrangement[0]).toBe(song.arrangement[0]);
    expect(row(baked)).toEqual(["Verse", "Verse 2"]);
    expect(row(bake(copyLinked(baked, 1), 2))).toEqual(["Verse", "Verse 2", "Verse 3"]);
  });
  it("patterns stay linked across a bake until edited apart", () => {
    const song = build();
    expect(linkCount(song, "pt_bass8")).toBe(3);
    const { song: edited, id } = editPattern(song, "pt_rock16", (p) => cycleHit(p, 3, 1));
    expect(linkCount(edited, id)).toBe(3);
  });
  it("moves and copies instances", () => {
    const song = build();
    expect(row(moveInstance(song, 3, 0))).toEqual(["Chorus 2", "Verse", "Chorus", "Verse"]);
    expect(row(moveInstance(song, 0, 2))).toEqual(["Chorus", "Verse", "Verse", "Chorus 2"]);
    expect(moveInstance(song, 1, 1)).toBe(song);
    const copy = copyLinked(song, 1, 0);
    expect(row(copy)).toEqual(["Chorus", "Verse", "Chorus", "Verse", "Chorus 2"]);
    expect(copy.arrangement[0].section).toBe(song.arrangement[1].section);
    expect(new Set(copy.arrangement.map((a) => a.id)).size).toBe(5);
  });
  it("removing the last instance of a section removes the section and its unused factory patterns", () => {
    let song = build();
    const chorus2 = sid(song, 3);
    song = removeInstance(song, 3);
    expect(song.sections[chorus2]).toBeUndefined();
    expect(row(song)).toEqual(["Verse", "Chorus", "Verse"]);
    song = removeInstance(song, 0);
    expect(Object.keys(song.sections).length).toBe(2);
    expect(instanceCount(song, sid(song, 1))).toBe(1);
    const one = removeInstance(removeInstance(song, 0), 0);
    expect(one.arrangement.length).toBe(1);
    expect(removeInstance(one, 0)).toBe(one);
    expect(validateSong(one).ok).toBe(true);
  });
  it("names", () => {
    const song = build();
    expect(bakeName(song, sid(song, 1))).toBe("Chorus 3");
    expect(bakeName(song, sid(song, 0))).toBe("Verse 2");
    expect(freeName(song, "Bridge")).toBe("Bridge");
    expect(freeName(song, "Chorus 2")).toBe("Chorus 3");
  });
});
