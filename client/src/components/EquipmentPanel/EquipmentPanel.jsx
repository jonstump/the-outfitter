import { useEffect, useRef, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { selectEquipCount, selectEquipOverCapacity } from "../../store/selectors.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import EquipmentSlot from "./EquipmentSlot.jsx";
import { canPlaceRun, equipRuns } from "../../utils/stacking.js";
import { arrowTarget, readArrangement } from "./gridMove.js";

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
  // Governing: issue #419 (same defect class as #400), SPEC-0006 REQ "Keyboard
  // Equivalence for Every Pointer Gesture". The panel owns the rejected-drop message
  // the same way it owns `overCapMessage` below, rather than a helper reaching into
  // the DOM to create the live region on first use — a region inserted together with
  // its content is silent to assistive tech, so DOM-creation-on-demand meant the
  // FIRST rejected drop of a page session announced nothing.
  const [gridAnnounceMessage, setGridAnnounceMessage] = useState("");

  // Governing: issue #417 (PR 2 of #352). The grab ref is cleared by pointerup,
  // pointercancel, lost capture, and the ✕ removal effect — but by nothing that
  // REPLACES the loadout. Randomize and Load both replace it, and a grab that
  // survives either no longer refers to the grid the user grabbed from: the origin
  // cell may now hold a different item (or none). Post-#415 the reducer guard
  // prevents duplication, but a move that SUCCEEDS still moves an item the user
  // never grabbed. Clear the ref whenever the equip array's IDENTITY changes, so
  // a grab never outlives the loadout that created it.
  useEffect(() => {
    grabRef.current = null;
  }, [loadout.equip]);

  const onGridPointerMove = (e) => {
    if (!grabRef.current || grabRef.current.mode !== "pointer") return;
    e.preventDefault();
  };
  const onGridPointerUp = (e) => {
    const grab = grabRef.current;
    if (!grab || grab.mode !== "pointer") return;
    // Governing: issue #417. Match the pointer identity the same way the cancel
    // and lost-capture handlers do, so a pointerup from a DIFFERENT gesture (e.g.
    // a second finger) does not end a grab it did not start.
    if (grab.pointerId !== e.pointerId) return;
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
    // Governing: ADR-0009, SPEC-0006 REQ "Repeated Consumables Read as One Stack",
    // issue #464. `grab.from` is always the run's ANCHOR by the time it reaches here
    // (EquipmentSlot's startGrab anchors it at grab time) and never changes for a
    // pointer drag, so `length` is the whole run's size throughout.
    const length = grab.length ?? 1;
    grabRef.current = null;
    if (target === -1) {
      // Dragging any cell of a stack off the grid unequips the ENTIRE run at once,
      // not just the pressed cell — off-grid is one more destination for "the entire
      // run as a unit" (SPEC-0006), not an exception carved out for single items.
      dispatch(loadoutActions.moveEquip({ from: grab.from, to: -1, length }));
      return;
    }
    if (target === grab.from) return;
    if (length > 1) {
      const run = equipRuns(loadout.equip).find((r) => r.cells[0] === grab.from);
      const cells = run ? run.cells : [grab.from];
      if (!canPlaceRun(loadout.equip, loadout.blocked, cells, target)) {
        // Rejected as a no-op (SPEC-0006 "Any other drop SHALL be rejected as a
        // no-op") — announce on the same channel a keyboard rejection uses below, so
        // a screen-reader user watching this region sees pointer and keyboard
        // rejections identically.
        setGridAnnounceMessage(`Cannot place here, ${length} cells needed`);
        return;
      }
    }
    dispatch(loadoutActions.moveEquip({ from: grab.from, to: target, length }));
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
        setGridAnnounceMessage("At the edge of the grid");
        e.preventDefault();
        return;
      }
      grabRef.current = { ...grab, from: step };
      // Governing: SPEC-0006 REQ "Keyboard Equivalence for Every Pointer Gesture" —
      // "the grid SHALL communicate... the current target through an aria-live
      // region" (corrected 2026-08-17 per `/sdd:audit` — previously only the
      // rejection case was announced).
      setGridAnnounceMessage(`Target cell ${step + 1} of 8`);
      e.preventDefault();
    } else if (k === "Enter" || (e.ctrlKey && (e.key === "m" || e.key === "M"))) {
      const grab = grabRef.current;
      if (grab && grab.mode === "keyboard") {
        // Drop the grabbed item onto the cell the grab is on now. The grab keeps the
        // ORIGIN cell at grab time; arrows move `from`, and the drop moves the
        // origin's item to the current cell — the keyboard mirror of the pointer
        // swap/place. Dropping back onto the origin is the no-op the pointer path
        // also has.
        //
        // Governing: ADR-0009, SPEC-0006 REQ "Repeated Consumables Read as One
        // Stack", issue #464. For a run grab (`length > 1`), `grab.origin` is
        // already the run's anchor (EquipmentSlot's Space-grab anchors it), so this
        // dispatch needs no extra lookup — but a REJECTED run drop needs its own
        // path here, matching design.md's sequence diagram: announce on the same
        // live region a rejected arrow-at-the-edge already uses, and return focus
        // to the anchor cell rather than leaving it on whichever cell the arrows
        // walked to, with the loadout left unchanged.
        const length = grab.length ?? 1;
        if (length > 1 && grab.from !== grab.origin) {
          const run = equipRuns(loadout.equip).find((r) => r.cells[0] === grab.origin);
          const cells = run ? run.cells : [grab.origin];
          if (!canPlaceRun(loadout.equip, loadout.blocked, cells, grab.from)) {
            setGridAnnounceMessage(`Cannot place here, ${length} cells needed`);
            grabRef.current = null;
            const anchorCell = gridRef.current?.querySelector(`[data-slot-index="${grab.origin}"]`);
            (anchorCell?.querySelector(".equip-tile-main") ?? anchorCell)?.focus();
            return;
          }
        }
        // Governing: SPEC-0006 REQ "Keyboard Equivalence for Every Pointer Gesture"
        // — "SHALL announce the outcome — moved, swapped, or rejected — on commit"
        // and "focus SHALL rest on the destination cell... MUST NOT be lost to the
        // document body" (corrected 2026-08-17 per `/sdd:audit`). Read occupancy
        // BEFORE dispatching: `moveEquip` overwrites `grab.from`'s entry either way,
        // so this is the only point a swap can still be distinguished from a move
        // into an empty cell. A drop back onto the origin (`grab.from ===
        // grab.origin`) changes nothing and is left silent, matching Escape-cancel.
        const destinationHadItem = loadout.equip[grab.from] !== null;
        const destination = grab.from;
        dispatch(loadoutActions.moveEquip({ from: grab.origin, to: destination, length }));
        if (destination !== grab.origin) {
          setGridAnnounceMessage(
            destinationHadItem ? `Swapped with cell ${destination + 1}` : `Moved to cell ${destination + 1}`
          );
          // One-shot marker, not an outright null: the ORIGIN cell's focused button
          // may unmount on this render (if the move emptied it), so focus has to be
          // re-acquired on whichever cell now renders at `destination`, after that
          // render commits — see EquipmentSlot's `focusingDestination` effect.
          grabRef.current = { focusIndex: destination };
        } else {
          grabRef.current = null;
        }
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
            onAnnounce={setGridAnnounceMessage}
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
      {/* A SECOND, DISTINCT live region for rejected keyboard drops (an arrow that
          would leave the grid) — kept separate from `equip-overcap-announcer` above
          because the two conditions are unrelated and merging them would make one
          announcement clobber the other. Mounted permanently for the same reason:
          inserting a live region together with its content is silent to assistive
          tech, so this has to already be in the tree before the FIRST rejected drop
          of a page session, not created on demand by the handler that rejects it.
          Governing: issue #419 (same defect class as #400), SPEC-0006 REQ "Keyboard
          Equivalence for Every Pointer Gesture", SPEC-0001 (WCAG 2.1 AA baseline). */}
      <div
        data-testid="equip-announcer"
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {gridAnnounceMessage}
      </div>
    </div>
  );
}
