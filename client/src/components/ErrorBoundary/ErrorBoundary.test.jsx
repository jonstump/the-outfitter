import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { LS_CUR } from "../../utils/loadoutCodec.js";

// Governing: issue #201 (a crafted share link permanently blanks the app)
//
// The boundary is the recovery path, so what it must do is offer one: show a way out, and
// actually drop the persisted build behind it. A render failure that leaves the poisoned
// state in localStorage has fixed nothing — the next visit fails identically.

function Boom() {
  throw new Error("render exploded");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // React logs the caught error, and so does componentDidCatch. Neither is a test failure.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>the planner</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("the planner")).toBeInTheDocument();
  });

  it("shows a recoverable screen instead of an empty page when a child throws", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discard this build/i })).toBeInTheDocument();
  });

  it("discards the persisted build and the share fragment when the user recovers", () => {
    localStorage.setItem(LS_CUR, JSON.stringify({ v: 1, w: [["nagant-m1895", 9999], null] }));
    const reload = vi.fn();
    // jsdom's location.reload is not a spy target; replace the property for this test.
    const original = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, pathname: "/", search: "", reload },
    });
    const replaceState = vi.spyOn(history, "replaceState").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole("button", { name: /discard this build/i }));

    // Both halves matter: the stored build is what a hash-less visit reads back, and the
    // fragment is what would re-seed it on the reload.
    expect(localStorage.getItem(LS_CUR)).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/");
    expect(reload).toHaveBeenCalled();

    Object.defineProperty(window, "location", original);
  });
});
