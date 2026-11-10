# Layered Composer

A browser-based, layer-oriented composition app. Static site, no accounts, no server.

- [`HANDOFF.md`](HANDOFF.md): the brief, settled decisions, and build order
- [`docs/song-format.md`](docs/song-format.md): file-format spec, with [`docs/example.song.json`](docs/example.song.json)
- [`docs/mockups/`](docs/mockups): UI mockups (open `Main.dc.html` first)

## Status

Phase 0 (spike) is built. Phases 1-8 are not started.

## Run

```bash
npm install
npm run fetch-soundfont   # optional: downloads a free GM soundfont to public/soundfonts/ (gitignored)
npm run dev
```

Open the printed URL and follow the link to `/spike/`. Without `fetch-soundfont`, pick or drop any `.sf2` / `.sf3` file on the page.

## Phase 0 spike (`spike/index.html`)

One HTML page that answers the three risk questions from the handoff:

| Question | How the page tests it |
| --- | --- |
| Does a lookahead scheduler hold tempo? | Plays the example song's verse (kit + bass) on a loop. A worker timer wakes every 25 ms and schedules the next 120 ms on the audio clock. Counters show late events, smallest lead time, and longest timer gap |
| Does the same stream work over Web MIDI? | Enable MIDI out, pick a port, tick both outputs. MIDI timestamps are mapped from the audio clock, so both outputs follow one clock. Each output has a latency offset in ms |
| Is laptop key rollover and input latency acceptable? | Twelve three-key zones turn green when all three keys register at once. Keys play notes. Latency cards show key event delay and audio latency; tapping Space along with the loop measures the offset by ear |

Scheduling uses `spessasynth_lib`'s `{ time }` option for sample-accurate note events and `MIDIOutput.send(data, timestamp)` for MIDI.
