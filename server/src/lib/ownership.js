// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists), SPEC-0003 REQ
// "Cross-Collection Ownership Enforcement", SPEC-0003 REQ "Error Handling Standards"
//
// Shared ownership primitives for every collection in this API.
//
// These lived in routes/loadouts.js while loadouts were the only owned collection.
// SPEC-0003 adds a second one (loadoutLists), and the two MUST agree exactly on what
// a caller token is and which records are reachable — a divergence here is a
// cross-user data leak, which is precisely what issue #17 closed. One definition,
// imported by both routers.

import { createHash, randomUUID } from "node:crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Per-user ownership boundary (issue #17): every record is scoped to the client-issued
// token that created it. Requests that carry no token (e.g. curl) never touch another
// client's data — they get a fresh per-request identity, so anything they save is scoped
// to that single request and invisible to everyone else (including their own later
// no-token requests). There is deliberately no shared anonymous bucket: one would expose
// every legacy no-owner record to any request that simply omits the header.
const ANON = "request-scoped";

export function callerToken(req) {
  const token = req.get("x-loadout-token") || "";
  if (typeof token === "string" && token.trim()) return token.trim().slice(0, 200);
  return `${ANON}:${randomUUID()}`;
}

// Live records are those owned by a client token; legacy pre-token records (issue #17,
// marked `legacy: true` at boot in db.js) have no owner and are excluded from every
// handler so no header value can ever reach them.
export const liveRecords = (list) => list.filter((l) => !l.legacy);

/** Records in `list` owned by `token`. The owner filter every handler runs first. */
export const ownedBy = (list, token) => liveRecords(list).filter((l) => l.owner === token);

/** Strip `owner` before serialising — the API never discloses that other owners exist. */
export const publicRecord = ({ owner, ...rest }) => rest;

// ---------------------------------------------------------------------------
// Sentinel errors (SPEC-0003 "Error Handling Standards")
//
// "Not found" and "not yours" are deliberately distinct *internally* so callers can
// branch on them and logs can tell an attack from a stale client. Both surface to the
// client as 404 — see resolveOwnedList in routes/loadoutLists.js for why.
// ---------------------------------------------------------------------------

export class OwnershipError extends Error {
  constructor(message, { cause, recordId, collection } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = this.constructor.name;
    this.recordId = recordId;
    this.collection = collection;
  }
}

/** No record with this id exists in the collection at all. */
export class RecordNotFoundError extends OwnershipError {}

/** The record exists but belongs to a different token. */
export class RecordNotOwnedError extends OwnershipError {}

/** A referenced id is well-formed but names nothing in the catalog/collection. */
export class UnknownReferenceError extends OwnershipError {}

// ---------------------------------------------------------------------------
// Rate limiting (issue #21) — defense-in-depth independent of the ownership model.
// Two stacked limiters:
//   - ipLimiter: a hard per-IP floor so rotating the client-controlled token can't
//     bypass rate limiting entirely.
//   - tokenLimiter: per-client-token fairness so users sharing a NAT don't collectively
//     trip the IP floor; anonymous (no-token) requests key by IP.
// ---------------------------------------------------------------------------

// Exported so the trust-proxy regression test in index.test.js can exhaust the IP budget
// exactly rather than restating the number — the assertion is "these requests shared a
// bucket", and a hardcoded copy would start testing a stale constant the day this changes.
export const WRITE_PER_IP = 240; // generous hard floor (4x the per-token budget)
const WRITE_PER_TOKEN = 60;

function ipKey(req) {
  const ip = ipKeyGenerator(req.ip || "unknown", 56);
  return `ip:${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
}

function tokenLimiterKey(req) {
  const token = req.get("x-loadout-token");
  return token && typeof token === "string" && token.trim()
    ? `tok:${token.trim().slice(0, 200)}`
    : ipKey(req);
}

export const ipLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: WRITE_PER_IP,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: ipKey,
});

export const tokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: WRITE_PER_TOKEN,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => tokenLimiterKey(req),
});
