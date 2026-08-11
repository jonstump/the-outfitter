import { useDispatch, useSelector } from "react-redux";
import { loadoutActions } from "../../store/loadoutSlice.js";
import { uiActions } from "../../store/uiSlice.js";
import { saveCurrent } from "../../store/savedLoadoutsSlice.js";
import { shareThunk } from "../../store/thunks.js";
import { selectSaveDestinationName, selectTotalCost, selectUpTotal } from "../../store/selectors.js";

export default function ActionsPanel() {
  const dispatch = useDispatch();
  const name = useSelector((s) => s.loadout.name);
  const total = useSelector(selectTotalCost);
  const up = useSelector(selectUpTotal);
  const ui = useSelector((s) => s.ui);
  // Governing: SPEC-0003 REQ "The Selected List Is Client State".
  //
  // Where the next save lands, named on the control that does it (issue #136). This used to
  // be announced by a badge at the top of the loadout-lists panel, which was styled as a
  // button, was not one, and stated the destination nowhere near the moment of action —
  // a user could easily have scrolled it off screen before pressing Save.
  //
  // null means Unassigned, which is stated rather than left blank: "Save" alone is what made
  // the filing behaviour undiscoverable in the first place, and Unassigned is a real
  // destination the user can deliberately choose (by closing every list), not an absence.
  const destination = useSelector(selectSaveDestinationName);

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
      {/* Random loadout and Clear moved to RandomizerPanel, which sits beside the traits grid.
          What is left here is everything about a build that already exists — its budgets, its
          name, saving it, sharing it. */}
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
        {/* The destination is part of the button's TEXT, not a title or an aria-label beside
            a bare "Save". A sighted user and a screen-reader user get the same sentence, and
            WCAG 2.5.3 (Label in Name) holds by construction because there is only one string.
            `.save-dest` bounds a long list name with an ellipsis visually while the accessible
            name stays whole — 2.5.3 asks the name to contain the visible label, and a truncated
            label is contained in the full one. */}
        <button className="btn-gold" onClick={() => dispatch(saveCurrent())}>
          Save to <span className="save-dest">{destination ?? "Unassigned"}</span>
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
