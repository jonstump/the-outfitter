import { useSelector } from "react-redux";
import { capMax, capUsed } from "../../utils/calc.js";
import WeaponSlot from "./WeaponSlot.jsx";

export default function WeaponsPanel() {
  const loadout = useSelector((s) => s.loadout);
  const max = capMax(loadout);
  const used = capUsed(loadout);
  const overCap = used > max;
  const pipCount = Math.max(max, used);

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">Weapons</div>
        <div className="weapons-capacity">
          <span className="panel-meta">
            CAPACITY {used}/{max}
          </span>
          <span className="cap-pips">
            {Array.from({ length: pipCount }, (_, i) => {
              const filled = i < used;
              const bg = filled ? (overCap ? "#7f2b26" : "#8a6f42") : "transparent";
              const border = filled ? (overCap ? "#a04338" : "#8a6f42") : "#4a3c25";
              return <span key={i} className="cap-pip" style={{ background: bg, border: `1px solid ${border}` }} />;
            })}
          </span>
        </div>
      </div>
      <div className="weapon-slots">
        <WeaponSlot slot={0} />
        <WeaponSlot slot={1} />
      </div>
      {overCap && (
        <div className="over-capacity-warning">Over capacity — drop a weapon or take Quartermaster.</div>
      )}
    </div>
  );
}
