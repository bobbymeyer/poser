import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { FACTORY, FACTORY_PROGRESSIONS, FACTORY_SECTIONS, FACTORY_BY_ID } from "../src/factory/patterns.js";
import { newProject, starterProject } from "../src/editor/template.js";
import { tileProgression, progressionFrom, patternEntry, sectionEntry, addLibrarySection, exportLibrary } from "../src/editor/libraryOps.js";
import { editPattern, setLanePattern, cycleHit, libraryFor, stepCount } from "../src/editor/patternOps.js";
import { describeArrangement } from "../src/editor/arrangeOps.js";
import { validateSong, loadSong } from "../src/core/validate.js";
import { resolveSong, resolveChords } from "../src/core/resolve.js";
import { songSchema } from "../src/core/schema.js";

const BAR = 1920;
const ok = (song) => expect(validateSong(song)).toMatchObject({ ok: true, errors: [] });

describe("factory library", () => {
  const validPattern = new Ajv().compile(songSchema.properties.patterns.additionalProperties);
  it("holds valid patterns for every role, including fills, arp and comp", () => {
    expect(FACTORY.length).toBeGreaterThanOrEqual(24);
    for (const f of FACTORY) {
      expect(validPattern(f.pattern), `${f.id} ${JSON.stringify(validPattern.errors)}`).toBe(true);
      const steps = stepCount(f.pattern);
      for (const h of f.pattern.hits || []) expect(h.step, f.id).toBeLessThan(steps);
      for (const s of f.pattern.steps || []) expect(s.step + s.len, f.id).toBeLessThanOrEqual(steps);
    }
    const roles = (r) => FACTORY.filter((f) => f.pattern.role === r).length;
    expect([roles("kit") >= 9, roles("bass") >= 6, roles("pad") >= 4, roles("arp") >= 3, roles("comp") >= 3]).toEqual([true, true, true, true, true]);
    expect(FACTORY.filter((f) => f.fill).length).toBe(3);
    expect(new Set(FACTORY.map((f) => f.id)).size).toBe(FACTORY.length);
  });
  it("holds progressions that tile from bar 1 and resolve in every mode", () => {
    expect(FACTORY_PROGRESSIONS.length).toBeGreaterThanOrEqual(8);
    for (const p of FACTORY_PROGRESSIONS) {
      let t = 0;
      for (const c of p.chords) { expect(c.start, p.id).toBe(t); t += c.len; }
      expect(t, p.id).toBe(p.bars * BAR);
      for (const mode of ["ionian", "aeolian", "dorian"]) {
        const song = newProject();
        Object.assign(song.sections.s_1, { mode, bars: p.bars, chords: structuredClone(p.chords) });
        expect(resolveChords(song, song.sections.s_1).every((c) => c.chord), `${p.id} in ${mode}`).toBe(true);
      }
    }
  });
  it("holds ready-made sections that drop into a new song", () => {
    expect(FACTORY_SECTIONS.map((s) => s.name)).toEqual(["Intro", "Verse", "Chorus", "Outro"]);
    for (const entry of FACTORY_SECTIONS) {
      const song = addLibrarySection(newProject(), 0, entry);
      ok(song);
      expect(song.arrangement.length).toBe(2);
      expect(resolveSong(song).notes.some((n) => n.instance === 1), entry.id).toBe(true);
    }
  });
});

describe("starter song", () => {
  const song = starterProject();
  it("is a valid, current-format song with a fresh ID each time", () => {
    expect(loadSong(song)).toMatchObject({ ok: true, migratedFrom: null, readOnly: false });
    expect(song.id).not.toBe(starterProject().id);
    expect(song.id).not.toBe("prj_starter");
  });
  it("is a whole short song: verse, chorus, verse, a lifted chorus, an outro", () => {
    const d = describeArrangement(song);
    expect(d.map((x) => x.name)).toEqual(["Verse", "Chorus", "Verse", "Chorus 2", "Outro"]);
    expect(d[3]).toMatchObject({ keyChanged: true, lift: 2 });
    expect(d[0].count).toBe(2);
    const r = resolveSong(song);
    expect(r.totalSec).toBeGreaterThan(60);
    expect(r.totalSec).toBeLessThan(120);
  });
  it("sounds from the first beat on kit, bass and pad, and carries a melody in both choruses", () => {
    const r = resolveSong(song);
    const at0 = new Set(r.notes.filter((n) => n.tick === 0).map((n) => n.lane));
    expect([...at0].sort()).toEqual(["l_bass", "l_kit", "l_pad"]);
    const lead = (i) => r.notes.filter((n) => n.lane === "l_lead1" && n.instance === i).map((n) => n.pitch);
    expect(lead(1).length).toBe(24);
    expect(lead(3)).toEqual(lead(1).map((p) => p + 2)); // the same melody, a tone up
    expect(lead(0)).toEqual([]);
    expect(r.notes.some((n) => n.lane === "l_arp1" && n.instance === 1)).toBe(true);
  });
  it("keeps every melody note inside its chord's scale", () => {
    const r = resolveSong(song);
    for (const n of r.notes.filter((x) => x.lane === "l_lead1" && x.instance === 1)) expect([0, 2, 4, 5, 7, 9, 11]).toContain(n.pitch % 12);
  });
});

describe("library operations", () => {
  const axis = FACTORY_PROGRESSIONS.find((p) => p.id === "pg_axis"), vamp = FACTORY_PROGRESSIONS.find((p) => p.id === "pg_vamp");
  const names = (chords) => chords.map((c) => `${c.chord}@${c.start / BAR}+${c.len / BAR}`);
  it("tiles a progression across a section and cuts it at the end", () => {
    expect(names(tileProgression(axis, { bars: 8, meter: "4/4" }))).toEqual(["I@0+2", "V@2+2", "VI@4+2", "IV@6+2"]);
    expect(names(tileProgression(axis, { bars: 5, meter: "4/4" }))).toEqual(["I@0+2", "V@2+2", "VI@4+1"]);
    expect(names(tileProgression(vamp, { bars: 4, meter: "4/4" }))).toEqual(["I@0+1", "IV@1+1", "I@2+1", "IV@3+1"]);
    expect(tileProgression(axis, { bars: 16, meter: "4/4" }).length).toBe(8);
    expect(axis.chords[0].start).toBe(0); // the entry itself is untouched
  });
  it("saves a section's chords as a progression", () => {
    const song = newProject();
    song.sections.s_1.bars = 3;
    song.sections.s_1.chords = [{ start: 0, len: BAR, chord: "I", ext: 7 }, { start: BAR, len: 3 * BAR, chord: "IV" }, { start: 4 * BAR, len: BAR, chord: "V" }];
    const p = progressionFrom(song.sections.s_1, "Mine");
    expect(p).toMatchObject({ name: "Mine", tag: "your library", bars: 3 });
    expect(names(p.chords)).toEqual(["I@0+1", "IV@1+2"]);
    expect(p.chords[0].ext).toBe(7);
    expect(p.id).toMatch(/^lib_/);
  });
  it("a saved pattern is frozen like a factory one: editing the song's copy leaves the library's alone", () => {
    const base = newProject();
    const { song, id } = editPattern(base, "pt_rock16", (p) => cycleHit(p, 3, 1));
    const entry = patternEntry(song, id);
    expect(entry.id).toMatch(/^lib_/);
    let other = setLanePattern(newProject(), "s_1", "l_kit", entry);
    expect(other.patterns[entry.id]).toEqual(entry.pattern);
    const edited = editPattern(other, entry.id, (p) => cycleHit(p, 5, 1));
    expect(edited.id).not.toBe(entry.id);
    expect(edited.song.patterns[entry.id]).toBeUndefined();
    expect(entry.pattern).toEqual(song.patterns[id]);
    const lib = libraryFor(other, other.lanes[0], "main", [entry, patternEntry(base, "pt_bass8")]);
    expect(lib.saved.map((e) => e.id)).toEqual([entry.id]); // the bass pattern does not fit a kit lane
    expect(lib.mine).toEqual([]);
  });
  it("lists a lane's own role first", () => {
    const song = starterProject();
    const arp = song.lanes.find((l) => l.role === "arp");
    expect(libraryFor(song, arp).factory.slice(0, 3).every((f) => f.pattern.role === "arp")).toBe(true);
    expect(libraryFor(song, song.lanes[0], "fill").factory.map((f) => f.id)).toEqual(["pt_fill1", "pt_fill2", "pt_fill3"]);
  });
  it("saves a section with its patterns and adds it to another song", () => {
    const from = starterProject();
    const chorus = from.arrangement[1].section;
    const entry = sectionEntry(from, chorus);
    expect(Object.keys(entry.patterns).sort()).toEqual(["pt_arp_updown", "pt_bass_drive", "pt_fill2", "pt_pad_pulse", "pt_rock16"]);
    const song = addLibrarySection(newProject(), 0, entry); // a song with no arp lane
    ok(song);
    const added = song.sections[song.arrangement[1].section];
    expect(added.name).toBe("Chorus");
    expect(added.clips.l_arp1).toBeUndefined();
    expect(song.patterns.pt_arp_updown).toBeUndefined();
    expect(added.chords.map((c) => c.chord)).toEqual(["IV", "I", "V", "VI"]);
    expect(song.arrangement[1].leads).toEqual({});
    expect(from.sections[chorus].clips.l_arp1).toBeDefined();
  });
  it("brings a clashing pattern in under a new ID", () => {
    const base = newProject();
    const entry = sectionEntry(base, "s_1");
    entry.patterns.pt_bass8 = { ...entry.patterns.pt_bass8, name: "Different" };
    const song = addLibrarySection(base, 0, entry);
    ok(song);
    const id = song.sections[song.arrangement[1].section].clips.l_bass[0].pattern;
    expect(id).not.toBe("pt_bass8");
    expect(song.patterns[id].name).toBe("Different");
    expect(song.patterns.pt_bass8).toEqual(FACTORY_BY_ID.pt_bass8.pattern);
    expect(addLibrarySection(song, 0, sectionEntry(base, "s_1")).sections).not.toBe(song.sections);
  });
  it("exports factory and user entries in the factory file's shape", () => {
    const song = newProject();
    const user = { patterns: [patternEntry(song, "pt_bass8")], progressions: [progressionFrom(song.sections.s_1, "Mine")], sections: [sectionEntry(song, "s_1")] };
    const out = exportLibrary(user);
    expect(Object.keys(out)).toEqual(["library_version", "patterns", "progressions", "sections"]);
    expect([out.patterns.length, out.progressions.length, out.sections.length]).toEqual([FACTORY.length + 1, FACTORY_PROGRESSIONS.length + 1, FACTORY_SECTIONS.length + 1]);
    expect(out.patterns.at(-1).tag).toBe("");
    expect(exportLibrary({ patterns: [], progressions: [], sections: [] }).patterns).toEqual(FACTORY);
  });
});
