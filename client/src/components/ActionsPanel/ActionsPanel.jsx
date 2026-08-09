import { useDispatch, useSelector } from "react-redux";
import { loadoutActions } from "../../store/loadoutSlice.js";
import { uiActions } from "../../store/uiSlice.js";
import { saveCurrent } from "../../store/savedLoadoutsSlice.js";
import { randomizeThunk, clearBuildThunk, shareThunk } from "../../store/thunks.js";
import { totalCost, upTotal } from "../../utils/calc.js";

export default function ActionsPanel() {
  const dispatch = useDispatch();
  const name = useSelector((s) => s.loadout.name);
  const loadout = useSelector((s) => s.loadout);
  const ui = useSelector((s) => s.ui);

  const overBudget = ui.budgetOn && totalCost(loadout) > ui.budget;
  const overUp = ui.upBudgetOn && upTotal(loadout) > ui.upBudget;
  const budgetLabelColor = overBudget ? "#c96b5b" : "#d9cbab";
  const upLabelColor = overUp ? "#c96b5b" : "#d9cbab";

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
              <span style={{ color: budgetLabelColor, fontSize: 15 }}>$</span>
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
              <span style={{ color: upLabelColor, fontSize: 14 }}>UP</span>
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

      {ui.message && <div className={`share-message${ui.message.startsWith("!") ? " error" : ""}`}>{ui.message.replace(/^!/, "")}</div>}
    </div>
  );
}
