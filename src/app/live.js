// Live playing: turns key presses (and MIDI notes) into sound, and into a take while recording.
// The take is handed over once per loop pass, so one pass is one undo step.

import { engine } from "../audio/engine.js";
import { resolveChords, laneVoicings, tonePitch, leadPitch, scaleNames, DRUM_VELOCITY } from "../core/index.js";
import { keyMap, leadKey, pitchToLead, emptyTake, takeIsEmpty } from "../editor/liveOps.js";
import { PAD_NAMES } from "../factory/patterns.js";

const NOTE = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const pitchName = (p) => `${NOTE[p % 12]}${Math.floor(p / 12) - 1}`;
const SHORT_PAD = ["Kick", "Snare", "C-hat", "O-hat", "Clap", "Crash", "Rim", "Lo tom", "Hi tom", "Ride"];

/**
 * What key `index` of a lane plays right now.
 * `at` is `{ chordIndex, window, octave, sharp }`: the chord the pattern lanes read, and the lead window.
 * @returns null when there is nothing to play (no chord, or past the last pad).
 */
export function liveKey(song, section, lane, index, at) {
  if (lane.role === "kit") {
    if (index >= lane.pads.length) return null;
    return { kind: "drum", pad: index + 1, pitch: lane.pads[index], label: SHORT_PAD[index] ?? PAD_NAMES[index], sub: `pad ${index + 1}` };
  }
  if (lane.role === "lead") {
    const note = leadKey(index, at);
    const pitch = leadPitch(note, section, lane.register);
    return { kind: "lead", note, pitch, label: pitchName(pitch), sub: `degree ${note.deg}${note.acc ? "♯" : ""}` };
  }
  const chords = resolveChords(song, section);
  const voicing = laneVoicings(chords, lane)[at.chordIndex];
  if (!voicing) return null;
  const pitch = tonePitch(voicing, index + 1);
  return { kind: "tone", tone: index + 1, pitch, label: pitchName(pitch), sub: `tone ${index + 1}` };
}

/** Index of the chord sounding at `tick`, or of the block before the caret when nothing is playing. */
export function chordIndexAt(song, section, tick, caret) {
  const chords = resolveChords(song, section);
  if (tick >= 0) return chords.findIndex((c) => c.start <= tick && tick < c.end);
  return Math.max(0, Math.min(chords.length - 1, caret - 1));
}

export { scaleNames };

/**
 * @param get      returns the latest `{ song, section, len, caret, recording, context, lead: { window, octave },
 *                 latencyMs, metronome, leadLaneId, kitSelected }`
 * @param actions  `{ commit(take), erase(take), live(notes), slide(d), octave(d) }`
 */
export function createLive(get, actions) {
  const held = new Map(); // key -> { laneId, pitch, rec }
  let take = emptyTake(), lastTick = -1, lastClick = -Infinity, bsHeld = false, bsUsed = false;

  const ago = (e) => get().latencyMs / 1000 + Math.max(0, performance.now() - (e?.timeStamp ?? performance.now())) / 1000;
  const recTick = (e) => (get().recording ? engine.heardTicks(ago(e)) : -1);
  const chordNow = () => {
    const c = get();
    const tick = c.context === "follow" && engine.playing ? engine.localTicks() : -1;
    return chordIndexAt(c.song, c.section, tick, c.caret);
  };
  const showLive = () => actions.live(take.leads.map((n) => ({ ...n })));

  function press(key, lane, info, vel, tick) {
    engine.noteOn(lane.id, info.pitch, vel);
    let rec = null;
    if (tick >= 0) {
      if (info.kind === "lead") { rec = { laneId: lane.id, start: tick, len: 0, ...info.note, vel }; take.leads.push(rec); showLive(); }
      else { rec = { laneId: lane.id, tick, tone: info.tone, len: 0, vel }; take.steps.push(rec); }
    }
    held.set(key, { laneId: lane.id, pitch: info.pitch, rec, start: tick });
  }
  function release(key, e) {
    const h = held.get(key);
    if (!h) return;
    held.delete(key);
    engine.noteOff(h.laneId, h.pitch);
    if (!h.rec) return;
    const end = engine.heardTicks(ago(e));
    h.rec.len = Math.max(30, end >= h.start ? end - h.start : get().len - h.start);
    if (h.rec.deg) showLive();
  }
  /** Hand over what was played this pass. Notes still held are cut at the end of the loop. */
  function flush() {
    for (const h of held.values()) if (h.rec) { h.rec.len = Math.max(30, get().len - h.start); h.rec = null; }
    if (!takeIsEmpty(take)) actions.commit(take);
    take = emptyTake();
    actions.live([]);
  }

  return {
    /** @returns true when the key was a live key and should not do anything else. */
    keydown(e) {
      const c = get();
      if (e.code === "Backspace") { bsHeld = true; bsUsed = false; return true; }
      if (/^Arrow/.test(e.code)) {
        if (e.code === "ArrowLeft") actions.slide(-1);
        if (e.code === "ArrowRight") actions.slide(1);
        if (e.code === "ArrowUp") actions.octave(1);
        if (e.code === "ArrowDown") actions.octave(-1);
        return true;
      }
      const k = keyMap(c.song).get(e.code);
      if (!k) return false;
      if (e.repeat || held.has(e.code)) return true;
      const lane = c.song.lanes.find((l) => l.id === k.laneId);
      const info = liveKey(c.song, c.section, lane, k.index, { chordIndex: chordNow(), ...c.lead, sharp: e.shiftKey });
      if (!info) return true;
      const tick = recTick(e);
      if (info.kind === "drum") {
        if (bsHeld) { bsUsed = true; actions.erase({ ...emptyTake(), erase: [{ laneId: lane.id, tick: Math.max(0, engine.localTicks()), pad: info.pad }] }); return true; }
        const lv = e.altKey ? "g" : e.shiftKey ? "a" : "n";
        engine.noteOn(lane.id, info.pitch, DRUM_VELOCITY[lv]);
        setTimeout(() => engine.noteOff(lane.id, info.pitch), 120);
        if (tick >= 0) take.hits.push({ laneId: lane.id, tick, pad: info.pad, lv });
        return true;
      }
      press(e.code, lane, info, info.kind === "lead" ? 100 : 92, tick);
      return true;
    },
    keyup(e) {
      if (e.code === "Backspace") {
        const c = get();
        if (bsHeld && !bsUsed && c.recording && c.kitSelected)
          actions.erase({ ...emptyTake(), erase: [{ laneId: c.kitSelected, tick: Math.max(0, engine.localTicks()), pad: null }] });
        bsHeld = false;
        return;
      }
      release(e.code, e);
    },
    /** A MIDI keyboard plays (and records) the lead lane. */
    midi(status, note, vel) {
      const c = get(), lane = c.song.lanes.find((l) => l.id === c.leadLaneId);
      if (!lane) return;
      const type = status & 0xf0, key = `midi:${note}`;
      if (type === 0x90 && vel > 0) {
        if (held.has(key)) release(key);
        press(key, lane, { kind: "lead", note: pitchToLead(note, c.section, lane.register), pitch: note }, vel, recTick());
      } else if (type === 0x80 || type === 0x90) release(key);
    },
    /** Call often while recording: notices the loop coming round, and keeps the metronome going. */
    tick() {
      const c = get();
      if (!c.recording || !engine.playing) { lastTick = -1; return; }
      const t = engine.heardTicks(0);
      if (t >= 0 && lastTick >= 0 && t < lastTick - 240) flush();
      lastTick = t;
      if (c.metronome && engine.startTime) {
        const beat = 60 / c.section.bpm, now = engine.now;
        const n = Math.ceil((now - engine.startTime) / beat), when = engine.startTime + n * beat;
        if (n >= 0 && when < now + 0.12 && when > lastClick + beat / 2) { engine.click(when, n % 4 === 0); lastClick = when; }
      }
    },
    begin() { take = emptyTake(); lastTick = -1; lastClick = -Infinity; actions.live([]); },
    end() { flush(); },
    allOff() { for (const key of [...held.keys()]) release(key); bsHeld = false; },
  };
}
