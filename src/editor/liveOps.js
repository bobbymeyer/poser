// Live play and recording. Pure functions; none of them mutate.
// A "take" is everything played during one loop pass. It is applied to the song in one step,
// so one pass is one undo step.

import { METERS, GRIDS, TONICS, MODES } from "../core/rails.js";
import { pitchAtOrAbove } from "../core/theory.js";
import { editPattern, notesOf, stepCount } from "./patternOps.js";

// The four rows of keys that can be claimed, as `KeyboardEvent.code` values, and their labels.
export const KEY_ROWS = [
  ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"],
  ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP"],
  ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon"],
  ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash"],
];
const CHAR = { Semicolon: ";", Comma: ",", Period: ".", Slash: "/" };
export const keyChar = (code) => CHAR[code] ?? code.replace(/^(Key|Digit)/, "").toLowerCase();
const CODE = Object.fromEntries(KEY_ROWS.flat().map((code) => [keyChar(code), code]));

/** Every three-key zone, named by its characters: "123", "qwe", "asd", "zxc"... */
export const ZONES = KEY_ROWS.flatMap((row) => [0, 3, 6].map((i) => row.slice(i, i + 3).map(keyChar).join("")));
const zoneCodes = (zone) => [...zone].map((ch) => CODE[ch]);

const touch = (song) => ({ ...song, updated_at: new Date().toISOString() });
const mod = (n, m) => ((n % m) + m) % m;

/** Key code -> `{ laneId, index }`, where index counts the lane's keys from 0. A later lane wins a conflict. */
export function keyMap(song) {
  const map = new Map();
  for (const lane of song.lanes) {
    let index = 0;
    for (const zone of lane.zones || []) for (const code of zoneCodes(zone)) if (code) map.set(code, { laneId: lane.id, index: index++ });
  }
  return map;
}

/** Give a zone to a lane. Whoever had it is released. @returns `{ song, released }` (a lane name or null). */
export function claimZone(song, laneId, zone) {
  let released = null;
  const lanes = song.lanes.map((l) => {
    const has = (l.zones || []).includes(zone);
    if (l.id === laneId) return has ? l : { ...l, zones: [...(l.zones || []), zone] };
    if (!has) return l;
    released = l.name;
    return { ...l, zones: l.zones.filter((z) => z !== zone) };
  });
  return { song: touch({ ...song, lanes }), released };
}

export function releaseZone(song, laneId, zone) {
  return touch({ ...song, lanes: song.lanes.map((l) => (l.id === laneId ? { ...l, zones: l.zones.filter((z) => z !== zone) } : l)) });
}

/** Songs made before phase 5 have no lead lane; give them one. */
export function ensureLead(song) {
  if (song.lanes.some((l) => l.role === "lead")) return song;
  const taken = new Set(song.lanes.flatMap((l) => l.zones || []));
  return { ...song, lanes: [...song.lanes, {
    id: "l_lead1", role: "lead", name: "Lead 1",
    instrument: { backend: "soundfont", sf: song.soundfonts[0]?.hash ?? "", program: 80 },
    zones: ["fgh", "jkl"].filter((z) => !taken.has(z)), volume: 96, pan: 64, mute: false, solo: false, latency_ms: 0,
    mono: { on: true, priority: "last", legato: false }, register: [60, 84],
  }] };
}

/**
 * The lead note under key `index` of a lead lane. `window` slides the keys along the scale
 * (0 puts degree 1 on the first key), `octave` shifts everything, `sharp` raises by a semitone.
 */
export function leadKey(index, { window = 0, octave = 0, sharp = false } = {}) {
  const step = window + index;
  return { deg: mod(step, 7) + 1, acc: sharp ? 1 : 0, oct: Math.floor(step / 7) + octave };
}

/** A MIDI pitch as a lead note: the inverse of `leadPitch`. Out-of-scale pitches become a degree raised a semitone. */
export function pitchToLead(pitch, { tonic, mode }, register) {
  const rel = pitch - pitchAtOrAbove(TONICS[tonic], register[0]);
  const pc = mod(rel, 12), scale = MODES[mode];
  let i = scale.indexOf(pc), acc = 0;
  if (i < 0) { i = scale.indexOf(pc - 1); acc = 1; }
  return { deg: i + 1, acc, oct: Math.floor(rel / 12) };
}

export function nextPass(song, inst, laneId) {
  const notes = song.arrangement[inst].leads?.[laneId]?.notes || [];
  return notes.reduce((m, n) => Math.max(m, n.pass), 0) + 1;
}

const withLead = (song, inst, laneId, fn) => touch({
  ...song,
  arrangement: song.arrangement.map((a, i) => {
    if (i !== inst) return a;
    const notes = fn(a.leads?.[laneId]?.notes || []);
    const leads = { ...a.leads, [laneId]: { notes } };
    if (!notes.length) delete leads[laneId];
    return { ...a, leads };
  }),
});

export const deleteLeadPass = (song, inst, laneId, pass) => withLead(song, inst, laneId, (notes) => notes.filter((n) => n.pass !== pass));
export const deleteLeadNote = (song, inst, laneId, index) => withLead(song, inst, laneId, (notes) => notes.filter((_, i) => i !== index));

export const emptyTake = () => ({ hits: [], erase: [], steps: [], leads: [] });
export const takeIsEmpty = (t) => !t.hits.length && !t.erase.length && !t.steps.length && !t.leads.length;

/** The clip of a lane sounding at `tick`, with its pattern and the step nearest the tick. */
function stepAt(song, section, laneId, tick) {
  const clip = (section.clips[laneId] || []).find((c) => c.start <= tick && tick < c.start + c.len);
  const pattern = clip && song.patterns[clip.pattern];
  if (!pattern) return null;
  const grid = GRIDS[pattern.grid], patLen = pattern.bars * METERS[pattern.meter].barTicks;
  const origin = pattern.loop === "free" ? clip.start : 0;
  return { id: clip.pattern, grid, step: Math.round(mod(tick - origin, patLen) / grid) % stepCount(pattern) };
}

/**
 * Apply one loop pass of playing to the song.
 *
 * take.hits   `{ laneId, tick, pad, lv }`              a drum hit replaces that pad on that step
 * take.erase  `{ laneId, tick, pad }` (pad null = all)  clears a pad, or everything, from the pattern playing at tick
 * take.steps  `{ laneId, tick, tone, len, vel }`        a played step replaces what was on that step
 * take.leads  `{ laneId, start, len, deg, acc, oct, vel }` kept as a new pass, snapped to `quant` ticks (0 = off)
 */
export function applyTake(song, inst, take, { quant = 120 } = {}) {
  const sid = song.arrangement[inst].section;
  const section = () => song.sections[sid];
  const len = section().bars * METERS[section().meter].barTicks;

  for (const e of take.erase) {
    const at = stepAt(song, section(), e.laneId, e.tick);
    if (at) song = editPattern(song, at.id, (p) => ({ ...p, hits: e.pad ? p.hits.filter((h) => h.pad !== e.pad) : [] })).song;
  }
  for (const h of take.hits) {
    const at = stepAt(song, section(), h.laneId, h.tick);
    if (!at) continue;
    song = editPattern(song, at.id, (p) => ({
      ...p, hits: [...p.hits.filter((x) => !(x.step === at.step && x.pad === h.pad)), { step: at.step, pad: h.pad, lv: h.lv }],
    })).song;
  }

  // Pitched steps: gather what was played on each step of each pattern, then replace those steps.
  const played = new Map();
  for (const s of take.steps) {
    const at = stepAt(song, section(), s.laneId, s.tick);
    if (!at) continue;
    const key = `${at.id}|${at.step}`;
    if (!played.has(key)) played.set(key, { ...at, notes: new Map() });
    played.get(key).notes.set(s.tone, { tone: s.tone, len: Math.max(1, Math.round(s.len / at.grid)), vel: s.vel });
  }
  const renamed = new Map();
  for (const g of played.values()) {
    const id = renamed.get(g.id) ?? g.id;
    const r = editPattern(song, id, (p) => {
      const total = stepCount(p);
      const keep = notesOf(p).filter((n) => n.step !== g.step);
      const add = [...g.notes.values()].map((n) => ({ step: g.step, tone: n.tone, len: Math.min(n.len, total - g.step), vel: n.vel, oct: 0 }));
      const groups = new Map();
      for (const n of [...keep, ...add].sort((a, b) => a.step - b.step || a.tone - b.tone)) {
        const k = `${n.step}|${n.len}|${n.vel}|${n.oct}`;
        if (!groups.has(k)) groups.set(k, { step: n.step, tones: [], len: n.len, vel: n.vel, ...(n.oct ? { oct: n.oct } : {}) });
        groups.get(k).tones.push(n.tone);
      }
      return { ...p, steps: [...groups.values()] };
    });
    song = r.song;
    renamed.set(g.id, r.id);
  }

  const byLane = new Map();
  for (const n of take.leads) byLane.set(n.laneId, [...(byLane.get(n.laneId) || []), n]);
  for (const [laneId, list] of byLane) {
    const pass = nextPass(song, inst, laneId);
    const fresh = list.map(({ laneId: _, ...n }) => {
      let start = quant ? Math.round(n.start / quant) * quant : Math.round(n.start);
      if (start >= len) start = 0;
      const min = quant ? quant / 2 : 30;
      return { start, len: Math.max(min, Math.min(Math.round(n.len), len - start)), deg: n.deg, acc: n.acc, oct: n.oct, vel: n.vel, pass };
    });
    song = withLead(song, inst, laneId, (notes) => [...notes, ...fresh]);
  }
  return song;
}

// ---- editing lead notes by hand

/** The nearest pitch that is in the section's scale (the lower one on a tie). */
export function snapToScale(pitch, { tonic, mode }) {
  const inScale = (p) => MODES[mode].includes(mod(p - TONICS[tonic], 12));
  return pitch + [0, -1, 1, -2, 2].find((d) => inScale(pitch + d));
}

/**
 * Draw a note: `{ start, len, deg, acc, oct, vel }`. It joins the newest pass (or starts pass 1),
 * so drawn notes and recorded ones are deleted and muted together.
 * @returns `{ song, index }`, the note's index in the lane's list.
 */
export function addLeadNote(song, inst, laneId, note) {
  const notes = song.arrangement[inst].leads?.[laneId]?.notes || [];
  const pass = notes.reduce((m, n) => Math.max(m, n.pass), 0) || 1;
  return { song: withLead(song, inst, laneId, (list) => [...list, { ...note, pass }]), index: notes.length };
}

/** Move, re-pitch or stretch a note: `patch` may carry `start`, `len`, `deg`, `acc`, `oct`. */
export function updateLeadNote(song, inst, laneId, index, patch) {
  const cur = song.arrangement[inst].leads?.[laneId]?.notes?.[index];
  if (!cur || Object.entries(patch).every(([k, v]) => cur[k] === v)) return song;
  return withLead(song, inst, laneId, (list) => list.map((n, i) => (i === index ? { ...n, ...patch } : n)));
}

// ---- editing several lead notes at once
// Each `...Op` returns a function from a lane's note list to a new list, so the editor can
// preview it on the notes on screen and then apply the same thing to the stored song.

/** Apply a list operation to a lane's lead notes on one instance. */
export const editLead = (song, inst, laneId, op) => {
  const before = song.arrangement[inst].leads?.[laneId]?.notes || [];
  const after = op(before);
  return after === before ? song : withLead(song, inst, laneId, () => after);
};

const only = (indices, fn) => (list) => {
  const set = new Set(indices);
  return list.map((n, i) => (set.has(i) ? fn(n, i) : n));
};

/** `[start, end]` covered by the chosen notes. */
export function leadSpan(list, indices) {
  const chosen = indices.map((i) => list[i]).filter(Boolean);
  return [Math.min(...chosen.map((n) => n.start)), Math.max(...chosen.map((n) => n.start + n.len))];
}

/** A note moved by scale steps (keeping any accidental) and then by semitones. */
export function shiftLeadNote(n, { steps = 0, semis = 0 }, section, register) {
  let out = n;
  if (steps) {
    const at = n.oct * 7 + n.deg - 1 + steps;
    out = { ...out, deg: mod(at, 7) + 1, oct: Math.floor(at / 7) };
  }
  if (semis) {
    const base = pitchAtOrAbove(TONICS[section.tonic], register[0]);
    const pitch = base + MODES[section.mode][out.deg - 1] + out.acc + 12 * out.oct + semis;
    out = { ...out, ...pitchToLead(pitch, section, register) };
  }
  return out;
}

/**
 * Move notes together: `dTick` in time (held inside the section as a group), `steps` up the
 * scale, `semis` chromatically. Nothing moves if a note would leave the MIDI range.
 */
export function moveOp(indices, { dTick = 0, steps = 0, semis = 0 }, section, register, len) {
  return (list) => {
    if (!indices.length) return list;
    const [a, b] = leadSpan(list, indices);
    const dt = Math.max(-a, Math.min(len - b, dTick));
    if (!dt && !steps && !semis) return list;
    const base = pitchAtOrAbove(TONICS[section.tonic], register[0]);
    const pitchOf = (n) => base + MODES[section.mode][n.deg - 1] + n.acc + 12 * n.oct;
    const next = only(indices, (n) => ({ ...shiftLeadNote(n, { steps, semis }, section, register), start: n.start + dt }))(list);
    return indices.every((i) => { const p = pitchOf(next[i]); return p >= 0 && p <= 127 && next[i].oct >= -4 && next[i].oct <= 4; }) ? next : list;
  };
}

/** Lengthen or shorten notes by the same amount, each kept between `min` and the end of the section. */
export const stretchOp = (indices, dLen, min, len) =>
  only(indices, (n) => ({ ...n, len: Math.max(Math.min(min, len - n.start), Math.min(len - n.start, n.len + dLen)) }));

/** Play the chosen notes backwards: each one's end becomes its start, mirrored inside their span. */
export function reverseOp(indices) {
  return (list) => {
    if (indices.length < 2) return list;
    const [a, b] = leadSpan(list, indices);
    return only(indices, (n) => ({ ...n, start: a + b - (n.start + n.len) }))(list);
  };
}

/** Snap the chosen notes' starts to a grid. */
export const quantizeOp = (indices, grid, len) =>
  only(indices, (n) => { const start = Math.min(Math.round(n.start / grid) * grid, len - 1); return { ...n, start, len: Math.min(n.len, len - start) }; });

export const velocityOp = (indices, vel) => only(indices, (n) => ({ ...n, vel: Math.max(1, Math.min(127, Math.round(vel))) }));

export const deleteOp = (indices) => (list) => { const set = new Set(indices); return list.filter((_, i) => !set.has(i)); };

/** The chosen notes as a clip: starts measured from the first one, passes left behind. */
export function copyLead(list, indices) {
  const chosen = indices.map((i) => list[i]).filter(Boolean).sort((x, y) => x.start - y.start);
  if (!chosen.length) return [];
  const t0 = chosen[0].start;
  return chosen.map(({ start, len, deg, acc, oct, vel }) => ({ dt: start - t0, len, deg, acc, oct, vel }));
}

/**
 * Paste a clip with its first note at `at`. Notes that would start past the end are dropped and
 * the last one is cut to fit. Pasted notes join the newest pass and come last in the list.
 */
export function pasteOp(clip, at, len) {
  return (list) => {
    const pass = list.reduce((m, n) => Math.max(m, n.pass), 0) || 1;
    const fresh = clip.filter((c) => at + c.dt < len)
      .map(({ dt, ...n }) => ({ start: at + dt, ...n, len: Math.min(n.len, len - at - dt), pass }));
    return fresh.length ? [...list, ...fresh] : list;
  };
}

/**
 * Turn a melody upside down: each chosen note is mirrored, by scale steps, around the earliest
 * one, which stays where it is. Accidentals flip with it. Nothing changes if a note would leave the range.
 */
export function invertOp(indices, section, register) {
  return (list) => {
    const chosen = indices.filter((i) => list[i]);
    if (chosen.length < 2) return list;
    const axis = chosen.reduce((a, i) => (list[i].start < list[a].start ? i : a), chosen[0]);
    const at = (n) => n.oct * 7 + n.deg - 1, mid = at(list[axis]);
    const base = pitchAtOrAbove(TONICS[section.tonic], register[0]);
    const next = only(chosen, (n, i) => {
      if (i === axis) return n;
      const k = 2 * mid - at(n);
      return { ...n, deg: mod(k, 7) + 1, oct: Math.floor(k / 7), acc: -n.acc || 0 };
    })(list);
    const ok = chosen.every((i) => {
      const n = next[i], p = base + MODES[section.mode][n.deg - 1] + n.acc + 12 * n.oct;
      return p >= 0 && p <= 127 && n.oct >= -4 && n.oct <= 4;
    });
    return ok ? next : list;
  };
}

/**
 * Halve or double the chosen notes in time (`factor` 0.5 or 2): lengths and the gaps between
 * them scale together from the first note. Notes pushed past the end of the section are
 * dropped, and one that crosses it is cut to fit.
 */
export function scaleTimeOp(indices, factor, len) {
  return (list) => {
    const chosen = new Set(indices.filter((i) => list[i]));
    if (!chosen.size) return list;
    const [a] = leadSpan(list, [...chosen]);
    return list.flatMap((n, i) => {
      if (!chosen.has(i)) return [n];
      const start = Math.round(a + (n.start - a) * factor);
      if (start >= len) return [];
      return [{ ...n, start, len: Math.max(10, Math.min(Math.round(n.len * factor), len - start)) }];
    });
  };
}
