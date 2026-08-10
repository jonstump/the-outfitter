import { useDispatch, useSelector } from "react-redux";
import { loadoutActions } from "../../store/loadoutSlice.js";
import { uiActions } from "../../store/uiSlice.js";
import { saveCurrent } from "../../store/savedLoadoutsSlice.js";
import { randomizeThunk, clearBuildThunk, shareThunk } from "../../store/thunks.js";
import { selectTotalCost, selectUpTotal } from "../../store/selectors.js";

export default function ActionsPanel() {
  const dispatch = useDispatch();
  const name = useSelector((s) => s.loadout.name);
  const total = useSelector(selectTotalCost);
  const up = useSelector(selectUpTotal);
  const ui = useSelector((s) => s.ui);

  const overBudget = ui.budgetOn && total > ui.budget;
  const overUp = ui.upBudgetOn && up > ui.upBudget;
  const budgetLabelColor = overBudget ? "#c96b5b" : "#e6d9ba";
  const upLabelColor = overUp ? "#c96b5b" : "#e6d9ba";

  // Governing: SPEC-0001 REQ "Accessibility Requirements" (Dynamic Content Regions).
  //
  // `ui.message` carries save/delete/fetch/share feedback, with a leading "!" marking a
  // failure (set by savedLoadoutsSlice.js and thunks.js). Both regions below stay mounted
  // permanently instead of rendering one node only when there's a message: a live region
  // has to already be in the accessibility tree when its text changes, and inserting the
  // region together with its content is the standard way to get silence from a screen
  // reader. Politeness is fixed per node rather than swapped on one node, because changing
  // aria-live after mount is unreliable across assistive tech — failures go to the
  // assertive region (a failed save shouldn't wait behind other speech), everything else
  // to the polite one. `.share-message:empty` in global.css collapses the flex gap the
  // idle regions would otherwise add to the panel.
  const isError = ui.message.startsWith("!");
  const messageText = ui.message.replace(/^!/, "");

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="actions-row">
        <button className="btn-primary" style={{ flex: 1, minWidth: 150 }} onClick={() => dispatch(randomizeThunk())}>
          Random loadout
        </button>
        <button className="btn" onClick={() => dispatch(clearBuildThunk())}>
          Clear
        </button>
      </div>

      <div className="budget-row">
        <span className="budget-group">
          <button
            className={`toggle-btn${ui.budgetOn ? " on" : ""}`}
            onClick={() => dispatch(uiActions.toggleBudgetOn())}
          >
            Budget {ui.budgetOn ? "ON" : "OFF"}
          </button>
          {ui.budgetOn && (
            <span className="budget-input-wrap">
              <span style={{ color: budgetLabelColor, fontSize: 16.5 }}>$</span>
              <input
                type="number"
                min="0"
                step="25"
                className="number-input"
                style={{ width: 80, color: budgetLabelColor }}
                value={ui.budget}
                onChange={(e) => dispatch(uiActions.setBudget(parseInt(e.target.value, 10) || 0))}
              />
            </span>
          )}
        </span>
        <span className="budget-group">
          <button
            className={`toggle-btn${ui.upBudgetOn ? " on" : ""}`}
            onClick={() => dispatch(uiActions.toggleUpBudgetOn())}
          >
            Trait cap {ui.upBudgetOn ? "ON" : "OFF"}
          </button>
          {ui.upBudgetOn && (
            <span className="budget-input-wrap">
              <input
                type="number"
                min="0"
                step="1"
                className="number-input"
                style={{ width: 60, color: upLabelColor }}
                value={ui.upBudget}
                onChange={(e) => dispatch(uiActions.setUpBudget(parseInt(e.target.value, 10) || 0))}
              />
              <span style={{ color: upLabelColor, fontSize: 15.5 }}>UP</span>
            </span>
          )}
        </span>
      </div>

      <div className="save-row">
        <input
          className="text-input"
          style={{ flex: 1, minWidth: 160 }}
          value={name}
          placeholder="Name this loadout…"
          onChange={(e) => dispatch(loadoutActions.setName(e.target.value))}
        />
        <button className="btn-gold" onClick={() => dispatch(saveCurrent())}>
          Save
        </button>
        <button className="btn-outline" onClick={() => dispatch(shareThunk())}>
          Share link
        </button>
      </div>

      <div className="share-message error" role="alert" aria-live="assertive" aria-atomic="true">
        {isError ? messageText : ""}
      </div>
      <div className="share-message" role="status" aria-live="polite" aria-atomic="true">
        {isError ? "" : messageText}
      </div>
    </div>
  );
}
