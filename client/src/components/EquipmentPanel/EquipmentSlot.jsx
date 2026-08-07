import { useDispatch, useSelector } from "react-redux";
import { CONS, TOOLS } from "../../data/catalog.js";
import { slotMax } from "../../utils/calc.js";
import { loadoutActions } from "../../store/loadoutSlice.js";

export default function EquipmentSlot({ index }) {
  const dispatch = useDispatch();
  const loadout = useSelector((s) => s.loadout);
  const entry = loadout.equip[index];

  if (!entry) {
    const isBlocked = index >= slotMax(loadout);
    return (
      <button
        className={`equip-slot empty-slot${isBlocked ? " blocked-slot" : ""}`}
        title={isBlocked ? "Unblock this slot" : "Block this slot (excluded from loadout)"}
        onClick={() => dispatch(loadoutActions.toggleBlockedSlot(index))}
      >
        {isBlocked ? "✕ blocked" : "empty"}
      </button>
    );
  }

  const def = entry.t === "T" ? TOOLS[entry.i] : CONS[entry.i];
  const catColor = entry.t === "T" ? "#8a6f42" : def[2] === "Shot" ? "#7a8a5c" : "#a5674a";

  return (
    <button
      className="equip-slot filled-slot"
      title="Remove"
      onClick={() => dispatch(loadoutActions.removeEquip(index))}
    >
      <span className="equip-name">{def[0]}</span>
      <span className="equip-foot">
        <span className="equip-cat" style={{ color: catColor }}>
          {entry.t === "T" ? "TOOL" : def[2].toUpperCase()}
        </span>
        <span className="equip-cost">${def[1]}</span>
      </span>
    </button>
  );
}
