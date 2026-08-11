import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { DESCRIPTION_MAX_CHARS, loadoutsRouter } from "./loadouts.js";
import { loadoutListsRouter } from "./loadoutLists.js";
import { db } from "../db.js";

// Governing: ADR-0006 (list filing model), ADR-0007 (dataset carries descriptions),
// SPEC-0003 REQ "Loadouts Carry an Editable Description", REQ "The Saved-Loadout Wire Format
// Is Unchanged"
//
// What every test below is really guarding is ONE property: `description` has three states —
// null/absent (never edited), "" (deliberately blank) and a non-empty string (the user's
// text) — and none of the code between the request body and the data file may collapse them
// into two. design.md's risk register names the mechanism: a truthy check. So the suite is
// arranged so that `if (description)`, `description || fallback` or `!description` anywhere
// in the write path turns at least one of these red — see "stores an empty string" and
// "an omitted key is not a reset" in particular.

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
    // The API shape is uniform — every loadout carries the key, and "never edited" is null…
    expect(saved.body).toHaveProperty("description");
    expect(saved.body.description).toBeNull();
    // …but nothing is WRITTEN for a loadout that has never been described. The inherited text
    // is resolved by the client at render time and must never be copied into the record.
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

  it("stores an empty string as an empty string — deliberately blank is not 'never edited'", async () => {
    // THE test. Every truthy check in the write path — `if (description)`,
    // `description || null`, `!description` — turns "" into the inherit state here, which is
    // what makes a description impossible to empty.
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

  it("resets to the inherited state on an explicit null, storing null and not the hunter's text", async () => {
    const app = makeApp();
    const saved = await save(app, { name: "__test__d-restore", data: validData, description: "mine" });

    const restored = await patch(app, saved.body.id, { description: null });
    expect(restored.status).toBe(200);
    expect(restored.body.description).toBeNull();
    expect((await stored(saved.body.id)).description).toBeNull();
  });

  it("distinguishes null from empty string end to end", async () => {
    // The two states side by side, so a change that merges them cannot pass by satisfying
    // each of the previous two tests separately.
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
    // Not reset to the inherited state. A move changes filing and nothing else.
    expect(moved.body.description).toBe("mine");
    expect((await stored(saved.body.id)).description).toBe("mine");
  });

  it("leaves a deliberately-blank description blank when a move omits the key", async () => {
    // The same rule for the state most easily lost: a move must not turn "" back into null,
    // which would make the hunter's lore reappear on a loadout the user emptied on purpose.
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
    // (404 chars, "The Night Seer") — the text a user most often starts from when they edit —
    // fits with room to spare. Asserted against the exported constant AND against the
    // requirement's own floor, so raising the constant cannot quietly lower the guarantee.
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

  it("does not promote a description hidden inside data onto the envelope", async () => {
    // `data` is stored verbatim, whatever unknown keys it carries; what must not happen is
    // that one of them becomes the record's description, or that the envelope's description
    // is read from there.
    const app = makeApp();
    const saved = await save(app, {
      name: "__test__d-smuggle", data: { ...validData, description: "smuggled" },
    });

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

  it("refuses to restore another token's loadout to the inherited state", async () => {
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
      // …but the write IS logged, and says which of the three states it landed in. An
      // implementation that satisfied the line above by logging nothing at all fails here.
      expect(logged).toContain("loadout updated");
      expect(logged).toContain("chars");
    } finally {
      info.mockRestore();
    }
  });

  it("logs a restore as the state it is, still without any text", async () => {
    const app = makeApp();
    const saved = await save(app, { name: "__test__d-log2", data: validData, description: "SENTINEL-PROSE" });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await patch(app, saved.body.id, { description: null });
      const logged = info.mock.calls.map((args) => JSON.stringify(args)).join("\n");
      expect(logged).not.toContain("SENTINEL-PROSE");
      expect(logged).toContain("inherited");
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
