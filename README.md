# Layered Composer

A browser-based, layer-oriented composition app. Static site, no accounts, no server.

- [`HANDOFF.md`](HANDOFF.md): the brief, settled decisions, and build order
- [`docs/song-format.md`](docs/song-format.md): file-format spec, with [`docs/example.song.json`](docs/example.song.json)
- [`docs/mockups/`](docs/mockups): UI mockups (open `Main.dc.html` first)

## Status

Phase 0 (spike) and phase 1 (core, no UI) are built. Phases 2-8 are not started.

## Run

```bash
npm install
npm run fetch-soundfont   # optional: downloads a free GM soundfont to public/soundfonts/ (gitignored)
npm run dev
```

Open the printed URL and follow the links to `/player/` (phase 1) or `/spike/` (phase 0). Run the unit tests with `npm test`. Without `fetch-soundfont`, pick or drop any `.sf2` / `.sf3` file on the page.

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
| Swing | A time warp from the kit's preset, at 16ths if the section's kit patterns use a 1/16 or finer grid, otherwise at 8ths. Applies to the kit and lanes with `swing_follow`; triplet-grid patterns and leads are left alone |
| Mono | A note either takes over when it starts or stays silent; a cut note does not come back. On a tie, `last` prefers the newer pass |
| Tempo | BPM counts quarter notes in every meter. `ramp_to_next` is read but ignored (ramps are deferred) |
