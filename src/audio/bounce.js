// WAV bounce: render the song's SoundFont lanes offline and encode 16-bit stereo PCM.

import { WorkletSynthesizer } from "spessasynth_lib";
import { BasicMIDI } from "spessasynth_core";
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";
import { resolveSong, exportMidi } from "../core/index.js";
import { soundFontOnly } from "../editor/laneOps.js";
import { engine } from "./engine.js";

const RATE = 44100, TAIL = 2.5; // seconds left for the last notes to ring out

/** @returns `{ blob, seconds }` */
export async function bounceWav(song) {
  const heard = soundFontOnly(song);
  const resolved = resolveSong(heard);
  const bytes = exportMidi(heard, resolved, { bankOf: engine.bankOf });
  const midi = BasicMIDI.fromArrayBuffer(bytes.buffer);
  const seconds = resolved.totalSec + TAIL;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, sampleRate: RATE, length: Math.ceil(seconds * RATE) });
  await ctx.audioWorklet.addModule(processorUrl);
  const synth = new WorkletSynthesizer(ctx);
  await synth.startOfflineRender({ midiSequence: midi, loopCount: 0, soundBankList: await engine.bankFiles(heard.lanes.filter((l) => l.instrument.backend === "soundfont")) });
  synth.connect(ctx.destination);
  const audio = await ctx.startRendering();
  return { blob: encodeWav(audio, (song.settings?.master_volume ?? 100) / 127), seconds };
}

function encodeWav(audio, gain) {
  const frames = audio.length, left = audio.getChannelData(0), right = audio.getChannelData(1);
  const view = new DataView(new ArrayBuffer(44 + frames * 4));
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + frames * 4, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, frames * 4, true);
  const put = (at, v) => view.setInt16(at, Math.max(-1, Math.min(1, v * gain)) * 0x7fff, true);
  for (let i = 0; i < frames; i++) { put(44 + i * 4, left[i]); put(46 + i * 4, right[i]); }
  return new Blob([view], { type: "audio/wav" });
}
