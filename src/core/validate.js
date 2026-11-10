// Validation on import: JSON Schema first, then the cross-references a schema cannot express.

import Ajv from "ajv";
import { songSchema } from "./schema.js";
import { FORMAT_VERSION, RAILS_VERSION } from "./rails.js";

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const check = ajv.compile(songSchema);

/**
 * @returns `{ ok, readOnly, errors }` where each error is `{ path, message }` and `path`
 * points at the field that failed, e.g. `/sections/s_verse/mode`.
 */
export function validateSong(song) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  if (!song || typeof song !== "object" || song.format !== "song")
    return { ok: false, readOnly: false, errors: [{ path: "/format", message: "not a song file" }] };
  if (song.format_version > FORMAT_VERSION)
    return { ok: false, readOnly: false, errors: [{ path: "/format_version", message: `file format ${song.format_version} is newer than this app (${FORMAT_VERSION})` }] };
  const newerRails = song.rails_version > RAILS_VERSION;

  if (!check(song)) {
    for (const e of check.errors) {
      // The if/then/else wrappers only repeat what the inner errors already say.
      if (e.keyword === "if") continue;
      let message = e.message;
      if (e.keyword === "enum") message = `unknown value ${JSON.stringify(valueAt(song, e.instancePath))}; allowed: ${e.params.allowedValues.join(", ")}`;
      if (e.keyword === "additionalProperties") message = `unknown field "${e.params.additionalProperty}"`;
      add(e.instancePath || "/", message);
    }
    if (newerRails) errors.unshift({ path: "/rails_version", message: "uses options from a newer version" });
    return { ok: false, readOnly: newerRails, errors };
  }

  const lanes = new Map();
  song.lanes.forEach((l, i) => {
    if (lanes.has(l.id)) add(`/lanes/${i}/id`, `duplicate lane id "${l.id}"`);
    lanes.set(l.id, l);
    if (l.role === "kit" && !l.pads) add(`/lanes/${i}/pads`, "a kit lane needs pads");
    if (l.role !== "kit" && !l.register) add(`/lanes/${i}/register`, "a pitched lane needs a register");
    if (l.register && l.register[0] > l.register[1]) add(`/lanes/${i}/register`, "register must be [low, high]");
    if (l.instrument.backend === "soundfont" && !song.soundfonts.some((s) => s.hash === l.instrument.sf))
      add(`/lanes/${i}/instrument/sf`, `soundfont "${l.instrument.sf}" is not in the manifest`);
  });
  for (const [sid, s] of Object.entries(song.sections)) {
    for (const [laneId, clips] of Object.entries(s.clips)) {
      const lane = lanes.get(laneId);
      if (!lane) { add(`/sections/${sid}/clips/${laneId}`, `no lane "${laneId}"`); continue; }
      clips.forEach((c, i) => {
        const p = song.patterns[c.pattern];
        const at = `/sections/${sid}/clips/${laneId}/${i}/pattern`;
        if (!p) add(at, `no pattern "${c.pattern}"`);
        else if ((p.kind === "drum") !== (lane.role === "kit")) add(at, `a ${p.kind} pattern cannot play on a ${lane.role} lane`);
      });
    }
  }
  song.arrangement.forEach((inst, i) => {
    if (!song.sections[inst.section]) add(`/arrangement/${i}/section`, `no section "${inst.section}"`);
    for (const laneId of Object.keys(inst.leads))
      if (!lanes.has(laneId)) add(`/arrangement/${i}/leads/${laneId}`, `no lane "${laneId}"`);
  });
  return { ok: errors.length === 0, readOnly: newerRails, errors };
}

function valueAt(doc, pointer) {
  return pointer.split("/").slice(1).reduce((v, k) => v?.[k.replace(/~1/g, "/").replace(/~0/g, "~")], doc);
}
