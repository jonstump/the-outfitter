import { TRAITS } from "../data/catalog.js";
import { slotMax, upTotal } from "../utils/calc.js";
import { encodeShareUrl, fromData } from "../utils/loadoutCodec.js";
import { randomizeLoadout } from "../utils/randomize.js";
import { loadoutActions } from "./loadoutSlice.js";
import { uiActions } from "./uiSlice.js";

export function randomizeThunk() {
  return (dispatch, getState) => {
    const { loadout, ui } = getState();
    const result = randomizeLoadout({
      slotMax: slotMax(loadout),
      budgetOn: ui.budgetOn,
      budget: ui.budget,
      upBudgetOn: ui.upBudgetOn,
      upBudget: ui.upBudget,
    });
    dispatch(loadoutActions.setLoadout(result));
    dispatch(uiActions.setMessage(""));
  };
}

export function clearBuildThunk() {
  return (dispatch) => {
    dispatch(loadoutActions.clearBuild());
    dispatch(uiActions.setMessage(""));
  };
}

// Traits have a cross-slice legality check (the UP budget lives in `ui`), so this
// stays a thunk rather than a plain reducer — mirrors the original's picker-side `ok` guard.
export function addTraitIfAllowed(index) {
  return (dispatch, getState) => {
    const { loadout, ui } = getState();
    if (loadout.traits.includes(index)) return;
    if (ui.upBudgetOn && upTotal(loadout) + TRAITS[index][1] > ui.upBudget) return;
    dispatch(loadoutActions.addTrait(index));
  };
}

export function loadSavedThunk(record) {
  return (dispatch) => {
    dispatch(loadoutActions.setLoadout(fromData(record.data)));
    dispatch(uiActions.setMessage(`Loaded “${record.name}”.`));
  };
}

export function shareThunk() {
  return (dispatch, getState) => {
    const { loadout } = getState();
    const url = encodeShareUrl(loadout);
    const done = () => dispatch(uiActions.setMessage("Share link copied to clipboard."));
    const fallback = () => dispatch(uiActions.setMessage("Share code is in the address bar — copy the URL."));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, fallback);
    } else {
      fallback();
    }
  };
}
