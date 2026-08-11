import { useSelector } from "react-redux";
import { selectEquipCount, selectSlotMax } from "../../store/selectors.js";
import EquipmentSlot from "./EquipmentSlot.jsx";

export default function EquipmentPanel() {
  const equipCount = useSelector(selectEquipCount);
  const sMax = useSelector(selectSlotMax);

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">Equipment</div>
        <div className="panel-meta">
          {equipCount}/{sMax} SLOTS · MAX 4 PER CONSUMABLE
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
