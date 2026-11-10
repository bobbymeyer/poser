import { describe, it, expect } from "vitest";
import { BasicMIDI } from "spessasynth_core";
import { newProject, FACTORY_SOUNDFONT } from "../src/editor/template.js";
import { applyTake, emptyTake, keyMap } from "../src/editor/liveOps.js";
import { addLane, removeLane, addableRoles, useSoundFont, useMidiOut, setLaneSettings, bounceSkips, soundFontOnly } from "../src/editor/laneOps.js";
import { reducer } from "../src/app/project.js";
import { validateSong } from "../src/core/validate.js";
import { resolveSong, assignChannels } from "../src/core/resolve.js";
import { exportMidi } from "../src/core/midi.js";

const ok = (song) => expect(validateSong(song)).toMatchObject({ ok: true, errors: [] });
const lane = (song, id) => song.lanes.find((l) => l.id === id);

describe("lanes", () => {
  it("adds lanes by role with defaults and free zones", () => {
    let song = addLane(newProject(), "arp");
    expect(song.lanes.at(-1)).toMatchObject({ id: "l_arp1", role: "arp", name: "Arp", zones: ["rty"] }); // first zone nobody holds, off the number row
    song = addLane(song, "bass");
    expect(song.lanes.at(-1)).toMatchObject({ id: "l_bass2", name: "Bass 2", zones: ["uio"], register: [28, 52] });
    song = addLane(song, "lead");
    expect(song.lanes.at(-1)).toMatchObject({ id: "l_lead2", name: "Lead 2", zones: [] });
    ok(song);
    expect(new Set([...keyMap(song).values()].map((k) => k.laneId)).size).toBe(6);
  });
  it("allows one kit and two leads", () => {
    let song = newProject();
    expect(addableRoles(song)).toEqual(["bass", "pad", "arp", "comp", "lead"]);
    expect(addLane(song, "kit")).toBe(song);
    song = addLane(song, "lead");
    expect(addableRoles(song)).not.toContain("lead");
    expect(addLane(song, "lead")).toBe(song);
  });
  it("deleting a lane removes its clips, its lead notes and unused patterns", () => {
    let song = applyTake(newProject(), 0, { ...emptyTake(), leads: [{ laneId: "l_lead1", start: 0, len: 200, deg: 1, acc: 0, oct: 0, vel: 90 }] });
    song = removeLane(song, "l_lead1");
    expect(song.arrangement[0].leads).toEqual({});
    song = removeLane(song, "l_bass");
    expect(song.sections.s_1.clips.l_bass).toBeUndefined();
    expect(song.patterns.pt_bass8).toBeUndefined();
    expect(song.lanes.map((l) => l.id)).toEqual(["l_kit", "l_pad"]);
    ok(song);
    expect(removeLane(song, "nope")).toBe(song);
  });
});

describe("sound sources", () => {
  const font = { hash: "sha256:abc", name: "Strings.sf2" };
  it("puts a lane on another SoundFont and adds it to the manifest once", () => {
    let song = useSoundFont(newProject(), "l_pad", font, 48);
    expect(lane(song, "l_pad").instrument).toEqual({ backend: "soundfont", sf: "sha256:abc", program: 48 });
    expect(song.soundfonts).toEqual([FACTORY_SOUNDFONT, font]);
    song = useSoundFont(song, "l_kit", font);
    expect(lane(song, "l_kit").instrument).toEqual({ backend: "soundfont", sf: "sha256:abc", program: 0, drums: true });
    expect(song.soundfonts.length).toBe(2);
    ok(song);
  });
  it("switches a lane to MIDI out and back", () => {
    let song = useMidiOut(newProject(), "l_lead1", { port: "IAC Driver Bus 1", channel: 3 });
    expect(lane(song, "l_lead1").instrument).toEqual({ backend: "midi", port: "IAC Driver Bus 1", channel: 3, program: null });
    song = useMidiOut(song, "l_lead1", { program: 81 });
    expect(lane(song, "l_lead1").instrument).toMatchObject({ port: "IAC Driver Bus 1", channel: 3, program: 81 });
    ok(song);
    expect(assignChannels(song).get("l_lead1")).toBe(2);
    expect(lane(useMidiOut(newProject(), "l_kit"), "l_kit").instrument.channel).toBe(10);
    ok(useMidiOut(newProject(), "l_bass"));
    song = useSoundFont(song, "l_lead1", FACTORY_SOUNDFONT);
    expect(lane(song, "l_lead1").instrument).toEqual({ backend: "soundfont", sf: FACTORY_SOUNDFONT.hash, program: 80 });
  });
  it("mixer settings are part of the song", () => {
    const song = setLaneSettings(newProject(), "l_bass", { volume: 64, pan: 20, latency_ms: 12 });
    expect(lane(song, "l_bass")).toMatchObject({ volume: 64, pan: 20, latency_ms: 12 });
    ok(song);
  });
  it("a bounce skips audible MIDI-out lanes and nothing else", () => {
    let song = useMidiOut(newProject(), "l_lead1", { port: "X" });
    song = useMidiOut(song, "l_pad", { port: "X" });
    expect(bounceSkips(song)).toEqual(["Pad", "Lead 1"]);
    expect(bounceSkips(setLaneSettings(song, "l_pad", { mute: true }))).toEqual(["Lead 1"]);
    expect(bounceSkips(setLaneSettings(song, "l_bass", { solo: true }))).toEqual([]);
    expect(bounceSkips(newProject())).toEqual([]);
    const heard = soundFontOnly(song);
    expect(resolveSong(heard).notes.length).toBe(resolveSong(song).notes.length);
    const midi = BasicMIDI.fromArrayBuffer(exportMidi(heard).buffer);
    expect(midi.tracks.length).toBe(2); // conductor + kit; bass has no chords to play, pad and lead are MIDI out
  });
  it("the bounce's MIDI carries a bank select before each program", () => {
    const bytes = exportMidi(newProject(), undefined, { bankOf: (l) => (l.id === "l_kit" ? 70 : 0) });
    const kit = BasicMIDI.fromArrayBuffer(bytes.buffer).tracks[1].events.filter((e) => e.ticks === 0 && e.statusByte >= 0xb0 && e.statusByte < 0xd0);
    expect(kit.slice(0, 2).map((e) => [e.statusByte, ...e.data])).toEqual([[0xb9, 0, 70], [0xc9, 0]]);
  });
});

describe("undo grouping", () => {
  it("folds a dragged slider into one undo step", () => {
    let state = reducer(null, { type: "load", song: newProject() });
    const set = (v, group) => { state = reducer(state, { type: "edit", song: setLaneSettings(state.song, "l_bass", { volume: v }), group }); };
    set(90, "vol"); set(80, "vol"); set(70, "vol");
    expect(state.past.length).toBe(1);
    set(60); set(50, "vol");
    expect(state.past.length).toBe(3);
    state = reducer(reducer(reducer(state, { type: "undo" }), { type: "undo" }), { type: "undo" });
    expect(lane(state.song, "l_bass").volume).toBe(100);
  });
});
