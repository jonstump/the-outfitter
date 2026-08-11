// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists), SPEC-0003 REQ
// "New Lists Default Their Name from the Chosen Portrait", SPEC-0003 REQ "List Ordering
// and Sorting"

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { createList, describeList, getLists, retireList, updateList } from "../api/loadouts.js";
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
 *
 * Governing: SPEC-0003 REQ "Lists Are Visually Distinguishable Independent of Portrait and
 * Name" — "the creating user MAY supply an accent, which SHALL be validated against the
 * palette and used as given. When the user supplies none, assignment on creation SHALL
 * select the least-used palette value among the owner's existing lists."
 *
 * `accent` defaults to null and is OMITTED from the request when absent, rather than sent as
 * null (#135). That is the difference between the two branches of the requirement: the server
 * reads `accent ?? nextAccent(...)`, so an omitted key reaches least-used assignment and a
 * present one is used as given. A caller with no accent to offer must therefore be able to
 * say nothing at all, which is what `createList` does with it.
 */
export const createListThunk = createAsyncThunk(
  "loadoutLists/create",
  async ({ name, hunterId = null, hunterName = null, accent = null }, { dispatch }) => {
    const resolved = (name || "").trim() || hunterName || "New list";
    try {
      const record = await createList({ name: resolved, hunterId, accent });
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
/**
 * Change a list's accent colour.
 *
 * Governing: SPEC-0003 REQ "Lists Are Visually Distinguishable Independent of Portrait
 * and Name".
 *
 * There is deliberately no duplicate check anywhere on this path — not here, not in the
 * component, not on the server. Assigning an accent another list already uses is a
 * permitted outcome the spec requires to succeed "without warning or rejection", and six
 * palette values against an unbounded number of lists makes collision inevitable rather
 * than exceptional. The accent is a secondary identity channel; the list NAME is the
 * primary one, which is why a collision costs nothing.
 */
export const setListAccentThunk = createAsyncThunk(
  "loadoutLists/setAccent",
  async ({ id, accent }, { dispatch }) => {
    try {
      return await updateList(id, { accent });
    } catch (err) {
      dispatch(uiActions.setMessage(`!Couldn't change the accent colour: ${err.message}`));
      throw err;
    }
  }
);

/**
 * Describe a list, or restore it to inheriting its hunter's description.
 *
 * Governing: ADR-0007 (dataset carries descriptions), SPEC-0003 REQ "Lists Carry an Editable
 * Description".
 *
 * `description` is passed STRAIGHT THROUGH, null included, because null is a value here and
 * not a missing argument: it is the restore. A default parameter or a `|| ""` anywhere on this
 * path would turn "go back to inheriting" into "store the blank state" — the two states the
 * spec's risk register is about, collapsed by a convenience.
 *
 * The list's name is taken as an argument rather than read from the store so the failure
 * banner can name the list even when the write is what failed.
 */
export const describeListThunk = createAsyncThunk(
  "loadoutLists/describe",
  async ({ id, description, listName }, { dispatch }) => {
    try {
      return await describeList(id, description);
    } catch (err) {
      dispatch(uiActions.setMessage(`!Couldn't update the description for “${listName}”: ${err.message}`));
      throw err;
    }
  }
);

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
      // Stale-selection reconciliation is handled in uiSlice's extraReducers on this same
      // action — it owns selectedListId, and doing it there fixes every consumer at once
      // rather than only the render path.
      .addCase(fetchLists.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
      })
      .addCase(createListThunk.fulfilled, (state, action) => {
        state.items.push(action.payload);
      })
      // Rename, accent and describe all PATCH the record and get the whole updated record
      // back, so they reconcile identically — replace in place, keep position, never re-sort
      // here. Replacing the WHOLE record is what keeps a restored description correct: the
      // server's answer carries `description: null`, and merging fields instead would leave
      // the old text sitting under a null that never overwrote it.
      .addCase(renameListThunk.fulfilled, (state, action) => {
        const idx = state.items.findIndex((l) => l.id === action.payload.id);
        if (idx >= 0) state.items[idx] = action.payload;
      })
      .addCase(setListAccentThunk.fulfilled, (state, action) => {
        const idx = state.items.findIndex((l) => l.id === action.payload.id);
        if (idx >= 0) state.items[idx] = action.payload;
      })
      .addCase(describeListThunk.fulfilled, (state, action) => {
        const idx = state.items.findIndex((l) => l.id === action.payload.id);
        if (idx >= 0) state.items[idx] = action.payload;
      })
      .addCase(retireListThunk.fulfilled, (state, action) => {
        state.items = state.items.filter((l) => l.id !== action.payload);
      });
  },
});

export default loadoutListsSlice.reducer;
