// Shared pointer-grab + arrow-step logic for the equipment grid.
//
// Governing: ADR-0009, SPEC-0006 REQ "Items Are Rearranged by Direct Manipulation",
// REQ "Keyboard Equivalence for Every Pointer Gesture".
//
// The grid is a fixed eight-cell arrangement that TRANSPOSES between 4×2 (wide panel)
// and 2×4 (narrow panel). The vertical arrow's step therefore depends on the CURRENT
// arrangement: in the wide arrangement the cell below is +4; in the narrow one it is
// +1.
//
// The sensor does not know the threshold and does not measure the panel. SPEC-0006 REQ
// "The Grid Renders as Two Ranks of Four" requires the threshold to be declared in
// exactly one place — the `@container` condition in global.css — and forbids any
// consumer from determining the arrangement "by measuring rendered geometry or reading
// back a computed track count". So each branch of that query declares
// `--equip-arrangement`, and this module reads the token. The number lives in CSS; the
// keyboard reads the ANSWER, not the input.
//
// This replaces a `gridRef.clientWidth >= 460` comparison against a second copy of the
// literal. Two copies is how the keyboard silently keeps stepping +4 after the
// breakpoint moves — and `clientWidth` is 0 before the first layout, so the sensor
// answered "narrow" for a wide grid until something forced a reflow.
export const ARRANGEMENT_PROPERTY = "--equip-arrangement";

/**
 * The arrangement the stylesheet says is in effect: "wide" (4×2) or "narrow" (2×4).
 *
 * Falls back to "narrow" when the token cannot be read — no element, no stylesheet, or
 * a browser that did not apply the `@container` block. That default is not arbitrary:
 * `narrow` is what the UNCONDITIONAL `.equip-grid` rule declares, so a browser that
 * skips the query renders two columns and the sensor agrees with it.
 */
export function readArrangement(el) {
  if (!el) return "narrow";
  const declared = getComputedStyle(el).getPropertyValue(ARRANGEMENT_PROPERTY).trim();
  return declared === "wide" ? "wide" : "narrow";
}

/** The cell an arrow moves to from `from`, or null when the arrow would leave the grid. */
export function arrowTarget(from, key, arrangement) {
  const wide = arrangement === "wide";
  const cols = wide ? 4 : 2;
  const rows = wide ? 2 : 4;
  const row = Math.floor(from / cols);
  const col = from % cols;
  let target = null;
  if (key === "Down") {
    if (row === rows - 1) return null; // at the bottom edge in EITHER arrangement
    target = from + (wide ? 4 : 1);
  } else if (key === "Up") {
    if (row === 0) return null;
    target = from - (wide ? 4 : 1);
  } else if (key === "Right") {
    if (col === cols - 1) return null; // at the right edge
    target = from + 1;
  } else if (key === "Left") {
    if (col === 0) return null;
    target = from - 1;
  }
  return target;
}

// Governing: issue #419 (same defect class as #400), SPEC-0006 REQ "Keyboard
// Equivalence for Every Pointer Gesture", SPEC-0001 (WCAG 2.1 AA baseline).
//
// A rejected-keyboard-drop `announceFailure` used to live here as a DOM-manipulating
// helper that created the `[data-testid="equip-announcer"]` live region on first use
// and filled it in the same synchronous block — inserting a live region together with
// its content is silent to assistive tech, so the FIRST rejected drop of a page
// session announced nothing. EquipmentPanel.jsx is this module's only caller, so the
// fix retires the DOM-manipulating helper entirely: the panel now owns the announced
// message as React state (`gridAnnounceMessage`) and renders the live region
// permanently, exactly as it already does for `overCapMessage` /
// `equip-overcap-announcer`. Rejecting an arrow at the grid edge just calls the
// panel's own setter — see EquipmentPanel.jsx.
