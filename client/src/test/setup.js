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

// jsdom implements no PointerEvent either, and that one is not merely a missing method: with
// no constructor to find, Testing Library falls back to a plain Event whose constructor ignores
// the pointer fields, so `fireEvent.pointerDown(el, { pointerType: "touch" })` reaches the
// handler reading `pointerType` as null. Every touch press in the suite therefore looked like a
// mouse press.
//
// That is load-bearing since issue #312: the equipment grid branches on `pointerType`, because
// a touch drag may start only from the tile's grip while a touch on the tile BODY has to stay
// available to the browser as a page pan. Without a constructor carrying the field, that branch
// cannot be exercised at all and a regression in it is invisible.
//
// Minimal on purpose — PointerEvent is MouseEvent plus the pointer fields, which is all the
// suite reads. This is not a spec-complete implementation, and it is emphatically NOT a
// substitute for the real-browser test #312 requires: jsdom still has no `touch-action`, no
// pointer capture and no gesture arbitration, so what a browser DOES with these events remains
// out of reach here.
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
      this.isPrimary = init.isPrimary ?? true;
      this.width = init.width ?? 1;
      this.height = init.height ?? 1;
      this.pressure = init.pressure ?? 0;
    }
  }
  globalThis.PointerEvent = PointerEvent;
  if (typeof window !== "undefined") window.PointerEvent = PointerEvent;
}
