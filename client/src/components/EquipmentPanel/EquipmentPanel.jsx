import { useRef } from "react";
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
//
// The grab lives in a ref, not state: a keyboard gesture spans several discrete
// key events (Space to grab, arrows to move, Enter to drop), and React batches
// state updates between them, so the Enter handler would read a stale `drag`
// closure. A ref gives the synchronous read the sequence needs; the slot reads
// the same ref for its highlight.
export default function EquipmentPanel() {
  const equipCount = useSelector(selectEquipCount);
  const loadout = useSelector((s) => s.loadout);
  const dispatch = useDispatch();
  const runs = equipRuns(loadout.equip);
  const grabRef = useRef(null);
  const gridRef = useRef(null);

  const onGridPointerMove = (e) => {
    if (!grabRef.current || grabRef.current.mode !== "pointer") return;
    e.preventDefault();
  };
  const onGridPointerUp = (e) => {
    const grab = grabRef.current;
    if (!grab || grab.mode !== "pointer") return;
    // The pointerdown cell captured the pointer, so EVERY event for this pointer is
    // retargeted to the source cell — `e.target` is always the origin, never the
    // cell under the cursor (issue #302, Defect B). Resolve the drop target from the
    // pointer's coordinates instead. elementFromPoint returns the element at
    // (clientX, clientY): a cell when the release is over one, its stack head when
    // the release is over a continuation cell, or null when the release left the
    // grid (a null outermost element -> slot index -1, which unequips per SPEC-0006
    // "dragged off the grid").
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-slot-index]");
    const target = over ? Number(over.dataset.slotIndex) : -1;
    grabRef.current = null;
    if (target === -1) {
      dispatch(loadoutActions.moveEquip({ from: grab.from, to: -1 }));
      return;
    }
    if (target === grab.from) return;
    dispatch(loadoutActions.moveEquip({ from: grab.from, to: target }));
  };
  const onLostPointerCapture = (e) => {
    if (
      grabRef.current &&
      grabRef.current.mode === "pointer" &&
      grabRef.current.pointerId === e.pointerId
    ) {
      grabRef.current = null;
    }
  };

  // Keyboard: Space starts a grab on a cell (EquipmentSlot); arrows move the grab
  // through the CURRENT arrangement; Enter / Ctrl+M drops the grab; Escape cancels.
  const onGridKeyDown = (e) => {
    const k = e.key;
    const px = gridRef.current?.clientWidth ?? 0;
    if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
      const grab = grabRef.current;
      if (!grab || grab.mode !== "keyboard") return;
      const step = arrowTarget(grab.from, k.replace("Arrow", ""), px);
      if (step === null) {
        // The arrow left the grid — an edge no-op in EITHER arrangement. The grab
        // survives (the user may still drop with a later arrow / Enter), matching the
        // pointer grab, which also survives an off-grid release.
        announceFailure(gridRef.current, "At the edge of the grid");
        e.preventDefault();
        return;
      }
      grabRef.current = { ...grab, from: step };
      e.preventDefault();
    } else if (k === "Enter" || (e.ctrlKey && (e.key === "m" || e.key === "M"))) {
      const grab = grabRef.current;
      if (grab && grab.mode === "keyboard") {
        // Drop the grabbed item onto the cell the grab is on now. The grab keeps the
        // ORIGIN cell at grab time; arrows move `from`, and the drop moves the
        // origin's item to the current cell — the keyboard mirror of the pointer
        // swap/place. Dropping back onto the origin is the no-op the pointer path
        // also has.
        dispatch(loadoutActions.moveEquip({ from: grab.origin, to: grab.from }));
        grabRef.current = null;
      }
    }
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
            grabRef={grabRef}
          />
        ))}
      </div>
    </div>
  );
}
