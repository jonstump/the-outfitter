import { describe, expect, it } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { emptyLoadout } from "../utils/loadoutCodec.js";
import loadoutReducer from "./loadoutSlice.js";
import uiReducer from "./uiSlice.js";
import { loadSavedThunk, randomizeThunk } from "./thunks.js";

// Governing: issue #27 (randomize's payload must satisfy setLoadout's shape
// validation — a shape mismatch used to throw inside the reducer and crashed the
// Randomize button)

function makeStore() {
  return configureStore({
    reducer: {
      loadout: loadoutReducer,
      ui: uiReducer,
    },
    preloadedState: {
      loadout: { ...emptyLoadout(), savedId: null },
      ui: {
        tab: "Weapons",
        search: "",
        group: "All",
        sizeFilter: "All",
        ammoF: "All",
        budgetOn: false,
        budget: 300,
        upBudgetOn: false,
        upBudget: 5,
        message: "",
      },
    },
  });
}

const validData = {
  v: 2,
  w: [["nagant-m1895", -1], null],
  e: [["T", "first-aid-kit"], null, null, null, null, null, null, null],
  tr: ["quartermaster"],
  n: "Test build",
  b: [],
};

describe("randomizeThunk", () => {
  it("dispatches setLoadout without throwing (crash regression)", () => {
    const store = makeStore();
    // Randomize is fired directly from the button with no try/catch; if the
    // payload fails shape validation the reducer throws and the button dies.
    expect(() => store.dispatch(randomizeThunk())).not.toThrow();
    const s = store.getState().loadout;
    expect(Array.isArray(s.weapons)).toBe(true);
    expect(s.weapons).toHaveLength(2);
    expect(Array.isArray(s.equip)).toBe(true);
    expect(Array.isArray(s.traits)).toBe(true);
  });

  it("clears the message banner after randomizing", () => {
    const store = makeStore();
    store.dispatch({ type: "ui/setMessage", payload: "old banner" });
    store.dispatch(randomizeThunk());
    expect(store.getState().ui.message).toBe("");
  });

  // Governing: ADR-0022, SPEC-0003 REQ "The Saved-Loadout Wire Format Is Unchanged" —
  // a randomized loadout has no provenance, so `savedId` must be null. The `?? null`
  // default in `setLoadout` is what clears it.
  it("leaves savedId null after randomizing", () => {
    const store = makeStore();
    // Seed a savedId to prove randomize clears it.
    store.dispatch({ type: "loadout/setSavedId", payload: "some-existing-id" });
    expect(store.getState().loadout.savedId).toBe("some-existing-id");
    store.dispatch(randomizeThunk());
    expect(store.getState().loadout.savedId).toBeNull();
  });
});

// Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List" —
// loading a saved record puts `record.id` into `state.loadout.savedId` so a
// subsequent save addresses that record by id.
describe("loadSavedThunk", () => {
  it("puts record.id into state.loadout.savedId", () => {
    const store = makeStore();
    const record = { id: "abc-123", name: "My Build", data: validData };
    store.dispatch(loadSavedThunk(record));
    expect(store.getState().loadout.savedId).toBe("abc-123");
  });

  it("decodes the wire payload into the loadout state", () => {
    const store = makeStore();
    const record = { id: "abc-456", name: "Whatever", data: validData };
    store.dispatch(loadSavedThunk(record));
    const s = store.getState().loadout;
    expect(s.weapons).toHaveLength(2);
    expect(s.weapons[0]).not.toBeNull();
    expect(s.name).toBe("Test build");
  });

  it("announces the loaded record name in the message banner", () => {
    const store = makeStore();
    store.dispatch(loadSavedThunk({ id: "x", name: "Fanning", data: validData }));
    expect(store.getState().ui.message).toContain("Fanning");
  });
});
