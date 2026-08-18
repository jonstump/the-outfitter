import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { callerToken } from "./ownership.js";
import { TOKEN_SHAPED_OWNER } from "./tokenShape.js";

// Governing: SPEC-0003 § "Authentication and Authorization" — "The system SHALL
// generate tokens with sufficient entropy that they are not guessable, and SHALL
// NOT accept tokens that are not token-shaped, per the existing normalization
// rules." Corrected 2026-08-17 per `/sdd:audit`: `callerToken` used to accept any
// non-empty string as a stable identity, which db.js's boot-time quarantine would
// later re-classify as `legacy: true` — orphaning every record the caller wrote
// in between. No prior test file existed for this module.
//
// `callerToken` only calls `req.get(...)`, so a minimal fake stands in for the
// real Express request — no supertest/express app needed for this unit.
function fakeReq(headerValue) {
  return { get: (name) => (name === "x-loadout-token" ? headerValue : undefined) };
}

describe("callerToken", () => {
  it("accepts a UUID-shaped token verbatim", () => {
    const uuid = randomUUID();
    expect(callerToken(fakeReq(uuid))).toBe(uuid);
  });

  it("accepts a client-fallback t- token verbatim", () => {
    const token = "t-abcdefghij1234567890";
    expect(callerToken(fakeReq(token))).toBe(token);
  });

  it("accepts the uppercase T- variant", () => {
    const token = "T-abcdefghij1234567890";
    expect(callerToken(fakeReq(token))).toBe(token);
  });

  it("trims surrounding whitespace before checking shape", () => {
    const uuid = randomUUID();
    expect(callerToken(fakeReq(`  ${uuid}  `))).toBe(uuid);
  });

  it("mints a fresh per-request anonymous identity for a missing header", () => {
    const token = callerToken(fakeReq(undefined));
    expect(token).toMatch(/^request-scoped:/);
  });

  it("mints a fresh per-request anonymous identity for an empty header", () => {
    const token = callerToken(fakeReq(""));
    expect(token).toMatch(/^request-scoped:/);
  });

  // The defect this whole fix closes: a caller sending a non-token-shaped value
  // used to get it back verbatim as a stable, reusable identity.
  it("does NOT accept an arbitrary non-token-shaped string — mints anonymous instead", () => {
    const token = callerToken(fakeReq("a"));
    expect(token).not.toBe("a");
    expect(token).toMatch(/^request-scoped:/);
  });

  it("does NOT accept a forged historical sentinel ('unowned', 'anon')", () => {
    expect(callerToken(fakeReq("unowned"))).toMatch(/^request-scoped:/);
    expect(callerToken(fakeReq("anon"))).toMatch(/^request-scoped:/);
  });

  // The loose-regex bypass the audit named specifically: the old pattern anchored
  // only the START of the t-/T- alternative, so a token-shaped PREFIX followed by
  // garbage passed. Confirmed against TOKEN_SHAPED_OWNER directly (the shared
  // pattern callerToken now uses) so this pins the regex, not just callerToken's
  // wrapping of it.
  it("does NOT accept a token-shaped prefix followed by non-token-shaped trailing characters", () => {
    const bypassAttempt = "t-aaaaaaaaaaEVIL/../";
    expect(TOKEN_SHAPED_OWNER.test(bypassAttempt)).toBe(false);
    expect(callerToken(fakeReq(bypassAttempt))).toMatch(/^request-scoped:/);
  });

  it("does NOT accept a t- token shorter than the minimum length", () => {
    expect(callerToken(fakeReq("t-short"))).toMatch(/^request-scoped:/);
  });

  it("never mints a shared anonymous bucket — two malformed-token requests get different identities", () => {
    const first = callerToken(fakeReq("bogus"));
    const second = callerToken(fakeReq("bogus"));
    expect(first).not.toBe(second);
  });

  it("caps an oversized header at 200 characters before returning it", () => {
    // A UUID that's already valid, padded past 200 chars — the length cap applies
    // to the RAW header, so the truncated result is no longer token-shaped and
    // falls back to anonymous rather than returning a silently-truncated UUID.
    const oversized = randomUUID() + "x".repeat(200);
    const token = callerToken(fakeReq(oversized));
    expect(token).toMatch(/^request-scoped:/);
  });
});
