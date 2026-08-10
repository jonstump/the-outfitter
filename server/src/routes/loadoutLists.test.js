import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { loadoutListsRouter, ACCENT_PALETTE, nextAccent, resolveOwnedList } from "./loadoutLists.js";
import { RecordNotFoundError, RecordNotOwnedError } from "../lib/ownership.js";
import { db } from "../db.js";

// Governing: ADR-0006, SPEC-0003 REQ "List Identity Is User-Owned and Independent of
// Portrait", REQ "Cross-Collection Ownership Enforcement", REQ "An Empty List Is a Valid
// Persisted State", REQ "Error Handling Standards", REQ "Database Operation Standards"
//
// Runs against a throwaway data file (OUTFITTER_DB_FILE, set by the `test` script) rather
// than a developer's real data — see the fix in PR #95.

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/loadout-lists", loadoutListsRouter);
  return app;
}

const TOKEN_A = "11111111-1111-4111-8111-111111111111";
const TOKEN_B = "22222222-2222-4222-8222-222222222222";

const post = (app, token, body) =>
  request(app).post("/api/loadout-lists").set("x-loadout-token", token).send(body);
const get = (app, token) => request(app).get("/api/loadout-lists").set("x-loadout-token", token);

describe("loadout lists API", () => {
  beforeEach(async () => {
    await db.read();
  });
  afterEach(async () => {
    await db.read();
    db.data.loadoutLists = db.data.loadoutLists.filter((l) => !l.name.startsWith("__test__"));
    db.data.loadouts = db.data.loadouts.filter((l) => !l.name.startsWith("__test__"));
    await db.write();
  });

  // --- REQ "List Identity Is User-Owned and Independent of Portrait" ---------------

  it("gives each list a UUID unrelated to its hunter, and lets many lists share a hunter", async () => {
    const app = makeApp();
    const a = await post(app, TOKEN_A, { name: "__test__rat-long", hunterId: "the-rat" });
    const b = await post(app, TOKEN_A, { name: "__test__rat-shotgun", hunterId: "the-rat" });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
    expect(a.body.id).not.toBe("the-rat");
    expect(a.body.hunterId).toBe("the-rat");
    expect(b.body.hunterId).toBe("the-rat");

    const list = await get(app, TOKEN_A);
    const mine = list.body.filter((l) => l.name.startsWith("__test__"));
    expect(mine).toHaveLength(2);
  });

  it("creates a list with no hunter", async () => {
    const app = makeApp();
    const res = await post(app, TOKEN_A, { name: "__test__shotgun-experiments" });
    expect(res.status).toBe(201);
    expect(res.body.hunterId).toBeNull();
  });

  it("allows more lists than there are palette entries, with no error about availability", async () => {
    const app = makeApp();
    for (let i = 0; i < ACCENT_PALETTE.length + 2; i++) {
      const res = await post(app, TOKEN_A, { name: `__test__overflow${i}` });
      expect(res.status).toBe(201);
    }
    const mine = (await get(app, TOKEN_A)).body.filter((l) => l.name.startsWith("__test__overflow"));
    expect(mine).toHaveLength(ACCENT_PALETTE.length + 2);
  });

  it("keeps the UUID stable across a rename", async () => {
    const app = makeApp();
    const created = await post(app, TOKEN_A, { name: "__test__before" });
    const renamed = await request(app)
      .patch(`/api/loadout-lists/${created.body.id}`)
      .set("x-loadout-token", TOKEN_A)
      .send({ name: "__test__after" });

    expect(renamed.status).toBe(200);
    expect(renamed.body.id).toBe(created.body.id);
    expect(renamed.body.name).toBe("__test__after");
  });

  it("assigns accents least-used-first and permits duplicates", () => {
    expect(nextAccent([])).toBe(ACCENT_PALETTE[0]);
    expect(nextAccent([{ accent: ACCENT_PALETTE[0] }])).toBe(ACCENT_PALETTE[1]);
    // Once every value is used once, it wraps to the first again — duplicates allowed.
    const oneEach = ACCENT_PALETTE.map((accent) => ({ accent }));
    expect(nextAccent(oneEach)).toBe(ACCENT_PALETTE[0]);
  });

  // --- REQ "An Empty List Is a Valid Persisted State" ------------------------------

  it("persists a list that holds no loadouts", async () => {
    const app = makeApp();
    const created = await post(app, TOKEN_A, { name: "__test__empty" });
    expect(created.status).toBe(201);

    await db.read(); // simulate a fresh process reading from disk
    const refetched = await get(app, TOKEN_A);
    expect(refetched.body.map((l) => l.id)).toContain(created.body.id);
  });

  // --- REQ "Cross-Collection Ownership Enforcement" --------------------------------

  it("never returns another token's lists", async () => {
    const app = makeApp();
    await post(app, TOKEN_A, { name: "__test__owned-by-a" });

    const asB = await get(app, TOKEN_B);
    expect(asB.body.some((l) => l.name === "__test__owned-by-a")).toBe(false);
  });

  it("refuses to rename another token's list", async () => {
    const app = makeApp();
    const created = await post(app, TOKEN_A, { name: "__test__a-list" });

    const res = await request(app)
      .patch(`/api/loadout-lists/${created.body.id}`)
      .set("x-loadout-token", TOKEN_B)
      .send({ name: "__test__hijacked" });

    expect(res.status).toBe(404);
    await db.read();
    expect(db.data.loadoutLists.find((l) => l.id === created.body.id).name).toBe("__test__a-list");
  });

  it("refuses to retire another token's list", async () => {
    const app = makeApp();
    const created = await post(app, TOKEN_A, { name: "__test__a-keeps-this" });

    const res = await request(app)
      .delete(`/api/loadout-lists/${created.body.id}`)
      .set("x-loadout-token", TOKEN_B);

    expect(res.status).toBe(404);
    await db.read();
    expect(db.data.loadoutLists.some((l) => l.id === created.body.id)).toBe(true);
  });

  it("returns 404 rather than 403 for another token's list, so ids cannot be enumerated", async () => {
    const app = makeApp();
    const created = await post(app, TOKEN_A, { name: "__test__oracle-check" });

    const foreign = await request(app)
      .patch(`/api/loadout-lists/${created.body.id}`)
      .set("x-loadout-token", TOKEN_B)
      .send({ name: "__test__x" });
    const absent = await request(app)
      .patch("/api/loadout-lists/00000000-0000-4000-8000-000000000000")
      .set("x-loadout-token", TOKEN_B)
      .send({ name: "__test__x" });

    // Identical responses: an attacker cannot tell "exists but not yours" from "no such list".
    expect(foreign.status).toBe(absent.status);
    expect(foreign.body).toEqual(absent.body);
  });

  it("distinguishes not-found from not-owned internally via sentinel errors", () => {
    const lists = [{ id: "abc", owner: TOKEN_A, name: "x" }];
    expect(() => resolveOwnedList(lists, "nope", TOKEN_A)).toThrow(RecordNotFoundError);
    expect(() => resolveOwnedList(lists, "abc", TOKEN_B)).toThrow(RecordNotOwnedError);
    expect(resolveOwnedList(lists, "abc", TOKEN_A).id).toBe("abc");
  });

  it("creates no durable list for a request carrying no token", async () => {
    const app = makeApp();
    const created = await request(app).post("/api/loadout-lists").send({ name: "__test__anon" });
    expect(created.status).toBe(201);

    // A later no-token request gets a fresh request-scoped identity and cannot see it.
    const later = await request(app).get("/api/loadout-lists");
    expect(later.body.some((l) => l.name === "__test__anon")).toBe(false);
  });

  it("never leaks the owner field", async () => {
    const app = makeApp();
    const created = await post(app, TOKEN_A, { name: "__test__no-owner-leak" });
    expect(created.body).not.toHaveProperty("owner");

    const listed = await get(app, TOKEN_A);
    for (const l of listed.body) expect(l).not.toHaveProperty("owner");
  });

  // --- REQ "Database Operation Standards" -----------------------------------------

  it("retires a list without deleting any loadout, in one write", async () => {
    const app = makeApp();
    const created = await post(app, TOKEN_A, { name: "__test__to-retire" });

    await db.read();
    db.data.loadouts.push(
      { id: "l1", owner: TOKEN_A, name: "__test__filed-1", data: {}, listId: created.body.id, updatedAt: "x" },
      { id: "l2", owner: TOKEN_A, name: "__test__filed-2", data: {}, listId: created.body.id, updatedAt: "x" }
    );
    await db.write();
    const before = db.data.loadouts.length;

    const res = await request(app)
      .delete(`/api/loadout-lists/${created.body.id}`)
      .set("x-loadout-token", TOKEN_A);
    expect(res.status).toBe(204);

    await db.read();
    expect(db.data.loadouts).toHaveLength(before); // no cascade — count is identical
    expect(db.data.loadoutLists.some((l) => l.id === created.body.id)).toBe(false);
    for (const l of db.data.loadouts.filter((x) => x.name.startsWith("__test__filed"))) {
      expect(l.listId).toBeNull(); // dropped into Unassigned
    }
  });

  it("leaves no loadout referencing a deleted list", async () => {
    const app = makeApp();
    const created = await post(app, TOKEN_A, { name: "__test__dangle-check" });

    await db.read();
    db.data.loadouts.push({
      id: "d1", owner: TOKEN_A, name: "__test__dangler", data: {}, listId: created.body.id, updatedAt: "x",
    });
    await db.write();

    await request(app).delete(`/api/loadout-lists/${created.body.id}`).set("x-loadout-token", TOKEN_A);

    await db.read();
    const listIds = new Set(db.data.loadoutLists.map((l) => l.id));
    for (const l of db.data.loadouts) {
      if (l.listId != null) expect(listIds.has(l.listId)).toBe(true);
    }
  });

  // --- Validation ------------------------------------------------------------------

  it("rejects malformed input", async () => {
    const app = makeApp();
    expect((await post(app, TOKEN_A, { name: "" })).status).toBe(400);
    expect((await post(app, TOKEN_A, { name: "x".repeat(201) })).status).toBe(400);
    expect((await post(app, TOKEN_A, { name: "__test__bad-hunter", hunterId: "x".repeat(101) })).status).toBe(400);
    expect((await post(app, TOKEN_A, { name: "__test__bad-accent", accent: "#ffffff" })).status).toBe(400);
  });
});
