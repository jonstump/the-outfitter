import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  tab: "Weapons",
  search: "",
  sizeFilter: 0,
  group: "",
  ammoF: "",
  budgetOn: false,
  budget: 800,
  upBudgetOn: false,
  upBudget: 12,
  message: "",
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setTab(state, action) {
      state.tab = action.payload;
      state.search = "";
      state.group = "";
      state.ammoF = "";
    },
    setSearch(state, action) {
      state.search = action.payload;
    },
    setSizeFilter(state, action) {
      state.sizeFilter = action.payload;
    },
    setGroup(state, action) {
      state.group = action.payload;
    },
    setAmmoFilter(state, action) {
      state.ammoF = action.payload;
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
  },
});

export const uiActions = uiSlice.actions;
export default uiSlice.reducer;
