import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { deleteLoadout, getLoadouts, upsertLoadout } from "../api/loadouts.js";
import { toData } from "../utils/loadoutCodec.js";
import { uiActions } from "./uiSlice.js";

export const fetchSaved = createAsyncThunk("savedLoadouts/fetch", async () => getLoadouts());

export const saveCurrent = createAsyncThunk("savedLoadouts/save", async (_arg, { getState, dispatch }) => {
  const { loadout } = getState();
  const name = loadout.name.trim() || "Unnamed loadout";
  const record = await upsertLoadout(name, toData({ ...loadout, name }));
  dispatch(uiActions.setMessage(`Saved “${name}”.`));
  return record;
});

export const deleteSaved = createAsyncThunk("savedLoadouts/delete", async (id) => {
  await deleteLoadout(id);
  return id;
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
