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
import { charCount, validateDescription } from "../lib/descriptions.js";
import {
  callerToken,
  ipLimiter,
  liveRecords,
  ownedBy,
  publicRecord,
  readLimiter,
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

// KNOWN CONSEQUENCE of issue #135, recorded here because this is where someone will next read
// about assignment: NO CLIENT PATH REACHES THIS ANY MORE. The create form seeds its accent
// picker from `previewNextAccent` (client/src/utils/listAccent.js), which computes the same
// least-used-first answer, and always sends the result on the POST — so the request always
// carries an accent and the branch below is only entered by an API client that omits the key.
//
// It stays, and it stays tested (`loadoutLists.test.js`, "assigns accents least-used-first and
// permits duplicates"), for two reasons. The endpoint is public and `accent` is documented as
// optional, so a caller that omits it must still get a usable record rather than a null. And
// the client's preview is a preview: it reads the lists the browser happens to hold, while
// this reads the owner's persisted lists, which is the authoritative set. Deleting this would
// make the server's answer depend on the client having computed one.
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

// Governing: ADR-0007 (dataset carries descriptions), SPEC-0003 REQ "Lists Carry an Editable
// Description"
//
// A list's `description` has THREE states, and the whole point of the code below is that they
// never become two:
//
//   absent or null    never edited        -> the list hunter's description, resolved LIVE by
//                                            the client and never written here
//   ""                deliberately blank  -> nothing
//   non-empty string  the user's own text -> that text
//
// design.md's risk register names the failure directly: the obvious implementation is a truthy
// check, which merges "never edited" with "deliberately blank" and makes the field impossible
// to empty. So every read of the field on this route coalesces with `??` and never with `||`,
// and every write turns on the KEY being present rather than on the value being useful.
//
// NOTE THE TWO MEANINGS OF NULL ON THIS ENDPOINT. `hunterId: null` says the list depicts no
// hunter; `description: null` says the list inherits from whichever hunter it depicts. Same
// literal, opposite directions — one is an absence, the other is a deferral. They are only
// ever handled a few lines apart, so this is worth reading twice before editing either.
//
// Serialised explicitly so the API shape is uniform: every list carries a `description`, and
// "never edited" is always `null` rather than sometimes an absent field. Without this, every
// consumer has to coalesce for itself, which is one more place to do it with `||`.
const publicList = (rec) => ({ ...publicRecord(rec), description: rec.description ?? null });

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

// `readLimiter` bounds the full-file parse every read performs (issue #198); the budget is
// far looser than the write floor, and is per-IP only. See lib/ownership.js.
loadoutListsRouter.get("/", readLimiter, async (req, res) => {
  try {
    await db.read();
    const token = callerToken(req);
    res.json(ownedBy(db.data.loadoutLists, token).map(publicList));
  } catch (err) {
    console.error("GET /api/loadout-lists failed:", err);
    res.status(500).json({ error: "failed to read loadout lists" });
  }
});

loadoutListsRouter.post("/", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const { name, hunterId = null, accent } = body;
    if (!isName(name)) {
      return res.status(400).json({ error: `name must be a non-empty string of at most ${NAME_MAX} characters` });
    }
    if (!isHunterId(hunterId)) {
      return res.status(400).json({ error: `hunterId must be null or a string of at most ${HUNTER_ID_MAX} characters` });
    }
    if (!isAccent(accent)) {
      return res.status(400).json({ error: "accent must be one of the palette values" });
    }
    // PRESENCE, not truthiness: `"description" in body` distinguishes "said nothing" from
    // "said null", and only the first may reach the default. A list created with a hunter is
    // the overwhelmingly common case and it wants inheritance, so the create form sends no
    // key at all — but the endpoint accepts one, so a list can be created already described.
    const describes = "description" in body;
    const desc = describes ? validateDescription(body.description, res) : { ok: true, value: null };
    if (!desc.ok) return;

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
    // The key is written only when the caller supplied one. A list nobody has described
    // carries NO `description` field at all — that is the "never edited" state, and it is the
    // same shape every list record written before this field existed already has.
    if (describes) record.description = desc.value;
    db.data.loadoutLists.push(record);
    await db.write();

    res.status(201).json(publicList(record));
  } catch (err) {
    console.error("POST /api/loadout-lists failed:", err);
    res.status(500).json({ error: "failed to create loadout list" });
  }
});

loadoutListsRouter.patch("/:id", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const { name, hunterId, accent } = body;
    if (name !== undefined && !isName(name)) {
      return res.status(400).json({ error: `name must be a non-empty string of at most ${NAME_MAX} characters` });
    }
    if (hunterId !== undefined && !isHunterId(hunterId)) {
      return res.status(400).json({ error: `hunterId must be null or a string of at most ${HUNTER_ID_MAX} characters` });
    }
    if (accent !== undefined && !isAccent(accent)) {
      return res.status(400).json({ error: "accent must be one of the palette values" });
    }
    // The description is the one field on this endpoint whose ABSENT and NULL differ, so it is
    // the one field read off the body by key rather than by destructuring: `description:
    // undefined` from a destructure would be indistinguishable from a key that was never sent,
    // which is precisely the collapse the field exists to avoid. Validated before anything is
    // applied, so a rejected description cannot leave a half-applied rename behind it.
    const describes = "description" in body;
    const desc = describes ? validateDescription(body.description, res) : { ok: true };
    if (!desc.ok) return;

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
    // Assigning null rather than deleting the key: both read back as "inherit" through
    // `?? null`, and a record that says null out loud is easier to recognise in the data file
    // than one that says nothing. Changing the hunter and restoring inheritance in the same
    // request is coherent and is applied in that order — the new hunter is what gets inherited.
    if (describes) record.description = desc.value;
    await db.write();

    if (describes) {
      // The TEXT is never logged. It is user prose, and the state it landed in is what a log
      // needs to say — including which of the two nulls on this endpoint was meant.
      console.info("loadout list described", {
        listId: record.id,
        description: desc.value === null ? "inherited" : `${charCount(desc.value)} chars`,
      });
    }

    res.json(publicList(record));
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
