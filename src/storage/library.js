// The user's own library entries, in the three IndexedDB stores the spec sets aside for them.

import { db } from "./db.js";

const STORES = { patterns: "library_patterns", progressions: "library_progressions", sections: "library_sections" };

/** `{ patterns, progressions, sections }`, each a list of entries. */
export async function loadUserLibrary() {
  const [patterns, progressions, sections] = await Promise.all(Object.values(STORES).map((s) => db[s].toArray()));
  return { patterns, progressions, sections };
}

/** `kind` is "patterns", "progressions" or "sections". */
export const saveLibraryEntry = (kind, entry) => db[STORES[kind]].put(entry);
export const deleteLibraryEntry = (kind, id) => db[STORES[kind]].delete(id);
