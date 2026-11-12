import { FACTORY_PROGRESSIONS } from "../factory/patterns.js";
import { tileProgression, exportLibrary } from "../editor/libraryOps.js";

/** Chord progressions to drop onto the section: hover to hear one against the loop, click to use it. */
export function Progressions({ section, saved, onPreview, onApply, onSave }) {
  const item = (p) => (
    <button key={p.id} className="lib" data-testid="prog"
      onPointerEnter={(e) => { if (e.pointerType === "mouse") onPreview(tileProgression(p, section)); }}
      onPointerLeave={() => onPreview(null)}
      onClick={() => { onPreview(null); onApply(tileProgression(p, section)); }}>
      <b>{p.name}</b><span>{p.tag || `${p.bars} bars`}</span>
    </button>
  );
  return (
    <div className="card">
      <div className="card-title"><b>Progressions</b> Hover to hear one against the running loop. Click to replace this section's chords; it repeats to fill the section.</div>
      <div className="lib-list">
        {/* First, so that saving does not slide a new entry under the pointer and start previewing it. */}
        <button className="lib new" disabled={!section.chords.length} onClick={onSave}><b>Save these chords</b><span>to your library</span></button>
        {FACTORY_PROGRESSIONS.map(item)}
        {saved.map(item)}
      </div>
    </div>
  );
}

const KINDS = [["patterns", "Patterns", (e) => e.pattern.name || "Pattern"], ["progressions", "Progressions", (e) => e.name], ["sections", "Sections", (e) => e.name]];

/** What the user has saved, with delete, and the export that writes the factory file's shape. */
export function LibraryDialog({ user, onDelete, onClose }) {
  const empty = KINDS.every(([kind]) => !user[kind].length);
  function download() {
    const blob = new Blob([JSON.stringify(exportLibrary(user), null, 1) + "\n"], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "library.json" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label="Library" data-testid="library">
        <div className="dialog-head"><h2>Your library</h2><button onClick={download} data-testid="export-library">Export library.json</button></div>
        <p className="hint">Patterns, progressions and sections you save are kept in this browser and offered in every song. The export holds the factory library plus yours, in the format of <code>src/factory/library.json</code>.</p>
        {KINDS.map(([kind, title, name]) => (
          <div key={kind}>
            <h3>{title}</h3>
            <ul className="rows">
              {user[kind].map((e) => (
                <li key={e.id} data-testid="lib-row">
                  <span className="grow"><b>{name(e)}</b>{kind === "patterns" && <small>{e.pattern.role || e.pattern.kind}</small>}{kind === "sections" && <small>{e.section.bars} bars</small>}{kind === "progressions" && <small>{e.bars} bars</small>}</span>
                  <button onClick={() => onDelete(kind, e.id)}>Delete</button>
                </li>
              ))}
              {!user[kind].length && <li className="hint">None saved.</li>}
            </ul>
          </div>
        ))}
        {empty && <p className="hint storage">Save a pattern from its editor, a progression from the chord lane, or a section from its header.</p>}
        <div className="dialog-foot"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
