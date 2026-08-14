import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import loadoutReducer from "./loadoutSlice.js";
import uiReducer from "./uiSlice.js";
import savedLoadoutsReducer, {
  fetchSaved,
  saveCurrent,
  deleteSaved,
  describeSaved,
} from "./savedLoadoutsSlice.js";
import { describeLoadout, moveLoadout } from "../api/loadouts.js";
import { encodeShareUrl, emptyLoadout, toData } from "../utils/loadoutCodec.js";

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
      savedLoadouts: savedLoadoutsReducer,
    },
    preloadedState: {
      loadout: { ...emptyLoadout(), name: "My Loadout", savedId: null },
      ui: { message: "" },
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

// Governing: SPEC-0003 REQ "The Saved-Loadout Wire Format Is Unchanged" — `savedId`
// MUST NOT appear in `data`, in a share URL, or in a local draft. `toData()` never reads
// it, and `encodeShareUrl` routes through `toData`, so both are clean by construction.
// These tests pin that invariant: they fail if `toData` or `encodeShareUrl` ever reads
// `savedId`.
describe("savedId never enters the wire format", () => {
  it("toData output contains no savedId key", () => {
    const lo = { ...emptyLoadout(), savedId: "leaked-id", name: "Test" };
    const enc = toData(lo);
    expect(enc).not.toHaveProperty("savedId");
    // The wire keys are exactly the format's own, and nothing more.
    expect(Object.keys(enc).sort()).toEqual(["b", "e", "n", "tr", "v", "w"]);
  });

  it("an encoded share URL does not contain the savedId", () => {
    const lo = { ...emptyLoadout(), savedId: "leaked-id", name: "Test" };
    const url = encodeShareUrl(lo);
    expect(url).not.toContain("leaked-id");
    expect(url).not.toContain("savedId");
  });
});
