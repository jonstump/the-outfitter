import { useSelector } from "react-redux";
import { slotMax } from "../../utils/calc.js";
import EquipmentSlot from "./EquipmentSlot.jsx";

export default function EquipmentPanel() {
  const loadout = useSelector((s) => s.loadout);
  const sMax = slotMax(loadout);

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">Equipment</div>
        <div className="panel-meta">
          {loadout.equip.length}/{sMax} SLOTS · MAX 4 PER CONSUMABLE TYPE
        </div>
      </div>
      <div className="equip-grid">
        {Array.from({ length: 8 }, (_, k) => (
          <EquipmentSlot key={k} index={k} />
        ))}
      </div>
    </div>
  );
}
