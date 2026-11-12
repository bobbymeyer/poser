import { describe, it, expect } from "vitest";
import { newProject } from "../src/editor/template.js";
import { enter } from "../src/editor/chordOps.js";
import { notesOf } from "../src/editor/patternOps.js";
import { copyLinked } from "../src/editor/arrangeOps.js";
import {
  ZONES, keyMap, claimZone, releaseZone, ensureLead, leadKey, pitchToLead, nextPass, deleteLeadPass, deleteLeadNote, applyTake, emptyTake, takeIsEmpty, snapToScale, addLeadNote, updateLeadNote,
  editLead, leadSpan, shiftLeadNote, moveOp, stretchOp, reverseOp, quantizeOp, velocityOp, deleteOp, copyLead, pasteOp, invertOp, scaleTimeOp,
} from "../src/editor/liveOps.js";
import { leadPitch } from "../src/core/theory.js";
import { MODES, TONICS } from "../src/core/rails.js";
import { validateSong } from "../src/core/validate.js";
import { resolveSong, laneVoicings, resolveChords } from "../src/core/resolve.js";

const BAR = 1920;
const take = (patch) => ({ ...emptyTake(), ...patch });
const lead = (start, deg, extra = {}) => ({ laneId: "l_lead1", start, len: 200, deg, acc: 0, oct: 0, vel: 96, ...extra });

describe("zones", () => {
  it("lists twelve three-key zones on the four rows", () => {
    expect(ZONES).toEqual(["123", "456", "789", "qwe", "rty", "uio", "asd", "fgh", "jkl", "zxc", "vbn", "m,."]);
  });
  it("maps keys to lanes in the default layout", () => {
    const map = keyMap(newProject());
    expect(map.get("KeyZ")).toEqual({ laneId: "l_kit", index: 0 });
    expect(map.get("KeyN")).toEqual({ laneId: "l_kit", index: 5 });
    expect(map.get("KeyS")).toEqual({ laneId: "l_bass", index: 1 });
    expect(map.get("KeyE")).toEqual({ laneId: "l_pad", index: 2 });
    expect(map.get("KeyL")).toEqual({ laneId: "l_lead1", index: 5 });
    expect(map.has("Digit1")).toBe(false);
  });
  it("last assignment wins and the other lane is released", () => {
    const { song, released } = claimZone(newProject(), "l_pad", "asd");
    expect(released).toBe("Bass");
    expect(song.lanes.find((l) => l.id === "l_bass").zones).toEqual([]);
    expect(keyMap(song).get("KeyA")).toEqual({ laneId: "l_pad", index: 3 });
    expect(claimZone(song, "l_pad", "asd").released).toBe(null);
    expect(keyMap(releaseZone(song, "l_pad", "asd")).has("KeyA")).toBe(false);
    expect(validateSong(song).ok).toBe(true);
    const kit3 = claimZone(newProject(), "l_kit", "m,.").song;
    expect(keyMap(kit3).get("Period")).toEqual({ laneId: "l_kit", index: 8 });
  });
  it("gives older songs a lead lane without stealing zones", () => {
    const old = newProject();
    old.lanes = old.lanes.filter((l) => l.role !== "lead");
    old.lanes[1].zones = ["fgh"];
    const song = ensureLead(old);
    expect(song.lanes.at(-1)).toMatchObject({ id: "l_lead1", role: "lead", zones: ["jkl"] });
    expect(ensureLead(song)).toBe(song);
    expect(validateSong(song)).toMatchObject({ ok: true, errors: [] });
  });
});

describe("lead keys", () => {
  it("six keys are six scale degrees; the window slides and wraps the octave", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => leadKey(i).deg)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(leadKey(5, { window: 2 })).toEqual({ deg: 1, acc: 0, oct: 1 });
    expect(leadKey(0, { window: -1 })).toEqual({ deg: 7, acc: 0, oct: -1 });
    expect(leadKey(2, { octave: 1, sharp: true })).toEqual({ deg: 3, acc: 1, oct: 1 });
  });
  it("turns any MIDI pitch into a lead note that plays the same pitch", () => {
    for (const tonic of Object.keys(TONICS)) for (const mode of Object.keys(MODES)) for (let p = 40; p < 100; p++) {
      const n = pitchToLead(p, { tonic, mode }, [60, 84]);
      expect(n.deg >= 1 && n.deg <= 7 && (n.acc === 0 || n.acc === 1)).toBe(true);
      expect(leadPitch(n, { tonic, mode }, [60, 84])).toBe(p);
    }
    expect(pitchToLead(61, { tonic: "C", mode: "ionian" }, [60, 84])).toEqual({ deg: 1, acc: 1, oct: 0 });
  });
});

describe("applying a take", () => {
  const base = () => {
    const song = newProject();
    let s = { chords: [], caret: 0 };
    for (const id of ["I", "V", "VI", "IV"]) s = enter(s.chords, 8 * BAR, s.caret, id, 2 * BAR);
    song.sections.s_1.chords = s.chords;
    return song;
  };
  it("records leads as a new pass, snapped to the grid", () => {
    let song = applyTake(base(), 0, take({ leads: [lead(10, 5), lead(495, 6), lead(8 * BAR - 20, 1)] }));
    const notes = song.arrangement[0].leads.l_lead1.notes;
    expect(notes.map((n) => [n.start, n.deg, n.pass])).toEqual([[0, 5, 1], [480, 6, 1], [0, 1, 1]]); // the late one lands on the downbeat
    expect(validateSong(song)).toMatchObject({ ok: true, errors: [] });
    song = applyTake(song, 0, take({ leads: [lead(960, 3)] }), { quant: 0 });
    expect(song.arrangement[0].leads.l_lead1.notes.at(-1)).toMatchObject({ start: 960, pass: 2 });
    expect(nextPass(song, 0, "l_lead1")).toBe(3);
    expect(resolveSong(song).notes.filter((n) => n.lane === "l_lead1").length).toBeGreaterThan(0);
  });
  it("deletes a bad pass and a single note", () => {
    let song = applyTake(base(), 0, take({ leads: [lead(0, 5), lead(480, 6)] }));
    song = applyTake(song, 0, take({ leads: [lead(0, 2), lead(240, 4)] }));
    const without = deleteLeadPass(song, 0, "l_lead1", 2);
    expect(without.arrangement[0].leads.l_lead1.notes.map((n) => n.deg)).toEqual([5, 6]);
    expect(deleteLeadNote(without, 0, "l_lead1", 0).arrangement[0].leads.l_lead1.notes.map((n) => n.deg)).toEqual([6]);
    expect(deleteLeadPass(without, 0, "l_lead1", 1).arrangement[0].leads).toEqual({});
  });
  it("keeps leads on their own instance", () => {
    const song = applyTake(copyLinked(base(), 0), 1, take({ leads: [lead(0, 5)] }));
    expect(song.arrangement[0].leads).toEqual({});
    expect(song.arrangement[1].leads.l_lead1.notes.length).toBe(1);
  });
  it("a drum hit replaces that pad on that step and leaves the rest", () => {
    const song = applyTake(base(), 0, take({ hits: [{ laneId: "l_kit", tick: BAR + 3 * 120 + 40, pad: 5, lv: "a" }, { laneId: "l_kit", tick: 0, pad: 1, lv: "g" }] }));
    const id = song.sections.s_1.clips.l_kit[0].pattern;
    expect(id).not.toBe("pt_rock16"); // a factory groove becomes a copy
    const hits = song.patterns[id].hits;
    expect(hits).toContainEqual({ step: 3, pad: 5, lv: "a" });
    expect(hits.filter((h) => h.step === 0 && h.pad === 1)).toEqual([{ step: 0, pad: 1, lv: "g" }]);
    expect(hits.some((h) => h.pad === 2)).toBe(true);
    expect(validateSong(song).ok).toBe(true);
  });
  it("hits in the last bar go into the fill, and a hit near the bar line wraps to step 0", () => {
    const song = applyTake(base(), 0, take({ hits: [{ laneId: "l_kit", tick: 7 * BAR + 480, pad: 6, lv: "n" }, { laneId: "l_kit", tick: 2 * BAR - 30, pad: 6, lv: "n" }] }));
    const [main, fill] = song.sections.s_1.clips.l_kit.map((c) => song.patterns[c.pattern]);
    expect(fill.hits).toContainEqual({ step: 4, pad: 6, lv: "n" });
    expect(main.hits).toContainEqual({ step: 0, pad: 6, lv: "n" });
  });
  it("erases one pad, or everything", () => {
    const one = applyTake(base(), 0, take({ erase: [{ laneId: "l_kit", tick: 0, pad: 3 }] }));
    const p = one.patterns[one.sections.s_1.clips.l_kit[0].pattern];
    expect(p.hits.some((h) => h.pad === 3)).toBe(false);
    expect(p.hits.some((h) => h.pad === 1)).toBe(true);
    const all = applyTake(base(), 0, take({ erase: [{ laneId: "l_kit", tick: 0, pad: null }] }));
    expect(all.patterns[all.sections.s_1.clips.l_kit[0].pattern].hits).toEqual([]);
  });
  it("a played step replaces what was on that step; a chord lands as one step", () => {
    const song = applyTake(base(), 0, take({ steps: [
      { laneId: "l_bass", tick: 3 * BAR + 240 + 20, tone: 3, len: 470, vel: 100 },
      { laneId: "l_pad", tick: 480, tone: 1, len: 900, vel: 90 }, { laneId: "l_pad", tick: 500, tone: 3, len: 900, vel: 90 },
    ] }));
    const bass = notesOf(song.patterns[song.sections.s_1.clips.l_bass[0].pattern]);
    expect(bass.filter((n) => n.step === 1)).toEqual([{ step: 1, tone: 3, len: 2, vel: 100, oct: 0 }]);
    expect(bass.find((n) => n.step === 3).tone).toBe(3); // untouched steps stay
    const pad = song.patterns[song.sections.s_1.clips.l_pad[0].pattern];
    expect(pad.steps).toContainEqual({ step: 1, tones: [1, 3], len: 2, vel: 90 });
    expect(validateSong(song)).toMatchObject({ ok: true, errors: [] });
  });
  it("an empty take is recognised", () => {
    expect(takeIsEmpty(emptyTake())).toBe(true);
    expect(takeIsEmpty(take({ leads: [lead(0, 1)] }))).toBe(false);
  });
  it("lane voicings line up with the resolver", () => {
    const song = base(), section = song.sections.s_1, bass = song.lanes[1];
    const v = laneVoicings(resolveChords(song, section), bass);
    expect(v.map((x) => x[0])).toEqual([36, 31, 33, 29]);
  });
});

describe("editing lead notes by hand", () => {
  const C = { tonic: "C", mode: "ionian" }, REG = [60, 84];
  const note = (pitch, start, len = 240) => ({ start, len, ...pitchToLead(pitch, C, REG), vel: 100 });
  const pitches = (song) => song.arrangement[0].leads.l_lead1.notes.map((n) => [n.start, n.len, leadPitch(n, C, REG), n.pass]);
  it("snaps a pitch to the scale, lower on a tie", () => {
    expect([60, 61, 62, 63, 66, 70, 71].map((p) => snapToScale(p, C))).toEqual([60, 60, 62, 62, 65, 69, 71]);
    expect(snapToScale(61, { tonic: "D", mode: "aeolian" })).toBe(60);
    for (let p = 40; p < 90; p++) expect(pitchToLead(snapToScale(p, { tonic: "F#", mode: "locrian" }), { tonic: "F#", mode: "locrian" }, REG).acc).toBe(0);
  });
  it("draws into an empty lane as pass 1, and into the newest pass after recording", () => {
    let r = addLeadNote(newProject(), 0, "l_lead1", note(67, 0));
    expect(r.index).toBe(0);
    expect(pitches(r.song)).toEqual([[0, 240, 67, 1]]);
    let song = applyTake(r.song, 0, { ...emptyTake(), leads: [{ laneId: "l_lead1", start: 480, len: 200, deg: 1, acc: 0, oct: 0, vel: 96 }] });
    r = addLeadNote(song, 0, "l_lead1", note(73, 960));
    expect(r.index).toBe(2);
    expect(pitches(r.song)).toEqual([[0, 240, 67, 1], [480, 200, 60, 2], [960, 240, 73, 2]]);
    expect(validateSong(r.song)).toMatchObject({ ok: true, errors: [] });
  });
  it("drags, re-pitches and stretches a note, leaving the others and the pass alone", () => {
    let song = addLeadNote(addLeadNote(newProject(), 0, "l_lead1", note(67, 0)).song, 0, "l_lead1", note(64, 480)).song;
    song = updateLeadNote(song, 0, "l_lead1", 0, { start: 240, ...pitchToLead(72, C, REG) });
    song = updateLeadNote(song, 0, "l_lead1", 1, { len: 960 });
    expect(pitches(song)).toEqual([[240, 240, 72, 1], [480, 960, 64, 1]]);
    expect(updateLeadNote(song, 0, "l_lead1", 1, { len: 960 })).toBe(song);
    expect(updateLeadNote(song, 0, "l_lead1", 9, { len: 1 })).toBe(song);
    expect(resolveSong(song).notes.filter((n) => n.lane === "l_lead1").map((n) => n.pitch)).toEqual([72, 64]);
  });
});

describe("editing several lead notes at once", () => {
  const C = { tonic: "C", mode: "ionian" }, REG = [60, 84], LEN = 2 * 1920;
  const N = (start, len, pitch, pass = 1) => ({ start, len, ...pitchToLead(pitch, C, REG), vel: 100, pass });
  const list = () => [N(0, 240, 60), N(240, 480, 64), N(960, 240, 67), N(1920, 240, 61)];
  const show = (l) => l.map((n) => [n.start, n.len, leadPitch(n, C, REG)]);
  it("moves a group in time, held inside the section as a group", () => {
    expect(show(moveOp([0, 1], { dTick: 480 }, C, REG, LEN)(list())).slice(0, 2)).toEqual([[480, 240, 60], [720, 480, 64]]);
    expect(show(moveOp([0, 1], { dTick: -999 }, C, REG, LEN)(list())).slice(0, 2)).toEqual([[0, 240, 60], [240, 480, 64]]);
    expect(show(moveOp([2, 3], { dTick: 99999 }, C, REG, LEN)(list())).slice(2)).toEqual([[2640, 240, 67], [3600, 240, 61]]);
    const l = list();
    expect(moveOp([], { dTick: 480 }, C, REG, LEN)(l)).toBe(l);
    expect(moveOp([0], {}, C, REG, LEN)(l)).toBe(l);
  });
  it("transposes by scale steps keeping accidentals, or by semitones", () => {
    expect(show(moveOp([0, 1, 2, 3], { steps: 2 }, C, REG, LEN)(list())).map((n) => n[2])).toEqual([64, 67, 71, 65]); // C#  -> E#
    expect(show(moveOp([0, 1], { steps: -1 }, C, REG, LEN)(list())).map((n) => n[2]).slice(0, 2)).toEqual([59, 62]);
    expect(show(moveOp([0, 1], { steps: 7 }, C, REG, LEN)(list())).map((n) => n[2]).slice(0, 2)).toEqual([72, 76]);
    expect(show(moveOp([0, 1], { semis: 1 }, C, REG, LEN)(list())).map((n) => n[2]).slice(0, 2)).toEqual([61, 65]);
    expect(shiftLeadNote(N(0, 1, 71), { steps: 1 }, C, REG)).toMatchObject({ deg: 1, oct: 1 });
    const l = list();
    expect(moveOp([0], { steps: 60 }, C, REG, LEN)(l)).toBe(l); // would leave the range: nothing moves
  });
  it("stretches a group by the same amount, within limits", () => {
    expect(show(stretchOp([0, 1], 240, 120, LEN)(list())).slice(0, 2)).toEqual([[0, 480, 60], [240, 720, 64]]);
    expect(show(stretchOp([0, 1], -9999, 120, LEN)(list())).slice(0, 2)).toEqual([[0, 120, 60], [240, 120, 64]]);
    expect(show(stretchOp([3], 99999, 120, LEN)(list()))[3]).toEqual([1920, 1920, 61]);
  });
  it("reverses the chosen notes inside their own span", () => {
    expect(leadSpan(list(), [0, 1, 2])).toEqual([0, 1200]);
    expect(show(reverseOp([0, 1, 2])(list()))).toEqual([[960, 240, 60], [480, 480, 64], [0, 240, 67], [1920, 240, 61]]);
    expect(show(reverseOp([0, 1, 2])(reverseOp([0, 1, 2])(list())))).toEqual(show(list()));
    const l = list();
    expect(reverseOp([1])(l)).toBe(l);
  });
  it("quantizes starts, sets velocity, deletes", () => {
    const loose = [N(110, 200, 60), N(500, 200, 62), N(LEN - 20, 20, 64)];
    expect(quantizeOp([0, 1, 2], 240, LEN)(loose).map((n) => [n.start, n.len])).toEqual([[0, 200], [480, 200], [LEN - 1, 1]]);
    expect(velocityOp([1], 300)(list()).map((n) => n.vel)).toEqual([100, 127, 100, 100]);
    expect(show(deleteOp([0, 2])(list()))).toEqual([[240, 480, 64], [1920, 240, 61]]);
  });
  it("copies and pastes, dropping what falls off the end", () => {
    const clip = copyLead(list(), [2, 1]);
    expect(clip.map((c) => [c.dt, c.len, c.deg])).toEqual([[0, 480, 3], [720, 240, 5]]);
    expect(clip[0].pass).toBeUndefined();
    const withPass2 = [...list(), N(3000, 100, 72, 2)];
    const pasted = pasteOp(clip, 2400, LEN)(withPass2);
    expect(show(pasted).slice(5)).toEqual([[2400, 480, 64], [3120, 240, 67]]);
    expect(pasted.slice(5).map((n) => n.pass)).toEqual([2, 2]);
    expect(show(pasteOp(clip, LEN - 240, LEN)(list())).slice(4)).toEqual([[LEN - 240, 240, 64]]);
    const l = list();
    expect(pasteOp(clip, LEN, LEN)(l)).toBe(l);
    expect(copyLead(l, [])).toEqual([]);
  });
  it("inverts a melody around its first note, by scale steps", () => {
    const up = [N(0, 240, 60), N(240, 240, 64), N(480, 240, 67), N(720, 240, 72)]; // C E G C'
    expect(show(invertOp([0, 1, 2, 3], C, REG)(up)).map((n) => n[2])).toEqual([60, 57, 53, 48]); // C A F C,
    expect(show(invertOp([0, 1, 2, 3], C, REG)(invertOp([0, 1, 2, 3], C, REG)(up)))).toEqual(show(up));
    expect(show(invertOp([1, 2], C, REG)(up)).map((n) => n[2])).toEqual([60, 64, 60, 72]); // around E: G becomes C
    const sharp = [N(0, 240, 64), N(240, 240, 66)]; // E, F#: two steps up with a sharp
    expect(invertOp([0, 1], C, REG)(sharp)[1]).toMatchObject({ deg: 2, acc: -1 }); // D flat: mirrored
    const l = list();
    expect(invertOp([0], C, REG)(l)).toBe(l);
  });
  it("halves and doubles in time from the first note, cutting what crosses the end", () => {
    expect(show(scaleTimeOp([0, 1, 2], 0.5, LEN)(list())).slice(0, 3)).toEqual([[0, 120, 60], [120, 240, 64], [480, 120, 67]]);
    expect(show(scaleTimeOp([1, 2], 2, LEN)(list())).slice(1, 3)).toEqual([[240, 960, 64], [1680, 480, 67]]);
    expect(show(scaleTimeOp([0, 1, 2], 2, LEN)(scaleTimeOp([0, 1, 2], 0.5, LEN)(list())))).toEqual(show(list()));
    const late = [N(1920, 480, 60), N(2880, 960, 64), N(3600, 240, 67)];
    expect(show(scaleTimeOp([0, 1, 2], 2, LEN)(late))).toEqual([[1920, 960, 60]]); // the other two would start past the end
    expect(show(scaleTimeOp([0, 1], 2, LEN)([N(1920, 480, 60), N(2400, 1000, 64)]))).toEqual([[1920, 960, 60], [2880, 960, 64]]);
    expect(show(scaleTimeOp([0], 0.5, LEN)(list()))[0]).toEqual([0, 120, 60]);
  });
  it("applies an operation to the stored song and leaves it alone when nothing changes", () => {
    let song = newProject();
    for (const n of list()) song = addLeadNote(song, 0, "l_lead1", { start: n.start, len: n.len, deg: n.deg, acc: n.acc, oct: n.oct, vel: 100 }).song;
    const moved = editLead(song, 0, "l_lead1", moveOp([0, 1], { dTick: 240, steps: 1 }, C, REG, LEN));
    expect(show(moved.arrangement[0].leads.l_lead1.notes).slice(0, 2)).toEqual([[240, 240, 62], [480, 480, 65]]);
    expect(validateSong(moved)).toMatchObject({ ok: true, errors: [] });
    expect(editLead(song, 0, "l_lead1", moveOp([], { dTick: 240 }, C, REG, LEN))).toBe(song);
    expect(editLead(song, 0, "l_lead1", deleteOp([0, 1, 2, 3])).arrangement[0].leads).toEqual({});
  });
});
