import { useEffect, useState } from "react";
import { listProjects, listSnapshots, soundFontSizes, removeSoundFont, duplicateProject, deleteProject, storageEstimate, SNAPSHOT_LIMIT } from "../storage/db.js";

const when = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

/** Songs in this browser, snapshots of the open one, stored SoundFonts, and storage status. */
export function SongsDialog({ current, persisted, locked, onOpen, onNew, onRestore, onDeletedCurrent, onClose }) {
  const [songs, setSongs] = useState(null);
  const [snaps, setSnaps] = useState([]);
  const [fonts, setFonts] = useState([]);
  const [usage, setUsage] = useState(null);
  const refresh = async () => {
    setSongs(await listProjects());
    setSnaps(await listSnapshots(current.id));
    setFonts(await soundFontSizes());
    setUsage(await storageEstimate());
  };
  useEffect(() => { refresh(); }, [current.id]);

  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label="Songs" data-testid="songs">
        <div className="dialog-head"><h2>Songs in this browser</h2><button className="primary" onClick={onNew} data-testid="new-song">New song</button></div>
        <ul className="rows">
          {(songs || []).map((s) => (
            <li key={s.id} className={s.id === current.id ? "current" : ""} data-testid="song-row">
              <span className="grow"><b>{s.title || "Untitled song"}</b>{s.id === current.id && <i className="tag">open</i>}<small>edited {when(s.updated_at)}</small></span>
              {s.id !== current.id && <button onClick={() => onOpen(s.id)}>Open</button>}
              <button onClick={async () => { await duplicateProject(s.id); refresh(); }}>Duplicate</button>
              <button onClick={async () => {
                if (!confirm(`Delete "${s.title || "Untitled song"}" and its snapshots from this browser? This cannot be undone.`)) return;
                await deleteProject(s.id);
                if (s.id === current.id) onDeletedCurrent(); else refresh();
              }}>Delete</button>
            </li>
          ))}
          {songs && !songs.length && <li className="hint">Nothing saved yet.</li>}
        </ul>

        <h3>Snapshots of “{current.title || "Untitled song"}”</h3>
        <p className="hint">A copy is kept every ten minutes while you edit, and before a file or snapshot replaces the song. The last {SNAPSHOT_LIMIT} are kept.</p>
        <ul className="rows">
          {snaps.map((s) => (
            <li key={s.n} data-testid="snap-row">
              <span className="grow"><b>{when(s.at)}</b><small>{s.reason} · {s.sections} section{s.sections === 1 ? "" : "s"}</small></span>
              <button disabled={locked} onClick={() => onRestore(s.n)}>Restore</button>
            </li>
          ))}
          {!snaps.length && <li className="hint">No snapshots yet.</li>}
        </ul>

        <h3>Stored SoundFonts</h3>
        <ul className="rows">
          {fonts.map((f) => (
            <li key={f.hash}>
              <span className="grow"><b>{f.name}</b><small>{mb(f.bytes)}</small></span>
              <button onClick={async () => {
                if (!confirm(`Remove ${f.name} from this browser? Lanes that use it will play on the factory SoundFont until it is loaded again.`)) return;
                await removeSoundFont(f.hash);
                refresh();
              }}>Remove</button>
            </li>
          ))}
          {!fonts.length && <li className="hint">None. The factory SoundFont ships with the app and is not stored here.</li>}
        </ul>

        <p className="hint storage" data-testid="storage">
          {persisted === true ? "Storage is persistent: the browser will not clear it to free space."
            : persisted === false ? "Storage is not persistent: the browser may clear it if the disk runs low. Keep file backups."
            : "The browser has not said whether storage is persistent. Keep file backups."}
          {usage ? ` Using ${mb(usage.used)}${usage.quota ? ` of ${mb(usage.quota)}` : ""}.` : ""}
        </p>
        <div className="dialog-foot"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
