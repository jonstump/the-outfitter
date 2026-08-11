import { beforeEach, describe, expect, it, vi } from "vitest";
import { Provider } from "react-redux";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ActionsPanel from "./ActionsPanel.jsx";
import { createTestStore, loadoutState } from "../../test/testStore.js";
import { uiActions } from "../../store/uiSlice.js";
import { restingDeclaration } from "../../test/cssRules.js";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Covers: SPEC-0001 REQ "Accessibility Requirements" (Dynamic Content Regions)
//
// The regression these guard against: the message node used to be rendered only when
// `ui.message` was non-empty, so the live region and its text entered the DOM in the same
// commit and screen readers routinely announced nothing. Both regions must therefore exist
// before any message arrives, and stay put across updates.

function renderPanel(preloadedUi) {
  const store = createTestStore({
    loadout: loadoutState(),
    ...(preloadedUi ? { ui: preloadedUi } : {}),
  });
  const utils = render(
    <Provider store={store}>
      <ActionsPanel />
    </Provider>
  );
  return { ...utils, store };
}

const politeRegion = (c) => c.querySelector('[aria-live="polite"]');
const assertiveRegion = (c) => c.querySelector('[aria-live="assertive"]');

describe("ActionsPanel status messaging", () => {
  it("mounts both live regions before any message exists", () => {
    const { container } = renderPanel();

    const polite = politeRegion(container);
    const assertive = assertiveRegion(container);

    expect(polite).toBeInTheDocument();
    expect(assertive).toBeInTheDocument();
    expect(polite).toHaveAttribute("role", "status");
    expect(assertive).toHaveAttribute("role", "alert");
    expect(polite).toHaveTextContent("");
    expect(assertive).toHaveTextContent("");
  });

  it("announces a success message politely, leaving the assertive region empty", () => {
    const { container, store } = renderPanel();
    const politeBefore = politeRegion(container);

    act(() => store.dispatch(uiActions.setMessage("Saved “Long Hunter”.")));

    // Same node, not a replacement — a swapped-in region would not be announced.
    expect(politeRegion(container)).toBe(politeBefore);
    expect(politeRegion(container)).toHaveTextContent("Saved “Long Hunter”.");
    expect(assertiveRegion(container)).toHaveTextContent("");
  });

  it("sends failures to the assertive region with the ! marker stripped", () => {
    const { container, store } = renderPanel();

    act(() => store.dispatch(uiActions.setMessage("!Couldn't save “Long Hunter”: network down")));

    const assertive = assertiveRegion(container);
    expect(assertive).toHaveTextContent("Couldn't save “Long Hunter”: network down");
    expect(assertive.textContent).not.toContain("!");
    expect(politeRegion(container)).toHaveTextContent("");
  });

  it("keeps both regions mounted after a message is cleared", () => {
    const { container, store } = renderPanel();
    act(() => store.dispatch(uiActions.setMessage("Share link copied to clipboard.")));
    act(() => store.dispatch(uiActions.setMessage("")));

    expect(politeRegion(container)).toBeInTheDocument();
    expect(assertiveRegion(container)).toBeInTheDocument();
    expect(politeRegion(container)).toHaveTextContent("");
  });

  it("marks the assertive region with the error class for the danger colour", () => {
    const { container } = renderPanel();
    expect(assertiveRegion(container)).toHaveClass("share-message", "error");
    expect(politeRegion(container)).toHaveClass("share-message");
    expect(politeRegion(container)).not.toHaveClass("error");
  });
});

// ---------------------------------------------------------------------------------------
// Issue #136 — the save control names where the save will land.
//
// Governing: SPEC-0003 REQ "The Selected List Is Client State" — "while a list is selected, a
// new save SHALL default to filing into that list. The user SHALL be able to save to
// Unassigned without first deselecting."
//
// This is the surface that replaced the "DEFAULT LIST FOR SAVED LOADOUTS" badge in the lists
// panel's expanded header. The badge was the ONLY thing telling a user that opening a list
// changes where the next save goes, so deleting it outright would have left the behaviour
// undiscoverable; putting the same fact on the control that performs the action answers the
// confusion at the moment it arises instead of from the top of a panel.
//
// The assertions below deliberately pair the LABEL with the WRITE. A label that merely reads
// the selected id would be right in every case a test bothers to set up and wrong in the one
// that matters — a selection pointing at a list that no longer exists, where the save quietly
// files into Unassigned. Both come from `resolveSaveListId`, and these tests are what says so.
// ---------------------------------------------------------------------------------------

const withList = (lists, ui) => ({
  loadout: loadoutState({ name: "long ammo" }),
  loadoutLists: { items: lists, status: "succeeded", error: null },
  savedLoadouts: { items: [], status: "succeeded", error: null },
  ...(ui ? { ui } : {}),
});

const alpha = { id: "a", name: "shotgun experiments", hunterId: null, accent: "#b04a3e", createdAt: "2026-01-01" };

const renderWith = (preloaded) => {
  const store = createTestStore(preloaded);
  render(
    <Provider store={store}>
      <ActionsPanel />
    </Provider>
  );
  return store;
};

const saveButton = () => screen.getByRole("button", { name: /^Save to / });

describe("the save control names its destination", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "1", name: "long ammo", data: {}, listId: null, updatedAt: "2026-01-01" }),
    }));
  });

  it("names the open list, and files into it", async () => {
    const store = renderWith(withList([alpha], { ...createTestStore().getState().ui, selectedListId: "a" }));

    // The name is in the button's TEXT, so the accessible name and the visible label are one
    // string (WCAG 2.5.3) rather than a bare "Save" with a title attribute beside it.
    expect(saveButton()).toHaveAccessibleName("Save to shotgun experiments");
    expect(saveButton()).toHaveTextContent("Save to shotgun experiments");

    await act(async () => fireEvent.click(saveButton()));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).listId).toBe("a");
    expect(store.getState().ui.message).toBe("Saved “long ammo”.");
  });

  it("says Unassigned when no list is open, and files there", async () => {
    // Unassigned is a real destination the user can choose by closing every list, not an
    // absence — so it is stated. A bare "Save" is what made the filing rule invisible.
    renderWith(withList([alpha]));

    expect(saveButton()).toHaveAccessibleName("Save to Unassigned");
    await act(async () => fireEvent.click(saveButton()));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).listId).toBeNull();
  });

  it("says Unassigned when the selection points at a list that has gone", async () => {
    // The case a label derived straight from `ui.selectedListId` gets wrong: a list retired in
    // another tab, or a selectedListId restored from localStorage before fetchLists resolved.
    // The save resolves it to null; the button must promise the same thing, or it names a
    // destination the write refuses to use.
    renderWith(withList([alpha], { ...createTestStore().getState().ui, selectedListId: "retired-yesterday" }));

    expect(saveButton()).toHaveAccessibleName("Save to Unassigned");
    await act(async () => fireEvent.click(saveButton()));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).listId).toBeNull();
  });

  it("follows the selection as it changes", async () => {
    const store = renderWith(withList([alpha, { ...alpha, id: "b", name: "Beta" }]));
    expect(saveButton()).toHaveAccessibleName("Save to Unassigned");

    act(() => store.dispatch(uiActions.selectList("b")));
    expect(saveButton()).toHaveAccessibleName("Save to Beta");

    act(() => store.dispatch(uiActions.selectList(null)));
    expect(saveButton()).toHaveAccessibleName("Save to Unassigned");
  });

  it("does not dress the destination as a second control", () => {
    // The badge's actual defect, which must not travel here with the copy: --gold-border and
    // --gold-bright are the theme's interactive colours, and a border plus uppercase plus
    // letter-spacing is `.chip`'s vocabulary. `.save-dest` is a run of italic text inside a
    // button, and carries none of it.
    renderWith(withList([alpha], { ...createTestStore().getState().ui, selectedListId: "a" }));
    const dest = saveButton().querySelector(".save-dest");
    expect(dest).toHaveTextContent("shotgun experiments");

    for (const property of ["border", "border-color", "text-transform", "letter-spacing", "color"]) {
      expect(restingDeclaration(".save-dest", property)).toBeNull();
    }
    expect(restingDeclaration(".save-dest", "font-style")).toBe("italic");
  });
});
