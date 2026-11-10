# Song file format, v1

Companion to `example.song.json`. One JSON document per project, stored in IndexedDB and exported as `.song.json`.

## Principles

| Principle | Consequence |
| --- | --- |
| Store what the user chose, derive the rest | Chord names, resolved pitches, mono suppression, swing timing and section counts are computed on load and never saved |
| IDs, never raw values | `"meter": "7/8-2-2-3"`, `"chord": "bVII"`, `"mode": "dorian"`. Widening a rail later adds an ID and never invalidates old files |
| One time unit | Integer ticks, 480 per quarter note, relative to the section start. Bar length in ticks follows the section's meter (4/4 = 1920, 6/8 = 1440, 7/8 = 1680) |
| Sections are definitions | The arrangement lists instances that point at a definition. `×3` is a count of instances, not a stored field |

## Top-level keys

| Key | Holds |
| --- | --- |
| `format`, `format_version`, `rails_version` | `"song"`, file layout version, and the version of the allowed-ID lists |
| `id`, `title`, `created_at`, `updated_at` | Identity and timestamps |
| `settings` | `minor_dominant` (project toggle), `master_volume` |
| `soundfonts` | Manifest of `{ hash, name }`. The files are stored separately by hash |
| `lanes` | Song-wide lanes: instrument, zones, mixer, mono/poly, register |
| `patterns` | Pattern library for this project, so the file is self-contained |
| `sections` | Section definitions: meter, tonic, mode, BPM, chords, clips |
| `arrangement` | Ordered instances: `{ id, section, leads }` |

## Lanes

| Field | Notes |
| --- | --- |
| `role` | `kit`, `bass`, `pad`, `arp`, `comp`, `lead`. Sets defaults when the lane is created |
| `instrument` | Soundfont: `{ backend, sf, program, drums? }`. MIDI out: `{ backend, port, channel, program }` |
| `zones` | Keyboard zones claimed, such as `"asd"`. A lead claims two |
| `volume`, `pan` | 0-127, sent as CC 7 and CC 10 |
| `latency_ms` | Per-lane offset |
| `mono` | `{ on, priority: "last" \| "lowest" \| "highest", legato }`. Applied at playback, so notes are never deleted |
| `register` | MIDI note range for nearest-voicing |
| `swing` (kit), `swing_follow` (others) | Preset ID, or a flag to follow the kit |
| `pads`, `choke` (kit) | Ten MIDI note numbers, and groups of pad slots that cut each other |

MIDI port names are machine-specific. On import, a port that isn't found shows "device not found" on the lane and mutes it.

## Sections

| Field | Notes |
| --- | --- |
| `name`, `bars` | Any whole number of bars |
| `meter`, `tonic`, `mode`, `bpm` | Shared by every instance. A key change is a baked section |
| `ramp_to_next` | Tempo ramp into the next section |
| `chords` | `{ start, len, chord }`, plus optional `quality` (`maj` or `min`, the `!` override), `ext` (7 or 9), `sus`, `add9`, `inv` (0-2). `chord` is `I`-`VII`, a borrowed ID, or `rest`. Case is derived from the mode and not stored |
| `clips` | Per lane: `{ pattern, start, len }`. Clips that share a `pattern` ID are linked. Make unique clones the pattern |

Rule for shrinking a section: chords and clips that start at or after the new end are kept but inactive, and they sound again if the section grows.

## Patterns

| Field | Notes |
| --- | --- |
| `kind` | `pitched` or `drum` |
| `meter`, `bars`, `grid`, `loop` | Grid is `1/4`, `1/8`, `1/16`, `1/16t` or `1/32`. Loop is `bar` (restarts each bar) or `free` |
| Pitched `steps` | `{ step, tones, len, vel, oct? }`. `tones` are chord-tone indices, and 4+ wrap up an octave. `len` is in steps |
| Drum `hits` | `{ step, pad, lv }`. `pad` is 1-10 and `lv` is `g` (ghost), `n` (normal) or `a` (accent) |

## Leads

Stored on the arrangement instance, never on the section. A note is `{ start, len, deg, acc, oct, vel, pass }`: scale degree 1-7, accidental -1/0/1 for chromatic passing tones, octave relative to the lane's register, and the pass number it was recorded in.

## Derived, never stored

| Value | Computed from |
| --- | --- |
| Chord name and numeral case | Tonic + mode + chord ID + `minor_dominant` |
| Pitches | Chord tones in the lane's register, nearest-voiced |
| Mono suppression | Lane `mono` rule |
| Swing offsets | Swing preset and grid |
| Linked-instance count | Count of arrangement entries per section |

## Operations

| Action | Effect on the data |
| --- | --- |
| Bake an instance | Deep-copies the section definition with a new ID and name (`Chorus 2`), copies the instance's leads, and repoints that instance. Other instances stay on the original |
| Make unique (pattern) | Clones the pattern under a new ID and repoints that clip |
| Mode switch | Changes `mode` only. Nothing else is rewritten |
| Delete a lane | Removes the lane, its clips, and its lead notes |

## Versioning and validation

- `format_version` increments when the layout changes. Each change ships a migration function that runs on load.
- `rails_version` increments when allowed-ID lists grow. A file with a higher version than the app reports "uses options from a newer version" and opens read-only.
- Validate on import against a JSON Schema ([json-schema.org](https://json-schema.org/)) with a validator such as [Ajv](https://ajv.js.org/). Reject unknown IDs and report which field failed.

## IndexedDB stores

| Store | Key | Value |
| --- | --- | --- |
| `projects` | id | The song JSON, plus `updated_at` |
| `snapshots` | project id + counter | Recent copies of the JSON |
| `soundfonts` | hash | Blob and name |
| `library_patterns`, `library_sections`, `library_progressions` | id | User-saved entries. Factory entries ship as static JSON in the app |

## Open items

| Item | Question |
| --- | --- |
| Borrowed chord IDs | v1 list: `bIII`, `bVI`, `bVII`, `iv`, `V/V`, `V/vi`. Confirm |
| Changing a section's meter | Clips use meter-tagged patterns. Options are to swap in the nearest same-role pattern, or mute unfitted clips with a warning |
| Tick resolution | 480 per quarter handles 1/32 and triplets. Revisit only if swing needs finer offsets |
