// Factory pattern library, 4/4. Each entry is `{ id, tag, swing?, pattern }`; `pattern` is exactly
// what gets copied into a song file. `swing` is the kit swing preset a groove asks for.

const drum = (name, grid, rows) => ({
  kind: "drum", role: "kit", name, meter: "4/4", bars: 1, grid, loop: "bar",
  hits: Object.entries(rows).flatMap(([pad, cells]) =>
    [...cells.replace(/\s/g, "")].flatMap((c, step) => (c === "." ? [] : [{ step, pad: +pad, lv: c }]))),
});
const pitched = (name, role, grid, steps) => ({
  kind: "pitched", role, name, meter: "4/4", bars: 1, grid, loop: "bar",
  steps: steps.map(([step, tones, len, vel, oct]) => ({ step, tones, len, vel, ...(oct ? { oct } : {}) })),
});

// Pads: 1 kick, 2 snare, 3 closed hat, 4 open hat, 5 clap, 6 crash, 7 rim, 8 low tom, 9 high tom, 10 ride.
// Cells: a accent, n normal, g ghost, . off. One character per step.
export const PAD_NAMES = ["Kick", "Snare", "Closed hat", "Open hat", "Clap", "Crash", "Rim", "Low tom", "High tom", "Ride"];
export const DEFAULT_PADS = [36, 38, 42, 46, 39, 49, 37, 45, 50, 51];

export const FACTORY = [
  { id: "pt_rock16", tag: "straight · rock", swing: "straight", pattern: drum("Rock 16", "1/16", {
    1: "a... .... n.n. ....",
    2: ".... n... .... n..g",
    3: "n.g. n.g. n.g. n...",
    4: ".... .... .... ..n.",
  }) },
  { id: "pt_four", tag: "straight · house", swing: "straight", pattern: drum("Four on the floor", "1/16", {
    1: "a... n... n... n...",
    5: ".... n... .... n...",
    3: "g... g... g... g...",
    4: "..n. ..n. ..n. ..n.",
  }) },
  { id: "pt_boombap", tag: "light swing · hip-hop", swing: "light", pattern: drum("Boom-bap", "1/16", {
    1: "a... ...n ..n. ....",
    2: ".... a... .... a...",
    3: "n.n. n.n. n.n. n.n.",
  }) },
  { id: "pt_halftime", tag: "straight · ballad", swing: "straight", pattern: drum("Half-time", "1/16", {
    1: "a... ..g. ..n. ....",
    2: ".... .... a... ....",
    3: "n.g. n.g. n.g. n.g.",
  }) },
  { id: "pt_shuffle", tag: "shuffle · blues", swing: "shuffle", pattern: drum("Shuffle", "1/8", {
    1: "a..g n..g",
    2: "..n. ..n.",
    3: "ngng ngng",
  }) },
  { id: "pt_fill1", tag: "fill", fill: true, pattern: drum("Fill 1", "1/16", {
    1: "a... .... n... ....",
    2: ".... n... ..nn ....",
    3: "n.g. n.g. .... ....",
    9: ".... .... .... nn..",
    8: ".... .... .... ..na",
  }) },

  { id: "pt_bass_long", tag: "whole notes", pattern: pitched("Long roots", "bass", "1/4", [[0, [1], 4, 96]]) },
  { id: "pt_bass_drive", tag: "steady 8ths", pattern: pitched("Driving 8ths", "bass", "1/8",
    [0, 1, 2, 3, 4, 5, 6, 7].map((s) => [s, [1], 1, s % 2 ? 82 : 100])) },
  { id: "pt_bass8", tag: "root, fifth, third", pattern: pitched("Walking 8ths", "bass", "1/8",
    [[0, [1], 2, 100], [2, [1], 1, 80], [3, [3], 1, 80], [4, [1], 2, 100], [6, [3], 1, 80], [7, [2], 1, 80]]) },
  { id: "pt_bass_r5o", tag: "root, fifth, octave", pattern: pitched("Root-fifth-octave", "bass", "1/8",
    [[0, [1], 2, 100], [2, [3], 1, 84], [3, [1], 1, 84, 1], [4, [1], 2, 100], [6, [3], 1, 84], [7, [1], 1, 84, 1]]) },

  { id: "pt_pad1", tag: "held chords", pattern: pitched("Whole-note triads", "pad", "1/4", [[0, [1, 2, 3, 4], 4, 70]]) },
  { id: "pt_pad_pulse", tag: "two per bar", pattern: pitched("Half-note pulse", "pad", "1/4",
    [[0, [1, 2, 3, 4], 2, 76], [2, [1, 2, 3, 4], 2, 66]]) },
  { id: "pt_pad_arp", tag: "up and back", pattern: pitched("8th arpeggio", "pad", "1/8",
    [1, 2, 3, 4, 3, 2, 1, 2].map((tone, s) => [s, [tone], s === 7 ? 1 : 2, s % 4 ? 68 : 82])) },
];

export const FACTORY_BY_ID = Object.fromEntries(FACTORY.map((f) => [f.id, f]));
