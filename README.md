# Layered Composer

A browser-based, layer-oriented composition app. Static site, no accounts, no server.

- [`HANDOFF.md`](HANDOFF.md): the brief, settled decisions, and build order
- [`docs/song-format.md`](docs/song-format.md): file-format spec, with [`docs/example.song.json`](docs/example.song.json)
- [`docs/mockups/`](docs/mockups): UI mockups (open `Main.dc.html` first)

## Status

Phases 0-4 are built: the timing spike, the core (theory, resolver, MIDI export, validation), the chord lane app, pattern lanes, and sections with an arrangement. Phases 5-8 are not started.

## Run

```bash
npm install
npm run dev
```

Open the printed URL for the app. `/player/` (phase 1 test page) and `/spike/` (phase 0) are still there. Run the unit tests with `npm test`.

The factory SoundFont, GeneralUser GS, ships in `public/soundfonts/` with its license.

## Phase 2 app (`src/app/`, `src/editor/`, `src/storage/`)

A section view with the chord lane only. Type degrees, hear them, change key and mode, and it is saved in the browser.

| Part | Where | Notes |
| --- | --- | --- |
| Chord editing | `src/editor/chordOps.js` | Pure functions: typing at the caret, delete, split, shared-edge drag, extension ladder, inversion. Blocks always tile with no gaps |
| New project | `src/editor/template.js` | One empty 8-bar section, with role defaults for the kit, bass and pad lanes |
| UI | `src/app/` | React. `project.js` holds the song, caret, sticky length and undo history |
| Live playback | `src/audio/engine.js`, `player.js` | The section loops; edits swap in without moving the playhead, and sounding chords are re-struck |
| Storage | `src/storage/` | Dexie autosave to IndexedDB after every change; `.song.json` save and open through the File System Access API, with download and upload as the fallback |

Mode audition: press a mode in the row and drag. The loop keeps playing in the mode under the pointer, changed blocks turn amber and show what they were, and releasing commits.

## Phase 3 pattern lanes

A new project has kit, bass and pad lanes already playing factory patterns, so typing chords gives a full groove. Select a lane to edit it.

| Part | Where | Notes |
| --- | --- | --- |
| Factory library | `src/factory/patterns.js` | 13 patterns in 4/4: five grooves and a fill, four bass, three pad. Drum patterns are written as one character per step |
| Pattern editing | `src/editor/patternOps.js` | Pure functions: lane layout (one pattern per lane, plus a kit fill on the last bar), drum cell cycling, step notes, grid and length changes, make unique |
| Drum grid | `src/app/PatternEditors.jsx` | Pads by steps. Click cycles off, normal, accent, ghost; right-click clears. Grid, swing and fill controls |
| Step editor | same file | Chord tones by steps for bass and pad. Click adds, drag holds, click removes |
| Library | same file | Hovering a pattern plays it against the running loop; clicking uses it. A groove brings its swing preset |

Editing a factory pattern first moves it to a new ID inside the song, so a song never holds an altered pattern under a factory ID, and the library always offers the original. Every clip that used the pattern follows the edit.

## Phase 4 sections and arrangement

| Part | Where | Notes |
| --- | --- | --- |
| Arrangement logic | `src/editor/arrangeOps.js` | Pure functions: add a section from a template, copy a linked instance, move, bake, remove, and a per-instance description (counts, key lift, tempo change) |
| Strip and overview | `src/app/Arrangement.jsx` | Click selects, drag moves, Alt-drag copies a linked instance. The overview shows one card per instance with chords, lane activity, and amber chips where key or tempo changes |
| Selected instance | `src/app/project.js` | Editor state now carries the selected instance; undo restores it |
| Transport | `src/app/App.jsx`, `src/audio/engine.js` | "Loop section" loops the selected instance. "Play song" plays from it to the end, and the screen follows the instance that is playing |

Rules as built:

- Instances of one section are linked and share everything except leads. The header shows "Edits affect N instances".
- **Bake** deep-copies the section for the selected instance only, under the next free name ("Chorus 2", then "Chorus 3"). A key change is a bake followed by a tonic change.
- A new section takes its key, tempo and lane patterns from the selected one and starts with no chords. Templates: Intro (4 bars), Verse, Chorus, Bridge (8), Outro (4).
- Patterns stay linked across sections and bakes until edited apart with "Make unique".
- Deleting the last instance of a section deletes the section. Undo brings it back.

Limits so far: meter fixed at 4/4, one pattern per lane per section (plus the kit fill), fixed instruments per role, and no song list, so "New" replaces the open song.

## Phase 0 spike (`spike/index.html`)

One HTML page that answers the three risk questions from the handoff:

| Question | How the page tests it |
| --- | --- |
| Does a lookahead scheduler hold tempo? | Plays the example song's verse (kit + bass) on a loop. A worker timer wakes every 25 ms and schedules the next 120 ms on the audio clock. Counters show late events, smallest lead time, and longest timer gap |
| Does the same stream work over Web MIDI? | Enable MIDI out, pick a port, tick both outputs. MIDI timestamps are mapped from the audio clock, so both outputs follow one clock. Each output has a latency offset in ms |
| Is laptop key rollover and input latency acceptable? | Twelve three-key zones turn green when all three keys register at once. Keys play notes. Latency cards show key event delay and audio latency; tapping Space along with the loop measures the offset by ear |

Scheduling uses `spessasynth_lib`'s `{ time }` option for sample-accurate note events and `MIDIOutput.send(data, timestamp)` for MIDI.

## Phase 1 core (`src/core/`)

| Module | Does |
| --- | --- |
| `rails.js` | The closed ID lists: tonics, modes, meters, grids, swing presets, chord IDs, roles |
| `theory.js` | Chords from degrees, names and numerals, extension ladder, borrowed palette, voicing, lead pitches, swing warp |
| `resolve.js` | Song document to timed notes: arrangement, stepped tempo map, patterns, choke, leads, mono filter |
| `midi.js` | `.mid` export (format 1: conductor track plus one track per audible lane) |
| `schema.js`, `validate.js` | JSON Schema checked with Ajv, then cross-reference checks. Errors name the field that failed |

`player/index.html` loads a song file, validates it, plays it through `src/audio/player.js`, and exports the `.mid`.

Rules the handoff left open, as implemented (each is one small place in the code if it needs to change):

| Topic | Rule |
| --- | --- |
| Minor dominant | With the project toggle on, a minor triad on degree 5 becomes major (V in Aeolian, Dorian). `quality` overrides it per chord |
| Chord ID case | Degrees are read in either case (`vi` and `VI` are the same chord), since the example file uses lower case. Borrowed `iv` is always the minor iv |
| Borrowed chords | `bIII`, `bVI`, `bVII`, `iv` come from the parallel Aeolian. `V/V` and `V/vi` are dominants a fifth above the mode's degree 5 and 6 |
| Pattern tone indices | Count up the voiced chord from the bottom and wrap an octave past its top, so index 4 is the octave on a triad and the seventh on a seventh chord |
| Voicing | Bass lanes put the chord's bass tone at the bottom of the register. Other lanes take the close-position inversion nearest the previous chord. Voice leading restarts each section so linked instances sound identical |
| Held steps | A pattern step held across a chord change is re-voiced at the change |
| Swing | A time warp from the kit's preset, at 16ths if the kit's main (first) pattern uses a 1/16 or finer grid, otherwise at 8ths. Fills ride the same warp. Applies to the kit and lanes with `swing_follow`; triplet-grid patterns and leads are left alone |
| Mono | A note either takes over when it starts or stays silent; a cut note does not come back. On a tie, `last` prefers the newer pass |
| Tempo | BPM counts quarter notes in every meter. `ramp_to_next` is read but ignored (ramps are deferred) |
