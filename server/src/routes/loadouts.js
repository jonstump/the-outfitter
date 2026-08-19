import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
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
import { resolveOwnedList } from "./loadoutLists.js";
import { charCount, DESCRIPTION_MAX_CHARS, validateDescription } from "../lib/descriptions.js";

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
// Governing: ADR-0023 (the pair flag is the third element of a version-3 weapon entry),
// SPEC-0009 REQ "The Weapon Entry Is Validated at an Exact Element Count".
//
// Two-entry weapon slots: [ref, ammo]. `d`, the third element, is the version-3
// dual-wield pair flag — a boolean, when present, and nothing else. The count stays an
// EQUALITY and its own version decides which count is legal: two for v1/v2, three for
// v3, never "at least" (issue #198). A four-element entry is rejected, not truncated.
const isIsland = (v, bound) => Array.isArray(v) && v.length === 2 && isRef(v[0], bound) && Number.isInteger(v[1]);
const isIslandV3 = (v, bound) =>
  Array.isArray(v) && v.length === 3 && isRef(v[0], bound) && Number.isInteger(v[1]) && typeof v[2] === "boolean";
// Governing: SPEC-0009 (established the exact-count + isIslandV3 pattern this extends),
// SPEC-0010 REQ "The Weapon Entry Is Validated at Version 4's Shape", REQ "A Weapon Holds
// Up to Two Independently Chosen Rounds", issue #342, issue #345.
//
// Version 4 keeps v3's exact three-element count and its boolean pair flag unchanged; the
// ammo element's TYPE changes twice over this shape's history. Versions 1-3 carry ammo as
// a catalog index (`Number.isInteger`). #342 first shipped version 4 with a SINGLE stable
// id string, before anything wrote v4 — that shape never reached a real save. #345 widens
// it to what SPEC-0010 actually requires: up to TWO independently chosen rounds, one per
// weapon ammo slot (dual-family and split-reserve weapons both need two — see
// docs/openspec/specs/per-weapon-ammo/spec.md REQ "A Weapon Holds Up to Two Independently
// Chosen Rounds"). Widening a version's shape in place, rather than minting v5, is safe
// specifically because v4 was still inert: no deployed client had ever emitted the
// single-id shape, so there is no live record to stay compatible with.
//
// Each ammo slot is a bounded id string (`isId`, the same check `isRef` already uses for
// every other string reference) or `null` for an explicitly empty slot — SPEC-0010's own
// words: "An empty ammo slot SHALL be represented explicitly rather than by omission." The
// slot array's length is checked with the same exact-count discipline as the weapon entry
// itself (#198) — not "at least two", so a three-slot payload is rejected, not truncated.
const isAmmoSlotArray = (v) => Array.isArray(v) && v.length === 2 && v.every((slot) => slot === null || isId(slot));
const isIslandV4 = (v, bound) =>
  Array.isArray(v) && v.length === 3 && isRef(v[0], bound) && isAmmoSlotArray(v[1]) && typeof v[2] === "boolean";

// Governing: issue #198.
//
// Every key the wire format defines, and nothing else. `isValidData` used to check that the
// fields it NAMES were present and well-shaped and then return true, which is a required-
// fields check rather than an allowlist — and since the validated object is stored verbatim
// (see the POST handler), any extra property a caller invented was persisted with it. The
// 64kb body cap was the only ceiling on how much of it there could be.
//
// Kept as a Set beside the validator rather than derived from it: the fields are checked in
// six hand-written lines that a regexp over the source could not honestly enumerate, so the
// list is stated once, explicitly, and any new field has to be added here to be accepted.
const DATA_KEYS = new Set(["v", "w", "e", "tr", "n", "b"]);

// A courtesy ceiling, not a security boundary — and worth being precise about which, because
// the difference determines what it is allowed to cost a real user. Owner tokens are
// caller-chosen and unlimited (lib/ownership.js), so anyone willing to rotate one is bounded
// by the rate limiters and not by this. What this stops is a single client, or a loop with a
// bug in it, quietly turning the store into something the process has to re-serialise on
// every write. 200 is far past any plausible collection of saved builds.
const MAX_LOADOUTS_PER_OWNER = 200;

// Governing: ADR-0012 (fifteen-trait cap), SPEC-0003 REQ "A Loadout Holds At Most Fifteen Traits"
//
// A rule of the game, not a courtesy ceiling: a hunter carries at most fifteen traits, so a
// write carrying sixteen describes a loadout that cannot exist. Tightened from 40, and exact
// rather than a floor per REQ "A Write Stores Only What the Wire Format Defines".
//
// This is one of three bounded write paths — the reducer's `addTrait` and both decoders carry
// the same number on the client, which cannot share a module with this one. The duplication is
// accepted and watched by a test on each side pinning the same figure.
//
// It REJECTS rather than truncating. Storing fifteen of a caller's sixteen would hide a client
// bug behind a 201; the decoders clamp instead, which is what keeps records written under the
// old bound loadable. Nothing re-validates on read (`isValidData` is called from POST alone —
// GET, PATCH and DELETE never call it), so tightening this does not strand a stored record: it
// decodes to fifteen client-side and the next save writes fifteen back.
//
// Distinct from WIRE_CATEGORIES.tr above, which bounds each trait REFERENCE's numeric value
// against the catalog's size. That one is validation slack on an index; this one is the count.
const MAX_TRAITS = 15;

function isValidV1Entry(entry) {
  return Array.isArray(entry) && entry.length === 2 && (entry[0] === "T" || entry[0] === "C") && isRef(entry[1], entry[0] === "T" ? WIRE_CATEGORIES.eT : WIRE_CATEGORIES.eC);
}

function isValidV2Entry(entry) {
  return Array.isArray(entry) && entry.length === 2 && (entry[0] === "T" || entry[0] === "C") && isRef(entry[1], entry[0] === "T" ? WIRE_CATEGORIES.eT : WIRE_CATEGORIES.eC);
}

function isValidData(data) {
  const reject = (field) => ({ ok: false, field });
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, field: "data" };
  if (Object.keys(data).some((k) => !DATA_KEYS.has(k))) return reject("data");
  if (data.v !== undefined && typeof data.v !== "number") return reject("v");
  // Version 2 declares the sparse eight-cell shape and the per-cell blocked array
  // (ADR-0009); only version 1 and the unversioned legacy records carry the packed
  // encoding. A cell-grid `e` must be exactly eight entries and may HOLD null holes —
  // rejecting the holes would reject every v2 loadout before one is even sent. The
  // version's own `b` shape is validated below, under the same version branch.
  //
  // Governing: ADR-0023, SPEC-0009 REQ "Version 2 and Version 1 Records Continue to
  // Decode" ("every field version 2 defined SHALL survive unchanged" across a v2 → v3
  // re-encode). This is "version 2 or later", NOT "version 2 exactly": version 3 changes
  // the weapon entry and nothing else, so it inherits v2's equipment grid and v2's
  // blocked array. Gating these on equality sent v3 down the v1 packed path, where a
  // null grid hole fails `isValidV1Entry` and an array `b` fails a `typeof number` —
  // i.e. every save from a v3 client, which is the exact break #329 exists to prevent.
  // `data.v` is undefined or a number by the check above, and `undefined >= 2` is false,
  // so legacy records still take the packed path.
  const isV2OrLater = data.v >= 2;
  if (!Array.isArray(data.w) || data.w.length !== 2) return reject("w");
  // Governing: ADR-0023, SPEC-0009 REQ "The Weapon Entry Is Validated at an Exact
  // Element Count". The weapon check is version-aware like `e`/`b`: a v3 payload's
  // entry carries the pair flag at `[ref, ammo, d]`, a v1/v2 payload's carries
  // `[ref, ammo]`, and each is validated under its own version's count.
  //
  // Exactly two entries per tuple, not "at least". A floor with no ceiling accepted a slot
  // carrying any amount of trailing junk, which was then stored — the same unbounded-growth
  // hole as an unknown key, wearing the shape of a field the format does define.
  const weaponValid = (slot) =>
    slot === null ||
    (data.v === 4
      ? isIslandV4(slot, WIRE_CATEGORIES.w)
      : data.v === 3
        ? isIslandV3(slot, WIRE_CATEGORIES.w)
        : isIsland(slot, WIRE_CATEGORIES.w));
  if (!data.w.every(weaponValid)) return reject("w");
  if (!Array.isArray(data.e)) return reject("e");
  if (isV2OrLater) {
    // Version 2 and later (ADR-0009): a fixed eight-cell grid whose cells may hold null
    // holes. Version 3's weapon pairs do not change the equipment encoding (ADR-0023),
    // so v3 is validated by the grid rule its client actually emits — `toData()` builds
    // `e` as Array(8) in cell order at every version from 2 up.
    if (data.e.length !== 8) return reject("e");
    // Structural shape, not truthiness: each cell is either empty (null) or a valid entry.
    if (!data.e.every((entry) => entry === null || isValidV2Entry(entry))) return reject("e");
  } else {
    // Version 1 and the unversioned legacy records: the packed encoding, at most eight
    // entries, each a valid entry and none of them null.
    if (data.e.length > 8) return reject("e");
    if (!data.e.every((entry) => isValidV1Entry(entry))) return reject("e");
  }
  if (!Array.isArray(data.tr) || data.tr.length > MAX_TRAITS) return reject("tr");
  if (!data.tr.every((id) => isRef(id, WIRE_CATEGORIES.tr))) return reject("tr");
  // Governing: ADR-0024 ("loadable, not legal"), issue #472. A trait list carrying
  // duplicate ids is syntactically malformed (the decoded loadout's upgrade-point
  // total is inflated by the repeated entry, and the trait budget burns on one id),
  // but the duplicate is structurally harmless: the client's decoder (`boundedTraits`,
  // `client/src/utils/loadoutCodec.js`) already deduplicates before any other consumer
  // sees the list, and the same dedup on the server brings both ends into agreement.
  // Refusing the whole write would diverge from the "degrade rather than refuse"
  // pattern every other decode/validate path in this codebase already follows.
  if (Array.isArray(data.tr)) data.tr = [...new Set(data.tr)];
  if (typeof data.n !== "string" || data.n.length > 200) return reject("n");
  if (data.b !== undefined) {
    if (isV2OrLater) {
      // Per-cell blocking (ADR-0009): an array of cell indices, from version 2 on — the
      // same "or later" rule as `e` above, and for the same reason. Rejected rather than
      // clamped when an index is out of range — a clamp would store a grid the client
      // never asked for (REQ "Error Handling at the Payload Boundary").
      if (!Array.isArray(data.b) || data.b.some((c) => !Number.isInteger(c) || c < 0 || c >= 8)) return reject("b");
      // Governing: ADR-0024 ("loadable, not legal"), issue #472. A repeated blocked-cell
      // index is syntactically malformed (SPEC-0006 REQ "Version 1 Records Migrate
      // Losslessly" — "no input SHALL produce a blocked list containing a duplicate"),
      // but a duplicate is structurally harmless: the same cell is blocked either way, so
      // deduplicating rather than refusing the write matches the "degrade rather than refuse"
      // pattern every other decode/validate path in this codebase already follows. The
      // client's decoder (`boundedBlocked`, `client/src/utils/loadoutCodec.js`) already
      // dedupes; this brings the server into agreement.
      data.b = [...new Set(data.b)];
    } else if (typeof data.b !== "number" || data.b < 0 || data.b > 8) {
      return reject("b");
    }
  }
  // Governing: ADR-0024, issue #472, item 4. An occupied-and-blocked cell (an `e`
  // entry and a `b` index naming the same cell) is now handled deterministically
  // rather than left to break the arithmetic downstream: blocked wins, the occupied
  // entry becomes a hole (null). This matches how blocking already refuses to apply
  // to an occupied cell elsewhere in the interactive UI, and the client's decoder
  // (`boundedEquip`, `client/src/utils/loadoutCodec.js`) resolves the same overlap
  // the same way as defence in depth. Applies to v2+ records, where `e` is a
  // fixed eight-cell grid and `b` is an array of cell indices — v1/legacy packed
  // records have no per-cell blocking to overlap with.
  if (isV2OrLater && Array.isArray(data.b) && Array.isArray(data.e)) {
    for (const k of data.b) {
      if (k >= 0 && k < data.e.length) data.e[k] = null;
    }
  }
  return { ok: true };
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

// NAME_MAX_CHARS governs the ENVELOPE's name. The identical-looking 200 inside isValidData
// caps `data.n`, which is wire-format validation frozen by REQ "The Saved-Loadout Wire
// Format Is Unchanged" — a different rule that happens to have landed on the same number,
// so it is deliberately left as its own literal rather than made to share this constant.
const NAME_MAX_CHARS = 200;

// The description cap and its validator are shared with the LIST route (lib/descriptions.js).
// Both records carry a description under the same wire discipline and the same limit; what
// differs is only what an absent value means, and that difference lives in the handlers rather
// than in the check. Re-exported because this module is where callers already look for it.
export { DESCRIPTION_MAX_CHARS };

// Records written before SPEC-0003 have no `listId` key at all, so `rec.listId` is
// undefined rather than null. Serialise it explicitly so the API shape is uniform: every
// loadout carries a `listId`, and "Unassigned" is always `null` rather than sometimes an
// absent field. Without this, every consumer has to coalesce, and the no-op comparison in
// PATCH below would miss the legacy shape.
//
// `description` is coalesced the same way and for the same reason. A loadout's description is
// the user's own note about the build and NOTHING is inherited into it, so absent, null and ""
// all render as no note — the coalescing is for a uniform API shape, not to preserve a
// distinction. (It was three states until #181 moved inheritance to the list, where the hunter
// actually lives; `""` survives as `""` here only because rewriting stored records to say the
// same thing a different way would be a migration with nothing to gain.)
// Governing: SPEC-0003 REQ "Loadouts Within a List Have a User-Chosen Order", design.md
// "Loadouts within a list have a user-set order, stored server-side".
//
// `order` is materialised for every response, never left absent: a record written before
// this requirement existed has no stored `order`, and rather than push that absence onto
// every consumer (a second `?? fallback` at every call site, and a client that has to know
// what the fallback even is), it is computed HERE, once, at the boundary. The fallback is
// the record's own position among its live, owned list-mates in the array's storage order —
// which is the creation order every one of today's records already renders in, so nothing
// changes for a record that has never been touched by a reorder.
//
// This is a READ-time projection, not a write: `rec.order` on disk is untouched by a GET,
// so no migration is triggered merely by serving a request. Three writers set it for real,
// and all three are internal to this file: the reorder endpoint, the list-move append, and
// (as of the fix below) record creation via `nextOrderInScope` — never this fallback. A
// record can only ever reach this fallback by predating the requirement entirely, which is
// exactly the "nothing in this scope has been reordered yet" case the fallback is FOR. A
// record that reaches it any other way is a bug: earlier this fallback was ALSO how a
// brand-new record's order was decided, which meant a fresh save into a list that had been
// reordered and then partly emptied could land the new record ahead of older, deliberately
// ordered survivors — the survivors kept real (and, after the scope shrank, comparatively
// large) stored values while the newcomer got a small raw array-position index with no idea
// those values existed. Routing creation through the same max-based writer the move path
// already used closes that gap; see `server/src/routes/reorder.test.js` for the regression.
function scopedOrderIndex(rec, records) {
  const scoped = liveRecords(records).filter(
    (l) => l.owner === rec.owner && (l.listId ?? null) === (rec.listId ?? null)
  );
  const idx = scoped.findIndex((l) => l.id === rec.id);
  return idx === -1 ? 0 : idx;
}

// Records written before SPEC-0003 have no `listId` key at all, so `rec.listId` is
// undefined rather than null. Serialise it explicitly so the API shape is uniform: every
// loadout carries a `listId`, and "Unassigned" is always `null` rather than sometimes an
// absent field. Without this, every consumer has to coalesce, and the no-op comparison in
// PATCH below would miss the legacy shape.
//
// `description` is coalesced the same way and for the same reason. A loadout's description is
// the user's own note about the build and NOTHING is inherited into it, so absent, null and ""
// all render as no note — the coalescing is for a uniform API shape, not to preserve a
// distinction. (It was three states until #181 moved inheritance to the list, where the hunter
// actually lives; `""` survives as `""` here only because rewriting stored records to say the
// same thing a different way would be a migration with nothing to gain.)
//
// `records` is the full in-memory collection (`db.data.loadouts`) at call time — needed only
// to compute the `order` fallback above when `rec.order` is not itself stored.
const publicLoadout = (rec, records) => ({
  ...publicRecord(rec),
  listId: rec.listId ?? null,
  description: rec.description ?? null,
  order: rec.order ?? scopedOrderIndex(rec, records),
});

// Governing: SPEC-0003 REQ "A Loadout Moved Between Lists Lands at the End" (design.md
// "Moving between lists appends, it does not splice").
//
// Called only when `listId` is actually CHANGING (never on an ordinary re-save or a
// no-op move) — computes one past the highest effective order among the destination
// scope's CURRENT members, `excludeId` set to the moving record itself so it is never
// counted against its own destination. An empty destination gets 0.
//
// Neither leaving `order` untouched nor trusting the record's array position would land
// this reliably at the end: a value carried over from the old list is coincidental in the
// new one, and array position reflects creation time, not move time.
function nextOrderInScope(records, owner, listId, excludeId) {
  const scoped = liveRecords(records).filter(
    (l) => l.owner === owner && l.id !== excludeId && (l.listId ?? null) === listId
  );
  if (!scoped.length) return 0;
  const maxOrder = Math.max(...scoped.map((l, idx) => l.order ?? idx));
  return maxOrder + 1;
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
// Governing: issue #198. The read path carries `readLimiter` — reads mutate nothing, but
// db.read() re-parses the entire data file on every one of them, so an unlimited GET is an
// unlimited parse rate that gets worse as the store grows. The budget is far looser than the
// write floor; see lib/ownership.js.
loadoutsRouter.get("/", readLimiter, async (_req, res) => {
  try {
    await db.read();
    const token = callerToken(_req);
    const mine = liveRecords(db.data.loadouts)
      .filter((l) => l.owner === token)
      .map((l) => publicLoadout(l, db.data.loadouts));
    res.json(mine);
  } catch (err) {
    console.error("GET /api/loadouts failed:", err);
    res.status(500).json({ error: "failed to read loadouts" });
  }
});

loadoutsRouter.post("/", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const { name, data, listId, id } = body;
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name must be a non-empty string" });
    }
    if (name.trim().length > NAME_MAX_CHARS) {
      return res.status(400).json({ error: `name must be at most ${NAME_MAX_CHARS} characters` });
    }
    // Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List"
    //
    // `id` is an addressing argument on the request, not a field of the loadout. When
    // present it names the record the write is addressed to — a loaded loadout writing back
    // to the record it came from — and the target is resolved by (id, owner) instead of by
    // the (owner, listId, name) triple. It SHALL NOT be written into the stored record's
    // `data` (REQ "The Saved-Loadout Wire Format Is Unchanged").
    if (id !== undefined && !isId(id)) {
      return res.status(400).json({ error: "id must be a non-empty string of at most 100 characters" });
    }
    if (!isValidData(data).ok) {
      // REQ "Error Handling at the Payload Boundary": a rejection names the offending
      // field rather than the whole request.
      const field = isValidData(data).field ?? "data";
      return res.status(400).json({ error: `data.${field} is not a valid loadout payload` });
    }
    // Governing: SPEC-0003 REQ "Loadouts Carry a Description of Their Own", SPEC-0003 § HTTP
    // API — "`POST` SHALL accept an optional `description`, so that saving a loadout with one
    // written up front is a single write rather than a save followed by a patch". The key's
    // PRESENCE is the question, not its truthiness: `"description" in body` distinguishes
    // "said nothing" from "said null".
    //
    // No client path sends the key today — the description editor lives on a saved card, so
    // there is nothing to write up front yet, and client/src/api/loadouts.js says so at the
    // call site and pins it with a test. This branch is kept anyway because the SHALL above
    // is normative on the endpoint, not on the caller; deleting it would put the server out
    // of conformance to make a coverage observation go away.
    const describes = "description" in body;
    const desc = describes ? validateDescription(body.description, res) : { ok: true, value: null };
    if (!desc.ok) return;

    const token = callerToken(req);
    await db.read();

    const ref = validateListRef(listId, token, res);
    if (!ref.ok) return;

    const trimmedName = name.trim();
    const now = new Date().toISOString();

    // Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List" (issue #102)
    //
    // Two resolution paths, selected by whether `id` is present on the request:
    //
    // 1. `id` present — resolve by (id, owner). A loadout loaded from a saved record and
    //    then edited (including renamed) writes back to the record it came from. A stale or
    //    foreign `id` resolves to nothing and is a 404: it MUST NOT fall back to the triple
    //    and MUST NOT create a record. A fallback would write the user's edits over a
    //    different loadout that merely shares a name; a create would mint a silent duplicate.
    //    A 404 is the only answer that neither destroys nor duplicates.
    //
    //    On this path `listId` is NOT applied — an id-addressed write updates the record
    //    where it already lives and never relocates it. `listId` is a KEYING argument on
    //    the triple path, and `resolveSaveListId` (savedLoadoutsSlice.js) always yields a
    //    value or an explicit `null`, so every save this client makes carries one whether
    //    or not it means anything. Honouring it here would silently turn "save the loadout
    //    I loaded" into "move it into whichever list I happen to have open" — the same
    //    unasked-for relocation that #102 was, arriving by the other door. Moving is an
    //    explicit control (`PATCH /:id`, one of exactly two fields it reaches); the save
    //    path is not it. An invalid `listId` is still REJECTED rather than ignored: a
    //    caller sending a list it does not own is wrong about something, and answering 200
    //    would hide that.
    //
    // 2. `id` absent — the upsert key is the TRIPLE `(owner, listId, name)`, not `(owner,
    //    name)`. Matching on name alone meant saving "Fanning" while one list was open
    //    overwrote AND relocated the "Fanning" already filed in another — data loss on a
    //    routine flow, reported as #102.
    //
    //    `listId` is compared AS A VALUE, `null` included. The Unassigned pseudo-list is
    //    `null`, so treating it as "no constraint" would collapse every Unassigned save onto
    //    the first such record — the same defect wearing different clothes.
    //
    //    `l.listId ?? null` coalesces because a record written before SPEC-0003 has NO
    //    `listId` key at all — `undefined`, not `null`. A plain `===` would miss those and
    //    mint a duplicate on the first re-save (the hazard "treats moving an
    //    already-unassigned legacy-shaped record to null as a no-op" pins on the PATCH side).
    //
    //    An OMITTED `listId` still matches on name alone, and that is deliberate rather
    //    than a gap in the key. The request body distinguishes absent from null: absent means
    //    "update this loadout, do not move it" — the semantic `filing.test.js` pins as
    //    "leaves filing untouched when an upsert omits listId" — and a caller who declined to
    //    name a list has not supplied a triple to match on. The app never takes this path:
    //    `resolveSaveListId` (savedLoadoutsSlice.js) always yields a list id or an explicit
    //    `null`, so every save this application makes is fully keyed. Where two same-named
    //    records now legally exist in different lists, an omitted `listId` resolves to the
    //    first and is ambiguous by construction; the triple is the identity, and this branch
    //    is compatibility for callers that predate it.
    const idAddressed = id !== undefined;
    let existing;
    if (idAddressed) {
      existing = liveRecords(db.data.loadouts).find((l) => l.id === id && l.owner === token);
      if (!existing) {
        return res.status(404).json({ error: "loadout not found" });
      }
    } else {
      const scopedToList = listId !== undefined;
      existing = liveRecords(db.data.loadouts).find(
        (l) =>
          l.owner === token &&
          l.name === trimmedName &&
          (!scopedToList || (l.listId ?? null) === ref.value)
      );
    }

    // Governing: issue #198. Only a NEW record is refused: re-saving under an existing name
    // is an update, and an owner sitting at the ceiling must still be able to edit what they
    // already have. 409 rather than 400 — the payload is fine, the collection's state is what
    // makes it unacceptable, and the caller fixes it by deleting something.
    if (!existing && ownedBy(db.data.loadouts, token).length >= MAX_LOADOUTS_PER_OWNER) {
      console.warn("loadout create refused at cap", { cap: MAX_LOADOUTS_PER_OWNER });
      return res.status(409).json({ error: `at most ${MAX_LOADOUTS_PER_OWNER} saved loadouts` });
    }

    let record;
    if (existing) {
      existing.data = data;
      existing.name = trimmedName;
      existing.updatedAt = now;
      // Only re-file when the caller said something about it. An upsert that omits listId
      // is updating the loadout, not moving it out of its list — and an id-addressed write
      // never re-files at all, because there `listId` is an artefact of the client always
      // sending one rather than a request to move anything (see the two-path note above).
      if (!idAddressed && listId !== undefined) existing.listId = ref.value;
      // Same rule for the description, for the same reason: re-saving a build under a name
      // that already exists must not silently discard the note the user wrote about it.
      if (describes) existing.description = desc.value;
      record = existing;
    } else {
      const newId = randomUUID();
      record = {
        id: newId,
        owner: token,
        name: trimmedName,
        data,
        listId: ref.value,
        // Governing: SPEC-0003 REQ "Loadouts Within a List Have a User-Chosen Order".
        //
        // Assigned explicitly here rather than left for `publicLoadout`'s array-position
        // fallback to cover — `scopedOrderIndex` bases that fallback on the record's plain
        // position among its live scope-mates in STORAGE order, which is only correct while
        // nothing in the scope has ever been reordered. Once a scope HAS been reordered and
        // then shrunk (an older member deleted or moved out), its survivors keep whatever
        // explicit `order` the reorder gave them, which can be arbitrarily larger than a new
        // arrival's storage-position fallback of 0/1/2 — the new loadout would render AHEAD
        // of older, deliberately-arranged ones. `nextOrderInScope` is the same "one past the
        // max real value in scope" computation the list-move path already uses for the
        // identical reason, so every entry point into a list scope — create, and move — goes
        // through one writer instead of two different answers to "where does this land".
        order: nextOrderInScope(db.data.loadouts, token, ref.value, newId),
        updatedAt: now,
      };
      // The key is written only when the caller supplied one. A record nobody has written a
      // note about carries NO `description` field at all, and the API surfaces that as null
      // through publicLoadout without the store having to hold a placeholder for it.
      if (describes) record.description = desc.value;
      db.data.loadouts.push(record);
    }

    await db.write();
    res.status(existing ? 200 : 201).json(publicLoadout(record, db.data.loadouts));
  } catch (err) {
    console.error("POST /api/loadouts failed:", err);
    res.status(500).json({ error: "failed to save loadout" });
  }
});

/**
 * Reorder every loadout filed in one list (or Unassigned) in a single write.
 *
 * Governing: SPEC-0003 REQ "Loadouts Within a List Have a User-Chosen Order", design.md
 * "Loadouts within a list have a user-set order, stored server-side".
 *
 * Registered BEFORE `PATCH /:id` below — Express matches routes in registration order, and
 * `/:id` would otherwise treat the literal path segment "reorder" as an id.
 *
 * `order` MUST name EXACTLY the caller's own live loadouts currently filed in `listId` — not
 * a superset, not a subset, no foreign id, no duplicate. This is deliberately stricter than
 * `PATCH /:id`'s per-field writes: a partial or padded list here would either silently orphan
 * a card at whatever order it already had (dropped from the request) or hand a stranger's
 * position to an id that was never validated as belonging to this scope. Rejecting the whole
 * request outright is the same "reject loudly rather than silently downgrade" instinct
 * `validateListRef` already applies to a single `listId` reference, extended to a whole
 * reordering request instead of one write.
 */
loadoutsRouter.patch("/reorder", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const { listId, order } = body;

    if (!Array.isArray(order) || order.length === 0 || !order.every(isId)) {
      return res.status(400).json({ error: "order must be a non-empty array of loadout ids" });
    }
    if (new Set(order).size !== order.length) {
      return res.status(400).json({ error: "order must not contain duplicate ids" });
    }

    const token = callerToken(req);
    await db.read();

    const ref = validateListRef(listId, token, res);
    if (!ref.ok) return;

    const scoped = liveRecords(db.data.loadouts).filter(
      (l) => l.owner === token && (l.listId ?? null) === ref.value
    );
    const scopedIds = new Set(scoped.map((l) => l.id));
    const orderIds = new Set(order);
    const namesExactlyTheScope =
      scopedIds.size === orderIds.size && [...scopedIds].every((id) => orderIds.has(id));
    if (!namesExactlyTheScope) {
      return res.status(400).json({
        error: "order must name exactly the loadouts currently filed in listId, no more and no fewer",
      });
    }

    const byId = new Map(scoped.map((l) => [l.id, l]));
    order.forEach((id, index) => {
      byId.get(id).order = index;
    });
    order.forEach((id) => {
      byId.get(id).updatedAt = new Date().toISOString();
    });

    await db.write();
    res.json(order.map((id) => publicLoadout(byId.get(id), db.data.loadouts)));
  } catch (err) {
    console.error("PATCH /api/loadouts/reorder failed:", err);
    res.status(500).json({ error: "failed to reorder loadouts" });
  }
});

/**
 * Move a loadout between lists, and/or edit its description.
 *
 * Governing: ADR-0006 (list filing model), SPEC-0003 REQ "Loadouts Are Filed into Lists by
 * Nullable Reference", SPEC-0003 REQ "Loadouts Carry a Description of Their Own".
 *
 * Two mutable fields, and they are INDEPENDENT: this endpoint used to require `listId`,
 * which would have made "describe" impossible without also restating where the loadout is
 * filed. Nothing else about the record is reachable from here — not `data`, not the format
 * version, not the name.
 *
 * The whole endpoint turns on presence rather than value. For BOTH fields:
 *
 *   omitted  -> leave it exactly as it is
 *   null     -> `listId: null` files into Unassigned; `description: null` CLEARS the note
 *   a string -> store it, `description: ""` included
 *
 * `description: null` meant "restore the inherited default" until #181 moved inheritance to
 * the list. A loadout has no hunter of its own to inherit from — its list does — so null and
 * `""` now say the same thing here, and both are accepted rather than one being rejected: a
 * client that clears a field by writing null is not wrong, and records already store both.
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
    // description comparison coalesces the same way, so clearing a note that was never
    // written is correctly seen as the no-op it is.
    const sameList = (loadout.listId ?? null) === ref.value;
    const sameDescription = (loadout.description ?? null) === desc.value;
    if (sameList && sameDescription) {
      // Writing what is already there is a no-op, not an error and not a write.
      return res.json(publicLoadout(loadout, db.data.loadouts));
    }

    // Governing: SPEC-0003 REQ "A Loadout Moved Between Lists Lands at the End". Only an
    // ACTUAL list change gets a fresh order — a no-op `files` (re-sending the current
    // listId) or a description-only write must not disturb where the card already sits.
    if (files && !sameList) {
      loadout.order = nextOrderInScope(db.data.loadouts, token, ref.value, loadout.id);
    }
    if (files) loadout.listId = ref.value;
    if (describes) loadout.description = desc.value;
    loadout.updatedAt = new Date().toISOString();
    await db.write();

    console.info("loadout updated", {
      loadoutId: loadout.id,
      listId: sameList ? undefined : ref.value,
      // The TEXT is never logged — it is the user's own prose. Which state it landed in is
      // what a log needs to say.
      description: sameDescription ? undefined : desc.value === null ? "cleared" : `${charCount(desc.value)} chars`,
    });
    res.json(publicLoadout(loadout, db.data.loadouts));
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
