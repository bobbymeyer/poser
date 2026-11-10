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

/** Remove a stored SoundFont. Lanes that used it fall back to the factory sound. */
export const removeSoundFont = (hash) => db.soundfonts.delete(hash);

/** `{ hash, name, bytes }` of every stored SoundFont, for the storage list. */
export async function soundFontSizes() {
  const out = [];
  await db.soundfonts.each((f) => out.push({ hash: f.hash, name: f.name, bytes: f.blob?.size ?? 0 }));
  return out;
}

// ---- song list

/** Every song in this browser, most recently edited first. */
export async function listProjects() {
  const out = [];
  await db.projects.orderBy("updated_at").reverse().each((p) => out.push({
    id: p.id, title: p.title, updated_at: p.updated_at, bars: p.arrangement?.length ?? 0,
  }));
  return out;
}

export const getProject = (id) => db.projects.get(id);

export async function deleteProject(id) {
  await db.transaction("rw", db.projects, db.snapshots, async () => {
    await db.projects.delete(id);
    await db.snapshots.where("project_id").equals(id).delete();
  });
  forgetBackup(id);
}

/** Copy a song under a new ID. @returns the copy. */
export async function duplicateProject(id) {
  const src = await db.projects.get(id);
  if (!src) return null;
  const now = new Date().toISOString();
  const copy = { ...structuredClone(src), id: `prj_${Math.random().toString(36).slice(2, 8)}`, title: `${src.title || "Untitled song"} copy`, created_at: now, updated_at: now };
  await db.projects.put(copy);
  return copy;
}

// ---- snapshots: recent copies of a song, newest last

export const SNAPSHOT_LIMIT = 20;

/** Keep a copy of the song. Older copies beyond the limit are dropped. */
export async function takeSnapshot(song, reason) {
  await db.transaction("rw", db.snapshots, async () => {
    const mine = db.snapshots.where("project_id").equals(song.id);
    const last = (await mine.sortBy("n")).at(-1);
    if (last && JSON.stringify(last.song) === JSON.stringify(song)) return; // nothing changed since the last one
    await db.snapshots.put({ project_id: song.id, n: (last?.n ?? 0) + 1, at: new Date().toISOString(), reason, song });
    const all = await mine.sortBy("n");
    for (const old of all.slice(0, Math.max(0, all.length - SNAPSHOT_LIMIT))) await db.snapshots.delete([old.project_id, old.n]);
  });
}

/** `{ n, at, reason, title, sections }` for a song's snapshots, newest first. */
export async function listSnapshots(projectId) {
  const all = await db.snapshots.where("project_id").equals(projectId).sortBy("n");
  return all.reverse().map((s) => ({ n: s.n, at: s.at, reason: s.reason, title: s.song.title, sections: s.song.arrangement?.length ?? 0 }));
}

export const getSnapshot = async (projectId, n) => (await db.snapshots.get([projectId, n]))?.song ?? null;

// ---- backups: when each song was last saved to (or opened from) a file. Kept beside the
// database because it describes this browser, not the song.

const BACKUPS = "layered-composer:backups";
const readBackups = () => { try { return JSON.parse(localStorage.getItem(BACKUPS)) || {}; } catch { return {}; } };
const writeBackups = (map) => { try { localStorage.setItem(BACKUPS, JSON.stringify(map)); } catch {} };

export const lastBackup = (id) => readBackups()[id] ?? null;
export function markBackup(id, at = new Date().toISOString()) { writeBackups({ ...readBackups(), [id]: at }); }
function forgetBackup(id) { const map = readBackups(); delete map[id]; writeBackups(map); }

/** Chip text and whether it should warn: never backed up, or not for a week. */
export function backupStatus(id, now = Date.now()) {
  const at = lastBackup(id);
  if (!at) return { text: "never backed up to a file", stale: true };
  const days = Math.floor((now - Date.parse(at)) / 86400000);
  return { text: days < 1 ? "backed up today" : `last backed up ${days} day${days === 1 ? "" : "s"} ago`, stale: days >= 7 };
}

/** Ask the browser not to evict this site's storage. @returns true, false, or null when it cannot say. */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return null;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch { return null; }
}

/** `{ used, quota }` in bytes, or null. */
export async function storageEstimate() {
  try { const e = await navigator.storage.estimate(); return { used: e.usage ?? 0, quota: e.quota ?? 0 }; } catch { return null; }
}
