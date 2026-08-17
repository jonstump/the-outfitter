import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { deleteLoadout, describeLoadout, getLoadouts, moveLoadout, upsertLoadout } from "../api/loadouts.js";
import { toData } from "../utils/loadoutCodec.js";
import { loadoutActions } from "./loadoutSlice.js";
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
 * used to announce it from the top of the lists panel). One rule, so the button and the write
 * cannot come to different answers — see `selectSaveDestinationName`, which is explicit that
 * they agree by construction today and that the shared call is what keeps them agreeing if
 * this rule ever grows a condition beyond "the list exists".
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
    const record = await upsertLoadout(name, toData({ ...loadout, name }), listId, loadout.savedId);
    // Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List" —
    // set `savedId` from the returned record's id so a fresh build which has just been
    // saved for the first time becomes "loaded" and subsequent saves address it by id.
    dispatch(loadoutActions.setSavedId(record.id));
    dispatch(uiActions.setMessage(`Saved “${name}”.`));
    return record;
  } catch (err) {
    dispatch(uiActions.setMessage(`!Couldn't save “${name}”: ${err.message}`));
    throw err;
  }
});

// Governing: ADR-0022 "The exception, and what it costs" — "Saving without [savedId] upserts
// on (owner, listId, name)". ADR-0022 lists "any UI for resolving a deliberate
// same-name-same-list collision" as out of scope for THAT decision, made when the only caller
// of the no-id path was a build with nothing loaded — a collision there means the user typed an
// existing name on purpose. `saveCurrentAsNew` reopens exactly that question, because its
// caller is different: a build that already has a name, inherited by branching off a loaded
// record, so the ordinary case is "unchanged name, unchanged destination" — silently upserting
// onto the record it branched from would make "Save as new" indistinguishable from a plain
// re-save, which is the one outcome this button exists to rule out.
//
// So the collision is resolved HERE, client-side, before the request is sent: `uniqueName`
// appends " (2)", " (3)", … against the caller's OWN `savedLoadouts.items` until the
// (listId, name) pair is free, then that name is what gets saved and what `loadout.name`
// becomes. Renaming after the fact, rather than before, would leave a save in flight that could
// still collide if two saves race; renaming the local name first and using the result for both
// the request and `setName` keeps the two in agreement by construction.
function uniqueName(baseName, listId, items) {
  const collides = (candidate) => items.some((l) => (l.listId ?? null) === listId && l.name === candidate);
  if (!collides(baseName)) return baseName;
  let n = 2;
  while (collides(`${baseName} (${n})`)) n++;
  return `${baseName} (${n})`;
}

// On success `savedId` is set to the NEW record's id, same as `saveCurrent` — the session
// becomes attached to the copy it just wrote, the way a conventional "Save As" leaves the editor
// pointed at the new file rather than the one it was opened from. `loadout.name` is set too,
// via `setName` rather than left at the un-renamed value: `saveCurrent`'s id-addressed path
// always writes `loadout.name` back onto the record it addresses (savedLoadoutsSlice.js's own
// POST handler comment, "an id-addressed write updates the record where it lives"), so a save
// after this one — with the field still reading the ORIGINAL name — would rename the new record
// straight back to the name it was just disambiguated away from, recreating the collision this
// thunk exists to prevent.
export const saveCurrentAsNew = createAsyncThunk("savedLoadouts/saveAsNew", async (_arg, { getState, dispatch }) => {
  const state = getState();
  const baseName = state.loadout.name.trim() || "Unnamed loadout";
  const loadout = state.loadout;
  const listId = resolveSaveListId(state);
  const name = uniqueName(baseName, listId, state.savedLoadouts.items);

  try {
    const record = await upsertLoadout(name, toData({ ...loadout, name }), listId, null);
    dispatch(loadoutActions.setSavedId(record.id));
    if (name !== baseName) dispatch(loadoutActions.setName(name));
    dispatch(uiActions.setMessage(
      name === baseName
        ? `Saved “${name}” as a new loadout.`
        : `Saved as a new loadout, renamed to “${name}” to avoid overwriting “${baseName}”.`
    ));
    return record;
  } catch (err) {
    dispatch(uiActions.setMessage(`!Couldn't save “${baseName}” as a new loadout: ${err.message}`));
    throw err;
  }
});

// Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List"
//
// Deleting the record a loaded loadout came from CLEARS that loadout's `savedId`. The
// provenance addresses a record that no longer exists, and the server answers an
// unresolvable id with a 404 rather than falling back to the triple — deliberately, so
// that a stale id can neither mint a duplicate nor overwrite a same-named loadout. Left
// in place, the id would therefore make every subsequent save of the build still on
// screen fail, with no way to clear it short of discarding that build.
//
// The build itself is not the record: deleting the filing does not delete what the user
// is editing. Only the pointer goes, and the next save upserts on the triple as a
// never-saved build does.
//
// The id is compared before clearing. Deleting some OTHER loadout says nothing about the
// provenance of the one being edited, and clearing unconditionally would silently demote
// a loaded loadout to a fresh one — the same class of defect from the other direction.
export const deleteSaved = createAsyncThunk("savedLoadouts/delete", async (id, { getState, dispatch }) => {
  try {
    await deleteLoadout(id);
    if (getState().loadout.savedId === id) dispatch(loadoutActions.setSavedId(null));
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

// Governing: ADR-0006 (list filing model), SPEC-0003 REQ "Loadouts Carry a Description of
// Their Own"
//
// A loadout's description is the user's own note about the build. It inherits NOTHING — that
// is the list's description, which draws on the hunter the list depicts (#181) — so null and
// "" both mean "no note" and the thunk says so with one message rather than two.
//
// Nothing here coalesces, defaults or trims all the same. `description ?? ""` and a hopeful
// `.trim()` would each rewrite what the user typed on its way to the server, and the cap the
// server enforces governs exactly what it is sent. The value goes out as it came in.
export const describeSaved = createAsyncThunk(
  "savedLoadouts/describe",
  async ({ id, description, loadoutName }, { dispatch }) => {
    try {
      const record = await describeLoadout(id, description);
      dispatch(
        uiActions.setMessage(
          description === null || description === ""
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
      // Same list-reconciliation rule as saveCurrent.fulfilled above — the record this
      // resolves to is new far more often than not (that's the point of the button), but the
      // same-name-same-list collision ADR-0022 leaves unresolved can still land on an id
      // already in `items`, so this stays an upsert-by-id rather than an unconditional push.
      .addCase(saveCurrentAsNew.fulfilled, (state, action) => {
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
