// Editor state: the song, the selected instance, the caret, the sticky chord length, and undo history.

import { normalize, visibleCount, sectionLength } from "../editor/chordOps.js";
import { ensureKit } from "../editor/patternOps.js";

const HISTORY = 200;
const clampInst = (song, inst) => Math.max(0, Math.min(song.arrangement.length - 1, inst));

/** The section definition behind arrangement instance `inst`. */
export const sectionId = (song, inst = 0) => song.arrangement[clampInst(song, inst)].section;
export const sectionOf = (song, inst = 0) => song.sections[sectionId(song, inst)];

export function withSection(song, inst, patch) {
  const id = sectionId(song, inst);
  return { ...song, updated_at: new Date().toISOString(), sections: { ...song.sections, [id]: { ...song.sections[id], ...patch } } };
}

const withMode = (song, inst, mode) => {
  const id = sectionId(song, inst), section = song.sections[id];
  return mode && mode !== section.mode ? { ...song, sections: { ...song.sections, [id]: { ...section, mode } } } : song;
};

/** One instance on its own, for looping and for drawing; optionally in an auditioned mode. */
export function loopSong(song, inst, mode = null) {
  return { ...withMode(song, inst, mode), arrangement: [song.arrangement[clampInst(song, inst)]] };
}

/** The song from instance `start` to the end, for "Play song". */
export function songFrom(song, start, inst, mode = null) {
  return { ...withMode(song, inst, mode), arrangement: song.arrangement.slice(clampInst(song, start)) };
}

const clampCaret = (song, inst, caret) => {
  const s = sectionOf(song, inst);
  return Math.max(0, Math.min(visibleCount(s.chords, sectionLength(s)), caret));
};
const snap = (s) => ({ song: s.song, inst: s.inst, caret: s.caret });

export function reducer(state, action) {
  switch (action.type) {
    case "load": {
      const sections = Object.fromEntries(Object.entries(action.song.sections).map(([id, s]) => [id, { ...s, chords: normalize(s.chords) }]));
      const song = ensureKit({ ...action.song, sections });
      return { song, inst: 0, caret: clampCaret(song, 0, Infinity), sticky: null, past: [], future: [] };
    }
    case "edit": {
      const inst = clampInst(action.song, action.inst ?? state.inst);
      const moved = inst !== state.inst;
      const caret = clampCaret(action.song, inst, action.caret ?? (moved ? Infinity : state.caret));
      if (action.song === state.song) return { ...state, inst, caret };
      return {
        song: action.song, inst, caret,
        sticky: action.sticky !== undefined ? action.sticky : moved ? null : state.sticky,
        past: [...state.past.slice(-HISTORY), snap(state)],
        future: [],
      };
    }
    case "caret":
      return { ...state, caret: clampCaret(state.song, state.inst, action.caret) };
    case "select": {
      const inst = clampInst(state.song, action.inst);
      return inst === state.inst ? state : { ...state, inst, caret: clampCaret(state.song, inst, Infinity), sticky: null };
    }
    case "undo": {
      const prev = state.past.at(-1);
      if (!prev) return state;
      return { ...state, ...prev, sticky: null, past: state.past.slice(0, -1), future: [snap(state), ...state.future] };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return { ...state, ...next, sticky: null, past: [...state.past, snap(state)], future: state.future.slice(1) };
    }
    default:
      return state;
  }
}
