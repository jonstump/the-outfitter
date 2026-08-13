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
//
// Direct manipulation (SPEC-0006 REQ "Items Are Rearranged by Direct Manipulation",
// REQ "Keyboard Equivalence for Every Pointer Gesture"): pointer grab, drag, and drop
// use Pointer Events (ADR-0009's choice), a move changes nothing but position
// (moveEquip swaps cells), the picker is NOT a drag source, and every gesture has a
// keyboard path: ArrowUp/Down/Left/Right grab the adjacent cell, Space/Ctrl+M drop
// onto the grabbed cell, Escape cancels a grab.

export default function EquipmentSlot({ index, run, drag, setDrag, onGridMove, gridRoot, panelWidth }) {
  const dispatch = useDispatch();
  // selectEquipEntry is a selector factory; memoize the instance so its
  // createSelector cache survives re-renders (issue #24/#25).
  const entry = useSelector(useMemo(() => selectEquipEntry(index), [index]));
  const blocked = useSelector(selectBlockedCells);
  const isBlocked = blocked.includes(index);

  // KB: arrow grabbing. The vertical step follows the CURRENT arrangement: the CSS
  // container query swaps columns at 460px of PANEL width; the arrow logic reads the
  // same threshold (gridMove.js) so a transposed panel arrows with a +1 vertical step.
  const dispatchKbMove = (target) => {
    if (target === null || target < 0 || target >= 8) return;
    dispatch(onGridMove(target));
  };

  const handleKeyDown = (e) => {
    const from = index;
    if (e.key === "Escape" || e.key === "Esc") {
      if (drag && drag.from === index) {
        setDrag(null);
        e.preventDefault();
      }
      return;
    }
    if (e.key === " " || e.key === "Spacebar") {
      // Space on a filled cell starts a keyboard grab of THAT cell.
      if (entry && !drag) {
        setDrag({ from: index, mode: "keyboard" });
        e.preventDefault();
      }
      return;
    }
    if (e.key === "Enter" || (e.ctrlKey && (e.key === "m" || e.key === "M"))) {
      // Ctrl+M (and Enter) perform the drop of a grabbed cell onto this cell.
      if (drag && drag.mode === "keyboard") {
        dispatchKbMove(index);
      }
      e.preventDefault();
      return;
    }
    const horizontalFirst = e.key === "Left" || e.key === "Right";
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      // Keyboard grabs move the grab, and the arrow step follows the arrangement.
      dispatchKbMove(index + cellStepForKey(e.key, panelWidth));
      e.preventDefault();
    }
  };

  const onPointerDown = (e) => {
    // Pointer Events, not HTML5 drag-and-drop (ADR-0009). A grab starts on a filled
    // cell; pointermove/pointerup are captured on the grid root (EquipmentPanel) so a
    // drag can leave the cell and still drop elsewhere or off-grid (unequip).
    if (!entry) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ from: index, mode: "pointer", pointerId: e.pointerId });
  };

  // The continuation cells of a stack are part of the same tile; the grid root's
  // drop handler treats a drop on them as a drop on the stack head.
  const runCells = run ? run.cells : [index];
  const isStackHead = run ? run.cells[0] === index : true;
  if (!entry) {
    const targetCell = index;
    return (
      <button
        className={`equip-slot empty-slot${isBlocked ? " blocked-slot" : ""}`}
        title={isBlocked ? "Unblock this slot" : "Block this slot (excluded from loadout)"}
        aria-pressed={isBlocked}
        data-slot-index={index}
        onKeyDown={handleKeyDown}
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

  if (!isStackHead) {
    // The continuation cells of a stack — same tile, no duplicate thumbnail. The
    // count is on the head's badge; this anchor exists so the grid keeps its shape.
    return (
      <button
        className="equip-slot filled-slot stack-continuation"
        title={`${def[1]} (stack of ${runCells.length})`}
        aria-label={`${def[1]} (stack of ${runCells.length})`}
        data-slot-index={index}
        data-stack-head={runCells[0]}
        tabIndex={index === runCells[0] + 1 ? 0 : -1}
        onPointerDown={onPointerDown}
        onKeyDown={handleKeyDown}
      >
        <span className="equip-name">{def[1]}</span>
      </button>
    );
  }

  return (
    <button
      className={`equip-slot filled-slot${drag && drag.from === index ? " grabbing" : ""}`}
      title={`${def[1]} — drag to move${runCells.length > 1 ? ` (stack of ${runCells.length})` : ""}`}
      data-testid={`equip-tile-${index}`}
      data-slot-index={index}
      onPointerDown={onPointerDown}
      onKeyDown={handleKeyDown}
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

// The arrow's numeric step for the current arrangement. `ArrowUp/Down` in the wide
// arrangement step by the column count (4); in the narrow arrangement (2 columns,
// 4 rows) the vertical step is 1.
function cellStepForKey(key, panelWidth) {
  return key === "ArrowDown" || key === "ArrowUp" ? (panelWidth >= 460 ? 4 : 1) : 1;
}
