// Shared pointer-grab + arrow-step logic for the equipment grid.
//
// Governing: ADR-0009, SPEC-0006 REQ "Items Are Rearranged by Direct Manipulation",
// REQ "Keyboard Equivalence for Every Pointer Gesture".
//
// The grid is a fixed eight-cell arrangement that TRANSPOSES between 4×2 (wide panel)
// and 2×4 (narrow panel). The vertical arrow's step therefore depends on the CURRENT
// arrangement: in the wide arrangement the cell below is +4; in the narrow one it is
// +1. The arrangement is derived from the same panel-width rule the CSS container
// query uses, so the keyboard follows what the screen shows, not what the DOM order
// implies.

/** The wide arrangement is 4 columns × 2 rows; narrow is 2 × 4. */
export function cellStep(panelWidthPx) {
  return panelWidthPx >= 460 ? { down: 4 } : { down: 1 };
}

/**
 * The cell an arrow moves to from `from`, or null when the arrow would leave the grid.
 *
 * `horizontalFirst` is the axis typed first (the tab's arrow key event always names the
 * primary axis the user intends). At a grid edge the step is a no-op (null), in BOTH
 * arrangements — the narrow arrangement's vertical step of +1 behaves exactly like the
 * horizontal one.
 */
export function arrowTarget(from, key, horizontalFirst, panelWidthPx) {
  const wide = panelWidthPx >= 460;
  const cols = wide ? 4 : 2;
  const rows = wide ? 2 : 4;
  let target = null;
  let horizontal = horizontalFirst;
  if (key === "Down") {
    horizontal = false;
    target = from + (wide ? 4 : 1);
  } else if (key === "Right") {
    horizontal = true;
    target = from + 1;
  } else if (key === "Up") {
    horizontal = false;
    target = from - (wide ? 4 : 1);
  } else if (key === "Left") {
    horizontal = true;
    target = from - 1;
  }
  if (target === null) return null;
  const col = from % cols;
  if (horizontal) {
    const atEdge = (key === "Right" && col === cols - 1) || (key === "Left" && col === 0);
    if (atEdge || target < 0 || target >= 8) return null;
    // Moving "down" by the wide arrangement's +4 from the bottom row would also land
    // out of the grid; guard the axis bounds explicitly.
    if (key === "Down" || key === "Up") {
      const fromRow = Math.floor(from / cols);
      const targetRow = Math.floor(target / cols);
      if (fromRow === rows - 1 && key === "Down") return null;
      if (fromRow === 0 && key === "Up") return null;
      if (targetRow !== fromRow + (key === "Down" ? 1 : -1)) return null;
    }
  } else {
    const row = Math.floor(from / cols);
    if ((key === "Down" && row === rows - 1) || (key === "Up" && row === 0)) return null;
    if (target < 0 || target >= 8) return null;
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
