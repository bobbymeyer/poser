// The app's one audio engine. Starts lazily on the first user gesture, loads the factory
// soundfont, and keeps the player in step with the song being edited.

import { createSynth, fetchDefaultSoundFont, loadSoundFont } from "./synth.js";
import { createPlayer } from "./player.js";
import { resolveChord, bassVoicing, nearestVoicing } from "../core/index.js";

const listeners = new Set();
let audio = null, player = null, starting = null, song = null, wantPlay = false, wantLoop = true;
let viewOffset = 0, viewLen = Infinity, wantCountIn = null;

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
        player = createPlayer(audio, { onEnd: () => { wantPlay = false; notify(); } });
        if (song) player.load(song);
        setStatus("ready");
        if (wantPlay) engine.play({ loop: wantLoop, countIn: wantCountIn });
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
  setSong(next, opts) {
    song = next;
    if (player) player.update(next, opts);
  },

  get playing() { return wantPlay; },
  /**
   * Loop the song given to `setSong`, or play it once to the end.
   * `countIn` is `{ beats, bpm }`: that many clicks first, then the song starts on the next beat.
   */
  play({ loop = true, countIn = null } = {}) {
    wantPlay = true;
    wantLoop = loop;
    wantCountIn = countIn;
    if (player) {
      player.stop();
      const beat = countIn ? 60 / countIn.bpm : 0;
      player.play({ loop, delay: countIn ? countIn.beats * beat : 0 });
      if (countIn) for (let i = 0; i < countIn.beats; i++) player.click(player.startTime - (countIn.beats - i) * beat, i === 0);
    } else engine.start();
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

  /** Live playing: see the player. All are no-ops until the engine is ready. */
  noteOn(laneId, pitch, vel) { player?.noteOn(laneId, pitch, vel); },
  noteOff(laneId, pitch) { player?.noteOff(laneId, pitch); },
  click(time, accent) { player?.click(time, accent); },
  heardTicks(agoSec) { return player ? player.heardTicks(agoSec) : -1; },
  /** Audio-clock time now, and the time the playing song started (for scheduling clicks). */
  get now() { return audio ? audio.ctx.currentTime : 0; },
  get startTime() { return player ? player.startTime : 0; },

  /** Tell the engine which stretch of the playing song the screen is showing. */
  setView(offset, len) { viewOffset = offset; viewLen = len; },
  /** Ticks into the stretch on screen, or -1 when stopped or playing elsewhere. */
  localTicks() {
    const t = engine.positionTicks() - viewOffset;
    return t >= 0 && t < viewLen ? t : -1;
  },

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
