// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists), ADR-0007 (hunter
// roster dataset), SPEC-0003 REQ "Favorite Hunters", SPEC-0003 REQ "Error Handling
// Standards"
//
// The durable half of favorites: which hunter ids this browser's token has favorited.
//
// What is deliberately NOT in this slice is the "favorites only" toggle. That is a view
// preference — client state under the same rule as the selected list and the sort order —
// and it lives in the picker that renders it. Keeping it out of here is what stops it
// drifting toward a server round-trip later.
//
// `ids` is an array rather than a Set because Redux state must stay serialisable; the one
// consumer that needs membership lookups builds a Set at the point of use.

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { favoriteHunter, getFavorites, unfavoriteHunter } from "../api/loadouts.js";
import { uiActions } from "./uiSlice.js";

// Failures surface through the same ui.message banner save/delete/list failures use, so a
// failed favorite is at least as visible as a successful one (REQ "Error Handling
// Standards"). Nothing here swallows an error: every catch reports and rethrows.

export const fetchFavorites = createAsyncThunk("hunterFavorites/fetch", async (_arg, { dispatch }) => {
  try {
    const records = await getFavorites();
    return records.map((f) => f.hunterId);
  } catch (err) {
    dispatch(uiActions.setMessage(`!Couldn't load your favorite hunters: ${err.message}`));
    throw err;
  }
});

/**
 * Favorite a hunter.
 *
 * `hunterName` is carried for the message only — the server is told the id and nothing
 * else. Favoriting an already-favorited hunter is a server-side no-op that returns the
 * existing record, so a double-click cannot produce two favorites.
 */
export const favoriteHunterThunk = createAsyncThunk(
  "hunterFavorites/favorite",
  async ({ hunterId, hunterName = null }, { dispatch }) => {
    try {
      await favoriteHunter(hunterId);
      return hunterId;
    } catch (err) {
      dispatch(
        uiActions.setMessage(`!Couldn't favorite ${hunterName || hunterId}: ${err.message}`)
      );
      throw err;
    }
  }
);

/** Unfavorite a hunter. Unfavoriting one that is not favorited succeeds and changes nothing. */
export const unfavoriteHunterThunk = createAsyncThunk(
  "hunterFavorites/unfavorite",
  async ({ hunterId, hunterName = null }, { dispatch }) => {
    try {
      await unfavoriteHunter(hunterId);
      return hunterId;
    } catch (err) {
      dispatch(
        uiActions.setMessage(`!Couldn't unfavorite ${hunterName || hunterId}: ${err.message}`)
      );
      throw err;
    }
  }
);

const hunterFavoritesSlice = createSlice({
  name: "hunterFavorites",
  // `ids: []` is the correct initial state and also the correct state for a brand-new
  // token: SPEC-0003 forbids pre-populating favorites, so there is nothing to seed here.
  initialState: { ids: [], status: "idle", error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchFavorites.pending, (state) => {
        state.status = "loading";
      })
      .addCase(fetchFavorites.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.ids = action.payload;
      })
      .addCase(fetchFavorites.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.error.message;
        // `ids` is left alone rather than cleared: a failed refetch is not evidence that
        // the user unfavorited anything, and blanking the list would silently collapse the
        // Favorites section the picker is already rendering.
      })
      // Both reducers are idempotent in the same way their endpoints are, so a duplicate
      // fulfilment (two tabs, a retried request) converges instead of double-applying.
      .addCase(favoriteHunterThunk.fulfilled, (state, action) => {
        if (!state.ids.includes(action.payload)) state.ids.push(action.payload);
      })
      .addCase(unfavoriteHunterThunk.fulfilled, (state, action) => {
        state.ids = state.ids.filter((id) => id !== action.payload);
      });
  },
});

export default hunterFavoritesSlice.reducer;
