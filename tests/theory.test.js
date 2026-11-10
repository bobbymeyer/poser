import { describe, it, expect } from "vitest";
import { MODES, DEGREES, TONICS } from "../src/core/rails.js";
import { resolveChord, scaleNames, bassVoicing, nearestVoicing, tonePitch, leadPitch, swingTick } from "../src/core/theory.js";

const table = (mode, tonic = "C", extra = {}) =>
  DEGREES.map((d) => { const c = resolveChord({ chord: d, ...extra }, { tonic, mode }); return `${c.numeral} ${c.name}`; });

describe("chord table of every mode", () => {
  const TRIADS = {
    lydian:     ["I C", "II D", "iii Em", "iv° F♯°", "V G", "vi Am", "vii Bm"],
    ionian:     ["I C", "ii Dm", "iii Em", "IV F", "V G", "vi Am", "vii° B°"],
    mixolydian: ["I C", "ii Dm", "iii° E°", "IV F", "v Gm", "vi Am", "VII B♭"],
    dorian:     ["i Cm", "ii Dm", "III E♭", "IV F", "v Gm", "vi° A°", "VII B♭"],
    aeolian:    ["i Cm", "ii° D°", "III E♭", "iv Fm", "v Gm", "VI A♭", "VII B♭"],
    phrygian:   ["i Cm", "II D♭", "III E♭", "iv Fm", "v° G°", "VI A♭", "vii B♭m"],
    locrian:    ["i° C°", "II D♭", "iii E♭m", "iv Fm", "V G♭", "VI A♭", "vii B♭m"],
  };
  const SEVENTHS = {
    lydian:     ["I7 Cmaj7", "II7 D7", "iii7 Em7", "ivø7 F♯m7♭5", "V7 Gmaj7", "vi7 Am7", "vii7 Bm7"],
    ionian:     ["I7 Cmaj7", "ii7 Dm7", "iii7 Em7", "IV7 Fmaj7", "V7 G7", "vi7 Am7", "viiø7 Bm7♭5"],
    mixolydian: ["I7 C7", "ii7 Dm7", "iiiø7 Em7♭5", "IV7 Fmaj7", "v7 Gm7", "vi7 Am7", "VII7 B♭maj7"],
    dorian:     ["i7 Cm7", "ii7 Dm7", "III7 E♭maj7", "IV7 F7", "v7 Gm7", "viø7 Am7♭5", "VII7 B♭maj7"],
    aeolian:    ["i7 Cm7", "iiø7 Dm7♭5", "III7 E♭maj7", "iv7 Fm7", "v7 Gm7", "VI7 A♭maj7", "VII7 B♭7"],
    phrygian:   ["i7 Cm7", "II7 D♭maj7", "III7 E♭7", "iv7 Fm7", "vø7 Gm7♭5", "VI7 A♭maj7", "vii7 B♭m7"],
    locrian:    ["iø7 Cm7♭5", "II7 D♭maj7", "iii7 E♭m7", "iv7 Fm7", "V7 G♭maj7", "VI7 A♭7", "vii7 B♭m7"],
  };
  // Highest rung of the extension ladder per degree.
  const LADDER = {
    lydian: [9, 9, 9, 7, 9, 9, 7], ionian: [9, 9, 7, 9, 9, 9, 7], mixolydian: [9, 9, 7, 9, 9, 7, 9],
    dorian: [9, 7, 9, 9, 9, 7, 9], aeolian: [9, 7, 9, 9, 7, 9, 9], phrygian: [7, 9, 9, 9, 7, 9, 9],
    locrian: [7, 9, 9, 7, 9, 9, 9],
  };
  for (const mode of Object.keys(MODES)) {
    it(`${mode}: triads`, () => expect(table(mode)).toEqual(TRIADS[mode]));
    it(`${mode}: sevenths`, () => expect(table(mode, "C", { ext: 7 })).toEqual(SEVENTHS[mode]));
    it(`${mode}: ladder tops`, () =>
      expect(DEGREES.map((d) => resolveChord({ chord: d }, { tonic: "C", mode }).maxExt)).toEqual(LADDER[mode]));
    it(`${mode}: every tonic keeps the same qualities and stays in the scale`, () => {
      for (const tonic of Object.keys(TONICS)) {
        const scale = new Set(MODES[mode].map((iv) => (TONICS[tonic] + iv) % 12));
        DEGREES.forEach((d, i) => {
          const c = resolveChord({ chord: d, ext: 9 }, { tonic, mode });
          expect(c.quality).toBe(resolveChord({ chord: d }, { tonic: "C", mode }).quality);
          for (const iv of c.intervals) expect(scale.has((c.rootPc + iv) % 12)).toBe(true);
          expect(c.name.startsWith(scaleNames(tonic, mode)[i])).toBe(true);
        });
      }
    });
  }
});

describe("chord options", () => {
  const C = { tonic: "C", mode: "ionian" };
  const name = (chord, ctx = C) => resolveChord(chord, ctx).name;
  it("treats numeral case as output", () => {
    expect(resolveChord({ chord: "vi" }, C)).toEqual(resolveChord({ chord: "VI" }, C));
  });
  it("returns null for a rest", () => expect(resolveChord({ chord: "rest" }, C)).toBeNull());
  it("spells keys with sharps and flats", () => {
    expect(scaleNames("F#", "ionian")).toEqual(["F♯", "G♯", "A♯", "B", "C♯", "D♯", "E♯"]);
    expect(scaleNames("Db", "ionian")).toEqual(["D♭", "E♭", "F", "G♭", "A♭", "B♭", "C"]);
  });
  it("climbs the ladder and stops", () => {
    expect(name({ chord: "V", ext: 7 })).toBe("G7");
    expect(name({ chord: "V", ext: 9 })).toBe("G9");
    expect(resolveChord({ chord: "V", ext: 9 }, C).intervals).toEqual([0, 4, 7, 10, 14]);
    expect(name({ chord: "III", ext: 9 })).toBe("Em7");
    expect(name({ chord: "VII", ext: 9 })).toBe("Bm7♭5");
  });
  it("minor dominant: project toggle and per-chord override", () => {
    const Am = { tonic: "C", mode: "aeolian" };
    expect(name({ chord: "V" }, Am)).toBe("Gm");
    const raised = resolveChord({ chord: "V", ext: 7 }, { ...Am, minorDominant: true });
    expect([raised.name, raised.numeral, raised.raisedDominant]).toEqual(["G7", "V7", true]);
    expect(resolveChord({ chord: "V", ext: 9 }, { ...Am, minorDominant: true }).ext).toBe(7); // ♭9 is off the ladder
    expect(name({ chord: "V", quality: "min" }, { ...Am, minorDominant: true })).toBe("Gm");
    expect(name({ chord: "V", quality: "maj" }, Am)).toBe("G");
    expect(name({ chord: "V" }, { ...C, minorDominant: true })).toBe("G");
    expect(name({ chord: "II", quality: "maj" })).toBe("D");
  });
  it("borrowed palette", () => {
    const got = ["bIII", "bVI", "bVII", "iv", "V/V", "V/vi"].map((id) => {
      const c = resolveChord({ chord: id, ext: 7 }, C);
      return `${c.numeral} ${c.name}`;
    });
    expect(got).toEqual(["♭III7 E♭maj7", "♭VI7 A♭maj7", "♭VII7 B♭7", "iv7 Fm7", "V7/V D7", "V7/vi E7"]);
    expect(name({ chord: "V/V" }, { tonic: "A", mode: "ionian" })).toBe("B");
    expect(name({ chord: "bVI" }, { tonic: "E", mode: "ionian" })).toBe("C");
  });
  it("sus, add9 and inversions", () => {
    expect(name({ chord: "I", sus: "sus4" })).toBe("Csus4");
    expect(name({ chord: "V", ext: 7, sus: "sus4" })).toBe("G7sus4");
    expect(resolveChord({ chord: "I", sus: "sus2" }, C).intervals).toEqual([0, 2, 7]);
    expect(name({ chord: "I", add9: true })).toBe("Cadd9");
    expect(name({ chord: "VI", add9: true })).toBe("Amadd9");
    expect(name({ chord: "I", inv: 1 })).toBe("C/E");
    expect(name({ chord: "IV", inv: 2 })).toBe("F/C");
    expect(resolveChord({ chord: "I", inv: 1 }, C).tones).toEqual([4, 7, 0]);
  });
});

describe("voicing", () => {
  const C = { tonic: "C", mode: "ionian" };
  const ch = (chord) => resolveChord(typeof chord === "string" ? { chord } : chord, C);
  it("bass sits on the chord's bass tone at the bottom of the register", () => {
    expect(bassVoicing(ch("VI"), [28, 52])).toEqual([33, 36, 40]);
    expect(bassVoicing(ch("IV"), [28, 52])).toEqual([29, 33, 36]);
    expect(bassVoicing(ch({ chord: "I", inv: 1 }), [28, 52])[0]).toBe(28); // E1
  });
  it("nearest voicing moves as little as possible and stays in the register", () => {
    const reg = [48, 76];
    let prev = null;
    const seq = ["VI", "IV", "I", "V"].map((id) => (prev = nearestVoicing(ch(id), reg, prev)));
    expect(seq).toEqual([[57, 60, 64], [57, 60, 65], [55, 60, 64], [55, 59, 62]]);
    for (const tonic of Object.keys(TONICS)) for (const d of DEGREES) {
      const c = resolveChord({ chord: d, ext: 7 }, { tonic, mode: "dorian" });
      const v = nearestVoicing(c, reg, seq[0]);
      expect(v.every((p) => p >= 48 && p <= 76)).toBe(true);
      expect(new Set(v.map((p) => p % 12))).toEqual(new Set(c.intervals.map((iv) => (c.rootPc + iv) % 12)));
    }
  });
  it("tone indices wrap up an octave past the top of the chord", () => {
    expect([1, 2, 3, 4, 5, 7].map((i) => tonePitch([60, 64, 67], i))).toEqual([60, 64, 67, 72, 76, 84]);
    expect(tonePitch([60, 64, 67], 1, -1)).toBe(48);
  });
  it("lead notes follow the key", () => {
    expect(leadPitch({ deg: 5, acc: 0, oct: 0 }, C, [60, 84])).toBe(67);
    expect(leadPitch({ deg: 3, acc: 0, oct: 0 }, { tonic: "C", mode: "aeolian" }, [60, 84])).toBe(63);
    expect(leadPitch({ deg: 4, acc: 1, oct: 1 }, { tonic: "D", mode: "ionian" }, [60, 84])).toBe(62 + 5 + 1 + 12);
  });
});

describe("swing", () => {
  it("leaves the beat alone and delays the off-beat", () => {
    expect(swingTick(960, 120, 2 / 3)).toBe(960);
    expect(swingTick(120, 120, 2 / 3)).toBe(160);
    expect(swingTick(240 + 240, 240, 0.58)).toBe(480);
    expect(swingTick(240, 240, 0.58)).toBe(278);
    expect(swingTick(120, 120, 0.5)).toBe(120);
  });
  it("never reorders time", () => {
    for (let t = 1; t < 960; t++) expect(swingTick(t, 120, 2 / 3)).toBeGreaterThanOrEqual(swingTick(t - 1, 120, 2 / 3));
  });
});
