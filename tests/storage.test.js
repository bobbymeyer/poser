import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { newProject } from "../src/editor/template.js";
import {
  db, saveProject, loadLastProject, listProjects, getProject, deleteProject, duplicateProject,
  takeSnapshot, listSnapshots, getSnapshot, SNAPSHOT_LIMIT, backupStatus, markBackup, lastBackup,
} from "../src/storage/db.js";

// A small stand-in for localStorage in the node test environment.
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const song = (title, at) => ({ ...newProject(), title, updated_at: at });

beforeEach(async () => { await Promise.all([db.projects.clear(), db.snapshots.clear()]); store.clear(); });

describe("song list", () => {
  it("lists songs newest first and reopens the last one", async () => {
    const a = song("A", "2026-01-01T00:00:00Z"), b = song("B", "2026-02-01T00:00:00Z");
    await saveProject(b); await saveProject(a);
    expect((await listProjects()).map((p) => p.title)).toEqual(["B", "A"]);
    expect((await loadLastProject()).title).toBe("A"); // the one saved last, not the newest date
    store.clear();
    expect((await loadLastProject()).title).toBe("B");
  });
  it("duplicates under a new ID and deletes with its snapshots", async () => {
    const a = song("A", "2026-01-01T00:00:00Z");
    await saveProject(a);
    await takeSnapshot(a, "test");
    const copy = await duplicateProject(a.id);
    expect(copy.id).not.toBe(a.id);
    expect(copy.title).toBe("A copy");
    expect((await listProjects()).length).toBe(2);
    await deleteProject(a.id);
    expect(await getProject(a.id)).toBeUndefined();
    expect(await listSnapshots(a.id)).toEqual([]);
    expect((await listProjects()).map((p) => p.id)).toEqual([copy.id]);
  });
});

describe("snapshots", () => {
  it("keeps copies newest first, skips an unchanged song, and restores one", async () => {
    const a = song("A", "2026-01-01T00:00:00Z");
    await takeSnapshot(a, "first");
    await takeSnapshot(a, "same again");
    await takeSnapshot({ ...a, title: "A2" }, "renamed");
    const list = await listSnapshots(a.id);
    expect(list.map((s) => [s.n, s.reason, s.title])).toEqual([[2, "renamed", "A2"], [1, "first", "A"]]);
    expect((await getSnapshot(a.id, 1)).title).toBe("A");
    expect(await getSnapshot(a.id, 9)).toBe(null);
  });
  it("keeps only the most recent ones, per song", async () => {
    const a = song("A", "x"), b = song("B", "x");
    for (let i = 0; i < SNAPSHOT_LIMIT + 5; i++) await takeSnapshot({ ...a, title: `A${i}` }, "auto");
    await takeSnapshot(b, "auto");
    const list = await listSnapshots(a.id);
    expect(list.length).toBe(SNAPSHOT_LIMIT);
    expect(list[0].title).toBe(`A${SNAPSHOT_LIMIT + 4}`);
    expect(list.at(-1).title).toBe("A5");
    expect((await listSnapshots(b.id)).length).toBe(1);
  });
});

describe("backup chip", () => {
  it("warns when a song was never saved to a file or not for a week", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(backupStatus("p1", now)).toEqual({ text: "never backed up to a file", stale: true });
    markBackup("p1", "2026-11-10T09:00:00Z");
    expect(backupStatus("p1", now)).toEqual({ text: "backed up today", stale: false });
    markBackup("p1", "2026-11-08T09:00:00Z");
    expect(backupStatus("p1", now)).toEqual({ text: "last backed up 2 days ago", stale: false });
    markBackup("p1", "2026-11-02T09:00:00Z");
    expect(backupStatus("p1", now)).toEqual({ text: "last backed up 8 days ago", stale: true });
    expect(lastBackup("p2")).toBe(null);
  });
});
