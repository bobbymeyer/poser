import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BasicMIDI } from "spessasynth_core";
import { resolveSong, resolveSection, applyMono, assignChannels, audibleLanes } from "../src/core/resolve.js";
import { exportMidi } from "../src/core/midi.js";
import { validateSong, loadSong } from "../src/core/validate.js";

const load = () => JSON.parse(readFileSync(new URL("../docs/example.song.json", import.meta.url)));
const of = (r, lane, instance) => r.notes.filter((n) => n.lane === lane && (instance === undefined || n.instance === instance));

describe("resolver on the example song", () => {
  const song = load(), r = resolveSong(song);
  it("lays out the arrangement and the stepped tempo map", () => {
    expect(r.instances.map((i) => [i.tick, i.len, i.bpm])).toEqual([[0, 7680, 112], [7680, 15360, 120], [23040, 15360, 120]]);
    expect(r.totalTicks).toBe(38400);
    expect(r.secAt(7680)).toBeCloseTo((16 * 60) / 112, 9);
    expect(r.totalSec).toBeCloseTo((16 * 60) / 112 + (64 * 60) / 120, 9);
  });
  it("resolves the bass line from chord tones", () => {
    const bar1 = of(r, "l_bass", 0).filter((n) => n.tick < 1920).map((n) => [n.tick, n.pitch, n.len]);
    expect(bar1).toEqual([[0, 33, 480], [480, 33, 240], [720, 40, 240], [960, 33, 480], [1440, 40, 240], [1680, 36, 240]]);
    expect(of(r, "l_bass", 0).filter((n) => n.tick % 1920 === 0).map((n) => n.pitch)).toEqual([33, 29, 36, 31]);
  });
  it("plays the kit pattern, then the fill on the last bar", () => {
    const kit = of(r, "l_kit", 0);
    expect(kit.length).toBe(12 * 3 + 7);
    expect(kit.filter((n) => n.tick >= 5760).map((n) => n.pitch).sort()).toEqual([36, 36, 38, 38, 45, 50, 50]);
    expect(kit.find((n) => n.tick === 0 && n.pitch === 36).vel).toBe(120);
    expect(kit.find((n) => n.tick === 240 && n.pitch === 42).vel).toBe(45);
  });
  it("re-voices a held pad at each chord change, including the IV7", () => {
    expect(of(r, "l_pad", 0).filter((n) => n.tick === 1920).map((n) => n.pitch)).toEqual([57, 60, 65]);
    const last = of(r, "l_pad", 1).filter((n) => n.tick === 7680 + 11520).map((n) => n.pitch % 12).sort((a, b) => a - b);
    expect(last.length).toBe(3);
    for (const pc of last) expect([5, 9, 0, 4]).toContain(pc); // tones of Fmaj7
  });
  it("puts leads on their own instance only", () => {
    expect(of(r, "l_lead1").map((n) => [n.tick, n.pitch, n.instance])).toEqual([[7680, 67, 1], [8160, 69, 1], [8640, 67, 1]]);
  });
  it("gives linked instances identical pattern notes", () => {
    const rel = (i) => of(r, "l_pad", i).map((n) => [n.tick - r.instances[i].tick, n.pitch, n.len]);
    expect(rel(1)).toEqual(rel(2));
  });
  it("a mode switch re-skins chords, patterns and leads without touching anything else", () => {
    const s = load();
    s.sections.s_chorus.mode = "aeolian";
    const m = resolveSong(s);
    expect(of(m, "l_lead1").map((n) => n.pitch)).toEqual([67, 68, 67]);
    expect(of(m, "l_bass", 1).find((n) => n.tick === 7680 + 720).pitch - of(m, "l_bass", 1)[0].pitch).toBe(7);
    expect(of(m, "l_bass", 1).find((n) => n.tick === 7680 + 7680).pitch % 12).toBe(8); // VI = A♭
    expect(of(m, "l_bass", 0)).toEqual(of(r, "l_bass", 0));
  });
  it("keeps but silences content past the end of a shrunken section", () => {
    const s = load();
    s.sections.s_verse.bars = 2;
    const m = resolveSong(s);
    expect(m.instances[0].len).toBe(3840);
    expect(of(m, "l_kit", 0).every((n) => n.tick < 3840)).toBe(true);
    expect(of(m, "l_pad", 0).every((n) => n.tick + n.len <= 3840)).toBe(true);
    expect(s.sections.s_verse.chords.length).toBe(4);
  });
  it("skips rests", () => {
    const s = load();
    s.sections.s_verse.chords[1].chord = "rest";
    expect(of(resolveSong(s), "l_bass", 0).some((n) => n.tick >= 1920 && n.tick < 3840)).toBe(false);
  });
});

describe("swing, choke and mono", () => {
  it("swings the kit and the lanes that follow it at the kit's grid", () => {
    const s = load();
    s.lanes[0].swing = "shuffle";
    const m = resolveSong(s);
    expect(of(m, "l_kit", 0).filter((n) => n.pitch === 42 && n.tick < 480).map((n) => n.tick)).toEqual([0, 240]);
    s.patterns.pt_rock16.hits.push({ step: 1, pad: 3, lv: "g" });
    const m2 = resolveSong(s);
    expect(of(m2, "l_kit", 0).filter((n) => n.pitch === 42 && n.tick < 240).map((n) => n.tick)).toEqual([0, 160]);
    expect(of(m2, "l_bass", 0).slice(0, 3).map((n) => n.tick)).toEqual([0, 480, 720]); // 8ths sit on the beat of each pair
    s.lanes[1].swing_follow = false;
    s.patterns.pt_bass8.grid = "1/16";
    expect(of(resolveSong(s), "l_bass", 0)[1].tick).toBe(240);
  });
  it("chokes the open hat with the closed hat", () => {
    const s = load();
    s.patterns.pt_rock16.grid = "1/8";
    s.patterns.pt_rock16.hits = [{ step: 0, pad: 4, lv: "n" }, { step: 0, pad: 1, lv: "n" }];
    s.patterns.pt_rock16.hits.push({ step: 1, pad: 3, lv: "n" });
    const kit = resolveSection(s, s.sections.s_verse).filter((n) => n.lane === "l_kit" && n.tick < 240);
    expect(kit.find((n) => n.pitch === 46).len).toBe(240);
    s.patterns.pt_rock16.grid = "1/4";
    s.patterns.pt_rock16.hits[2] = { step: 0, pad: 3, lv: "n" };
    s.patterns.pt_fill1.hits = [];
    s.sections.s_verse.clips.l_kit.push({ pattern: "pt_c", start: 0, len: 7680 });
    s.patterns.pt_c = { kind: "drum", meter: "4/4", bars: 1, grid: "1/16", loop: "bar", hits: [{ step: 1, pad: 3, lv: "n" }] };
    const open = resolveSection(s, s.sections.s_verse).find((n) => n.pitch === 46 && n.tick === 0);
    expect(open.len).toBe(120);
  });
  const lane = (priority, extra = {}) => ({ mono: { on: true, priority, legato: false }, instrument: { backend: "soundfont" }, ...extra });
  const N = (tick, len, pitch, pass = 1) => ({ tick, len, pitch, vel: 90, pass });
  it("last: a new note cuts the one sounding; the newer pass wins a tie", () => {
    const out = applyMono([N(0, 960, 60), N(480, 480, 64), N(960, 480, 62, 1), N(960, 480, 65, 2)], lane("last"));
    expect(out.map((n) => [n.tick, n.len, n.pitch])).toEqual([[0, 480, 60], [480, 480, 64], [960, 480, 65]]);
  });
  it("lowest and highest: an outranked note stays silent, and a cut note does not come back", () => {
    const notes = [N(0, 960, 60), N(240, 240, 64), N(480, 240, 55), N(960, 240, 70)];
    expect(applyMono(notes, lane("lowest")).map((n) => [n.tick, n.len, n.pitch])).toEqual([[0, 480, 60], [480, 240, 55], [960, 240, 70]]);
    expect(applyMono(notes, lane("highest")).map((n) => [n.tick, n.len, n.pitch])).toEqual([[0, 240, 60], [240, 240, 64], [480, 240, 55], [960, 240, 70]]);
  });
  it("legato overlaps cut notes on MIDI-out lanes only, and never edits the stored notes", () => {
    const notes = [N(0, 960, 60), N(480, 480, 64)];
    const midi = lane("last", { instrument: { backend: "midi" } });
    midi.mono.legato = true;
    expect(applyMono(notes, midi)[0].len).toBe(490);
    const sf = lane("last");
    sf.mono.legato = true;
    expect(applyMono(notes, sf)[0].len).toBe(480);
    expect(notes[0].len).toBe(960);
  });
  it("mute, solo and channel assignment", () => {
    const s = load();
    expect([...assignChannels(s)]).toEqual([["l_kit", 9], ["l_lead1", 2], ["l_bass", 0], ["l_pad", 1]]);
    s.lanes[1].mute = true;
    expect(audibleLanes(s).has("l_bass")).toBe(false);
    s.lanes[2].solo = true;
    expect([...audibleLanes(s)]).toEqual(["l_pad"]);
  });
});

describe(".mid export", () => {
  const song = load(), r = resolveSong(song);
  const bytes = exportMidi(song, r);
  const midi = BasicMIDI.fromArrayBuffer(bytes.buffer);
  it("is a valid format 1 file that a real parser accepts", () => {
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("MThd");
    expect(midi.timeDivision).toBe(480);
    expect(midi.tracks.length).toBe(5); // conductor + 4 lanes
  });
  it("carries every note at the right tick and channel", () => {
    const ons = midi.tracks.flatMap((t) => t.events).filter((e) => (e.statusByte & 0xf0) === 0x90 && e.data[1] > 0);
    expect(ons.length).toBe(r.notes.length);
    const channels = assignChannels(song);
    const want = r.notes.map((n) => `${n.tick}:${channels.get(n.lane)}:${n.pitch}:${n.vel}`).sort();
    expect(ons.map((e) => `${e.ticks}:${e.statusByte & 15}:${e.data[0]}:${e.data[1]}`).sort()).toEqual(want);
  });
  it("carries tempo changes and the full duration", () => {
    // The parser lists its own 120 bpm default first; ours must follow it.
    const tempos = midi.tempoChanges.map((t) => `${t.ticks}:${Math.round(t.tempo)}`);
    expect(tempos).toEqual(expect.arrayContaining(["0:112", "7680:120"]));
    expect(midi.duration).toBeCloseTo(r.totalSec, 1);
  });
  it("leaves muted lanes out", () => {
    const s = load();
    s.lanes[3].mute = true;
    expect(BasicMIDI.fromArrayBuffer(exportMidi(s).buffer).tracks.length).toBe(4);
  });
});

describe("validation", () => {
  const current = () => loadSong(load()).song;
  const paths = (s) => validateSong(s).errors.map((e) => e.path);
  it("accepts the migrated example", () => expect(validateSong(current())).toEqual({ ok: true, readOnly: false, errors: [] }));
  it("rejects unknown IDs and names the field", () => {
    const s = current();
    s.sections.s_verse.mode = "superlocrian";
    s.sections.s_chorus.chords[0].chord = "bII";
    s.lanes[0].swing = "drunk";
    const res = validateSong(s);
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.path)).toEqual(expect.arrayContaining(["/sections/s_verse/mode", "/sections/s_chorus/chords/0/chord", "/lanes/0/swing"]));
    expect(res.errors.find((e) => e.path === "/sections/s_verse/mode").message).toMatch(/superlocrian.*allowed:.*dorian/);
  });
  it("rejects broken references", () => {
    const s = current();
    s.arrangement[0].section = "s_bridge";
    s.sections.s_verse.clips.l_bass[0].pattern = "pt_rock16";
    s.sections.s_chorus.clips.l_ghost = [];
    s.lanes[2].instrument.sf = "sha256:OTHER";
    expect(paths(s)).toEqual(expect.arrayContaining([
      "/arrangement/0/section", "/sections/s_verse/clips/l_bass/0/pattern", "/sections/s_chorus/clips/l_ghost", "/lanes/2/instrument/sf",
    ]));
  });
  it("rejects wrong types, unknown fields and non-songs", () => {
    const s = current();
    s.sections.s_verse.bars = 2.5;
    s.lanes[1].instrument.port = "x";
    expect(paths(s)).toEqual(expect.arrayContaining(["/sections/s_verse/bars", "/lanes/1/instrument"]));
    expect(validateSong({ format: "nope" }).ok).toBe(false);
    expect(validateSong(null).ok).toBe(false);
  });
  it("handles newer rails versions", () => {
    const s = current();
    s.rails_version = 2;
    expect(validateSong(s)).toMatchObject({ ok: true, readOnly: true });
    s.sections.s_verse.meter = "7/8-2-2-3";
    const res = validateSong(s);
    expect(res).toMatchObject({ ok: false, readOnly: true });
    expect(res.errors[0].message).toBe("uses options from a newer version");
  });
});

describe("migration", () => {
  it("opens the version-1 example and migrates it", () => {
    const v1 = load();
    expect(v1.format_version).toBe(1);
    const res = loadSong(v1);
    expect(res).toMatchObject({ ok: true, migratedFrom: 1, readOnly: false, errors: [] });
    expect(res.song.format_version).toBe(2);
    expect(res.song.sections.s_verse.chords.map((c) => c.chord)).toEqual(["VI", "IV", "I", "V"]);
    expect(res.song.sections.s_chorus.chords[3]).toEqual({ start: 11520, len: 3840, chord: "IV", ext: 7 });
    expect(v1.sections.s_verse.chords[0].chord).toBe("vi"); // the input is not touched
  });
  it("sounds exactly the same after migrating", () => {
    const strip = (r) => r.notes.map((n) => [n.lane, n.tick, n.len, n.pitch, n.vel]);
    expect(strip(resolveSong(loadSong(load()).song))).toEqual(strip(resolveSong(load())));
  });
  it("keeps the borrowed minor iv, and leaves current files alone", () => {
    const v1 = load();
    v1.sections.s_verse.chords[1].chord = "iv";
    v1.sections.s_verse.chords[2].chord = "bVII";
    const res = loadSong(v1);
    expect(res.song.sections.s_verse.chords.map((c) => c.chord)).toEqual(["VI", "iv", "bVII", "V"]);
    const again = loadSong(res.song);
    expect(again).toMatchObject({ ok: true, migratedFrom: null });
    expect(again.song).toBe(res.song);
  });
  it("a version-1 file is not valid until migrated, and bad files still fail after it", () => {
    expect(validateSong(load()).errors[0]).toMatchObject({ path: "/format_version" });
    const bad = load();
    bad.sections.s_verse.mode = "nope";
    expect(loadSong(bad)).toMatchObject({ ok: false, song: null });
    expect(loadSong(bad).errors[0].path).toBe("/sections/s_verse/mode");
  });
  it("refuses files from a newer build and things that are not songs", () => {
    const s = load();
    s.format_version = 3;
    expect(loadSong(s).errors[0]).toMatchObject({ path: "/format_version", message: "file format 3 is newer than this app (2)" });
    expect(loadSong({ format: "song" }).ok).toBe(false);
    expect(loadSong("nope").ok).toBe(false);
  });
  it("accepts the optional bank on a SoundFont instrument and writes it to MIDI", () => {
    const s = loadSong(load()).song;
    s.lanes[2].instrument.bank = 8;
    expect(validateSong(s).ok).toBe(true);
    const pad = BasicMIDI.fromArrayBuffer(exportMidi(s).buffer).tracks[3].events.filter((e) => e.statusByte === 0xb1 && e.data[0] === 0);
    expect(pad.map((e) => e.data[1])).toEqual([8]);
    s.lanes[2].instrument.bank = 200;
    expect(validateSong(s).ok).toBe(false);
  });
});
