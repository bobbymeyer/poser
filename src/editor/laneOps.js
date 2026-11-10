// Lanes and their sound sources. Pure functions; none of them mutate.

import { ROLE_DEFAULTS, FACTORY_SOUNDFONT } from "./template.js";
import { ZONES } from "./liveOps.js";
import { prune } from "./patternOps.js";

const touch = (song) => ({ ...song, updated_at: new Date().toISOString() });
const NAMES = { kit: "Kit", bass: "Bass", pad: "Pad", arp: "Arp", comp: "Comp", lead: "Lead" };
const MAX = { kit: 1, lead: 2 };

/** Roles a lane can still be added for: one kit, at most two leads, any number of the rest. */
export const addableRoles = (song) =>
  Object.keys(NAMES).filter((role) => song.lanes.filter((l) => l.role === role).length < (MAX[role] ?? Infinity));

/** Add a lane with its role's defaults, on the factory SoundFont, with the first free zone(s). */
export function addLane(song, role) {
  if (!addableRoles(song).includes(role)) return song;
  const d = ROLE_DEFAULTS[role];
  const { label, instrument, zones, name: _, ...rest } = d;
  const count = song.lanes.filter((l) => l.role === role).length;
  let n = count + 1, id;
  do id = `l_${role}${n++}`; while (song.lanes.some((l) => l.id === id));
  const taken = new Set(song.lanes.flatMap((l) => l.zones || []));
  const free = ZONES.filter((z) => !taken.has(z) && !/\d/.test(z)); // leave the number row to chords
  const lane = {
    id, role, name: role === "lead" ? `Lead ${count + 1}` : count ? `${NAMES[role]} ${count + 1}` : NAMES[role],
    instrument: { backend: "soundfont", sf: FACTORY_SOUNDFONT.hash, ...instrument },
    zones: free.slice(0, zones.length), volume: 100, pan: 64, mute: false, solo: false, latency_ms: 0, ...rest,
  };
  const soundfonts = song.soundfonts.some((s) => s.hash === FACTORY_SOUNDFONT.hash) ? song.soundfonts : [...song.soundfonts, FACTORY_SOUNDFONT];
  return touch({ ...song, soundfonts, lanes: [...song.lanes, lane] });
}

/** Delete a lane, with its clips in every section and its lead notes in every instance. */
export function removeLane(song, laneId) {
  if (!song.lanes.some((l) => l.id === laneId)) return song;
  const sections = Object.fromEntries(Object.entries(song.sections).map(([id, s]) => {
    const { [laneId]: _, ...clips } = s.clips;
    return [id, { ...s, clips }];
  }));
  const arrangement = song.arrangement.map((a) => {
    if (!a.leads?.[laneId]) return a;
    const { [laneId]: _, ...leads } = a.leads;
    return { ...a, leads };
  });
  return prune(touch({ ...song, lanes: song.lanes.filter((l) => l.id !== laneId), sections, arrangement }));
}

const patchLane = (song, laneId, fn) => touch({ ...song, lanes: song.lanes.map((l) => (l.id === laneId ? fn(l) : l)) });

/** Play the lane from a SoundFont `{ hash, name }`, optionally a variation `bank`. The font joins the song's manifest if new. */
export function useSoundFont(song, laneId, font, program, bank = 0) {
  const soundfonts = song.soundfonts.some((s) => s.hash === font.hash) ? song.soundfonts : [...song.soundfonts, { hash: font.hash, name: font.name }];
  return patchLane({ ...song, soundfonts }, laneId, (l) => {
    const drums = l.role === "kit";
    const keep = l.instrument.backend === "soundfont" ? l.instrument.program : ROLE_DEFAULTS[l.role].instrument.program;
    return { ...l, instrument: { backend: "soundfont", sf: font.hash, program: program ?? keep, ...(bank ? { bank } : {}), ...(drums ? { drums: true } : {}) } };
  });
}

/** Send the lane to a MIDI port. `patch` may carry `port`, `channel` (1-16) and `program` (null = send none). */
export function useMidiOut(song, laneId, patch = {}) {
  return patchLane(song, laneId, (l) => {
    const cur = l.instrument.backend === "midi" ? l.instrument : { port: "", channel: l.role === "kit" ? 10 : 1, program: null };
    const next = { backend: "midi", port: cur.port, channel: cur.channel, program: cur.program, ...patch };
    return { ...l, instrument: { ...next, port: next.port || "(none)" } };
  });
}

/** Patch mixer and playback settings: `volume`, `pan`, `latency_ms`, `name`, `mono`... */
export const setLaneSettings = (song, laneId, patch) => patchLane(song, laneId, (l) => ({ ...l, ...patch }));

/** Lanes that a WAV bounce leaves out: audible MIDI-out lanes. */
export function bounceSkips(song) {
  const anySolo = song.lanes.some((l) => l.solo);
  return song.lanes.filter((l) => l.instrument.backend === "midi" && !l.mute && (!anySolo || l.solo)).map((l) => l.name);
}

/** The song as the bounce hears it: MIDI-out lanes silenced. */
export const soundFontOnly = (song) =>
  ({ ...song, lanes: song.lanes.map((l) => (l.instrument.backend === "midi" ? { ...l, mute: true, solo: false } : l)) });
