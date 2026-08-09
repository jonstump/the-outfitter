import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { deleteLoadout, getLoadouts, upsertLoadout } from "../api/loadouts.js";
import { toData } from "../utils/loadoutCodec.js";
import { uiActions } from "./uiSlice.js";

// Failed save/delete/fetch attempts surface through the same ui.message banner
// that success messages use, so errors are at least as visible as successes
// (issue #20). Each thunk reports its own failure via dispatch.
export const fetchSaved = createAsyncThunk("savedLoadouts/fetch", async (_arg, { dispatch }) => {
  try {
    return await getLoadouts();
  } catch (err) {
    dispatch(uiActions.setMessage(`!!Couldn't load saved loadouts: ${err.message}`));
    throw err;
  }
});

export const saveCurrent = createAsyncThunk("savedLoadouts/save", async (_arg, { getState, dispatch }) => {
  const { loadout } = getState();
  const name = loadout.name.trim() || "Unnamed loadout";
  try {
    const record = await upsertLoadout(name, toData({ ...loadout, name }));
    dispatch(uiActions.setMessage(`Saved “${name}”.`));
    return record;
  } catch (err) {
    dispatch(uiActions.setMessage(`!Couldn't save “${name}”: ${err.message}`));
    throw err;
  }
});

export const deleteSaved = createAsyncThunk("savedLoadouts/delete", async (id, { dispatch }) => {
  try {
    await deleteLoadout(id);
    return id;
  } catch (err) {
    dispatch(uiActions.setMessage(`!Couldn't delete loadout: ${err.message}`));
    throw err;
  }
});

const savedLoadoutsSlice = createSlice({
  name: "savedLoadouts",
  initialState: { items: [], status: "idle", error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSaved.pending, (state) => {
        state.status = "loading";
      })
      .addCase(fetchSaved.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.items = action.payload;
      })
      .addCase(fetchSaved.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
      })
      .addCase(saveCurrent.fulfilled, (state, action) => {
        const idx = state.items.findIndex((l) => l.id === action.payload.id);
        if (idx >= 0) state.items[idx] = action.payload;
        else state.items.push(action.payload);
      })
      .addCase(deleteSaved.fulfilled, (state, action) => {
        state.items = state.items.filter((l) => l.id !== action.payload);
      });
  },
});

export default savedLoadoutsSlice.reducer;
