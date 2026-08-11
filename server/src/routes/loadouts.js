import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import {
  callerToken,
  ipLimiter,
  liveRecords,
  publicRecord,
  RecordNotFoundError,
  RecordNotOwnedError,
  tokenLimiter,
} from "../lib/ownership.js";
import { resolveOwnedList } from "./loadoutLists.js";

// Ownership primitives (callerToken, liveRecords, the stacked rate limiters) moved to
// ../lib/ownership.js when SPEC-0003 added a second owned collection. Both routers MUST
// agree exactly on what a caller token is and which records are reachable — a divergence
// is a cross-user leak, which is what issue #17 closed. One definition, two importers.

export const loadoutsRouter = Router();

// Wire shape the client's toData()/fromData() (client/src/utils/loadoutCodec.js)
// produces: { w, e, tr, n, b } — item references as numeric catalog indices on
// today's format, and stable string ids once the stable-id codec (#26/#43) lands.
// Reject anything that doesn't match so malformed or arbitrarily large payloads
// never reach the data file (issue #19). Both index and id references are
// accepted so a save recorded by either codec loads; the numeric bounds are
// validation slack, not exact resolution — they reject clearly out-of-range
// indices while the client's own codec drops anything that doesn't resolve.
const WIRE_CATEGORIES = { w: 40, eT: 24, eC: 24, tr: 40 };
const isNonnegInt = (n) => Number.isInteger(n) && n >= 0;
const isId = (s) => typeof s === "string" && s.length > 0 && s.length <= 100;
const isRef = (v, bound) => (isNonnegInt(v) && v < bound) || isId(v);

function isValidData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (data.v !== undefined && typeof data.v !== "number") return false;
  if (!Array.isArray(data.w) || data.w.length !== 2) return false;
  if (!data.w.every((slot) => slot === null || (Array.isArray(slot) && slot.length >= 2 && isRef(slot[0], WIRE_CATEGORIES.w) && Number.isInteger(slot[1])))) return false;
  if (!Array.isArray(data.e) || data.e.length > 8) return false;
  if (!data.e.every((entry) => Array.isArray(entry) && entry.length >= 2 && (entry[0] === "T" || entry[0] === "C") && isRef(entry[1], entry[0] === "T" ? WIRE_CATEGORIES.eT : WIRE_CATEGORIES.eC))) return false;
  if (!Array.isArray(data.tr) || data.tr.length > 40) return false;
  if (!data.tr.every((id) => isRef(id, WIRE_CATEGORIES.tr))) return false;
  if (typeof data.n !== "string" || data.n.length > 200) return false;
  if (data.b !== undefined && (typeof data.b !== "number" || data.b < 0 || data.b > 8)) return false;
  return true;
}

// Governing: ADR-0006, SPEC-0003 REQ "Loadouts Are Filed into Lists by Nullable
// Reference", SPEC-0003 REQ "Cross-Collection Ownership Enforcement"
//
// `listId` lives on the record ENVELOPE, as a sibling of name/updatedAt — never inside
// `data`. That is what keeps FORMAT_VERSION at 1: toData()/fromData() never see it, share
// URLs are unchanged, and isValidData() above needs no edit. Null or absent means the
// loadout is Unassigned, which is also what every record written before SPEC-0003 means,
// so there is nothing to migrate.
const isListRef = (v) => v === null || v === undefined || (typeof v === "string" && v.length > 0 && v.length <= 100);

// Governing: ADR-0006 (list filing model), ADR-0007 (dataset carries descriptions),
// SPEC-0003 REQ "Loadouts Carry an Editable Description"
//
// The caps, as names rather than as literals. SPEC-0003's Security Requirements ask for the
// description cap to be "declared as a named constant beside the existing name cap", and at
// least 1000 characters: the dataset's longest description is 404 ("The Night Seer"), and
// that text is what a user most often starts from when they edit, so a cap that could not
// hold it would reject the default the application itself offered.
//
// NAME_MAX_CHARS governs the ENVELOPE's name. The identical-looking 200 inside isValidData
// caps `data.n`, which is wire-format validation frozen by REQ "The Saved-Loadout Wire
// Format Is Unchanged" — a different rule that happens to have landed on the same number,
// so it is deliberately left as its own literal rather than made to share this constant.
const NAME_MAX_CHARS = 200;
export const DESCRIPTION_MAX_CHARS = 1000;

// Records written before SPEC-0003 have no `listId` key at all, so `rec.listId` is
// undefined rather than null. Serialise it explicitly so the API shape is uniform: every
// loadout carries a `listId`, and "Unassigned" is always `null` rather than sometimes an
// absent field. Without this, every consumer has to coalesce, and the no-op comparison in
// PATCH below would miss the legacy shape.
//
// `description` is coalesced the same way and for the same reason, but note what the
// coalescing does NOT do: it maps absent -> null only. An empty string survives as an empty
// string, because absent/null ("never edited — inherit from the list's hunter") and ""
// ("deliberately blank") are two different states and the client has to be able to tell
// them apart. `rec.description ?? null` is deliberate — `||` here would collapse the two.
const publicLoadout = (rec) => ({
  ...publicRecord(rec),
  listId: rec.listId ?? null,
  description: rec.description ?? null,
});

/**
 * Validate a caller-supplied description.
 *
 * Governing: SPEC-0003 REQ "Loadouts Carry an Editable Description", SPEC-0003 Security
 * Requirements ("Request Body Size Limits").
 *
 * Called ONLY when the key is present in the body — "omitted" is a third answer that means
 * "leave the field alone", and it is the caller's job to check for the key before asking.
 * Folding that check in here would make an omitted key indistinguishable from `null`, which
 * is the exact collapse this requirement exists to prevent.
 *
 * The text is stored VERBATIM: no trim. Trimming would silently turn a whitespace-only
 * description into the deliberately-blank state, which is a state change the user did not
 * ask for. The cap therefore governs exactly what is stored.
 */
function validateDescription(description, res) {
  if (description === null) return { ok: true, value: null };
  if (typeof description !== "string") {
    res.status(400).json({ error: "description must be a string or null" });
    return { ok: false };
  }
  if (description.length > DESCRIPTION_MAX_CHARS) {
    res.status(400).json({ error: `description must be at most ${DESCRIPTION_MAX_CHARS} characters` });
    return { ok: false };
  }
  return { ok: true, value: description };
}

/**
 * Validate a caller-supplied listId against the lists the CALLER owns.
 *
 * This is the cross-collection ownership check. Without it a caller could file a loadout
 * into a stranger's list by guessing a UUID — every prior ownership check in this codebase
 * compares a record's own `owner` to the caller, so this is the first that reaches across
 * collections. resolveOwnedList is imported from #85 rather than reimplemented.
 *
 * Rejection is loud (4xx), never a silent downgrade to Unassigned: a silent downgrade
 * would mask an attack and hide a legitimate client bug.
 *
 * Returns the normalized value to store (null when unassigned).
 */
function validateListRef(listId, token, res) {
  if (listId === null || listId === undefined) return { ok: true, value: null };
  if (!isListRef(listId)) {
    res.status(400).json({ error: "listId must be null or a string of at most 100 characters" });
    return { ok: false };
  }
  try {
    resolveOwnedList(db.data.loadoutLists, listId, token);
    return { ok: true, value: listId };
  } catch (err) {
    if (err instanceof RecordNotFoundError || err instanceof RecordNotOwnedError) {
      console.warn("loadout filing denied", { listId, reason: err.name });
      res.status(404).json({ error: "loadout list not found" });
      return { ok: false };
    }
    throw err;
  }
}

// Express 4 does not forward rejected promises from async handlers to the error
// middleware, so every handler wraps its body in try/catch (issue #18) — a
// corrupt data file, disk-full, or permission error returns a clean 500 instead
// of crashing the process.
loadoutsRouter.get("/", async (_req, res) => {
  try {
    await db.read();
    const token = callerToken(_req);
    const mine = liveRecords(db.data.loadouts)
      .filter((l) => l.owner === token)
      .map(publicLoadout);
    res.json(mine);
  } catch (err) {
    console.error("GET /api/loadouts failed:", err);
    res.status(500).json({ error: "failed to read loadouts" });
  }
});

loadoutsRouter.post("/", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const { name, data, listId } = body;
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name must be a non-empty string" });
    }
    if (name.trim().length > NAME_MAX_CHARS) {
      return res.status(400).json({ error: `name must be at most ${NAME_MAX_CHARS} characters` });
    }
    if (!isValidData(data)) {
      return res.status(400).json({ error: "data must be a valid loadout payload" });
    }

    // Governing: SPEC-0003 REQ "Loadouts Carry an Editable Description" — POST accepts an
    // optional description so that saving a build with one written up front is a single
    // write rather than a save followed by a patch. The key's PRESENCE is the question, not
    // its truthiness: `"description" in body` distinguishes "said nothing" from "said null".
    const describes = "description" in body;
    const desc = describes ? validateDescription(body.description, res) : { ok: true, value: null };
    if (!desc.ok) return;

    const token = callerToken(req);
    await db.read();

    const ref = validateListRef(listId, token, res);
    if (!ref.ok) return;

    const trimmedName = name.trim();
    const now = new Date().toISOString();
    const existing = liveRecords(db.data.loadouts).find((l) => l.owner === token && l.name === trimmedName);

    let record;
    if (existing) {
      existing.data = data;
      existing.updatedAt = now;
      // Only re-file when the caller said something about it. An upsert that omits listId
      // is updating the loadout, not moving it out of its list.
      if (listId !== undefined) existing.listId = ref.value;
      // Same rule for the description, for the same reason: re-saving a build under a name
      // that already exists must not silently discard the note the user wrote about it.
      if (describes) existing.description = desc.value;
      record = existing;
    } else {
      record = { id: randomUUID(), owner: token, name: trimmedName, data, listId: ref.value, updatedAt: now };
      // The key is written only when the caller supplied one. A record that has never been
      // described carries NO `description` field at all — that is the state SPEC-0003 calls
      // "never edited", and the API surfaces it as null through publicLoadout without the
      // store having to hold a placeholder for it.
      if (describes) record.description = desc.value;
      db.data.loadouts.push(record);
    }

    await db.write();
    res.status(existing ? 200 : 201).json(publicLoadout(record));
  } catch (err) {
    console.error("POST /api/loadouts failed:", err);
    res.status(500).json({ error: "failed to save loadout" });
  }
});

/**
 * Move a loadout between lists, and/or edit its description.
 *
 * Governing: ADR-0006 (list filing model), ADR-0007 (dataset carries descriptions),
 * SPEC-0003 REQ "Loadouts Are Filed into Lists by Nullable Reference", SPEC-0003 REQ
 * "Loadouts Carry an Editable Description".
 *
 * Two mutable fields, and they are INDEPENDENT: this endpoint used to require `listId`,
 * which would have made "describe" impossible without also restating where the loadout is
 * filed. Nothing else about the record is reachable from here — not `data`, not the format
 * version, not the name.
 *
 * The whole endpoint turns on presence rather than value. For BOTH fields:
 *
 *   omitted  -> leave it exactly as it is
 *   null     -> `listId: null` files into Unassigned; `description: null` restores the
 *               inherited default (the list hunter's text, resolved at render time — never
 *               copied into the record, which is why "restore" is a write of null and not
 *               a write of the hunter's prose)
 *   a string -> store it, including `description: ""`, which is the deliberately-blank
 *               state and must NOT re-inherit
 *
 * A body carrying neither key is rejected rather than treated as a no-op: it is a client
 * that believes it is writing something, and answering 200 would hide that.
 */
loadoutsRouter.patch("/:id", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const files = "listId" in body;
    const describes = "description" in body;
    if (!files && !describes) {
      return res.status(400).json({ error: "listId or description is required" });
    }

    const token = callerToken(req);
    await db.read();

    const loadout = liveRecords(db.data.loadouts).find((l) => l.id === req.params.id && l.owner === token);
    if (!loadout) {
      // Same 404 whether it does not exist or belongs to someone else — see
      // resolveOwnedList in loadoutLists.js for why this must not be an oracle.
      return res.status(404).json({ error: "loadout not found" });
    }

    // Both fields are validated BEFORE either is applied, so a rejected description cannot
    // leave a half-applied move behind it.
    const ref = files ? validateListRef(body.listId, token, res) : { ok: true, value: loadout.listId ?? null };
    if (!ref.ok) return;
    const desc = describes
      ? validateDescription(body.description, res)
      : { ok: true, value: loadout.description ?? null };
    if (!desc.ok) return;

    // Coalesce before comparing: a record predating SPEC-0003 has `listId` undefined, not
    // null, so a plain === would miss "already Unassigned" and take the write path. The
    // description comparison coalesces the same way and, again, only absent -> null: `""`
    // compares as `""`, so clearing a description that was inherited IS a change and IS
    // written, which is what stops the hunter's text reappearing.
    const sameList = (loadout.listId ?? null) === ref.value;
    const sameDescription = (loadout.description ?? null) === desc.value;
    if (sameList && sameDescription) {
      // Writing what is already there is a no-op, not an error and not a write.
      return res.json(publicLoadout(loadout));
    }

    if (files) loadout.listId = ref.value;
    if (describes) loadout.description = desc.value;
    loadout.updatedAt = new Date().toISOString();
    await db.write();

    console.info("loadout updated", {
      loadoutId: loadout.id,
      listId: sameList ? undefined : ref.value,
      // The TEXT is never logged — it is user prose, and one of the two sources it can come
      // from is scraped off-origin. Which state it landed in is what a log needs to say.
      description: sameDescription ? undefined : desc.value === null ? "inherited" : `${desc.value.length} chars`,
    });
    res.json(publicLoadout(loadout));
  } catch (err) {
    console.error("PATCH /api/loadouts/:id failed:", err);
    res.status(500).json({ error: "failed to update loadout" });
  }
});

loadoutsRouter.delete("/:id", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const token = callerToken(req);
    await db.read();
    const before = db.data.loadouts.length;
    // Filter applies only to live (non-legacy) records; legacy records stay
    // untouched on disk and can never be deleted through the API.
    db.data.loadouts = [
      ...db.data.loadouts.filter((l) => l.legacy),
      ...liveRecords(db.data.loadouts).filter((l) => l.id !== req.params.id || l.owner !== token),
    ];
    if (db.data.loadouts.length === before) {
      return res.status(404).json({ error: "loadout not found" });
    }
    await db.write();
    res.status(204).end();
  } catch (err) {
    console.error("DELETE /api/loadouts/:id failed:", err);
    res.status(500).json({ error: "failed to delete loadout" });
  }
});
