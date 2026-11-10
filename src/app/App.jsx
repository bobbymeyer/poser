import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { TONICS, METERS, BORROWED, DEGREES, resolveChord, resolveSong, validateSong, exportMidi } from "../core/index.js";
import { enter, remove, split, moveBoundary, climb, invert, setOptions, defaultLength, sectionLength, visibleCount } from "../editor/chordOps.js";
import { newProject } from "../editor/template.js";
import { setBars, setLane, applyEntry } from "../editor/patternOps.js";
import { addSection, copyLinked, moveInstance, bake, removeInstance, describeArrangement, bakeName } from "../editor/arrangeOps.js";
import { saveProject, loadLastProject } from "../storage/db.js";
import { saveSongFile, openSongFile } from "../storage/files.js";
import { engine } from "../audio/engine.js";
import { reducer, sectionId, sectionOf, withSection, loopSong, songFrom } from "./project.js";
import ChordLane from "./ChordLane.jsx";
import LaneRow from "./LaneRow.jsx";
import { DrumEditor, StepEditor } from "./PatternEditors.jsx";
import { ArrangementStrip, Overview } from "./Arrangement.jsx";

const MODE_ROW = ["lydian", "ionian", "mixolydian", "dorian", "aeolian", "phrygian"]; // bright to dark
const ALL_MODES = [...MODE_ROW, "locrian"];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const pretty = (id) => id.replace("b", "♭").replace("#", "♯");
const BORROWED_LABEL = { bIII: "♭III", bVI: "♭VI", bVII: "♭VII", iv: "iv", "V/V": "V/V", "V/vi": "V/vi" };
const isTyping = (el) => el?.matches?.("input, select, textarea");

export default function App() {
  const [state, dispatch] = useReducer(reducer, null);
  const [view, setView] = useState("section");      // "section" | "overview"
  const [transport, setTransport] = useState({ mode: "loop", start: 0 }); // what the play buttons last asked for
  const [audition, setAudition] = useState(null);   // mode being auditioned by a drag, not yet committed
  const [preview, setPreview] = useState(null);     // { chords, sticky } while an edge is dragged
  const [saved, setSaved] = useState("saved");      // "saving" | "saved" | "error"
  const [fileNote, setFileNote] = useState("");
  const [problem, setProblem] = useState(null);     // { title, errors } from a rejected file
  const [moreOpen, setMoreOpen] = useState(false);
  const [selected, setSelected] = useState("chords"); // "chords" or a lane id
  const [patPreview, setPatPreview] = useState(null); // { laneId, slot, entry } hovered in a library
  const fileHandle = useRef(null), auditionRef = useRef(null);
  useSyncExternalStore(engine.subscribe, () => `${engine.status}|${engine.playing}`);

  // Open the last project, or start a new one.
  useEffect(() => {
    loadLastProject()
      .then((p) => dispatch({ type: "load", song: p && validateSong(p).ok ? p : newProject() }))
      .catch(() => dispatch({ type: "load", song: newProject() }));
  }, []);

  // Autosave to IndexedDB shortly after every change, and at once when the page is hidden.
  const song = state?.song, inst = state?.inst ?? 0;
  const pending = useRef(null);
  useEffect(() => {
    if (!song) return;
    setSaved("saving");
    pending.current = song;
    const flush = () => {
      if (pending.current !== song) return;
      pending.current = null;
      saveProject(song).then(() => setSaved("saved"), () => setSaved("error"));
    };
    const t = setTimeout(flush, 250);
    addEventListener("pagehide", flush);
    return () => { clearTimeout(t); removeEventListener("pagehide", flush); };
  }, [song]);

  // The song with whatever is being previewed (an edge drag, a hovered pattern) applied.
  const base = useMemo(() => {
    if (!song) return null;
    let b = preview ? withSection(song, inst, { chords: preview.chords }) : song;
    const lane = patPreview && b.lanes.find((l) => l.id === patPreview.laneId);
    if (lane) b = applyEntry(b, sectionId(b, inst), lane, patPreview.entry, patPreview.slot);
    return b;
  }, [song, inst, preview, patPreview]);
  // What is on screen: the selected instance alone.
  const viewSong = useMemo(() => (base ? loopSong(base, inst, audition) : null), [base, inst, audition]);
  const resolved = useMemo(() => (viewSong ? resolveSong(viewSong) : null), [viewSong]);
  const full = useMemo(() => (song && view === "overview" ? resolveSong(song) : null), [song, view]);
  // What the engine plays: that loop, or the song from where "Play song" was pressed.
  const songMode = transport.mode === "song" && engine.playing;
  const engineSong = useMemo(
    () => (base ? (songMode ? songFrom(base, transport.start, inst, audition) : viewSong) : null),
    [base, viewSong, songMode, transport.start, inst, audition]);
  useEffect(() => { if (engineSong) engine.setSong(engineSong); }, [engineSong]);

  const latest = useRef(null);
  latest.current = { state, view, transport, songMode };

  // In song mode the screen follows the instance that is playing.
  useEffect(() => {
    if (!songMode) return;
    const t = setInterval(() => {
      const { state, transport } = latest.current;
      let tick = engine.positionTicks();
      if (tick < 0) return;
      for (let i = transport.start; i < state.song.arrangement.length; i++) {
        const len = sectionLength(sectionOf(state.song, i));
        if (tick < len) { if (i !== state.inst) dispatch({ type: "select", inst: i }); return; }
        tick -= len;
      }
    }, 100);
    return () => clearInterval(t);
  }, [songMode]);

  // ---- editing helpers (read the latest state so key handlers never go stale)
  const api = useMemo(() => {
    const cur = () => {
      const { song, inst, caret, sticky } = latest.current.state;
      const section = sectionOf(song, inst), len = sectionLength(section);
      const context = { tonic: section.tonic, mode: section.mode, minorDominant: !!song.settings.minor_dominant };
      return { song, inst, caret, section, len, context, sticky: sticky ?? defaultLength(section) };
    };
    const commit = (chords, extra = {}) => {
      const { song, inst, section } = cur();
      if (chords === section.chords && extra.caret === undefined) return;
      dispatch({ type: "edit", song: chords === section.chords ? song : withSection(song, inst, { chords }), ...extra });
    };
    return {
      cur,
      type(id) {
        const { section, len, caret, sticky, song } = cur();
        const r = enter(section.chords, len, caret, id, sticky);
        commit(r.chords, { caret: r.caret });
        if (r.chords !== section.chords) engine.audition(r.chords[caret], section, !!song.settings.minor_dominant);
      },
      remove() { const { section, caret } = cur(); const r = remove(section.chords, caret); commit(r.chords, { caret: r.caret }); },
      split() { const { section, caret } = cur(); const r = split(section.chords, caret); commit(r.chords, { caret: r.caret }); },
      active(fn) {
        const { section, caret, context, song } = cur();
        if (caret < 1) return;
        const chords = fn(section.chords, caret - 1, context);
        commit(chords);
        if (chords !== section.chords) engine.audition(chords[caret - 1], section, !!song.settings.minor_dominant);
      },
      section(patch) { const { song, inst } = cur(); dispatch({ type: "edit", song: withSection(song, inst, patch) }); },
      song(patch) { dispatch({ type: "edit", song: { ...cur().song, ...patch, updated_at: new Date().toISOString() } }); },
      replace(song, inst) { dispatch({ type: "edit", song, inst }); },
      bars(n) { const { song, inst } = cur(); dispatch({ type: "edit", song: setBars(song, sectionId(song, inst), n) }); },
    };
  }, []);

  // ---- arrangement
  const ops = useMemo(() => ({
    select: (i) => dispatch({ type: "select", inst: i }),
    move: (from, to) => api.replace(moveInstance(api.cur().song, from, to), to),
    copy: (from, at) => api.replace(copyLinked(api.cur().song, from, at), at),
    duplicate: () => { const { song, inst } = api.cur(); api.replace(copyLinked(song, inst), inst + 1); },
    add: (template) => { const { song, inst } = api.cur(); api.replace(addSection(song, inst, template), inst + 1); },
    bake: () => { const { song, inst } = api.cur(); api.replace(bake(song, inst), inst); },
    remove: () => { const { song, inst } = api.cur(); api.replace(removeInstance(song, inst), Math.min(inst, song.arrangement.length - 2)); },
  }), [api]);

  // ---- transport
  const act = useRef(null);
  act.current = {
    loop() {
      if (engine.playing) return engine.stop();
      setTransport({ mode: "loop", start: 0 });
      engine.setSong(viewSong);
      engine.play({ loop: true });
    },
    song() {
      setTransport({ mode: "song", start: inst });
      engine.setSong(songFrom(base, inst, inst, audition));
      engine.play({ loop: false });
    },
  };

  // ---- keyboard
  useEffect(() => {
    const onKey = (e) => {
      if (!latest.current.state) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === "KeyZ") { e.preventDefault(); dispatch({ type: e.shiftKey ? "redo" : "undo" }); return; }
      if (mod && e.code === "KeyS") { e.preventDefault(); saveFile(); return; }
      if (e.code === "Escape") { auditionRef.current = null; setAudition(null); setMoreOpen(false); return; }
      if (mod || isTyping(e.target)) return;
      engine.start();
      if (e.code === "Space") { e.preventDefault(); act.current.loop(); return; }
      if (latest.current.view !== "section") return;
      const digit = /^Digit(\d)$/.exec(e.code)?.[1];
      const { caret } = latest.current.state;
      let handled = true;
      if (digit && e.shiftKey && +digit >= 1 && +digit <= BORROWED.length) api.type(BORROWED[+digit - 1]);
      else if (digit && !e.shiftKey && !e.altKey && +digit >= 1 && +digit <= 7) api.type(DEGREES[+digit - 1]);
      else if (digit === "0" && !e.shiftKey) api.type("rest");
      else if (e.code === "ArrowLeft") dispatch({ type: "caret", caret: caret - 1 });
      else if (e.code === "ArrowRight") dispatch({ type: "caret", caret: caret + 1 });
      else if (e.code === "Home") dispatch({ type: "caret", caret: 0 });
      else if (e.code === "End") dispatch({ type: "caret", caret: Infinity });
      else if (e.code === "Backspace") api.remove();
      else if (e.code === "KeyS") api.split();
      else if (e.shiftKey && e.code === "ArrowUp") api.active((c, i, ctx) => climb(c, i, 1, ctx));
      else if (e.shiftKey && e.code === "ArrowDown") api.active((c, i, ctx) => climb(c, i, -1, ctx));
      else if (e.altKey && e.code === "ArrowUp") api.active((c, i) => invert(c, i, 1));
      else if (e.altKey && e.code === "ArrowDown") api.active((c, i) => invert(c, i, -1));
      else handled = false;
      if (handled) e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [api]);

  // ---- mode audition: press a mode, drag across the row, release to commit
  const startAudition = (e, mode) => {
    e.preventDefault();
    engine.start();
    setMoreOpen(false);
    const pick = (m) => { auditionRef.current = m; setAudition(m); };
    pick(mode);
    const move = (ev) => {
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-mode]");
      if (hit) pick(hit.dataset.mode);
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      const mode = auditionRef.current;
      pick(null);
      if (mode && mode !== api.cur().section.mode) api.section({ mode });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  // ---- files
  async function saveFile() {
    try {
      const handle = await saveSongFile(latest.current.state.song, fileHandle.current);
      if (handle === undefined) return;
      fileHandle.current = handle;
      setFileNote(`File saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    } catch (err) { setProblem({ title: "Could not save the file", errors: [{ path: "", message: err.message }] }); }
  }
  async function openFile() {
    let picked;
    try { picked = await openSongFile(); } catch (err) { return setProblem({ title: "Could not open the file", errors: [{ path: "", message: err.message }] }); }
    if (!picked) return;
    let doc;
    try { doc = JSON.parse(picked.text); } catch { return setProblem({ title: `${picked.name} is not a song file`, errors: [{ path: "", message: "It is not valid JSON." }] }); }
    const result = validateSong(doc);
    if (!result.ok) return setProblem({ title: `${picked.name} was rejected`, errors: result.errors });
    engine.stop();
    fileHandle.current = picked.handle;
    setProblem(null);
    setFileNote(`Opened ${picked.name}`);
    dispatch({ type: "load", song: doc });
  }
  function newSong() {
    if (!confirm("Start a new song? There is no song list yet, so save a file first if you want this one back.")) return;
    engine.stop();
    fileHandle.current = null;
    setFileNote("");
    dispatch({ type: "load", song: newProject() });
  }
  function exportMid() {
    const s = latest.current.state.song;
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([exportMidi(s)], { type: "audio/midi" })),
      download: `${(s.title || "song").replace(/[\\/:*?"<>|]+/g, " ").trim() || "song"}.mid`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  if (!state) return <div className="boot">Loading…</div>;

  // ---- derived view
  const infos = describeArrangement(song);
  const info = infos[inst];
  const sid = info.sectionId;
  const stored = song.sections[sid];
  const len = sectionLength(stored);
  const chords = preview ? preview.chords : stored.chords;
  const sticky = preview?.sticky ?? state.sticky ?? defaultLength(stored);
  const mode = audition ?? stored.mode;
  const minorDominant = !!song.settings.minor_dominant;
  const context = { tonic: stored.tonic, mode, minorDominant };
  const committed = { ...context, mode: stored.mode };
  const count = visibleCount(chords, len);
  const blocks = chords.slice(0, count).map((c) => {
    const chord = resolveChord(c, context);
    const before = audition && audition !== stored.mode ? resolveChord(c, committed) : null;
    return { start: c.start, end: Math.min(c.start + c.len, len), stored: c, chord, was: before && chord && before.numeral !== chord.numeral ? before.numeral : null };
  });
  const isFull = chords.length > 0 && chords.at(-1).start + chords.at(-1).len >= len;
  const active = blocks[state.caret - 1];
  const bar = METERS[stored.meter].barTicks;
  const shown = viewSong.sections[sid]; // includes a hovered pattern
  const picked = song.lanes.find((l) => l.id === selected);

  // Where the playhead is, relative to the instance on screen.
  let playing = -1;
  if (!engine.playing) engine.setView(0, Infinity);
  else if (!songMode) { engine.setView(0, Infinity); playing = inst; }
  else {
    let offset = 0;
    for (let i = transport.start; i < inst; i++) offset += sectionLength(sectionOf(song, i));
    engine.setView(inst >= transport.start ? offset : Infinity, len);
    playing = inst;
  }

  return (
    <div className="app" onPointerDown={() => engine.start()}>
      <header className="top">
        <strong className="brand">Layered</strong>
        <input className="title" aria-label="Song title" value={song.title} onChange={(e) => api.song({ title: e.target.value })} />
        <button className="play" onClick={() => act.current.loop()} aria-label={engine.playing ? "Stop" : "Loop section"} data-testid="play">
          {engine.playing ? "■" : "▶"}
        </button>
        <span className={`pill${engine.playing && !songMode ? " on" : ""}`}>Loop section</span>
        <button className={songMode ? "on" : ""} onClick={() => act.current.song()} data-testid="play-song">Play song</button>
        <span className={`chip ${engine.status === "error" || saved === "error" ? "bad" : ""}`} data-testid="save-chip">
          {saved === "error" ? "Could not save in this browser" : saved === "saving" ? "Saving…" : "Saved locally"}
          {fileNote ? ` · ${fileNote}` : ""}
          {engine.status === "loading" ? " · Loading sounds…" : engine.status === "error" ? ` · No sound: ${engine.error}` : ""}
        </span>
        <span className="spacer" />
        <button onClick={saveFile}>Save file</button>
        <button onClick={openFile}>Open file</button>
        <button onClick={exportMid}>Export .mid</button>
        <button onClick={newSong}>New</button>
        <div className="seg" role="group" aria-label="View">
          <button className={view === "section" ? "on" : ""} onClick={() => setView("section")}>Section</button>
          <button className={view === "overview" ? "on" : ""} onClick={() => setView("overview")}>Overview</button>
        </div>
      </header>

      {problem && (
        <div className="problem" role="alert">
          <b>{problem.title}</b>
          <button className="link" onClick={() => setProblem(null)}>Dismiss</button>
          <ul>{problem.errors.slice(0, 8).map((e, i) => <li key={i}>{e.path ? `${e.path}: ` : ""}{e.message}</li>)}</ul>
          {problem.errors.length > 8 && <p>and {problem.errors.length - 8} more.</p>}
        </div>
      )}

      {view === "overview" ? (
        <Overview song={song} resolved={full ?? resolveSong(song)} infos={infos} active={inst} playing={playing} ops={ops}
          onOpen={(i) => { ops.select(i); setView("section"); }} />
      ) : <>
      <ArrangementStrip infos={infos} active={inst} playing={playing} ops={ops} />

      <div className="section-head">
        <input className="name" aria-label="Section name" value={stored.name} onChange={(e) => api.section({ name: e.target.value })} />
        <span className="hint" data-testid="instance">instance {info.ordinal} of {info.count}</span>
        <label className="field">
          <small>Rhythm</small>
          <span>
            <input type="number" aria-label="BPM" min="40" max="240" value={stored.bpm}
              onChange={(e) => { const v = e.target.valueAsNumber; if (v >= 40 && v <= 240) api.section({ bpm: v }); }} />
            <span className="mono"> · {stored.meter}</span>
          </span>
        </label>
        <label className="field">
          <small>Key</small>
          <span>
            <select aria-label="Tonic" value={stored.tonic} onChange={(e) => api.section({ tonic: e.target.value })}>
              {Object.keys(TONICS).map((t) => <option key={t} value={t}>{pretty(t)}</option>)}
            </select>
            <span className="mono"> {cap(mode)}</span>
          </span>
        </label>
        <label className="field">
          <small>Bars</small>
          <span className="stepper">
            <button aria-label="Fewer bars" disabled={stored.bars <= 1} onClick={() => api.bars(stored.bars - 1)}>−</button>
            <span className="mono" data-testid="bars">{stored.bars}</span>
            <button aria-label="More bars" disabled={stored.bars >= 64} onClick={() => api.bars(stored.bars + 1)}>+</button>
          </span>
        </label>
        {info.count > 1 && <span className="affects">Edits affect {info.count} instances</span>}
        <label className="check" title="In minor modes, play the chord on degree 5 as major. Applies to the whole song.">
          <input type="checkbox" checked={minorDominant}
            onChange={(e) => api.song({ settings: { ...song.settings, minor_dominant: e.target.checked } })} />
          Major V in minor modes
        </label>
        <span className="spacer" />
        {info.count > 1 && (
          <button className="bake" onClick={ops.bake} title="Copy this section into a new one, for this instance only" data-testid="bake">
            Bake → {bakeName(song, sid)}
          </button>
        )}
      </div>

      <div className="card modes">
        <div className="card-title"><b>Mode</b> Press a mode and drag along the row to hear the chords re-skin. Release to commit, Esc to cancel.</div>
        <div className="mode-row">
          <div className="seg">
            {MODE_ROW.map((m) => (
              <button key={m} data-mode={m} className={m === mode ? "on" : ""} onPointerDown={(e) => startAudition(e, m)}>{cap(m)}</button>
            ))}
            <button className={mode === "locrian" ? "on" : ""} onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}>
              {mode === "locrian" ? "Locrian" : "More"} ▾
            </button>
          </div>
          {moreOpen && (
            <div className="more">
              <button onClick={() => { setMoreOpen(false); api.section({ mode: "locrian" }); }}>Locrian</button>
              <span>Its tonic chord is diminished, so it never feels settled.</span>
            </div>
          )}
        </div>
        <div className="bright">
          <span>brighter</span>
          <div className="track"><i style={{ left: `${(ALL_MODES.indexOf(mode) / (ALL_MODES.length - 1)) * 100}%` }} /></div>
          <span>darker</span>
        </div>
      </div>

      <div className="card lanes">
        <div className={`lane-row role-chords${selected === "chords" ? " selected" : ""}`} onClick={() => setSelected("chords")}>
          <div className="lane-head">
            <div className="lane-name"><i />Chords</div>
            <div className="hint">Typing cursor · length {sticky / bar} bar{sticky === bar ? "" : "s"}</div>
            <div className="hint"><kbd>1–7</kbd> enter degree</div>
          </div>
          <ChordLane
            section={stored} len={len} blocks={blocks} caret={state.caret} sticky={sticky} full={isFull}
            onCaret={(caret) => dispatch({ type: "caret", caret })}
            onDrag={(i, tick) => setPreview(moveBoundary(stored.chords, len, i, tick))}
            onDragEnd={() => {
              if (preview && preview.chords !== stored.chords)
                dispatch({ type: "edit", song: withSection(song, inst, { chords: preview.chords }), sticky: preview.sticky });
              setPreview(null);
            }}
          />
        </div>
        {song.lanes.map((lane) => (
          <LaneRow key={lane.id} lane={viewSong.lanes.find((l) => l.id === lane.id)} section={shown} len={len} patterns={viewSong.patterns}
            notes={resolved.notes.filter((n) => n.lane === lane.id)} selected={selected === lane.id}
            onSelect={() => setSelected(lane.id)} onPatch={(patch) => api.replace(setLane(song, lane.id, patch))} />
        ))}
      </div>

      {picked && picked.role === "kit" && <DrumEditor song={song} sectionId={sid} lane={picked} onSong={(s) => api.replace(s)} onPreview={setPatPreview} />}
      {picked && picked.role !== "kit" && picked.role !== "lead" && <StepEditor song={song} sectionId={sid} lane={picked} onSong={(s) => api.replace(s)} onPreview={setPatPreview} />}
      {picked && picked.role === "lead" && <div className="card"><p className="hint">Lead lanes are played and recorded live. That arrives in a later phase.</p></div>}

      {!picked && <div className="row2">
        <div className="card">
          <div className="card-title"><b>Selected block</b></div>
          {active?.chord ? (
            <>
              <div className="picked">
                <b>{active.chord.numeral}</b>
                <span>{active.chord.name}</span>
                <span className="mono tones">{active.chord.toneNames.join(" ")}</span>
              </div>
              <Choice label="Extension" hint="⇧↑ ⇧↓" value={active.chord.ext}
                options={[[5, "Triad"], [7, "7"], [9, "9"]]} disabled={(v) => v > active.chord.maxExt}
                onPick={(v) => api.active((c, i) => setOptions(c, i, { ext: v === 5 ? 0 : v }))} />
              <Choice label="Inversion" hint="⌥↑ ⌥↓" value={active.stored.inv || 0}
                options={[[0, "Root"], [1, "1st"], [2, "2nd"]]}
                onPick={(v) => api.active((c, i) => setOptions(c, i, { inv: v }))} />
              <Choice label="Sus / add" value={active.stored.sus || ""}
                options={[["", "None"], ["sus2", "sus2"], ["sus4", "sus4"]]}
                onPick={(v) => api.active((c, i) => setOptions(c, i, { sus: v }))}>
                <button className={active.stored.add9 ? "on" : ""} onClick={() => api.active((c, i) => setOptions(c, i, { add9: !c[i].add9 }))}>add9</button>
              </Choice>
              <Choice label="Quality" value={active.stored.quality || ""}
                options={[["", "From mode"], ["maj", "Major"], ["min", "Minor"]]}
                onPick={(v) => api.active((c, i) => setOptions(c, i, { quality: v }))} />
            </>
          ) : (
            <p className="hint">{active ? "A rest. Type a degree to replace it." : "Type 1–7 to enter a chord. The block before the cursor is the selected one."}</p>
          )}
        </div>

        <div className="card">
          <div className="card-title"><b>Borrowed palette</b> ⇧ + digit</div>
          <div className="palette">
            {BORROWED.map((id, i) => (
              <button key={id} className="mono" onClick={() => api.type(id)} title={`⇧${i + 1}`}>{BORROWED_LABEL[id]}</button>
            ))}
          </div>
          <div className="card-title keys-title"><b>Keys</b></div>
          <ul className="keys">
            <li><kbd>1–7</kbd> chord at cursor</li>
            <li><kbd>0</kbd> rest</li>
            <li><kbd>← →</kbd> move cursor</li>
            <li><kbd>⌫</kbd> delete before cursor</li>
            <li><kbd>S</kbd> split in half</li>
            <li><kbd>Space</kbd> loop section / stop</li>
            <li><kbd>⌘Z</kbd> undo</li>
            <li><kbd>⌘S</kbd> save file</li>
          </ul>
        </div>
      </div>}
      </>}
    </div>
  );
}

function Choice({ label, hint, value, options, disabled, onPick, children }) {
  return (
    <div className="choice">
      <span className="choice-label">{label}{hint && <small>{hint}</small>}</span>
      <div className="seg small">
        {options.map(([v, text]) => (
          <button key={v} className={v === value ? "on" : ""} disabled={disabled?.(v)} onClick={() => onPick(v)}>{text}</button>
        ))}
      </div>
      {children}
    </div>
  );
}
