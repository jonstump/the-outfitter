// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
// Hunter Portraits), ADR-0007 (hunter roster dataset), SPEC-0003 REQ "Favorite Hunters",
// SPEC-0003 REQ "Cross-Collection Ownership Enforcement", SPEC-0003 REQ "Error Handling
// Standards", SPEC-0003 REQ "Database Operation Standards"
//
// A favorite is the thinnest possible owned record: (owner, hunterId). It carries no
// ordering, no note, and no count — everything the picker does with favorites is a filter
// and a sort computed client-side over the roster it already has.
//
// Storage mirrors `loadoutLists` deliberately, down to importing the same ownership
// primitives rather than restating them: `callerToken`, the owner filter, `publicRecord`
// and the stacked limiters all come from lib/ownership.js. A second definition of any of
// them is how issue #17's cross-user leak happened the first time.
//
// The hunter id is the ADDRESS, not a body field: PUT /:hunterId and DELETE /:hunterId.
// That is what makes both verbs idempotent for free — PUT twice is one favorite, DELETE on
// something unfavorited is a no-op — which SPEC-0003 requires and which a POST /toggle
// could not offer, since a retried toggle flips the state back.

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { isKnownHunterId } from "../lib/hunterRoster.js";
import {
  callerToken,
  ipLimiter,
  ownedBy,
  publicRecord,
  readLimiter,
  tokenLimiter,
  UnknownReferenceError,
} from "../lib/ownership.js";

export const hunterFavoritesRouter = Router();

// Length cap applied BEFORE the roster lookup. Roster ids are slugs well under this, so
// the cap is not what rejects a wrong id — it is what stops an unbounded string being used
// as a Set key or reaching a log line at all.
const HUNTER_ID_MAX = 100;

/**
 * Validate a `hunterId` from the request path.
 *
 * Governing: SPEC-0003 Security Requirements — "`hunterId` SHALL be length-capped and
 * validated against the known library".
 *
 * Both checks are required and neither subsumes the other: the cap bounds the input, the
 * roster lookup bounds the *meaning*. Unlike a list's `hunterId` — which SPEC-0003 requires
 * to survive its hunter leaving the dataset — a favorite has no reason to exist for a
 * hunter the picker can never show, so an unknown id is rejected rather than stored.
 */
function assertKnownHunter(hunterId) {
  if (typeof hunterId !== "string" || hunterId.length === 0 || hunterId.length > HUNTER_ID_MAX) {
    throw new UnknownReferenceError(`hunterId must be a string of at most ${HUNTER_ID_MAX} characters`, {
      recordId: typeof hunterId === "string" ? hunterId.slice(0, HUNTER_ID_MAX) : null,
      collection: "hunterFavorites",
    });
  }
  if (!isKnownHunterId(hunterId)) {
    throw new UnknownReferenceError(`no hunter with id ${hunterId}`, {
      recordId: hunterId,
      collection: "hunterFavorites",
    });
  }
}

/**
 * Map a rejected portrait reference onto a response.
 *
 * 400, not 404: the request addressed a collection that exists and named something that
 * does not, and unlike a list id there is nothing to protect from enumeration — the roster
 * is a public, committed dataset the client already ships in full.
 */
function respondToUnknownHunter(res, err, op) {
  if (err instanceof UnknownReferenceError) {
    console.warn("hunter favorite rejected", {
      op,
      collection: err.collection,
      recordId: err.recordId,
      reason: err.name,
    });
    return res.status(400).json({ error: "unknown hunter" });
  }
  return null;
}

// Express 4 does not forward rejected promises from async handlers to the error middleware,
// so every handler wraps its body in try/catch (issue #18).

/**
 * The caller's favorites.
 *
 * Never a filter, never a gate: this returns what the caller has favorited and nothing
 * about the roster. The picker shows all 242 either way — SPEC-0003 REQ "Favorite Hunters"
 * makes favorites their own section plus an optional client-side toggle — so an empty array
 * here is an ordinary, expected answer and not an empty picker.
 *
 * `readLimiter` bounds the full-file parse every read performs (issue #198); the budget is
 * far looser than the write floor, and is per-IP only. See lib/ownership.js.
 */
hunterFavoritesRouter.get("/", readLimiter, async (req, res) => {
  try {
    await db.read();
    const token = callerToken(req);
    res.json(ownedBy(db.data.hunterFavorites, token).map(publicRecord));
  } catch (err) {
    console.error("GET /api/hunter-favorites failed:", err);
    res.status(500).json({ error: "failed to read favorites" });
  }
});

/**
 * Favorite a hunter. Idempotent.
 *
 * A second PUT returns the record the first one created rather than adding a duplicate, so
 * a retried request, a double-click, and two tabs racing all converge on one favorite.
 */
hunterFavoritesRouter.put("/:hunterId", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const { hunterId } = req.params;
    try {
      assertKnownHunter(hunterId);
    } catch (err) {
      const handled = respondToUnknownHunter(res, err, "PUT /api/hunter-favorites/:hunterId");
      if (handled) return handled;
      throw err;
    }

    const token = callerToken(req);
    await db.read();

    // Read-modify-write within one read()/write() pair, keyed on (owner, hunterId), so two
    // concurrent favorites of the same hunter cannot produce two rows
    // (SPEC-0003 REQ "Database Operation Standards").
    const existing = ownedBy(db.data.hunterFavorites, token).find((f) => f.hunterId === hunterId);
    if (existing) return res.json(publicRecord(existing));

    const record = {
      id: randomUUID(),
      owner: token,
      hunterId,
      createdAt: new Date().toISOString(),
    };
    db.data.hunterFavorites.push(record);
    await db.write();

    res.status(201).json(publicRecord(record));
  } catch (err) {
    console.error("PUT /api/hunter-favorites/:hunterId failed:", err);
    res.status(500).json({ error: "failed to favorite hunter" });
  }
});

/**
 * Unfavorite a hunter. Idempotent.
 *
 * Unfavoriting something that is not favorited is 204, not 404. There is no record to
 * "not find" — the caller asked for a state ("this hunter is not among my favorites") that
 * is already true, and the ownership filter means a foreign token's favorite is invisible
 * here rather than deletable: the filter is applied before the removal, so a DELETE that
 * names another token's favorite removes nothing and reports the same 204 as any other
 * no-op, disclosing nothing about what that token has favorited.
 */
hunterFavoritesRouter.delete("/:hunterId", ipLimiter, tokenLimiter, async (req, res) => {
  try {
    const { hunterId } = req.params;
    try {
      assertKnownHunter(hunterId);
    } catch (err) {
      const handled = respondToUnknownHunter(res, err, "DELETE /api/hunter-favorites/:hunterId");
      if (handled) return handled;
      throw err;
    }

    const token = callerToken(req);
    await db.read();

    // The ownership decision is `ownedBy` and nothing else — the removal then matches on
    // record identity. Restating the owner predicate inline here is what would put a second
    // copy of the ownership rule in the codebase, which is the divergence issue #17 closed.
    const mine = ownedBy(db.data.hunterFavorites, token).find((f) => f.hunterId === hunterId);
    if (mine) {
      db.data.hunterFavorites = db.data.hunterFavorites.filter((f) => f !== mine);
      await db.write();
    }

    res.status(204).end();
  } catch (err) {
    console.error("DELETE /api/hunter-favorites/:hunterId failed:", err);
    res.status(500).json({ error: "failed to unfavorite hunter" });
  }
});
