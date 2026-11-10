// Standard MIDI File (format 1) export from a resolved song.

import { resolveSong, audibleLanes, assignChannels } from "./resolve.js";

const vlq = (n) => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const text = (s) => [...new TextEncoder().encode(s)];
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];

/** Events are `{ tick, order, bytes }`; `order` breaks ties (offs, then setup, then ons). */
function track(events, endTick) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body = [];
  let last = 0;
  for (const e of events) { body.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; }
  body.push(...vlq(Math.max(0, endTick - last)), 0xff, 0x2f, 0x00);
  return [...text("MTrk"), ...u32(body.length), ...body];
}

/**
 * @param song     the song document
 * @param resolved optional result of `resolveSong(song)`
 * @returns Uint8Array of a `.mid` file: a conductor track, then one track per audible lane.
 */
export function exportMidi(song, resolved = resolveSong(song)) {
  const channels = assignChannels(song), audible = audibleLanes(song);
  const conductor = [{ tick: 0, order: 0, bytes: meta(0x03, text(song.title || "Untitled")) }];
  for (const t of resolved.tempo) {
    const us = Math.round(60e6 / t.bpm);
    conductor.push({ tick: t.tick, order: 1, bytes: meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]) });
  }
  for (const m of resolved.meters)
    conductor.push({ tick: m.tick, order: 1, bytes: meta(0x58, [m.num, Math.log2(m.den), m.den === 8 ? 36 : 24, 8]) });
  const tracks = [track(conductor, resolved.totalTicks)];

  for (const lane of song.lanes) {
    if (!audible.has(lane.id)) continue;
    const notes = resolved.notes.filter((n) => n.lane === lane.id);
    if (!notes.length) continue;
    const ch = channels.get(lane.id);
    const ev = [{ tick: 0, order: 0, bytes: meta(0x03, text(lane.name)) }];
    if (lane.instrument.program != null) ev.push({ tick: 0, order: 1, bytes: [0xc0 | ch, lane.instrument.program] });
    ev.push({ tick: 0, order: 1, bytes: [0xb0 | ch, 7, lane.volume] }, { tick: 0, order: 1, bytes: [0xb0 | ch, 10, lane.pan] });
    for (const n of notes) {
      ev.push({ tick: n.tick, order: 2, bytes: [0x90 | ch, n.pitch, n.vel] });
      ev.push({ tick: n.tick + n.len, order: 0, bytes: [0x80 | ch, n.pitch, 0] });
    }
    tracks.push(track(ev, resolved.totalTicks));
  }
  return new Uint8Array([...text("MThd"), ...u32(6), 0, 1, 0, tracks.length, resolved.ppq >> 8, resolved.ppq & 255, ...tracks.flat()]);
}
