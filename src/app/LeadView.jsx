import { useEffect, useRef, useState } from "react";
import { MODES, METERS, TONICS, scaleNames, leadPitch } from "../core/index.js";
import { deleteLeadPass, deleteLeadNote, addLeadNote, updateLeadNote, pitchToLead, snapToScale } from "../editor/liveOps.js";
import { engine } from "../audio/engine.js";

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const pretty = (id) => id.replace("b", "♭").replace("#", "♯");
const TINTS = ["#8A5F08", "#C48A14", "#E8B03A"]; // oldest to newest; the newest pass is the lightest
const ROW = 14; // px per semitone
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isTyping = (el) => el?.matches?.("input, select, textarea");

/**
 * A lead lane as a piano roll: one row per semitone across the lane's register, every pass kept
 * and tinted. Notes can be drawn, dragged, stretched and deleted, whether they were recorded or not.
 * `sounding` is the lane's resolved (post-mono) notes, used to show which notes are suppressed.
 */
export default function LeadView({ song, inst, lane, section, sounding, liveNotes, recording, muted, onMute, quant, setQuant, lead, onSong }) {
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null); // { index (null = a new note), start, len, pitch } while the pointer is down
  const head = useRef(null), grid = useRef(null);
  const now = useRef(null);
  now.current = { song, inst }; // a recorded pass can land mid-drag; commits must use the latest song

  const len = section.bars * METERS[section.meter].barTicks, bar = METERS[section.meter].barTicks;
  const notes = song.arrangement[inst].leads?.[lane.id]?.notes || [];
  const passes = [...new Set(notes.map((n) => n.pass))].sort((a, b) => a - b);
  const scale = MODES[section.mode], names = scaleNames(section.tonic, section.mode);
  const tint = (pass) => TINTS[Math.max(0, TINTS.length - (passes.length - passes.indexOf(pass)))] ?? TINTS[0];
  const pitchOf = (n) => leadPitch(n, section, lane.register);
  const mine = liveNotes.filter((n) => n.laneId === lane.id);

  // Rows cover the lane's register, stretched to take in any note outside it.
  const all = [...notes, ...mine].map(pitchOf);
  const lo = Math.min(lane.register[0], ...all), hi = Math.max(lane.register[1], ...all);
  const rows = Array.from({ length: hi - lo + 1 }, (_, i) => hi - i);
  const degreeOf = (p) => scale.indexOf((((p - TONICS[section.tonic]) % 12) + 12) % 12);
  const top = (p) => (hi - p) * ROW;
  const pct = (t) => `${(t / len) * 100}%`;
  const picked = sel !== null ? notes[sel] ?? null : null;
  useEffect(() => { setSel(null); }, [inst, lane.id]);

  useEffect(() => {
    let raf;
    const tick = () => {
      const t = engine.localTicks();
      if (head.current) { head.current.style.display = t < 0 ? "none" : "block"; head.current.style.left = pct(Math.min(t, len)); }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [len]);

  // Delete removes the selected note. It runs ahead of the chord lane's own Backspace.
  useEffect(() => {
    if (picked === null) return;
    const onKey = (e) => {
      if ((e.code !== "Delete" && e.code !== "Backspace") || isTyping(e.target) || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      onSong(deleteLeadNote(now.current.song, now.current.inst, lane.id, sel));
      setSel(null);
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [picked, sel, lane.id, onSong]);

  const isSounding = (n) => (muted.has(n.pass) ? false : sounding.some((s) => s.tick === n.start && s.pass === n.pass));
  const livePass = passes.length ? passes.at(-1) + 1 : 1;

  // ---- drawing, dragging and stretching
  const unit = quant || 120;                                   // a drawn note starts this long
  const snap = (t) => (quant ? Math.round(t / quant) * quant : Math.round(t / 10) * 10);
  const audition = (pitch) => { engine.noteOn(lane.id, pitch, 96); setTimeout(() => engine.noteOff(lane.id, pitch), 180); };
  const at = (e) => {
    const r = grid.current.getBoundingClientRect();
    return { tick: clamp(((e.clientX - r.left) / r.width) * len, 0, len), pitch: hi - Math.floor(clamp(e.clientY - r.top, 0, r.height - 1) / ROW) };
  };
  const inKey = (p, e) => clamp(e.shiftKey ? p : snapToScale(p, section), lo, hi);

  /** `kind` is "new" (pointer went down on empty grid), "move" (on a note) or "stretch" (on its right edge). */
  function begin(e, kind, index = null) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const from = at(e);
    const base = kind === "new"
      ? { start: Math.min(quant ? Math.floor(from.tick / quant) * quant : snap(from.tick), len - unit), len: unit, pitch: inKey(from.pitch, e) }
      : { start: notes[index].start, len: notes[index].len, pitch: pitchOf(notes[index]) };
    let cur = base;
    if (kind === "new") audition(base.pitch); else setSel(index);
    setDraft({ index, ...base });
    const move = (ev) => {
      const to = at(ev);
      let next;
      if (kind === "move") {
        const pitch = inKey(base.pitch + (to.pitch - from.pitch), ev);
        next = { start: clamp(base.start + snap(to.tick - from.tick), 0, len - base.len), len: base.len, pitch };
        if (pitch !== cur.pitch) audition(pitch);
      } else {
        next = { ...base, len: clamp(snap(to.tick) - base.start, quant || 30, len - base.start) };
      }
      cur = next;
      setDraft({ index, ...next });
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      setDraft(null);
      const { song, inst } = now.current;
      const stored = { start: cur.start, len: cur.len, ...pitchToLead(cur.pitch, section, lane.register) };
      if (kind === "new") {
        const r = addLeadNote(song, inst, lane.id, { ...stored, vel: 100 });
        onSong(r.song);
        setSel(r.index);
      } else onSong(updateLeadNote(song, inst, lane.id, index, stored));
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }

  const remove = (i) => { onSong(deleteLeadNote(song, inst, lane.id, i)); setSel(null); };
  const shown = (n, i) => (draft && draft.index === i ? draft : { start: n.start, len: n.len, pitch: pitchOf(n) });

  return (
    <div className="card editor role-lead">
      <div className="editor-bar">
        <h3>{lane.name}{recording ? " · recording" : ""}</h3>
        <span className="hint">Rows are pitches; white rows are in {pretty(section.tonic)} {cap(section.mode)}. Every pass is kept; nothing is erased by playing.</span>
        <span className="spacer" />
        <span className="hint">Snap</span>
        <div className="seg small" role="group" aria-label="Quantize">
          {[[0, "Off"], [240, "1/8"], [120, "1/16"]].map(([v, t]) => <button key={v} className={quant === v ? "on" : ""} onClick={() => setQuant(v)}>{t}</button>)}
        </div>
      </div>
      <div className="lead-wrap">
        <div className="lead-labels">
          {rows.map((p) => {
            const d = degreeOf(p);
            return <div key={p} className={d < 0 ? "half" : ""}>{d < 0 ? "" : <><b>{d + 1}</b> {names[d]}{Math.floor(p / 12) - 1}</>}</div>;
          })}
        </div>
        <div className="lead-grid" ref={grid} data-testid="lead-grid" onPointerDown={(e) => begin(e, "new")} onContextMenu={(e) => e.preventDefault()}>
          {rows.map((p) => <div key={p} className={`lead-row${degreeOf(p) < 0 ? " half" : degreeOf(p) === 0 ? " tonic" : ""}`} />)}
          {Array.from({ length: section.bars - 1 }, (_, i) => <i key={i} className="barline" style={{ left: pct((i + 1) * bar) }} />)}
          {notes.map((n, i) => {
            const s = shown(n, i);
            return (
              <div key={i} role="button" tabIndex={0} data-testid="lead-note"
                className={`lead-note${isSounding(n) ? "" : " silent"}${sel === i ? " sel" : ""}`}
                style={{ left: pct(s.start), width: `max(6px, calc(${pct(s.len)} - 1px))`, top: top(s.pitch), "--t": tint(n.pass) }}
                aria-label={`Degree ${n.deg}${n.acc ? " sharp" : ""}, pass ${n.pass}`}
                onPointerDown={(e) => begin(e, "move", i)}
                onFocus={() => setSel(i)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); remove(i); }}>
                <i className="grip" onPointerDown={(e) => begin(e, "stretch", i)} />
              </div>
            );
          })}
          {draft && draft.index === null && (
            <i className="lead-note sel" style={{ left: pct(draft.start), width: `max(6px, calc(${pct(draft.len)} - 1px))`, top: top(draft.pitch), "--t": tint(passes.at(-1) ?? 1) }} />
          )}
          {mine.map((n, i) => (
            <i key={`l${i}`} className="lead-note live" style={{ left: pct(n.start), width: `max(6px, ${pct(n.len || 60)})`, top: top(pitchOf(n)) }} />
          ))}
          <div className="playhead" ref={head} />
        </div>
      </div>
      <p className="hint legend">Drag on the grid to draw a note. Drag a note to move it, drag its right edge to stretch it, and right-click or press ⌫ to delete it. Notes snap to the key and to the Snap grid; hold ⇧ for a note outside the key.</p>
      <div className="lead-foot">
        <div className="passes">
          <div className="card-title"><b>Passes</b> Newest pass is the lightest. Undo removes the last pass. Drawn notes join the newest pass.</div>
          {passes.map((p) => (
            <div key={p} className="pass" data-testid="pass">
              <i style={{ background: tint(p) }} />
              <span>Pass {p} · {notes.filter((n) => n.pass === p).length} notes</span>
              <button className={muted.has(p) ? "on" : ""} aria-pressed={muted.has(p)} onClick={() => onMute(p)}>mute</button>
              <button onClick={() => { onSong(deleteLeadPass(song, inst, lane.id, p)); setSel(null); }} aria-label={`Delete pass ${p}`}>delete</button>
            </div>
          ))}
          {recording && <div className="pass"><i style={{ background: "#B5472B" }} /><span>Pass {livePass} · live</span><b className="rec">REC</b></div>}
          {!passes.length && !recording && <p className="hint">No notes yet. Draw some here, or turn on the keyboard overlay, press Record, and play the lead keys.</p>}
        </div>
        <div className="lead-info">
          {picked ? (
            <>
              <div className="card-title"><b>Selected note</b> degree {picked.deg}{picked.acc ? "♯" : ""}, pass {picked.pass}{isSounding(picked) ? "" : " · silent (mono, or pass muted)"}</div>
              <button onClick={() => remove(sel)}>Delete note</button>{" "}
              <button onClick={() => { onSong(deleteLeadPass(song, inst, lane.id, picked.pass)); setSel(null); }}>Delete this pass ({picked.pass})</button>
            </>
          ) : (
            <>
              <div className="card-title"><b>Lane</b></div>
              <p className="hint">
                {lane.mono?.on ? `Mono, ${lane.mono.priority} note wins. Mono is a playback filter: a note that loses shows as a dashed outline and is still stored.` : "Poly: every note sounds."}
                {" "}Keys start on degree {((lead.window % 7) + 7) % 7 + 1}, octave {lead.octave >= 0 ? `+${lead.octave}` : lead.octave}. Leads follow the key, not the chord, and stay with this instance.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
