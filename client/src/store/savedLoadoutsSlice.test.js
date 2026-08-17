import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import loadoutReducer from "./loadoutSlice.js";
import uiReducer from "./uiSlice.js";
import loadoutListsReducer from "./loadoutListsSlice.js";
import savedLoadoutsReducer, {
  fetchSaved,
  saveCurrent,
  saveCurrentAsNew,
  deleteSaved,
  describeSaved,
  reorderSaved,
} from "./savedLoadoutsSlice.js";
import { describeLoadout, moveLoadout } from "../api/loadouts.js";
import { encodeShareCode, emptyLoadout, toData } from "../utils/loadoutCodec.js";

// Governing: issue #20 (failed save/delete/fetch attempts must surface in the UI)
//
// The thunks report failures through ui.message using a leading "!" to mark the
// message as an error (stripped by ActionsPanel). These tests assert the exact
// prefix so a double-"!" typo can't silently ship a stray exclamation mark in
// the most common failure path (mount-time fetchSaved).

function makeStore() {
  return configureStore({
    reducer: {
      loadout: loadoutReducer,
      ui: uiReducer,
      loadoutLists: loadoutListsReducer,
      savedLoadouts: savedLoadoutsReducer,
    },
    preloadedState: {
      loadout: { ...emptyLoadout(), name: "My Loadout", savedId: null },
      ui: { message: "" },
      loadoutLists: { items: [], status: "idle", error: null },
      savedLoadouts: { items: [], status: "idle", error: null },
    },
  });
}

const respond = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });

describe("savedLoadouts error feedback (issue #20)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces a fetch failure with the single-! error prefix", async () => {
    global.fetch.mockResolvedValueOnce(respond({}, 500));
    const store = makeStore();
    await store.dispatch(fetchSaved());
    expect(store.getState().ui.message.startsWith("!")).toBe(true);
    expect(store.getState().ui.message.includes("Couldn't load saved loadouts")).toBe(true);
    expect(store.getState().ui.message.startsWith("!!")).toBe(false);
  });

  it("surfaces a save failure with the error prefix", async () => {
    global.fetch.mockResolvedValueOnce(respond({}, 500));
    const store = makeStore();
    await store.dispatch(saveCurrent());
    expect(store.getState().ui.message.startsWith("!")).toBe(true);
    expect(store.getState().ui.message.includes("Couldn't save")).toBe(true);
  });

  it("surfaces a delete failure with the error prefix", async () => {
    global.fetch.mockResolvedValueOnce(respond({}, 500));
    const store = makeStore();
    await store.dispatch(deleteSaved("some-id"));
    expect(store.getState().ui.message.startsWith("!")).toBe(true);
    expect(store.getState().ui.message.includes("Couldn't delete loadout")).toBe(true);
  });

  it("does not prefix success messages with the error marker", async () => {
    global.fetch.mockResolvedValueOnce(respond([]));
    const store = makeStore();
    await store.dispatch(fetchSaved());
    expect(store.getState().ui.message).toBe("");
  });

  it("sets the error CSS class on the message when it starts with ! (ActionsPanel)", async () => {
    // Render path is covered by the slice assertions above; this locks the
    // prefix/class contract that ActionsPanel.jsx depends on.
    expect("!oops".startsWith("!")).toBe(true);
  });
});

// Governing: ADR-0006 (list filing model), SPEC-0003 REQ "Loadouts Carry a Description of
// Their Own"
//
// The write path, at the seam where a value is most easily rewritten in transit: a store that
// "helpfully" normalises null to "" — or an API wrapper that lets `undefined` delete its own
// key on the way through JSON.stringify — produces a request that looks fine, succeeds, and
// silently means something else.
//
// A loadout's description inherits nothing (#181), so null and "" say the same thing here.
// They are still sent as themselves rather than folded together: the endpoint distinguishes
// them, records already carry both, and a client that quietly rewrote one into the other
// would be the first place the two fields' rules started to drift.
describe("editing a loadout description", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const bodyOf = (call) => JSON.parse(call[1].body);
  const withDescription = (description) => ({
    id: "l1", name: "My build", data: {}, listId: null, description,
  });

  it("sends each state on the wire exactly as given", async () => {
    for (const description of [null, "", "my own words"]) {
      global.fetch.mockResolvedValueOnce(respond(withDescription(description)));
      const store = makeStore();
      await store.dispatch(describeSaved({ id: "l1", description, loadoutName: "My build" }));

      const [url, opts] = global.fetch.mock.calls.at(-1);
      expect(String(url)).toMatch(/\/api\/loadouts\/l1$/);
      expect(opts.method).toBe("PATCH");
      // Byte-for-byte: `{"description":null}` and `{"description":""}` are different
      // instructions, and `{}` — what an `undefined` here would serialise to — is a third
      // thing entirely, which the server rejects.
      expect(opts.body).toBe(JSON.stringify({ description }));
      // Describing is not moving: no listId key, so the server leaves the filing alone.
      expect("listId" in bodyOf(global.fetch.mock.calls.at(-1))).toBe(false);
    }
  });

  it("stores what the server returned, without normalising null or empty string", async () => {
    for (const description of [null, "", "my own words"]) {
      global.fetch.mockResolvedValueOnce(respond(withDescription(description)));
      const store = makeStore();
      store.dispatch({
        type: "savedLoadouts/fetch/fulfilled",
        payload: [{ id: "l1", name: "My build", data: {}, listId: null, description: "before" }],
      });

      await store.dispatch(describeSaved({ id: "l1", description, loadoutName: "My build" }));
      const item = store.getState().savedLoadouts.items.find((l) => l.id === "l1");
      expect(item.description).toBe(description);
      // `?? null` would be right and `|| null` would be wrong; this is the assertion that
      // tells them apart, because only one of them leaves "" alone.
      expect(item).toHaveProperty("description");
    }
  });

  it("refuses an undefined description rather than dropping the key", async () => {
    // JSON.stringify deletes undefined values, so this would leave the server a body with no
    // instruction in it — a 400 at best, and at worst a client that thinks it reset a field.
    expect(() => describeLoadout("l1", undefined)).toThrow(TypeError);
    expect(() => describeLoadout("l1", 42)).toThrow(TypeError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses an undefined listId on the OTHER patch wrapper too", async () => {
    // The same invariant, on the same endpoint, reached through the other door. The file
    // argues at length that `undefined` must never reach JSON.stringify here — an argument
    // that is only load-bearing if both writers actually hold to it. `moveLoadout(id)` with
    // a caller that forgot its second argument serialises to `{}`, which the server rejects
    // for carrying no instruction at all, and the 400 blames a key the caller thinks it sent.
    expect(() => moveLoadout("l1", undefined)).toThrow(TypeError);
    expect(() => moveLoadout("l1", 42)).toThrow(TypeError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends no description key when SAVING — a re-save must not rewrite the note", async () => {
    // Governing: SPEC-0003 REQ "Loadouts Carry a Description of Their Own" — an omitted key
    // leaves the field alone, and that is the only correct thing for this path to say. The
    // server accepts a description on POST (spec-normative), so nothing but this assertion
    // stands between "the save path grew a description key" and shipping: the nearest string
    // to hand at the call site is the build's inner name, and sending `description: data.n`
    // would silently overwrite whatever the user wrote about the loadout on every re-save.
    //
    // Asserted as the EXACT key set rather than as `not.toHaveProperty`, so any new envelope
    // field has to be added here deliberately.
    global.fetch.mockResolvedValueOnce(respond({ id: "l1", name: "My Loadout", data: {}, listId: null }));
    const store = makeStore();
    await store.dispatch(saveCurrent());

    const [url, opts] = global.fetch.mock.calls.at(-1);
    expect(String(url)).toMatch(/\/api\/loadouts$/);
    expect(opts.method).toBe("POST");
    expect(Object.keys(bodyOf(global.fetch.mock.calls.at(-1))).sort()).toEqual(["data", "listId", "name"]);
    expect(opts.body).not.toContain("description");
  });

  it("surfaces a failed description write with the error prefix", async () => {
    global.fetch.mockResolvedValueOnce(respond({ error: "too long" }, 400));
    const store = makeStore();
    await store.dispatch(describeSaved({ id: "l1", description: "x", loadoutName: "My build" }));

    expect(store.getState().ui.message.startsWith("!")).toBe(true);
    expect(store.getState().ui.message).toContain("Couldn't save the description for “My build”");
    expect(store.getState().ui.message).toContain("too long");
  });

  it("announces a clear as a clear, and never as a restored inheritance", async () => {
    // There is nothing for a loadout to inherit, so a message promising the hunter's text is
    // back would describe something the user is about to not see. Both empty states say the
    // same thing, because they mean the same thing.
    for (const description of [null, ""]) {
      global.fetch.mockResolvedValueOnce(respond(withDescription(description)));
      const store = makeStore();
      await store.dispatch(describeSaved({ id: "l1", description, loadoutName: "My build" }));

      expect(store.getState().ui.message.startsWith("!")).toBe(false);
      expect(store.getState().ui.message).toContain("Cleared the description");
      expect(store.getState().ui.message).not.toContain("hunter");
    }
  });
});

// Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List", REQ "The
// Saved-Loadout Wire Format Is Unchanged" (issue #314)
//
// `savedId` is client-only provenance: it travels on the request envelope as `id` when
// a loaded loadout writes back to its own record, but it MUST NOT enter `data`, a share
// URL, or a local draft. These tests pin both sides: the request-body presence, and the
// wire-format absence.
describe("savedId on save (id-addressed writes)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const bodyOf = (call) => JSON.parse(call[1].body);

  it("sends id in the request body when savedId is set", async () => {
    global.fetch.mockResolvedValueOnce(respond({ id: "rec-1", name: "My Loadout", data: {}, listId: null }));
    const store = makeStore();
    store.dispatch({ type: "loadout/setSavedId", payload: "rec-1" });

    await store.dispatch(saveCurrent());

    const [url, opts] = global.fetch.mock.calls.at(-1);
    expect(String(url)).toMatch(/\/api\/loadouts$/);
    expect(opts.method).toBe("POST");
    expect(bodyOf(global.fetch.mock.calls.at(-1)).id).toBe("rec-1");
  });

  it("omits the id key entirely when savedId is null", async () => {
    global.fetch.mockResolvedValueOnce(respond({ id: "rec-2", name: "My Loadout", data: {}, listId: null }));
    const store = makeStore();
    // savedId is null by default (the `?? null` clear in setLoadout).
    expect(store.getState().loadout.savedId).toBeNull();

    await store.dispatch(saveCurrent());

    const [url, opts] = global.fetch.mock.calls.at(-1);
    expect(String(url)).toMatch(/\/api\/loadouts$/);
    expect(opts.method).toBe("POST");
    expect(bodyOf(global.fetch.mock.calls.at(-1))).not.toHaveProperty("id");
  });

  it("sets savedId from the response after a successful first save", async () => {
    global.fetch.mockResolvedValueOnce(respond({ id: "rec-3", name: "My Loadout", data: {}, listId: null }));
    const store = makeStore();
    expect(store.getState().loadout.savedId).toBeNull();

    await store.dispatch(saveCurrent());
    expect(store.getState().loadout.savedId).toBe("rec-3");
  });
});

// Governing: ADR-0022 "The exception, and what it costs" (issue #136's follow-up,
// "a distinct way to save a loadout vs saving it as a new one")
//
// saveCurrentAsNew is the second caller of the upsert-without-id path ADR-0022 already
// built for a build with nothing loaded. These tests pin the one thing that path is FOR:
// it must never carry `id`, even when `loadout.savedId` is set — the whole point is to
// stop addressing the record the build was loaded from.
describe("saveCurrentAsNew (issue #136 follow-up)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const bodyOf = (call) => JSON.parse(call[1].body);

  it("omits id even when savedId is set — it must not write back to the loaded record", async () => {
    global.fetch.mockResolvedValueOnce(respond({ id: "rec-new", name: "My Loadout", data: {}, listId: null }));
    const store = makeStore();
    store.dispatch({ type: "loadout/setSavedId", payload: "rec-original" });

    await store.dispatch(saveCurrentAsNew());

    const [url, opts] = global.fetch.mock.calls.at(-1);
    expect(String(url)).toMatch(/\/api\/loadouts$/);
    expect(opts.method).toBe("POST");
    expect(bodyOf(global.fetch.mock.calls.at(-1))).not.toHaveProperty("id");
  });

  it("attaches savedId to the NEW record returned, not the one it started from", async () => {
    global.fetch.mockResolvedValueOnce(respond({ id: "rec-new", name: "My Loadout", data: {}, listId: null }));
    const store = makeStore();
    store.dispatch({ type: "loadout/setSavedId", payload: "rec-original" });

    await store.dispatch(saveCurrentAsNew());

    expect(store.getState().loadout.savedId).toBe("rec-new");
  });

  it("adds the new record to savedLoadouts.items without disturbing the original", async () => {
    global.fetch.mockResolvedValueOnce(respond({ id: "rec-new", name: "My Loadout", data: {}, listId: null }));
    const store = makeStore();
    store.dispatch({
      type: "savedLoadouts/fetch/fulfilled",
      payload: [{ id: "rec-original", name: "My Loadout", data: {}, listId: null }],
    });
    store.dispatch({ type: "loadout/setSavedId", payload: "rec-original" });

    await store.dispatch(saveCurrentAsNew());

    const ids = store.getState().savedLoadouts.items.map((l) => l.id).sort();
    expect(ids).toEqual(["rec-new", "rec-original"]);
  });

  it("surfaces a failure with the error prefix, naming it as a save-as-new", async () => {
    global.fetch.mockResolvedValueOnce(respond({}, 500));
    const store = makeStore();

    await store.dispatch(saveCurrentAsNew());

    expect(store.getState().ui.message.startsWith("!")).toBe(true);
    expect(store.getState().ui.message).toContain("as a new loadout");
  });

  // The scenario the button exists for: branch off a loaded record without touching it. The
  // ordinary case is an UNCHANGED name and destination, which is exactly the triple ADR-0022's
  // upsert-without-id path matches on — left alone, this would silently overwrite the very
  // record "Save as new" promises not to touch.
  it("auto-renames on a same-name-same-list collision instead of overwriting the original", async () => {
    global.fetch.mockResolvedValueOnce(
      respond({ id: "rec-copy", name: "My Loadout (2)", data: {}, listId: null })
    );
    const store = makeStore();
    store.dispatch({
      type: "savedLoadouts/fetch/fulfilled",
      payload: [{ id: "rec-original", name: "My Loadout", data: {}, listId: null }],
    });
    store.dispatch({ type: "loadout/setSavedId", payload: "rec-original" });
    // makeStore's preloaded name is already "My Loadout" — the exact name of the item just
    // seeded above, so this collides without any further setup.

    await store.dispatch(saveCurrentAsNew());

    const [, opts] = global.fetch.mock.calls.at(-1);
    const body = JSON.parse(opts.body);
    expect(body.name).toBe("My Loadout (2)");
    expect(body).not.toHaveProperty("id");
    // The field itself is updated too, so the NEXT save (id-addressed, since savedId is now
    // set) writes the disambiguated name back onto the new record rather than reverting it.
    expect(store.getState().loadout.name).toBe("My Loadout (2)");
    expect(store.getState().loadout.savedId).toBe("rec-copy");
    expect(store.getState().ui.message).toContain("renamed to “My Loadout (2)”");
    expect(store.getState().ui.message).toContain("avoid overwriting “My Loadout”");
  });

  it("counts up past a taken (2) to find a free disambiguator", async () => {
    global.fetch.mockResolvedValueOnce(
      respond({ id: "rec-copy-3", name: "My Loadout (3)", data: {}, listId: null })
    );
    const store = makeStore();
    store.dispatch({
      type: "savedLoadouts/fetch/fulfilled",
      payload: [
        { id: "rec-original", name: "My Loadout", data: {}, listId: null },
        { id: "rec-copy-2", name: "My Loadout (2)", data: {}, listId: null },
      ],
    });
    store.dispatch({ type: "loadout/setSavedId", payload: "rec-original" });

    await store.dispatch(saveCurrentAsNew());

    const body = JSON.parse(global.fetch.mock.calls.at(-1)[1].body);
    expect(body.name).toBe("My Loadout (3)");
  });

  it("does not rename when the destination list differs, even with the same name", async () => {
    // The collision key is (listId, name), matching the server's own upsert key — a same-named
    // loadout in a DIFFERENT list is not the record this save would touch, so nothing needs to
    // change to keep it distinct.
    global.fetch.mockResolvedValueOnce(
      respond({ id: "rec-copy", name: "My Loadout", data: {}, listId: "other-list" })
    );
    const store = makeStore();
    store.dispatch({
      type: "loadoutLists/fetch/fulfilled",
      payload: [{ id: "other-list", name: "Other list", hunterId: null, accent: "#000", createdAt: "2026-01-01" }],
    });
    store.dispatch({
      type: "savedLoadouts/fetch/fulfilled",
      payload: [{ id: "rec-original", name: "My Loadout", data: {}, listId: null }],
    });
    store.dispatch({ type: "ui/selectList", payload: "other-list" });
    store.dispatch({ type: "loadout/setSavedId", payload: "rec-original" });

    await store.dispatch(saveCurrentAsNew());

    const body = JSON.parse(global.fetch.mock.calls.at(-1)[1].body);
    expect(body.name).toBe("My Loadout");
    expect(store.getState().loadout.name).toBe("My Loadout");
  });
});

// Governing: SPEC-0003 REQ "The Saved-Loadout Wire Format Is Unchanged" — `savedId`
// MUST NOT appear in `data`, in a share code, or in a local draft. `toData()` never reads
// it, and `encodeShareCode` routes through `toData`, so both are clean by construction.
// These tests pin that invariant: they fail if `toData` or `encodeShareCode` ever reads
// `savedId`.
describe("savedId never enters the wire format", () => {
  it("toData output contains no savedId key", () => {
    const lo = { ...emptyLoadout(), savedId: "leaked-id", name: "Test" };
    const enc = toData(lo);
    expect(enc).not.toHaveProperty("savedId");
    // The wire keys are exactly the format's own, and nothing more.
    expect(Object.keys(enc).sort()).toEqual(["b", "e", "n", "tr", "v", "w"]);
  });

  it("an encoded share code does not contain the savedId", () => {
    const lo = { ...emptyLoadout(), savedId: "leaked-id", name: "Test" };
    const code = encodeShareCode(lo);
    expect(code).not.toContain("leaked-id");
    expect(code).not.toContain("savedId");
  });
});

// Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List" (issue #314)
//
// Deleting the record a loaded loadout came from clears its `savedId`. The server answers
// an unresolvable id with a 404 rather than falling back to the triple, so a provenance
// left pointing at a deleted record makes every later save of the build still on screen
// fail — with no way to clear it short of discarding that build.
//
// The build survives the deletion; only the pointer to the record goes.
describe("savedId is cleared when its record is deleted", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears savedId when the loaded record is the one deleted", async () => {
    global.fetch.mockResolvedValueOnce(respond({}, 204));
    const store = makeStore();
    store.dispatch({ type: "loadout/setSavedId", payload: "rec-loaded" });

    await store.dispatch(deleteSaved("rec-loaded"));

    expect(store.getState().loadout.savedId).toBeNull();
  });

  it("leaves savedId alone when some other record is deleted", async () => {
    global.fetch.mockResolvedValueOnce(respond({}, 204));
    const store = makeStore();
    store.dispatch({ type: "loadout/setSavedId", payload: "rec-loaded" });

    await store.dispatch(deleteSaved("rec-someone-else"));

    // Clearing unconditionally would silently demote a loaded loadout to a fresh one —
    // the same defect from the other direction.
    expect(store.getState().loadout.savedId).toBe("rec-loaded");
  });

  it("leaves savedId alone when the delete fails", async () => {
    global.fetch.mockResolvedValueOnce(respond({}, 500));
    const store = makeStore();
    store.dispatch({ type: "loadout/setSavedId", payload: "rec-loaded" });

    await store.dispatch(deleteSaved("rec-loaded"));

    // The record still exists, so the provenance is still good.
    expect(store.getState().loadout.savedId).toBe("rec-loaded");
  });

  it("a save after deleting the loaded record omits id and upserts on the triple", async () => {
    global.fetch
      .mockResolvedValueOnce(respond({}, 204))
      .mockResolvedValueOnce(respond({ id: "rec-new", name: "My Loadout", data: {}, listId: null }));
    const store = makeStore();
    store.dispatch({ type: "loadout/setSavedId", payload: "rec-loaded" });

    await store.dispatch(deleteSaved("rec-loaded"));
    await store.dispatch(saveCurrent());

    const body = JSON.parse(global.fetch.mock.calls.at(-1)[1].body);
    expect(body).not.toHaveProperty("id");
    expect(store.getState().ui.message.startsWith("!")).toBe(false);
  });
});

// Governing: SPEC-0003 REQ "Loadouts Within a List Have a User-Chosen Order".
describe("reorderSaved", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the full listId and order in one PATCH to /reorder", async () => {
    global.fetch.mockResolvedValueOnce(
      respond([
        { id: "b", name: "B", data: {}, listId: null, order: 0 },
        { id: "a", name: "A", data: {}, listId: null, order: 1 },
      ])
    );
    const store = makeStore();

    await store.dispatch(reorderSaved({ listId: null, order: ["b", "a"] }));

    const [url, opts] = global.fetch.mock.calls.at(-1);
    expect(String(url)).toMatch(/\/api\/loadouts\/reorder$/);
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ listId: null, order: ["b", "a"] });
  });

  it("replaces every returned record in savedLoadouts.items by id", async () => {
    global.fetch.mockResolvedValueOnce(
      respond([
        { id: "a", name: "A", data: {}, listId: null, order: 1 },
        { id: "b", name: "B", data: {}, listId: null, order: 0 },
      ])
    );
    const store = makeStore();
    store.dispatch({
      type: "savedLoadouts/fetch/fulfilled",
      payload: [
        { id: "a", name: "A", data: {}, listId: null, order: 0 },
        { id: "b", name: "B", data: {}, listId: null, order: 1 },
      ],
    });

    await store.dispatch(reorderSaved({ listId: null, order: ["b", "a"] }));

    const byId = Object.fromEntries(store.getState().savedLoadouts.items.map((l) => [l.id, l.order]));
    expect(byId.a).toBe(1);
    expect(byId.b).toBe(0);
  });

  it("does not touch a record outside the reordered scope", async () => {
    global.fetch.mockResolvedValueOnce(
      respond([{ id: "a", name: "A", data: {}, listId: null, order: 0 }])
    );
    const store = makeStore();
    store.dispatch({
      type: "savedLoadouts/fetch/fulfilled",
      payload: [
        { id: "a", name: "A", data: {}, listId: null, order: 0 },
        { id: "elsewhere", name: "Elsewhere", data: {}, listId: "some-list", order: 0 },
      ],
    });

    await store.dispatch(reorderSaved({ listId: null, order: ["a"] }));

    const elsewhere = store.getState().savedLoadouts.items.find((l) => l.id === "elsewhere");
    expect(elsewhere).toEqual({ id: "elsewhere", name: "Elsewhere", data: {}, listId: "some-list", order: 0 });
  });

  it("surfaces a failure with the error prefix and posts no success message on success", async () => {
    global.fetch.mockResolvedValueOnce(respond({ error: "bad scope" }, 400));
    const store = makeStore();

    await store.dispatch(reorderSaved({ listId: null, order: ["a", "b"] }));

    expect(store.getState().ui.message.startsWith("!")).toBe(true);
    expect(store.getState().ui.message).toContain("Couldn't reorder loadouts");
  });

  it("leaves ui.message untouched on a successful reorder", async () => {
    global.fetch.mockResolvedValueOnce(
      respond([{ id: "a", name: "A", data: {}, listId: null, order: 0 }])
    );
    const store = makeStore();

    await store.dispatch(reorderSaved({ listId: null, order: ["a"] }));

    expect(store.getState().ui.message).toBe("");
  });
});
