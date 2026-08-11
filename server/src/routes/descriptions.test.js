import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { DESCRIPTION_MAX_CHARS, loadoutsRouter } from "./loadouts.js";
import { ACCENT_PALETTE, loadoutListsRouter } from "./loadoutLists.js";
import { db } from "../db.js";
import { randomUUID } from "node:crypto";

// Governing: ADR-0006 (list filing model), ADR-0007 (dataset carries descriptions),
// SPEC-0003 REQ "Lists Carry an Editable Description", REQ "Loadouts Carry a Description of
// Their Own", REQ "The Saved-Loadout Wire Format Is Unchanged"
//
// TWO records carry a description, and the suites below are separate because the records mean
// different things by the field.
//
// A LIST's `description` has three states — null/absent (never edited, inherit the hunter's
// text), "" (deliberately blank) and a non-empty string (the user's own) — and none of the
// code between the request body and the data file may collapse them into two. design.md's
// risk register names the mechanism: a truthy check. So the list suite is arranged so that
// `if (description)`, `description || fallback` or `!description` anywhere in that write path
// turns at least one test red — see "stores an empty string" and "an omitted key is not a
// reset" in particular.
//
// A LOADOUT's `description` inherits nothing (#181): it is the user's own note about the
// build, so null and "" say the same thing and only the WIRE discipline is load-bearing —
// an omitted key must still leave the field alone, and the cap still applies. The loadout
// suite keeps the null/"" cases anyway, because records store both and a read must survive
// whichever it meets.

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/loadouts", loadoutsRouter);
  app.use("/api/loadout-lists", loadoutListsRouter);
  return app;
}

const TOKEN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
// A SECOND caller. The suite ran entirely on one token, which is exactly how the record
// ownership check on PATCH ended up with no coverage at all — see the ownership block below.
const TOKEN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const validData = { w: [[0, -1], null], e: [["T", 0]], tr: [0], n: "fixture", b: 0 };

const mkList = (app, name) =>
  request(app).post("/api/loadout-lists").set("x-loadout-token", TOKEN_A).send({ name });
const saveAs = (app, token, body) =>
  request(app).post("/api/loadouts").set("x-loadout-token", token).send(body);
const save = (app, body) => saveAs(app, TOKEN_A, body);
const patchAs = (app, token, id, body) =>
  request(app).patch(`/api/loadouts/${id}`).set("x-loadout-token", token).send(body);
const patch = (app, id, body) => patchAs(app, TOKEN_A, id, body);
const stored = async (id) => {
  await db.read();
  return db.data.loadouts.find((l) => l.id === id);
};

describe("loadout descriptions", () => {
  beforeEach(async () => {
    await db.read();
  });
  afterEach(async () => {
    await db.read();
    db.data.loadouts = db.data.loadouts.filter((l) => !l.name.startsWith("__test__"));
    db.data.loadoutLists = db.data.loadoutLists.filter((l) => !l.name.startsWith("__test__"));
    await db.write();
  });

  // --- The three states, in storage and on the wire ---------------------------------

  it("stores no description field at all when none is supplied", async () => {
    const app = makeApp();
    const saved = await save(app, { name: "__test__d-none", data: validData });

    expect(saved.status).toBe(201);
    // The API shape is uniform — every loadout carries the key, and "no note" is null…
    expect(saved.body).toHaveProperty("description");
    expect(saved.body.description).toBeNull();
    // …but nothing is WRITTEN for a loadout nobody has written a note about.
    expect(await stored(saved.body.id)).not.toHaveProperty("description");
  });

  it("accepts a description on POST, on the envelope and never inside data", async () => {
    const app = makeApp();
    const saved = await save(app, { name: "__test__d-post", data: validData, description: "up front" });

    expect(saved.status).toBe(201);
    expect(saved.body.description).toBe("up front");
    // REQ "The Saved-Loadout Wire Format Is Unchanged": the field is envelope state, sibling
    // to name/listId/updatedAt. `data` is stored exactly as it arrived.
    expect(saved.body.data).toEqual(validData);
    expect(Object.keys(saved.body.data)).not.toContain("description");
    const rec = await stored(saved.body.id);
    expect(rec.description).toBe("up front");
    expect(Object.keys(rec.data)).not.toContain("description");
  });

  it("stores an empty string as an empty string, and a read survives it", async () => {
    // A loadout's "" and null both mean "no note", so nothing here is load-bearing on the
    // DISTINCTION — what is load-bearing is that a write of "" is stored and read back
    // verbatim rather than being normalised on the way past. Records in the data file carry
    // both shapes, and neither may make a read fail. (The distinction that must survive is a
    // list's; it is asserted in the list suite below.)
    const app = makeApp();
    const saved = await save(app, { name: "__test__d-blank", data: validData, description: "words" });

    const cleared = await patch(app, saved.body.id, { description: "" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.description).toBe("");
    expect(await stored(saved.body.id)).toHaveProperty("description", "");

    // And it survives a read: "" must not be coalesced to null on the way back out either.
    const listed = await request(app).get("/api/loadouts").set("x-loadout-token", TOKEN_A);
    expect(listed.body.find((l) => l.id === saved.body.id).description).toBe("");
  });

  it("clears the note on an explicit null", async () => {
    const app = makeApp();
    const saved = await save(app, { name: "__test__d-restore", data: validData, description: "mine" });

    const cleared = await patch(app, saved.body.id, { description: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.description).toBeNull();
    expect((await stored(saved.body.id)).description).toBeNull();
  });

  it("accepts both null and empty string, storing each as written", async () => {
    // Neither is rejected and neither is rewritten into the other. A loadout means the same
    // thing by both — no note — and normalising here would rewrite records to say that same
    // thing a different way, which is a migration with nothing to gain.
    const app = makeApp();
    const blank = await save(app, { name: "__test__d-x-blank", data: validData, description: "" });
    const inherit = await save(app, { name: "__test__d-x-inherit", data: validData, description: null });

    expect(blank.body.description).toBe("");
    expect(inherit.body.description).toBeNull();
    expect(blank.body.description).not.toBe(inherit.body.description);
    expect((await stored(blank.body.id)).description).toBe("");
    expect((await stored(inherit.body.id)).description).toBeNull();
  });

  // --- Omitted is a third answer, on both fields -------------------------------------

  it("leaves the description untouched when a move omits the key", async () => {
    const app = makeApp();
    const list = await mkList(app, "__test__d-dest");
    const saved = await save(app, { name: "__test__d-mover", data: validData, description: "mine" });

    const moved = await patch(app, saved.body.id, { listId: list.body.id });
    expect(moved.status).toBe(200);
    expect(moved.body.listId).toBe(list.body.id);
    // A move changes filing and nothing else. This is the property #181 made LOAD-BEARING for
    // loadouts: a note is now the only description a loadout has, so a move that disturbed it
    // would lose the user's words outright rather than swapping one inherited default for
    // another.
    expect(moved.body.description).toBe("mine");
    expect((await stored(saved.body.id)).description).toBe("mine");
  });

  it("leaves an empty description empty when a move omits the key", async () => {
    const app = makeApp();
    const list = await mkList(app, "__test__d-dest2");
    const saved = await save(app, { name: "__test__d-blank-mover", data: validData, description: "" });

    const moved = await patch(app, saved.body.id, { listId: list.body.id });
    expect(moved.body.description).toBe("");
    expect((await stored(saved.body.id)).description).toBe("");
  });

  it("leaves the filing untouched when a description write omits listId", async () => {
    const app = makeApp();
    const list = await mkList(app, "__test__d-stay");
    const saved = await save(app, { name: "__test__d-describer", data: validData, listId: list.body.id });

    const described = await patch(app, saved.body.id, { description: "a note" });
    expect(described.status).toBe(200);
    expect(described.body.listId).toBe(list.body.id);
    expect(described.body.description).toBe("a note");
  });

  it("changes only what it is asked to, and nothing else on the record", async () => {
    const app = makeApp();
    const saved = await save(app, { name: "__test__d-narrow", data: validData });
    const before = { ...saved.body };

    const described = await patch(app, saved.body.id, { description: "annotation" });
    expect(described.body.id).toBe(before.id);
    expect(described.body.name).toBe(before.name);
    expect(described.body.data).toEqual(before.data);
    expect(described.body.listId).toBe(before.listId);
  });

  it("leaves an upsert's description alone when the re-save omits the key", async () => {
    const app = makeApp();
    await save(app, { name: "__test__d-upsert", data: validData, description: "written once" });

    const again = await save(app, { name: "__test__d-upsert", data: validData });
    expect(again.status).toBe(200);
    expect(again.body.description).toBe("written once");
  });

  it("rejects a write supplying neither listId nor description", async () => {
    const app = makeApp();
    const saved = await save(app, { name: "__test__d-empty-body", data: validData, description: "kept" });

    const res = await patch(app, saved.body.id, {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/listId or description/);
    // …and the record is untouched, including its updatedAt.
    const rec = await stored(saved.body.id);
    expect(rec.description).toBe("kept");
    expect(rec.updatedAt).toBe(saved.body.updatedAt);
  });

  it("treats writing the value already stored as a no-op rather than a write", async () => {
    const app = makeApp();
    const saved = await save(app, { name: "__test__d-noop", data: validData, description: "same" });

    const res = await patch(app, saved.body.id, { description: "same" });
    expect(res.status).toBe(200);
    expect(res.body.updatedAt).toBe(saved.body.updatedAt);
  });

  // --- The cap -----------------------------------------------------------------------

  it("caps stored descriptions at a named constant of at least 1000 characters", async () => {
    // SPEC-0003 Security Requirements: at least 1000, so the roster's longest description
    // (404 chars, "The Night Seer") fits with room to spare. That floor is justified by the
    // LIST description — the only one seeded from the dataset, and so the only one a user
    // starts editing from the hunter's own text — and the same constant governs both records.
    // Asserted against the exported constant AND against the requirement's own floor, so
    // raising the constant cannot quietly lower the guarantee.
    expect(DESCRIPTION_MAX_CHARS).toBeGreaterThanOrEqual(1000);

    const app = makeApp();
    const atCap = await save(app, {
      name: "__test__d-at-cap", data: validData, description: "x".repeat(DESCRIPTION_MAX_CHARS),
    });
    expect(atCap.status).toBe(201);
    expect(atCap.body.description).toHaveLength(DESCRIPTION_MAX_CHARS);
  });

  it("rejects an over-long description on POST, storing nothing", async () => {
    const app = makeApp();
    const res = await save(app, {
      name: "__test__d-too-long", data: validData, description: "x".repeat(DESCRIPTION_MAX_CHARS + 1),
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most/);
    await db.read();
    expect(db.data.loadouts.some((l) => l.name === "__test__d-too-long")).toBe(false);
  });

  it("rejects an over-long description on PATCH, leaving the record unchanged", async () => {
    const app = makeApp();
    const saved = await save(app, { name: "__test__d-cap-patch", data: validData, description: "short" });

    const res = await patch(app, saved.body.id, { description: "x".repeat(DESCRIPTION_MAX_CHARS + 1) });
    expect(res.status).toBe(400);

    const rec = await stored(saved.body.id);
    expect(rec.description).toBe("short");
    expect(rec.updatedAt).toBe(saved.body.updatedAt);
  });

  it("rejects a description that is neither a string nor null", async () => {
    const app = makeApp();
    const saved = await save(app, { name: "__test__d-type", data: validData });

    for (const bad of [42, true, { text: "no" }, ["no"]]) {
      const res = await patch(app, saved.body.id, { description: bad });
      expect(res.status).toBe(400);
    }
    expect(await stored(saved.body.id)).not.toHaveProperty("description");
  });

  it("does not apply the cap to a rejected move — validation precedes any write", async () => {
    // Both fields are validated before either is applied, so a rejected description cannot
    // leave a half-applied move behind it.
    const app = makeApp();
    const list = await mkList(app, "__test__d-atomic");
    const saved = await save(app, { name: "__test__d-atomic-l", data: validData });

    const res = await patch(app, saved.body.id, {
      listId: list.body.id, description: "x".repeat(DESCRIPTION_MAX_CHARS + 1),
    });
    expect(res.status).toBe(400);
    expect((await stored(saved.body.id)).listId).toBeNull();
  });

  // --- isValidData is untouched -------------------------------------------------------

  it("validates the data payload exactly as before", async () => {
    // The description cap governs the ENVELOPE. `data` validation — including its own
    // 200-character cap on `data.n`, which happens to share a number with the envelope's name
    // cap and is a different rule — must be unchanged by this capability. A refactor that
    // pointed both at one constant, or that added a description clause to isValidData, fails
    // here.
    const app = makeApp();

    const badShape = await save(app, { name: "__test__d-bad", data: { nope: true }, description: "x" });
    expect(badShape.status).toBe(400);
    expect(badShape.body.error).toMatch(/valid loadout payload/);

    const longInnerName = await save(app, {
      name: "__test__d-inner", data: { ...validData, n: "n".repeat(201) },
    });
    expect(longInnerName.status).toBe(400);
    expect(longInnerName.body.error).toMatch(/valid loadout payload/);

    const okInnerName = await save(app, {
      name: "__test__d-inner-ok", data: { ...validData, n: "n".repeat(200) },
    });
    expect(okInnerName.status).toBe(201);
  });

  it("refuses a description smuggled inside data rather than storing it unread", async () => {
    // This used to assert the weaker half of the guarantee: `data` was stored VERBATIM
    // whatever unknown keys it carried, and the requirement was only that none of them
    // became the record's description. Issue #198 closed the gap the first half left open —
    // `data` is an allowlist now, so a key the wire format does not define is refused
    // outright and never reaches the store to be misread later.
    const app = makeApp();
    const smuggled = await save(app, {
      name: "__test__d-smuggle", data: { ...validData, description: "smuggled" },
    });
    expect(smuggled.status).toBe(400);

    // And the envelope's description still comes from the envelope alone: the same save
    // without the extra key is described as "never edited", not as "smuggled".
    const saved = await save(app, { name: "__test__d-smuggle-ok", data: validData });
    expect(saved.status).toBe(201);
    expect(saved.body.description).toBeNull();
    expect(await stored(saved.body.id)).not.toHaveProperty("description");
  });

  // --- Record ownership on PATCH -------------------------------------------------------
  //
  // Governing: SPEC-0003 REQ "Cross-Collection Ownership Enforcement" and the per-record
  // ownership rule issue #17 established.
  //
  // Nothing tested this. Deleting `&& l.owner === token` from the PATCH handler left the
  // entire server suite green, and this PR is what widened that guard's blast radius from
  // "which list is it in" to "the prose the user wrote". The test that LOOKS like it covers
  // it — filing.test.js "refuses to move another token's loadout" — passes for the wrong
  // reason: its target list is one B also owns, so `validateListRef` 404s on the CROSS-
  // COLLECTION check before record ownership is ever consulted. Hence the `listId: null`
  // variant below, which has no list to check at all.

  it("refuses to describe another token's loadout, leaving the record byte-identical", async () => {
    const app = makeApp();
    const bs = await saveAs(app, TOKEN_B, {
      name: "__test__d-owned-by-b", data: validData, description: "B's own words",
    });
    expect(bs.status).toBe(201);
    const before = JSON.stringify(await stored(bs.body.id));

    const res = await patchAs(app, TOKEN_A, bs.body.id, { description: "A was here" });

    // 404, not 403: the same answer whether it does not exist or belongs to someone else, so
    // the endpoint is not an existence oracle.
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/loadout not found/);
    // Nothing of B's came back, either — a leak of the record is as bad as a write to it.
    expect(JSON.stringify(res.body)).not.toContain("B's own words");
    expect(JSON.stringify(await stored(bs.body.id))).toBe(before);
  });

  it("refuses it with no listId to check, so the cross-collection guard cannot mask it", async () => {
    // `listId: null` short-circuits validateListRef entirely — no list is resolved and no
    // ownership question is asked of the lists collection — so the ONLY thing standing
    // between A and B's record here is the `l.owner === token` clause on the record itself.
    const app = makeApp();
    const bs = await saveAs(app, TOKEN_B, {
      name: "__test__d-owned-by-b2", data: validData, description: "still B's",
    });
    const before = JSON.stringify(await stored(bs.body.id));

    const res = await patchAs(app, TOKEN_A, bs.body.id, { listId: null, description: "A was here" });

    expect(res.status).toBe(404);
    expect(JSON.stringify(await stored(bs.body.id))).toBe(before);
  });

  it("refuses to clear another token's loadout note", async () => {
    // The destructive shape of the same hole: `description: null` throws away prose the
    // attacker never had to read.
    const app = makeApp();
    const bs = await saveAs(app, TOKEN_B, {
      name: "__test__d-owned-by-b3", data: validData, description: "B wrote this and wants it kept",
    });

    expect((await patchAs(app, TOKEN_A, bs.body.id, { description: null })).status).toBe(404);
    expect((await stored(bs.body.id)).description).toBe("B wrote this and wants it kept");
  });

  // --- The text never leaves by a side channel -------------------------------------------

  it("never echoes the rejected description back in the error body", async () => {
    // The rejected text is user prose — and on the edit path it is most often prose the app
    // itself offered, scraped off-origin. An error body is the easiest place for it to end up
    // somewhere it was never rendered as text: a log aggregator, a bug report, a toast built
    // by concatenation. The cap is all the caller needs told.
    const app = makeApp();
    const saved = await save(app, { name: "__test__d-echo", data: validData });
    const marker = "SENTINEL-PROSE";

    for (const body of [
      { description: `${marker}${"y".repeat(DESCRIPTION_MAX_CHARS)}` }, // over the cap
      { description: { text: marker } }, // wrong type
    ]) {
      const res = await patch(app, saved.body.id, body);
      expect(res.status).toBe(400);
      expect(res.text).not.toContain(marker);
      expect(JSON.stringify(res.body)).not.toContain(marker);
    }

    // …and the same on POST, whose rejection path is a different call site.
    const posted = await save(app, {
      name: "__test__d-echo-post", data: validData, description: `${marker}${"y".repeat(DESCRIPTION_MAX_CHARS)}`,
    });
    expect(posted.status).toBe(400);
    expect(posted.text).not.toContain(marker);
  });

  it("logs which state a description landed in, never the text itself", async () => {
    // The handler carries a comment asserting the text is never logged. Nothing checked it,
    // so any `description: desc.value` slipped into that object would ship silently — and
    // application logs are exactly where scraped-then-stored prose should not accumulate.
    const app = makeApp();
    const saved = await save(app, { name: "__test__d-log", data: validData });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const res = await patch(app, saved.body.id, { description: "SENTINEL-PROSE the user wrote" });
      expect(res.status).toBe(200);

      const logged = info.mock.calls.map((args) => JSON.stringify(args)).join("\n");
      expect(logged).not.toContain("SENTINEL-PROSE");
      // …but the write IS logged, and says which state it landed in. An implementation that
      // satisfied the line above by logging nothing at all fails here.
      expect(logged).toContain("loadout updated");
      expect(logged).toContain("chars");
    } finally {
      info.mockRestore();
    }
  });

  it("logs a clear as the state it is, still without any text", async () => {
    const app = makeApp();
    const saved = await save(app, { name: "__test__d-log2", data: validData, description: "SENTINEL-PROSE" });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await patch(app, saved.body.id, { description: null });
      const logged = info.mock.calls.map((args) => JSON.stringify(args)).join("\n");
      expect(logged).not.toContain("SENTINEL-PROSE");
      expect(logged).toContain("cleared");
    } finally {
      info.mockRestore();
    }
  });

  it("counts the cap in characters a reader can see, not in UTF-16 code units", async () => {
    // `String.prototype.length` charges TWO for every non-BMP character, so a cap enforced on
    // it refuses 501 astral-plane glyphs with a message claiming a limit of 1000 characters.
    // That fails closed, but it fails closed while saying something the user cannot act on.
    //
    // Written as a code-point escape rather than as a literal so this file stays ASCII —
    // file(1) classifies non-ASCII sources as binary, which makes them invisible to a plain
    // grep and is a trap this repo has already been bitten by.
    const astral = String.fromCodePoint(0x1f701); // ALCHEMICAL SYMBOL FOR AIR, one code point
    expect(astral.length).toBe(2); // …and two code units, which is the whole point

    const app = makeApp();
    const under = await save(app, {
      name: "__test__d-astral", data: validData, description: astral.repeat(DESCRIPTION_MAX_CHARS),
    });
    expect(under.status).toBe(201);
    expect([...under.body.description]).toHaveLength(DESCRIPTION_MAX_CHARS);
    expect((await stored(under.body.id)).description).toBe(astral.repeat(DESCRIPTION_MAX_CHARS));

    // The cap still bites — in the same unit the message names.
    const over = await save(app, {
      name: "__test__d-astral-over", data: validData, description: astral.repeat(DESCRIPTION_MAX_CHARS + 1),
    });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(new RegExp(`at most ${DESCRIPTION_MAX_CHARS} characters`));
  });

  it("still caps the envelope name at 200 characters", async () => {
    // Naming that literal must not have moved it.
    const app = makeApp();
    const res = await save(app, { name: `__test__${"n".repeat(200)}`, data: validData });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 200 characters/);
  });
});

// ---------------------------------------------------------------------------------------
// The LIST description — the one with an inherited default
//
// Governing: ADR-0007 (dataset carries descriptions), SPEC-0003 REQ "Lists Carry an Editable
// Description".
//
// This is where the three states are load-bearing, and where a truthy check does real damage:
// merge null with "" and a list's description becomes impossible to empty, because clearing it
// hands the user back the hunter's lore they just deleted.
//
// The server never resolves the default — the client does, live, at render time (that is the
// point of storing null rather than a copy). So what these tests can check is the half the
// server owns: that the three states go in and come back out distinct, that an omitted key is
// not a write, and that nothing about a list except the field asked for ever moves.
// ---------------------------------------------------------------------------------------

// A FRESH owner token per test, rather than the file-level TOKEN_A.
//
// Writes are rate-limited per token at 60/minute (lib/ownership.js), and both suites in this
// file run inside one window. Sharing a token across two suites of write-heavy tests puts the
// later ones over the budget, and a 429 mid-suite reads as a description bug rather than as
// the fixture problem it is. The per-IP floor is 4x higher and comfortably clear of the whole
// file. A new token also guarantees each test an empty collection of its own to list.
let owner;
const mkListAs = (app, token, body) =>
  request(app).post("/api/loadout-lists").set("x-loadout-token", token).send(body);
const mkListWith = (app, body) => mkListAs(app, owner, body);
const patchListAs = (app, token, id, body) =>
  request(app).patch(`/api/loadout-lists/${id}`).set("x-loadout-token", token).send(body);
const patchList = (app, id, body) => patchListAs(app, owner, id, body);
const storedList = async (id) => {
  await db.read();
  return db.data.loadoutLists.find((l) => l.id === id);
};

describe("list descriptions", () => {
  beforeEach(async () => {
    owner = randomUUID();
    await db.read();
  });
  afterEach(async () => {
    await db.read();
    db.data.loadoutLists = db.data.loadoutLists.filter((l) => !l.name.startsWith("__test__"));
    await db.write();
  });

  // --- The three states, in storage and on the wire ---------------------------------

  it("stores no description field at all when none is supplied", async () => {
    const app = makeApp();
    const list = await mkListWith(app, { name: "__test__l-none", hunterId: "the-turncoat" });

    expect(list.status).toBe(201);
    // Uniform API shape — every list carries the key, and "never edited" is null…
    expect(list.body).toHaveProperty("description");
    expect(list.body.description).toBeNull();
    // …but NOTHING is written. The hunter's text is resolved by the client at render time and
    // must never be copied into the record, which is what makes a re-scrape reach every
    // unedited list without touching the data file.
    expect(await storedList(list.body.id)).not.toHaveProperty("description");
  });

  it("accepts a description on POST", async () => {
    const app = makeApp();
    const list = await mkListWith(app, { name: "__test__l-post", description: "my own words" });

    expect(list.status).toBe(201);
    expect(list.body.description).toBe("my own words");
    expect((await storedList(list.body.id)).description).toBe("my own words");
  });

  it("stores an empty string as an empty string — deliberately blank is not 'never edited'", async () => {
    // THE test. Every truthy check in the write path — `if (description)`,
    // `description || null`, `!description` — turns "" into the inherit state here, which is
    // what makes a list's description impossible to empty: clear it, and the lore is back.
    const app = makeApp();
    const list = await mkListWith(app, { name: "__test__l-blank", hunterId: "the-turncoat" });

    const cleared = await patchList(app, list.body.id, { description: "" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.description).toBe("");
    expect(await storedList(list.body.id)).toHaveProperty("description", "");

    // And it survives a read: "" must not be coalesced to null on the way back out either.
    const listed = await request(app).get("/api/loadout-lists").set("x-loadout-token", owner);
    expect(listed.body.find((l) => l.id === list.body.id).description).toBe("");
  });

  it("restores inheritance on an explicit null, storing null and not the hunter's text", async () => {
    const app = makeApp();
    const list = await mkListWith(app, {
      name: "__test__l-restore", hunterId: "the-turncoat", description: "mine",
    });

    const restored = await patchList(app, list.body.id, { description: null });
    expect(restored.status).toBe(200);
    expect(restored.body.description).toBeNull();
    const rec = await storedList(list.body.id);
    expect(rec.description).toBeNull();
    // The whole point of null: no prose was written in its place. A "restore" that copied the
    // hunter's text in would look identical to the user today and would silently freeze the
    // list against every future re-scrape.
    expect(JSON.stringify(rec)).not.toMatch(/[Ss]ilent|lore|hunter's/);
  });

  it("distinguishes null from empty string end to end", async () => {
    // The two states side by side, so a change that merges them cannot pass by satisfying
    // each of the previous two tests separately.
    const app = makeApp();
    const blank = await mkListWith(app, { name: "__test__l-x-blank", description: "" });
    const inherit = await mkListWith(app, { name: "__test__l-x-inherit", description: null });

    expect(blank.body.description).toBe("");
    expect(inherit.body.description).toBeNull();
    expect(blank.body.description).not.toBe(inherit.body.description);
    expect((await storedList(blank.body.id)).description).toBe("");
    expect((await storedList(inherit.body.id)).description).toBeNull();
  });

  it("reads a record written before the field existed as 'never edited'", async () => {
    // Every list in the data file is in exactly this shape today, so this is the migration
    // path rather than a hypothetical. A strict `=== null` anywhere on the read would answer
    // "the user wrote nothing on purpose" for all of them and deny inheritance to the entire
    // collection — design.md calls this the same collapse "arriving through a comparison
    // operator rather than through a truthy check".
    const app = makeApp();
    const list = await mkListWith(app, { name: "__test__l-legacy", hunterId: "the-turncoat" });
    await db.read();
    const rec = db.data.loadoutLists.find((l) => l.id === list.body.id);
    delete rec.description; // belt and braces: the POST above already wrote no key
    await db.write();

    const listed = await request(app).get("/api/loadout-lists").set("x-loadout-token", owner);
    expect(listed.body.find((l) => l.id === list.body.id).description).toBeNull();
  });

  // --- Omitted is a third answer ------------------------------------------------------

  it("leaves the description untouched when a rename omits the key", async () => {
    const app = makeApp();
    const list = await mkListWith(app, { name: "__test__l-rename", description: "kept" });

    const renamed = await patchList(app, list.body.id, { name: "__test__l-renamed" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("__test__l-renamed");
    expect(renamed.body.description).toBe("kept");
    expect((await storedList(list.body.id)).description).toBe("kept");
  });

  it("leaves a deliberately-blank description blank when another field is written", async () => {
    // The state most easily lost: an accent change must not turn "" back into null, which
    // would make the hunter's lore reappear on a list the user emptied on purpose.
    const app = makeApp();
    const list = await mkListWith(app, {
      name: "__test__l-blank-keep", hunterId: "the-turncoat", description: "",
    });

    const accented = await patchList(app, list.body.id, { accent: ACCENT_PALETTE[2] });
    expect(accented.body.description).toBe("");
    expect((await storedList(list.body.id)).description).toBe("");
  });

  it("changes the hunter without disturbing an edited description", async () => {
    // SPEC-0003: moving an EDITED list to another hunter preserves the user's text. Only the
    // unedited case re-inherits, and it re-inherits by resolving null at render time rather
    // than by anything happening here.
    const app = makeApp();
    const list = await mkListWith(app, {
      name: "__test__l-rehunt", hunterId: "the-turncoat", description: "mine, and staying",
    });

    const rehunted = await patchList(app, list.body.id, { hunterId: "the-rat" });
    expect(rehunted.body.hunterId).toBe("the-rat");
    expect(rehunted.body.description).toBe("mine, and staying");
  });

  it("keeps the two meanings of null on this endpoint apart", async () => {
    // `hunterId: null` is an absence — the list depicts nobody. `description: null` is a
    // deferral — inherit from whoever it depicts. Same literal, opposite directions, one
    // request. A handler that treated null uniformly would empty the wrong field.
    const app = makeApp();
    const list = await mkListWith(app, {
      name: "__test__l-two-nulls", hunterId: "the-turncoat", description: "mine",
    });

    const both = await patchList(app, list.body.id, { hunterId: null, description: null });
    expect(both.status).toBe(200);
    expect(both.body.hunterId).toBeNull();
    expect(both.body.description).toBeNull();

    // …and each alone leaves the other alone.
    const one = await mkListWith(app, {
      name: "__test__l-one-null", hunterId: "the-turncoat", description: "mine",
    });
    const dropped = await patchList(app, one.body.id, { hunterId: null });
    expect(dropped.body.description).toBe("mine");
    const restored = await patchList(app, one.body.id, { description: null });
    expect(restored.body.hunterId).toBeNull();
    expect(restored.body.description).toBeNull();
  });

  it("changes only what it is asked to, and nothing else on the record", async () => {
    const app = makeApp();
    const list = await mkListWith(app, { name: "__test__l-narrow", hunterId: "the-turncoat" });
    const before = { ...list.body };

    const described = await patchList(app, list.body.id, { description: "annotation" });
    expect(described.body.id).toBe(before.id);
    expect(described.body.name).toBe(before.name);
    expect(described.body.hunterId).toBe(before.hunterId);
    expect(described.body.accent).toBe(before.accent);
    expect(described.body.createdAt).toBe(before.createdAt);
  });

  // --- The cap, shared with the loadout route -------------------------------------------

  it("caps a list description at the same named constant", async () => {
    const app = makeApp();
    const atCap = await mkListWith(app, {
      name: "__test__l-at-cap", description: "x".repeat(DESCRIPTION_MAX_CHARS),
    });
    expect(atCap.status).toBe(201);
    expect(atCap.body.description).toHaveLength(DESCRIPTION_MAX_CHARS);

    const over = await mkListWith(app, {
      name: "__test__l-over-cap", description: "x".repeat(DESCRIPTION_MAX_CHARS + 1),
    });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(new RegExp(`at most ${DESCRIPTION_MAX_CHARS} characters`));
  });

  it("rejects an over-long description on PATCH, leaving the record unchanged", async () => {
    const app = makeApp();
    const list = await mkListWith(app, { name: "__test__l-patch-cap", description: "short" });

    const res = await patchList(app, list.body.id, { description: "x".repeat(DESCRIPTION_MAX_CHARS + 1) });
    expect(res.status).toBe(400);
    expect((await storedList(list.body.id)).description).toBe("short");
  });

  it("rejects a description that is neither a string nor null", async () => {
    const app = makeApp();
    const list = await mkListWith(app, { name: "__test__l-type" });

    for (const bad of [42, true, { text: "no" }, ["no"]]) {
      const res = await patchList(app, list.body.id, { description: bad });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/string or null/);
    }
    expect(await storedList(list.body.id)).not.toHaveProperty("description");
  });

  it("validates before applying, so a rejected description leaves no half-written rename", async () => {
    const app = makeApp();
    const list = await mkListWith(app, { name: "__test__l-atomic" });

    const res = await patchList(app, list.body.id, {
      name: "__test__l-atomic-renamed",
      description: "x".repeat(DESCRIPTION_MAX_CHARS + 1),
    });
    expect(res.status).toBe(400);
    expect((await storedList(list.body.id)).name).toBe("__test__l-atomic");
  });

  // --- Ownership and side channels --------------------------------------------------

  it("refuses to describe another token's list, leaving the record byte-identical", async () => {
    const app = makeApp();
    const stranger = randomUUID();
    const bs = await mkListAs(app, stranger, { name: "__test__l-owned-by-b", description: "B's own words" });
    expect(bs.status).toBe(201);
    const before = JSON.stringify(await storedList(bs.body.id));

    const res = await patchListAs(app, owner, bs.body.id, { description: "A was here" });

    // 404, not 403 — the same answer whether it does not exist or belongs to someone else.
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("B's own words");
    expect(JSON.stringify(await storedList(bs.body.id))).toBe(before);
  });

  it("never echoes the rejected description back, and never logs the text", async () => {
    const app = makeApp();
    const list = await mkListWith(app, { name: "__test__l-echo" });
    const marker = "SENTINEL-PROSE";

    const rejected = await patchList(app, list.body.id, {
      description: `${marker}${"y".repeat(DESCRIPTION_MAX_CHARS)}`,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.text).not.toContain(marker);

    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await patchList(app, list.body.id, { description: `${marker} the user wrote` });
      const logged = info.mock.calls.map((args) => JSON.stringify(args)).join("\n");
      expect(logged).not.toContain(marker);
      // …but the write IS logged, and says which state it landed in. Logging nothing at all
      // would satisfy the line above and fail here.
      expect(logged).toContain("loadout list described");
      expect(logged).toContain("chars");
    } finally {
      info.mockRestore();
    }
  });

  it("logs a restore as inherited, distinguishing it from a clear", async () => {
    // The two nulls again, this time in the log: "inherited" is what a list's null means, and
    // a log that said "cleared" would describe the loadout route's null instead.
    const app = makeApp();
    const list = await mkListWith(app, { name: "__test__l-log", description: "mine" });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await patchList(app, list.body.id, { description: null });
      const logged = info.mock.calls.map((args) => JSON.stringify(args)).join("\n");
      expect(logged).toContain("inherited");
    } finally {
      info.mockRestore();
    }
  });
});
