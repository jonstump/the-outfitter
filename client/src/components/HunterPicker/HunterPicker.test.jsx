import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import HunterPicker from "./HunterPicker.jsx";

// Governing: ADR-0006, ADR-0007, SPEC-0003 REQ "The Hunter Picker Is Filterable and
// Bounded", SPEC-0003 REQ "The Hunter Picker Does Not Restrict or Mark Reuse", SPEC-0003
// REQ "Focus Management", SPEC-0003 REQ "Keyboard Navigation"
//
// A five-entry fixture roster stands in for the 242. Two entries share a name prefix so
// the free-text filter has something to actually narrow, and one has a null `acquisition`
// and a null `obtainable` — the two live entries that shape do exist for, and the reason
// the filters need an explicit Unknown bucket rather than dropping them.
vi.mock("../../data/hunters.json", () => ({
  default: [
    { id: "the-rat", name: "The Rat", portrait: "the-rat", acquisition: "dlc", obtainable: true },
    { id: "the-raven", name: "The Raven", portrait: "the-raven", acquisition: "dlc", obtainable: true },
    { id: "bad-hand", name: "Bad Hand", portrait: "bad-hand", acquisition: "event", obtainable: false },
    { id: "the-ol-cowpoke", name: "The Ol' Cowpoke", portrait: "the-ol-cowpoke", acquisition: null, obtainable: null },
    { id: "kingsnake", name: "Kingsnake", portrait: "kingsnake", acquisition: "blood-bonds", obtainable: true },
  ],
}));

/** Trigger + picker, so focus-return has somewhere real to return to. */
function Harness({ onSelect = () => {}, selectedHunterId = null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Choose portrait
      </button>
      {open && (
        <HunterPicker
          selectedHunterId={selectedHunterId}
          onClose={() => setOpen(false)}
          onSelect={(chosen) => {
            onSelect(chosen);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

const openPicker = () => {
  const trigger = screen.getByRole("button", { name: "Choose portrait" });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
};

// Scoped to the listbox on purpose: the acquisition and availability filters are native
// <select>s, so an unscoped role="option" query sweeps their <option>s in too.
const tiles = () => within(screen.getByRole("listbox")).getAllByRole("option");
const tileNames = () => tiles().map((o) => o.textContent.trim());

describe("HunterPicker filtering", () => {
  it("narrows to hunters whose name matches the free-text filter", () => {
    render(<Harness />);
    openPicker();
    expect(tileNames()).toContain("Bad Hand");

    fireEvent.change(screen.getByLabelText("Filter hunters by name"), { target: { value: "rav" } });
    expect(tileNames()).toContain("The Raven");
    expect(tileNames()).not.toContain("The Rat");
    expect(tileNames()).not.toContain("Bad Hand");
  });

  it("matches case-insensitively on any part of the name", () => {
    render(<Harness />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Filter hunters by name"), { target: { value: "SNAKE" } });
    expect(screen.getByTestId("hunter-tile-kingsnake")).toBeInTheDocument();
    expect(screen.queryByTestId("hunter-tile-the-rat")).not.toBeInTheDocument();
  });

  it("narrows by acquisition using the dataset's own values", () => {
    render(<Harness />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Filter by acquisition"), { target: { value: "dlc" } });
    expect(screen.getByTestId("hunter-tile-the-rat")).toBeInTheDocument();
    expect(screen.getByTestId("hunter-tile-the-raven")).toBeInTheDocument();
    expect(screen.queryByTestId("hunter-tile-bad-hand")).not.toBeInTheDocument();
  });

  it("gives the null-acquisition entries a bucket instead of dropping them", () => {
    // Two real hunters have no acquisition. Without an Unknown option they would be
    // unreachable through this control while still being perfectly selectable hunters.
    render(<Harness />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Filter by acquisition"), { target: { value: "__unknown__" } });
    expect(screen.getByTestId("hunter-tile-the-ol-cowpoke")).toBeInTheDocument();
    expect(screen.queryByTestId("hunter-tile-the-rat")).not.toBeInTheDocument();
  });

  it("filters by availability, including the unknown case", () => {
    render(<Harness />);
    openPicker();
    const availability = screen.getByLabelText("Filter by availability");

    fireEvent.change(availability, { target: { value: "no" } });
    expect(screen.getByTestId("hunter-tile-bad-hand")).toBeInTheDocument();
    expect(screen.queryByTestId("hunter-tile-the-rat")).not.toBeInTheDocument();

    fireEvent.change(availability, { target: { value: "__unknown__" } });
    expect(screen.getByTestId("hunter-tile-the-ol-cowpoke")).toBeInTheDocument();
  });

  it("combines filters rather than replacing one with the other", () => {
    render(<Harness />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Filter hunters by name"), { target: { value: "the" } });
    fireEvent.change(screen.getByLabelText("Filter by acquisition"), { target: { value: "dlc" } });
    expect(screen.getByTestId("hunter-tile-the-rat")).toBeInTheDocument();
    expect(screen.queryByTestId("hunter-tile-the-ol-cowpoke")).not.toBeInTheDocument();
  });

  it("says nothing matched rather than rendering an empty grid", () => {
    render(<Harness />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Filter hunters by name"), { target: { value: "zzzz" } });
    expect(screen.getByText(/No hunters match those filters/i)).toBeInTheDocument();
    // …and the no-portrait escape hatch is still reachable from the dead end.
    expect(screen.getByTestId("hunter-tile-none")).toBeInTheDocument();
  });

  it("reports how many hunters the filters left", () => {
    render(<Harness />);
    openPicker();
    expect(screen.getByText("5 of 5 hunters")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter hunters by name"), { target: { value: "the r" } });
    expect(screen.getByText("2 of 5 hunters")).toBeInTheDocument();
  });

  it("does not reorder the roster when filtering", () => {
    render(<Harness />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Filter hunters by name"), { target: { value: "the" } });
    // Dataset order preserved, minus the non-matches. Filtering narrows and does nothing else.
    expect(tileNames().slice(0, 3)).toEqual(["The Rat", "The Raven", "The Ol' Cowpoke"]);
  });
});

describe("HunterPicker reuse", () => {
  it("takes no input describing which hunters are already in use", () => {
    // The strongest guarantee available that reuse cannot be marked: the component has no
    // way to know. There is no prop to thread it through and no badge to remove later.
    const props = HunterPicker.length;
    expect(props).toBe(1); // a single props object
    render(<Harness />);
    openPicker();
    // Every hunter tile carries the same class list — no dimming, no badge, no variant.
    const classes = new Set(
      tiles()
        .filter((o) => o.dataset.testid !== "hunter-tile-none")
        .map((o) => o.className)
    );
    expect(classes).toEqual(new Set(["hp-tile"]));
  });

  it("leaves every hunter enabled and selectable", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    openPicker();
    for (const option of tiles()) {
      expect(option).not.toHaveAttribute("aria-disabled", "true");
      expect(option).not.toHaveAttribute("disabled");
    }
    fireEvent.click(screen.getByTestId("hunter-tile-the-rat"));
    expect(onSelect).toHaveBeenCalledWith({ hunterId: "the-rat", hunterName: "The Rat" });
  });

  it("marks only the current selection, never prior usage", () => {
    render(<Harness selectedHunterId="bad-hand" />);
    openPicker();
    expect(screen.getByTestId("hunter-tile-bad-hand")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("hunter-tile-the-rat")).toHaveAttribute("aria-selected", "false");
  });

  it("offers an explicit no-portrait choice that yields a null hunterId", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    openPicker();
    fireEvent.click(screen.getByTestId("hunter-tile-none"));
    expect(onSelect).toHaveBeenCalledWith({ hunterId: null, hunterName: null });
  });
});

describe("HunterPicker portraits", () => {
  it("defers every tile's portrait", () => {
    render(<Harness />);
    openPicker();
    const images = tiles().flatMap((o) => Array.from(o.querySelectorAll("img")));
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) {
      expect(img).toHaveAttribute("loading", "lazy");
      expect(img.getAttribute("src").startsWith("/images/hunters/")).toBe(true);
    }
  });

  it("asks tiles for the thumbnail size, not the full portrait", () => {
    render(<Harness />);
    openPicker();
    expect(screen.getByTestId("hunter-tile-the-rat").querySelector("img")).toHaveAttribute(
      "src",
      "/images/hunters/the-rat-thumb.avif"
    );
  });
});

describe("HunterPicker focus and keyboard", () => {
  it("moves focus to its first focusable element on open", () => {
    render(<Harness />);
    openPicker();
    expect(document.activeElement).toBe(screen.getByLabelText("Filter hunters by name"));
  });

  it("closes on Escape and hands focus back to the trigger", () => {
    render(<Harness />);
    const trigger = openPicker();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("returns focus to the trigger after a selection too", () => {
    render(<Harness />);
    const trigger = openPicker();
    fireEvent.click(screen.getByTestId("hunter-tile-the-rat"));
    expect(document.activeElement).toBe(trigger);
  });

  it("traps Tab inside the dialog", () => {
    render(<Harness />);
    openPicker();
    const dialog = screen.getByRole("dialog");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const search = screen.getByLabelText("Filter hunters by name");

    cancel.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(search);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  it("navigates the grid with arrow keys and Home/End", () => {
    render(<Harness />);
    openPicker();
    const grid = screen.getByRole("listbox");
    const options = tiles();

    // Roving tabindex: exactly one option is tabbable, so Tab reaches the grid in one stop.
    expect(options.filter((o) => o.tabIndex === 0)).toHaveLength(1);

    options[0].focus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(document.activeElement).toBe(options[1]);

    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(options[0]);

    fireEvent.keyDown(grid, { key: "End" });
    expect(document.activeElement).toBe(options[options.length - 1]);

    fireEvent.keyDown(grid, { key: "Home" });
    expect(document.activeElement).toBe(options[0]);
  });

  it("selects the focused option with Enter and with Space", () => {
    const onSelect = vi.fn();
    const { unmount } = render(<Harness onSelect={onSelect} />);
    openPicker();
    fireEvent.keyDown(screen.getByTestId("hunter-tile-the-raven"), { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith({ hunterId: "the-raven", hunterName: "The Raven" });
    unmount();

    render(<Harness onSelect={onSelect} />);
    openPicker();
    fireEvent.keyDown(screen.getByTestId("hunter-tile-none"), { key: " " });
    expect(onSelect).toHaveBeenLastCalledWith({ hunterId: null, hunterName: null });
  });

  it("keeps the roving tabindex in range when a filter shortens the list", () => {
    render(<Harness />);
    openPicker();
    const grid = screen.getByRole("listbox");
    fireEvent.keyDown(grid, { key: "End" });
    fireEvent.change(screen.getByLabelText("Filter hunters by name"), { target: { value: "rav" } });
    const options = tiles();
    expect(options.filter((o) => o.tabIndex === 0)).toHaveLength(1);
  });

  it("is a modal dialog with an accessible name", () => {
    render(<Harness />);
    openPicker();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Choose a portrait" })).toBeInTheDocument();
  });
});
