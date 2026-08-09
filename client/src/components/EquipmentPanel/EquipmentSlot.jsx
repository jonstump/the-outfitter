import { useDispatch, useSelector } from "react-redux";
import { CONS, TOOLS, consThumb, toolThumb } from "../../data/catalog.js";
import { selectEquipEntry, selectSlotMax } from "../../store/selectors.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import ItemThumb from "../ItemThumb/ItemThumb.jsx";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Implements: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"

export default function EquipmentSlot({ index }) {
  const dispatch = useDispatch();
  const entry = useSelector(selectEquipEntry(index));
  const sMax = useSelector(selectSlotMax);

  if (!entry) {
    const isBlocked = index >= sMax;
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
  const category = entry.t === "T" ? "tools" : "consumables";
  const svgPath = entry.t === "T" ? toolThumb(def) : consThumb(def);

  return (
    <button
      className="equip-slot filled-slot"
      title="Remove"
      onClick={() => dispatch(loadoutActions.removeEquip(index))}
    >
      <ItemThumb category={category} name={def[0]} svgPath={svgPath} className="equip-thumb" />
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
