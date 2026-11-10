// Plays a resolved song through a lookahead scheduler: a worker timer wakes every TICK_MS and
// schedules everything inside the next HORIZON seconds on the audio clock.

import { resolveSong, audibleLanes, assignChannels } from "../core/index.js";

const TICK_MS = 25, HORIZON = 0.12, START_DELAY = 0.1;
const FALLBACK_PROGRAM = 80; // for MIDI-out lanes auditioned on the soundfont

export function createPlayer({ ctx, synth, master }) {
  const timer = new Worker(URL.createObjectURL(new Blob([`
    let id = null;
    onmessage = (e) => { clearInterval(id); id = null; if (e.data > 0) id = setInterval(() => postMessage(0), e.data); };`],
    { type: "text/javascript" })));
  timer.onmessage = () => { if (state.playing) pump(); };

  const state = { playing: false, loop: false, startTime: 0, next: 0, pass: 0, late: 0, scheduled: 0 };
  let song = null, resolved = null, events = [], routes = new Map(), audible = new Set();
  let midiAccess = null, midiFallback = true;

  /** Audio-clock time -> performance-clock time at which it is heard. */
  function perfTimeFor(t) {
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.performanceTime > 0) return ts.performanceTime + (t - ts.contextTime) * 1000;
    return performance.now() + (t - ctx.currentTime) * 1000;
  }

  /** Decide where each lane goes and send its program, volume and pan. */
  function route() {
    const channels = assignChannels(song);
    routes = new Map();
    for (const lane of song.lanes) {
      const ch = channels.get(lane.id), ins = lane.instrument;
      const r = { ch, latency: (lane.latency_ms || 0) / 1000, out: "synth", port: null, note: "" };
      if (ins.backend === "midi") {
        const port = midiAccess && [...midiAccess.outputs.values()].find((o) => o.name === ins.port);
        if (port) { r.out = "midi"; r.port = port; r.note = `MIDI · ${ins.port} · ch ${ins.channel}`; }
        else if (midiFallback) r.note = `device not found: ${ins.port} (playing on the soundfont)`;
        else { r.out = "none"; r.note = `device not found: ${ins.port} (muted)`; }
      } else r.note = `SoundFont · program ${ins.program}${ins.drums ? " · drums" : ""}`;
      if (r.out === "synth") {
        if (ch !== 9) synth.programChange(ch, ins.program ?? FALLBACK_PROGRAM);
        synth.controllerChange(ch, 7, lane.volume);
        synth.controllerChange(ch, 10, lane.pan);
      } else if (r.out === "midi") {
        if (ins.program != null) r.port.send([0xc0 | ch, ins.program]);
        r.port.send([0xb0 | ch, 7, lane.volume]);
        r.port.send([0xb0 | ch, 10, lane.pan]);
      }
      routes.set(lane.id, r);
    }
    audible = audibleLanes(song);
    master.gain.value = (song.settings?.master_volume ?? 100) / 127;
  }

  const toEvents = (r) => r.notes.map((n) => {
    const sec = r.secAt(n.tick);
    return { lane: n.lane, pitch: n.pitch, vel: n.vel, sec, dur: r.secAt(n.tick + n.len) - sec };
  });

  function load(nextSong) {
    stop();
    song = nextSong;
    resolved = resolveSong(song);
    events = toEvents(resolved);
    route();
    return resolved;
  }

  /**
   * Swap in an edited song. While playing, the playhead keeps its musical position and
   * pitched notes that should be sounding right now are re-struck with the new pitches.
   */
  function update(nextSong) {
    if (!state.playing) return load(nextSong);
    const now = ctx.currentTime, until = now + HORIZON;
    const before = JSON.stringify(events) + resolved.totalSec;
    const posSec = now - state.startTime - state.pass * resolved.totalSec;
    const posTick = posSec > 0 ? resolved.tickAt(posSec) : 0;
    song = nextSong;
    resolved = resolveSong(song);
    events = toEvents(resolved);
    audible = audibleLanes(song);
    master.gain.value = (song.settings?.master_volume ?? 100) / 127;
    if (posSec > 0) { state.startTime = now - resolved.secAt(posTick % resolved.totalTicks); state.pass = 0; }
    const at = (e) => state.startTime + state.pass * resolved.totalSec + e.sec;
    state.next = events.findIndex((e) => at(e) >= until);
    if (state.next < 0) state.next = events.length;
    if (JSON.stringify(events) + resolved.totalSec === before) return resolved;
    for (const r of routes.values())
      if (r.out === "synth" && r.ch !== 9) synth.controllerChange(r.ch, 123, 0, { time: until });
    for (const e of events) {
      const t = at(e), r = routes.get(e.lane);
      if (t >= until || t + e.dur <= until + 0.05 || !r || r.out !== "synth" || r.ch === 9 || !audible.has(e.lane)) continue;
      synth.noteOn(r.ch, e.pitch, e.vel, { time: until + 0.005 });
      synth.noteOff(r.ch, e.pitch, { time: t + e.dur });
    }
    return resolved;
  }

  function pump() {
    const until = ctx.currentTime + HORIZON;
    for (;;) {
      if (state.next >= events.length) {
        const end = state.startTime + (state.pass + 1) * resolved.totalSec;
        if (!state.loop) { if (ctx.currentTime >= end) stop(); return; }
        if (end >= until) return;
        state.next = 0; state.pass++;
        continue;
      }
      const e = events[state.next];
      const t = state.startTime + state.pass * resolved.totalSec + e.sec;
      if (t >= until) return;
      state.next++;
      const r = routes.get(e.lane);
      if (!r || !audible.has(e.lane) || r.out === "none") continue;
      const at = t + r.latency;
      if (at < ctx.currentTime) state.late++;
      state.scheduled++;
      if (r.out === "synth") {
        synth.noteOn(r.ch, e.pitch, e.vel, { time: at });
        synth.noteOff(r.ch, e.pitch, { time: at + e.dur });
      } else {
        const ms = perfTimeFor(at);
        r.port.send([0x90 | r.ch, e.pitch, e.vel], ms);
        r.port.send([0x80 | r.ch, e.pitch, 0], ms + e.dur * 1000);
      }
    }
  }

  /** Play one note right away, outside the timeline (for auditioning). */
  function playNow(laneId, pitch, vel, dur) {
    const r = routes.get(laneId);
    if (!r) return;
    if (r.out === "synth") {
      synth.noteOn(r.ch, pitch, vel);
      synth.noteOff(r.ch, pitch, { time: ctx.currentTime + dur });
    } else if (r.out === "midi") {
      r.port.send([0x90 | r.ch, pitch, vel]);
      r.port.send([0x80 | r.ch, pitch, 0], performance.now() + dur * 1000);
    }
  }

  function play({ loop = false } = {}) {
    if (!resolved || state.playing) return;
    Object.assign(state, { playing: true, loop, startTime: ctx.currentTime + START_DELAY, next: 0, pass: 0, late: 0, scheduled: 0 });
    timer.postMessage(TICK_MS);
    pump();
  }

  function stop() {
    if (!state.playing) return;
    state.playing = false;
    timer.postMessage(0);
    for (const r of routes.values()) {
      if (r.out === "synth") synth.controllerChange(r.ch, 123, 0, { time: ctx.currentTime + HORIZON + 0.05 });
      if (r.out === "midi") { r.port.clear?.(); r.port.send([0xb0 | r.ch, 123, 0]); }
    }
  }

  return {
    load, update, play, stop, playNow, state,
    get resolved() { return resolved; },
    get routes() { return routes; },
    /** Seconds into the song, or -1 when stopped. */
    position() {
      if (!state.playing || !resolved) return -1;
      const t = ctx.currentTime - state.startTime;
      return t < 0 ? 0 : state.loop ? t % resolved.totalSec : Math.min(t, resolved.totalSec);
    },
    /** Ticks into the song, or -1 when stopped. */
    positionTicks() { const p = this.position(); return p < 0 ? -1 : resolved.tickAt(p); },
    setMute(laneId, mute) { song.lanes.find((l) => l.id === laneId).mute = mute; audible = audibleLanes(song); },
    setMidi(access, fallback) { midiAccess = access; midiFallback = fallback; if (song) { stop(); route(); } },
  };
}
