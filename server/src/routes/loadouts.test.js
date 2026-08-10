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

// Real wire format as produced by client/src/utils/loadoutCodec.js on main:
// numeric catalog indices, not string ids.
const validData = {
  w: [[0, -1], null],
  e: [["T", 0], ["C", 3]],
  tr: [0],
  n: "fixture",
  b: 0,
};

describe("loadouts API", () => {
  beforeEach(async () => {
    await db.read();
  });
  afterEach(async () => {
    // Remove anything this suite created — i.e. DROP the __test__ records and KEEP
    // everything else. The predicate was inverted here, which meant every run wiped
    // the developer's real saved loadouts and retained every fixture instead. Tests
    // now run against their own data file (see server/src/db.js and the `test`
    // script), so this is a second line of defence rather than the only one.
    await db.read();
    db.data.loadouts = db.data.loadouts.filter((l) => !l.name.startsWith("__test__"));
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

  it("accepts the real numeric-index wire format the client sends", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "numeric")
      .send({ name: `__test__num${Date.now()}`, data: validData });
    expect(res.status).toBe(201);
  });

  it("accepts the stable string-id wire format (forward compat with #43)", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "ids")
      .send({
        name: `__test__ids${Date.now()}`,
        data: { w: [["nagant-m1895", -1], null], e: [["T", "first-aid-kit"]], tr: ["quartermaster"], n: "x", b: 0 },
      });
    expect(res.status).toBe(201);
  });

  it("rejects out-of-range numeric indices and malformed references", async () => {
    const app = makeApp();
    const bad = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "validation-a")
      .send({ name: "__test__oor", data: { w: [[9999, -1], null], e: [], tr: [], n: "x", b: 0 } });
    expect(bad.status).toBe(400);

    const badAmmo = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "validation-b")
      .send({ name: "__test__ammo", data: { w: [[0, "not-a-number"], null], e: [], tr: [], n: "x", b: 0 } });
    expect(badAmmo.status).toBe(400);
  });

  it("isolates anonymous (no-token) requests from each other and from tokens", async () => {
    const app = makeApp();
    const name = `__test__anon${Date.now()}`;

    // Two no-token saves must not be visible to each other (no shared anon bucket).
    const first = await request(app).post("/api/loadouts").send({ name, data: validData });
    expect(first.status).toBe(201);
    const list = await request(app).get("/api/loadouts");
    expect(list.body.some((l) => l.name === name)).toBe(false);

    // And a token-backed request can't see it either.
    const tokenList = await request(app).get("/api/loadouts").set("x-loadout-token", "some-token");
    expect(tokenList.body.some((l) => l.name === name)).toBe(false);
  });

  it("exposes no legacy (pre-token) record to any request, including forged scopes", async () => {
    const app = makeApp();
    // Simulate what the boot-time migration in db.js produces: a pre-token
    // record carrying no owner, marked `legacy: true`.
    await db.read();
    db.data.loadouts.push({ id: "legacy-1", legacy: true, name: "__test__legacy", data: validData, updatedAt: "2020-01-01" });
    await db.write();

    // No token, a real token, and forged attempts at the old "unowned"/"anon"
    // scope names — none may see the legacy record.
    const probes = [undefined, "whoever", "unowned", "anon", "request-scoped"];
    for (const tok of probes) {
      const req = request(app).get("/api/loadouts");
      if (tok) req.set("x-loadout-token", tok);
      const res = await req;
      expect(res.body.some((l) => l.name === "__test__legacy")).toBe(false);
    }

    // A forged DELETE by its id must 404 and must not remove the record.
    const del = await request(app).delete("/api/loadouts/legacy-1").set("x-loadout-token", "unowned");
    expect(del.status).toBe(404);
    await db.read();
    expect(db.data.loadouts.some((l) => l.id === "legacy-1")).toBe(true);
  });

  it("migrates records carrying the historical anon/unowned sentinels to legacy at boot", async () => {
    const { db } = await import("../db.js");
    await db.read();
    const stamp = Date.now();
    const ids = [`__test__mig-anon-${stamp}`, `__test__mig-unowned-${stamp}`];
    db.data.loadouts.push(
      { id: ids[0], owner: "anon", name: ids[0], data: validData, updatedAt: "2021-01-01" },
      { id: ids[1], owner: "unowned", name: ids[1], data: validData, updatedAt: "2021-01-01" }
    );
    await db.write();

    // Re-import the module to re-run its boot-time migration.
    const freshReload = (await import("../db.js?mig" + stamp)).db;
    await freshReload.read();

    const anon = freshReload.data.loadouts.find((l) => l.id === ids[0]);
    const unowned = freshReload.data.loadouts.find((l) => l.id === ids[1]);
    expect(anon.legacy).toBe(true);
    expect(anon.owner).toBeUndefined();
    expect(unowned.legacy).toBe(true);
    expect(unowned.owner).toBeUndefined();
  });

  it("rejects a loadout name longer than 200 characters", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "namecheck")
      .send({ name: "x".repeat(201), data: validData });
    expect(res.status).toBe(400);
  });

  it("hits the per-IP floor even when rotating the token on every write", async () => {
    // ipLimiter: 240/min per IP. Rotating the token must not bypass it. Runs
    // last because it exhausts the shared test IP's budget for the window
    // (limiters are module-level singletons shared by every makeApp()).
    const app = makeApp();
    let limited = false;
    for (let i = 0; i < 250; i++) {
      const res = await request(app)
        .post("/api/loadouts")
        .set("x-loadout-token", `rotate-${i}`)
        .send({ name: `__test__rot${i}`, data: validData });
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
