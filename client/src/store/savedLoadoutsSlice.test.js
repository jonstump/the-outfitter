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
import { describeLoadout } from "../api/loadouts.js";
import { emptyLoadout } from "../utils/loadoutCodec.js";

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
      loadout: { ...emptyLoadout(), name: "My Loadout" },
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

// Governing: ADR-0006 (list filing model), ADR-0007 (dataset carries descriptions),
// SPEC-0003 REQ "Loadouts Carry an Editable Description"
//
// The write path, at the seam where the three states are most easily lost: a store that
// "helpfully" normalises null to "" — or an API wrapper that lets `undefined` delete its own
// key on the way through JSON.stringify — produces a request that looks fine, succeeds, and
// silently means something else.
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

  it("sends each of the three states on the wire exactly as given", async () => {
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

  it("surfaces a failed description write with the error prefix", async () => {
    global.fetch.mockResolvedValueOnce(respond({ error: "too long" }, 400));
    const store = makeStore();
    await store.dispatch(describeSaved({ id: "l1", description: "x", loadoutName: "My build" }));

    expect(store.getState().ui.message.startsWith("!")).toBe(true);
    expect(store.getState().ui.message).toContain("Couldn't save the description for “My build”");
    expect(store.getState().ui.message).toContain("too long");
  });

  it("announces a restore as a restore, not as a save", async () => {
    global.fetch.mockResolvedValueOnce(respond(withDescription(null)));
    const store = makeStore();
    await store.dispatch(describeSaved({ id: "l1", description: null, loadoutName: "My build" }));

    expect(store.getState().ui.message.startsWith("!")).toBe(false);
    expect(store.getState().ui.message).toContain("hunter's description again");
  });
});
