import { useSelector } from "react-redux";
import { selectTotalCost, selectUpTotal } from "../../store/selectors.js";

export default function Header() {
  const total = useSelector(selectTotalCost);
  const up = useSelector(selectUpTotal);
  const budgetOn = useSelector((s) => s.ui.budgetOn);
  const budget = useSelector((s) => s.ui.budget);
  const overBudget = budgetOn && total > budget;

  return (
    <header className="app-header">
      <div>
        <div className="app-title">The Outfitter</div>
        <div className="app-subtitle">Frontier armory &amp; loadout ledger — 1896</div>
      </div>
      <div className="header-stats">
        <div className="header-stat">
          <div className="header-stat-label">Total cost</div>
          <div className="header-stat-value" style={{ color: overBudget ? "#c96b5b" : "#e6dab9" }}>
            ${total}
          </div>
        </div>
        <div className="header-stat">
          <div className="header-stat-label">Trait points</div>
          <div className="header-stat-value" style={{ color: "#b08d4f" }}>
            {up} UP
          </div>
        </div>
      </div>
    </header>
  );
}
