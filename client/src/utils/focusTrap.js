// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
// Hunter Portraits), SPEC-0003 REQ "Focus Management", SPEC-0003 REQ "Keyboard Navigation"
//
// Extracted from RetireDialog, which grew the trap first. The spec names TWO dialogs that
// must trap focus — the retire confirmation and the portrait picker — with identical
// rules: trap Tab inside, move focus in on open, hand it back to the trigger on close,
// dismiss on Escape. Building the second copy by hand is how the two drift, so this is the
// one implementation both use.
//
// Deliberately a hook over a wrapper component: the two dialogs share no markup at all
// (one is a confirmation, one is a filterable roster), so a shared shell would be a
// container whose only job is to hold a ref.

import { useEffect, useRef } from "react";

const FOCUSABLE =
  "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/**
 * Focusable descendants of `root`, in DOM order. Empty array when root is null.
 *
 * The selector alone is not enough, and the gap is load-bearing here rather than
 * theoretical: `button` matches on the tag, so a `<button tabindex="-1">` satisfies the
 * first alternative and slips past the `:not([tabindex='-1'])` guard entirely. Roving-
 * tabindex composites — the picker's 242-option grid — park -1 on every item but the
 * active one, and Tab must reach that ONE item, not all of them. Filtering on the resolved
 * `tabIndex` catches every element the selector's tag alternatives wave through.
 *
 * Disabled controls are dropped for the same reason: they cannot take focus, so trapping
 * Tab onto one would strand the user.
 */
export function focusableWithin(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.disabled
  );
}

/**
 * Trap focus inside `containerRef` for as long as the component is mounted.
 *
 * @param containerRef  ref to the dialog root
 * @param onEscape      called when Escape is pressed anywhere inside the dialog
 * @param initialFocusRef  optional ref to focus on open; defaults to the first focusable
 *                         element, which is what SPEC-0003 "Focus Management" specifies.
 *                         The retire dialog overrides it to land on its confirm button.
 * @returns `{ onKeyDown, returnFocus }` — spread onKeyDown on the dialog root (so Escape
 *          works wherever focus currently sits) and call returnFocus() when closing.
 */
export function useFocusTrap(containerRef, { onEscape, initialFocusRef } = {}) {
  const returnFocusRef = useRef(null);
  // Kept in a ref so the mount effect never re-runs when a parent re-renders with a new
  // closure — re-running it would steal focus back out of whatever the user just tabbed to.
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    const target = initialFocusRef?.current ?? focusableWithin(containerRef.current)[0];
    target?.focus?.();
    // Mount-only: this establishes the dialog's entry and exit focus, both of which are
    // properties of the dialog being open at all rather than of any later render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const returnFocus = () => {
    // Optional-call: the trigger may have unmounted while the dialog was open (a list
    // retired in another tab). Dropping focus on <body> is bad; throwing is worse.
    returnFocusRef.current?.focus?.();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      escapeRef.current?.();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = focusableWithin(containerRef.current);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return { onKeyDown, returnFocus };
}
