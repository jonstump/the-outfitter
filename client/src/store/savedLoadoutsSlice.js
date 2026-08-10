import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { deleteLoadout, getLoadouts, moveLoadout, upsertLoadout } from "../api/loadouts.js";
import { toData } from "../utils/loadoutCodec.js";
import { uiActions } from "./uiSlice.js";

// Failed save/delete/fetch attempts surface through the same ui.message banner
// that success messages use, so errors are at least as visible as successes
// (issue #20). Each thunk reports its own failure via dispatch.
export const fetchSaved = createAsyncThunk("savedLoadouts/fetch", async (_arg, { dispatch }) => {
  try {
    return await getLoadouts();
  } catch (err) {
    dispatch(uiActions.setMessage(`!Couldn't load saved loadouts: ${err.message}`));
    throw err;
  }
});

export const saveCurrent = createAsyncThunk("savedLoadouts/save", async (_arg, { getState, dispatch }) => {
  const { loadout, ui } = getState();
  const name = loadout.name.trim() || "Unnamed loadout";
  try {
    // SPEC-0003 line 318: the user SHALL be able to save to Unassigned without first
    // deselecting. selectedListId is a real list id or null — Unassigned is tracked by
    // ui.unassignedOpen and never travels as a listId, so this cannot send a sentinel.
    const record = await upsertLoadout(name, toData({ ...loadout, name }), ui.selectedListId ?? null);
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

// Governing: SPEC-0003 REQ "Loadouts Are Filed into Lists by Nullable Reference"
//
// Moving is an explicit, keyboard-operable control on the loadout row — a select, not
// drag-and-drop. A successful move removes the row from the open list, so the outcome is
// announced politely; a failure reverts and is announced assertively, because a row that
// silently vanishes reads as data loss.
export const moveSaved = createAsyncThunk(
  "savedLoadouts/move",
  async ({ id, listId, loadoutName, listName }, { dispatch }) => {
    try {
      const record = await moveLoadout(id, listId);
      dispatch(
        uiActions.setMessage(`Moved “${loadoutName}” to ${listName || "Unassigned"}.`)
      );
      return record;
    } catch (err) {
      dispatch(uiActions.setMessage(`!Couldn't move “${loadoutName}”: ${err.message}`));
      throw err;
    }
  }
);

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
      })
      .addCase(moveSaved.fulfilled, (state, action) => {
        const idx = state.items.findIndex((l) => l.id === action.payload.id);
        if (idx >= 0) state.items[idx] = action.payload;
      });
  },
});

export default savedLoadoutsSlice.reducer;
