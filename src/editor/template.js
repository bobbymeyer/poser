// The project a new visitor starts with: one empty section with kit, bass and pad lanes
// already playing factory patterns, so typed chords come out as a full groove.

import { FORMAT_VERSION, RAILS_VERSION, METERS } from "../core/rails.js";
import { FACTORY_BY_ID, DEFAULT_PADS } from "../factory/patterns.js";
import starter from "../factory/starter.song.json";

export const FACTORY_SOUNDFONT = {
  hash: "sha256:e2ed326ff44d15f78f2fdc72403b6fa6b77ee7266d3aad0d2198bc95797bc66c",
  name: "GeneralUser GS",
};

const newId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

/** Lane settings a role starts with. */
export const ROLE_DEFAULTS = {
  kit: { name: "Kit", instrument: { program: 0, drums: true }, label: "Standard Kit", zones: ["zxc", "vbn", "m,."], swing: "straight", pads: DEFAULT_PADS, choke: [[3, 4]] },
  bass: { name: "Bass", instrument: { program: 33 }, label: "Fingered Bass", zones: ["asd"],
    mono: { on: true, priority: "lowest", legato: false }, register: [28, 52], swing_follow: true },
  pad: { name: "Pad", instrument: { program: 89 }, label: "Warm Pad", zones: ["qwe"], volume: 84,
    mono: { on: false, priority: "last", legato: false }, register: [50, 76], swing_follow: true },
  arp: { name: "Arp", instrument: { program: 46 }, label: "Harp", zones: ["rty"], volume: 88,
    mono: { on: false, priority: "last", legato: false }, register: [55, 84], swing_follow: true },
  comp: { name: "Comp", instrument: { program: 4 }, label: "Electric Piano", zones: ["uio"], volume: 88,
    mono: { on: false, priority: "last", legato: false }, register: [48, 74], swing_follow: true },
  lead: { name: "Lead 1", instrument: { program: 80 }, label: "Square Lead", zones: ["fgh", "jkl"], volume: 96,
    mono: { on: true, priority: "last", legato: false }, register: [60, 84] },
};

function lane(role, sf) {
  const { label, instrument, ...rest } = ROLE_DEFAULTS[role];
  return { id: role === "lead" ? "l_lead1" : `l_${role}`, role, instrument: { backend: "soundfont", sf, ...instrument },
    volume: 100, pan: 64, mute: false, solo: false, latency_ms: 0, ...rest };
}

export function newProject() {
  const now = new Date().toISOString(), bars = 8, bar = METERS["4/4"].barTicks, len = bars * bar;
  const sf = FACTORY_SOUNDFONT.hash;
  const use = ["pt_rock16", "pt_fill1", "pt_bass8", "pt_pad1"];
  return {
    format: "song", format_version: FORMAT_VERSION, rails_version: RAILS_VERSION,
    id: newId("prj"), title: "Untitled song", created_at: now, updated_at: now,
    settings: { minor_dominant: true, master_volume: 100 },
    soundfonts: [FACTORY_SOUNDFONT],
    lanes: [lane("kit", sf), lane("bass", sf), lane("pad", sf), lane("lead", sf)],
    patterns: Object.fromEntries(use.map((id) => [id, structuredClone(FACTORY_BY_ID[id].pattern)])),
    sections: {
      s_1: { name: "Verse", bars, meter: "4/4", tonic: "C", mode: "ionian", bpm: 112, ramp_to_next: false, chords: [],
        clips: {
          l_kit: [{ pattern: "pt_rock16", start: 0, len: len - bar }, { pattern: "pt_fill1", start: len - bar, len: bar }],
          l_bass: [{ pattern: "pt_bass8", start: 0, len }],
          l_pad: [{ pattern: "pt_pad1", start: 0, len }],
        } },
    },
    arrangement: [{ id: "i_1", section: "s_1", leads: {} }],
  };
}

/** The song a first-time visitor is given: a short finished piece to play, pull apart and change. */
export function starterProject() {
  const now = new Date().toISOString();
  return { ...structuredClone(starter), id: newId("prj"), created_at: now, updated_at: now };
}
