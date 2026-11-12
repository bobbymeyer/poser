import { useRef, useState } from "react";
import { resolveChords } from "../core/index.js";
import { SECTION_TEMPLATES } from "../editor/arrangeOps.js";
import { lanePatterns } from "../editor/patternOps.js";

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const pretty = (id) => id.replace("b", "♭").replace("#", "♯");
const keyLabel = (x) => `${pretty(x.tonic)} ${cap(x.mode)}`;
const liftLabel = (x) => (x.lift > 0 ? `↑ +${x.lift}` : x.lift < 0 ? `↓ −${-x.lift}` : cap(x.mode));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

/** Drag cards along a row. Plain drag moves; Alt-drag copies a linked instance to the drop point. */
function useReorder({ onMove, onCopy }) {
  const row = useRef(null);
  const [drop, setDrop] = useState(null);
  const start = (e, index) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    let dragging = false, at = null;
    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientX - x0) < 6) return;
      dragging = true;
      const cards = [...row.current.querySelectorAll("[data-card]")];
      at = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.left + r.width / 2 < ev.clientX; }).length;
      setDrop(at);
    };
    const up = (ev) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      setDrop(null);
      if (!dragging || at === null) return;
      if (ev.altKey) return onCopy(index, at);
      const to = at > index ? at - 1 : at;
      if (to !== index) onMove(index, to);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  const dropClass = (i, n) => (drop === i ? " drop-before" : drop === n && i === n - 1 ? " drop-after" : "");
  return { row, start, dropClass };
}

function Tools({ infos, active, ops, library = [] }) {
  const pick = (value) => {
    if (!value) return;
    const entry = library.find((e) => e.id === value);
    if (entry) ops.addEntry(entry); else ops.add(SECTION_TEMPLATES.find((t) => t.name === value));
  };
  const mine = library.filter((e) => e.tag === "your library"), factory = library.filter((e) => e.tag !== "your library");
  return (
    <div className="arr-tools">
      <select aria-label="Add section" value="" onChange={(e) => pick(e.target.value)}>
        <option value="">Add section…</option>
        <optgroup label="Empty, in this key">
          {SECTION_TEMPLATES.map((t) => <option key={t.name} value={t.name}>{t.name} · {plural(t.bars, "bar")}</option>)}
        </optgroup>
        <optgroup label="Ready-made">
          {factory.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.tag}</option>)}
        </optgroup>
        {mine.length > 0 && <optgroup label="Your library">{mine.map((e) => <option key={e.id} value={e.id}>{e.name} · {plural(e.section.bars, "bar")}</option>)}</optgroup>}
      </select>
      <button onClick={ops.duplicate} title="Add another linked instance of this section (or Alt-drag a card)">Duplicate (linked)</button>
      <button aria-label="Move earlier" disabled={active === 0} onClick={() => ops.move(active, active - 1)}>◀</button>
      <button aria-label="Move later" disabled={active === infos.length - 1} onClick={() => ops.move(active, active + 1)}>▶</button>
      <button disabled={infos.length < 2} onClick={ops.remove}>Delete</button>
    </div>
  );
}

/** The arrangement strip above the section view. */
export function ArrangementStrip({ infos, active, playing, ops, library }) {
  const { row, start, dropClass } = useReorder({ onMove: ops.move, onCopy: ops.copy });
  const bars = infos.reduce((n, x) => n + x.bars, 0), cur = infos[active];
  return (
    <div className="arr">
      <div className="arr-head">
        <b>Arrangement</b>
        <span className="hint">{plural(bars, "bar")} · {plural(infos.length, "section")} · click selects, drag moves, Alt-drag copies a linked instance</span>
        <Tools infos={infos} active={active} ops={ops} library={library} />
      </div>
      <div className="arr-row" ref={row}>
        {infos.map((x, i) => (
          <button key={x.id} data-card data-testid="acard" style={{ flex: `${x.bars} 1 0` }}
            className={`acard${i === active ? " active" : x.sectionId === cur.sectionId ? " linked" : ""}${i === playing ? " playing" : ""}${dropClass(i, infos.length)}`}
            onPointerDown={(e) => { ops.select(i); start(e, i); }}>
            <span className="aname">
              {x.name}
              {x.keyChanged && <i className="lift">{liftLabel(x)}</i>}
              {x.count > 1 && <i className="badge">×{x.count}</i>}
            </span>
            <span className="ameta">{plural(x.bars, "bar")} · {keyLabel(x)} · <span className={x.tempoChanged ? "amber" : ""}>{x.bpm}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The song at a glance: one card per instance, as wide as it is long. */
export function Overview({ song, resolved, infos, active, playing, ops, onOpen, library }) {
  const { row, start, dropClass } = useReorder({ onMove: ops.move, onCopy: ops.copy });
  const bars = infos.reduce((n, x) => n + x.bars, 0), cur = infos[active];
  const oneTempo = infos.every((x) => x.bpm === infos[0].bpm);
  return (
    <div className="overview">
      <div className="arr-head">
        <h2>Song overview</h2>
        <span className="hint">Drag cards to reorder. Alt-drag copies as a linked instance. Double-click a card to open that section.</span>
      </div>
      <div className="arr-head">
        <span className="mono">{plural(infos.length, "section")} · {plural(bars, "bar")} · {clock(resolved.totalSec)}{oneTempo ? ` at ${infos[0].bpm}` : ""}</span>
        <Tools infos={infos} active={active} ops={ops} library={library} />
      </div>
      <div className="ov-row" ref={row}>
        {infos.map((x, i) => {
          const section = song.sections[x.sectionId];
          const chords = resolveChords(song, section).filter((c) => c.chord).map((c) => c.chord);
          const notes = resolved.notes.filter((n) => n.instance === i);
          const kit = song.lanes.find((l) => l.role === "kit");
          const groove = kit && song.patterns[lanePatterns(section, kit.id).main]?.name;
          return (
            <div key={x.id} data-card data-testid="ocard" role="button" tabIndex={0} style={{ width: Math.max(150, x.bars * 26) }}
              className={`ocard${i === active ? " active" : x.sectionId === cur.sectionId ? " linked" : ""}${i === playing ? " playing" : ""}${dropClass(i, infos.length)}`}
              onPointerDown={(e) => { ops.select(i); start(e, i); }}
              onDoubleClick={() => onOpen(i)}
              onKeyDown={(e) => { if (e.key === "Enter") onOpen(i); }}>
              <div className="aname">{x.name}<i className="badge">×{x.count}</i></div>
              <div className="hint">{plural(x.bars, "bar")}</div>
              <div className="chips">
                <span className={`kchip${x.keyChanged ? " amber" : ""}`}>{keyLabel(x)}{x.keyChanged && x.lift !== 0 ? ` ${liftLabel(x)}` : ""}</span>
                <span className={`kchip${x.tempoChanged ? " amber" : ""}`}>{x.bpm} · {x.meter}</span>
              </div>
              <div className="nums">{chords.length ? chords.map((c) => c.numeral).join(" – ") : "no chords yet"}</div>
              <div className="hint names">{chords.map((c) => c.name).join(" ")}</div>
              <div className="meters">
                {song.lanes.map((l) => {
                  const n = notes.filter((m) => m.lane === l.id).length;
                  return (
                    <div key={l.id} className={`meter role-${l.role}`}>
                      <span>{l.name}</span>
                      <div><i style={{ width: `${Math.min(100, (n / (x.bars * 16)) * 100)}%` }} /></div>
                    </div>
                  );
                })}
              </div>
              <div className="hint foot">{i === active && x.count > 1 ? `Active · edits affect ${x.count}` : groove || "No groove"}</div>
            </div>
          );
        })}
      </div>
      <ul className="ov-notes">
        <li><b>Linked instances</b> share a tint and a ×N badge. The selected card has the heavy border.</li>
        <li><b>Changes stand out.</b> A key or tempo chip turns amber on the first section where it differs from the one before.</li>
        <li><b>Card width</b> follows the bar count, so the row reads as a rough timeline.</li>
      </ul>
    </div>
  );
}
