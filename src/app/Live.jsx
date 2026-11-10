import { useState } from "react";
import { KEY_ROWS, keyChar, keyMap, ZONES, claimZone, releaseZone } from "../editor/liveOps.js";
import { liveKey } from "./live.js";

const OFFSET = [0, 22, 34, 58];

/** The keyboard, tinted by lane, with the note each key plays right now. */
export function KeyboardOverlay({ song, section, at, contextLabel, onSong }) {
  const [notice, setNotice] = useState("");
  const map = keyMap(song);
  const owner = (zone) => song.lanes.find((l) => (l.zones || []).includes(zone));
  const claim = (laneId, zone) => {
    const r = claimZone(song, laneId, zone);
    setNotice(r.released ? `${zone} was released from ${r.released}. The stored music is unchanged.` : "");
    onSong(r.song);
  };
  return (
    <div className="card overlay" data-testid="overlay">
      <div className="card-title"><b>Keyboard zones</b> Keys show the notes they play right now. {contextLabel}</div>
      <div className="overlay-body">
        <div className="kbd">
          {KEY_ROWS.map((row, r) => (
            <div key={r} className="kbd-row" style={{ paddingLeft: OFFSET[r] }}>
              {row.map((code) => {
                const k = map.get(code);
                const lane = k && song.lanes.find((l) => l.id === k.laneId);
                const info = lane && liveKey(song, section, lane, k.index, { ...at, sharp: false });
                return (
                  <div key={code} className={`kkey${lane ? ` role-${lane.role}` : " free"}`} data-key={code}>
                    <kbd>{keyChar(code)}</kbd>
                    <b>{info ? info.label : "–"}</b>
                    <span>{info ? info.sub : lane ? "no chord" : r === 0 ? "chord" : "free"}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="assigned">
          <div className="card-title"><b>Assigned</b></div>
          {song.lanes.map((l) => (
            <div key={l.id} className={`assign role-${l.role}`}>
              <span className="lane-name"><i />{l.name}</span>
              {(l.zones || []).map((z) => (
                <button key={z} className="zone" title="Release this zone" aria-label={`Release ${z} from ${l.name}`} onClick={() => { setNotice(""); onSong(releaseZone(song, l.id, z)); }}>{z} ×</button>
              ))}
              <select aria-label={`Add a zone to ${l.name}`} value="" onChange={(e) => e.target.value && claim(l.id, e.target.value)}>
                <option value="">+ zone</option>
                {ZONES.filter((z) => !(l.zones || []).includes(z)).map((z) => {
                  const o = owner(z);
                  return <option key={z} value={z}>{z}{o ? ` (takes it from ${o.name})` : z === "123" || z === "456" || z === "789" ? " (number row)" : ""}</option>;
                })}
              </select>
            </div>
          ))}
          <div className="assign"><span className="lane-name"><i style={{ background: "var(--chords)" }} />Chords</span><span className="hint">1–7, unless a lane claims those keys</span></div>
          {notice && <p className="hint notice" role="status">{notice}</p>}
        </div>
      </div>
      <p className="hint legend">Kit: ⌥ + key is a ghost hit, ⇧ + key an accent; hold ⌫ and tap a pad to erase it. Bass and pad keys are chord tones 1, 2 and 3 of the current chord. Lead: ← → slide the six keys along the scale, ↑ ↓ change octave, ⇧ + key plays a chromatic passing tone.</p>
    </div>
  );
}

/** Bottom bar: record context, overlay toggle, latency, count-in, MIDI keyboard, undo. */
export function BottomBar({ live, set, pinnedLabel, onUndo, canUndo, onMidi, midiNote }) {
  return (
    <footer className="bottom">
      <b>Record context</b>
      <div className="seg small" role="group" aria-label="Record context">
        <button className={live.context === "pinned" ? "on" : ""} onClick={() => set({ context: "pinned" })}>Pinned · {pinnedLabel}</button>
        <button className={live.context === "follow" ? "on" : ""} onClick={() => set({ context: "follow" })}>Follow song</button>
      </div>
      <button className={live.playMode ? "on" : ""} aria-pressed={live.playMode} onClick={() => set({ playMode: !live.playMode })} data-testid="overlay-toggle" title="Keys play their zones (`)">Keyboard overlay</button>
      <label className="check"><input type="checkbox" checked={live.countIn} onChange={(e) => set({ countIn: e.target.checked })} /> Count-in · 1 bar</label>
      <label className="check"><input type="checkbox" checked={live.metronome} onChange={(e) => set({ metronome: e.target.checked })} /> Click while recording</label>
      <label className="check">Input latency
        <input type="number" aria-label="Input latency in milliseconds" min="-100" max="300" value={live.latencyMs}
          onChange={(e) => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) set({ latencyMs: Math.max(-100, Math.min(300, v)) }); }} /> ms
      </label>
      <button onClick={onMidi} title="Play and record the lead lane from a MIDI keyboard">{midiNote || "MIDI keyboard"}</button>
      <span className="spacer" />
      <span className="hint">Undo = one loop pass</span>
      <button onClick={onUndo} disabled={!canUndo}>Undo</button>
    </footer>
  );
}
