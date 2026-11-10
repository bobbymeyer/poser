import { useEffect, useRef } from "react";
import { METERS } from "../core/index.js";
import { engine } from "../audio/engine.js";

const barsLabel = (ticks, bar) => {
  const n = ticks / bar;
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")} bar${n === 1 ? "" : "s"}`;
};

/**
 * The chord row: bar ruler, blocks, typing caret, "next" ghost, drag handles and playhead.
 * `blocks` are `{ start, end, chord, was, stored }`, already resolved for display.
 */
export default function ChordLane({ section, len, blocks, caret, sticky, full, onCaret, onDrag, onDragEnd }) {
  const bar = METERS[section.meter].barTicks;
  const lane = useRef(null), playhead = useRef(null), dragging = useRef(null);
  const pct = (t) => `${(t / len) * 100}%`;
  const filledEnd = blocks.length ? blocks.at(-1).end : 0;
  const caretTick = caret < blocks.length ? blocks[caret].start : Math.min(filledEnd, len);

  useEffect(() => {
    let raf;
    const tick = () => {
      const t = engine.localTicks();
      if (playhead.current) {
        playhead.current.style.display = t < 0 ? "none" : "block";
        playhead.current.style.left = pct(Math.min(t, len));
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [len]);

  const tickAt = (clientX) => {
    const r = lane.current.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * len;
  };
  const handleDown = (e, i) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = i;
  };
  const handleMove = (e) => { if (dragging.current !== null) onDrag(dragging.current, tickAt(e.clientX)); };
  const handleUp = () => { if (dragging.current !== null) { dragging.current = null; onDragEnd(); } };

  return (
    <div className="lane">
      <div className="ruler">
        {Array.from({ length: section.bars }, (_, i) => (
          <span key={i} style={{ left: pct(i * bar) }}>{i + 1}</span>
        ))}
      </div>
      <div className="blocks" ref={lane} onPointerDown={() => onCaret(blocks.length)}>
        {Array.from({ length: section.bars - 1 }, (_, i) => (
          <i key={i} className="barline" style={{ left: pct((i + 1) * bar) }} />
        ))}
        {blocks.map((b, i) => (
          <div
            key={i}
            className={`block${b.chord ? "" : " rest"}${b.was ? " changed" : ""}${i === caret - 1 ? " active" : ""}`}
            style={{ left: pct(b.start), width: pct(b.end - b.start) }}
            onPointerDown={(e) => { e.stopPropagation(); onCaret(i + 1); }}
            data-testid="block"
          >
            <b>{b.chord ? b.chord.numeral : "–"}</b>
            <span>{b.chord ? b.chord.name : "rest"}</span>
            {b.was ? <em>was {b.was}</em> : b.chord?.raisedDominant ? <em className="plain">minor dominant</em> : null}
            <div
              className="handle"
              title="Drag to resize"
              onPointerDown={(e) => handleDown(e, i)}
              onPointerMove={handleMove}
              onPointerUp={handleUp}
              onPointerCancel={handleUp}
            />
          </div>
        ))}
        {caret >= blocks.length && !full && (
          <div className="ghost" style={{ left: pct(filledEnd), width: pct(Math.min(sticky, len - filledEnd)) }}>
            next: {barsLabel(Math.min(sticky, len - filledEnd), bar)}
          </div>
        )}
        <div className="caret" style={{ left: pct(caretTick) }} data-testid="caret" />
        <div className="playhead" ref={playhead} />
      </div>
    </div>
  );
}
