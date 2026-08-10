import { configureStore } from "@reduxjs/toolkit";
import loadoutReducer from "./loadoutSlice.js";
import uiReducer from "./uiSlice.js";
import savedLoadoutsReducer from "./savedLoadoutsSlice.js";
import loadoutListsReducer from "./loadoutListsSlice.js";
import { writeStoredLoadout } from "../utils/loadoutCodec.js";

export const store = configureStore({
  reducer: {
    loadout: loadoutReducer,
    ui: uiReducer,
    savedLoadouts: savedLoadoutsReducer,
    loadoutLists: loadoutListsReducer,
  },
});

// Persist the in-progress build to localStorage on every change, mirroring the
// original prototype's persist()-on-every-mutation behavior.
let prevLoadout = store.getState().loadout;
store.subscribe(() => {
  const nextLoadout = store.getState().loadout;
  if (nextLoadout !== prevLoadout) {
    prevLoadout = nextLoadout;
    writeStoredLoadout(nextLoadout);
  }
});
