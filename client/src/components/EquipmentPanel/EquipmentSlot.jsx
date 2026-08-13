import { useDispatch, useSelector } from "react-redux";
import { useMemo } from "react";
import { CONS, CONS_TYPE_COLOR, TOOLS, TOOL_COLOR, consThumb, toolThumb } from "../../data/catalog.js";
import { selectBlockedCells, selectEquipEntry } from "../../store/selectors.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import ItemThumb from "../ItemThumb/ItemThumb.jsx";

// The grab ref is owned by EquipmentPanel and threaded to every slot. A standalone
// slot (its test suite renders it directly) may omit the prop.
function emptyRef() {
  return { current: null };
}

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

export default function EquipmentSlot({ index, run, grabRef }) {
  const ref = grabRef || emptyRef();
  const dispatch = useDispatch();
  // selectEquipEntry is a selector factory; memoize the instance so its
  // createSelector cache survives re-renders (issue #24/#25).
  const entry = useSelector(useMemo(() => selectEquipEntry(index), [index]));
  const blocked = useSelector(selectBlockedCells);
  const isBlocked = blocked.includes(index);
  const drag = ref.current;

  // KB: the arrow step follows the CURRENT arrangement (gridMove.js). The CELL-level
  // handler is only for Space (start a grab) and Escape (cancel); arrows and Enter/Ctrl+M
  // are handled at the grid root so the grab is one state machine instead of eight.
  const handleKeyDown = (e) => {
    if (e.key === "Escape" || e.key === "Esc") {
      if (ref.current && ref.current.from === index) {
        ref.current = null;
        e.preventDefault();
      }
      return;
    }
    if (e.key === " " || e.key === "Spacebar") {
      // Space on a filled cell starts a keyboard grab of THAT cell, stored in the
      // shared ref so the grid root's Enter handler reads it synchronously.
      if (entry && !ref.current) {
        ref.current = { origin: index, from: index, mode: "keyboard" };
        e.preventDefault();
      }
      return;
    }
    if (e.key === "Enter" || (e.ctrlKey && (e.key === "m" || e.key === "M"))) {
      e.preventDefault();
      return;
    }
    if (e.key.startsWith("Arrow")) {
      // Stop the page scrolling on arrow keys over the grid; the grid root's keydown
      // handles the grab movement itself.
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
    ref.current = { origin: index, from: index, mode: "pointer", pointerId: e.pointerId };
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