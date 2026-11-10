// One tab edits a song at a time. A tab that opens a song already open elsewhere is told so
// and goes read-only; "Use here" takes the song over and the other tab goes read-only.

const me = Math.random().toString(36).slice(2);

/**
 * @param onLost called with no arguments when this tab must stop editing the current song.
 * @returns `{ claim(id), take(id), close() }`. `claim` resolves true if the song is ours.
 */
export function watchTabs(onLost) {
  if (typeof BroadcastChannel === "undefined") return { claim: async () => true, take() {}, close() {} };
  const channel = new BroadcastChannel("layered-composer");
  let current = null, owner = false, waiting = null;
  channel.onmessage = ({ data }) => {
    if (!data || data.tab === me || data.id !== current) return;
    if (data.type === "who" && owner) channel.postMessage({ type: "here", id: current, tab: me });
    if (data.type === "here" && waiting) { waiting(false); waiting = null; }
    if (data.type === "take" && owner) { owner = false; onLost(); }
  };
  return {
    /** Ask whether another tab has this song. Waits a moment for an answer. */
    claim(id) {
      current = id;
      owner = false;
      waiting?.(false);
      return new Promise((resolve) => {
        const done = (mine) => { if (current === id) owner = mine; resolve(mine); };
        waiting = done;
        channel.postMessage({ type: "who", id, tab: me });
        setTimeout(() => { if (waiting === done) { waiting = null; done(true); } }, 250);
      });
    },
    /** Take the song over from whichever tab has it. */
    take(id) {
      current = id;
      owner = true;
      channel.postMessage({ type: "take", id, tab: me });
    },
    close() { channel.close(); },
  };
}
