// The app's one audio engine. Starts lazily on the first user gesture, loads the factory
// soundfont, and keeps the player in step with the song being edited.

import { createSynth, fetchDefaultSoundFont, loadSoundFont } from "./synth.js";
import { createPlayer } from "./player.js";
import { resolveChord, bassVoicing, nearestVoicing } from "../core/index.js";

const listeners = new Set();
let audio = null, player = null, starting = null, song = null, wantPlay = false;

export const engine = {
  /** "off" | "loading" | "ready" | "error" */
  status: "off",
  error: "",
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** Call from a click or key press. Safe to call repeatedly. */
  start() {
    starting ??= (async () => {
      setStatus("loading");
      try {
        audio = await createSynth();
        const buf = await fetchDefaultSoundFont(new URL("soundfonts/default.sf3", document.baseURI));
        if (!buf) throw new Error("the factory SoundFont is missing");
        await loadSoundFont(audio.synth, buf);
        player = createPlayer(audio);
        if (song) player.load(song);
        setStatus("ready");
        if (wantPlay) engine.play();
      } catch (err) {
        console.error(err);
        engine.error = err.message;
        starting = null;
        setStatus("error");
      }
    })();
    return starting;
  },

  /** Give the engine the song to loop. Live edits keep the playhead where it is. */
  setSong(next) {
    song = next;
    if (player) player.update(next);
  },

  get playing() { return wantPlay; },
  play() {
    wantPlay = true;
    if (player) player.play({ loop: true }); else engine.start();
    notify();
  },
  stop() {
    wantPlay = false;
    player?.stop();
    notify();
  },
  toggle() { if (wantPlay) engine.stop(); else engine.play(); },

  /** Ticks into the loop, or -1 when stopped. */
  positionTicks() { return player ? player.positionTicks() : -1; },

  /** Sound one chord right away on every pitched lane (used when typing while stopped). */
  audition(stored, section, minorDominant) {
    if (!player || wantPlay || !song) return;
    const chord = resolveChord(stored, { tonic: section.tonic, mode: section.mode, minorDominant });
    if (!chord) return;
    for (const lane of song.lanes) {
      if (lane.role === "kit" || lane.role === "lead" || !lane.register || lane.mute) continue;
      const pitches = lane.role === "bass" ? bassVoicing(chord, lane.register).slice(0, 1) : nearestVoicing(chord, lane.register);
      for (const p of pitches) player.playNow(lane.id, p, 84, 0.9);
    }
  },

  /** For tests. */
  get audio() { return audio; },
  get player() { return player; },
};

function setStatus(s) { engine.status = s; notify(); }
function notify() { for (const fn of listeners) fn(); }
if (typeof window !== "undefined") window.__engine = engine;
