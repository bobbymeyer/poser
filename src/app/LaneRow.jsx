import { ROLE_DEFAULTS } from "../editor/template.js";

const cap = (s) => s[0].toUpperCase() + s.slice(1);

function instrumentLabel(lane) {
  const ins = lane.instrument;
  if (ins.backend === "midi") return `MIDI · ${ins.port} · ch ${ins.channel}`;
  const d = ROLE_DEFAULTS[lane.role];
  return `SF · ${d && d.instrument.program === ins.program ? d.label : ins.drums ? "Drum kit" : `Program ${ins.program}`}`;
}

/** One lane of the stack: header on the left, its clips drawn against the section's time axis. */
export default function LaneRow({ lane, section, len, notes, patterns, selected, onSelect, onPatch }) {
  const clips = section.clips[lane.id] || [];
  const pct = (t) => `${(t / len) * 100}%`;
  const kit = lane.role === "kit";
  let marks = null;
  if (notes.length) {
    if (kit) {
      const rows = [...new Set(notes.map((n) => n.pitch))].sort((a, b) => lane.pads.indexOf(a) - lane.pads.indexOf(b));
      marks = notes.map((n, i) => (
        <i key={i} className="dot" style={{ left: pct(n.tick), top: `${((rows.indexOf(n.pitch) + 0.5) / rows.length) * 100}%`, opacity: n.vel < 60 ? 0.4 : n.vel > 110 ? 1 : 0.8 }} />
      ));
    } else {
      const lo = Math.min(...notes.map((n) => n.pitch)), hi = Math.max(...notes.map((n) => n.pitch));
      marks = notes.map((n, i) => (
        <i key={i} className="bar" style={{ opacity: n.pass ? 0.55 + 0.45 / n.pass : 1, left: pct(n.tick), width: `calc(${pct(n.len)} - 2px)`, top: `${((hi - n.pitch + 0.5) / (hi - lo + 1)) * 100}%` }} />
      ));
    }
  }
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div className={`lane-row role-${lane.role}${selected ? " selected" : ""}`} onClick={onSelect} data-testid={`lane-${lane.id}`}>
      <div className="lane-head">
        <div className="lane-name"><i />{lane.name}{kit && <span className="hint right">Swing: {cap(lane.swing || "straight")}</span>}</div>
        <div className="instrument">{instrumentLabel(lane)}</div>
        <div className="lane-tags">
          {!kit && lane.mono && <span className={`tag${lane.mono.on ? " dark" : ""}`}>{lane.mono.on ? "MONO" : "POLY"}</span>}
          <span className="spacer" />
          <button className={`ms${lane.mute ? " on" : ""}`} aria-label={`Mute ${lane.name}`} aria-pressed={lane.mute} onClick={stop(() => onPatch({ mute: !lane.mute }))}>M</button>
          <button className={`ms${lane.solo ? " on" : ""}`} aria-label={`Solo ${lane.name}`} aria-pressed={lane.solo} onClick={stop(() => onPatch({ solo: !lane.solo }))}>S</button>
        </div>
      </div>
      <div className="lane">
        <div className={`clipview${lane.mute ? " muted" : ""}`}>
          {clips.filter((c) => c.start < len).map((c, i) => (
            <div key={i} className="clip" style={{ left: pct(c.start), width: pct(Math.min(c.len, len - c.start)) }}>
              <span>{patterns[c.pattern]?.name ?? "Pattern"}</span>
            </div>
          ))}
          {!clips.length && (
            <div className="clip empty">{!notes.length && <span>{lane.role === "lead" ? "No notes yet. Select this lane, then record." : "No pattern yet. Select this lane to pick one."}</span>}</div>
          )}
          <div className="marks">{marks}</div>
        </div>
      </div>
    </div>
  );
}
