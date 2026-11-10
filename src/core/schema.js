// JSON Schema for song files, format_version 1. Enumerations come straight from the rails.

import { TONICS, MODES, METERS, GRIDS, SWINGS, DEGREES, BORROWED, ROLES, MONO_PRIORITIES, SUS } from "./rails.js";

const int = (minimum, maximum) => ({ type: "integer", minimum, ...(maximum === undefined ? {} : { maximum }) });
const str = { type: "string", minLength: 1 };
const obj = (properties, required = Object.keys(properties)) =>
  ({ type: "object", properties, required, additionalProperties: false });
const mapOf = (schema) => ({ type: "object", additionalProperties: schema });

// Numeral case is output, not input, so degrees are accepted in either case.
const CHORD_IDS = [...new Set([...DEGREES, ...DEGREES.map((d) => d.toLowerCase()), ...BORROWED, "rest"])];
const midi7 = int(0, 127);

const instrument = {
  type: "object",
  required: ["backend"],
  properties: { backend: { enum: ["soundfont", "midi"] } },
  if: { properties: { backend: { const: "midi" } } },
  then: obj({ backend: {}, port: str, channel: int(1, 16), program: { anyOf: [midi7, { type: "null" }] } }),
  else: obj({ backend: {}, sf: str, program: midi7, drums: { type: "boolean" } }, ["backend", "sf", "program"]),
};

const lane = obj({
  id: str, role: { enum: ROLES }, name: { type: "string" }, instrument,
  zones: { type: "array", items: { type: "string", minLength: 3, maxLength: 3 } },
  volume: midi7, pan: midi7, mute: { type: "boolean" }, solo: { type: "boolean" },
  latency_ms: { type: "number" },
  mono: obj({ on: { type: "boolean" }, priority: { enum: MONO_PRIORITIES }, legato: { type: "boolean" } }),
  register: { type: "array", items: midi7, minItems: 2, maxItems: 2 },
  swing: { enum: Object.keys(SWINGS) }, swing_follow: { type: "boolean" },
  pads: { type: "array", items: midi7, minItems: 10, maxItems: 10 },
  choke: { type: "array", items: { type: "array", items: int(1, 10), minItems: 2 } },
}, ["id", "role", "name", "instrument", "zones", "volume", "pan", "mute", "solo", "latency_ms"]);

const patternBase = {
  kind: { enum: ["pitched", "drum"] }, role: { enum: ROLES }, name: { type: "string" },
  meter: { enum: Object.keys(METERS) }, bars: int(1), grid: { enum: Object.keys(GRIDS) }, loop: { enum: ["bar", "free"] },
};
const pattern = {
  type: "object",
  required: ["kind"],
  properties: { kind: patternBase.kind },
  if: { properties: { kind: { const: "drum" } } },
  then: obj({ ...patternBase, hits: { type: "array", items: obj({ step: int(0), pad: int(1, 10), lv: { enum: ["g", "n", "a"] } }) } },
    ["kind", "meter", "bars", "grid", "loop", "hits"]),
  else: obj({
    ...patternBase,
    steps: { type: "array", items: obj({
      step: int(0), tones: { type: "array", items: int(1, 16), minItems: 1 }, len: int(1), vel: int(1, 127), oct: int(-4, 4),
    }, ["step", "tones", "len", "vel"]) },
  }, ["kind", "meter", "bars", "grid", "loop", "steps"]),
};

const chord = obj({
  start: int(0), len: int(1), chord: { enum: CHORD_IDS },
  quality: { enum: ["maj", "min"] }, ext: { enum: [7, 9] }, sus: { enum: SUS }, add9: { type: "boolean" }, inv: int(0, 2),
}, ["start", "len", "chord"]);

const section = obj({
  name: { type: "string" }, bars: int(1),
  meter: { enum: Object.keys(METERS) }, tonic: { enum: Object.keys(TONICS) }, mode: { enum: Object.keys(MODES) },
  bpm: { type: "number", minimum: 20, maximum: 300 }, ramp_to_next: { type: "boolean" },
  chords: { type: "array", items: chord },
  clips: mapOf({ type: "array", items: obj({ pattern: str, start: int(0), len: int(1) }) }),
}, ["name", "bars", "meter", "tonic", "mode", "bpm", "chords", "clips"]);

const leadNote = obj({
  start: int(0), len: int(1), deg: int(1, 7), acc: int(-1, 1), oct: int(-4, 4), vel: int(1, 127), pass: int(0),
});

export const songSchema = obj({
  format: { const: "song" }, format_version: int(1), rails_version: int(1),
  id: str, title: { type: "string" }, created_at: str, updated_at: str,
  settings: obj({ minor_dominant: { type: "boolean" }, master_volume: midi7 }),
  soundfonts: { type: "array", items: obj({ hash: str, name: { type: "string" } }) },
  lanes: { type: "array", items: lane },
  patterns: mapOf(pattern),
  sections: mapOf(section),
  arrangement: { type: "array", items: obj({ id: str, section: str, leads: mapOf(obj({ notes: { type: "array", items: leadNote } })) }) },
});
