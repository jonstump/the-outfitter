import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import HunterPicker, {
  FAVORITES_ONLY_DEFAULT_THRESHOLD,
  favoritesOnlyDefault,
} from "./HunterPicker.jsx";

// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with Hunter
// Portraits), SPEC-0003 REQ "Favorites-Only Becomes the Default Past a Threshold"
//
// A SEPARATE file from HunterPicker.test.jsx purely because of the fixture: the threshold is
// ten, so the scenarios need a roster bigger than the five-hunter fixture the rest of the
// suite is written against, and `vi.mock` is per-file. Twelve hunters is the smallest roster
// that can hold eleven favorites and still have someone left over to prove the roster is not
// gated.
//
// The specifier must resolve to the SAME file `client/src/data/hunters.js` imports — the
// repo-root `data/hunters.json`. If the two ever disagree the mock silently stops applying
// and this suite quietly runs against the real 242-hunter roster instead.
const ROSTER = Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return { id: `h${n}`, name: `Hunter ${n}`, portrait: `h${n}`, acquisition: "dlc", obtainable: true };
});
vi.mock("../../../../data/hunters.json", () => ({
  default: Array.from({ length: 12 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return { id: `h${n}`, name: `Hunter ${n}`, portrait: `h${n}`, acquisition: "dlc", obtainable: true };
  }),
}));

const idsOf = (count) => ROSTER.slice(0, count).map((h) => h.id);

function Harness({ initialFavorites = [] }) {
  const [open, setOpen] = useState(false);
  const [favorites, setFavorites] = useState(initialFavorites);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Choose portrait
      </button>
      {open && (
        <HunterPicker
          favorites={favorites}
          onToggleFavorite={(payload) =>
            setFavorites((prev) =>
              payload.favorite ? [...prev, payload.hunterId] : prev.filter((id) => id !== payload.hunterId)
            )
          }
          onClose={() => setOpen(false)}
          onSelect={() => setOpen(false)}
        />
      )}
    </>
  );
}

const openPicker = () => fireEvent.click(screen.getByRole("button", { name: "Choose portrait" }));
const closePicker = () => fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
const toggle = () => screen.getByRole("checkbox", { name: /favorites only/i });
const grid = () => screen.getByRole("grid");
// Hunter tiles only — the trailing "no portrait" row is not a hunter.
const shownHunters = () =>
  within(grid())
    .getAllByRole("row")
    .map((r) => r.querySelector(".hp-tile-name").textContent.trim())
    .filter((name) => name !== "No portrait");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HunterPicker favorites-only threshold", () => {
  it("states the threshold once, as a named constant", () => {
    // "The threshold SHALL be a single named constant, so changing it is one edit rather
    // than a search." Strictly greater than: ten itself is below the line.
    expect(FAVORITES_ONLY_DEFAULT_THRESHOLD).toBe(10);
    expect(favoritesOnlyDefault(FAVORITES_ONLY_DEFAULT_THRESHOLD)).toBe(false);
    expect(favoritesOnlyDefault(FAVORITES_ONLY_DEFAULT_THRESHOLD + 1)).toBe(true);
    expect(favoritesOnlyDefault(0)).toBe(false);
  });

  it("opens with favorites only enabled past the threshold, showing just the favorites", () => {
    render(<Harness initialFavorites={idsOf(11)} />);
    openPicker();
    expect(toggle()).toBeChecked();
    expect(shownHunters()).toEqual(idsOf(11).map((_, i) => `Hunter ${String(i + 1).padStart(2, "0")}`));
    expect(shownHunters()).toHaveLength(11);
    expect(screen.getByText("11 of 12 hunters")).toBeInTheDocument();
  });

  it("opens with the toggle off at exactly the threshold", () => {
    render(<Harness initialFavorites={idsOf(10)} />);
    openPicker();
    expect(toggle()).not.toBeChecked();
    expect(shownHunters()).toHaveLength(12);
  });

  it("is a default, not a gate: the full roster is one operable control away", () => {
    render(<Harness initialFavorites={idsOf(11)} />);
    openPicker();
    expect(toggle()).toBeEnabled();

    fireEvent.click(toggle());
    // Immediately, with no reopen and no hunter unreachable at any point.
    expect(toggle()).not.toBeChecked();
    expect(shownHunters()).toHaveLength(12);
    expect(shownHunters()).toContain("Hunter 12");
  });

  it("holds the override for the session, and re-applies the default on reopen", () => {
    // The toggle is client state under the same rule as the selected list and the sort
    // order: durable favorites, ephemeral view. Nothing is written anywhere.
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchSpy);

    render(<Harness initialFavorites={idsOf(11)} />);
    openPicker();
    fireEvent.click(toggle());
    expect(toggle()).not.toBeChecked();

    // Still off later in the SAME session — filtering does not resurrect the default.
    fireEvent.change(screen.getByLabelText("Filter hunters by name"), { target: { value: "Hunter 1" } });
    expect(toggle()).not.toBeChecked();

    closePicker();
    openPicker();
    expect(toggle()).toBeChecked();
    expect(shownHunters()).toHaveLength(11);

    // Nothing about the toggle was ever sent: there is no field on the server recording it.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("restores the default-off behaviour on the next open once favorites drop back", () => {
    render(<Harness initialFavorites={idsOf(11)} />);
    openPicker();
    expect(toggle()).toBeChecked();

    // Unfavorite one, taking the count to exactly the threshold. The toggle does NOT flip
    // mid-session — the spec restores the default on the next open, not under the user.
    fireEvent.click(screen.getByTestId("hunter-fav-h11"));
    expect(toggle()).toBeChecked();
    expect(shownHunters()).toHaveLength(10);

    closePicker();
    openPicker();
    expect(toggle()).not.toBeChecked();
    expect(shownHunters()).toHaveLength(12);
  });

  it("yields to the empty-set rule: zero favorites opens off and disabled", () => {
    // "The empty-set rule stated in 'Favorite Hunters' takes precedence over this one."
    render(<Harness initialFavorites={[]} />);
    openPicker();
    expect(toggle()).not.toBeChecked();
    expect(toggle()).toBeDisabled();
    expect(shownHunters()).toHaveLength(12);
  });

  it("resets to off and disabled in place when the last favorite goes away", () => {
    // Unfavoriting down from past the threshold to zero, without reopening the picker: the
    // toggle disarms itself and the full roster comes back.
    render(<Harness initialFavorites={idsOf(11)} />);
    openPicker();
    expect(toggle()).toBeChecked();

    for (const id of idsOf(11)) fireEvent.click(screen.getByTestId(`hunter-fav-${id}`));

    expect(toggle()).not.toBeChecked();
    expect(toggle()).toBeDisabled();
    expect(shownHunters()).toHaveLength(12);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
