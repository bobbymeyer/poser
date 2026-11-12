# Layered Composer

A browser-based, layer-oriented composition app. Static site, no accounts, no server.

- [`HANDOFF.md`](HANDOFF.md): the brief, settled decisions, and build order
- [`docs/song-format.md`](docs/song-format.md): file-format spec, with [`docs/example.song.json`](docs/example.song.json)
- [`docs/mockups/`](docs/mockups): UI mockups (open `Main.dc.html` first)

## Status

Phases 0-7 are built: the timing spike, the core (theory, resolver, MIDI export, validation), the chord lane app, pattern lanes, sections with an arrangement, live play with recording, sound sources with a mixer and WAV bounce, and storage hardening with migrations. Phase 8 (starter content) is not started.

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

## Phase 5 live play and recording

| Part | Where | Notes |
| --- | --- | --- |
| Recording logic | `src/editor/liveOps.js` | Pure functions: zones and key map, claim and release, lead keys, MIDI pitch to lead note, and `applyTake`, which applies one loop pass of playing to the song |
| Live controller | `src/app/live.js` | Turns key presses and MIDI notes into sound, and into a take while recording. Hands the take over when the loop comes round |
| Overlay and bottom bar | `src/app/Live.jsx` | Keyboard tinted by lane with the note under each key, zone assignment, record context, count-in, latency, MIDI keyboard, undo |
| Lead view | `src/app/LeadView.jsx` | A piano roll across the lane's register. Draw a note by dragging on the grid, drag a note to move or re-pitch it, drag its right edge to stretch it, right-click or ⌫ to delete it. Passes are tinted, with mute and delete per pass, and dashed outlines for notes the mono filter silences |

How it behaves:

- **Play mode** (the "Keyboard overlay" button, or `` ` ``): letter keys play their zones and arrows move the lead keys. The number row still enters chords unless a lane claims it. Other editing keys are off. Esc leaves play mode.
- **Record** (`⇧ Space`) works over "Loop section". Each loop pass is applied in one step when the loop comes round, so you hear a pass back on the next time through and one pass is one undo step.
- **Drums:** a hit replaces that pad on the nearest step of whichever pattern is playing (groove or fill). ⌥ is a ghost, ⇧ an accent. Hold ⌫ and tap a pad to erase it; with the kit lane selected while recording, ⌫ alone clears the pattern.
- **Bass and pad:** keys are chord tones 1-3. A played step replaces what was on that step. They sound against the chord under the playhead ("Follow song") or the chord before the cursor ("Pinned").
- **Editing leads:** recorded and drawn notes are edited the same way. Notes snap to the key and to the Snap grid; ⇧ allows a note outside the key. A drawn note joins the newest pass.
- **Leads:** six keys are six scale degrees; ← → slide them along the scale, ↑ ↓ change octave, ⇧ raises a semitone. Notes snap to the quantize grid as recorded and are tagged with a pass number.
- **MIDI keyboard:** plays and records the selected lead lane (or the first one).
- **Timing:** key presses are placed where they were heard: the audio output latency is subtracted, plus the "Input latency" trim, which is saved per browser.

Recorded patterns follow the same rule as edited ones: a factory pattern becomes a copy in the song, and linked clips change together.

## Phase 6 sound sources, mixer and bounce

| Part | Where | Notes |
| --- | --- | --- |
| Lane logic | `src/editor/laneOps.js` | Pure functions: add a lane by role, delete a lane with its clips and lead notes, switch a lane between a SoundFont and MIDI out, mixer settings, and what a bounce skips |
| Engine | `src/audio/engine.js` | Loads the SoundFonts a song's lanes ask for, lists their presets, and holds MIDI access |
| SoundFont storage | `src/storage/db.js` | Files are stored in IndexedDB under `sha256:` plus their digest, the same hash the song file records |
| Sound panel | `src/app/SoundPanel.jsx` | Per lane: SoundFont and instrument, or MIDI port, channel and program; volume, pan, latency offset, voices; delete lane. Also the bounce dialog |
| Bounce | `src/audio/bounce.js` | Renders the SoundFont lanes through an `OfflineAudioContext` and encodes 44.1 kHz 16-bit stereo WAV |

How it works:

- **Several SoundFonts at once.** Each user SoundFont is loaded into the synth at its own bank offset, and a lane on it sends that bank before its program. The picker lists every bank of the file; a lane stores the bank only when it is not 0 (format version 2).
- **A SoundFont this browser does not have.** The lane plays on the factory SoundFont and is flagged "SoundFont not found", with the file name the song recorded. Loading a file puts the lane on it.
- **A MIDI port this machine does not have.** The lane is flagged "device not found" and is silent, as the spec says.
- **Mixer.** Master in the top bar; volume on each lane header; pan and latency offset in the sound panel. Dragging a slider is one undo step.
- **Bounce.** The dialog lists the audible MIDI-out lanes it will skip, renders the whole song with a 2.5 s tail, honours mute and solo, and applies the master volume.
- **Lanes.** One kit, up to two leads, any number of bass, pad, arp and comp. Arp and comp lanes use the pad patterns for now.

## Phase 7 hardening

| Part | Where | Notes |
| --- | --- | --- |
| Migrations | `src/core/migrate.js`, `loadSong` in `validate.js` | One function per format version, run in order on every open: files, stored songs and snapshots. The format is now version 2 (see `docs/song-format.md`) |
| Song list, snapshots, backups | `src/storage/db.js` | List, duplicate and delete songs; keep the last 20 snapshots per song; remember when each song was last saved to a file; ask for persistent storage |
| One tab per song | `src/storage/tabs.js` | A `BroadcastChannel` handshake. The tab that arrives second is read-only until "Use here" takes the song over |
| Songs dialog | `src/app/Songs.jsx` | Songs in this browser, snapshots of the open one, stored SoundFonts with sizes, and whether storage is persistent |

How it behaves:

- **Opening an older file.** It is migrated, then validated; the chip says which format it came from. Saving writes the current format. The original file is not touched.
- **Newer files.** A file with a newer `format_version` is refused. A file with a newer `rails_version` opens read-only.
- **Snapshots.** One every ten minutes while a song is being edited, one before a file replaces a song already in the browser, and one before a snapshot is restored.
- **Backup chip.** "Saved locally · last backed up N days ago". It turns amber once an edited song has never been saved to a file, or not for seven days. Clicking it saves a file. Opening a song from a file counts as a backup.
- **Persistent storage** is requested after the first edit. The Songs dialog shows the answer.
- **Read-only** means edits and undo are ignored and nothing is autosaved; playback and selection still work.

Limits so far: recording only over "Loop section", meter fixed at 4/4, one pattern per lane per section (plus the kit fill), and pass mute lasts for the session.

## Deploy

`.github/workflows/pages.yml` tests, builds and publishes `dist` to GitHub Pages on every push to `main`, and can be run by hand. bobbymeyer.com proxies `/poser/` to that deploy. Pages has to be switched on once under Settings -> Pages -> Source: GitHub Actions.

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
| Chord ID case | Version 1 files may hold lower-case degrees (`vi`); the migration upper-cases them. Lower-case `iv` is always the borrowed minor iv |
| Borrowed chords | `bIII`, `bVI`, `bVII`, `iv` come from the parallel Aeolian. `V/V` and `V/vi` are dominants a fifth above the mode's degree 5 and 6 |
| Pattern tone indices | Count up the voiced chord from the bottom and wrap an octave past its top, so index 4 is the octave on a triad and the seventh on a seventh chord |
| Voicing | Bass lanes put the chord's bass tone at the bottom of the register. Other lanes take the close-position inversion nearest the previous chord. Voice leading restarts each section so linked instances sound identical |
| Held steps | A pattern step held across a chord change is re-voiced at the change |
| Swing | A time warp from the kit's preset, at 16ths if the kit's main (first) pattern uses a 1/16 or finer grid, otherwise at 8ths. Fills ride the same warp. Applies to the kit and lanes with `swing_follow`; triplet-grid patterns and leads are left alone |
| Mono | A note either takes over when it starts or stays silent; a cut note does not come back. On a tie, `last` prefers the newer pass |
| Tempo | BPM counts quarter notes in every meter. `ramp_to_next` is read but ignored (ramps are deferred) |
