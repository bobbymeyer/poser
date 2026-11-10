import { useEffect, useRef, useState } from "react";
import { MODES, METERS, scaleNames } from "../core/index.js";
import { deleteLeadPass, deleteLeadNote } from "../editor/liveOps.js";
import { engine } from "../audio/engine.js";

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const pretty = (id) => id.replace("b", "♭").replace("#", "♯");
const TINTS = ["#8A5F08", "#C48A14", "#E8B03A"]; // oldest to newest; the newest pass is the lightest

/**
 * Read view of a lead lane: one row per semitone of the scale's octave, every pass kept and tinted.
 * `sounding` is the lane's resolved (post-mono) notes, used to show which notes are suppressed.
 */
export default function LeadView({ song, inst, lane, section, sounding, liveNotes, recording, muted, onMute, quant, setQuant, lead, onSong }) {
  const [sel, setSel] = useState(null);
  const head = useRef(null);
  const len = section.bars * METERS[section.meter].barTicks, bar = METERS[section.meter].barTicks;
  const notes = song.arrangement[inst].leads?.[lane.id]?.notes || [];
  const passes = [...new Set(notes.map((n) => n.pass))].sort((a, b) => a - b);
  const scale = MODES[section.mode], names = scaleNames(section.tonic, section.mode);
  const tint = (pass) => TINTS[Math.max(0, TINTS.length - (passes.length - passes.indexOf(pass)))] ?? TINTS[0];
  const row = (n) => 11 - ((scale[n.deg - 1] + n.acc + 12) % 12);
  const pct = (t) => `${(t / len) * 100}%`;
  const picked = sel !== null ? notes[sel] : null;
  useEffect(() => { setSel(null); }, [inst, lane.id, notes.length]);

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

  const isSounding = (n) => muted.has(n.pass) ? false : sounding.some((s) => s.tick === n.start && s.pass === n.pass);
  const livePass = passes.length ? passes.at(-1) + 1 : 1;

  return (
    <div className="card editor role-lead">
      <div className="editor-bar">
        <h3>{lane.name}{recording ? " · recording" : ""}</h3>
        <span className="hint">Rows are the notes of {pretty(section.tonic)} {cap(section.mode)}. Every pass is kept; nothing is erased by playing.</span>
        <span className="spacer" />
        <span className="hint">Quantize</span>
        <div className="seg small" role="group" aria-label="Quantize">
          {[[0, "Off"], [240, "1/8"], [120, "1/16"]].map(([v, t]) => <button key={v} className={quant === v ? "on" : ""} onClick={() => setQuant(v)}>{t}</button>)}
        </div>
      </div>
      <div className="lead-wrap">
        <div className="lead-labels">
          {Array.from({ length: 12 }, (_, r) => {
            const d = scale.indexOf(11 - r);
            return <div key={r} className={d < 0 ? "half" : ""}>{d < 0 ? "" : <><b>{d + 1}</b> {names[d]}</>}</div>;
          })}
        </div>
        <div className="lead-grid" onPointerDown={() => setSel(null)}>
          {Array.from({ length: 12 }, (_, r) => <div key={r} className={`lead-row${scale.includes(11 - r) ? "" : " half"}`} />)}
          {Array.from({ length: section.bars - 1 }, (_, i) => <i key={i} className="barline" style={{ left: pct((i + 1) * bar) }} />)}
          {notes.map((n, i) => (
            <button key={i} data-testid="lead-note"
              className={`lead-note${isSounding(n) ? "" : " silent"}${sel === i ? " sel" : ""}`}
              style={{ left: pct(n.start), width: `max(6px, calc(${pct(n.len)} - 1px))`, top: `${(row(n) / 12) * 100}%`, "--t": tint(n.pass) }}
              aria-label={`Degree ${n.deg}${n.acc ? " sharp" : ""}, pass ${n.pass}`}
              onPointerDown={(e) => { e.stopPropagation(); setSel(i); }}>
              {n.oct > 0 ? "↑" : n.oct < 0 ? "↓" : ""}
            </button>
          ))}
          {liveNotes.filter((n) => n.laneId === lane.id).map((n, i) => (
            <i key={`l${i}`} className="lead-note live" style={{ left: pct(n.start), width: `max(6px, ${pct(n.len || 60)})`, top: `${(row(n) / 12) * 100}%` }} />
          ))}
          <div className="playhead" ref={head} />
        </div>
      </div>
      <div className="lead-foot">
        <div className="passes">
          <div className="card-title"><b>Passes</b> Newest pass is the lightest. Undo removes the last pass.</div>
          {passes.map((p) => (
            <div key={p} className="pass" data-testid="pass">
              <i style={{ background: tint(p) }} />
              <span>Pass {p} · {notes.filter((n) => n.pass === p).length} notes</span>
              <button className={muted.has(p) ? "on" : ""} aria-pressed={muted.has(p)} onClick={() => onMute(p)}>mute</button>
              <button onClick={() => onSong(deleteLeadPass(song, inst, lane.id, p))} aria-label={`Delete pass ${p}`}>delete</button>
            </div>
          ))}
          {recording && <div className="pass"><i style={{ background: "#B5472B" }} /><span>Pass {livePass} · live</span><b className="rec">REC</b></div>}
          {!passes.length && !recording && <p className="hint">No notes yet. Turn on the keyboard overlay, press Record, and play the lead keys.</p>}
        </div>
        <div className="lead-info">
          {picked ? (
            <>
              <div className="card-title"><b>Selected note</b> degree {picked.deg}{picked.acc ? "♯" : ""}, pass {picked.pass}{isSounding(picked) ? "" : " · silent (mono, or pass muted)"}</div>
              <button onClick={() => onSong(deleteLeadNote(song, inst, lane.id, sel))}>Delete note</button>{" "}
              <button onClick={() => onSong(deleteLeadPass(song, inst, lane.id, picked.pass))}>Delete this pass ({picked.pass})</button>
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
