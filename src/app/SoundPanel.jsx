import { useEffect, useRef, useState } from "react";
import { FACTORY_SOUNDFONT, ROLE_DEFAULTS } from "../editor/template.js";
import { useSoundFont, useMidiOut, setLaneSettings, removeLane, bounceSkips } from "../editor/laneOps.js";
import { listSoundFonts } from "../storage/db.js";
import { engine } from "../audio/engine.js";
import { bounceWav } from "../audio/bounce.js";

/** What a lane's header shows for its sound source, and whether something is wrong with it. */
export function soundLabel(lane) {
  const ins = lane.instrument;
  if (ins.backend === "midi") {
    const ports = engine.midiPorts;
    const state = !ports ? " · MIDI is off" : ports.includes(ins.port) ? "" : " · device not found";
    return { text: `MIDI · ${ins.port} · ch ${ins.channel}${state}`, bad: !!state };
  }
  const state = engine.fontState(ins.sf);
  const kit = lane.role === "kit";
  const name = engine.presets(state === "ready" ? ins.sf : FACTORY_SOUNDFONT.hash, kit).find((p) => p.program === ins.program)?.name;
  const d = ROLE_DEFAULTS[lane.role];
  const fallback = d && d.instrument.program === ins.program ? d.label : kit ? "Drum kit" : `Program ${ins.program}`;
  return { text: `SF · ${name ?? fallback}${state === "missing" ? " · SoundFont not found" : ""}`, bad: state === "missing" };
}

/** Sound source and mixer settings for the selected lane. */
export function SoundPanel({ song, lane, onSong }) {
  const [stored, setStored] = useState([]);
  const [error, setError] = useState("");
  const file = useRef(null);
  useEffect(() => { listSoundFonts().then(setStored, () => {}); }, [lane.id]);
  const ins = lane.instrument, midi = ins.backend === "midi", kit = lane.role === "kit";
  const group = (name) => `${lane.id}:${name}`;
  const set = (patch, name) => onSong(setLaneSettings(song, lane.id, patch), name && group(name));

  const fonts = new Map([[FACTORY_SOUNDFONT.hash, `${FACTORY_SOUNDFONT.name} (factory)`]]);
  for (const f of [...stored, ...song.soundfonts]) if (!fonts.has(f.hash)) fonts.set(f.hash, f.name);
  const state = midi ? "ready" : engine.fontState(ins.sf);
  const presets = midi ? [] : engine.presets(state === "ready" ? ins.sf : FACTORY_SOUNDFONT.hash, kit);
  const fontName = (hash) => song.soundfonts.find((s) => s.hash === hash)?.name ?? fonts.get(hash) ?? "SoundFont";
  const ports = engine.midiPorts;

  async function loadFile(e) {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setError("");
    try {
      await engine.start();
      const font = await engine.addSoundFont(f);
      setStored(await listSoundFonts());
      onSong(useSoundFont(song, lane.id, font));
    } catch (err) { setError(err.message); }
  }
  async function enableMidi() {
    setError("");
    try { await engine.enableMidi(); } catch (err) { setError(err.message); }
  }

  return (
    <div className={`card sound role-${lane.role}`} data-testid="sound-panel">
      <div className="editor-bar">
        <span className="lane-name"><i /></span>
        <input className="lane-rename" aria-label="Lane name" value={lane.name} onChange={(e) => set({ name: e.target.value }, "name")} />
        <div className="seg small" role="group" aria-label="Output">
          <button className={midi ? "" : "on"} onClick={() => midi && onSong(useSoundFont(song, lane.id, FACTORY_SOUNDFONT))}>SoundFont</button>
          <button className={midi ? "on" : ""} onClick={() => !midi && onSong(useMidiOut(song, lane.id, { port: ports?.[0] }))}>MIDI out</button>
        </div>
        <span className="spacer" />
        <button onClick={() => { if (confirm(`Delete the ${lane.name} lane? Its clips and lead notes go with it. Undo brings it back.`)) onSong(removeLane(song, lane.id)); }}>Delete lane</button>
      </div>

      {midi ? (
        <div className="sound-row">
          {ports ? (
            <label>Port
              <select aria-label="MIDI port" value={ins.port} onChange={(e) => onSong(useMidiOut(song, lane.id, { port: e.target.value }))}>
                {!ports.includes(ins.port) && <option value={ins.port}>{ins.port} (not found)</option>}
                {ports.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          ) : <button onClick={enableMidi}>Enable MIDI</button>}
          <label>Channel
            <input type="number" aria-label="MIDI channel" min="1" max="16" value={ins.channel}
              onChange={(e) => { const v = e.target.valueAsNumber; if (v >= 1 && v <= 16) onSong(useMidiOut(song, lane.id, { channel: v })); }} />
          </label>
          <label>Program
            <input type="number" aria-label="MIDI program" min="0" max="127" placeholder="none" value={ins.program ?? ""}
              onChange={(e) => { const v = e.target.valueAsNumber; onSong(useMidiOut(song, lane.id, { program: v >= 0 && v <= 127 ? v : null })); }} />
          </label>
          {lane.mono?.on && (
            <label className="check"><input type="checkbox" checked={!!lane.mono.legato} onChange={(e) => set({ mono: { ...lane.mono, legato: e.target.checked } })} /> Legato</label>
          )}
          {ports && !ports.includes(ins.port) && <span className="warn">Device not found. This lane is silent until the port appears.</span>}
          {!ports && <span className="hint">Needs Chrome, Edge or Firefox, and a permission prompt.</span>}
        </div>
      ) : (
        <div className="sound-row">
          <label>SoundFont
            <select aria-label="SoundFont" value={ins.sf} onChange={(e) => onSong(useSoundFont(song, lane.id, { hash: e.target.value, name: fonts.get(e.target.value) }))}>
              {[...fonts].map(([hash, name]) => <option key={hash} value={hash}>{name}</option>)}
            </select>
          </label>
          <button onClick={() => file.current.click()}>Load a file…</button>
          <input ref={file} type="file" accept=".sf2,.sf3,.sfogg,.dls" hidden onChange={loadFile} data-testid="sf-file" />
          <label>{kit ? "Kit" : "Instrument"}
            <select aria-label="Instrument" value={ins.program} onChange={(e) => onSong(useSoundFont(song, lane.id, { hash: ins.sf, name: fontName(ins.sf) }, +e.target.value))}>
              {!presets.some((p) => p.program === ins.program) && <option value={ins.program}>Program {ins.program}</option>}
              {presets.map((p) => <option key={p.program} value={p.program}>{p.program} · {p.name}</option>)}
            </select>
          </label>
          {state === "missing" && <span className="warn">SoundFont not found: {fontName(ins.sf)}. Playing on the factory SoundFont until you load it.</span>}
          {state === "loading" && <span className="hint">Loading {fontName(ins.sf)}…</span>}
          {state === "off" && <span className="hint">Instrument names appear once audio has started.</span>}
        </div>
      )}

      <div className="sound-row">
        <label>Volume
          <input type="range" aria-label="Volume" min="0" max="127" value={lane.volume} onChange={(e) => set({ volume: +e.target.value }, "volume")} />
          <span className="mono">{lane.volume}</span>
        </label>
        <label>Pan
          <input type="range" aria-label="Pan" min="0" max="127" value={lane.pan} onChange={(e) => set({ pan: +e.target.value }, "pan")} />
          <span className="mono">{lane.pan === 64 ? "C" : lane.pan < 64 ? `L${64 - lane.pan}` : `R${lane.pan - 64}`}</span>
        </label>
        <label>Latency offset
          <input type="number" aria-label="Latency offset in milliseconds" min="-200" max="500" value={lane.latency_ms}
            onChange={(e) => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) set({ latency_ms: Math.max(-200, Math.min(500, v)) }, "latency"); }} /> ms
        </label>
        {!kit && lane.mono && (
          <label>Voices
            <select aria-label="Voices" value={lane.mono.on ? lane.mono.priority : "poly"}
              onChange={(e) => set({ mono: e.target.value === "poly" ? { ...lane.mono, on: false } : { ...lane.mono, on: true, priority: e.target.value } })}>
              <option value="poly">Poly</option>
              <option value="last">Mono · last note</option>
              <option value="lowest">Mono · lowest note</option>
              <option value="highest">Mono · highest note</option>
            </select>
          </label>
        )}
      </div>
      {error && <p className="warn" role="alert">{error}</p>}
    </div>
  );
}

const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

/** Bounce dialog: says what will be left out, renders, then offers the file. */
export function BounceDialog({ song, seconds, onClose }) {
  const [job, setJob] = useState({ status: "idle" });
  const skipped = bounceSkips(song);
  const name = `${(song.title || "song").replace(/[\\/:*?"<>|]+/g, " ").trim() || "song"}.wav`;
  useEffect(() => () => { if (job.url) URL.revokeObjectURL(job.url); }, [job.url]);
  async function render() {
    setJob({ status: "rendering" });
    try {
      const { blob, seconds } = await bounceWav(song);
      setJob({ status: "done", url: URL.createObjectURL(blob), size: blob.size, seconds });
    } catch (err) { console.error(err); setJob({ status: "error", error: err.message }); }
  }
  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Bounce to WAV" data-testid="bounce">
        <h2>Bounce to WAV</h2>
        <p>The whole song, {clock(seconds)} plus a short tail, as 44.1 kHz 16-bit stereo. Mute and solo are honoured.</p>
        {skipped.length ? (
          <div className="skips" data-testid="skips">
            <b>Skipped: {skipped.length === 1 ? "1 MIDI-out lane" : `${skipped.length} MIDI-out lanes`}</b>
            <ul>{skipped.map((n) => <li key={n}>{n}</li>)}</ul>
            <span>A bounce can only render SoundFont lanes. Record these from your MIDI device separately.</span>
          </div>
        ) : <p className="hint" data-testid="skips">Nothing is skipped: every audible lane plays from a SoundFont.</p>}
        {job.status === "rendering" && <p role="status">Rendering…</p>}
        {job.status === "error" && <p className="warn" role="alert">The bounce failed: {job.error}</p>}
        {job.status === "done" && (
          <div className="done">
            <audio controls src={job.url} />
            <a className="download" href={job.url} download={name} data-testid="wav-link">Download {name} · {(job.size / 1048576).toFixed(1)} MB</a>
          </div>
        )}
        <div className="dialog-foot">
          <button onClick={onClose}>Close</button>
          {job.status !== "done" && <button className="primary" disabled={job.status === "rendering"} onClick={render} data-testid="render">Render</button>}
        </div>
      </div>
    </div>
  );
}
