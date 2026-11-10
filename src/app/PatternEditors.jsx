import { useEffect, useRef, useState } from "react";
import { GRIDS, SWINGS, METERS } from "../core/index.js";
import { PAD_NAMES, FACTORY_BY_ID } from "../factory/patterns.js";
import {
  lanePatterns, linkCount, editPattern, makeUnique, blankPattern, applyEntry, setFill, setLane, libraryFor, stepCount,
  cycleHit, clearHit, notesOf, toggleNote, setNoteLen, setGrid, setPatternBars,
} from "../editor/patternOps.js";
import { engine } from "../audio/engine.js";

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const GRID_LABEL = { "1/4": "1/4", "1/8": "1/8", "1/16": "1/16", "1/16t": "1/16 triplet", "1/32": "1/32" };
const TONE_ROWS = [6, 5, 4, 3, 2, 1];

function Seg({ value, options, onPick, label }) {
  return (
    <div className="seg small" role="group" aria-label={label}>
      {options.map(([v, text]) => <button key={v} className={v === value ? "on" : ""} onClick={() => onPick(v)}>{text}</button>)}
    </div>
  );
}

/** Marks the header cell of the step now playing, without re-rendering. */
function useStepCursor(ref, pattern, from, to) {
  useEffect(() => {
    if (!pattern) return;
    const step = GRIDS[pattern.grid], patLen = pattern.bars * METERS[pattern.meter].barTicks;
    let raf, last = null;
    const tick = () => {
      const t = engine.localTicks();
      const now = t >= from && t < to ? Math.floor((t % patLen) / step) : -1;
      if (now !== last && ref.current) {
        ref.current.querySelector(".now")?.classList.remove("now");
        ref.current.querySelector(`[data-head="${now}"]`)?.classList.add("now");
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [pattern?.grid, pattern?.bars, from, to]);
}

function headLabels(pattern) {
  const perBeat = 480 / GRIDS[pattern.grid], n = stepCount(pattern);
  const sub = perBeat === 4 ? ["", "e", "&", "a"] : perBeat === 2 ? ["", "&"] : null;
  return Array.from({ length: n }, (_, i) => (i % perBeat === 0 ? String(Math.floor(i / perBeat) % 4 + 1) : sub ? sub[i % perBeat] : "·"));
}

function Library({ song, lane, slot, currentId, onPick, onPreview }) {
  const { factory, mine } = libraryFor(song, lane, slot);
  const item = (e) => (
    <button key={e.id} className={`lib${e.id === currentId ? " on" : ""}`}
      onPointerEnter={(ev) => { if (ev.pointerType === "mouse" && e.id !== currentId) onPreview(e); }}
      onPointerLeave={() => onPreview(null)}
      onClick={() => { onPreview(null); onPick(e); }}>
      <b>{e.pattern.name || "Pattern"}</b><span>{e.tag}</span>
    </button>
  );
  return (
    <div className="library">
      <div className="card-title"><b>{lane.role === "kit" ? (slot === "fill" ? "Fills" : "Grooves for 4/4") : "Patterns"}</b> Hover to audition against the running loop. Click to use.</div>
      <div className="lib-list">
        {factory.map(item)}
        {mine.map(item)}
        <button className="lib new" onClick={() => onPick(blankPattern(song, lane))}><b>New empty pattern</b><span>start from nothing</span></button>
      </div>
    </div>
  );
}

function Links({ song, id, onUnique }) {
  const n = linkCount(song, id);
  if (n < 2) return null;
  return <><span className="tag">Linked ×{n}</span><button onClick={onUnique}>Make unique</button></>;
}

/** Drum grid: pads by steps, plus grid, swing, fill and the groove library. */
export function DrumEditor({ song, sectionId, lane, onSong, onPreview }) {
  const [slot, setSlot] = useState("main");
  const section = song.sections[sectionId];
  const ids = lanePatterns(section, lane.id);
  const active = slot === "fill" && ids.fill ? "fill" : "main";
  const id = ids[active], pattern = id ? song.patterns[id] : null;
  const grid = useRef(null);
  const bar = METERS[section.meter].barTicks, len = section.bars * bar;
  const fillStart = ids.fill ? len - bar : len;
  useStepCursor(grid, pattern, active === "fill" ? fillStart : 0, active === "fill" ? len : fillStart);
  const edit = (fn) => onSong(editPattern(song, id, fn).song);
  const steps = pattern ? stepCount(pattern) : 0, perBeat = pattern ? 480 / GRIDS[pattern.grid] : 4;
  const level = new Map((pattern?.hits || []).map((h) => [`${h.step}|${h.pad}`, h.lv]));

  return (
    <div className="card editor role-kit">
      <div className="editor-bar">
        <h3>{lane.name} · {pattern?.name ?? "no pattern"}</h3>
        {ids.fill && <Seg label="Pattern" value={active} options={[["main", "Groove"], ["fill", "Fill"]]} onPick={setSlot} />}
        {pattern && <Seg label="Grid" value={pattern.grid} options={["1/8", "1/16", "1/16t", "1/32"].map((g) => [g, GRID_LABEL[g]])} onPick={(g) => edit((p) => setGrid(p, g))} />}
        <span className="hint">Swing</span>
        <Seg label="Swing" value={lane.swing || "straight"} options={Object.keys(SWINGS).map((s) => [s, cap(s)])} onPick={(s) => onSong(setLane(song, lane.id, { swing: s }))} />
        {id && <Links song={song} id={id} onUnique={() => onSong(makeUnique(song, sectionId, lane.id, active))} />}
        <label className="check">
          <input type="checkbox" checked={!!ids.fill} disabled={!ids.main || section.bars < 2}
            onChange={(e) => { setSlot("main"); onSong(setFill(song, sectionId, lane.id, e.target.checked ? FACTORY_BY_ID.pt_fill1 : null)); }} />
          Fill on the last bar
        </label>
      </div>
      {pattern ? (
        <div className="grid-scroll">
          <div className="grid drum" ref={grid} style={{ gridTemplateColumns: `112px repeat(${steps}, minmax(20px, 1fr))` }} onContextMenu={(e) => e.preventDefault()}>
            <span />
            {headLabels(pattern).map((t, i) => <span key={i} data-head={i} className={`head${i % perBeat === 0 ? " beat" : ""}`}>{t}</span>)}
            {PAD_NAMES.map((name, r) => {
              const pad = r + 1, choke = (lane.choke || []).some((g) => g.includes(pad));
              return [
                <span key={`n${pad}`} className="rowname">{name}{choke && <small>choke</small>}</span>,
                ...Array.from({ length: steps }, (_, s) => {
                  const lv = level.get(`${s}|${pad}`);
                  return (
                    <button key={`${pad}-${s}`} className={`cell${Math.floor(s / perBeat) % 2 ? " alt" : ""}${lv ? ` lv-${lv}` : ""}`}
                      aria-label={`${name}, step ${s + 1}${lv ? `, ${{ n: "normal", a: "accent", g: "ghost" }[lv]}` : ""}`}
                      onClick={() => edit((p) => cycleHit(p, s, pad))}
                      onContextMenu={(e) => { e.preventDefault(); edit((p) => clearHit(p, s, pad)); }} />
                  );
                }),
              ];
            })}
          </div>
        </div>
      ) : <p className="hint">This lane has no pattern. Pick a groove below.</p>}
      <p className="hint legend">Click a cell to cycle: off, <i className="sw lv-n" /> normal, <i className="sw lv-a" /> accent, <i className="sw lv-g" /> ghost. Right-click clears. Hats choke each other.</p>
      <Library song={song} lane={lane} slot={active} currentId={id}
        onPick={(e) => onSong(applyEntry(song, sectionId, lane, e, active))}
        onPreview={(e) => onPreview(e && { laneId: lane.id, slot: active, entry: e })} />
    </div>
  );
}

/** Step editor for bass and pad patterns: chord tones by steps. */
export function StepEditor({ song, sectionId, lane, onSong, onPreview }) {
  const section = song.sections[sectionId];
  const id = lanePatterns(section, lane.id).main, stored = id ? song.patterns[id] : null;
  const [draft, setDraft] = useState(null); // pattern being stretched by a drag
  const drag = useRef(null), grid = useRef(null);
  const pattern = draft ?? stored;
  useStepCursor(grid, pattern, 0, section.bars * METERS[section.meter].barTicks);
  const edit = (fn) => onSong(editPattern(song, id, fn).song);
  const steps = pattern ? stepCount(pattern) : 0, perBeat = pattern ? 480 / GRIDS[pattern.grid] : 2;
  const notes = pattern ? notesOf(pattern) : [];
  const at = (s, tone) => notes.find((n) => n.tone === tone && n.step <= s && s < n.step + n.len);

  const down = (e, s, tone) => {
    if (e.button !== 0) return;
    if (at(s, tone)) return edit((p) => toggleNote(p, s, tone));
    const vel = e.shiftKey ? 112 : e.altKey ? 64 : 88;
    const base = toggleNote(stored, s, tone, vel);
    drag.current = { s, tone, base };
    setDraft(base);
    const up = () => {
      removeEventListener("pointerup", up);
      const d = drag.current;
      drag.current = null;
      setDraft((cur) => { if (cur && d) queueMicrotask(() => edit(() => cur)); return null; });
    };
    addEventListener("pointerup", up);
  };
  const enter = (s, tone) => {
    const d = drag.current;
    if (d && tone === d.tone && s >= d.s) setDraft(setNoteLen(d.base, d.s, d.tone, s - d.s + 1));
  };

  return (
    <div className={`card editor role-${lane.role}`}>
      <div className="editor-bar">
        <h3>{lane.name} · {pattern?.name ?? "no pattern"}</h3>
        {pattern && <>
          <Seg label="Grid" value={pattern.grid} options={["1/4", "1/8", "1/16"].map((g) => [g, g])} onPick={(g) => edit((p) => setGrid(p, g))} />
          <span className="hint">Length</span>
          <Seg label="Length" value={pattern.bars} options={[[1, "1 bar"], [2, "2 bars"]]} onPick={(b) => edit((p) => setPatternBars(p, b))} />
          <Links song={song} id={id} onUnique={() => onSong(makeUnique(song, sectionId, lane.id))} />
        </>}
      </div>
      {pattern ? (
        <div className="grid-scroll">
          <div className="grid tones" ref={grid} style={{ gridTemplateColumns: `112px repeat(${steps}, minmax(20px, 1fr))` }} onContextMenu={(e) => e.preventDefault()}>
            <span />
            {headLabels(pattern).map((t, i) => <span key={i} data-head={i} className={`head${i % perBeat === 0 ? " beat" : ""}`}>{t}</span>)}
            {TONE_ROWS.map((tone) => [
              <span key={`n${tone}`} className="rowname">Tone {tone}{tone === 1 && <small>lowest</small>}</span>,
              ...Array.from({ length: steps }, (_, s) => {
                const n = at(s, tone), start = n && n.step === s;
                return (
                  <button key={`${tone}-${s}`}
                    className={`cell${Math.floor(s / perBeat) % 2 ? " alt" : ""}${n ? (start ? " on" : " held") : ""}${n && s === n.step + n.len - 1 ? " end" : ""}`}
                    style={n ? { "--v": 0.45 + (n.vel / 127) * 0.55 } : undefined}
                    aria-label={`Tone ${tone}, step ${s + 1}${n ? ", note" : ""}`}
                    onPointerDown={(e) => down(e, s, tone)}
                    onPointerEnter={() => enter(s, tone)}
                    onContextMenu={(e) => { e.preventDefault(); if (n) edit((p) => toggleNote(p, s, tone)); }}>
                    {start && n.oct ? (n.oct > 0 ? "↑" : "↓") : ""}
                  </button>
                );
              }),
            ])}
          </div>
        </div>
      ) : <p className="hint">This lane has no pattern. Pick one below.</p>}
      <p className="hint legend">Rows are chord tones counted up from the bottom of the voicing; rows past the top of the chord wrap up an octave. Click to add a note and drag right to hold it. Click a note to remove it. ⇧ click is louder, ⌥ click is softer. ↑ marks a note played an octave up.{lane.mono?.on ? ` This lane is mono (${lane.mono.priority} note wins), so notes stacked on the same step are filtered at playback.` : ""}</p>
      <Library song={song} lane={lane} slot="main" currentId={id}
        onPick={(e) => onSong(applyEntry(song, sectionId, lane, e))}
        onPreview={(e) => onPreview(e && { laneId: lane.id, slot: "main", entry: e })} />
    </div>
  );
}
