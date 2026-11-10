// SoundFont synth setup shared by the test pages.

import { WorkletSynthesizer } from "spessasynth_lib";
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";

/** Creates the audio context and synth. Must be called from a click. */
export async function createSynth() {
  const ctx = new AudioContext({ latencyHint: "interactive" });
  await ctx.audioWorklet.addModule(processorUrl);
  const synth = new WorkletSynthesizer(ctx);
  const master = ctx.createGain();
  synth.connect(master);
  master.connect(ctx.destination);
  await ctx.resume();
  return { ctx, synth, master };
}

/** Fetch a soundfont file, or null when it is not there. */
export async function fetchDefaultSoundFont(url) {
  try {
    const res = await fetch(url);
    if (!res.ok || (res.headers.get("content-type") || "").includes("text/html")) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export async function loadSoundFont(synth, buffer) {
  await synth.soundBankManager.addSoundBank(buffer, "main");
  await synth.isReady;
}
