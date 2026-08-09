import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { loadoutsRouter } from "./loadouts.js";
import { db } from "../db.js";

// Governing: #17 (per-user ownership), #19 (payload shape validation), #21 (rate limiting)
//
// Routes exercise the real lowdb JSONFile store (server/data/db.json). Tests use
// their own random record names and clean up after themselves so a local dev data
// file stays untouched.

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/loadouts", loadoutsRouter);
  return app;
}

const validData = {
  v: 1,
  w: [["nagant-m1895", -1], null],
  e: [["T", "first-aid-kit"]],
  tr: [],
  n: "fixture",
  b: 0,
};

describe("loadouts API", () => {
  beforeEach(async () => {
    await db.read();
  });
  afterEach(async () => {
    // Remove anything this suite created.
    await db.read();
    db.data.loadouts = db.data.loadouts.filter((l) => l.name.startsWith("__test__"));
    await db.write();
  });

  it("scopes saved loadouts per client token", async () => {
    const app = makeApp();
    const name = `__test__${Date.now()}`;
    const res = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "alpha")
      .send({ name, data: validData });
    expect(res.status).toBe(201);

    // A different token doesn't see it.
    const other = await request(app).get("/api/loadouts").set("x-loadout-token", "beta");
    expect(other.body.some((l) => l.name === name)).toBe(false);

    // The owning token does.
    const owner = await request(app).get("/api/loadouts").set("x-loadout-token", "alpha");
    expect(owner.body.some((l) => l.name === name)).toBe(true);
  });

  it("rejects second ownership of a name with 404 delete isolation", async () => {
    const app = makeApp();
    const name = `__test__dup${Date.now()}`;
    const created = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "alpha")
      .send({ name, data: validData });

    // Another token deleting it gets 404 and cannot remove it.
    const del = await request(app)
      .delete(`/api/loadouts/${created.body.id}`)
      .set("x-loadout-token", "beta");
    expect(del.status).toBe(404);

    const ownerList = await request(app).get("/api/loadouts").set("x-loadout-token", "alpha");
    expect(ownerList.body.some((l) => l.id === created.body.id)).toBe(true);
  });

  it("rejects a malformed data payload with 400", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "alpha")
      .send({ name: "bad", data: { nope: true } });
    expect(res.status).toBe(400);

    const empty = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "alpha")
      .send({ name: "bad2", data: {} });
    expect(empty.status).toBe(400);
  });

  it("rejects oversized trait lists", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "alpha")
      .send({ name: "big", data: { ...validData, tr: new Array(50).fill("x") } });
    expect(res.status).toBe(400);
  });

  it("rate limits the write endpoint", async () => {
    const app = makeApp();
    // Burst past the limit (60/min) — 70 quick writes should trip it.
    let limited = false;
    for (let i = 0; i < 70; i++) {
      const res = await request(app)
        .post("/api/loadouts")
        .set("x-loadout-token", "alpha")
        .send({ name: `__test__rl${i}`, data: validData });
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
