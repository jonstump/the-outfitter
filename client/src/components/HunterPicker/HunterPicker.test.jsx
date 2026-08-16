import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import HunterPicker from "./HunterPicker.jsx";

// Governing: ADR-0006, ADR-0007, SPEC-0003 REQ "The Hunter Picker Is Filterable and
// Bounded", SPEC-0003 REQ "The Hunter Picker Does Not Restrict or Mark Reuse", SPEC-0003
// REQ "Favorite Hunters", SPEC-0003 REQ "Focus Management", SPEC-0003 REQ "Keyboard
// Navigation"
//
// A five-entry fixture roster stands in for the 242. Two entries share a name prefix so
// the free-text filter has something to actually narrow, and one has a null `acquisition`
// and a null `obtainable` — the two live entries that shape do exist for, and the reason
// the filters need an explicit Unknown bucket rather than dropping them.
// The specifier must resolve to the SAME file `client/src/data/hunters.js` imports — the
// repo-root `data/hunters.json`, not a client-workspace path. If the two ever disagree the
// mock silently stops applying and this suite quietly runs against the real 242-hunter
// roster instead of the five below.
// "bad-hand"'s `obtainable: false` is deliberately synthetic (issue #388, #127).
// `deriveObtainable` (scripts/scrape-hunters.mjs) can currently only emit `true` or `null` —
// no hunter in the generated dataset carries `false` (see the domain assertion in
// hunters.test.js) — but OBTAINABLE_OPTIONS below still renders a "Not obtainable" filter
// option, and the "filters by availability" test exercises its "no" branch defensively so
// it keeps working for the day #127 resolves whether the dataset should ever emit it.
vi.mock("../../../../data/hunters.json", () => ({
  default: [
    { id: "the-rat", name: "The Rat", portrait: "the-rat", acquisition: "dlc", obtainable: true },
    { id: "the-raven", name: "The Raven", portrait: "the-raven", acquisition: "dlc", obtainable: true },
    { id: "bad-hand", name: "Bad Hand", portrait: "bad-hand", acquisition: "event", obtainable: false },
    { id: "the-ol-cowpoke", name: "The Ol' Cowpoke", portrait: "the-ol-cowpoke", acquisition: null, obtainable: null },
    { id: "kingsnake", name: "Kingsnake", portrait: "kingsnake", acquisition: "blood-bonds", obtainable: true },
  ],
}));

/**
 * Trigger + picker, so focus-return has somewhere real to return to.
 *
 * `favorites` is stateful here rather than a fixed prop: favoriting is only meaningful if
 * the answer comes back, and a static array would let a test pass against a component that
 * never re-renders on a toggle. The harness stands in for the redux slice.
 */
function Harness({ onSelect = () => {}, selectedHunterId = null, initialFavorites = [], onToggle }) {
  const [open, setOpen] = useState(false);
  const [favorites, setFavorites] = useState(initialFavorites);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Choose portrait
      </button>
      {open && (
        <HunterPicker
          selectedHunterId={selectedHunterId}
          favorites={favorites}
          onToggleFavorite={(payload) => {
            onToggle?.(payload);
            setFavorites((prev) =>
              payload.favorite
                ? [...prev, payload.hunterId]
                : prev.filter((id) => id !== payload.hunterId)
            );
          }}
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

// A tile is a grid ROW holding two cells — choose, and favorite. `tiles()` returns the
// CHOOSE cells, which are the tiles as far as selection is concerned.
//
// Scoped to the grid on purpose: the acquisition and availability filters are native
// <select>s, and an unscoped role query sweeps their <option>s in too.
//
// `rows()` deliberately spans SECTIONS: the picker is one role="grid" holding several
// role="rowgroup" sections, so a flat row query still returns every tile in render order —
// which is the same property the roving tabindex depends on.
const grid = () => screen.getByRole("grid");
const rows = () => within(grid()).getAllByRole("row");
const tiles = () => rows().map((row) => within(row).getAllByRole("gridcell")[0]);
// The name plate specifically: a tile's textContent would also pick up the "?" monogram on
// the no-portrait tile, which is decoration rather than a name.
const nameOf = (el) => el.querySelector(".hp-tile-name").textContent.trim();
const tileNames = () => tiles().map(nameOf);
const favButton = (hunterId) => screen.getByTestId(`hunter-fav-${hunterId}`);
// Put the user on a tile. Wrapped in act() because focusing a cell updates the picker's
// row/column bookkeeping: unwrapped, that update is still pending when the next key press
// dispatches, and the key runs against the PREVIOUS position. Only matters when landing
// somewhere other than the grid's first row, which is why the older tests get away without it.
const focusTile = (hunterId) => {
  const el = screen.getByTestId(`hunter-tile-${hunterId}`);
  act(() => el.focus());
  return el;
};

// Sections. The last rowgroup always holds the "no portrait" escape hatch, so
// `hunterSections()` drops it: it is not a hunter group and carries no count.
const sectionEls = () => within(grid()).getAllByRole("rowgroup");
const hunterSections = () => sectionEls().slice(0, -1);
const sectionNames = () => hunterSections().map((s) => s.getAttribute("aria-label"));
const namesIn = (sectionEl) => within(sectionEl).getAllByRole("row").map(nameOf);
const namesInSection = (id) => namesIn(screen.getByTestId(`hp-section-${id}`));
const hasSection = (id) => screen.queryByTestId(`hp-section-${id}`) !== null;

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

  // Governing: SPEC-0004, SPEC-0003, issue #387
  //
  // The picker now consumes `HUNTERS_BY_NAME`, not the fixture's own insertion order —
  // which is why this fixture deliberately lists its entries out of alphabetical order
  // (the-rat, the-raven, bad-hand, the-ol-cowpoke, kingsnake): a picker that silently fell
  // back to dataset order would still pass a test built on an already-alphabetical fixture.
  it("orders the roster alphabetically by name, not the dataset's own order", () => {
    render(<Harness />);
    openPicker();
    expect(tileNames()).toEqual([
      "Bad Hand",
      "Kingsnake",
      "The Ol' Cowpoke",
      "The Rat",
      "The Raven",
      "No portrait",
    ]);
  });

  it("keeps alphabetical order when filtering — narrowing is the only effect", () => {
    render(<Harness />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Filter hunters by name"), { target: { value: "the" } });
    expect(tileNames().slice(0, 3)).toEqual(["The Ol' Cowpoke", "The Rat", "The Raven"]);
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
    const hunterRows = rows().slice(0, -1); // the last row is the "no portrait" choice
    const classes = new Set(hunterRows.map((row) => row.className));
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

// Governing: SPEC-0003 REQ "Favorite Hunters" — favorites SECTION AND FILTER, never gate.
describe("HunterPicker favorites", () => {
  it("favorites nothing on its own, and offers the toggle inert until there is one", () => {
    // "The system MUST NOT pre-populate favorites." Nothing here seeds one, and with an
    // empty set the toggle cannot be switched into an empty picker.
    render(<Harness />);
    openPicker();
    for (const id of ["the-rat", "the-raven", "bad-hand", "the-ol-cowpoke", "kingsnake"]) {
      expect(favButton(id)).toHaveAttribute("aria-pressed", "false");
    }
    const toggle = screen.getByRole("checkbox", { name: /favorites only/i });
    expect(toggle).toBeDisabled();
    expect(tileNames()).toHaveLength(6); // five hunters + "No portrait"
  });

  it("names the favorite control by both the action and the hunter", () => {
    render(<Harness initialFavorites={["the-rat"]} />);
    openPicker();
    // SPEC-0003 "Icon-Only Controls": never a bare star repeated once per hunter.
    expect(screen.getByRole("button", { name: "Unfavorite The Rat" })).toBe(favButton("the-rat"));
    expect(screen.getByRole("button", { name: "Favorite Bad Hand" })).toBe(favButton("bad-hand"));
  });

  it("toggles a favorite from the keyboard and reports the new state", () => {
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);
    openPicker();

    // A real <button>, so Enter and Space activate it natively — fireEvent.click is what
    // jsdom gives us for that activation, and it is reached by the grid's arrow keys
    // (asserted in the keyboard suite) rather than by 242 Tab stops.
    fireEvent.click(favButton("bad-hand"));
    expect(onToggle).toHaveBeenCalledWith({
      hunterId: "bad-hand",
      hunterName: "Bad Hand",
      favorite: true,
    });
    expect(favButton("bad-hand")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Unfavorite Bad Hand" })).toBeInTheDocument();

    fireEvent.click(favButton("bad-hand"));
    expect(onToggle).toHaveBeenLastCalledWith({
      hunterId: "bad-hand",
      hunterName: "Bad Hand",
      favorite: false,
    });
    expect(favButton("bad-hand")).toHaveAttribute("aria-pressed", "false");
  });

  it("favoriting neither chooses the hunter nor closes the picker", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    openPicker();
    fireEvent.click(favButton("kingsnake"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // REVERSAL, #138. These used to assert that favorites SORTED to the front of one
  // undivided grid. They now assert the sectioning that replaced that sort — the flat order
  // is unchanged, which is exactly why the ordering assertions alone could never have caught
  // the boundary being invisible.
  it("lifts favorites into their own section ahead of the rest, without dropping anyone", () => {
    render(<Harness initialFavorites={["kingsnake", "bad-hand"]} />);
    openPicker();
    expect(namesInSection("favorites")).toEqual(["Bad Hand", "Kingsnake"]);
    // Alphabetical (issue #387), not the fixture's own insertion order.
    expect(namesInSection("roster")).toEqual(["The Ol' Cowpoke", "The Rat", "The Raven"]);
    // …and the sections render in that order, favorites first, with everyone still present.
    expect(tileNames()).toEqual([
      "Bad Hand",
      "Kingsnake",
      "The Ol' Cowpoke",
      "The Rat",
      "The Raven",
      "No portrait",
    ]);
  });

  it("labels each section with its own count, for the eye and for assistive technology", () => {
    render(<Harness initialFavorites={["kingsnake", "bad-hand"]} />);
    openPicker();
    // "6 favorites, 65 others" legible without counting tiles — here, 2 and 3.
    expect(sectionNames()).toEqual(["Favorites, 2 hunters", "Other hunters, 3 hunters"]);
    // The visible caption says the same thing, and is hidden from AT so it is not announced
    // twice. `getAllByText` is scoped by the aria-hidden caption's own class.
    const captions = Array.from(document.querySelectorAll(".hp-section-label"));
    expect(captions.map((c) => c.textContent.replace(/\s+/g, " ").trim())).toEqual([
      "Favorites 2",
      "Other hunters 3",
    ]);
    for (const caption of captions) expect(caption).toHaveAttribute("aria-hidden", "true");
  });

  it("names the lone section 'All hunters' when nothing is favorited", () => {
    // With no favorites there is no split, so "Other hunters" would be describing a
    // distinction that is not on screen.
    render(<Harness />);
    openPicker();
    expect(sectionNames()).toEqual(["All hunters, 5 hunters"]);
  });

  it("singularises a one-member section's count", () => {
    render(<Harness initialFavorites={["kingsnake"]} />);
    openPicker();
    expect(sectionNames()[0]).toBe("Favorites, 1 hunter");
  });

  it("renders each favorited hunter exactly once, in Favorites only", () => {
    render(<Harness initialFavorites={["kingsnake", "bad-hand"]} />);
    openPicker();
    // Duplication would break the section counts, give one hunter two focus positions, and
    // make favoriting from the lower copy move a tile the user is not looking at.
    expect(screen.getAllByTestId("hunter-tile-kingsnake")).toHaveLength(1);
    expect(namesInSection("roster")).not.toContain("Kingsnake");
    expect(namesInSection("roster")).not.toContain("Bad Hand");
    const names = tileNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("sections WITHIN the active filter, showing no non-matching hunter in either", () => {
    render(<Harness initialFavorites={["kingsnake", "the-raven"]} />);
    openPicker();
    fireEvent.change(screen.getByLabelText("Filter by acquisition"), { target: { value: "dlc" } });

    // Kingsnake is favorited but is blood-bonds: a favorite must not survive a filter it
    // fails, in either section.
    expect(namesInSection("favorites")).toEqual(["The Raven"]);
    expect(namesInSection("roster")).toEqual(["The Rat"]);
    expect(tileNames()).not.toContain("Kingsnake");
  });

  it("omits a section with no members rather than rendering an empty heading", () => {
    render(<Harness initialFavorites={["the-raven", "the-rat"]} />);
    openPicker();
    // "rav" matches only The Raven, which is favorited — so nothing is left for the roster
    // section and it disappears entirely.
    fireEvent.change(screen.getByLabelText("Filter hunters by name"), { target: { value: "rav" } });
    expect(sectionNames()).toEqual(["Favorites, 1 hunter"]);
    expect(hasSection("roster")).toBe(false);

    // The mirror case: a filter no favorite survives leaves only the roster section, and it
    // is named as though there were no split, because there is none.
    fireEvent.change(screen.getByLabelText("Filter hunters by name"), { target: { value: "snake" } });
    expect(hasSection("favorites")).toBe(false);
    expect(sectionNames()).toEqual(["All hunters, 1 hunter"]);
  });

  it("shows the roster in full while the toggle is off", () => {
    render(<Harness initialFavorites={["kingsnake"]} />);
    openPicker();
    expect(screen.getByRole("checkbox", { name: /favorites only/i })).not.toBeChecked();
    expect(tileNames()).toHaveLength(6);
    expect(screen.getByText("5 of 5 hunters")).toBeInTheDocument();
  });

  it("narrows to favorites only when the toggle is on, and restores the roster when off", () => {
    render(<Harness initialFavorites={["kingsnake", "bad-hand"]} />);
    openPicker();
    const toggle = screen.getByRole("checkbox", { name: /favorites only/i });

    fireEvent.click(toggle);
    expect(tileNames()).toEqual(["Bad Hand", "Kingsnake", "No portrait"]);

    fireEvent.click(toggle);
    expect(tileNames()).toHaveLength(6);
  });

  it("combines the favorites-only toggle with the other filters", () => {
    render(<Harness initialFavorites={["kingsnake", "the-raven"]} />);
    openPicker();
    fireEvent.click(screen.getByRole("checkbox", { name: /favorites only/i }));
    fireEvent.change(screen.getByLabelText("Filter by acquisition"), { target: { value: "dlc" } });
    expect(tileNames()).toEqual(["The Raven", "No portrait"]);
  });

  it("cannot strand the user in an empty picker by unfavoriting the last favorite", () => {
    // The toggle is on and the set empties beneath it. An empty favorites set behaves as no
    // filter, so the roster comes back rather than the picker going blank.
    render(<Harness initialFavorites={["kingsnake"]} />);
    openPicker();
    fireEvent.click(screen.getByRole("checkbox", { name: /favorites only/i }));
    expect(tileNames()).toEqual(["Kingsnake", "No portrait"]);

    fireEvent.click(favButton("kingsnake"));
    expect(tileNames()).toHaveLength(6);
    expect(screen.getByRole("checkbox", { name: /favorites only/i })).toBeDisabled();
  });

  it("does not let the emptied toggle re-engage itself when a new favorite arrives", () => {
    // Regression, PR #133 review. `favoritesOnly` used to survive the set emptying: the
    // checkbox renders `favoritesOnly && !noFavorites`, so it went disabled+unchecked and
    // the roster came back — every visible sign of the filter being off — while the state
    // stayed `true` and out of the user's reach. Favoriting anything else then reactivated
    // it and collapsed the picker to that one hunter, with the box showing checked, without
    // the user re-checking anything.
    render(<Harness initialFavorites={["kingsnake"]} />);
    openPicker();
    const toggle = () => screen.getByRole("checkbox", { name: /favorites only/i });

    fireEvent.click(toggle());
    expect(tileNames()).toEqual(["Kingsnake", "No portrait"]);

    // The last favorite goes away. The control must be genuinely off, not merely masked.
    fireEvent.click(favButton("kingsnake"));
    expect(toggle()).toBeDisabled();
    expect(toggle()).not.toBeChecked();

    // A different hunter is favorited. Nothing touched the checkbox, so nothing may filter.
    fireEvent.click(favButton("bad-hand"));
    expect(toggle()).toBeEnabled();
    expect(toggle()).not.toBeChecked();
    expect(tileNames()).toHaveLength(6);
    expect(tileNames()).toContain("The Rat");

    // …and re-checking it deliberately still works, so the reset disarmed the control
    // rather than breaking it.
    fireEvent.click(toggle());
    expect(toggle()).toBeChecked();
    expect(tileNames()).toEqual(["Bad Hand", "No portrait"]);
  });

  it("indicates a favorite and nothing else — never that a hunter is in use", () => {
    // The picker is not told which hunters other lists reference, so a favorited hunter
    // that is also in use can only carry the favorite marking. Nothing on a tile varies by
    // anything except selection and the user's own favorite.
    render(<Harness initialFavorites={["the-rat"]} />);
    openPicker();
    const byName = Object.fromEntries(
      rows()
        .slice(0, -1)
        .map((r) => [r.querySelector(".hp-tile-name").textContent.trim(), r])
    );
    expect(byName["The Rat"].className.split(" ").sort()).toEqual(["hp-tile", "hp-tile-fav"]);
    expect(byName["The Raven"].className).toBe("hp-tile");
    expect(favButton("the-rat")).toHaveAttribute("aria-pressed", "true");
    expect(favButton("the-raven")).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps favoriting separate from choosing", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} initialFavorites={["bad-hand"]} selectedHunterId="the-rat" />);
    openPicker();
    // Favorited and selected are independent axes, and neither implies the other.
    expect(screen.getByTestId("hunter-tile-bad-hand")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("hunter-tile-the-rat")).toHaveAttribute("aria-selected", "true");
    expect(favButton("the-rat")).toHaveAttribute("aria-pressed", "false");
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

  // Governing: ADR-0007 (as amended 2026-08-10), SPEC-0004 REQ "Consumption Contract
  // Compatibility". This used to assert the tile asked for `the-rat-thumb.avif`. #147
  // deleted all 242 `-thumb` files, so that assertion was pinning a 404 in place.
  it("asks tiles for the hunter's one portrait, with no size segment in the path", () => {
    render(<Harness />);
    openPicker();
    expect(screen.getByTestId("hunter-tile-the-rat").querySelector("img")).toHaveAttribute(
      "src",
      "/images/hunters/the-rat.avif"
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
    const options = tiles();

    // Roving tabindex: exactly one cell in the whole grid is tabbable, so Tab reaches the
    // grid in one stop rather than walking 242 tiles and their 242 favorite buttons.
    const tabbable = within(grid())
      .getAllByRole("gridcell")
      .flatMap((cell) => [cell, ...cell.querySelectorAll("button")])
      .filter((el) => el.tabIndex === 0);
    expect(tabbable).toHaveLength(1);

    options[0].focus();
    // Right walks the row's own cells first — this tile's favorite button — then on to the
    // next tile, so Right always means "the next thing to the right". With no favorites the
    // roster is one alphabetical section (issue #387), so options[0] is Bad Hand.
    fireEvent.keyDown(grid(), { key: "ArrowRight" });
    expect(document.activeElement).toBe(favButton("bad-hand"));

    fireEvent.keyDown(grid(), { key: "ArrowRight" });
    expect(document.activeElement).toBe(options[1]);

    fireEvent.keyDown(grid(), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(favButton("bad-hand"));

    fireEvent.keyDown(grid(), { key: "End" });
    // The "no portrait" row has nothing to favorite, so its last cell is the tile itself.
    expect(document.activeElement).toBe(options[options.length - 1]);

    fireEvent.keyDown(grid(), { key: "Home" });
    expect(document.activeElement).toBe(options[0]);
  });

  // Up/Down read the column count back from layout, which jsdom does not perform: every
  // element reports a zero-sized box. That is exactly the "no layout yet" case the picker
  // promises to degrade — and it is also reachable in a browser, while the dialog is still
  // transitioning in. Asserting it here pins the documented behaviour rather than leaving
  // the axis untested because the environment makes it awkward.
  it("degrades Down/Up to Next/Previous when layout has not happened", () => {
    render(<Harness />);
    openPicker();
    const options = tiles();

    options[0].focus();
    fireEvent.keyDown(grid(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);

    fireEvent.keyDown(grid(), { key: "ArrowUp" });
    expect(document.activeElement).toBe(options[0]);
  });

  it("moves Down/Up by a whole row once the grid has been laid out", () => {
    render(<Harness />);
    openPicker();
    const options = tiles();

    // Stand in for the layout jsdom will not do: two columns, so tiles 0/1 share a row,
    // 2/3 the next, and so on. A non-zero box is what tells columnCount() layout happened.
    const COLS = 2;
    rows().forEach((el, i) => {
      Object.defineProperty(el, "offsetWidth", { configurable: true, value: 120 });
      Object.defineProperty(el, "offsetHeight", { configurable: true, value: 80 });
      Object.defineProperty(el, "offsetTop", { configurable: true, value: Math.floor(i / COLS) * 80 });
    });

    options[0].focus();
    fireEvent.keyDown(grid(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[COLS]);

    fireEvent.keyDown(grid(), { key: "ArrowUp" });
    expect(document.activeElement).toBe(options[0]);

    // A single row is NOT the no-layout case: with every tile on one row the column count
    // is the tile count, so Down clamps to the last tile rather than stepping sideways.
    rows().forEach((el) => {
      Object.defineProperty(el, "offsetTop", { configurable: true, value: 0 });
    });
    options[0].focus();
    fireEvent.keyDown(grid(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[options.length - 1]);
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

  // Governing: SPEC-0003 Accessibility "The Favorites Section Is Exposed, Not Merely Drawn"
  it("keeps the sectioned grid a single tab stop and lets arrows cross the boundary", () => {
    render(<Harness initialFavorites={["bad-hand"]} />);
    openPicker();
    // Two hunter sections plus the "no portrait" rowgroup, all inside ONE grid. Two grids
    // would have bought the visual split at the cost of both properties below.
    expect(screen.getAllByRole("grid")).toHaveLength(1);
    expect(sectionEls()).toHaveLength(3);

    const tabbable = within(grid())
      .getAllByRole("gridcell")
      .flatMap((cell) => [cell, ...cell.querySelectorAll("button")])
      .filter((el) => el.tabIndex === 0);
    expect(tabbable).toHaveLength(1);

    // Bad Hand is the lone favorite, so it is the last row of the Favorites section. Right
    // walks its own cells, then steps into the NEXT section without the keys knowing that
    // sections exist. The roster is alphabetical (issue #387), so its first tile is
    // Kingsnake, not the fixture's own first non-favorite entry.
    screen.getByTestId("hunter-tile-bad-hand").focus();
    fireEvent.keyDown(grid(), { key: "ArrowRight" });
    expect(document.activeElement).toBe(favButton("bad-hand"));

    fireEvent.keyDown(grid(), { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByTestId("hunter-tile-kingsnake"));

    // …and back over the boundary in the other direction.
    fireEvent.keyDown(grid(), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(favButton("bad-hand"));

    // End still reaches the "no portrait" tile past both sections, with its single cell.
    fireEvent.keyDown(grid(), { key: "End" });
    expect(document.activeElement).toBe(screen.getByTestId("hunter-tile-none"));
  });

  // Governing: SPEC-0003 Accessibility "The Favorites Section Is Exposed, Not Merely Drawn"
  //
  // Regression, PR #151 review. The Down/Up test above renders NO favorites, so it exercises
  // a grid with a single hunter section — precisely the shape sectioning did not change. Once
  // `.hp-section` became the CSS grid, a column count measured from the first row measured
  // the FAVORITES section, and a one-favorite section made Down step one tile instead of one
  // row through the whole roster below it. Each section is laid out on its own here.
  it("moves Down/Up by a whole row inside a section, and crosses the boundary in column", () => {
    render(<Harness initialFavorites={["bad-hand"]} />);
    openPicker();

    // Favorites holds Bad Hand alone; the roster holds the other four, alphabetical
    // (issue #387) as Kingsnake, The Ol' Cowpoke, The Rat, The Raven, two per row; the
    // "no portrait" rowgroup trails both. offsetTop is a document coordinate, so it keeps
    // climbing ACROSS sections — which is exactly why a first-row measurement saw only the
    // one-tile Favorites section and reported one column for the whole widget.
    const y = { "bad-hand": 0, kingsnake: 100, "the-ol-cowpoke": 100, "the-rat": 180, "the-raven": 180 };
    rows().forEach((el) => {
      Object.defineProperty(el, "offsetWidth", { configurable: true, value: 120 });
      Object.defineProperty(el, "offsetHeight", { configurable: true, value: 80 });
      Object.defineProperty(el, "offsetTop", { configurable: true, value: y[el.dataset.hunterId] ?? 260 });
    });

    // Down inside the roster is a whole row of the ROSTER's two columns — not one tile,
    // which is what the one-member Favorites section's width would have given.
    focusTile("kingsnake");
    fireEvent.keyDown(grid(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("hunter-tile-the-rat"));

    fireEvent.keyDown(grid(), { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByTestId("hunter-tile-kingsnake"));

    // The second column moves straight down its own column, too.
    focusTile("the-ol-cowpoke");
    fireEvent.keyDown(grid(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("hunter-tile-the-raven"));

    // Down out of a section shorter than a row crosses into the next one, keeping the
    // column; Up out of the roster's first row comes back to it.
    focusTile("bad-hand");
    fireEvent.keyDown(grid(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("hunter-tile-kingsnake"));

    fireEvent.keyDown(grid(), { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByTestId("hunter-tile-bad-hand"));

    // Down off the roster's last row lands on the "no portrait" rowgroup rather than
    // stopping at the boundary; Up out of it returns to that row, not to the roster's first.
    focusTile("the-rat");
    fireEvent.keyDown(grid(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("hunter-tile-none"));

    fireEvent.keyDown(grid(), { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByTestId("hunter-tile-the-rat"));
  });

  // Governing: SPEC-0003 REQ "Focus Management"
  //
  // Regression, PR #151 review. The sections are separate DOM parents, so React unmounts the
  // tile from one and mounts a new one in the other — taking the button the user pressed
  // with it. Focus landed on <body>, OUTSIDE the dialog, where the trap cannot recover it:
  // pressing a control inside the dialog ejected a keyboard user from the dialog.
  it("keeps focus on the star when favoriting moves the tile to the other section", () => {
    render(<Harness initialFavorites={["bad-hand"]} />);
    openPicker();

    const star = favButton("kingsnake");
    act(() => star.focus());
    fireEvent.click(star);

    // The tile really did move — so the button below is a different node from `star`.
    expect(namesInSection("favorites")).toEqual(["Bad Hand", "Kingsnake"]);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(favButton("kingsnake"));
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    // …and the roving tabindex followed it, so Tab out and back returns to the same place.
    expect(favButton("kingsnake").tabIndex).toBe(0);

    // The same in the other direction, back down into the roster.
    fireEvent.click(favButton("kingsnake"));
    expect(namesInSection("favorites")).toEqual(["Bad Hand"]);
    expect(document.activeElement).toBe(favButton("kingsnake"));
    expect(favButton("kingsnake").tabIndex).toBe(0);
  });

  it("keeps focus inside the dialog when unfavoriting removes the tile altogether", () => {
    // "Favorites only" is on, so unfavoriting does not move the tile — it deletes it. There
    // is no same-tile answer, and <body> is the one answer that breaks the trap.
    render(<Harness initialFavorites={["kingsnake", "bad-hand"]} />);
    openPicker();
    fireEvent.click(screen.getByRole("checkbox", { name: /favorites only/i }));

    const star = favButton("kingsnake");
    act(() => star.focus());
    fireEvent.click(star);

    expect(screen.queryByTestId("hunter-fav-kingsnake")).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByTestId("hunter-tile-bad-hand"));
  });

  it("keeps the roving tabindex in range when a filter shortens the list", () => {
    render(<Harness />);
    openPicker();
    fireEvent.keyDown(grid(), { key: "End" });
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
