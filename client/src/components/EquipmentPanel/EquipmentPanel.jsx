import { useSelector } from "react-redux";
import { selectEquipCount } from "../../store/selectors.js";
import EquipmentSlot from "./EquipmentSlot.jsx";
import { equipRuns } from "../../utils/stacking.js";

// Governing: ADR-0009 (fixed eight-cell grid, no quantity field), SPEC-0006
// REQ "The Grid Renders as Two Ranks of Four", REQ "Repeated Consumables Read
// as One Stack".
//
// The stacking is a RENDER-TIME view computed from runs of identical adjacent
// entries (utils/stacking.js) — a computation over the grid, never a stored
// quantity. The grid always renders exactly eight cells; a stack is a badge on
// the run's FIRST cell, and the badge matches the cells consumed.
export default function EquipmentPanel() {
  const equipCount = useSelector(selectEquipCount);
  const loadout = useSelector((s) => s.loadout);
  const runs = equipRuns(loadout.equip);

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">Equipment</div>
        <div className="panel-meta">
          {equipCount}/8 SLOTS · MAX 4 PER CONSUMABLE TYPE
        </div>
      </div>
      <div className="equip-grid">
        {Array.from({ length: 8 }, (_, k) => (
          <EquipmentSlot key={k} index={k} run={runs.find((r) => r.cells.includes(k))} />
        ))}
      </div>
    </div>
  );
}
