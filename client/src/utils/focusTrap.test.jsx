import { describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { focusableWithin, useFocusTrap } from "./focusTrap.js";

// Governing: SPEC-0003 REQ "Focus Management", SPEC-0003 REQ "Keyboard Navigation"
//
// The spec requires identical trap behaviour from BOTH the retire confirmation and the
// portrait picker. These tests cover the shared machinery once; the two dialogs' own tests
// cover what they do with it.

function Dialog({ onEscape = () => {}, useInitialRef = false }) {
  const ref = useRef(null);
  const lastRef = useRef(null);
  const { onKeyDown } = useFocusTrap(ref, {
    onEscape,
    initialFocusRef: useInitialRef ? lastRef : undefined,
  });
  return (
    <div ref={ref} role="dialog" onKeyDown={onKeyDown}>
      <button type="button">First</button>
      <button type="button" tabIndex={-1}>
        Skipped
      </button>
      <button type="button" ref={lastRef}>
        Last
      </button>
    </div>
  );
}

function Harness(props) {
  const showRef = useRef(null);
  return (
    <>
      <button type="button" ref={showRef}>
        Trigger
      </button>
      <Dialog {...props} />
    </>
  );
}

describe("focusableWithin", () => {
  it("skips elements parked out of the tab order by a roving tabindex", () => {
    // The picker grid puts tabindex="-1" on every option but the active one; Tab must land
    // on that single option rather than walking all 242.
    render(<Dialog />);
    const names = focusableWithin(screen.getByRole("dialog")).map((el) => el.textContent);
    expect(names).toEqual(["First", "Last"]);
  });

  it("answers safely for a container that is not mounted", () => {
    expect(focusableWithin(null)).toEqual([]);
  });
});

describe("useFocusTrap", () => {
  it("moves focus to the first focusable element on open", () => {
    render(<Dialog />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
  });

  it("honours an explicit entry point when the caller names one", () => {
    // The retire dialog opens on its confirm button rather than on Cancel.
    render(<Dialog useInitialRef />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));
  });

  it("wraps Tab at the end and Shift+Tab at the start", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog");
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });

    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("leaves Tab alone in the middle of the dialog", () => {
    render(<Dialog />);
    const dialog = screen.getByRole("dialog");
    screen.getByRole("button", { name: "First" }).focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    // No wrap forced — the browser's own sequential navigation takes it from here.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
  });

  it("reports Escape wherever focus currently sits inside the dialog", () => {
    const onEscape = vi.fn();
    render(<Dialog onEscape={onEscape} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Last" }), { key: "Escape" });
    expect(onEscape).toHaveBeenCalled();
  });

  it("ignores keys it does not own", () => {
    const onEscape = vi.fn();
    render(<Dialog onEscape={onEscape} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "a" });
    expect(onEscape).not.toHaveBeenCalled();
  });
});
