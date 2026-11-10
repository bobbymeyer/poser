// Music theory: chords from degrees, names, the extension ladder, voicing, lead pitches.
// Pure functions, no state. Pitch classes are 0-11 with C = 0; pitches are MIDI note numbers.

import { TONICS, MODES, DEGREES } from "./rails.js";

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const mod = (n, m) => ((n % m) + m) % m;

// Borrowed chords taken from the parallel Aeolian mode: ID -> degree index there.
const FROM_AEOLIAN = { bIII: 2, bVI: 5, bVII: 6, iv: 3 };
// Secondary dominants: ID -> degree index (in the current mode) of the chord they lead to.
const SECONDARY = { "V/V": 4, "V/vi": 5 };
const BORROWED_NUMERAL = { bIII: "♭III", bVI: "♭VI", bVII: "♭VII", iv: "iv" };

/** Degree index 0-6 for a diatonic chord ID, or -1. Case is ignored: it is output, not input. */
export function degreeIndex(id) {
  if (id in FROM_AEOLIAN || id in SECONDARY) return -1;
  return DEGREES.indexOf(String(id).toUpperCase());
}

/** Spell a pitch class using a given letter, e.g. (letter E, pc 3) -> "E♭". */
function spell(letter, pc) {
  const l = mod(letter, 7);
  const diff = mod(pc - LETTER_PC[l] + 6, 12) - 6;
  return LETTERS[l] + (diff < 0 ? "♭".repeat(-diff) : "♯".repeat(diff));
}

const tonicLetter = (tonic) => LETTERS.indexOf(tonic[0]);

/** Note names of the seven scale degrees, spelled with one letter each. */
export function scaleNames(tonic, mode) {
  const pc = TONICS[tonic], letter = tonicLetter(tonic);
  return MODES[mode].map((iv, d) => spell(letter + d, pc + iv));
}

/**
 * Resolve a stored chord to pitch classes and names.
 *
 * @param chord   `{ chord, quality?, ext?, sus?, add9?, inv? }` as stored in a section
 * @param context `{ tonic, mode, minorDominant }`
 * @returns null for a rest, otherwise
 *   `{ rootPc, intervals, tones, quality, ext, maxExt, name, numeral }` where `intervals` are
 *   semitones above the root in root position and `tones` is the same list rotated by the
 *   inversion, so `tones[0]` is the bass note.
 */
export function resolveChord(chord, { tonic, mode, minorDominant = false }) {
  const id = chord.chord;
  if (id === "rest") return null;
  const tonicPc = TONICS[tonic], scale = MODES[mode], tLetter = tonicLetter(tonic);
  if (tonicPc === undefined || !scale) throw new Error(`Unknown tonic or mode: ${tonic} ${mode}`);

  // 1. Root and the stack of thirds above it: [third, fifth, seventh, ninth].
  let rootIv, rootLetter, stack, numeralBase, raisedDominant = false;
  const stackFrom = (sc, d) => [1, 2, 3, 4].map((k) => {
    const iv = mod(sc[(d + 2 * k) % 7] - sc[d], 12);
    return k === 4 ? iv + 12 : iv;
  });
  const d = degreeIndex(id);
  if (d >= 0) {
    rootIv = scale[d]; rootLetter = tLetter + d; stack = stackFrom(scale, d); numeralBase = DEGREES[d];
    if (minorDominant && d === 4 && stack[0] === 3 && stack[1] === 7 && !chord.quality) {
      stack[0] = 4; raisedDominant = true; // major V in a minor mode
    }
  } else if (id in FROM_AEOLIAN) {
    const a = FROM_AEOLIAN[id];
    rootIv = MODES.aeolian[a]; rootLetter = tLetter + a; stack = stackFrom(MODES.aeolian, a);
  } else if (id in SECONDARY) {
    const target = SECONDARY[id];
    rootIv = mod(scale[target] + 7, 12); rootLetter = tLetter + target + 4; stack = [4, 7, 10, 14];
  } else {
    throw new Error(`Unknown chord ID: ${id}`);
  }
  if (chord.quality === "maj") { stack[0] = 4; stack[1] = 7; }
  if (chord.quality === "min") { stack[0] = 3; stack[1] = 7; }
  const [third, fifth, seventh, ninth] = stack;
  const quality = third === 4 ? (fifth === 8 ? "aug" : "maj") : fifth === 6 ? "dim" : "min";

  // 2. Extension ladder: triad, 7, 9. Stop before a note a half step above a chord tone.
  const clashes = (iv, tones) => tones.some((t) => mod(iv - t, 12) === 1);
  let maxExt = 5;
  if (!clashes(seventh, [0, third, fifth])) {
    maxExt = 7;
    if (!clashes(ninth, [0, third, fifth, seventh])) maxExt = 9;
  }
  const ext = Math.min(chord.ext || 5, maxExt);

  // 3. Assemble, then apply sus / add9 / inversion.
  const sus = chord.sus === "sus2" ? 2 : chord.sus === "sus4" ? 5 : 0;
  const intervals = [0, sus || third, fifth];
  if (ext >= 7) intervals.push(seventh);
  if (ext >= 9) intervals.push(ninth);
  const add9 = !!chord.add9 && ext < 9 && sus !== 2;
  if (add9) intervals.push(14);
  const inv = Math.min(chord.inv || 0, 2);
  const tones = [...intervals.slice(inv), ...intervals.slice(0, inv)];

  // 4. Names.
  const rootPc = mod(tonicPc + rootIv, 12);
  const rootName = spell(rootLetter, rootPc);
  const namedExt = add9 && ext === 7 ? 9 : ext;
  let suffix;
  if (namedExt === 5) suffix = sus ? "" : { maj: "", min: "m", dim: "°", aug: "+" }[quality];
  else {
    const n = namedExt;
    const major7 = seventh === 11;
    if (sus) suffix = major7 ? `maj${n}` : `${n}`;
    else if (quality === "maj" || quality === "aug") suffix = (major7 ? `maj${n}` : `${n}`) + (quality === "aug" ? "♯5" : "");
    else if (quality === "min") suffix = major7 ? `m(maj${n})` : `m${n}`;
    else suffix = major7 ? `°(maj${n})` : `m${n}♭5`;
  }
  if (sus) suffix += chord.sus;
  if (add9 && ext === 5) suffix += "add9";
  let name = rootName + suffix;
  if (inv > 0) {
    const letterStep = inv === 1 ? (sus === 2 ? 1 : sus === 5 ? 3 : 2) : 4;
    name += "/" + spell(rootLetter + letterStep, rootPc + tones[0]);
  }

  const lower = quality === "min" || quality === "dim";
  const mark = quality === "dim" ? (namedExt >= 7 ? "ø" : "°") : "";
  const tail = mark + (namedExt >= 7 ? namedExt : "") + (sus ? chord.sus : "") + (add9 && ext === 5 ? "add9" : "");
  let numeral;
  if (d >= 0) numeral = (lower ? numeralBase.toLowerCase() : numeralBase) + tail;
  else if (id in SECONDARY) { const [a, b] = id.split("/"); numeral = `${a}${tail}/${b}`; }
  else numeral = BORROWED_NUMERAL[id] + tail;

  return { rootPc, intervals, tones, quality, ext, maxExt, name, numeral, raisedDominant };
}

/** Lowest pitch at or above `floor` with pitch class `pc`. */
export const pitchAtOrAbove = (pc, floor) => floor + mod(pc - floor, 12);

/** Bass voicing: the chord's bass tone as low as the register allows, the rest stacked above. */
export function bassVoicing(chord, register) {
  const out = [];
  let floor = register[0];
  for (const iv of chord.tones) {
    const p = pitchAtOrAbove(chord.rootPc + iv, floor);
    out.push(p);
    floor = p + 1;
  }
  return out;
}

/**
 * Nearest voicing: the close-position inversion inside the register that moves least from
 * the previous voicing (or sits nearest the middle of the register when there is none).
 * Returns pitches in ascending order.
 */
export function nearestVoicing(chord, register, prev = null) {
  const [lo, hi] = register;
  const pcs = [...new Set(chord.intervals.map((iv) => mod(chord.rootPc + iv, 12)))];
  const candidates = [];
  for (let r = 0; r < pcs.length; r++) {
    const order = [...pcs.slice(r), ...pcs.slice(0, r)];
    for (let base = pitchAtOrAbove(order[0], lo); base <= hi; base += 12) {
      const v = [base];
      for (let i = 1; i < order.length; i++) v.push(pitchAtOrAbove(order[i], v[i - 1] + 1));
      candidates.push(v);
    }
  }
  const inRange = candidates.filter((v) => v[v.length - 1] <= hi);
  const pool = inRange.length ? inRange : candidates;
  const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  const nearest = (p, v) => Math.min(...v.map((q) => Math.abs(p - q)));
  const cost = (v) => prev
    ? v.reduce((s, p) => s + nearest(p, prev), 0) + prev.reduce((s, p) => s + nearest(p, v), 0)
    : Math.abs(mean(v) - (lo + hi) / 2);
  let best = pool[0], bestCost = Infinity;
  for (const v of pool) {
    const c = cost(v);
    if (c < bestCost - 1e-9 || (Math.abs(c - bestCost) < 1e-9 && v[0] < best[0])) { best = v; bestCost = c; }
  }
  return best;
}

/** Pitch of a 1-based chord-tone index in a voicing. Indices past the top wrap up an octave. */
export function tonePitch(voicing, index, oct = 0) {
  const i = index - 1, n = voicing.length;
  return voicing[i % n] + 12 * Math.floor(i / n) + 12 * oct;
}

/** Pitch of a lead note stored as scale degree, accidental and octave. */
export function leadPitch({ deg, acc = 0, oct = 0 }, { tonic, mode }, register) {
  const base = pitchAtOrAbove(TONICS[tonic], register[0]);
  return base + MODES[mode][deg - 1] + acc + 12 * oct;
}

/**
 * Swing as a time warp. Time is cut into pairs of `unit` ticks; the first unit of each pair
 * is stretched to `ratio` of the pair and the second squeezed into the rest.
 */
export function swingTick(tick, unit, ratio) {
  if (ratio === 0.5) return tick;
  const pair = unit * 2;
  const base = Math.floor(tick / pair) * pair, p = tick - base;
  const warped = p < unit ? p * 2 * ratio : pair * ratio + (p - unit) * 2 * (1 - ratio);
  return base + Math.round(warped);
}
