import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { loadoutsRouter } from "./loadouts.js";
import { loadoutListsRouter } from "./loadoutLists.js";
import { db } from "../db.js";

// Governing: ADR-0006, SPEC-0003 REQ "Loadouts Are Filed into Lists by Nullable
// Reference", REQ "Retiring a List Never Destroys Loadouts", REQ "The Saved-Loadout Wire
// Format Is Unchanged", REQ "Cross-Collection Ownership Enforcement"

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/loadouts", loadoutsRouter);
  app.use("/api/loadout-lists", loadoutListsRouter);
  return app;
}

const TOKEN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const validData = { w: [[0, -1], null], e: [["T", 0]], tr: [0], n: "fixture", b: 0 };

const mkList = (app, token, name) =>
  request(app).post("/api/loadout-lists").set("x-loadout-token", token).send({ name });
const save = (app, token, body) =>
  request(app).post("/api/loadouts").set("x-loadout-token", token).send(body);
const move = (app, token, id, listId) =>
  request(app).patch(`/api/loadouts/${id}`).set("x-loadout-token", token).send({ listId });

describe("filing loadouts into lists", () => {
  beforeEach(async () => {
    await db.read();
  });
  afterEach(async () => {
    await db.read();
    db.data.loadouts = db.data.loadouts.filter((l) => !l.name.startsWith("__test__"));
    db.data.loadoutLists = db.data.loadoutLists.filter((l) => !l.name.startsWith("__test__"));
    await db.write();
  });

  // --- REQ "Loadouts Are Filed into Lists by Nullable Reference" -------------------

  it("files many loadouts into one list — no cap", async () => {
    const app = makeApp();
    const list = await mkList(app, TOKEN_A, "__test__many");

    for (let i = 0; i < 10; i++) {
      const res = await save(app, TOKEN_A, { name: `__test__m${i}`, data: validData, listId: list.body.id });
      expect(res.status).toBe(201);
      expect(res.body.listId).toBe(list.body.id);
    }

    await db.read();
    const filed = db.data.loadouts.filter((l) => l.listId === list.body.id);
    expect(filed).toHaveLength(10);
  });

  it("saves to Unassigned when no list is given", async () => {
    const app = makeApp();
    const res = await save(app, TOKEN_A, { name: "__test__unassigned", data: validData });
    expect(res.status).toBe(201);
    expect(res.body.listId).toBeNull();
  });

  it("reads a pre-existing record with no listId as Unassigned, with no migration", async () => {
    const app = makeApp();
    // A record exactly as written before SPEC-0003 existed: no listId key at all.
    await db.read();
    db.data.loadouts.push({
      id: "legacy-shaped-1", owner: TOKEN_A, name: "__test__preexisting", data: validData, updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.write();

    const listed = await request(app).get("/api/loadouts").set("x-loadout-token", TOKEN_A);
    const found = listed.body.find((l) => l.name === "__test__preexisting");
    expect(found).toBeDefined();
    // The stored record has no listId key at all, but the API serialises it explicitly, so
    // no consumer has to coalesce. Unassigned is always null, never an absent field.
    expect(found).toHaveProperty("listId");
    expect(found.listId).toBeNull();
  });

  it("moves a loadout between lists, changing nothing else", async () => {
    const app = makeApp();
    const a = await mkList(app, TOKEN_A, "__test__from");
    const b = await mkList(app, TOKEN_A, "__test__to");
    const saved = await save(app, TOKEN_A, { name: "__test__mover", data: validData, listId: a.body.id });

    const before = { ...saved.body };
    const moved = await move(app, TOKEN_A, saved.body.id, b.body.id);

    expect(moved.status).toBe(200);
    expect(moved.body.listId).toBe(b.body.id);
    expect(moved.body.id).toBe(before.id);
    expect(moved.body.name).toBe(before.name);
    expect(moved.body.data).toEqual(before.data);
  });

  it("moves a loadout to Unassigned", async () => {
    const app = makeApp();
    const list = await mkList(app, TOKEN_A, "__test__leaving");
    const saved = await save(app, TOKEN_A, { name: "__test__leaver", data: validData, listId: list.body.id });

    const moved = await move(app, TOKEN_A, saved.body.id, null);
    expect(moved.status).toBe(200);
    expect(moved.body.listId).toBeNull();
  });

  it("treats moving an already-unassigned legacy-shaped record to null as a no-op", async () => {
    // A record predating SPEC-0003 has listId undefined, not null. A plain === would miss
    // that and take the write path, bumping updatedAt for a move that changes nothing.
    const app = makeApp();
    await db.read();
    db.data.loadouts.push({
      id: "legacy-noop-1", owner: TOKEN_A, name: "__test__legacy-noop", data: validData, updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.write();

    const res = await move(app, TOKEN_A, "legacy-noop-1", null);
    expect(res.status).toBe(200);
    expect(res.body.listId).toBeNull();
    expect(res.body.updatedAt).toBe("2026-01-01T00:00:00.000Z"); // untouched — no write

    await db.read();
    expect(db.data.loadouts.find((l) => l.id === "legacy-noop-1").updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("always serialises listId, never omitting it", async () => {
    const app = makeApp();
    const saved = await save(app, TOKEN_A, { name: "__test__always-present", data: validData });
    expect(saved.body).toHaveProperty("listId");

    const listed = await request(app).get("/api/loadouts").set("x-loadout-token", TOKEN_A);
    for (const l of listed.body) expect(l).toHaveProperty("listId");
  });

  it("treats selecting the current list as a no-op", async () => {
    const app = makeApp();
    const list = await mkList(app, TOKEN_A, "__test__noop");
    const saved = await save(app, TOKEN_A, { name: "__test__noop-l", data: validData, listId: list.body.id });

    const res = await move(app, TOKEN_A, saved.body.id, list.body.id);
    expect(res.status).toBe(200);
    expect(res.body.updatedAt).toBe(saved.body.updatedAt); // no write occurred
  });

  it("leaves filing untouched when an upsert omits listId", async () => {
    const app = makeApp();
    const list = await mkList(app, TOKEN_A, "__test__sticky");
    await save(app, TOKEN_A, { name: "__test__sticky-l", data: validData, listId: list.body.id });

    const again = await save(app, TOKEN_A, { name: "__test__sticky-l", data: validData });
    expect(again.status).toBe(200);
    expect(again.body.listId).toBe(list.body.id);
  });

  // --- REQ "Loadout Identity Is Scoped to Its List" — id-addressed writes never re-file ---
  //
  // Governing: ADR-0022, SPEC-0003 § "HTTP API" (issue #314). An id-addressed save updates
  // the record where it lives; `listId` is a keying argument on the triple path only, and
  // `resolveSaveListId` sends one on every save whether or not it means anything. Honouring
  // it here would turn "save the loadout I loaded" into "move it into whichever list I have
  // open" — the unasked-for relocation #102 was, arriving by the other door.
  //
  // A dedicated token: the write limiters are module-level and per-token (60/min), and these
  // stack four writes onto whatever the suite has already spent on TOKEN_A.
  const ID_FILE_T = "e0000000-0000-4000-8000-000000000314";

  it("does not re-file an id-addressed save into the list the caller named", async () => {
    const app = makeApp();
    const home = await mkList(app, ID_FILE_T, "__test__id-home");
    const elsewhere = await mkList(app, ID_FILE_T, "__test__id-elsewhere");
    const saved = await save(app, ID_FILE_T, {
      name: "__test__id-stays",
      data: validData,
      listId: home.body.id,
    });
    expect(saved.body.listId).toBe(home.body.id);

    // The client always sends a listId — here, the OTHER list, as if it were open.
    const again = await save(app, ID_FILE_T, {
      name: "__test__id-stays",
      data: validData,
      listId: elsewhere.body.id,
      id: saved.body.id,
    });

    expect(again.status).toBe(200);
    expect(again.body.id).toBe(saved.body.id);
    expect(again.body.listId).toBe(home.body.id);

    await db.read();
    expect(db.data.loadouts.find((l) => l.id === saved.body.id).listId).toBe(home.body.id);
  });

  it("does not un-file an id-addressed save that names Unassigned", async () => {
    const app = makeApp();
    const home = await mkList(app, ID_FILE_T, "__test__id-home2");
    const saved = await save(app, ID_FILE_T, {
      name: "__test__id-stays2",
      data: validData,
      listId: home.body.id,
    });

    // `listId: null` is what the client sends whenever no list is selected. On the id path
    // that is not a request to move the record to Unassigned.
    const again = await save(app, ID_FILE_T, {
      name: "__test__id-stays2",
      data: validData,
      listId: null,
      id: saved.body.id,
    });

    expect(again.status).toBe(200);
    expect(again.body.listId).toBe(home.body.id);
  });

  it("still rejects an id-addressed save naming a list the caller does not own", async () => {
    const app = makeApp();
    const saved = await save(app, ID_FILE_T, { name: "__test__id-badlist", data: validData });
    const bList = await mkList(app, TOKEN_B, "__test__id-b-list");

    // Ignored-on-apply is not ignored-on-validate: a caller sending a list it does not own
    // is wrong about something, and answering 200 would hide that.
    const res = await save(app, ID_FILE_T, {
      name: "__test__id-badlist",
      data: validData,
      listId: bList.body.id,
      id: saved.body.id,
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("loadout list not found");
  });

  // --- REQ "Cross-Collection Ownership Enforcement" --------------------------------

  it("refuses to file a loadout into another token's list", async () => {
    const app = makeApp();
    const bList = await mkList(app, TOKEN_B, "__test__b-list");

    const res = await save(app, TOKEN_A, { name: "__test__intruder", data: validData, listId: bList.body.id });

    expect(res.status).toBe(404);
    await db.read();
    expect(db.data.loadouts.some((l) => l.name === "__test__intruder")).toBe(false);
  });

  it("refuses to MOVE a loadout into another token's list", async () => {
    const app = makeApp();
    const bList = await mkList(app, TOKEN_B, "__test__b-target");
    const saved = await save(app, TOKEN_A, { name: "__test__a-loadout", data: validData });

    const res = await move(app, TOKEN_A, saved.body.id, bList.body.id);

    expect(res.status).toBe(404);
    await db.read();
    expect(db.data.loadouts.find((l) => l.id === saved.body.id).listId).toBeNull();
  });

  it("never silently downgrades a rejected listId to Unassigned", async () => {
    const app = makeApp();
    const res = await save(app, TOKEN_A, {
      name: "__test__no-downgrade", data: validData, listId: "00000000-0000-4000-8000-000000000000",
    });
    // A silent downgrade would return 201 with listId null; that would mask an attack.
    expect(res.status).toBe(404);
  });

  it("refuses to move another token's loadout", async () => {
    const app = makeApp();
    const list = await mkList(app, TOKEN_B, "__test__b-own");
    const saved = await save(app, TOKEN_B, { name: "__test__b-loadout", data: validData });

    const res = await move(app, TOKEN_A, saved.body.id, list.body.id);
    expect(res.status).toBe(404);
  });

  // --- REQ "Loadout Identity Is Scoped to Its List" (ADR-0022, issue #102) ---------
  //
  // The upsert key is `(owner, listId, name)`. Every test below fails against the old
  // `(owner, name)` key, which is the point: #102 was data loss on a routine flow, and a
  // test that passes either way would not have caught it.
  //
  // EACH TEST GETS ITS OWN TOKEN, and that is not decoration. The write limiters are
  // module-level and per-token (`WRITE_PER_TOKEN = 60`/min, lib/ownership.js), so adding
  // these thirteen writes to TOKEN_A tipped the file over budget — and it surfaced as a
  // 429 in "requires listId on a move" further down, an unrelated test that had simply
  // drawn the short straw. Distinct tokens keep these off the shared budget and make them
  // order-independent. Same hazard `loadouts.test.js` avoids by seeding the db directly.
  const T = {
    twoLists: "c0000000-0000-4000-8000-000000000102",
    unfiled: "c1000000-0000-4000-8000-000000000102",
    legacy: "c2000000-0000-4000-8000-000000000102",
    stable: "c3000000-0000-4000-8000-000000000102",
    omitted: "c4000000-0000-4000-8000-000000000102",
    capture: "c5000000-0000-4000-8000-000000000102",
  };

  it("keeps two same-named loadouts in different lists, relocating neither", async () => {
    const app = makeApp();
    const a = await mkList(app, T.twoLists, "__test__solo");
    const b = await mkList(app, T.twoLists, "__test__duo");

    const first = await save(app, T.twoLists, { name: "__test__fanning", data: validData, listId: a.body.id });
    const second = await save(app, T.twoLists, { name: "__test__fanning", data: validData, listId: b.body.id });

    // Under the old key the second save returned 200 and MOVED the first record; the user
    // saw a success banner and the copy in list A was gone.
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);

    await db.read();
    const named = db.data.loadouts.filter((l) => l.name === "__test__fanning");
    expect(named).toHaveLength(2);
    // Assert the FILING, not just the count: a relocation would keep two records if the
    // second were a create, so counting alone does not prove neither moved.
    expect(named.find((l) => l.id === first.body.id).listId).toBe(a.body.id);
    expect(named.find((l) => l.id === second.body.id).listId).toBe(b.body.id);
  });

  it("still upserts onto one record for two Unassigned saves under one name", async () => {
    const app = makeApp();
    // `null` is compared AS A VALUE. Treating it as "no constraint" would make every
    // Unassigned save its own record — the same defect #102 names, inverted.
    const first = await save(app, T.unfiled, { name: "__test__unfiled", data: validData, listId: null });
    const second = await save(app, T.unfiled, { name: "__test__unfiled", data: validData, listId: null });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    await db.read();
    expect(db.data.loadouts.filter((l) => l.name === "__test__unfiled")).toHaveLength(1);
  });

  it("does not let an Unassigned save capture a record filed in a list", async () => {
    const app = makeApp();
    // The discriminating case for "`null` is compared AS A VALUE". If `null` instead meant
    // "no constraint", an Unassigned save would match the FILED record by name and both
    // update and relocate it — #102 again, arriving from the Unassigned direction.
    //
    // Added after mutation testing: the two-Unassigned-saves test above cannot catch this,
    // because with only null-listId records in play both readings agree.
    const list = await mkList(app, T.capture, "__test__capture");
    const filed = await save(app, T.capture, { name: "__test__both", data: validData, listId: list.body.id });

    const unfiled = await save(app, T.capture, { name: "__test__both", data: validData, listId: null });

    expect(unfiled.status).toBe(201);
    expect(unfiled.body.id).not.toBe(filed.body.id);
    expect(unfiled.body.listId).toBeNull();

    await db.read();
    const both = db.data.loadouts.filter((l) => l.name === "__test__both");
    expect(both).toHaveLength(2);
    // The filed record kept its list — it was neither updated nor moved.
    expect(both.find((l) => l.id === filed.body.id).listId).toBe(list.body.id);
  });

  it("upserts onto a legacy record that has no listId key at all", async () => {
    const app = makeApp();
    // A record written before SPEC-0003 carries `listId` UNDEFINED, not null. The match
    // coalesces, so an Unassigned save must find it rather than minting a duplicate.
    await db.read();
    db.data.loadouts.push({
      id: "00000000-0000-4000-8000-00000000f102",
      owner: T.legacy,
      name: "__test__legacy-unfiled",
      data: validData,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.write();

    const res = await save(app, T.legacy, { name: "__test__legacy-unfiled", data: validData, listId: null });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("00000000-0000-4000-8000-00000000f102");

    await db.read();
    expect(db.data.loadouts.filter((l) => l.name === "__test__legacy-unfiled")).toHaveLength(1);
  });

  it("changes no stored record when deployed over an existing data file", async () => {
    const app = makeApp();
    // "Pre-existing records SHALL require no migration." The key narrows rather than
    // widens, so a record that matched before and shares its list still matches.
    const list = await mkList(app, T.stable, "__test__preexisting");
    const saved = await save(app, T.stable, { name: "__test__stable", data: validData, listId: list.body.id });

    await db.read();
    const before = JSON.parse(JSON.stringify(db.data.loadouts.find((l) => l.id === saved.body.id)));

    const again = await save(app, T.stable, { name: "__test__stable", data: validData, listId: list.body.id });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(saved.body.id);

    await db.read();
    const after = db.data.loadouts.find((l) => l.id === saved.body.id);
    // Everything but the timestamp is untouched — no reshaping, no new keys.
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(after.listId).toBe(before.listId);
    expect(after.owner).toBe(before.owner);
    expect(after.name).toBe(before.name);
  });

  it("leaves an omitted listId matching across lists, so filing is not lost", async () => {
    const app = makeApp();
    // The body distinguishes ABSENT from null: absent means "update this loadout, do not
    // move it". A caller that named no list supplied no triple, so name-only matching is
    // retained deliberately. The app never takes this path — `resolveSaveListId` always
    // yields a list id or an explicit null — but the API contract predates the triple.
    const list = await mkList(app, T.omitted, "__test__omit");
    const saved = await save(app, T.omitted, { name: "__test__omitted", data: validData, listId: list.body.id });

    const again = await save(app, T.omitted, { name: "__test__omitted", data: validData });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(saved.body.id);
    expect(again.body.listId).toBe(list.body.id);
  });

  // --- REQ "Retiring a List Never Destroys Loadouts" -------------------------------

  it("retiring a list keeps every loadout and drops them into Unassigned", async () => {
    const app = makeApp();
    const list = await mkList(app, TOKEN_A, "__test__doomed");
    for (let i = 0; i < 5; i++) {
      await save(app, TOKEN_A, { name: `__test__keep${i}`, data: validData, listId: list.body.id });
    }
    await db.read();
    const countBefore = db.data.loadouts.length;

    const res = await request(app)
      .delete(`/api/loadout-lists/${list.body.id}`)
      .set("x-loadout-token", TOKEN_A);
    expect(res.status).toBe(204);

    await db.read();
    expect(db.data.loadouts).toHaveLength(countBefore); // identical count — no cascade
    for (let i = 0; i < 5; i++) {
      const l = db.data.loadouts.find((x) => x.name === `__test__keep${i}`);
      expect(l).toBeDefined();
      expect(l.listId).toBeNull();
    }
    expect(db.data.loadoutLists.some((l) => l.id === list.body.id)).toBe(false);
  });

  it("leaves no loadout referencing a retired list", async () => {
    const app = makeApp();
    const list = await mkList(app, TOKEN_A, "__test__dangle");
    await save(app, TOKEN_A, { name: "__test__dangler", data: validData, listId: list.body.id });

    await request(app).delete(`/api/loadout-lists/${list.body.id}`).set("x-loadout-token", TOKEN_A);

    await db.read();
    const ids = new Set(db.data.loadoutLists.map((l) => l.id));
    for (const l of db.data.loadouts) {
      if (l.listId != null) expect(ids.has(l.listId)).toBe(true);
    }
  });

  // --- REQ "The Saved-Loadout Wire Format Is Unchanged" ----------------------------

  it("keeps listId out of the stored data payload", async () => {
    const app = makeApp();
    const list = await mkList(app, TOKEN_A, "__test__envelope");
    const saved = await save(app, TOKEN_A, { name: "__test__env-l", data: validData, listId: list.body.id });

    // On the envelope...
    expect(saved.body.listId).toBe(list.body.id);
    // ...and nowhere inside `data`, which is what keeps share URLs byte-identical.
    expect(saved.body.data).toEqual(validData);
    expect(Object.keys(saved.body.data)).not.toContain("listId");

    await db.read();
    const stored = db.data.loadouts.find((l) => l.id === saved.body.id);
    expect(Object.keys(stored.data)).not.toContain("listId");
  });

  it("validates data exactly as before — filing does not loosen payload validation", async () => {
    const app = makeApp();
    const list = await mkList(app, TOKEN_A, "__test__validation");
    const res = await save(app, TOKEN_A, { name: "__test__bad", data: { nope: true }, listId: list.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid loadout payload/);
  });

  it("rejects a malformed listId before touching the store", async () => {
    const app = makeApp();
    const res = await save(app, TOKEN_A, { name: "__test__badref", data: validData, listId: "x".repeat(101) });
    expect(res.status).toBe(400);
  });

  it("requires listId on a move", async () => {
    const app = makeApp();
    const saved = await save(app, TOKEN_A, { name: "__test__needs-ref", data: validData });
    const res = await request(app)
      .patch(`/api/loadouts/${saved.body.id}`)
      .set("x-loadout-token", TOKEN_A)
      .send({});
    expect(res.status).toBe(400);
  });
});
