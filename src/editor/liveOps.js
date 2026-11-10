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
