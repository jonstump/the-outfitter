// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Covers: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation", SPEC-0001 REQ "Attribution"
//
// Vitest setup file: adds jest-dom's DOM matchers (toBeInTheDocument, toHaveClass, ...) to every
// test file automatically, per client/vitest.config.js's `test.setupFiles`.
import "@testing-library/jest-dom/vitest";

// jsdom does not implement Element.prototype.scrollIntoView. The panel calls it to bring an
// expanded list into view (a real-browser affordance), so stub it rather than weakening the
// production call for a test-only gap.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
