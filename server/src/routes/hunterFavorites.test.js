import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { hunterFavoritesRouter } from "./hunterFavorites.js";
import { isKnownHunterId, rosterSize } from "../lib/hunterRoster.js";
import { db } from "../db.js";

// Governing: ADR-0006, ADR-0007, SPEC-0003 REQ "Favorite Hunters", REQ "Cross-Collection
// Ownership Enforcement", REQ "Error Handling Standards", REQ "Database Operation Standards"
//
// Runs against a throwaway data file (OUTFITTER_DB_FILE, set by the `test` script) rather
// than a developer's real data — see the fix in PR #95.

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/hunter-favorites", hunterFavoritesRouter);
  return app;
}

const TOKEN_A = "11111111-1111-4111-8111-111111111111";
const TOKEN_B = "22222222-2222-4222-8222-222222222222";

// Real roster ids, so the dataset validation this endpoint performs is exercised rather
// than mocked away. `the-rat` is the spec's own worked example throughout SPEC-0003.
const RAT = "the-rat";
const REAPER = "the-reaper";

const fav = (app, token, hunterId) =>
  request(app).put(`/api/hunter-favorites/${hunterId}`).set("x-loadout-token", token);
const unfav = (app, token, hunterId) =>
  request(app).delete(`/api/hunter-favorites/${hunterId}`).set("x-loadout-token", token);
const list = (app, token) =>
  request(app).get("/api/hunter-favorites").set("x-loadout-token", token);

describe("hunter favorites API", () => {
  beforeEach(async () => {
    await db.read();
  });
  afterEach(async () => {
    await db.read();
    // Favorites carry no name to prefix, so the fixture tokens are the cleanup key.
    db.data.hunterFavorites = db.data.hunterFavorites.filter(
      (f) => f.owner !== TOKEN_A && f.owner !== TOKEN_B
    );
    await db.write();
  });

  // --- the roster the validator reads ----------------------------------------------

  it("validates against the generated roster, which the server actually loaded", () => {
    // Guards the cross-workspace read in lib/hunterRoster.js: if hunters.json moved or
    // failed to parse, the set would be empty and EVERY favorite would 400 — a failure
    // that is otherwise indistinguishable from "the test picked a bad id".
    expect(rosterSize()).toBeGreaterThan(200);
    expect(isKnownHunterId(RAT)).toBe(true);
    expect(isKnownHunterId(REAPER)).toBe(true);
    expect(isKnownHunterId("not-a-hunter")).toBe(false);
  });

  // --- REQ "Favorite Hunters": persistence and idempotency --------------------------

  it("starts a fresh token with no favorites, and never pre-populates", async () => {
    const app = makeApp();
    const res = await list(app, TOKEN_A);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("persists a favorite so it survives a reload", async () => {
    const app = makeApp();
    const created = await fav(app, TOKEN_A, RAT);
    expect(created.status).toBe(201);
    expect(created.body.hunterId).toBe(RAT);

    // A second, independent GET is what a reload looks like from the server's side.
    const refetched = await list(app, TOKEN_A);
    expect(refetched.body.map((f) => f.hunterId)).toContain(RAT);
  });

  it("is idempotent: favoriting twice leaves exactly one favorite", async () => {
    const app = makeApp();
    const first = await fav(app, TOKEN_A, RAT);
    const second = await fav(app, TOKEN_A, RAT);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const mine = (await list(app, TOKEN_A)).body.filter((f) => f.hunterId === RAT);
    expect(mine).toHaveLength(1);
  });

  it("is idempotent: unfavoriting something never favorited is not an error", async () => {
    const app = makeApp();
    const res = await unfav(app, TOKEN_A, REAPER);
    expect(res.status).toBe(204);
    expect((await list(app, TOKEN_A)).body).toEqual([]);
  });

  it("unfavorites, and unfavoriting again stays a no-op", async () => {
    const app = makeApp();
    await fav(app, TOKEN_A, RAT);
    expect((await unfav(app, TOKEN_A, RAT)).status).toBe(204);
    expect((await unfav(app, TOKEN_A, RAT)).status).toBe(204);
    expect((await list(app, TOKEN_A)).body.map((f) => f.hunterId)).not.toContain(RAT);
  });

  it("favoriting one hunter does not disturb another", async () => {
    const app = makeApp();
    await fav(app, TOKEN_A, RAT);
    await fav(app, TOKEN_A, REAPER);
    await unfav(app, TOKEN_A, RAT);

    const ids = (await list(app, TOKEN_A)).body.map((f) => f.hunterId);
    expect(ids).toContain(REAPER);
    expect(ids).not.toContain(RAT);
  });

  // --- REQ "Cross-Collection Ownership Enforcement" ---------------------------------

  it("never returns another token's favorites", async () => {
    const app = makeApp();
    await fav(app, TOKEN_A, RAT);

    const asB = await list(app, TOKEN_B);
    expect(asB.body.some((f) => f.hunterId === RAT)).toBe(false);
    expect(asB.body).toEqual([]);
  });

  it("does not let token B unfavorite token A's favorite", async () => {
    const app = makeApp();
    const created = await fav(app, TOKEN_A, RAT);

    // A no-op for B, and deliberately indistinguishable from unfavoriting anything else
    // B has not favorited — the response discloses nothing about A.
    const res = await unfav(app, TOKEN_B, RAT);
    expect(res.status).toBe(204);

    await db.read();
    expect(db.data.hunterFavorites.some((f) => f.id === created.body.id)).toBe(true);
    expect((await list(app, TOKEN_A)).body.map((f) => f.hunterId)).toContain(RAT);
  });

  it("keeps two tokens' favorites of the same hunter as separate records", async () => {
    const app = makeApp();
    const a = await fav(app, TOKEN_A, RAT);
    const b = await fav(app, TOKEN_B, RAT);

    expect(b.status).toBe(201);
    expect(b.body.id).not.toBe(a.body.id);
    expect((await list(app, TOKEN_A)).body).toHaveLength(1);
    expect((await list(app, TOKEN_B)).body).toHaveLength(1);
  });

  it("scopes a request carrying no token to that request alone", async () => {
    const app = makeApp();
    await request(app).put(`/api/hunter-favorites/${RAT}`).expect(201);

    // No header, so no durable scope: a later no-token request sees nothing.
    const later = await request(app).get("/api/hunter-favorites");
    expect(later.body).toEqual([]);

    await db.read();
    db.data.hunterFavorites = db.data.hunterFavorites.filter(
      (f) => !String(f.owner || "").startsWith("request-scoped:")
    );
    await db.write();
  });

  // --- Output encoding --------------------------------------------------------------

  it("never discloses `owner` in any response", async () => {
    const app = makeApp();
    const created = await fav(app, TOKEN_A, RAT);
    const repeated = await fav(app, TOKEN_A, RAT);
    const fetched = await list(app, TOKEN_A);

    expect(created.body).not.toHaveProperty("owner");
    expect(repeated.body).not.toHaveProperty("owner");
    for (const record of fetched.body) expect(record).not.toHaveProperty("owner");
    expect(JSON.stringify(fetched.body)).not.toContain(TOKEN_A);
  });

  // --- Input validation -------------------------------------------------------------

  it("rejects a hunter id absent from the dataset", async () => {
    const app = makeApp();
    const res = await fav(app, TOKEN_A, "no-such-hunter");
    expect(res.status).toBe(400);

    await db.read();
    expect(db.data.hunterFavorites.some((f) => f.hunterId === "no-such-hunter")).toBe(false);
  });

  it("rejects an over-long hunter id without storing it", async () => {
    const app = makeApp();
    const res = await fav(app, TOKEN_A, "x".repeat(500));
    expect(res.status).toBe(400);

    await db.read();
    expect(db.data.hunterFavorites.filter((f) => f.owner === TOKEN_A)).toHaveLength(0);
  });

  it("applies the same validation to unfavoriting", async () => {
    const app = makeApp();
    expect((await unfav(app, TOKEN_A, "no-such-hunter")).status).toBe(400);
  });
});
