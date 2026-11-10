// Editor state: the song, the caret, the sticky chord length, and undo history.

import { normalize, visibleCount, sectionLength } from "../editor/chordOps.js";
import { ensureKit } from "../editor/patternOps.js";

const HISTORY = 200;

/** Phase 2 edits one section: the one the first arrangement instance points at. */
export const sectionId = (song) => song.arrangement[0].section;
export const sectionOf = (song) => song.sections[sectionId(song)];

export function withSection(song, patch) {
  const id = sectionId(song);
  return { ...song, updated_at: new Date().toISOString(), sections: { ...song.sections, [id]: { ...song.sections[id], ...patch } } };
}

/** The song the engine loops: just the edited section, optionally in an auditioned mode. */
export function loopSong(song, mode = null) {
  const id = sectionId(song), section = song.sections[id];
  return {
    ...song,
    arrangement: [song.arrangement[0]],
    sections: mode && mode !== section.mode ? { ...song.sections, [id]: { ...section, mode } } : song.sections,
  };
}

const clampCaret = (song, caret) => {
  const s = sectionOf(song);
  return Math.max(0, Math.min(visibleCount(s.chords, sectionLength(s)), caret));
};

export function reducer(state, action) {
  switch (action.type) {
    case "load": {
      const song = ensureKit(withSection(action.song, { chords: normalize(sectionOf(action.song).chords) }));
      song.updated_at = action.song.updated_at;
      return { song, caret: clampCaret(song, Infinity), sticky: null, past: [], future: [] };
    }
    case "edit": {
      if (action.song === state.song) return action.caret === undefined ? state : { ...state, caret: clampCaret(state.song, action.caret) };
      return {
        song: action.song,
        caret: clampCaret(action.song, action.caret ?? state.caret),
        sticky: action.sticky === undefined ? state.sticky : action.sticky,
        past: [...state.past.slice(-HISTORY), { song: state.song, caret: state.caret }],
        future: [],
      };
    }
    case "caret":
      return { ...state, caret: clampCaret(state.song, action.caret) };
    case "undo": {
      const prev = state.past.at(-1);
      if (!prev) return state;
      return { ...state, ...prev, past: state.past.slice(0, -1), future: [{ song: state.song, caret: state.caret }, ...state.future] };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return { ...state, ...next, past: [...state.past, { song: state.song, caret: state.caret }], future: state.future.slice(1) };
    }
    default:
      return state;
  }
}
