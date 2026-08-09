import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  tab: "Weapons",
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
