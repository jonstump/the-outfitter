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

// Records written before SPEC-0003 have no `listId` key at all, so `rec.listId` is
// undefined rather than null. Serialise it explicitly so the API shape is uniform: every
// loadout carries a `listId`, and "Unassigned" is always `null` rather than sometimes an
// absent field. Without this, every consumer has to coalesce, and the no-op comparison in
// PATCH below would miss the legacy shape.
const publicLoadout = (rec) => ({ ...publicRecord(rec), listId: rec.listId ?? null });

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
    const { name, data, listId } = req.body || {};
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name must be a non-empty string" });
    }
    if (name.trim().length > 200) {
      return res.status(400).json({ error: "name must be at most 200 characters" });
    }
    if (!isValidData(data)) {
      return res.status(400).json({ error: "data must be a valid loadout payload" });
    }

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
      record = existing;
    } else {
      record = { id: randomUUID(), owner: token, name: trimmedName, data, listId: ref.value, updatedAt: now };
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
 * Move a loadout between lists.
 *
 * Governing: SPEC-0003 REQ "Loadouts Are Filed into Lists by Nullable Reference".
 *
 * The only mutable field is `listId` — a move changes where a loadout is filed and
 * nothing else about it. Both sides are ownership-checked: the loadout must belong to
 * the caller, and so must the destination list.
 *
 * `listId: null` moves the loadout to Unassigned, which is an ordinary destination and
 * not a special case.
 */
loadoutsRouter.patch("/:id", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    if (!("listId" in body)) {
      return res.status(400).json({ error: "listId is required" });
    }

    const token = callerToken(req);
    await db.read();

    const loadout = liveRecords(db.data.loadouts).find((l) => l.id === req.params.id && l.owner === token);
    if (!loadout) {
      // Same 404 whether it does not exist or belongs to someone else — see
      // resolveOwnedList in loadoutLists.js for why this must not be an oracle.
      return res.status(404).json({ error: "loadout not found" });
    }

    const ref = validateListRef(body.listId, token, res);
    if (!ref.ok) return;

    // Coalesce before comparing: a record predating SPEC-0003 has `listId` undefined, not
    // null, so a plain === would miss "already Unassigned" and take the write path.
    if ((loadout.listId ?? null) === ref.value) {
      // Selecting the list it is already in is a no-op, not an error and not a write.
      return res.json(publicLoadout(loadout));
    }

    loadout.listId = ref.value;
    loadout.updatedAt = new Date().toISOString();
    await db.write();

    console.info("loadout moved", { loadoutId: loadout.id, listId: ref.value });
    res.json(publicLoadout(loadout));
  } catch (err) {
    console.error("PATCH /api/loadouts/:id failed:", err);
    res.status(500).json({ error: "failed to move loadout" });
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
