import { configureStore } from "@reduxjs/toolkit";
import loadoutReducer from "../store/loadoutSlice.js";
import uiReducer from "../store/uiSlice.js";
import savedLoadoutsReducer from "../store/savedLoadoutsSlice.js";
import { emptyLoadout } from "../utils/loadoutCodec.js";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Covers: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"
//
// Test-only store factory. Deliberately builds a fresh store from the same slice reducers as
// client/src/store/index.js rather than importing the real app singleton — the real module has a
// module-scope `store.subscribe(...)` side effect that persists every loadout change to
// localStorage, which we don't want firing (and accumulating state) across unrelated test files.
export function createTestStore(preloadedState) {
  return configureStore({
    reducer: {
      loadout: loadoutReducer,
      ui: uiReducer,
      savedLoadouts: savedLoadoutsReducer,
    },
    preloadedState,
  });
}

export function loadoutState(overrides) {
  return { ...emptyLoadout(), ...overrides };
}
