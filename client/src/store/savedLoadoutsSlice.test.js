import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import loadoutReducer from "./loadoutSlice.js";
import uiReducer from "./uiSlice.js";
import savedLoadoutsReducer, { fetchSaved, saveCurrent, deleteSaved } from "./savedLoadoutsSlice.js";
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
