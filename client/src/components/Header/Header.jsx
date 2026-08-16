import { useSelector } from "react-redux";
import { selectTotalCost, selectUpTotal } from "../../store/selectors.js";

// Both header stats signal "over the limit you set" the same way, so the colour lives in
// one place rather than being spelled twice (issue #66).
const OVER_LIMIT = "#c96b5b";
const COST_OK = "#f0e6c8";
const UP_OK = "#c4a05e";

export default function Header() {
  const total = useSelector(selectTotalCost);
  const up = useSelector(selectUpTotal);
  const budgetOn = useSelector((s) => s.ui.budgetOn);
  const budget = useSelector((s) => s.ui.budget);
  const upBudgetOn = useSelector((s) => s.ui.upBudgetOn);
  const upBudget = useSelector((s) => s.ui.upBudget);
  const overBudget = budgetOn && total > budget;
  // Issue #66: going over the trait cap is reachable (turn the cap on after picking
  // traits, load a share link, or lower the cap under a built loadout — thunks.js only
  // blocks *adding* a trait that would exceed it, it never retro-strips). The header
  // read as normal in all three cases while ActionsPanel already reddened its input.
  const overUp = upBudgetOn && up > upBudget;

  return (
    <header className="app-header">
      <div>
        <div className="app-title">Backwater Outfitters</div>
        <div className="app-subtitle">Frontier armory &amp; loadout ledger — 1896</div>
      </div>
      <div className="header-stats">
        <div className="header-stat">
          <div className="header-stat-label">Total cost</div>
          <div className="header-stat-value" style={{ color: overBudget ? OVER_LIMIT : COST_OK }}>
            ${total}
          </div>
        </div>
        <div className="header-stat">
          <div className="header-stat-label">Trait points</div>
          {/* Bare number, no "UP" suffix — the label already says "Trait points", the way
              the cost stat renders "$800" with no unit word after it. The suffix stays on
              the trait-cap input and the per-trait badges, where it labels one trait's cost. */}
          <div className="header-stat-value" style={{ color: overUp ? OVER_LIMIT : UP_OK }}>
            {up}
          </div>
        </div>
      </div>
    </header>
  );
}
