// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists), SPEC-0003 REQ
// "New Lists Default Their Name from the Chosen Portrait", SPEC-0003 REQ "List Ordering
// and Sorting"

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { createList, getLists, retireList, updateList } from "../api/loadouts.js";
import { uiActions } from "./uiSlice.js";

// Failed list operations surface through the same ui.message banner that save/delete
// failures already use (issue #20), so a failure is at least as visible as a success.
// SPEC-0003 REQ "Error Handling Standards" requires exactly this.

export const fetchLists = createAsyncThunk("loadoutLists/fetch", async (_arg, { dispatch }) => {
  try {
    return await getLists();
  } catch (err) {
    dispatch(uiActions.setMessage(`!Couldn't load your lists: ${err.message}`));
    throw err;
  }
});

/**
 * Create a list.
 *
 * SPEC-0003: when the caller picks a hunter but supplies no name, the list's name
 * defaults to that hunter's display name. The defaulted name is an ordinary mutable
 * value — indistinguishable in storage from one the user typed — so renaming later is
 * just a rename. With neither a name nor a hunter, a generic default applies.
 */
export const createListThunk = createAsyncThunk(
  "loadoutLists/create",
  async ({ name, hunterId = null, hunterName = null }, { dispatch }) => {
    const resolved = (name || "").trim() || hunterName || "New list";
    try {
      const record = await createList({ name: resolved, hunterId });
      dispatch(uiActions.setMessage(`Created “${record.name}”.`));
      return record;
    } catch (err) {
      dispatch(uiActions.setMessage(`!Couldn't create “${resolved}”: ${err.message}`));
      throw err;
    }
  }
);

export const renameListThunk = createAsyncThunk(
  "loadoutLists/rename",
  async ({ id, name }, { dispatch }) => {
    const trimmed = (name || "").trim();
    try {
      return await updateList(id, { name: trimmed });
    } catch (err) {
      dispatch(uiActions.setMessage(`!Couldn't rename the list: ${err.message}`));
      throw err;
    }
  }
);

/**
 * Retire a list.
 *
 * The server deletes the list and clears `listId` on its loadouts in one write — the
 * loadouts survive and land in Unassigned. Nothing here deletes a loadout, and the
 * confirmation copy says so.
 */
export const retireListThunk = createAsyncThunk(
  "loadoutLists/retire",
  async ({ id, name }, { dispatch }) => {
    try {
      await retireList(id);
      dispatch(uiActions.setMessage(`Retired “${name}”. Its loadouts moved to Unassigned.`));
      return id;
    } catch (err) {
      dispatch(uiActions.setMessage(`!Couldn't retire “${name}”: ${err.message}`));
      throw err;
    }
  }
);

const loadoutListsSlice = createSlice({
  name: "loadoutLists",
  initialState: { items: [], status: "idle", error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchLists.pending, (state) => {
        state.status = "loading";
      })
      .addCase(fetchLists.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.items = action.payload;
      })
      .addCase(fetchLists.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
      })
      .addCase(createListThunk.fulfilled, (state, action) => {
        state.items.push(action.payload);
      })
      .addCase(renameListThunk.fulfilled, (state, action) => {
        const idx = state.items.findIndex((l) => l.id === action.payload.id);
        if (idx >= 0) state.items[idx] = action.payload;
      })
      .addCase(retireListThunk.fulfilled, (state, action) => {
        state.items = state.items.filter((l) => l.id !== action.payload);
      });
  },
});

export default loadoutListsSlice.reducer;
