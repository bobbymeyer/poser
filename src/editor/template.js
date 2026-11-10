// The project a new visitor starts with: one empty section and two audition lanes.
// The audition patterns hold each chord (pad) and its root (bass); held steps are re-voiced
// at every chord change, so typed chords sound as block chords. Phase 3 adds real patterns.

import { FORMAT_VERSION, RAILS_VERSION, METERS } from "../core/rails.js";

export const FACTORY_SOUNDFONT = {
  hash: "sha256:e2ed326ff44d15f78f2fdc72403b6fa6b77ee7266d3aad0d2198bc95797bc66c",
  name: "GeneralUser GS",
};

const newId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

export function newProject() {
  const now = new Date().toISOString(), bars = 8, len = bars * METERS["4/4"].barTicks;
  const mixer = { volume: 100, pan: 64, mute: false, solo: false, latency_ms: 0 };
  const sf = FACTORY_SOUNDFONT.hash;
  return {
    format: "song", format_version: FORMAT_VERSION, rails_version: RAILS_VERSION,
    id: newId("prj"), title: "Untitled song", created_at: now, updated_at: now,
    settings: { minor_dominant: true, master_volume: 100 },
    soundfonts: [FACTORY_SOUNDFONT],
    lanes: [
      { id: "l_bass", role: "bass", name: "Bass", instrument: { backend: "soundfont", sf, program: 33 }, zones: ["asd"], ...mixer,
        mono: { on: true, priority: "lowest", legato: false }, register: [28, 52], swing_follow: true },
      { id: "l_pad", role: "pad", name: "Pad", instrument: { backend: "soundfont", sf, program: 4 }, zones: ["qwe"], ...mixer, volume: 90,
        mono: { on: false, priority: "last", legato: false }, register: [50, 76], swing_follow: true },
    ],
    patterns: {
      pt_audition_bass: { kind: "pitched", role: "bass", name: "Roots", meter: "4/4", bars: 1, grid: "1/4", loop: "bar",
        steps: [{ step: 0, tones: [1], len: 4, vel: 96 }] },
      pt_audition_pad: { kind: "pitched", role: "pad", name: "Block chords", meter: "4/4", bars: 1, grid: "1/4", loop: "bar",
        steps: [{ step: 0, tones: [1, 2, 3, 4, 5], len: 4, vel: 78 }] },
    },
    sections: {
      s_1: { name: "Verse", bars, meter: "4/4", tonic: "C", mode: "ionian", bpm: 112, ramp_to_next: false, chords: [],
        clips: { l_bass: [{ pattern: "pt_audition_bass", start: 0, len }], l_pad: [{ pattern: "pt_audition_pad", start: 0, len }] } },
    },
    arrangement: [{ id: "i_1", section: "s_1", leads: {} }],
  };
}

/** Change a section's bar count. Clips that reached the old end follow the new one. */
export function setBars(section, bars) {
  const bar = METERS[section.meter].barTicks, oldLen = section.bars * bar, len = bars * bar;
  const clips = {};
  for (const [lane, list] of Object.entries(section.clips))
    clips[lane] = list.map((c) => (c.start + c.len >= oldLen && c.start < len ? { ...c, len: Math.max(c.len, len - c.start) } : c));
  return { ...section, bars, clips };
}
