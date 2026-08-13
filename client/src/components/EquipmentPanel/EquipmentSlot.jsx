import { useDispatch, useSelector } from "react-redux";
import { useMemo } from "react";
import { CONS, CONS_TYPE_COLOR, TOOLS, TOOL_COLOR, consThumb, toolThumb } from "../../data/catalog.js";
import { selectBlockedCells, selectEquipEntry } from "../../store/selectors.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import ItemThumb from "../ItemThumb/ItemThumb.jsx";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Implements: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"
//
// Governing: ADR-0009, SPEC-0006 REQ "Cells Are Individually Blockable". Blocking is
// per cell: a MIDDLE cell can be blocked while later cells stay usable, so the
// availability check is `index in blocked`, never a count comparison.
//
// SPEC-0006 REQ "Repeated Consumables Read as One Stack": the run a cell belongs to
// arrives as a prop from EquipmentPanel (computed by utils/stacking.js). The FIRST
// cell of a run renders the tile and its badge; later cells of the run render an
// anchor that is not an extra tile — the badge's count is the cells consumed.

export default function EquipmentSlot({ index, run }) {
  const dispatch = useDispatch();
  // selectEquipEntry is a selector factory; memoize the instance so its
  // createSelector cache survives re-renders (issue #24/#25).
  const entry = useSelector(useMemo(() => selectEquipEntry(index), [index]));
  const blocked = useSelector(selectBlockedCells);
  const isBlocked = blocked.includes(index);

  if (!entry) {
    return (
      <button
        className={`equip-slot empty-slot${isBlocked ? " blocked-slot" : ""}`}
        title={isBlocked ? "Unblock this slot" : "Block this slot (excluded from loadout)"}
        aria-pressed={isBlocked}
        onClick={() => dispatch(loadoutActions.toggleBlockedSlot(index))}
      >
        {isBlocked ? "✕ blocked" : "empty"}
      </button>
    );
  }

  const def = entry.t === "T" ? TOOLS[entry.i] : CONS[entry.i];
  // Governing: #155. The two-branch `def[3] === "Shot" ? olive : rust` this replaces had a duplicate
  // in PickerRow, and both would have rendered the new `Placeable` type identically to `Throwable`.
  // The mapping lives in catalog.js beside the value set it keys off.
  const catColor = entry.t === "T" ? TOOL_COLOR : (CONS_TYPE_COLOR[def[3]] ?? CONS_TYPE_COLOR.Throwable);
  const category = entry.t === "T" ? "tools" : "consumables";
  const svgPath = entry.t === "T" ? toolThumb(def) : consThumb(def);

  const runCells = run ? run.cells : [index];
  const isStackHead = run ? run.cells[0] === index : true;
  if (!isStackHead) {
    // The continuation cells of a stack — same tile, no duplicate thumbnail. The
    // count is on the head's badge; this anchor exists so the grid keeps its shape.
    return (
      <button
        className="equip-slot filled-slot stack-continuation"
        title={`${def[1]} (stack of ${runCells.length})`}
        aria-label={`${def[1]} (stack of ${runCells.length})`}
        tabIndex={index === runCells[0] + 1 ? 0 : -1}
      >
        <span className="equip-name">{def[1]}</span>
      </button>
    );
  }

  return (
    <button
      className="equip-slot filled-slot"
      title={`Remove ${def[1]}${runCells.length > 1 ? ` (stack of ${runCells.length})` : ""}`}
      onClick={() => dispatch(loadoutActions.removeEquip(index))}
      data-testid={`equip-tile-${index}`}
    >
      <ItemThumb category={category} name={def[1]} svgPath={svgPath} className="equip-thumb" />
      <span className="equip-name">{def[1]}</span>
      {runCells.length > 1 && (
        <span className="equip-stack-badge" data-testid={`stack-badge-${runCells[0]}`}>
          ×{runCells.length}
        </span>
      )}
      <span className="equip-foot">
        <span className="equip-cat" style={{ color: catColor }}>
          {entry.t === "T" ? "TOOL" : def[3].toUpperCase()}
        </span>
        <span className="equip-cost">${def[2]}</span>
      </span>
    </button>
  );
}
