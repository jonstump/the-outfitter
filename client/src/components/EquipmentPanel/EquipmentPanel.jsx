import { useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { selectEquipCount, selectEquipOverCapacity } from "../../store/selectors.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import EquipmentSlot from "./EquipmentSlot.jsx";
import { equipRuns } from "../../utils/stacking.js";
import { announceFailure, arrowTarget, readArrangement } from "./gridMove.js";

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
  const overCap = useSelector(selectEquipOverCapacity);
  // One message, two channels: the visible warning and the live region below both
  // read it, so the sighted and announced surfaces cannot drift apart. Empty string
  // when the grid is legal — the live region is mounted either way.
  const overCapMessage = !overCap
    ? ""
    : overCap.kind === "slots"
      ? `Over capacity — ${overCap.held} items in ${overCap.max} slots. Remove an item or unblock a cell.`
      : `Over capacity — more than ${overCap.max} ${overCap.category} consumables equipped. Drop one.`;
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
  // Governing: issue #312. A gesture the BROWSER takes over — a touch it claims as a
  // page pan, a native drag, a system edge swipe — ends in pointercancel and never
  // delivers pointerup, so the grab has to be dropped here too or it outlives the
  // gesture that owned it. This was previously discarded only as a side effect of
  // onLostPointerCapture; handling the cancel itself makes the no-op deliberate rather
  // than incidental, and gives the one place to hang drop-target feedback when a
  // cancelled drag needs to say so.
  const onGridPointerCancel = (e) => {
    if (
      grabRef.current &&
      grabRef.current.mode === "pointer" &&
      grabRef.current.pointerId === e.pointerId
    ) {
      grabRef.current = null;
    }
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
    // The arrangement is READ FROM THE STYLESHEET's own token, not measured: the
    // `@container` query that transposes the grid declares `--equip-arrangement` in
    // each branch, so the keyboard follows whichever branch the browser applied.
    // SPEC-0006 forbids deriving it from rendered geometry, and the `clientWidth`
    // this replaces reported 0 before first layout.
    const arrangement = readArrangement(gridRef.current);
    if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
      const grab = grabRef.current;
      if (!grab || grab.mode !== "keyboard") return;
      const step = arrowTarget(grab.from, k.replace("Arrow", ""), arrangement);
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
        onPointerCancel={onGridPointerCancel}
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
      {/* Governing: issue #353, ADR-0015. A build the game refuses (five of one
          consumable type, or more items than unblocked cells) must be surfaced
          here rather than priced confidently. Driven from the shared capacity
          predicates so the warning cannot disagree with the reducer's rules. */}
      {overCap && <div className="over-capacity-warning">{overCapMessage}</div>}
      {/* The ANNOUNCED channel, separate from the visible one above and mounted
          permanently — inserting a live region together with its content is the way
          to get silence from a screen reader, which is the defect #400 fixed in
          WeaponSlot.jsx and the reason ActionsPanel.jsx renders its two regions
          unconditionally with empty text. The visible warning stays conditional so
          the panel gains no empty element when the grid is legal.
          Governing: issue #353, SPEC-0001 (WCAG 2.1 AA baseline). */}
      <div
        data-testid="equip-overcap-announcer"
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {overCapMessage}
      </div>
    </div>
  );
}
