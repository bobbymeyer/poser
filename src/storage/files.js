// `.song.json` files: File System Access API where it exists, plain download/upload elsewhere.

const TYPES = [{ description: "Song", accept: { "application/json": [".json"] } }];
const fileName = (song) => `${(song.title || "song").replace(/[\\/:*?"<>|]+/g, " ").trim() || "song"}.song.json`;

/**
 * Save the song. Pass the handle from an earlier save or open to write to the same file.
 * @returns the file handle (null on browsers without the API), or undefined if the user cancelled.
 */
export async function saveSongFile(song, handle = null) {
  const text = JSON.stringify(song, null, 2);
  if (window.showSaveFilePicker) {
    try {
      handle ??= await window.showSaveFilePicker({ suggestedName: fileName(song), types: TYPES });
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      return handle;
    } catch (err) {
      if (err.name === "AbortError") return undefined;
      throw err;
    }
  }
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: fileName(song),
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return null;
}

/** @returns `{ text, name, handle }`, or null if the user cancelled. */
export async function openSongFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: TYPES });
      const file = await handle.getFile();
      return { text: await file.text(), name: file.name, handle };
    } catch (err) {
      if (err.name === "AbortError") return null;
      throw err;
    }
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".json,application/json" });
    input.onchange = async () => {
      const file = input.files[0];
      resolve(file ? { text: await file.text(), name: file.name, handle: null } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
