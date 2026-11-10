// The app's one audio engine. Starts lazily on the first user gesture, loads the factory
// SoundFont, and keeps the player in step with the song being edited.

import { createSynth, fetchDefaultSoundFont, loadSoundFont } from "./synth.js";
import { createPlayer } from "./player.js";
import { resolveChord, bassVoicing, nearestVoicing } from "../core/index.js";
import { FACTORY_SOUNDFONT } from "../editor/template.js";
import { getSoundFont, storeSoundFont } from "../storage/db.js";

const FACTORY_URL = () => new URL("soundfonts/default.sf3", document.baseURI);
const listeners = new Set();
let audio = null, player = null, starting = null, song = null, wantPlay = false, wantLoop = true;
let viewOffset = 0, viewLen = Infinity, wantCountIn = null, midiAccess = null;

// SoundFonts loaded into the synth: hash -> bank offset. A user font's presets sit at its offset.
const banks = new Map([[FACTORY_SOUNDFONT.hash, 0]]);
const loading = new Set(), missing = new Set();
const bankOf = (lane) => banks.get(lane.instrument.sf) ?? 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freeOffset() {
  const used = new Set([...audio.synth.presetList.map((p) => p.bankMSB), ...banks.values()]);
  for (let o = 64; o < 127; o++) if (!used.has(o)) return o;
  throw new Error("too many SoundFonts loaded");
}

async function loadBank(hash) {
  if (banks.has(hash) || loading.has(hash) || !audio) return;
  loading.add(hash);
  notify();
  try {
    const stored = await getSoundFont(hash);
    if (!stored) { missing.add(hash); return; }
    const offset = freeOffset();
    banks.set(hash, -1); // reserve while loading
    await audio.synth.soundBankManager.addSoundBank(await stored.blob.arrayBuffer(), hash, offset);
    for (let i = 0; i < 50 && !audio.synth.presetList.some((p) => p.bankMSB === offset); i++) await sleep(100);
    banks.set(hash, offset);
    missing.delete(hash);
    player?.reroute();
  } catch (err) {
    console.error(err);
    banks.delete(hash);
    missing.add(hash);
  } finally {
    loading.delete(hash);
    notify();
  }
}

/** Load whatever SoundFonts the song's lanes ask for and this browser has. */
function syncBanks() {
  if (!audio || !song) return;
  for (const lane of song.lanes) {
    const h = lane.instrument.backend === "soundfont" && lane.instrument.sf;
    if (h && !banks.has(h) && !missing.has(h)) loadBank(h);
  }
}

export const engine = {
  /** "off" | "loading" | "ready" | "error" */
  status: "off",
  /** Bumps on every change a screen might care about. */
  version: 0,
  error: "",
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** Call from a click or key press. Safe to call repeatedly. */
  start() {
    starting ??= (async () => {
      setStatus("loading");
      try {
        audio = await createSynth();
        const buf = await fetchDefaultSoundFont(FACTORY_URL());
        if (!buf) throw new Error("the factory SoundFont is missing");
        await loadSoundFont(audio.synth, buf);
        player = createPlayer(audio, { onEnd: () => { wantPlay = false; notify(); }, bankOf });
        player.setMidi(midiAccess, false);
        if (song) player.load(song);
        setStatus("ready");
        syncBanks();
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

  /** Give the engine the song to play. Live edits keep the playhead where it is. */
  setSong(next, opts) {
    song = next;
    if (player) player.update(next, opts);
    syncBanks();
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

  /** Ticks into the playing song, or -1 when stopped. */
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

  // ---- SoundFonts

  /** "ready" | "loading" | "missing" (not in this browser) | "off" (audio not started). */
  fontState(hash) {
    if (!audio) return "off";
    if ((banks.get(hash) ?? -1) >= 0) return "ready";
    return missing.has(hash) ? "missing" : "loading";
  },
  /** Store a SoundFont file in this browser and load it. @returns `{ hash, name }`. */
  async addSoundFont(file) {
    const font = await storeSoundFont(file);
    missing.delete(font.hash);
    await loadBank(font.hash);
    if (engine.fontState(font.hash) === "missing") throw new Error(`${file.name} could not be read as a SoundFont`);
    return font;
  },
  /** Presets of a loaded SoundFont as `{ program, name }`: its melodic bank 0, or its drum kits. */
  presets(hash, drums = false) {
    const offset = banks.get(hash);
    if (!audio || offset === undefined || offset < 0) return [];
    const seen = new Set();
    return audio.synth.presetList
      .filter((p) => p.bankMSB === offset && !p.bankLSB && !!p.isGMGSDrum === drums && !seen.has(p.program) && seen.add(p.program))
      .map((p) => ({ program: p.program, name: p.name }))
      .sort((a, b) => a.program - b.program);
  },
  /** For an offline render: the SoundFont files the song's audible lanes use, with their bank offsets. */
  async bankFiles(lanes) {
    const out = [{ bankOffset: 0, soundBankBuffer: await fetchDefaultSoundFont(FACTORY_URL()) }];
    for (const hash of new Set(lanes.map((l) => l.instrument.sf))) {
      const offset = banks.get(hash);
      if (!offset || offset < 0) continue;
      out.push({ bankOffset: offset, soundBankBuffer: await (await getSoundFont(hash)).blob.arrayBuffer() });
    }
    return out;
  },
  bankOf,

  // ---- MIDI out

  /** Ask for MIDI access (shows the browser's permission prompt). */
  async enableMidi() {
    if (!navigator.requestMIDIAccess) throw new Error("This browser has no Web MIDI");
    midiAccess = await navigator.requestMIDIAccess();
    midiAccess.onstatechange = () => { player?.setMidi(midiAccess, false); notify(); };
    player?.setMidi(midiAccess, false);
    notify();
  },
  /** Names of the MIDI output ports, or null before `enableMidi`. */
  get midiPorts() { return midiAccess ? [...midiAccess.outputs.values()].map((o) => o.name) : null; },

  /** For tests. */
  get audio() { return audio; },
  get player() { return player; },
};

function setStatus(s) { engine.status = s; notify(); }
function notify() { engine.version++; for (const fn of listeners) fn(); }
if (typeof window !== "undefined") window.__engine = engine;
