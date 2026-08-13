// Shared pointer-grab + arrow-step logic for the equipment grid.
//
// Governing: ADR-0009, SPEC-0006 REQ "Items Are Rearranged by Direct Manipulation",
// REQ "Keyboard Equivalence for Every Pointer Gesture".
//
// The grid is a fixed eight-cell arrangement that TRANSPOSES between 4×2 (wide panel)
// and 2×4 (narrow panel). The vertical arrow's step therefore depends on the CURRENT
// arrangement: in the wide arrangement the cell below is +4; in the narrow one it is
// +1. The arrangement is derived from the same panel-width threshold the CSS
// container query uses, so the keyboard follows what the screen shows, not what the
// DOM order implies.
export const WIDE_PANEL_MIN_WIDTH = 460;

/** The cell an arrow moves to from `from`, or null when the arrow would leave the grid. */
export function arrowTarget(from, key, panelWidthPx) {
  const wide = panelWidthPx >= WIDE_PANEL_MIN_WIDTH;
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

/**
 * Announce a rejected keyboard drop to assistive technology, without a live region
 * staying in the DOM after the announcement (it would re-read on every later change).
 */
export function announceFailure(root, message) {
  if (!root) return;
  let region = root.querySelector('[data-testid="equip-announcer"]');
  if (!region) {
    region = document.createElement("div");
    region.setAttribute("data-testid", "equip-announcer");
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.className = "sr-only";
    root.appendChild(region);
  }
  region.textContent = message;
}
