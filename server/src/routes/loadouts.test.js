import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { loadoutsRouter } from "./loadouts.js";
import { ipLimiter, readLimiter, tokenLimiter } from "../lib/ownership.js";
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

  // --- The fifteen-trait cap (ADR-0012) ----------------------------------------------
  //
  // Governing: ADR-0012 (fifteen-trait cap), SPEC-0003 REQ "A Loadout Holds At Most
  // Fifteen Traits". The wire bound was 40, which made an over-cap loadout a savable,
  // shareable record. Fifteen is the game's own per-hunter maximum.
  //
  // The client cannot import this module, so fifteen exists independently on both sides.
  // These tests are this side's pin on the figure — the client's reducer and decoder tests
  // are the other, and a change to one that is not made to the other shows up as a failure
  // here rather than as a 400 in front of a user.

  const traitIds = (n) => Array.from({ length: n }, (_, i) => `trait-${i}`);

  it("refuses a sixteenth trait and accepts exactly fifteen", async () => {
    const app = makeApp();
    const token = `traitcap-${Date.now()}`;

    const over = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", token)
      .send({ name: "__test__tr16", data: { ...validData, tr: traitIds(16) } });
    expect(over.status).toBe(400);

    // Refused, not trimmed. Truncating to fifteen and answering 201 would store something
    // the caller did not send and hide the client bug that sent sixteen — so nothing at all
    // may be persisted under the attempted name.
    await db.read();
    expect(db.data.loadouts.some((l) => l.name === "__test__tr16")).toBe(false);

    // Fifteen is the boundary itself, not one short of it: an off-by-one that bounded at
    // fourteen would still reject sixteen, so the accepting half is what pins the number.
    const at = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", token)
      .send({ name: `__test__tr15${Date.now()}`, data: { ...validData, tr: traitIds(15) } });
    expect(at.status).toBe(201);
    expect(at.body.data.tr).toHaveLength(15);
  });

  it("still serves a stored record written under the old forty-trait bound", async () => {
    // This is the property that lets the bound tighten with no migration: isValidData is
    // called from POST alone, so GET never re-validates what is already on disk. Were a
    // read to re-run the validator, every twenty-trait record saved under the old bound
    // would become unreachable through the API — data stranded by a rule that post-dates it.
    //
    // Seeded straight into the store rather than through the API, because the API is exactly
    // what now refuses it. That is the point of the test.
    const app = makeApp();
    const token = `legacy-traits-${Date.now()}`;
    const name = `__test__tr20-${Date.now()}`;

    await db.read();
    db.data.loadouts.push({
      id: randomUUID(),
      owner: token,
      name,
      data: { ...validData, tr: traitIds(20) },
      updatedAt: new Date().toISOString(),
    });
    await db.write();

    const res = await request(app).get("/api/loadouts").set("x-loadout-token", token);
    expect(res.status).toBe(200);
    const stored = res.body.find((l) => l.name === name);
    // Served verbatim — the server does not clamp on the way out. Healing is the decoder's
    // job (it keeps the first fifteen), and the next save then writes fifteen back through
    // the tightened bound above. The server's part of that contract is only to hand the
    // record over intact instead of hiding it.
    expect(stored).toBeTruthy();
    expect(stored.data.tr).toHaveLength(20);
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

  // --- The v2 wire format (SPEC-0006, ADR-0009) --------------------------------------
  //
  // Governing: SPEC-0006 REQ "Saved-Loadout Payloads Are Validated at Both Versions",
  // REQ "Error Handling at the Payload Boundary". The validator branches on `data.v`:
  // version 2 declares the fixed eight-cell sparse `e` (index = cell, null = empty) and
  // the per-cell blocked array `b`. These pin the six WHEN/THEN behaviours the story
  // required, most importantly that an out-of-range cell is REJECTED rather than
  // clamped, and that a rejection names the offending field.

  const v2Data = (overrides = {}) => ({
    v: 2,
    w: [["nagant-m1895", -1], null],
    e: [["T", "first-aid-kit"], null, null, null, null, null, null, null],
    tr: ["quartermaster"],
    n: "x",
    b: [],
    ...overrides,
  });

  it("accepts a v2 payload (sparse eight-cell e, array b)", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "v2-accept")
      .send({ name: `__test__v2${Date.now()}`, data: v2Data() });
    expect(res.status).toBe(201);
  });

  it("still accepts a v1 payload alongside v2", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "v1-alongside")
      .send({ name: `__test__v1${Date.now()}`, data: validData });
    expect(res.status).toBe(201);
  });

  it("rejects a v2 payload with unresolvable item references", async () => {
    const app = makeApp();
    // The server's numeric bounds are validation slack, not exact resolution — they
    // reject clearly out-of-range indices, while unknown string ids pass through for
    // the client codec to drop (see isValidData's contract). So the unresolvable case
    // here is the out-of-range numeric index, mirroring the v1 test above.
    const res = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "v2-unresolvable")
      .send({
        name: `__test__v2oor${Date.now()}`,
        data: v2Data({ e: [["T", 9999], null, null, null, null, null, null, null] }),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/data\.e/);
  });

  it("rejects a v2 sparse array that is not exactly eight elements", async () => {
    const app = makeApp();
    const short = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "v2-short")
      .send({ name: `__test__v2short${Date.now()}`, data: v2Data({ e: [["T", "first-aid-kit"], null] }) });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/data\.e/);

    const long = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "v2-long")
      .send({
        name: `__test__v2long${Date.now()}`,
        data: v2Data({ e: Array(9).fill(null) }),
      });
    expect(long.status).toBe(400);
    expect(long.body.error).toMatch(/data\.e/);
  });

  it("rejects an out-of-range blocked cell index rather than clamping it", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "v2-blocked-oor")
      .send({
        name: `__test__v2boor${Date.now()}`,
        data: v2Data({ b: [8] }),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/data\.b/);
    // Rejected, not stored: a clamp would have persisted a grid the caller never asked for.
    await db.read();
    expect(db.data.loadouts.some((l) => l.name.startsWith("__test__v2boor"))).toBe(false);
  });

  it("accepts a v2 payload with holes at blocked positions", async () => {
    // A v2 grid may carry holes (empty cells) at blocked indices — that is a valid
    // state, not a malformed one.
    const app = makeApp();
    const res = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "v2-holes")
      .send({
        name: `__test__v2holes${Date.now()}`,
        data: v2Data({ b: [2, 3] }),
      });
    expect(res.status).toBe(201);
  });

  it("names the offending field on a rejected save", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "v2-fieldname")
      .send({ name: `__test__v2field${Date.now()}`, data: v2Data({ tr: ["x".repeat(101)] }) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/data\.tr/);
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

  // --- Unbounded writes (issue #198) ------------------------------------------------
  //
  // isValidData() confirmed that the fields it NAMES were well-shaped and then returned
  // true, so anything else on the object rode along — and the validated object is stored
  // verbatim. Two of the named fields were bounded below and not above, which is the same
  // hole wearing the shape of a field the format does define.

  it("rejects a payload carrying a key the wire format does not define", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "unknown-keys")
      .send({ name: "__test__unknown", data: { ...validData, padding: "x".repeat(10_000) } });
    expect(res.status).toBe(400);

    // Nothing was persisted under the attempted name, and the rejection is not partial —
    // a stored record with the extra key stripped would still be a record nobody asked for.
    await db.read();
    expect(db.data.loadouts.some((l) => l.name === "__test__unknown")).toBe(false);
  });

  it("rejects the version key when it is the wrong type, and accepts the format's own envelope", async () => {
    const app = makeApp();
    // `v` is in the allowlist, so the key check must not be the only thing guarding it.
    const bad = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "version-check")
      .send({ name: "__test__ver", data: { ...validData, v: "1" } });
    expect(bad.status).toBe(400);

    const good = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "version-check")
      .send({ name: `__test__ver${Date.now()}`, data: { ...validData, v: 1 } });
    expect(good.status).toBe(201);
  });

  it("rejects tuples longer than the format defines, in either array", async () => {
    const app = makeApp();
    // `slot.length >= 2` and `entry.length >= 2` were floors with no ceiling: the reference
    // and the ammo index validated, and everything after them was stored unexamined.
    const weapon = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "tuple-w")
      .send({ name: "__test__wtuple", data: { ...validData, w: [[0, -1, "x".repeat(1000)], null] } });
    expect(weapon.status).toBe(400);

    const equip = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", "tuple-e")
      .send({ name: "__test__etuple", data: { ...validData, e: [["T", 0, "x".repeat(1000)]] } });
    expect(equip.status).toBe(400);
  });

  it("caps how many loadouts one owner can accumulate, without blocking updates", async () => {
    const app = makeApp();
    const token = `cap-${Date.now()}`;

    // Seeded directly rather than through 200 requests: the write limiters are module-level
    // singletons this suite shares, and spending 200 of the IP floor here would make the
    // limiter tests below order-dependent on this one.
    await db.read();
    const now = new Date().toISOString();
    for (let i = 0; i < 200; i++) {
      db.data.loadouts.push({
        id: `cap-${i}-${token}`,
        owner: token,
        name: `__test__cap${i}`,
        data: validData,
        updatedAt: now,
      });
    }
    await db.write();

    const created = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", token)
      .send({ name: "__test__cap-one-more", data: validData });
    expect(created.status).toBe(409);

    // The cap bounds the COLLECTION, not the owner's ability to edit it: re-saving under a
    // name they already hold is an update, and refusing that would strand them at the
    // ceiling with no way to change anything they had.
    const updated = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", token)
      .send({ name: "__test__cap0", data: { ...validData, n: "edited" } });
    expect(updated.status).toBe(200);

    // And it is per owner, not global — a different token is unaffected.
    const other = await request(app)
      .post("/api/loadouts")
      .set("x-loadout-token", `${token}-other`)
      .send({ name: `__test__cap-other${Date.now()}`, data: validData });
    expect(other.status).toBe(201);
  });

  it("sweeps unreachable request-scoped records at boot", async () => {
    // A no-token write is scoped to an identity the caller is never told, so nothing written
    // under it can be read, updated or deleted through the API by anybody — it is garbage the
    // moment the response is sent, and without a sweep it is permanent garbage that every
    // later write re-serialises.
    await db.read();
    const stamp = Date.now();
    const old = `__test__anon-old-${stamp}`;
    const fresh = `__test__anon-fresh-${stamp}`;
    const owned = `__test__anon-owned-${stamp}`;
    db.data.loadouts.push(
      { id: old, owner: `request-scoped:${randomUUID()}`, name: old, data: validData, updatedAt: "2020-01-01T00:00:00.000Z" },
      { id: fresh, owner: `request-scoped:${randomUUID()}`, name: fresh, data: validData, updatedAt: new Date().toISOString() },
      // A real token of the same vintage as the expired one: age alone must not sweep a
      // record its owner can still see.
      { id: owned, owner: "11111111-2222-4333-8444-555555555555", name: owned, data: validData, updatedAt: "2020-01-01T00:00:00.000Z" }
    );
    await db.write();

    // Re-import to re-run the boot-time pass, mirroring the legacy-migration test above.
    const rebooted = (await import("../db.js?sweep" + stamp)).db;
    await rebooted.read();

    const names = rebooted.data.loadouts.map((l) => l.name);
    expect(names).not.toContain(old);
    // Inside the TTL, so still there — an operator debugging a no-token POST can find it.
    expect(names).toContain(fresh);
    expect(names).toContain(owned);
  });

  it("mounts BOTH shared limiters on EVERY write verb, and the read limiter on the read", () => {
    // Governing: SPEC-0003 § Rate Limiting, which is normative for POST, PATCH and DELETE
    // alike. Only POST was pinned: deleting `ipLimiter, tokenLimiter` from the PATCH — the
    // verb this feature just widened from "move" to "move and/or write user prose" — left
    // the whole server suite green, and DELETE was in the same position.
    //
    // Asserted by IDENTITY against the exports from lib/ownership.js, mirroring the check
    // hunterFavorites.test.js already makes. Driving 241 requests per verb is what the two
    // behavioural tests around this one do, and doing it a third and fourth time would
    // exhaust the shared test IP's budget for the window — the limiters are module-level
    // singletons every makeApp() shares — and make the siblings order-dependent. A header
    // probe cannot tell one limiter from two stacked, either: both emit draft-7
    // `RateLimit-*` and the last to run wins the header.
    const layerFor = (method, path) =>
      loadoutsRouter.stack.find((l) => l.route?.path === path && l.route?.methods?.[method]);

    for (const [method, path] of [["post", "/"], ["patch", "/:id"], ["delete", "/:id"]]) {
      const layer = layerFor(method, path);
      expect(layer, `${method.toUpperCase()} ${path} is not routed`).toBeTruthy();
      const handlers = layer.route.stack.map((s) => s.handle);
      expect(handlers, `${method.toUpperCase()} ${path} is missing ipLimiter`).toContain(ipLimiter);
      expect(handlers, `${method.toUpperCase()} ${path} is missing tokenLimiter`).toContain(tokenLimiter);
    }

    // The listing was deliberately unlimited, on the reasoning that a limiter there would
    // throttle the app's own boot fetch. Issue #198 is the other half of that: the handler
    // calls db.read(), which re-parses the WHOLE file, so an unlimited read path is an
    // unlimited parse rate — and it gets more expensive as the store grows. It carries the
    // READ limiter, whose budget is far looser, and still neither write limiter.
    const get = layerFor("get", "/");
    const readHandlers = get.route.stack.map((s) => s.handle);
    expect(readHandlers).toContain(readLimiter);
    expect(readHandlers).not.toContain(ipLimiter);
    expect(readHandlers).not.toContain(tokenLimiter);
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
