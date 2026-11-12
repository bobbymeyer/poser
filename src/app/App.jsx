import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { TONICS, METERS, BORROWED, DEGREES, resolveChord, resolveSong, loadSong, exportMidi } from "../core/index.js";
import { enter, remove, split, moveBoundary, climb, invert, setOptions, defaultLength, sectionLength, visibleCount } from "../editor/chordOps.js";
import { newProject } from "../editor/template.js";
import { setBars, setLane, applyEntry } from "../editor/patternOps.js";
import { addSection, copyLinked, moveInstance, bake, removeInstance, describeArrangement, bakeName } from "../editor/arrangeOps.js";
import { saveProject, loadLastProject, getProject, takeSnapshot, getSnapshot, markBackup, backupStatus, requestPersistence } from "../storage/db.js";
import { watchTabs } from "../storage/tabs.js";
import { SongsDialog } from "./Songs.jsx";
import { saveSongFile, openSongFile } from "../storage/files.js";
import { engine } from "../audio/engine.js";
import { reducer, sectionId, sectionOf, withSection, loopSong, songFrom } from "./project.js";
import ChordLane from "./ChordLane.jsx";
import LaneRow from "./LaneRow.jsx";
import { DrumEditor, StepEditor } from "./PatternEditors.jsx";
import { ArrangementStrip, Overview } from "./Arrangement.jsx";
import { applyTake } from "../editor/liveOps.js";
import { createLive, chordIndexAt } from "./live.js";
import { KeyboardOverlay, BottomBar } from "./Live.jsx";
import LeadView from "./LeadView.jsx";
import { SoundPanel, BounceDialog } from "./SoundPanel.jsx";
import { addLane, addableRoles } from "../editor/laneOps.js";

const LIVE_KEY = "layered-composer:live";
const loadLive = () => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LIVE_KEY)) || {}; } catch {}
  return { context: "follow", countIn: true, metronome: false, latencyMs: 0, quant: 120, ...saved, playMode: false };
};

const MODE_ROW = ["lydian", "ionian", "mixolydian", "dorian", "aeolian", "phrygian"]; // bright to dark
const ALL_MODES = [...MODE_ROW, "locrian"];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const pretty = (id) => id.replace("b", "♭").replace("#", "♯");
const BORROWED_LABEL = { bIII: "♭III", bVI: "♭VI", bVII: "♭VII", iv: "iv", "V/V": "V/V", "V/vi": "V/vi" };
const isTyping = (el) => el?.matches?.("input, select, textarea");

export default function App() {
  const [state, rawDispatch] = useReducer(reducer, null);
  const [tabLock, setTabLock] = useState(false);     // another tab is editing this song
  const [newer, setNewer] = useState(false);         // the file uses options from a newer version
  const [songsOpen, setSongsOpen] = useState(false);
  const [persisted, setPersisted] = useState(null);
  const locked = tabLock || newer;
  const lockRef = useRef(false);
  lockRef.current = locked;
  // A read-only song takes no edits. Selection and the caret still move.
  const dispatch = useCallback((a) => { if (lockRef.current && ["edit", "undo", "redo"].includes(a.type)) return; rawDispatch(a); }, []);
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
  const [live, setLiveState] = useState(loadLive);    // play mode and recording settings (kept per browser)
  const [recording, setRecording] = useState(false);
  const [lead, setLead] = useState({ window: 0, octave: 0 }); // where the lead keys sit on the scale
  const [liveNotes, setLiveNotes] = useState([]);     // lead notes of the pass being played
  const [muted, setMuted] = useState({});             // "instanceId|laneId" -> muted pass numbers (session only)
  const [chordNow, setChordNow] = useState(0);
  const [midiNote, setMidiNote] = useState("");
  const [bouncing, setBouncing] = useState(false);
  const fileHandle = useRef(null), auditionRef = useRef(null), noRestrike = useRef(false);
  const setLive = (patch) => setLiveState((cur) => {
    const next = { ...cur, ...patch };
    try { const { playMode, ...keep } = next; localStorage.setItem(LIVE_KEY, JSON.stringify(keep)); } catch {}
    return next;
  });
  useSyncExternalStore(engine.subscribe, () => engine.version);

  // Open the last project, or start a new one. Stored songs from older builds are migrated here.
  useEffect(() => {
    loadLastProject()
      .then((p) => { const r = p && loadSong(p); rawDispatch({ type: "load", song: r?.ok ? r.song : newProject() }); })
      .catch(() => rawDispatch({ type: "load", song: newProject() }));
  }, []);

  // Autosave to IndexedDB shortly after every change, and at once when the page is hidden.
  const song = state?.song, inst = state?.inst ?? 0;
  const pending = useRef(null);
  useEffect(() => {
    if (!song || locked) return;
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
  }, [song, locked]);

  // One tab edits a song at a time.
  const tabs = useMemo(() => watchTabs(() => setTabLock(true)), []);
  useEffect(() => () => tabs.close(), [tabs]);
  const songId = song?.id;
  useEffect(() => {
    if (!songId) return;
    let live = true;
    tabs.claim(songId).then((mine) => { if (live) setTabLock(!mine); });
    return () => { live = false; };
  }, [songId, tabs]);

  // A snapshot every ten minutes while the song is being edited.
  const snap = useRef({ song: null, at: 0 });
  useEffect(() => {
    const t = setInterval(() => {
      const cur = latest.current?.state?.song;
      if (!cur || lockRef.current) return;
      if (snap.current.song?.id !== cur.id) { snap.current = { song: cur, at: Date.now() }; return; }
      if (cur !== snap.current.song && Date.now() - snap.current.at >= 600000) {
        snap.current = { song: cur, at: Date.now() };
        takeSnapshot(cur, "automatic").catch(() => {});
      }
    }, 30000);
    return () => clearInterval(t);
  }, []);

  // Ask the browser to keep our storage once there is something worth keeping.
  const edited = (state?.past.length ?? 0) > 0;
  useEffect(() => { if (edited) requestPersistence().then(setPersisted); }, [edited]);

  // The song with whatever is being previewed (an edge drag, a hovered pattern) applied.
  const base = useMemo(() => {
    if (!song) return null;
    let b = preview ? withSection(song, inst, { chords: preview.chords }) : song;
    const lane = patPreview && b.lanes.find((l) => l.id === patPreview.laneId);
    if (lane) b = applyEntry(b, sectionId(b, inst), lane, patPreview.entry, patPreview.slot);
    // Muted lead passes are left out of what plays; the song itself keeps them.
    const here = b.arrangement[Math.min(inst, b.arrangement.length - 1)];
    const leads = { ...here.leads };
    let changed = false;
    for (const [laneId, v] of Object.entries(here.leads || {})) {
      const m = muted[`${here.id}|${laneId}`];
      if (m?.length) { leads[laneId] = { notes: v.notes.filter((n) => !m.includes(n.pass)) }; changed = true; }
    }
    if (changed) b = { ...b, arrangement: b.arrangement.map((a) => (a === here ? { ...a, leads } : a)) };
    return b;
  }, [song, inst, preview, patPreview, muted]);
  // What is on screen: the selected instance alone.
  const viewSong = useMemo(() => (base ? loopSong(base, inst, audition) : null), [base, inst, audition]);
  const resolved = useMemo(() => (viewSong ? resolveSong(viewSong) : null), [viewSong]);
  const full = useMemo(() => (song && (view === "overview" || bouncing) ? resolveSong(song) : null), [song, view, bouncing]);
  // What the engine plays: that loop, or the song from where "Play song" was pressed.
  const songMode = transport.mode === "song" && engine.playing;
  const engineSong = useMemo(
    () => (base ? (songMode ? songFrom(base, transport.start, inst, audition) : viewSong) : null),
    [base, viewSong, songMode, transport.start, inst, audition]);
  useEffect(() => {
    if (!engineSong) return;
    // A recorded pass is swapped in quietly: no re-striking of the chords that are sounding.
    engine.setSong(engineSong, noRestrike.current ? { restrike: false } : undefined);
    noRestrike.current = false;
  }, [engineSong]);

  const latest = useRef(null);
  latest.current = { state, view, transport, songMode, live, recording, lead, selected };

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
      replace(song, inst, group) { dispatch({ type: "edit", song, inst, group }); },
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

  // ---- live play and recording
  const liveCtl = useMemo(() => createLive(() => {
    const { state, live, recording, lead, selected } = latest.current;
    const section = sectionOf(state.song, state.inst), lanes = state.song.lanes;
    const sel = lanes.find((l) => l.id === selected);
    return {
      song: state.song, section, len: sectionLength(section), caret: state.caret, recording, lead,
      context: live.context, latencyMs: live.latencyMs, metronome: live.metronome,
      leadLaneId: (sel?.role === "lead" ? sel : lanes.find((l) => l.role === "lead"))?.id,
      kitSelected: sel?.role === "kit" ? sel.id : null,
    };
  }, {
    commit(take) {
      const { song, inst } = api.cur();
      noRestrike.current = true;
      api.replace(applyTake(song, inst, take, { quant: latest.current.live.quant }));
    },
    erase(take) { const { song, inst } = api.cur(); api.replace(applyTake(song, inst, take)); },
    live: setLiveNotes,
    slide: (d) => setLead((l) => ({ ...l, window: Math.max(-7, Math.min(14, l.window + d)) })),
    octave: (d) => setLead((l) => ({ ...l, octave: Math.max(-2, Math.min(2, l.octave + d)) })),
  }), [api]);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => liveCtl.tick(), 25);
    return () => clearInterval(t);
  }, [recording, liveCtl]);
  useEffect(() => { if (recording && !engine.playing) { liveCtl.end(); setRecording(false); } });
  useEffect(() => { if (!live.playMode) liveCtl.allOff(); }, [live.playMode, liveCtl]);
  // The overlay follows the chord under the playhead.
  useEffect(() => {
    if (!live.playMode) return;
    const t = setInterval(() => {
      const { state, live } = latest.current;
      if (!engine.playing || live.context !== "follow") return;
      setChordNow(chordIndexAt(state.song, sectionOf(state.song, state.inst), engine.localTicks(), state.caret));
    }, 100);
    return () => clearInterval(t);
  }, [live.playMode]);
  async function connectMidi() {
    if (!navigator.requestMIDIAccess) return setMidiNote("No Web MIDI in this browser");
    try {
      const access = await navigator.requestMIDIAccess();
      const hook = () => {
        let n = 0;
        for (const input of access.inputs.values()) { input.onmidimessage = (m) => liveCtl.midi(m.data[0], m.data[1], m.data[2]); n++; }
        setMidiNote(n ? `MIDI keyboard · ${n} input${n > 1 ? "s" : ""}` : "MIDI: no keyboard found");
      };
      access.onstatechange = hook;
      hook();
      engine.start();
    } catch { setMidiNote("MIDI access denied"); }
  }

  // ---- transport
  const act = useRef(null);
  act.current = {
    record() {
      if (recording) { liveCtl.end(); setRecording(false); return; }
      setLive({ playMode: true });
      liveCtl.begin();
      setRecording(true);
      if (!engine.playing || songMode) {
        setTransport({ mode: "loop", start: 0 });
        engine.setSong(viewSong);
        engine.play({ loop: true, countIn: live.countIn ? { beats: 4, bpm: sectionOf(song, inst).bpm } : null });
      }
    },
    loop() {
      if (engine.playing) return engine.stop();
      setTransport({ mode: "loop", start: 0 });
      engine.setSong(viewSong);
      engine.play({ loop: true });
    },
    song() {
      if (recording) { liveCtl.end(); setRecording(false); }
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
      if (e.code === "Escape") { auditionRef.current = null; setAudition(null); setMoreOpen(false); setLive({ playMode: false }); return; }
      if (mod || isTyping(e.target)) return;
      engine.start();
      if (e.code === "Space") { e.preventDefault(); if (e.shiftKey) act.current.record(); else act.current.loop(); return; }
      if (e.code === "Backquote") { e.preventDefault(); setLive({ playMode: !latest.current.live.playMode }); return; }
      if (latest.current.view !== "section") return;
      const play = latest.current.live.playMode;
      if (play && liveCtl.keydown(e)) { e.preventDefault(); return; }
      const digit = /^Digit(\d)$/.exec(e.code)?.[1];
      const { caret } = latest.current.state;
      let handled = true;
      if (digit && e.shiftKey && +digit >= 1 && +digit <= BORROWED.length) api.type(BORROWED[+digit - 1]);
      else if (digit && !e.shiftKey && !e.altKey && +digit >= 1 && +digit <= 7) api.type(DEGREES[+digit - 1]);
      else if (digit === "0" && !e.shiftKey) api.type("rest");
      else if (play) handled = false; // the rest are editing keys, off while keys play
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
    const onUp = (e) => { if (latest.current.live.playMode) liveCtl.keyup(e); };
    const onBlur = () => liveCtl.allOff();
    addEventListener("keydown", onKey);
    addEventListener("keyup", onUp);
    addEventListener("blur", onBlur);
    return () => { removeEventListener("keydown", onKey); removeEventListener("keyup", onUp); removeEventListener("blur", onBlur); };
  }, [api, liveCtl]);

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

  // ---- files and songs
  /** Put a song on screen. `doc` may be from an older build; it is migrated and checked first. */
  function show(doc, { label, fromFile = false, handle = null } = {}) {
    const r = loadSong(doc);
    if (!r.ok) { setProblem({ title: `${label} was rejected`, errors: r.errors }); return false; }
    engine.stop();
    fileHandle.current = handle;
    setProblem(null);
    setNewer(r.readOnly);
    setTabLock(false);
    setFileNote(fromFile ? `Opened ${label}${r.migratedFrom ? ` · migrated from format ${r.migratedFrom}` : ""}` : "");
    if (fromFile) markBackup(r.song.id);
    rawDispatch({ type: "load", song: r.song });
    return true;
  }
  /** Make sure the open song is stored before another one replaces it on screen. */
  async function flush() {
    const cur = latest.current.state?.song;
    if (cur && !lockRef.current) await saveProject(cur).catch(() => {});
  }
  async function saveFile() {
    try {
      const cur = latest.current.state.song;
      const handle = await saveSongFile(cur, fileHandle.current);
      if (handle === undefined) return;
      fileHandle.current = handle;
      markBackup(cur.id);
      setFileNote(`File saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    } catch (err) { setProblem({ title: "Could not save the file", errors: [{ path: "", message: err.message }] }); }
  }
  async function openFile() {
    let picked;
    try { picked = await openSongFile(); } catch (err) { return setProblem({ title: "Could not open the file", errors: [{ path: "", message: err.message }] }); }
    if (!picked) return;
    let doc;
    try { doc = JSON.parse(picked.text); } catch { return setProblem({ title: `${picked.name} is not a song file`, errors: [{ path: "", message: "It is not valid JSON." }] }); }
    await flush();
    // If this song is already in the browser, the file replaces it; keep a copy of what was there.
    const existing = doc?.id && (await getProject(doc.id).catch(() => null));
    if (show(doc, { label: picked.name, fromFile: true, handle: picked.handle }) && existing) takeSnapshot(existing, "before opening a file").catch(() => {});
  }
  async function newSong() {
    await flush();
    setSongsOpen(false);
    show(newProject(), { label: "New song" });
  }
  async function openStored(id) {
    await flush();
    const doc = await getProject(id);
    if (doc && show(doc, { label: doc.title || "Song" })) setSongsOpen(false);
  }
  async function restoreSnapshot(n) {
    const cur = latest.current.state.song;
    const doc = await getSnapshot(cur.id, n);
    if (!doc) return;
    await takeSnapshot(cur, "before restoring a snapshot").catch(() => {});
    if (show(doc, { label: "Snapshot" })) setSongsOpen(false);
  }
  async function useHere() {
    const id = latest.current.state.song.id;
    tabs.take(id);
    const doc = await getProject(id).catch(() => null); // the other tab's latest save
    const r = doc && loadSong(doc);
    if (r?.ok) rawDispatch({ type: "load", song: r.song });
    setTabLock(false);
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
  const backup = backupStatus(song.id);
  const touched = edited || song.updated_at !== song.created_at;
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
  const chordIdx = engine.playing && live.context === "follow" ? chordNow : chordIndexAt(song, stored, -1, state.caret);
  const pinned = blocks[Math.max(0, state.caret - 1)]?.chord;
  const muteKey = picked ? `${song.arrangement[inst].id}|${picked.id}` : "";

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
        <button className={`rec${recording ? " on" : ""}`} onClick={() => act.current.record()} aria-pressed={recording} data-testid="record" title="Record over the loop (⇧ Space)">● {recording ? "Recording" : "Record"}</button>
        <button className={`chip ${engine.status === "error" || saved === "error" ? "bad" : backup.stale && touched ? "stale" : ""}`} data-testid="save-chip"
          onClick={saveFile} title="Save a file backup">
          {locked ? "Read-only" : saved === "error" ? "Could not save in this browser" : saved === "saving" ? "Saving…" : "Saved locally"}
          {` · ${backup.text}`}
          {fileNote ? ` · ${fileNote}` : ""}
          {engine.status === "loading" ? " · Loading sounds…" : engine.status === "error" ? ` · No sound: ${engine.error}` : ""}
        </button>
        <span className="spacer" />
        <button onClick={saveFile}>Save file</button>
        <button onClick={openFile}>Open file</button>
        <label className="master">Master
          <input type="range" aria-label="Master volume" min="0" max="127" value={song.settings.master_volume}
            onChange={(e) => api.replace({ ...song, settings: { ...song.settings, master_volume: +e.target.value }, updated_at: new Date().toISOString() }, undefined, "master")} />
        </label>
        <button onClick={exportMid}>Export .mid</button>
        <button onClick={() => { engine.start(); setBouncing(true); }} data-testid="bounce-open">Bounce .wav</button>
        <button onClick={() => setSongsOpen(true)} data-testid="songs-open">Songs</button>
        <div className="seg" role="group" aria-label="View">
          <button className={view === "section" ? "on" : ""} onClick={() => setView("section")}>Section</button>
          <button className={view === "overview" ? "on" : ""} onClick={() => setView("overview")}>Overview</button>
        </div>
      </header>

      {locked && (
        <div className="lock" role="status" data-testid="lock">
          {tabLock
            ? <>This song is open in another tab, so this tab is read-only. <button onClick={useHere}>Use here</button></>
            : "This file uses options from a newer version of the app, so it is read-only here."}
        </div>
      )}
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
            onSelect={() => setSelected(lane.id)} onPatch={(patch, group) => api.replace(setLane(song, lane.id, patch), undefined, group)} />
        ))}
        <div className="add-lane">
          <select aria-label="Add lane" value="" onChange={(e) => { if (!e.target.value) return; const next = addLane(song, e.target.value); api.replace(next); setSelected(next.lanes.at(-1).id); }}>
            <option value="">Add lane…</option>
            {addableRoles(song).map((r) => <option key={r} value={r}>{cap(r)}</option>)}
          </select>
          <span className="hint">One kit and up to two leads. Arp and comp lanes play the pad patterns for now.</span>
        </div>
      </div>

      {picked && <SoundPanel song={song} lane={picked} onSong={(s, group) => api.replace(s, undefined, group)} />}
      {picked && picked.role === "kit" && <DrumEditor song={song} sectionId={sid} lane={picked} onSong={(s) => api.replace(s)} onPreview={setPatPreview} />}
      {picked && picked.role !== "kit" && picked.role !== "lead" && <StepEditor song={song} sectionId={sid} lane={picked} onSong={(s) => api.replace(s)} onPreview={setPatPreview} />}
      {live.playMode && (
        <KeyboardOverlay song={song} section={stored} at={{ chordIndex: chordIdx, ...lead }} onSong={(s) => api.replace(s)}
          contextLabel={live.context === "follow" && engine.playing ? "Bass and pad keys follow the chord under the playhead." : `Bass and pad keys are resolved against ${pinned ? `${pinned.numeral} (${pinned.name})` : "the chord before the cursor"}.`} />
      )}
      {picked && picked.role === "lead" && (
        <LeadView song={song} inst={inst} lane={picked} section={stored} sounding={resolved.notes.filter((n) => n.lane === picked.id)}
          liveNotes={liveNotes} recording={recording} lead={lead} quant={live.quant} setQuant={(q) => setLive({ quant: q })}
          muted={new Set(muted[muteKey] || [])}
          onMute={(p) => setMuted((m) => { const cur = m[muteKey] || []; return { ...m, [muteKey]: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] }; })}
          onSong={(s, group) => api.replace(s, undefined, group)} />
      )}

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
            <li><kbd>`</kbd> keyboard overlay</li>
            <li><kbd>⇧ Space</kbd> record</li>
          </ul>
        </div>
      </div>}
      </>}
      {songsOpen && (
        <SongsDialog current={song} persisted={persisted} locked={locked} onOpen={openStored} onNew={newSong} onRestore={restoreSnapshot}
          onDeletedCurrent={async () => { const next = await loadLastProject().catch(() => null); const r = next && loadSong(next); setSongsOpen(false); setTabLock(false); setNewer(false); rawDispatch({ type: "load", song: r?.ok ? r.song : newProject() }); }}
          onClose={() => setSongsOpen(false)} />
      )}
      {bouncing && <BounceDialog song={song} seconds={(full ?? resolveSong(song)).totalSec} onClose={() => setBouncing(false)} />}
      <BottomBar live={live} set={setLive} pinnedLabel={pinned ? `${pinned.numeral} (${pinned.name})` : "no chord"}
        onUndo={() => dispatch({ type: "undo" })} canUndo={state.past.length > 0} onMidi={connectMidi} midiNote={midiNote} />
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
