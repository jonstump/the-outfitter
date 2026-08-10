import { describe, expect, it, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import LoadoutListsPanel from "./LoadoutListsPanel.jsx";
import { createTestStore } from "../../test/testStore.js";
import { LS_SELECTED_LIST } from "../../store/uiSlice.js";
import { emptyLoadout, toData } from "../../utils/loadoutCodec.js";

// Governing: ADR-0006, SPEC-0003 REQ "List Ordering and Sorting", REQ "The Selected List
// Is Client State", REQ "New Lists Default Their Name from the Chosen Portrait"

const data = toData(emptyLoadout());
const list = (id, name, extra = {}) => ({ id, name, hunterId: null, accent: "#b04a3e", createdAt: "2026-01-01", ...extra });
const loadout = (id, name, listId = null) => ({ id, name, data, listId, updatedAt: "2026-01-01" });

function renderPanel(preloaded) {
  const store = createTestStore(preloaded);
  render(
    <Provider store={store}>
      <LoadoutListsPanel />
    </Provider>
  );
  return store;
}

const base = (lists, loadouts, ui = {}) => ({
  loadoutLists: { items: lists, status: "succeeded", error: null },
  savedLoadouts: { items: loadouts, status: "succeeded", error: null },
  ui: {
    tab: "Weapons", budgetOn: false, budget: 800, upBudgetOn: false, upBudget: 12, message: "",
    selectedListId: null, listSort: "name", creatingList: false, renamingListId: null,
    confirmRetireListId: null, ...ui,
  },
});

beforeEach(() => {
  localStorage.clear();
});

describe("LoadoutListsPanel", () => {
  it("renders nothing when there are no lists and no loadouts", () => {
    const { container } = render(
      <Provider store={createTestStore(base([], []))}>
        <LoadoutListsPanel />
      </Provider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("pins Unassigned first regardless of sort", async () => {
    renderPanel(base([list("a", "Aardvark"), list("z", "Zebra")], []));
    const cards = screen.getAllByRole("button", { pressed: false }).filter((b) => b.dataset.testid?.startsWith("list-card-"));
    expect(cards[0].dataset.testid).toBe("list-card-__unassigned__");
  });

  it("counts loadouts per list, and puts dangling references in Unassigned", () => {
    renderPanel(
      base(
        [list("a", "Alpha")],
        [loadout("1", "one", "a"), loadout("2", "two", "deleted-list"), loadout("3", "three", null)]
      )
    );
    expect(within(screen.getByTestId("list-card-a")).getByText("1 loadout")).toBeInTheDocument();
    // The dangling one degrades into Unassigned rather than vanishing.
    expect(within(screen.getByTestId("list-card-__unassigned__")).getByText("2 loadouts")).toBeInTheDocument();
  });

  // --- REQ "The Selected List Is Client State" -------------------------------------

  it("expanding a card selects the list, and collapsing deselects", async () => {
    const store = renderPanel(base([list("a", "Alpha")], []));

    await act(async () => fireEvent.click(screen.getByTestId("list-card-a")));
    expect(store.getState().ui.selectedListId).toBe("a");

    await act(async () => fireEvent.click(screen.getByTestId("list-card-a")));
    expect(store.getState().ui.selectedListId).toBeNull();
  });

  it("mirrors the selection to localStorage so it survives a reload", async () => {
    renderPanel(base([list("a", "Alpha")], []));

    await act(async () => fireEvent.click(screen.getByTestId("list-card-a")));
    expect(localStorage.getItem(LS_SELECTED_LIST)).toBe("a");

    await act(async () => fireEvent.click(screen.getByTestId("list-card-a")));
    expect(localStorage.getItem(LS_SELECTED_LIST)).toBeNull();
  });

  it("shows the empty-state copy for a selected list with no loadouts", () => {
    renderPanel(base([list("a", "Alpha")], [], { selectedListId: "a" }));
    expect(screen.getByText(/No loadouts filed yet/i)).toBeInTheDocument();
  });

  // --- Ordering --------------------------------------------------------------------

  it("reorders the roster when the sort changes", async () => {
    const store = renderPanel(
      base([list("a", "Alpha", { createdAt: "2026-01-01" }), list("b", "Beta", { createdAt: "2026-09-01" })], [])
    );

    await act(async () =>
      fireEvent.change(screen.getByLabelText(/order lists by/i), { target: { value: "created" } })
    );
    expect(store.getState().ui.listSort).toBe("created");

    const ids = screen
      .getAllByRole("button")
      .map((b) => b.dataset.testid)
      .filter(Boolean);
    // Unassigned stays pinned first; Beta (newer) now precedes Alpha.
    expect(ids).toEqual(["list-card-__unassigned__", "list-card-b", "list-card-a"]);
  });

  // --- Move control ----------------------------------------------------------------

  it("offers an explicit keyboard-operable move control naming the loadout", () => {
    renderPanel(base([list("a", "Alpha"), list("b", "Beta")], [loadout("1", "My build", "a")], { selectedListId: "a" }));

    const select = screen.getByLabelText("List for My build");
    expect(select.tagName).toBe("SELECT"); // native — keyboard, type-ahead and Escape come free
    expect(within(select).getByRole("option", { name: "Unassigned" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Beta" })).toBeInTheDocument();
    expect(select.value).toBe("a");
  });

  // --- Retire ----------------------------------------------------------------------

  it("names the list in the retire control's accessible name", () => {
    renderPanel(base([list("a", "Alpha")], [], { selectedListId: "a" }));
    expect(screen.getByLabelText("Retire list: Alpha")).toBeInTheDocument();
  });

  it("states that loadouts move to Unassigned rather than being deleted", async () => {
    renderPanel(
      base([list("a", "Alpha")], [loadout("1", "x", "a"), loadout("2", "y", "a")], {
        selectedListId: "a", confirmRetireListId: "a",
      })
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/move to Unassigned, not deleted/i)).toBeInTheDocument();
  });

  it("uses different copy when the list is empty", () => {
    renderPanel(base([list("a", "Alpha")], [], { selectedListId: "a", confirmRetireListId: "a" }));
    expect(within(screen.getByRole("dialog")).getByText(/holds no loadouts/i)).toBeInTheDocument();
  });

  it("marks the retire dialog as a modal", () => {
    renderPanel(base([list("a", "Alpha")], [], { selectedListId: "a", confirmRetireListId: "a" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });
});
