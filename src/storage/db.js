// IndexedDB via Dexie. All stores from the spec are declared now so later phases need no
// schema migration; phase 2 only uses `projects`.

import Dexie from "dexie";

export const db = new Dexie("layered-composer");
db.version(1).stores({
  projects: "id, updated_at",
  snapshots: "[project_id+n], project_id",
  soundfonts: "hash",
  library_patterns: "id",
  library_sections: "id",
  library_progressions: "id",
});

const LAST = "layered-composer:last-project";

export async function saveProject(song) {
  await db.projects.put(song);
  try { localStorage.setItem(LAST, song.id); } catch {}
}

/** The project that was open last, else the most recently edited one, else null. */
export async function loadLastProject() {
  let id = null;
  try { id = localStorage.getItem(LAST); } catch {}
  return (id && (await db.projects.get(id))) || (await db.projects.orderBy("updated_at").last()) || null;
}

// ---- SoundFonts, stored by content hash

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Store a SoundFont file. @returns `{ hash, name }`; the hash is "sha256:" plus the file's digest. */
export async function storeSoundFont(file) {
  const buffer = await file.arrayBuffer();
  const hash = `sha256:${hex(await crypto.subtle.digest("SHA-256", buffer))}`;
  await db.soundfonts.put({ hash, name: file.name, blob: new Blob([buffer]) });
  return { hash, name: file.name };
}

export const getSoundFont = (hash) => db.soundfonts.get(hash);

/** `{ hash, name }` of every SoundFont stored in this browser. */
export async function listSoundFonts() {
  const out = [];
  await db.soundfonts.each((f) => out.push({ hash: f.hash, name: f.name }));
  return out;
}
