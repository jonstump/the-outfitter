import { TRAITS } from "../data/catalog.js";
import { totalCost, upTotal } from "../utils/calc.js";
import { encodeShareUrl, fromData } from "../utils/loadoutCodec.js";
import { randomizeLoadout } from "../utils/randomize.js";
import { loadoutActions } from "./loadoutSlice.js";
import { uiActions } from "./uiSlice.js";

export function randomizeThunk() {
  return (dispatch, getState) => {
    const { loadout, ui } = getState();
    const result = randomizeLoadout({
      // Blocked cells travel as their own array (ADR-0009, SPEC-0006 REQ "Cells Are
      // Individually Blockable"); the generator respects them and keeps them holes.
      blocked: loadout.blocked,
      budgetOn: ui.budgetOn,
      budget: ui.budget,
      upBudgetOn: ui.upBudgetOn,
      upBudget: ui.upBudget,
    });
    dispatch(loadoutActions.setLoadout(result));
    // Governing: SPEC-0008, issue #380. Related: #211, #208.
    // When budgetOn, randomizeLoadout retries a bounded number of uniform draws and
    // falls back to the cheapest one it saw if none landed at or under budget — it
    // never reports that fallback happened. Without this, a miss looks identical to
    // any other result: the total merely recolors red, with nothing to tell the player
    // a retry would very likely land in budget. Disclose the miss here instead of
    // unconditionally clearing the banner; a subsequent in-budget (or budget-off)
    // press clears it again.
    if (ui.budgetOn && totalCost(result) > ui.budget) {
      dispatch(
        uiActions.setMessage(
          "No in-budget build found after several tries — this is the cheapest of the bunch. Press Randomize again for another shot."
        )
      );
    } else {
      dispatch(uiActions.setMessage(""));
    }
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
// Traits are stored by stable catalog id (see catalog.js), resolved through the index
// action.payload carries (Picker already looks the entry up by array position).
export function addTraitIfAllowed(index) {
  return (dispatch, getState) => {
    const { loadout, ui } = getState();
    const trait = TRAITS[index];
    if (!trait) return;
    if (loadout.traits.includes(trait[0])) return;
    if (ui.upBudgetOn && upTotal(loadout) + trait[2] > ui.upBudget) return;
    dispatch(loadoutActions.addTrait(trait[0]));
  };
}

export function loadSavedThunk(record) {
  return (dispatch) => {
    // Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List" —
    // carry the record's id as `savedId` so a subsequent save addresses this record
    // instead of matching on the name triple. `fromData` decodes the wire payload and
    // knows nothing about record ids; the id is attached alongside its result.
    const decoded = fromData(record.data);
    dispatch(loadoutActions.setLoadout({ ...decoded, savedId: record.id }));
    // Governing: issue #359. Surface a notice when decode dropped an ammo selection
    // that was valid when the record was saved but no longer resolves.
    if (decoded.decodeNotices?.some((n) => n.kind === "ammo-dropped")) {
      dispatch(uiActions.setMessage(`Loaded “${record.name}”. This build's ammo selection is no longer available.`));
    } else {
      dispatch(uiActions.setMessage(`Loaded “${record.name}”.`));
    }
  };
}

export function shareThunk() {
  return (dispatch, getState) => {
    const { loadout } = getState();
    // Governing: issue #358. encodeShareUrl can throw on a loadout name carrying code
    // points above U+00FF (if the UTF-8-safe path is somehow bypassed). Wrap the call
    // so a future encode failure dispatches a message rather than throwing silently.
    let url;
    try {
      url = encodeShareUrl(loadout);
    } catch {
      dispatch(uiActions.setMessage("Could not generate a share link for this loadout."));
      return;
    }
    const done = () => dispatch(uiActions.setMessage("Share link copied to clipboard."));
    const fallback = () => dispatch(uiActions.setMessage("Share code is in the address bar — copy the URL."));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, fallback);
    } else {
      fallback();
    }
  };
}
