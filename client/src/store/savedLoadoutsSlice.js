import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { deleteLoadout, describeLoadout, getLoadouts, moveLoadout, upsertLoadout } from "../api/loadouts.js";
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

/**
 * Where a save issued right now would file the loadout: a list id, or null for Unassigned.
 *
 * Governing: SPEC-0003 REQ "The Selected List Is Client State" — "while a list is selected, a
 * new save SHALL default to filing into that list", and "the user SHALL be able to save to
 * Unassigned without first deselecting". Unassigned is `ui.unassignedOpen`, never a listId, so
 * no sentinel can travel through here.
 *
 * Resolve rather than trust, symmetrically with the panel's render path: a stale
 * selectedListId — retired in another tab, or restored from localStorage before fetchLists has
 * resolved — would otherwise be sent as a real list id and 404 the save. uiSlice reconciles on
 * fetchLists.fulfilled; this closes the window before that lands.
 *
 * Exported, and a function of the whole state rather than a line inside the thunk, because
 * ActionsPanel's save button now NAMES this destination (issue #136, replacing the badge that
 * used to announce it from the top of the lists panel). A label derived from `selectedListId`
 * on its own would promise a list this function refuses to file into — precisely in the stale
 * case, which is the one a user cannot see coming. One rule, so the button and the write
 * cannot disagree.
 */
export function resolveSaveListId({ ui, loadoutLists }) {
  const selected = ui?.selectedListId;
  return selected && (loadoutLists?.items || []).some((l) => l.id === selected) ? selected : null;
}

export const saveCurrent = createAsyncThunk("savedLoadouts/save", async (_arg, { getState, dispatch }) => {
  const state = getState();
  const name = state.loadout.name.trim() || "Unnamed loadout";
  const loadout = state.loadout;
  const listId = resolveSaveListId(state);

  try {
    const record = await upsertLoadout(name, toData({ ...loadout, name }), listId);
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

// Governing: ADR-0006 (list filing model), ADR-0007 (dataset carries descriptions),
// SPEC-0003 REQ "Loadouts Carry an Editable Description"
//
// `description` arrives here in one of exactly three states and leaves in the same one:
// null (never edited — the card resolves the list hunter's text at render time), "" (the
// user deliberately blanked it) and a non-empty string (their own words). Nothing in this
// thunk coalesces, defaults or trims — `description ?? ""`, `description || null` and a
// hopeful `.trim()` are each a way of turning three states into two, and the state that
// disappears is always the one that lets a description be emptied.
//
// Restoring inheritance is the SAME write with `null`, which is why there is no separate
// "restore" thunk: the distinct action the spec requires is a distinct control on the card,
// not a distinct request. The server stores null; it never stores the resolved text.
export const describeSaved = createAsyncThunk(
  "savedLoadouts/describe",
  async ({ id, description, loadoutName }, { dispatch }) => {
    try {
      const record = await describeLoadout(id, description);
      dispatch(
        uiActions.setMessage(
          description === null
            ? `“${loadoutName}” is showing its hunter's description again.`
            : description === ""
              ? `Cleared the description for “${loadoutName}”.`
              : `Saved the description for “${loadoutName}”.`
        )
      );
      return record;
    } catch (err) {
      dispatch(uiActions.setMessage(`!Couldn't save the description for “${loadoutName}”: ${err.message}`));
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
      })
      // The server's record replaces the local one wholesale, exactly as a move does. It is
      // the authority on which of the three description states the loadout is now in, and
      // merging fields here would be a second place for them to be decided.
      .addCase(describeSaved.fulfilled, (state, action) => {
        const idx = state.items.findIndex((l) => l.id === action.payload.id);
        if (idx >= 0) state.items[idx] = action.payload;
      });
  },
});

export default savedLoadoutsSlice.reducer;
