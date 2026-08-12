import { beforeEach, describe, expect, it, vi } from "vitest";
import { Provider } from "react-redux";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ActionsPanel from "./ActionsPanel.jsx";
import { createTestStore, loadoutState } from "../../test/testStore.js";
import { uiActions } from "../../store/uiSlice.js";
import {
  family,
  parseStylesheet,
  readGlobalCss,
  restingDeclaration,
  restingDeclarationIn,
  restingFamily,
} from "../../test/cssRules.js";

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
// The trait cap states its unit as "Trait cap", not as a "UP" suffix on the input — the last
// of the trait-point suffixes the header stat (#66) and the trait-cell hover already dropped.
// The dollar group is asserted alongside because it is the reason the removal is safe to make
// asymmetric: "$" stays, since "Budget" alone does not name a currency, while "Trait cap"
// already names what its number counts.
// ---------------------------------------------------------------------------------------

const bothCapsOn = { tab: "Weapons", budgetOn: true, budget: 800, upBudgetOn: true, upBudget: 10, message: "" };

describe("ActionsPanel trait cap", () => {
  it("renders no UP suffix anywhere in the panel", () => {
    const { container } = renderPanel(bothCapsOn);

    expect(container.textContent).not.toMatch(/\bUP\b/);
  });

  it("names the cap input for a screen reader, which the visible suffix used to do", () => {
    // A bare spinner beside a toggle is legible on screen and silent in speech, so the unit
    // that left the surface has to survive in the accessible name.
    renderPanel(bothCapsOn);

    expect(screen.getByLabelText("Trait point cap")).toHaveValue(10);
  });

  it("keeps the $ marker on the dollar budget", () => {
    const { container } = renderPanel(bothCapsOn);

    expect(container.textContent).toContain("$");
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
// The assertions below deliberately pair the LABEL with the WRITE — every one of them asserts
// what the button says AND where the request then files the loadout, in the same test, so a
// label that drifted away from the behaviour it advertises could not pass.
//
// What they do NOT prove is that the label goes through `resolveSaveListId`: reading
// `ui.selectedListId` raw is indistinguishable here, because looking a name up by id performs
// the same existence check. That was confirmed by making the edit and watching this file stay
// green. The property the shared rule actually protects is pinned in store/selectors.test.js,
// which explains why it needs a test of its own.
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
    // A list retired in another tab, or a selectedListId restored from localStorage before
    // fetchLists resolved. The save resolves it to null; the button must promise the same
    // thing rather than naming a destination the write refuses to use — and, since there is no
    // name to render for a list that is not there, must not render an empty destination either.
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

    // THROUGH `restingFamily`, which is the correction. `restingDeclaration(".save-dest",
    // "border")` is exact by property name, so it answered "null" for a rule declaring
    // `border-bottom` or `border-width`, and the badge this test is named for could come back
    // as a filled, underlined pill with every assertion here still green. `border`,
    // `background` and `padding` each cover their longhands now.
    for (const property of ["border", "background", "padding", "outline"]) {
      expect(restingFamily(".save-dest", property), `.save-dest declares a ${property}`).toEqual([]);
    }
    for (const property of ["text-transform", "letter-spacing", "color", "border-radius", "box-shadow"]) {
      expect(restingDeclaration(".save-dest", property)).toBeNull();
    }
    expect(restingDeclaration(".save-dest", "font-style")).toBe("italic");
  });

  it("the shorthand guard above sees a longhand, which is how the badge would come back", () => {
    // The mutation that used to survive: a border written as `border-bottom` and a fill
    // written as `background-color` are the pill in every visible respect, and neither was
    // named by the properties this test asserted.
    const pill = parseStylesheet(
      `${readGlobalCss()}\n.save-dest { border-bottom: 1px solid var(--gold-border); background-color: var(--input-bg); padding-left: 6px }`
    );
    expect(family("border").some((p) => restingDeclarationIn(pill, ".save-dest", p) !== null)).toBe(true);
    expect(family("background").some((p) => restingDeclarationIn(pill, ".save-dest", p) !== null)).toBe(true);
    expect(family("padding").some((p) => restingDeclarationIn(pill, ".save-dest", p) !== null)).toBe(true);
  });
});
