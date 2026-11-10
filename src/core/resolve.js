// Resolver: a song document in, a flat list of timed notes out.
// Everything derived (pitches, swing, mono suppression, tempo map) is computed here and never stored.

import { PPQ, METERS, GRIDS, SWINGS, DRUM_VELOCITY } from "./rails.js";
import { resolveChord, bassVoicing, nearestVoicing, tonePitch, leadPitch, swingTick } from "./theory.js";

const LEGATO_OVERLAP = 10; // ticks a cut note is held past the next note-on, for MIDI-out legato

/**
 * @returns `{ ppq, totalTicks, totalSec, instances, tempo, meters, notes, secAt, tickAt }`.
 * `notes` are `{ lane, tick, len, pitch, vel, instance }` with absolute ticks, sorted by tick.
 * `secAt(tick)` and `tickAt(sec)` convert through the stepped tempo map.
 */
export function resolveSong(song) {
  const lanes = new Map(song.lanes.map((l) => [l.id, l]));
  const instances = [], tempo = [], meters = [], notes = [];
  let tick = 0;
  song.arrangement.forEach((inst, index) => {
    const section = song.sections[inst.section];
    const meter = METERS[section.meter];
    const len = section.bars * meter.barTicks;
    instances.push({ id: inst.id, section: inst.section, name: section.name, tick, len, bpm: section.bpm, meter: section.meter });
    if (!tempo.length || tempo.at(-1).bpm !== section.bpm) tempo.push({ tick, bpm: section.bpm });
    if (!meters.length || meters.at(-1).meter !== section.meter) meters.push({ tick, meter: section.meter, ...meter });
    for (const n of resolveSection(song, section, inst.leads, lanes)) notes.push({ ...n, tick: n.tick + tick, instance: index });
    tick += len;
  });

  // Mono is a playback filter applied across the whole timeline, per lane.
  let out = [];
  for (const lane of song.lanes) {
    const mine = notes.filter((n) => n.lane === lane.id);
    out = out.concat(lane.mono?.on && lane.role !== "kit" ? applyMono(mine, lane) : mine);
  }
  out.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);

  // Stepped tempo map -> seconds.
  let sec = 0;
  const marks = tempo.map((t, i) => {
    if (i) sec += ((t.tick - tempo[i - 1].tick) * 60) / (tempo[i - 1].bpm * PPQ);
    return { ...t, sec };
  });
  const secAt = (t) => {
    let m = marks[0];
    for (const k of marks) { if (k.tick <= t) m = k; else break; }
    return m ? m.sec + ((t - m.tick) * 60) / (m.bpm * PPQ) : 0;
  };
  const tickAt = (s) => {
    let m = marks[0];
    for (const k of marks) { if (k.sec <= s) m = k; else break; }
    return m ? m.tick + ((s - m.sec) * m.bpm * PPQ) / 60 : 0;
  };
  return { ppq: PPQ, totalTicks: tick, totalSec: secAt(tick), instances, tempo: marks, meters, notes: out, secAt, tickAt };
}

/** Chords of a section with names and absolute-in-section spans, dropping inactive ones. */
export function resolveChords(song, section) {
  const len = section.bars * METERS[section.meter].barTicks;
  const context = { tonic: section.tonic, mode: section.mode, minorDominant: !!song.settings?.minor_dominant };
  return section.chords
    .filter((c) => c.start < len)
    .map((c) => ({ start: c.start, end: Math.min(c.start + c.len, len), stored: c, chord: resolveChord(c, context) }))
    .sort((a, b) => a.start - b.start);
}

/**
 * One voicing per chord for a pitched lane, each led from the one before. Restarts every
 * section so that linked instances always sound the same. `chords` comes from `resolveChords`;
 * rests give null.
 */
export function laneVoicings(chords, lane) {
  let prev = null;
  return chords.map(({ chord }) => {
    if (!chord) return null;
    const v = lane.role === "bass" ? bassVoicing(chord, lane.register) : nearestVoicing(chord, lane.register, prev);
    prev = v;
    return v;
  });
}

/** Notes of one section instance, with ticks relative to the section start. */
export function resolveSection(song, section, leads = {}, lanes = new Map(song.lanes.map((l) => [l.id, l]))) {
  const meter = METERS[section.meter];
  const sectionLen = section.bars * meter.barTicks;
  const chords = resolveChords(song, section);
  const notes = [];

  // Swing comes from the kit lane and is shared by lanes that follow it.
  const kit = song.lanes.find((l) => l.role === "kit");
  const ratio = SWINGS[kit?.swing] ?? 0.5;
  // The swing unit comes from the kit's main (first) pattern: 16ths for a 1/16 or finer grid,
  // otherwise 8ths. Everything else in the section, fills included, rides the same warp.
  const firstKitClip = [...(kit && section.clips?.[kit.id] || [])].sort((x, y) => x.start - y.start)[0];
  const kitGrid = song.patterns[firstKitClip?.pattern]?.grid;
  const swingUnit = kitGrid === "1/16" || kitGrid === "1/32" ? GRIDS["1/16"] : GRIDS["1/8"];
  const canSwing = ratio !== 0.5 && !(section.meter === "6/8" && swingUnit === GRIDS["1/8"]);

  for (const [laneId, clips] of Object.entries(section.clips || {})) {
    const lane = lanes.get(laneId);
    if (!lane) continue;
    const swung = canSwing && (lane.role === "kit" || lane.swing_follow);
    const laneNotes = [];

    const voicings = lane.role === "kit" ? null : laneVoicings(chords, lane);

    for (const clip of clips) {
      const pattern = song.patterns[clip.pattern];
      if (!pattern || clip.start >= sectionLen) continue;
      const clipEnd = Math.min(clip.start + clip.len, sectionLen);
      const step = GRIDS[pattern.grid];
      const patLen = pattern.bars * METERS[pattern.meter].barTicks;
      const warp = swung && pattern.grid !== "1/16t" ? (t) => swingTick(t, swingUnit, ratio) : (t) => t;
      const push = (start, end, pitch, vel, extra) => {
        const a = warp(start), b = warp(end);
        laneNotes.push({ lane: laneId, tick: a, len: Math.max(1, b - a), pitch, vel, ...extra });
      };
      // "bar" patterns stay locked to the section's bar lines; "free" ones start with the clip.
      const origin = pattern.loop === "free" ? clip.start : Math.floor(clip.start / patLen) * patLen;
      for (let rep = origin; rep < clipEnd; rep += patLen) {
        if (pattern.kind === "drum") {
          for (const hit of pattern.hits) {
            const t = rep + hit.step * step;
            if (t < clip.start || t >= clipEnd) continue;
            push(t, t + step, lane.pads[hit.pad - 1], DRUM_VELOCITY[hit.lv], { pad: hit.pad });
          }
        } else {
          for (const s of pattern.steps) {
            const t = rep + s.step * step;
            if (t < clip.start || t >= clipEnd) continue;
            const end = Math.min(t + s.len * step, clipEnd);
            // A held step is re-voiced at every chord change it crosses.
            chords.forEach((c, i) => {
              const a = Math.max(t, c.start), b = Math.min(end, c.end);
              if (a >= b || !voicings[i]) return;
              for (const tone of s.tones) push(a, b, tonePitch(voicings[i], tone, s.oct), s.vel);
            });
          }
        }
      }
    }

    // Choke groups: a hit on one pad of a group cuts the others (open hat by closed hat).
    if (lane.role === "kit") {
      for (const group of lane.choke || []) {
        const hits = laneNotes.filter((n) => group.includes(n.pad)).sort((a, b) => a.tick - b.tick);
        hits.forEach((n, i) => {
          const next = hits.slice(i + 1).find((m) => m.tick > n.tick);
          if (next && next.tick < n.tick + n.len) n.len = next.tick - n.tick;
        });
      }
    }
    for (const { pad, ...n } of laneNotes) notes.push(n);
  }

  // Leads live on the instance and follow the key, never the chord.
  for (const [laneId, lead] of Object.entries(leads || {})) {
    const lane = lanes.get(laneId);
    if (!lane) continue;
    for (const n of lead.notes || []) {
      if (n.start >= sectionLen) continue;
      notes.push({
        lane: laneId, tick: n.start, len: Math.max(1, Math.min(n.len, sectionLen - n.start)),
        pitch: leadPitch(n, section, lane.register), vel: n.vel, pass: n.pass,
      });
    }
  }
  return notes;
}

/**
 * Mono filter. A note either takes over when it starts or never sounds:
 * `last` always takes over; `lowest` / `highest` take over only from a note they outrank.
 * Notes are not modified in the song; this returns the audible subset with cut lengths.
 */
export function applyMono(notes, lane) {
  const { priority = "last", legato = false } = lane.mono || {};
  const overlap = legato && lane.instrument?.backend === "midi" ? LEGATO_OVERLAP : 0;
  const better = (a, b) =>
    priority === "lowest" ? a.pitch < b.pitch :
    priority === "highest" ? a.pitch > b.pitch :
    (a.pass ?? 0) !== (b.pass ?? 0) ? (a.pass ?? 0) > (b.pass ?? 0) : a.pitch > b.pitch;
  const sorted = [...notes].sort((a, b) => a.tick - b.tick);
  const out = [];
  let current = null, end = 0; // `end` is where `current` would stop if left alone
  for (let i = 0; i < sorted.length; ) {
    let best = sorted[i], j = i + 1;
    for (; j < sorted.length && sorted[j].tick === best.tick; j++) if (better(sorted[j], best)) best = sorted[j];
    i = j;
    if (current && end > best.tick) {
      if (priority !== "last" && !better(best, current)) continue; // outranked: stays silent
      current.len = best.tick - current.tick + overlap;
    }
    current = { ...best };
    end = current.tick + current.len;
    out.push(current);
  }
  return out;
}

/** Lanes that should sound, honouring mute and solo. */
export function audibleLanes(song) {
  const anySolo = song.lanes.some((l) => l.solo);
  return new Set(song.lanes.filter((l) => !l.mute && (!anySolo || l.solo)).map((l) => l.id));
}

/** MIDI channel (0-15) per lane: kit on 9, MIDI-out lanes on their own, the rest packed around them. */
export function assignChannels(song) {
  const map = new Map(), taken = new Set([9]);
  for (const l of song.lanes) {
    if (l.role === "kit" || l.instrument.drums) map.set(l.id, 9);
    else if (l.instrument.backend === "midi") { map.set(l.id, l.instrument.channel - 1); taken.add(l.instrument.channel - 1); }
  }
  let next = 0;
  for (const l of song.lanes) {
    if (map.has(l.id)) continue;
    while (taken.has(next) && next < 15) next++;
    map.set(l.id, next);
    taken.add(next);
  }
  return map;
}
