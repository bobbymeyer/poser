# Layered Composer: handoff

A browser-based, layer-oriented composition app. Static site, no accounts, no server. This file is the brief; `docs/song-format.md` is the file-format spec; `docs/example.song.json` is a valid example; `docs/mockups/` holds six UI mockups (`*.dc.html`, plain HTML with inline styles, open `Main.dc.html` first; `canvas.json` gives their layout).

## Concept

Songs are cut into **sections** (intro, verse, chorus, user-named, any whole number of bars). Inside a section everything is a layer: Rhythm (BPM, meter), Key (tonic, mode), Drums, Chords, Instruments (pattern lanes plus up to two played leads). The song is an **arrangement**, a row of section instances.

Principle: convention over configuration. Closed rails (fixed meter presets, 7 modes, 12 tonics). Enough room to be expressive within musical norms, not unlimited experimentation. Files store IDs, never raw values, and carry `rails_version` and `format_version`.

## Decisions (settled, do not reopen)

| Area | Decision |
| --- | --- |
| Storage | Fully local and static. IndexedDB via [Dexie](https://dexie.org/), `.song.json` files via File System Access API (Chrome/Edge) with `<a download>` fallback. Factory library is static JSON. Soundfonts stored by content hash. Call `navigator.storage.persist()`. Backup-age chip, snapshots, second-tab warning. Validate with [Ajv](https://ajv.js.org/) |
| Sound | SoundFont playback via [spessasynth_lib](https://github.com/spessasus/spessasynth_lib) / spessasynth_core. MIDI out via Web MIDI (Chrome, Edge, Firefox 108+, not Safari; HTTPS plus permission prompt). No VSTs |
| Timing | Lookahead scheduler. Per-lane latency offset. 480 ticks per quarter note; positions are relative to section start |
| Export | `.mid` from the resolver. WAV via OfflineAudioContext (soundfont lanes only; list skipped MIDI-out lanes in the dialog) |
| Mixer | Minimum: per-lane volume (CC7), pan (CC10), mute, solo, master |
| Sections | Containers holding meter, tonic, mode, BPM, chords, clips. **Linked instances** share all content including key/mode/BPM; **leads are per instance**. **Bake** = deep copy into a new section (default name "Chorus 2"). A key change is a baked section. No per-instance tonic |
| Mode vs key | Mode is a layer under tonic (Key group). No curves on tonic or mode; blocks only |
| Meter vs BPM | Meter is a layer under BPM (Rhythm group). Tempo changes are stepped between sections |

## Theory rules

| Topic | Rule |
| --- | --- |
| Chords | Entered as degrees; quality comes from the mode. Numeral case is output, not input |
| Minor dominant | Project toggle plus per-chord `!maj` / `!min` override |
| Extensions | Shift+Up/Down climbs the ladder (triad, 7, 9). Stops at 9, and before any note a half step above a chord tone |
| Inversion | Alt+Up/Down |
| Borrowed palette | ♭III, ♭VI, ♭VII, iv, V/V, V/vi (**list unconfirmed with the user**) |
| Sus/add | Menu: sus2, sus4, add9 |
| Voicing | Nearest-voicing inside a per-lane register window. Role tags (kit, bass, pad, arp, comp, lead) set defaults |

## Chord entry

Typing cursor with sticky length. Default length is section ÷ 4, minimum 1 bar; the last resize becomes the new default. Dragging an edge moves the shared boundary; blocks never overlap or leave gaps. `0` enters a rest.

## Instruments and recording

| Topic | Rule |
| --- | --- |
| Patterns | Store chord-tone indices (4 and up wrap an octave) |
| Leads | Store scale degree, accidental, octave |
| Keyboard zones | Three-key zones claimed by lanes: `123`, `qwe`, `asd`, `zxc` and so on. Number row, not numpad. Last assignment wins on conflict |
| Pattern lanes | Overdub per step when recording; play over when not |
| Drums | 10 GM pads on channel 10. Ghost / normal / accent velocity (⌥ / none / ⇧). Swing presets: Straight, Light, Medium, Shuffle. Choke for hats. Fill on the last bar of a section. Groove library by meter. Right-click clears a block |
| Leads | Pure overdub with pass tags, so a bad pass can be deleted |
| Mono/poly | A playback filter, not a recording mode. Priority last/lowest/highest. Legato only for MIDI out |
| Record context | Pinned to a chord (default, **unconfirmed**) or follow-song |
| Undo | One loop pass |

## Build order

Risk first, then pure logic, then UI.

| Phase | Build | Done when |
| --- | --- | --- |
| 0. Spike | Hardcoded note stream through spessasynth_lib with a lookahead scheduler, and the same stream over Web MIDI. Laptop test for key rollover (three keys at once) and input latency | A drum loop and bass hold tempo 5+ minutes; MIDI out works in Chrome; rollover is known to be acceptable or not |
| 1. Core, no UI | Theory module, resolver (`example.song.json` to timed events, with mono, swing, lead degrees), `.mid` export, Ajv validation | Example song plays from a test page and exports a valid `.mid`; unit tests cover every mode's chord table |
| 2. Chord lane | Section view with chords only: cursor, sticky length, edge drag, names and numeral case. Mode/tonic chips with the **mode audition drag**. Dexie autosave, save/open file | Type 1-5-6-4, hear it, drag Ionian to Aeolian, reload, still there |
| 3. Pattern lanes | Bass and pad pattern browser with audition, step editor, role defaults. Drum grid. About 10 hand-written factory patterns | A full groove sounds good with no editing |
| 4. Sections and arrangement | Arrangement strip, linked instances, active border and tint, bake, templates, overview toggle | Verse, chorus, verse, lifted chorus built by baking |
| 5. Live play | Zones and key overlay. Pattern, drum and lead recording. Count-in, pinned context, undo per pass, MIDI keyboard leads | Record a lead over a loop, delete a bad pass |
| 6. Sound sources | MIDI-out lane UI, latency offset, soundfont loader by hash, mixer, WAV bounce | Bounce works and lists skipped lanes |
| 7. Hardening | `storage.persist()`, backup chip, snapshots, second-tab warning, migrations | A version-1 file opens and migrates in a newer build |
| 8. Starter content | Author the library in the app, export as factory JSON, build the first-run project | A new visitor hears something good in ten seconds |

Start with phase 0 as a single HTML page.

## Deferred past v1

Pitch-grid piano roll editing for leads (the mockup shows a read view only), pivot-chord helper, tempo ramps, odd meters beyond 4/4, 3/4, 6/8 (meter is an ID, so more are added rows), share-by-link, MIDI clock out.

## Mockups

| File | Shows |
| --- | --- |
| `Main.dc.html` | Section view: arrangement strip, section header with chips and Bake, lane stack, bottom bar |
| `Chords.dc.html` | Mode audition, before/after on mode change, typing cursor, extension ladder, borrowed palette |
| `Drums.dc.html` | 16-step by 10-pad grid, velocity, swing, groove library |
| `Lead.dc.html` | Degree-based lead display, three tinted passes, per-pass delete menu |
| `Zones.dc.html` | Keyboard overlay with zones tinted per lane, resolved note names |
| `Overview.dc.html` | One card per section, width proportional to bars, key change chip highlighted |

Known mockup inconsistencies: the Kit lane header on Main shows two zone chips while Drums shows nine pad keys in three zones; Zones lists an `asd` conflict example that the keyboard itself does not show. Visual system: Inter and IBM Plex Mono, ground `#F3F1EC`, lane colors kit `#B5472B`, bass `#2E6B55`, pad `#7A5BA6`, lead `#B07B12`, chords `#2F4B8A`.

## Open questions for the user

1. Is the borrowed chord list right?
2. What happens to chords and clips when a section's meter changes?
3. Pinned or follow-song recording context by default (pinned assumed)?
4. Tick resolution of 480 (assumed).
