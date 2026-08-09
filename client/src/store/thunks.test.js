import { describe, expect, it } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { emptyLoadout } from "../utils/loadoutCodec.js";
import loadoutReducer from "./loadoutSlice.js";
import uiReducer from "./uiSlice.js";
import { randomizeThunk } from "./thunks.js";

// Governing: issue #27 (randomize's payload must satisfy setLoadout's shape
// validation — a shape mismatch used to throw inside the reducer and crash the
// Randomize button)

function makeStore() {
  return configureStore({
    reducer: {
      loadout: loadoutReducer,
      ui: uiReducer,
    },
    preloadedState: {
      loadout: emptyLoadout(),
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
});
