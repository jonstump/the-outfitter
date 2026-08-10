// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
// Hunter Portraits), SPEC-0003 REQ "List Identity Is User-Owned and Independent of
// Portrait", SPEC-0003 REQ "Cross-Collection Ownership Enforcement", SPEC-0003 REQ
// "An Empty List Is a Valid Persisted State", SPEC-0003 REQ "Error Handling Standards",
// SPEC-0003 REQ "Database Operation Standards"
//
// A list is a playlist: a name you choose and cover art you pick. Its identity is a
// server-generated UUID — never a hunter id — so a list can be renamed, can reference no
// hunter at all, and can share a hunter with any number of sibling lists. See ADR-0006
// for why identity and imagery are deliberately decoupled.

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import {
  callerToken,
  ipLimiter,
  liveRecords,
  ownedBy,
  publicRecord,
  RecordNotFoundError,
  RecordNotOwnedError,
  tokenLimiter,
} from "../lib/ownership.js";

export const loadoutListsRouter = Router();

const NAME_MAX = 200;
const HUNTER_ID_MAX = 100;

// Accent palette (SPEC-0003 REQ "Lists Are Visually Distinguishable Independent of
// Portrait and Name"). Fixed six values, every one verified at 3:1 or better against
// --panel, --scroll-track and --bg. Assignment is least-used-first among the owner's
// existing lists, and duplicates are explicitly permitted — a user may hold more lists
// than there are palette entries. The client mirrors these as --list-accent-{1..6}
// (issue #88); the server owns assignment because the record owns the value.
export const ACCENT_PALETTE = ["#b04a3e", "#7a8a4e", "#5a6e96", "#5e8a8a", "#8a5e86", "#a3703e"];

/** Least-used palette value among `lists`, ties broken by palette order. */
export function nextAccent(lists) {
  const counts = new Map(ACCENT_PALETTE.map((c) => [c, 0]));
  for (const l of lists) {
    if (counts.has(l.accent)) counts.set(l.accent, counts.get(l.accent) + 1);
  }
  let best = ACCENT_PALETTE[0];
  let bestN = Infinity;
  for (const c of ACCENT_PALETTE) {
    const n = counts.get(c);
    if (n < bestN) {
      bestN = n;
      best = c;
    }
  }
  return best;
}

const isName = (v) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= NAME_MAX;
const isHunterId = (v) =>
  v === null || v === undefined || (typeof v === "string" && v.length > 0 && v.length <= HUNTER_ID_MAX);
const isAccent = (v) => v === undefined || ACCENT_PALETTE.includes(v);

/**
 * Resolve a list id to a record the caller owns.
 *
 * Governing: SPEC-0003 REQ "Cross-Collection Ownership Enforcement".
 *
 * Throws RecordNotFoundError when nothing has that id, and RecordNotOwnedError when it
 * belongs to someone else. The distinction is deliberate and internal: it lets logs tell
 * a stale client apart from a probe, and it is what the spec means by distinguishing the
 * two failure modes programmatically.
 *
 * Both map to 404 at the HTTP boundary. Returning 403 for "not yours" would confirm the
 * id exists, turning the endpoint into an oracle for enumerating other users' list ids —
 * which would undo the point of the check.
 *
 * Exported because issue #86 needs exactly this when validating a loadout's `listId`:
 * a loadout write MUST NOT be able to file into a stranger's list by guessing a UUID.
 */
export function resolveOwnedList(lists, id, token) {
  const record = liveRecords(lists).find((l) => l.id === id);
  if (!record) {
    throw new RecordNotFoundError(`no loadout list with id ${id}`, {
      recordId: id,
      collection: "loadoutLists",
    });
  }
  if (record.owner !== token) {
    throw new RecordNotOwnedError(`loadout list ${id} is owned by another token`, {
      recordId: id,
      collection: "loadoutLists",
    });
  }
  return record;
}

/**
 * Map a thrown ownership error onto a response.
 *
 * Structured logging (SPEC-0003 "Error Handling Standards") uses key-value fields rather
 * than string interpolation, so an ownership rejection is greppable and countable.
 */
function respondToOwnershipError(res, err, op) {
  if (err instanceof RecordNotFoundError || err instanceof RecordNotOwnedError) {
    console.warn("loadout list access denied", {
      op,
      collection: err.collection,
      recordId: err.recordId,
      reason: err.name,
    });
    return res.status(404).json({ error: "loadout list not found" });
  }
  return null;
}

// Express 4 does not forward rejected promises from async handlers to the error
// middleware, so every handler wraps its body in try/catch (issue #18) — a corrupt data
// file, disk-full, or permission error returns a clean 500 instead of crashing.

loadoutListsRouter.get("/", async (req, res) => {
  try {
    await db.read();
    const token = callerToken(req);
    res.json(ownedBy(db.data.loadoutLists, token).map(publicRecord));
  } catch (err) {
    console.error("GET /api/loadout-lists failed:", err);
    res.status(500).json({ error: "failed to read loadout lists" });
  }
});

loadoutListsRouter.post("/", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const { name, hunterId = null, accent } = req.body || {};
    if (!isName(name)) {
      return res.status(400).json({ error: `name must be a non-empty string of at most ${NAME_MAX} characters` });
    }
    if (!isHunterId(hunterId)) {
      return res.status(400).json({ error: `hunterId must be null or a string of at most ${HUNTER_ID_MAX} characters` });
    }
    if (!isAccent(accent)) {
      return res.status(400).json({ error: "accent must be one of the palette values" });
    }

    const token = callerToken(req);
    await db.read();

    // No uniqueness constraint on (owner, hunterId) — many lists MAY share a hunter, and
    // adding one later would break the feature rather than tighten it (ADR-0006).
    const record = {
      id: randomUUID(),
      owner: token,
      name: name.trim(),
      hunterId: hunterId ?? null,
      accent: accent ?? nextAccent(ownedBy(db.data.loadoutLists, token)),
      createdAt: new Date().toISOString(),
    };
    db.data.loadoutLists.push(record);
    await db.write();

    res.status(201).json(publicRecord(record));
  } catch (err) {
    console.error("POST /api/loadout-lists failed:", err);
    res.status(500).json({ error: "failed to create loadout list" });
  }
});

loadoutListsRouter.patch("/:id", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const { name, hunterId, accent } = req.body || {};
    if (name !== undefined && !isName(name)) {
      return res.status(400).json({ error: `name must be a non-empty string of at most ${NAME_MAX} characters` });
    }
    if (hunterId !== undefined && !isHunterId(hunterId)) {
      return res.status(400).json({ error: `hunterId must be null or a string of at most ${HUNTER_ID_MAX} characters` });
    }
    if (accent !== undefined && !isAccent(accent)) {
      return res.status(400).json({ error: "accent must be one of the palette values" });
    }

    const token = callerToken(req);
    await db.read();

    let record;
    try {
      record = resolveOwnedList(db.data.loadoutLists, req.params.id, token);
    } catch (err) {
      const handled = respondToOwnershipError(res, err, "PATCH /api/loadout-lists/:id");
      if (handled) return handled;
      throw err;
    }

    // Renaming never touches the UUID, so filed loadouts stay filed (SPEC-0003).
    if (name !== undefined) record.name = name.trim();
    if (hunterId !== undefined) record.hunterId = hunterId ?? null;
    if (accent !== undefined) record.accent = accent;
    await db.write();

    res.json(publicRecord(record));
  } catch (err) {
    console.error("PATCH /api/loadout-lists/:id failed:", err);
    res.status(500).json({ error: "failed to update loadout list" });
  }
});

/**
 * Retire a list.
 *
 * Governing: SPEC-0003 REQ "Database Operation Standards".
 *
 * Deleting the list row and clearing `listId` on every loadout that referenced it are
 * staged in memory and committed by a SINGLE write, so no persisted state ever shows a
 * loadout pointing at a list that no longer exists.
 *
 * The unassign half is a no-op until issue #86 puts `listId` on loadout records. It is
 * written now anyway: the alternative is an interval where retiring orphans references,
 * and "add the atomicity later" is exactly how that interval becomes permanent.
 *
 * Loadouts are never deleted here. There is no cascade anywhere in this feature.
 */
loadoutListsRouter.delete("/:id", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const token = callerToken(req);
    await db.read();

    try {
      resolveOwnedList(db.data.loadoutLists, req.params.id, token);
    } catch (err) {
      const handled = respondToOwnershipError(res, err, "DELETE /api/loadout-lists/:id");
      if (handled) return handled;
      throw err;
    }

    const before = db.data.loadouts.length;
    db.data.loadoutLists = db.data.loadoutLists.filter((l) => l.id !== req.params.id);
    let unassigned = 0;
    for (const loadout of db.data.loadouts) {
      if (loadout.listId === req.params.id && loadout.owner === token) {
        loadout.listId = null;
        unassigned++;
      }
    }
    await db.write();

    // Retirement must never change how many loadouts exist. Cheap to assert, and the
    // failure it catches is the one this feature cannot afford.
    if (db.data.loadouts.length !== before) {
      console.error("retire changed loadout count", { before, after: db.data.loadouts.length });
    }
    console.info("loadout list retired", { listId: req.params.id, loadoutsUnassigned: unassigned });

    res.status(204).end();
  } catch (err) {
    console.error("DELETE /api/loadout-lists/:id failed:", err);
    res.status(500).json({ error: "failed to retire loadout list" });
  }
});
