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
import { TOKEN_SHAPED_OWNER } from "./tokenShape.js";

// Per-user ownership boundary (issue #17): every record is scoped to the client-issued
// token that created it. Requests that carry no token (e.g. curl) never touch another
// client's data — they get a fresh per-request identity, so anything they save is scoped
// to that single request and invisible to everyone else (including their own later
// no-token requests). There is deliberately no shared anonymous bucket: one would expose
// every legacy no-owner record to any request that simply omits the header.
const ANON = "request-scoped";

// Governing: SPEC-0003 § "Authentication and Authorization" — "SHALL NOT accept
// tokens that are not token-shaped, per the existing normalization rules."
// Corrected 2026-08-17 per `/sdd:audit`: this used to accept ANY non-empty
// string, so a caller sending e.g. `x-loadout-token: a` got real 201s and reads
// for the life of the process — db.js's boot-time quarantine only catches it on
// the NEXT restart, by which point every record that caller wrote is `legacy:
// true` and permanently unreachable through the API by any token, including the
// one that created it. A shape-invalid header is now treated exactly like a
// missing one: minted a fresh per-request anonymous identity, the same
// unreachable-by-construction scope a no-token request already gets, which the
// existing request-scoped TTL sweep in db.js already reclaims. This is not a
// new rejection path (no new 400s) — it is the ALREADY-EXISTING no-token
// fallback, now also reached by a malformed token instead of only an absent one.
export function callerToken(req) {
  const token = req.get("x-loadout-token") || "";
  const trimmed = typeof token === "string" ? token.trim().slice(0, 200) : "";
  if (trimmed && TOKEN_SHAPED_OWNER.test(trimmed)) return trimmed;
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
// Two stacked limiters on writes:
//   - ipLimiter: a hard per-IP floor so rotating the client-controlled token can't
//     bypass rate limiting entirely.
//   - tokenLimiter: per-client-token fairness so users sharing a NAT don't collectively
//     trip the IP floor; anonymous (no-token) requests key by IP.
// And one on reads (issue #198):
//   - readLimiter: a far looser per-IP ceiling on the collection GETs. Reads mutate
//     nothing, but each one calls db.read(), which re-parses the WHOLE data file — so an
//     unlimited read path is an unlimited amount of parsing per second, and it gets more
//     expensive as the file grows. Bounding the parse cost is the point; bounding the
//     user is not, which is why the budget is deliberately generous rather than reusing
//     the write floor.
// ---------------------------------------------------------------------------

// Exported so the trust-proxy regression test in index.test.js can exhaust the IP budget
// exactly rather than restating the number — the assertion is "these requests shared a
// bucket", and a hardcoded copy would start testing a stale constant the day this changes.
export const WRITE_PER_IP = 240; // generous hard floor (4x the per-token budget)
const WRITE_PER_TOKEN = 60;
// 10/second sustained from one address. The app issues four collection reads on boot and
// then reads on demand, so a person hammering reload never approaches this; it exists to
// stop an unattended loop from spending the event loop on JSON.parse.
const READ_PER_IP = 600;

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

// Per-IP only, and deliberately not stacked with a per-token limiter: a read costs the same
// full-file parse whoever asks for it, so the thing worth bounding is requests per source,
// not fairness between tokens sharing one.
export const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: READ_PER_IP,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: ipKey,
});
