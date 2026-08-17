import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { loadoutsRouter } from "./loadouts.js";
import { loadoutListsRouter } from "./loadoutLists.js";
import { db } from "../db.js";

// Governing: SPEC-0003 REQ "Loadouts Within a List Have a User-Chosen Order", REQ "A
// Loadout Moved Between Lists Lands at the End", design.md "Loadouts within a list have a
// user-set order, stored server-side".

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/loadouts", loadoutsRouter);
  app.use("/api/loadout-lists", loadoutListsRouter);
  return app;
}

const TOKEN_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TOKEN_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const validData = { w: [[0, -1], null], e: [["T", 0]], tr: [0], n: "fixture", b: 0 };

const mkList = (app, token, name) =>
  request(app).post("/api/loadout-lists").set("x-loadout-token", token).send({ name });
const save = (app, token, body) =>
  request(app).post("/api/loadouts").set("x-loadout-token", token).send(body);
const move = (app, token, id, listId) =>
  request(app).patch(`/api/loadouts/${id}`).set("x-loadout-token", token).send({ listId });
const reorder = (app, token, listId, order) =>
  request(app).patch("/api/loadouts/reorder").set("x-loadout-token", token).send({ listId, order });

describe("reordering loadouts within a list", () => {
  beforeEach(async () => {
    await db.read();
  });
  afterEach(async () => {
    await db.read();
    db.data.loadouts = db.data.loadouts.filter((l) => !l.name.startsWith("__test__"));
    db.data.loadoutLists = db.data.loadoutLists.filter((l) => !l.name.startsWith("__test__"));
    await db.write();
  });

  it("a fresh reorder is reflected on the next read", async () => {
    const app = makeApp();
    const a = await save(app, TOKEN_A, { name: "__test__r-a", data: validData });
    const b = await save(app, TOKEN_A, { name: "__test__r-b", data: validData });
    const c = await save(app, TOKEN_A, { name: "__test__r-c", data: validData });

    const res = await reorder(app, TOKEN_A, null, [c.body.id, a.body.id, b.body.id]);
    expect(res.status).toBe(200);
    expect(res.body.map((l) => l.id)).toEqual([c.body.id, a.body.id, b.body.id]);

    const listed = await request(app).get("/api/loadouts").set("x-loadout-token", TOKEN_A);
    const byId = Object.fromEntries(listed.body.map((l) => [l.id, l.order]));
    expect(byId[c.body.id]).toBeLessThan(byId[a.body.id]);
    expect(byId[a.body.id]).toBeLessThan(byId[b.body.id]);
  });

  it("a record predating this requirement sorts by its storage position, with no write from a mere read", async () => {
    const app = makeApp();
    await db.read();
    db.data.loadouts.push(
      { id: "legacy-order-1", owner: TOKEN_A, name: "__test__legacy-1", data: validData, updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "legacy-order-2", owner: TOKEN_A, name: "__test__legacy-2", data: validData, updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    await db.write();

    const listed = await request(app).get("/api/loadouts").set("x-loadout-token", TOKEN_A);
    const first = listed.body.find((l) => l.id === "legacy-order-1");
    const second = listed.body.find((l) => l.id === "legacy-order-2");
    expect(first.order).toBeLessThan(second.order);

    // No migration write: the stored record still carries no `order` key.
    await db.read();
    expect(db.data.loadouts.find((l) => l.id === "legacy-order-1")).not.toHaveProperty("order");
  });

  it("rejects a partial order that drops a loadout from the scope", async () => {
    const app = makeApp();
    const a = await save(app, TOKEN_A, { name: "__test__p-a", data: validData });
    const b = await save(app, TOKEN_A, { name: "__test__p-b", data: validData });
    const bOrderBefore = b.body.order;

    const res = await reorder(app, TOKEN_A, null, [a.body.id]);
    expect(res.status).toBe(400);

    // Nothing was written — b keeps exactly the order creation gave it.
    await db.read();
    expect(db.data.loadouts.find((l) => l.id === b.body.id).order).toBe(bOrderBefore);
  });

  it("rejects an order naming a loadout filed elsewhere", async () => {
    const app = makeApp();
    const list = await mkList(app, TOKEN_A, "__test__scope-list");
    const inList = await save(app, TOKEN_A, { name: "__test__in-list", data: validData, listId: list.body.id });
    const unassigned = await save(app, TOKEN_A, { name: "__test__unassigned-one", data: validData });

    const res = await reorder(app, TOKEN_A, null, [unassigned.body.id, inList.body.id]);
    expect(res.status).toBe(400);
  });

  it("rejects an order naming a foreign or nonexistent id", async () => {
    const app = makeApp();
    const a = await save(app, TOKEN_A, { name: "__test__f-a", data: validData });

    const res = await reorder(app, TOKEN_A, null, [a.body.id, "00000000-0000-4000-8000-000000000000"]);
    expect(res.status).toBe(400);
  });

  it("rejects duplicate ids in the order array", async () => {
    const app = makeApp();
    const a = await save(app, TOKEN_A, { name: "__test__d-a", data: validData });

    const res = await reorder(app, TOKEN_A, null, [a.body.id, a.body.id]);
    expect(res.status).toBe(400);
  });

  it("rejects another token's loadout id, even alongside the caller's own", async () => {
    const app = makeApp();
    const mine = await save(app, TOKEN_A, { name: "__test__mine", data: validData });
    const theirs = await save(app, TOKEN_B, { name: "__test__theirs", data: validData });
    // Creation itself now assigns an order (SPEC-0003 "A Loadout Moved Between Lists Lands
    // at the End" applies the same computation to creation as to a move) — the assertion
    // below is that the REJECTED reorder left it exactly as creation set it, not that it
    // has no order at all.
    const orderBefore = theirs.body.order;

    const res = await reorder(app, TOKEN_A, null, [mine.body.id, theirs.body.id]);
    expect(res.status).toBe(400);

    // Confirm the other token's record is untouched.
    await db.read();
    expect(db.data.loadouts.find((l) => l.id === theirs.body.id).order).toBe(orderBefore);
  });

  it("rejects a listId the caller does not own", async () => {
    const app = makeApp();
    const foreignList = await mkList(app, TOKEN_B, "__test__foreign-list");
    const a = await save(app, TOKEN_A, { name: "__test__owns-a", data: validData });

    const res = await reorder(app, TOKEN_A, foreignList.body.id, [a.body.id]);
    expect(res.status).toBe(404);
  });

  it("scopes strictly by list — reordering Unassigned never touches a list's own order", async () => {
    const app = makeApp();
    const list = await mkList(app, TOKEN_A, "__test__untouched-list");
    const inList = await save(app, TOKEN_A, { name: "__test__stays-put", data: validData, listId: list.body.id });
    const x = await save(app, TOKEN_A, { name: "__test__x", data: validData });
    const y = await save(app, TOKEN_A, { name: "__test__y", data: validData });

    await reorder(app, TOKEN_A, null, [y.body.id, x.body.id]);

    await db.read();
    expect(db.data.loadouts.find((l) => l.id === inList.body.id).listId).toBe(list.body.id);
  });

  // --- REQ "A Loadout Moved Between Lists Lands at the End" -------------------------

  it("a loadout moved into a list lands after every loadout already there", async () => {
    const app = makeApp();
    const dest = await mkList(app, TOKEN_A, "__test__dest");
    const a = await save(app, TOKEN_A, { name: "__test__dest-a", data: validData, listId: dest.body.id });
    const b = await save(app, TOKEN_A, { name: "__test__dest-b", data: validData, listId: dest.body.id });
    // Establish an explicit, non-default order for a and b so the mover's landing spot is
    // pinned against real stored values, not just the array-position fallback.
    await reorder(app, TOKEN_A, dest.body.id, [b.body.id, a.body.id]);

    const mover = await save(app, TOKEN_A, { name: "__test__mover-in", data: validData });
    const moved = await move(app, TOKEN_A, mover.body.id, dest.body.id);
    expect(moved.status).toBe(200);

    const listed = await request(app).get("/api/loadouts").set("x-loadout-token", TOKEN_A);
    const byId = Object.fromEntries(listed.body.map((l) => [l.id, l.order]));
    expect(byId[mover.body.id]).toBeGreaterThan(byId[b.body.id]);
    expect(byId[mover.body.id]).toBeGreaterThan(byId[a.body.id]);
  });

  it("a stale order value from the OLD list does not accidentally win a position in the new one", async () => {
    const app = makeApp();
    const from = await mkList(app, TOKEN_A, "__test__from-list");
    const to = await mkList(app, TOKEN_A, "__test__to-list");
    // Mover is first (order 0) in its origin list.
    const mover = await save(app, TOKEN_A, { name: "__test__stale-order", data: validData, listId: from.body.id });
    const sibling = await save(app, TOKEN_A, { name: "__test__from-sibling", data: validData, listId: from.body.id });
    await reorder(app, TOKEN_A, from.body.id, [mover.body.id, sibling.body.id]); // mover.order = 0

    // Destination already holds several loadouts with higher orders.
    const d1 = await save(app, TOKEN_A, { name: "__test__to-1", data: validData, listId: to.body.id });
    const d2 = await save(app, TOKEN_A, { name: "__test__to-2", data: validData, listId: to.body.id });
    await reorder(app, TOKEN_A, to.body.id, [d1.body.id, d2.body.id]); // orders 0, 1

    await move(app, TOKEN_A, mover.body.id, to.body.id);

    const listed = await request(app).get("/api/loadouts").set("x-loadout-token", TOKEN_A);
    const byId = Object.fromEntries(listed.body.map((l) => [l.id, l.order]));
    // If the stale order (0) had survived the move, the mover would render FIRST in its
    // new list — the defect this write path exists to prevent.
    expect(byId[mover.body.id]).toBeGreaterThan(byId[d1.body.id]);
    expect(byId[mover.body.id]).toBeGreaterThan(byId[d2.body.id]);
  });

  it("moving into an empty list lands at order 0", async () => {
    const app = makeApp();
    const empty = await mkList(app, TOKEN_A, "__test__empty-dest");
    const mover = await save(app, TOKEN_A, { name: "__test__into-empty", data: validData });

    const moved = await move(app, TOKEN_A, mover.body.id, empty.body.id);
    expect(moved.status).toBe(200);
    expect(moved.body.order).toBe(0);
  });

  it("a no-op move (re-selecting the current list) does not touch order", async () => {
    const app = makeApp();
    const list = await mkList(app, TOKEN_A, "__test__noop-order");
    const a = await save(app, TOKEN_A, { name: "__test__noop-a", data: validData, listId: list.body.id });
    const b = await save(app, TOKEN_A, { name: "__test__noop-b", data: validData, listId: list.body.id });
    await reorder(app, TOKEN_A, list.body.id, [b.body.id, a.body.id]);

    const before = await request(app).get("/api/loadouts").set("x-loadout-token", TOKEN_A);
    const orderBefore = before.body.find((l) => l.id === a.body.id).order;

    const res = await move(app, TOKEN_A, a.body.id, list.body.id); // same list — a no-op
    expect(res.status).toBe(200);
    expect(res.body.order).toBe(orderBefore);
  });

  it("a description-only PATCH does not disturb order", async () => {
    const app = makeApp();
    const list = await mkList(app, TOKEN_A, "__test__desc-order");
    const a = await save(app, TOKEN_A, { name: "__test__desc-a", data: validData, listId: list.body.id });
    const b = await save(app, TOKEN_A, { name: "__test__desc-b", data: validData, listId: list.body.id });
    await reorder(app, TOKEN_A, list.body.id, [b.body.id, a.body.id]);

    const res = await request(app)
      .patch(`/api/loadouts/${a.body.id}`)
      .set("x-loadout-token", TOKEN_A)
      .send({ description: "a note" });
    expect(res.status).toBe(200);

    const listed = await request(app).get("/api/loadouts").set("x-loadout-token", TOKEN_A);
    const byId = Object.fromEntries(listed.body.map((l) => [l.id, l.order]));
    // b was ordered first, a second — unchanged by a's description write.
    expect(byId[b.body.id]).toBeLessThan(byId[a.body.id]);
  });

  // --- Regression: a brand-new record must not out-rank older, explicitly-ordered
  // survivors of a scope that was reordered and then shrunk -----------------------

  // Both regression tests below use their OWN dedicated tokens rather than the shared
  // TOKEN_A every other test in this file reuses — each pushes ~10 writes through one
  // token, and TOKEN_A already carries the accumulated write count of every test above it
  // (`WRITE_PER_TOKEN` in lib/ownership.js is a real per-minute ceiling, and this file's
  // TOKEN_A traffic sits close enough to it that adding these two tipped it over — caught
  // by these very tests intermittently failing with an empty body rather than a real
  // assertion failure, before they were given their own tokens).
  const SHRINK_TOKEN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const FRESH_TOKEN = "ffffffff-ffff-4fff-8fff-ffffffffffff";

  it("a loadout created after a reorder lands AFTER older survivors, even once the scope has shrunk", async () => {
    const app = makeApp();
    const a = await save(app, SHRINK_TOKEN, { name: "__test__shrink-a", data: validData });
    const b = await save(app, SHRINK_TOKEN, { name: "__test__shrink-b", data: validData });
    const c = await save(app, SHRINK_TOKEN, { name: "__test__shrink-c", data: validData });
    const d = await save(app, SHRINK_TOKEN, { name: "__test__shrink-d", data: validData });
    const e = await save(app, SHRINK_TOKEN, { name: "__test__shrink-e", data: validData });
    // A full reorder assigns explicit, contiguous orders 0..4 to all five.
    await reorder(app, SHRINK_TOKEN, null, [a.body.id, b.body.id, c.body.id, d.body.id, e.body.id]);

    // Delete the three EARLIEST-ordered members. D (order 3) and E (order 4) survive,
    // now the only two loadouts in the scope — their stored orders are larger than the
    // shrunk scope's new size.
    await Promise.all(
      [a, b, c].map((rec) =>
        request(app).delete(`/api/loadouts/${rec.body.id}`).set("x-loadout-token", SHRINK_TOKEN)
      )
    );

    // A brand-new loadout, saved the ordinary way (no reorder call), must not fall back
    // to a raw array-position index (which would be 0, 1, or 2 among the two survivors —
    // LESS than D's and E's real stored values of 3 and 4) — it must land after both.
    const f = await save(app, SHRINK_TOKEN, { name: "__test__shrink-f", data: validData });
    expect(f.body).toHaveProperty("order");

    const listed = await request(app).get("/api/loadouts").set("x-loadout-token", SHRINK_TOKEN);
    const byId = Object.fromEntries(listed.body.map((l) => [l.id, l.order]));
    expect(byId[f.body.id]).toBeGreaterThan(byId[d.body.id]);
    expect(byId[f.body.id]).toBeGreaterThan(byId[e.body.id]);
  });

  it("creating into an untouched (never-reordered) list still costs no write — order is assigned, not left to drift", async () => {
    // Companion to the regression above: confirm the fix didn't just move the bug rather
    // than close it. A creation into a scope that has NEVER been reordered gets an
    // explicit order of 0 for the first member, ascending from there — never negative,
    // never colliding with a sibling created moments before.
    const app = makeApp();
    const a = await save(app, FRESH_TOKEN, { name: "__test__fresh-a", data: validData });
    const b = await save(app, FRESH_TOKEN, { name: "__test__fresh-b", data: validData });
    expect(a.body.order).toBe(0);
    expect(b.body.order).toBe(1);
  });
});
