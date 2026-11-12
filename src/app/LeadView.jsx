import { useEffect, useRef, useState } from "react";
import { MODES, METERS, TONICS, scaleNames, leadPitch } from "../core/index.js";
import {
  deleteLeadPass, editLead, pitchToLead, snapToScale, leadSpan,
  moveOp, stretchOp, reverseOp, quantizeOp, velocityOp, deleteOp, copyLead, pasteOp,
} from "../editor/liveOps.js";
import { engine } from "../audio/engine.js";

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const pretty = (id) => id.replace("b", "♭").replace("#", "♯");
const TINTS = ["#8A5F08", "#C48A14", "#E8B03A"]; // oldest to newest; the newest pass is the lightest
const ROW = 14; // px per semitone
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isTyping = (el) => el?.matches?.("input:not([type=range]), select, textarea");
const scaleIndex = (n) => n.oct * 7 + n.deg - 1;

// Copied notes, kept for the life of the page so they can be pasted into another section or lane.
let clipboard = [];

/**
 * A lead lane as a piano roll: one row per semitone across the lane's register, every pass kept
 * and tinted. Notes can be drawn, selected, dragged, stretched, copied, reversed and deleted,
 * whether they were recorded or not.
 * `sounding` is the lane's resolved (post-mono) notes, used to show which notes are suppressed.
 */
export default function LeadView({ song, inst, lane, section, sounding, liveNotes, recording, muted, onMute, quant, setQuant, lead, onSong }) {
  const [picked, setPicked] = useState([]);      // indices of the selected notes
  const [draft, setDraft] = useState(null);      // { list } a preview, { fresh } a note being drawn, or { box } a marquee
  const [tool, setTool] = useState("draw");      // what a drag on empty grid does: "draw" or "select"
  const [active, setActive] = useState(false);   // the roll has the keyboard
  const [, setClipCount] = useState(0);          // re-render when the clipboard changes
  const head = useRef(null), grid = useRef(null), card = useRef(null), hover = useRef(null);

  const len = section.bars * METERS[section.meter].barTicks, bar = METERS[section.meter].barTicks;
  const notes = song.arrangement[inst].leads?.[lane.id]?.notes || [];
  const now = useRef(null);
  now.current = { song, inst, notes }; // a recorded pass can land mid-drag; commits must use the latest song
  const sel = picked.filter((i) => i < notes.length);
  const view = draft?.list ?? notes;
  const passes = [...new Set(notes.map((n) => n.pass))].sort((a, b) => a - b);
  const scale = MODES[section.mode], names = scaleNames(section.tonic, section.mode);
  const tint = (pass) => TINTS[Math.max(0, TINTS.length - (passes.length - passes.indexOf(pass)))] ?? TINTS[0];
  const pitchOf = (n) => leadPitch(n, section, lane.register);
  const mine = liveNotes.filter((n) => n.laneId === lane.id);

  // Rows cover the lane's register, stretched to take in any note outside it.
  const all = [...view, ...mine].map(pitchOf);
  const lo = Math.min(lane.register[0], ...all), hi = Math.max(lane.register[1], ...all);
  const rows = Array.from({ length: hi - lo + 1 }, (_, i) => hi - i);
  const degreeOf = (p) => scale.indexOf((((p - TONICS[section.tonic]) % 12) + 12) % 12);
  const top = (p) => (hi - p) * ROW;
  const pct = (t) => `${(t / len) * 100}%`;
  useEffect(() => { setPicked([]); }, [inst, lane.id]);

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

  // The roll takes the keyboard when it is clicked and gives it back on a click elsewhere.
  useEffect(() => {
    const onDown = (e) => setActive(!!card.current?.contains(e.target));
    addEventListener("pointerdown", onDown, true);
    return () => removeEventListener("pointerdown", onDown, true);
  }, []);

  const isSounding = (n) => (muted.has(n.pass) ? false : sounding.some((s) => s.tick === n.start && s.pass === n.pass));
  const livePass = passes.length ? passes.at(-1) + 1 : 1;
  const unit = quant || 120; // a drawn note starts this long, and arrow keys nudge by it
  const snap = (t) => (quant ? Math.round(t / quant) * quant : Math.round(t / 10) * 10);
  const audition = (pitch) => { engine.noteOn(lane.id, pitch, 96); setTimeout(() => engine.noteOff(lane.id, pitch), 180); };

  /** Apply a list operation to the stored song, as one undo step (or folded into `group`). */
  const commit = (op, group) => onSong(editLead(now.current.song, now.current.inst, lane.id, op), group);

  // ---- commands on the selection
  const cmd = {
    all: () => setPicked(notes.map((_, i) => i)),
    none: () => setPicked([]),
    copy: () => { clipboard = copyLead(notes, sel); setClipCount((n) => n + 1); },
    cut: () => { cmd.copy(); cmd.remove(); },
    remove: () => { commit(deleteOp(sel)); setPicked([]); },
    paste(at) {
      if (!clipboard.length) return;
      const t = clamp(snap(at ?? hover.current ?? (sel.length ? leadSpan(notes, sel)[1] : 0)), 0, len - 1);
      const added = clipboard.filter((c) => t + c.dt < len).length;
      commit(pasteOp(clipboard, t, len));
      setPicked(Array.from({ length: added }, (_, i) => notes.length + i));
    },
    duplicate() {
      const clip = copyLead(notes, sel), t = leadSpan(notes, sel)[1];
      const added = clip.filter((c) => t + c.dt < len).length;
      commit(pasteOp(clip, t, len));
      setPicked(Array.from({ length: added }, (_, i) => notes.length + i));
    },
    reverse: () => commit(reverseOp(sel)),
    quantize: () => commit(quantizeOp(sel, unit, len)),
    move: (delta) => commit(moveOp(sel, delta, section, lane.register, len), "lead-nudge"),
    velocity: (v) => commit(velocityOp(sel, v), "lead-velocity"),
  };
  const keys = useRef(null);
  keys.current = { cmd, sel, unit, active };

  // Keys act on the roll while it has the keyboard. They run ahead of the chord lane's and the live keys'.
  useEffect(() => {
    const onKey = (e) => {
      const { cmd, sel, unit, active } = keys.current;
      if (!active || isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey, has = sel.length > 0, up = e.code === "ArrowUp" ? 1 : -1;
      if (mod && e.code === "KeyA") cmd.all();
      else if (mod && e.code === "KeyC" && has) cmd.copy();
      else if (mod && e.code === "KeyX" && has) cmd.cut();
      else if (mod && e.code === "KeyV" && clipboard.length) cmd.paste();
      else if (mod && e.code === "KeyD" && has) cmd.duplicate();
      else if (mod || !has) return;
      else if (e.code === "Delete" || e.code === "Backspace") cmd.remove();
      else if (e.code === "Escape") cmd.none();
      else if (e.code === "ArrowLeft") cmd.move({ dTick: -unit });
      else if (e.code === "ArrowRight") cmd.move({ dTick: unit });
      else if (e.code === "ArrowUp" || e.code === "ArrowDown") cmd.move(e.altKey ? { steps: 7 * up } : e.shiftKey ? { semis: up } : { steps: up });
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);

  // ---- the pointer: draw, marquee, move, stretch
  const at = (e) => {
    const r = grid.current.getBoundingClientRect();
    return { tick: clamp(((e.clientX - r.left) / r.width) * len, 0, len), pitch: hi - Math.floor(clamp(e.clientY - r.top, 0, r.height - 1) / ROW) };
  };
  const inKey = (p, e) => clamp(e.shiftKey ? p : snapToScale(p, section), lo, hi);
  const track = (move, up) => {
    const done = (ev) => { removeEventListener("pointermove", move); removeEventListener("pointerup", done); setDraft(null); up(ev); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", done);
  };

  /** Pointer down on empty grid: draw a note, or drag a marquee (Select tool, or ⌘/Ctrl held). */
  function onGrid(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = at(e);
    if (tool === "select" || e.metaKey || e.ctrlKey) {
      const keep = e.shiftKey ? sel : [];
      let dragged = false;
      setPicked(keep);
      track((ev) => {
        const to = at(ev);
        dragged = true;
        const box = { t0: Math.min(from.tick, to.tick), t1: Math.max(from.tick, to.tick), p0: Math.min(from.pitch, to.pitch), p1: Math.max(from.pitch, to.pitch) };
        setDraft({ box });
        const hits = notes.flatMap((n, i) => { const p = pitchOf(n); return n.start < box.t1 && n.start + n.len > box.t0 && p >= box.p0 && p <= box.p1 ? [i] : []; });
        setPicked([...new Set([...keep, ...hits])]);
      }, () => { if (!dragged) setPicked(keep); });
      return;
    }
    const start = Math.min(quant ? Math.floor(from.tick / quant) * quant : snap(from.tick), len - unit);
    let fresh = { start, len: unit, pitch: inKey(from.pitch, e) };
    audition(fresh.pitch);
    setDraft({ fresh });
    track((ev) => {
      fresh = { ...fresh, len: clamp(snap(at(ev).tick) - start, quant || 30, len - start) };
      setDraft({ fresh });
    }, () => {
      const stored = { start: fresh.start, len: fresh.len, ...pitchToLead(fresh.pitch, section, lane.register), vel: 100 };
      const index = now.current.notes.length;
      commit((list) => [...list, { ...stored, pass: list.reduce((m, n) => Math.max(m, n.pass), 0) || 1 }]);
      setPicked([index]);
    });
  }

  /** Pointer down on a note (move) or on its right edge (stretch). Acts on the whole selection. */
  function onNote(e, index, stretch) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey && !stretch) { setPicked(sel.includes(index) ? sel.filter((i) => i !== index) : [...sel, index]); return; }
    const targets = sel.includes(index) ? sel : [index];
    setPicked(targets);
    const from = at(e), base = notes, anchor = base[index], anchorPitch = pitchOf(anchor);
    let op = null, heard = anchorPitch;
    track((ev) => {
      const to = at(ev);
      if (stretch) op = stretchOp(targets, snap(to.tick) - (anchor.start + anchor.len), quant || 30, len);
      else {
        const dTick = snap(to.tick - from.tick);
        const want = clamp(anchorPitch + (to.pitch - from.pitch), lo, hi);
        // In key, the group moves by scale steps; with ⇧, by semitones.
        op = ev.shiftKey
          ? moveOp(targets, { dTick, semis: want - anchorPitch }, section, lane.register, len)
          : moveOp(targets, { dTick, steps: scaleIndex(pitchToLead(snapToScale(want, section), section, lane.register)) - scaleIndex(anchor) }, section, lane.register, len);
      }
      const list = op(base);
      setDraft({ list });
      const pitch = pitchOf(list[index]);
      if (pitch !== heard) { heard = pitch; audition(pitch); }
    }, () => { if (op) commit(op); });
  }

  const one = sel.length === 1 ? notes[sel[0]] : null;
  const avgVel = sel.length ? Math.round(sel.reduce((s, i) => s + notes[i].vel, 0) / sel.length) : 100;
  const noteStyle = (n, pass) => ({ left: pct(n.start), width: `max(6px, calc(${pct(n.len)} - 1px))`, top: top(pitchOf(n)), "--t": tint(pass) });

  return (
    <div className={`card editor role-lead${active ? " focused" : ""}`} ref={card} data-testid="lead-editor">
      <div className="editor-bar">
        <h3>{lane.name}{recording ? " · recording" : ""}</h3>
        <span className="hint">Rows are pitches; white rows are in {pretty(section.tonic)} {cap(section.mode)}. Every pass is kept; nothing is erased by playing.</span>
        <span className="spacer" />
        <div className="seg small" role="group" aria-label="Tool">
          <button className={tool === "draw" ? "on" : ""} onClick={() => setTool("draw")}>Draw</button>
          <button className={tool === "select" ? "on" : ""} onClick={() => setTool("select")}>Select</button>
        </div>
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
        <div className={`lead-grid tool-${tool}`} ref={grid} data-testid="lead-grid" onPointerDown={onGrid} onContextMenu={(e) => e.preventDefault()}
          onPointerMove={(e) => { hover.current = at(e).tick; }} onPointerLeave={() => { hover.current = null; }}>
          {rows.map((p) => <div key={p} className={`lead-row${degreeOf(p) < 0 ? " half" : degreeOf(p) === 0 ? " tonic" : ""}`} />)}
          {Array.from({ length: section.bars - 1 }, (_, i) => <i key={i} className="barline" style={{ left: pct((i + 1) * bar) }} />)}
          {view.map((n, i) => (
            <div key={i} role="button" tabIndex={0} data-testid="lead-note"
              className={`lead-note${isSounding(notes[i] ?? n) ? "" : " silent"}${sel.includes(i) ? " sel" : ""}`}
              style={noteStyle(n, n.pass)}
              aria-label={`Degree ${n.deg}${n.acc ? " sharp" : ""}, pass ${n.pass}${sel.includes(i) ? ", selected" : ""}`}
              onPointerDown={(e) => onNote(e, i, false)}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); commit(deleteOp(sel.includes(i) ? sel : [i])); setPicked([]); }}>
              <i className="grip" onPointerDown={(e) => onNote(e, i, true)} />
            </div>
          ))}
          {draft?.fresh && <i className="lead-note sel" style={{ left: pct(draft.fresh.start), width: `max(6px, calc(${pct(draft.fresh.len)} - 1px))`, top: top(draft.fresh.pitch), "--t": tint(passes.at(-1) ?? 1) }} />}
          {draft?.box && <i className="marquee" style={{ left: pct(draft.box.t0), width: pct(draft.box.t1 - draft.box.t0), top: top(draft.box.p1), height: (draft.box.p1 - draft.box.p0 + 1) * ROW }} />}
          {mine.map((n, i) => (
            <i key={`l${i}`} className="lead-note live" style={{ left: pct(n.start), width: `max(6px, ${pct(n.len || 60)})`, top: top(pitchOf(n)) }} />
          ))}
          <div className="playhead" ref={head} />
        </div>
      </div>

      <div className="lead-tools" data-testid="lead-tools">
        <span className="count">{sel.length ? `${sel.length} selected` : "Nothing selected"}</span>
        <button onClick={cmd.all} disabled={!notes.length} title="⌘A">Select all</button>
        <button onClick={cmd.copy} disabled={!sel.length} title="⌘C">Copy</button>
        <button onClick={cmd.cut} disabled={!sel.length} title="⌘X">Cut</button>
        <button onClick={() => cmd.paste(sel.length ? leadSpan(notes, sel)[1] : 0)} disabled={!clipboard.length} title="⌘V pastes at the pointer">Paste</button>
        <button onClick={cmd.duplicate} disabled={!sel.length} title="⌘D">Duplicate</button>
        <button onClick={cmd.reverse} disabled={sel.length < 2}>Reverse</button>
        <button onClick={cmd.quantize} disabled={!sel.length} title="Snap starts to the grid">Quantize</button>
        <button onClick={cmd.remove} disabled={!sel.length} title="⌫">Delete</button>
        <label className={sel.length ? "" : "off"}>Velocity
          <input type="range" aria-label="Velocity" min="1" max="127" value={avgVel} disabled={!sel.length} onChange={(e) => cmd.velocity(+e.target.value)} />
          <span className="mono">{sel.length ? avgVel : ""}</span>
        </label>
      </div>
      <p className="hint legend">
        Drag on the grid to draw a note; with the Select tool, or holding ⌘, drag a box around notes instead. ⇧-click adds a note to the selection.
        Drag a selected note to move them all, or a right edge to stretch them all. Arrow keys nudge and transpose (⇧ by semitone, ⌥ by octave).
        Notes snap to the key and to the Snap grid; hold ⇧ while drawing or dragging for a note outside the key. Right-click deletes.
      </p>

      <div className="lead-foot">
        <div className="passes">
          <div className="card-title"><b>Passes</b> Newest pass is the lightest. Drawn and pasted notes join the newest pass.</div>
          {passes.map((p) => (
            <div key={p} className="pass" data-testid="pass">
              <i style={{ background: tint(p) }} />
              <span>Pass {p} · {notes.filter((n) => n.pass === p).length} notes</span>
              <button className={muted.has(p) ? "on" : ""} aria-pressed={muted.has(p)} onClick={() => onMute(p)}>mute</button>
              <button onClick={() => setPicked(notes.flatMap((n, i) => (n.pass === p ? [i] : [])))}>select</button>
              <button onClick={() => { onSong(deleteLeadPass(song, inst, lane.id, p)); setPicked([]); }} aria-label={`Delete pass ${p}`}>delete</button>
            </div>
          ))}
          {recording && <div className="pass"><i style={{ background: "#B5472B" }} /><span>Pass {livePass} · live</span><b className="rec">REC</b></div>}
          {!passes.length && !recording && <p className="hint">No notes yet. Draw some here, or turn on the keyboard overlay, press Record, and play the lead keys.</p>}
        </div>
        <div className="lead-info">
          <div className="card-title"><b>{one ? "Selected note" : "Lane"}</b>{one ? ` degree ${one.deg}${one.acc ? "♯" : ""}, pass ${one.pass}, velocity ${one.vel}${isSounding(one) ? "" : " · silent (mono, or pass muted)"}` : ""}</div>
          <p className="hint">
            {lane.mono?.on ? `Mono, ${lane.mono.priority} note wins. Mono is a playback filter: a note that loses shows as a dashed outline and is still stored.` : "Poly: every note sounds."}
            {" "}Keys start on degree {((lead.window % 7) + 7) % 7 + 1}, octave {lead.octave >= 0 ? `+${lead.octave}` : lead.octave}. Leads follow the key, not the chord, and stay with this instance.
          </p>
        </div>
      </div>
    </div>
  );
}
