import { useRef, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { selectEquipCount } from "../../store/selectors.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import EquipmentSlot from "./EquipmentSlot.jsx";
import { equipRuns } from "../../utils/stacking.js";
import { announceFailure, arrowTarget } from "./gridMove.js";

// Governing: ADR-0009 (fixed eight-cell grid, no quantity field), SPEC-0006
// REQ "The Grid Renders as Two Ranks of Four", REQ "Repeated Consumables Read
// as One Stack", REQ "Items Are Rearranged by Direct Manipulation", REQ "Keyboard
// Equivalence for Every Pointer Gesture".
//
// The stacking is a RENDER-TIME view computed from runs of identical adjacent
// entries (utils/stacking.js) — a computation over the grid, never a stored
// quantity. The grid always renders exactly eight cells; a stack is a badge on
// the run's FIRST cell, and the badge matches the cells consumed.
//
// Direct manipulation lives here at the grid level: pointer grabs and drops are
// captured on the grid root so a drag can leave one cell and land on another (or
// off-grid, which unequips). Keyboard arrows step through the CURRENT
// arrangement — the vertical step follows the CSS container-query transpose —
// and rejected drops are announced to assistive technology.
export default function EquipmentPanel() {
  const equipCount = useSelector(selectEquipCount);
  const loadout = useSelector((s) => s.loadout);
  const dispatch = useDispatch();
  const runs = equipRuns(loadout.equip);
  const [drag, setDrag] = useState(null);
  const gridRef = useRef(null);

  // The same threshold the CSS container query uses: the arrangement follows the
  // PANEL's width, never the viewport's, and the keyboard follows the arrangement.
  const panelWidth = gridRef.current?.clientWidth ?? 0;

  const onGridPointerMove = (e) => {
    if (!drag || drag.mode !== "pointer") return;
    e.preventDefault();
  };
  const onGridPointerUp = (e) => {
    if (!drag || drag.mode !== "pointer") return;
    const over = e.target?.closest?.("[data-slot-index]");
    const target = over ? Number(over.dataset.slotIndex) : -1;
    setDrag(null);
    if (target === -1 || target === drag.from) return;
    dispatch(loadoutActions.moveEquip({ from: drag.from, to: target }));
  };
  const onLostPointerCapture = (e) => {
    if (drag && drag.mode === "pointer" && drag.pointerId === e.pointerId) {
      setDrag(null);
    }
  };

  // Keyboard: arrows grab / move; Enter / Ctrl+M drop the grab; Escape cancels it.
  const onGridKeyDown = (e) => {
    const k = e.key;
    if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
      if (!drag) return;
      const from = drag.from;
      const step = arrowTarget(from, k.replace("Arrow", ""), k === "ArrowLeft" || k === "ArrowRight", panelWidth);
      if (step === null) {
        // The arrow left the grid — an edge no-op in EITHER arrangement. The grab
        // survives (the user may still drop with a later arrow / Enter), matching the
        // pointer grab, which also survives an off-grid move.
        announceFailure(gridRef.current, "At the edge of the grid");
        e.preventDefault();
        return;
      }
      setDrag({ ...drag, from: step });
      e.preventDefault();
    } else if (k === "Enter" || (e.ctrlKey && (e.key === "m" || e.key === "M"))) {
      if (drag && drag.mode === "keyboard") {
        const target = drag.from;
        if (target === drag.from) return; // nothing to drop onto the grab cell itself
        dispatch(loadoutActions.moveEquip({ from: target, to: target }));
        setDrag(null);
      }
    }
  };

  // Move a grabbed cell to a target cell, announcing rejected drops (blocked or
  // out-of-range), used by both the pointer path and the keyboard drop path.
  const moveTo = (target) => {
    if (target === null || target < 0 || target >= 8) {
      announceFailure(gridRef.current, "Cannot drop there");
      return;
    }
    if (loadout.blocked.includes(target)) {
      announceFailure(gridRef.current, "That cell is blocked");
      setDrag(null);
      return;
    }
    dispatch(loadoutActions.moveEquip({ from: drag.from, to: target }));
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">Equipment</div>
        <div className="panel-meta">
          {equipCount}/8 SLOTS · MAX 4 PER CONSUMABLE TYPE
        </div>
      </div>
      <div
        className="equip-grid"
        ref={gridRef}
        onPointerMove={onGridPointerMove}
        onPointerUp={onGridPointerUp}
        onLostPointerCapture={onLostPointerCapture}
        onKeyDown={onGridKeyDown}
        data-testid="equip-grid"
      >
        {Array.from({ length: 8 }, (_, k) => (
          <EquipmentSlot
            key={k}
            index={k}
            run={runs.find((r) => r.cells.includes(k))}
            drag={drag}
            setDrag={setDrag}
            onGridMove={(target) => {
              if (drag && drag.mode === "keyboard") dispatch(loadoutActions.moveEquip({ from: drag.from, to: target }));
            }}
            gridRoot={gridRef.current}
            panelWidth={panelWidth}
          />
        ))}
      </div>
    </div>
  );
}
