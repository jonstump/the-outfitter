import { createSlice } from "@reduxjs/toolkit";
import { DEFAULT_SORT } from "../utils/listOrdering.js";

// Governing: ADR-0006, SPEC-0003 REQ "The Selected List Is Client State"
//
// selectedListId and listSort are cursors, not facts. Persisting them server-side would
// mean a write on every click and would make two tabs fight over which list is "current".
// The durable facts are which lists exist and where each loadout is filed; which one the
// user happens to be looking at is neither. selectedListId is mirrored to localStorage so
// it survives a reload, per-browser — which is the correct scope for a cursor.
export const LS_SELECTED_LIST = "hunt-outfitter-selected-list";

function readSelectedList() {
  try {
    return localStorage.getItem(LS_SELECTED_LIST) || null;
  } catch {
    return null; // private mode / storage disabled — the cursor simply does not persist
  }
}

const initialState = {
  tab: "Weapons",
  budgetOn: false,
  budget: 800,
  upBudgetOn: false,
  upBudget: 12,
  message: "",
  selectedListId: readSelectedList(),
  listSort: DEFAULT_SORT,
  creatingList: false,
  renamingListId: null,
  confirmRetireListId: null,
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setTab(state, action) {
      state.tab = action.payload;
    },
    toggleBudgetOn(state) {
      state.budgetOn = !state.budgetOn;
    },
    setBudget(state, action) {
      state.budget = Math.max(0, action.payload || 0);
    },
    toggleUpBudgetOn(state) {
      state.upBudgetOn = !state.upBudgetOn;
    },
    setUpBudget(state, action) {
      state.upBudget = Math.max(0, action.payload || 0);
    },
    setMessage(state, action) {
      state.message = action.payload;
    },
    selectList(state, action) {
      state.selectedListId = action.payload ?? null;
      try {
        if (state.selectedListId) localStorage.setItem(LS_SELECTED_LIST, state.selectedListId);
        else localStorage.removeItem(LS_SELECTED_LIST);
      } catch {
        // Storage unavailable — selection still works for this session.
      }
    },
    setListSort(state, action) {
      state.listSort = action.payload;
    },
    setCreatingList(state, action) {
      state.creatingList = Boolean(action.payload);
    },
    setRenamingListId(state, action) {
      state.renamingListId = action.payload ?? null;
    },
    setConfirmRetireListId(state, action) {
      state.confirmRetireListId = action.payload ?? null;
    },
  },
});

export const uiActions = uiSlice.actions;
export default uiSlice.reducer;
