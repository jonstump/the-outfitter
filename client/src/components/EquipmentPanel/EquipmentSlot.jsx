import { useDispatch, useSelector } from "react-redux";
import { useLayoutEffect, useMemo, useRef } from "react";
import { CONS, CONS_TYPE_COLOR, TOOLS, TOOL_COLOR, consThumb, toolThumb } from "../../data/catalog.js";
import { selectBlockedCells, selectEquipEntry } from "../../store/selectors.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import ItemThumb from "../ItemThumb/ItemThumb.jsx";

// The grab ref is owned by EquipmentPanel and threaded to every slot. A standalone
// slot (its test suite renders it directly) may omit the prop.
function emptyRef() {
  return { current: null };
}

// Governing: SPEC-0006 REQ "Keyboard Equivalence for Every Pointer Gesture" — the
// grid SHALL announce the grabbed item through an `aria-live` region. EquipmentPanel
// owns that region's state (`gridAnnounceMessage`) and passes its setter down; a
// standalone slot (its test suite renders it directly) may omit the prop.
function noopAnnounce() {}

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

export default function EquipmentSlot({ index, run, grabRef, onAnnounce = noopAnnounce }) {
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
      // Governing: issue #417 (compare against the PRESSED cell, not `from` — the
      // arrow keys move `from` away from it) and issue #464 (compare against
      // `pressedIndex`, not `origin` — a grab started on a stack's CONTINUATION cell
      // anchors `origin`/`from` at the run's head, while DOM focus, and therefore
      // this keydown, stays on the cell that was actually pressed for the rest of
      // the gesture; arrows move `from`, never focus).
      if (ref.current && ref.current.pressedIndex === index) {
        ref.current = null;
        e.preventDefault();
      }
      return;
    }
    if (e.key === " " || e.key === "Spacebar") {
      // Space on a filled cell starts a keyboard grab, stored in the shared ref so
      // the grid root's Enter handler reads it synchronously.
      //
      // Governing: ADR-0009, SPEC-0006 REQ "Repeated Consumables Read as One Stack",
      // issue #464. "Dragging any cell of a stack... move[s] the entire run as a
      // unit" applies to the keyboard grab too: when this cell is part of a run of
      // more than one cell, the grab's `origin`/`from` anchor at the run's HEAD
      // (its lowest-numbered cell), never at the pressed cell's own index — whether
      // the press landed on the head or a continuation cell. `pressedIndex` keeps
      // the cell that was actually pressed, for the Escape check above only.
      if (entry && !ref.current) {
        const isRun = run && run.cells.length > 1;
        const anchor = isRun ? run.cells[0] : index;
        ref.current = {
          origin: anchor,
          from: anchor,
          mode: "keyboard",
          length: isRun ? run.cells.length : 1,
          pressedIndex: index,
        };
        // Governing: SPEC-0006 REQ "Keyboard Equivalence for Every Pointer Gesture"
        // — "a grabbed stack SHALL be announced with its quantity". `def` is defined
        // below (this branch only runs when `entry` is truthy, so this render did
        // not take the empty-cell early return and `def` is already assigned).
        onAnnounce(`Grabbed ${def[1]}${isRun ? `, ${run.cells.length} items` : ""}, cell ${anchor + 1} of 8`);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "Enter" || (e.ctrlKey && (e.key === "m" || e.key === "M"))) {
      // Governing: SPEC-0006 §129/§618 — Enter on an EMPTY cell toggles its blocked
      // state via the button's own native activation (the empty-slot button below
      // carries `onClick`). `preventDefault` must not fire in that case, or the
      // native click that activation would otherwise produce never happens. A
      // filled cell has no `onClick` on its tile, so preventing default there is
      // still safe — it only stops a no-op native activation, not a real one — and
      // the grid root's own Enter handler (bubbled, not stopped here) is what
      // commits an in-progress grab.
      if (!entry) return;
      e.preventDefault();
      return;
    }
    if (e.key.startsWith("Arrow")) {
      // Stop the page scrolling on arrow keys over the grid; the grid root's keydown
      // handles the grab movement itself.
      e.preventDefault();
    }
  };

  // Pointer Events, not HTML5 drag-and-drop (ADR-0009). A grab starts on a filled
  // cell; pointermove/pointerup are captured on the grid root (EquipmentPanel) so a
  // drag can leave the cell and still drop elsewhere or off-grid (unequip).
  //
  // Shared by the tile body (mouse and pen) and by the drag handle (every pointer
  // type). Capture is set on whichever element took the press, so the grid root still
  // sees pointerup / pointercancel for the gesture either way.
  const startGrab = (e) => {
    if (!entry) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // Governing: ADR-0009, SPEC-0006 REQ "Repeated Consumables Read as One Stack",
    // issue #464. Same anchoring as the keyboard Space-grab above: the grab
    // originates at the run's HEAD, never the pressed cell's own index, whether the
    // press landed on the head or a continuation cell (the continuation branch below
    // wires its own `onPointerDown` to this same function).
    const isRun = run && run.cells.length > 1;
    const anchor = isRun ? run.cells[0] : index;
    ref.current = {
      origin: anchor,
      from: anchor,
      mode: "pointer",
      pointerId: e.pointerId,
      length: isRun ? run.cells.length : 1,
      pressedIndex: index,
    };
  };

  // Governing: SPEC-0006 REQ "Items Are Rearranged by Direct Manipulation", issue #312.
  //
  // The tile BODY is a mouse/pen drag source only. A finger press here has to stay
  // available to the browser as a page pan, so the body keeps `touch-action: auto` and
  // only `.equip-drag-handle` opts out. The alternative — `touch-action: none` on the
  // whole tile — also works, and also turns a full grid (692px tall inside a 664px
  // viewport at 390px wide) into a scroll dead zone larger than one screen.
  //
  // The guard is not cosmetic. Without it a finger drag here still starts a grab, the
  // browser then claims the gesture and fires pointercancel instead of pointerup, and
  // the drag is the silent no-op #312 exists to fix. Refusing the grab makes the same
  // press an honest page scroll instead.
  const onPointerDown = (e) => {
    if (e.pointerType === "touch") return;
    startGrab(e);
  };

  // The continuation cells of a stack are part of the same tile; the grid root's
  // drop handler treats a drop on them as a drop on the stack head.
  const runCells = run ? run.cells : [index];
  const isStackHead = run ? run.cells[0] === index : true;
  // Governing: SPEC-0006 REQ "The Grid Renders as Two Ranks of Four". The tile's
  // keyboard grab-and-place model must survive the markup change below, so the
  // cell keeps an explicit tabIndex (the <button> it used to be was natively
  // focusable) and the continuation branch's hand-managed tab indices are kept.
  const cellRef = useRef(null);
  // Governing: SPEC-0006 REQ "Keyboard Equivalence for Every Pointer Gesture".
  // The ✕ unmounts itself the moment it dispatches, so without this the focus
  // would fall to document.body (#131). Draw focus to the now-empty cell at the
  // same index the layout effect runs BEFORE paint (useLayoutEffect), so there is
  // no visibly intermediate focused state.
  const removing = ref.current && ref.current.removeIndex === index;
  useLayoutEffect(() => {
    if (removing && cellRef.current) {
      cellRef.current.focus();
      // The removal marker is one-shot: clear the ref outright so a later Space-grab
      // is not blocked (handleKeyDown starts a grab only when `!ref.current`, and
      // `delete`-ing the key would leave a truthy `{}` behind — issue #303 review).
      // Nulling is safe: the ✕ stops pointerdown propagation, so removal can never
      // run mid-drag and there is no in-flight grab to preserve.
      ref.current = null;
    }
  }, [removing, index]);
  // Governing: SPEC-0006 REQ "Keyboard Equivalence for Every Pointer Gesture" —
  // "After a completed move, focus SHALL rest on the destination cell... Focus MUST
  // NOT be lost to the document body by any grid operation" (corrected 2026-08-17
  // per `/sdd:audit`). A successful keyboard commit in EquipmentPanel's grid-root
  // handler sets `focusIndex` on the shared ref rather than nulling it outright, the
  // same one-shot-marker pattern `removing` above already uses — the ORIGIN cell's
  // `.equip-tile-main` button (which held focus throughout the grab) may unmount on
  // this same render if the move emptied it, so focus has to be re-acquired on
  // whichever cell now renders at the destination index, after that render commits.
  const focusingDestination = ref.current && ref.current.focusIndex === index;
  useLayoutEffect(() => {
    if (focusingDestination && cellRef.current) {
      cellRef.current.focus();
      ref.current = null;
    }
  }, [focusingDestination, index]);

  if (!entry) {
    const targetCell = index;
    return (
      <button
        ref={cellRef}
        className={`equip-slot empty-slot${isBlocked ? " blocked-slot" : ""}`}
        title={isBlocked ? "Unblock this slot" : "Block this slot (excluded from loadout)"}
        aria-pressed={isBlocked}
        data-slot-index={index}
        onKeyDown={handleKeyDown}
        onClick={() => dispatch(loadoutActions.toggleBlockedSlot(index))}
        tabIndex={0}
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
    // Governing: SPEC-0006 REQ "Repeated Consumables Read as One Stack". Only the
    // stack HEAD (the lowest-numbered cell of the run) carries a ✕ — removing a
    // copy empties that cell and the remaining copies close up contiguous one cell
    // higher — so continuation cells never render a remove control.
    return (
      <button
        ref={cellRef}
        className="equip-slot filled-slot stack-continuation"
        title={`${def[1]} (stack of ${runCells.length})`}
        aria-label={`${def[1]} (stack of ${runCells.length})`}
        data-slot-index={index}
        data-stack-head={runCells[0]}
        // Governing: SPEC-0006 §616 "Every cell SHALL be focusable and operable by
        // keyboard" — unqualified, so every continuation cell of a stack gets its
        // own tab stop like every other cell, not just the one immediately after
        // the head (corrected 2026-08-17 per `/sdd:audit`: a ×3/×4 stack's third and
        // fourth cells were previously `tabIndex={-1}` and permanently unreachable
        // by Tab).
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={handleKeyDown}
      >
        <span className="equip-name">{def[1]}</span>
      </button>
    );
  }

  // Governing: SPEC-0006 REQ "Items Are Rearranged by Direct Manipulation",
  // REQ "Keyboard Equivalence for Every Pointer Gesture" (removal keeps a keyboard
  // route and returns focus to the emptied cell), ADR-0009 (removal does not
  // compact — the ✕ empties THIS cell and nothing else).
  const removeCell = (e) => {
    e.preventDefault();
    e.stopPropagation();
    ref.current = { ...ref.current, removeIndex: index };
    dispatch(loadoutActions.removeEquip(index));
  };
  const tileTabIndex = 0;

  return (
    <div
      className={`equip-slot filled-slot${drag && drag.from === index ? " grabbing" : ""}`}
      title={`${def[1]} — drag to move${runCells.length > 1 ? ` (stack of ${runCells.length})` : ""}`}
      data-testid={`equip-tile-${index}`}
      data-slot-index={index}
      onPointerDown={onPointerDown}
    >
      {/* Governing: SPEC-0006 REQ "Items Are Rearranged by Direct Manipulation",
          SPEC-0006 § Icon-Only Controls, issue #312.

          The grip is the drag source for TOUCH — the one element carrying
          `touch-action: none`, so a finger drag here is not stolen by the page pan while
          a swipe anywhere else on the tile still scrolls. Mouse and pen may drag from it
          or from the tile body; both routes call the same startGrab.

          Deliberately a <span>, not a <button>: it is a pointer-only affordance, and the
          keyboard equivalence SPEC-0006 requires is already carried by .equip-tile-main
          (Space grabs, arrows move, Enter drops). A focusable control here would put a
          second stop in the tab order that does nothing on Enter.

          NAMED, NOT HIDDEN, and the distinction is the whole point. This shipped as
          aria-hidden on the reasoning above, which is sound about FOCUSABILITY and does
          not reach naming — the two are independent, and § Icon-Only Controls names this
          element first and in those words:

            "The drag handle, the remove control, and any control that renders as an icon
             or a bare glyph SHALL carry an `aria-label` naming its purpose and the item
             it acts on."

          `role="img"` + `aria-label` satisfies that: a screen reader's virtual cursor
          announces it, and it adds no tab stop, so nothing about the focus argument is
          given up. A bare `aria-label` on a role-less <span> would NOT do — a generic
          element is not reliably exposed, and the role is what makes the name land.
          Same shape and same phrasing as .equip-remove-btn below, deliberately. */}
      <span
        className="equip-drag-handle"
        role="img"
        aria-label={`Drag ${def[1]}`}
        onPointerDown={(e) => {
          // Without this the press also reaches the tile body's handler, which would
          // start a second grab and re-capture the pointer on the outer element. The ✕
          // stops propagation for the same reason.
          e.stopPropagation();
          startGrab(e);
        }}
      >
        ⠿
      </span>
      <button
        ref={cellRef}
        className="equip-tile-main"
        aria-label={def[1]}
        tabIndex={tileTabIndex}
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
      <button
        className="icon-btn equip-remove-btn"
        title={`Remove ${def[1]}`}
        aria-label={`Remove ${def[1]}`}
        onClick={removeCell}
        onPointerDown={(e) => e.stopPropagation()}
      >
        ✕
      </button>
    </div>
  );
}