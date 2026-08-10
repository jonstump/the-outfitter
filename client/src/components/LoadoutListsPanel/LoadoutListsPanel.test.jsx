import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import LoadoutListsPanel from "./LoadoutListsPanel.jsx";
import { createTestStore } from "../../test/testStore.js";
import { LS_SELECTED_LIST } from "../../store/uiSlice.js";
import { emptyLoadout, toData } from "../../utils/loadoutCodec.js";
import { saveCurrent } from "../../store/savedLoadoutsSlice.js";
import { UNASSIGNED } from "../../utils/listOrdering.js";
import { HUNTERS } from "../../data/hunters.js";

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
    selectedListId: null, unassignedOpen: false, listSort: "name", creatingList: false,
    renamingListId: null, confirmRetireListId: null, ...ui,
  },
});

beforeEach(() => {
  localStorage.clear();
});

describe("LoadoutListsPanel", () => {
  it("shows an empty roster with a way to create the first list", () => {
    // Previously returned null here, which took "+ New list" with it — a brand-new user
    // had no entry point and had to save a loadout first. Found in review.
    renderPanel(base([], []));
    expect(screen.getByRole("button", { name: /\+ New list/ })).toBeInTheDocument();
    expect(screen.getByText(/No lists yet/i)).toBeInTheDocument();
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

  // --- Integration: the seam unit tests cannot see -----------------------------------

  it("sends listId null when saving with Unassigned open — never the sentinel", async () => {
    // Regression for the Critical found in review: the panel used UNASSIGNED as a
    // selection id, saveCurrent forwarded it as a listId, and the server 404'd every save
    // while that card was open. Each unit was individually green; only the seam was wrong.
    const captured = [];
    global.fetch = vi.fn(async (url, opts) => {
      captured.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, status: 201, json: async () => ({ id: "new", name: "x", data, listId: null }) };
    });

    const store = renderPanel(base([list("a", "Alpha")], []));
    await act(async () => fireEvent.click(screen.getByTestId(`list-card-${UNASSIGNED}`)));

    // Selection state must not hold the sentinel at all.
    expect(store.getState().ui.selectedListId).toBeNull();
    expect(store.getState().ui.unassignedOpen).toBe(true);

    await act(async () => {
      await store.dispatch(saveCurrent());
    });

    const save = captured.find((c) => c.url.endsWith("/api/loadouts"));
    expect(save).toBeDefined();
    expect(save.body.listId).toBeNull();
    expect(JSON.stringify(save.body)).not.toContain("__unassigned__");
  });

  it("sends the real list id when a real list is open", async () => {
    const captured = [];
    global.fetch = vi.fn(async (url, opts) => {
      captured.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, status: 201, json: async () => ({ id: "new", name: "x", data, listId: "a" }) };
    });

    const store = renderPanel(base([list("a", "Alpha")], []));
    await act(async () => fireEvent.click(screen.getByTestId("list-card-a")));
    await act(async () => {
      await store.dispatch(saveCurrent());
    });

    expect(captured.find((c) => c.url.endsWith("/api/loadouts")).body.listId).toBe("a");
  });

  it("sends listId null when the selected list no longer exists", async () => {
    // The render path already hid the ghost panel, but saveCurrent read selectedListId raw,
    // so a stale id still went out on the wire and 404'd the save — invisibly, since there
    // is no expanded panel and no pressed card to clear. Found in re-review.
    const captured = [];
    global.fetch = vi.fn(async (url, opts) => {
      captured.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, status: 201, json: async () => ({ id: "new", name: "x", data, listId: null }) };
    });

    const store = renderPanel(base([list("a", "Alpha")], [], { selectedListId: "retired-id" }));
    await act(async () => {
      await store.dispatch(saveCurrent());
    });

    const save = captured.find((c) => c.url.endsWith("/api/loadouts"));
    expect(save.body.listId).toBeNull();
    expect(JSON.stringify(save.body)).not.toContain("retired-id");
  });

  it("does not render a ghost panel for a selection that no longer resolves", () => {
    // Reachable from localStorage after a list is retired in another tab.
    renderPanel(base([list("a", "Alpha")], [], { selectedListId: "gone-list" }));
    expect(screen.queryByText(/No loadouts filed yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Close$/ })).not.toBeInTheDocument();
  });

  it("keeps the create affordance for a brand-new user with nothing saved", () => {
    renderPanel(base([], []));
    expect(screen.getByRole("button", { name: /\+ New list/ })).toBeInTheDocument();
  });

  it("offers only sorts that are backed by data", () => {
    renderPanel(base([list("a", "Alpha")], []));
    const opts = within(screen.getByLabelText(/order lists by/i)).getAllByRole("option").map((o) => o.textContent);

    // ARRIVED. This assertion previously withheld "Hunter name" and predicted its own failure
    // "once #109 populates hunters.js". SPEC-0004's scrape has now landed the roster, so the
    // comparator the panel always passed has something to resolve and the option is offered.
    expect(opts).toEqual([
      "Sort: List name",
      "Sort: Hunter name",
      "Sort: Creation date",
      "Sort: Loadouts held",
    ]);

    // GONE. SPEC-0003 dropped the requirement outright (2026-08-10) rather than deferring it,
    // so unlike the hunter sort this must not come back without a spec change first.
    expect(opts.join()).not.toMatch(/Recently used/);
  });

  it("blanks the move control for a dangling listId rather than showing a dead id", () => {
    renderPanel(base([list("a", "Alpha")], [loadout("1", "orphan", "deleted-list")], { unassignedOpen: true }));
    expect(screen.getByLabelText("List for orphan").value).toBe("");
  });

  // --- Portrait fallback ------------------------------------------------------------

  it("draws a silhouette for a list with a hunter whose art is missing", () => {
    renderPanel(base([list("a", "Rat builds", { hunterId: "the-rat" })], []));
    expect(screen.getByTestId("list-art-a")).toBeInTheDocument();
  });

  it("keeps the list-name monogram when no hunter is chosen", () => {
    // "shotgun experiments" has no hunter — drawing a figure would imply an identity the
    // list never claimed, so it keeps its own initial instead.
    renderPanel(base([list("a", "shotgun experiments")], []));
    expect(screen.queryByTestId("list-art-a")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("list-card-a")).getByText("S")).toBeInTheDocument();
  });

  it("never draws a silhouette on the Unassigned card", () => {
    renderPanel(base([], [loadout("1", "x", null)]));
    expect(screen.queryByTestId("list-art-__unassigned__")).not.toBeInTheDocument();
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

// --- Issue #88: portraits, accents, and the picker ---------------------------------
// Governing: SPEC-0003 REQ "Hunter Dataset Consumption Contract", REQ "Lists Are Visually
// Distinguishable Independent of Portrait and Name", REQ "The Hunter Picker Does Not
// Restrict or Mark Reuse", REQ "The Hunter Picker Is Filterable and Bounded"

const REAL_HUNTER = HUNTERS[0];

describe("a list whose hunter is not in the dataset", () => {
  // No live entry can produce this — all 242 resolve. It arises over TIME: the dataset and
  // a user's stored lists refresh independently, so a list outlives the hunter it names.
  const orphan = () => list("a", "Rat builds", { hunterId: "retired-last-season" });

  it("still renders, with a neutral placeholder and its own name", () => {
    renderPanel(base([orphan()], []));
    const card = screen.getByTestId("list-card-a");
    expect(within(card).getByText("Rat builds")).toBeInTheDocument();
    // Placeholder art, and no <img> — there is no slug to derive a URL from, so no request.
    expect(screen.getByTestId("list-art-a").querySelector("svg")).toBeInTheDocument();
    expect(screen.getByTestId("list-art-a").querySelector("img")).not.toBeInTheDocument();
  });

  it("stays selectable and renameable", async () => {
    const store = renderPanel(base([orphan()], []));
    await act(async () => fireEvent.click(screen.getByTestId("list-card-a")));
    expect(store.getState().ui.selectedListId).toBe("a");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "rename" })));
    expect(screen.getByLabelText("List name")).toBeInTheDocument();
  });

  it("can still hold loadouts, and says why the hunter is missing rather than claiming none was chosen", () => {
    renderPanel(base([orphan()], [loadout("1", "My build", "a")], { selectedListId: "a" }));
    expect(within(screen.getByTestId("list-expanded")).getByText("My build")).toBeInTheDocument();
    // "no portrait" would rewrite the user's choice; they picked a hunter that has since gone.
    expect(screen.getByText("hunter missing from roster")).toBeInTheDocument();
  });

  it("distinguishes it from a list that chose no portrait at all", () => {
    renderPanel(base([list("a", "Alpha")], [], { selectedListId: "a" }));
    expect(screen.getByText("no portrait")).toBeInTheDocument();
  });
});

describe("portrait sizes across contexts", () => {
  it("asks for the thumbnail on a card and the full size in the expanded header", () => {
    renderPanel(
      base([list("a", "Rat builds", { hunterId: REAL_HUNTER.id })], [], { selectedListId: "a" })
    );
    expect(screen.getByTestId("list-art-a").querySelector("img")).toHaveAttribute(
      "src",
      `/images/hunters/${REAL_HUNTER.portrait}-thumb.avif`
    );
    expect(screen.getByTestId("list-expanded-art").querySelector("img")).toHaveAttribute(
      "src",
      `/images/hunters/${REAL_HUNTER.portrait}.avif`
    );
  });

  it("falls back to the other size before the placeholder", () => {
    renderPanel(base([list("a", "Rat builds", { hunterId: REAL_HUNTER.id })], []));
    const art = screen.getByTestId("list-art-a");
    fireEvent.error(art.querySelector("img"));
    expect(art.querySelector("img")).toHaveAttribute("src", `/images/hunters/${REAL_HUNTER.portrait}.avif`);
    fireEvent.error(art.querySelector("img"));
    expect(art.querySelector("img")).not.toBeInTheDocument();
    expect(art.querySelector("svg")).toBeInTheDocument();
  });
});

describe("list accents", () => {
  it("renders the accent on the card and on the group heading", () => {
    renderPanel(base([list("a", "Alpha", { accent: "#5a6e96" })], [], { selectedListId: "a" }));
    expect(screen.getByTestId("list-card-a")).toHaveAttribute("data-accent", "#5a6e96");
    expect(screen.getByTestId("list-expanded")).toHaveAttribute("data-accent", "#5a6e96");
    // Painted through the custom property, never as a raw hex, so hover/focus can still win.
    expect(screen.getByTestId("list-card-a").style.getPropertyValue("--ll-accent")).toBe(
      "var(--list-accent-3)"
    );
  });

  it("never gives Unassigned an accent — it is structural, not a peer list", () => {
    renderPanel(base([], [loadout("1", "x", null)]));
    expect(screen.getByTestId("list-card-__unassigned__")).not.toHaveAttribute("data-accent");
  });

  it("keeps the list name visible everywhere the accent appears", () => {
    // Load-bearing: the palette separates by hue, not luminance (olive vs teal is 1.02:1),
    // so a colour-blind user distinguishes lists by name or not at all.
    renderPanel(
      base([list("a", "Alpha", { accent: "#7a8a4e" }), list("b", "Beta", { accent: "#5e8a8a" })], [], {
        selectedListId: "a",
      })
    );
    expect(within(screen.getByTestId("list-card-a")).getByText("Alpha")).toBeInTheDocument();
    expect(within(screen.getByTestId("list-card-b")).getByText("Beta")).toBeInTheDocument();
    expect(within(screen.getByTestId("list-expanded")).getByText("Alpha")).toBeInTheDocument();
  });

  it("persists an accent change and reflects it wherever the list renders", async () => {
    global.fetch = vi.fn(async (url, opts) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "a", name: "Alpha", hunterId: null, ...JSON.parse(opts.body) }),
    }));

    const store = renderPanel(base([list("a", "Alpha", { accent: "#b04a3e" })], [], { selectedListId: "a" }));
    await act(async () => fireEvent.click(screen.getByRole("radio", { name: "Teal" })));

    const [url, opts] = global.fetch.mock.calls[0];
    expect(String(url)).toContain("/api/loadout-lists/a");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ accent: "#5e8a8a" });

    expect(store.getState().loadoutLists.items[0].accent).toBe("#5e8a8a");
    expect(screen.getByTestId("list-card-a")).toHaveAttribute("data-accent", "#5e8a8a");
    expect(screen.getByTestId("list-expanded")).toHaveAttribute("data-accent", "#5e8a8a");
  });

  it("accepts an accent another list already uses, with no warning", async () => {
    global.fetch = vi.fn(async (url, opts) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "a", name: "Alpha", hunterId: null, ...JSON.parse(opts.body) }),
    }));

    const store = renderPanel(
      base([list("a", "Alpha", { accent: "#b04a3e" }), list("b", "Beta", { accent: "#7a8a4e" })], [], {
        selectedListId: "a",
      })
    );
    await act(async () => fireEvent.click(screen.getByRole("radio", { name: "Olive" })));

    expect(store.getState().loadoutLists.items[0].accent).toBe("#7a8a4e");
    // Six values against an unbounded number of lists: a collision is ordinary, not an error.
    expect(store.getState().ui.message).not.toMatch(/^!/);
    expect(screen.queryByText(/already/i)).not.toBeInTheDocument();
  });

  it("marks exactly one swatch as the current value", () => {
    renderPanel(base([list("a", "Alpha", { accent: "#8a5e86" })], [], { selectedListId: "a" }));
    const checked = screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAccessibleName("Plum");
  });
});

describe("creating a list from the picker", () => {
  const openPickerFromCreateForm = async () => {
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /\+ New list/ })));
    const trigger = screen.getByRole("button", { name: /^Portrait:/ });
    // fireEvent.click does not move focus the way a real click (or Enter on a focused
    // button) does, and the trap captures whatever is focused at open — so focus it first
    // or the test measures a jsdom artifact rather than the focus-return behaviour.
    trigger.focus();
    await act(async () => fireEvent.click(trigger));
    return trigger;
  };

  it("lets a hunter another list already uses be picked again, unmarked", async () => {
    const created = { id: "new", name: REAL_HUNTER.name, hunterId: REAL_HUNTER.id, accent: "#7a8a4e" };
    global.fetch = vi.fn(async () => ({ ok: true, status: 201, json: async () => created }));

    // "a" already references this hunter. Reuse is unrestricted and unmarked.
    const store = renderPanel(base([list("a", "First rat", { hunterId: REAL_HUNTER.id })], []));
    await openPickerFromCreateForm();

    const tile = screen.getByTestId(`hunter-tile-${REAL_HUNTER.id}`);
    expect(tile).not.toHaveAttribute("aria-disabled");
    expect(tile.className).toBe("hp-tile"); // no in-use variant, badge or dimming
    expect(within(tile).queryByText(/in use|used/i)).not.toBeInTheDocument();

    await act(async () => fireEvent.click(tile));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create list" })));

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.hunterId).toBe(REAL_HUNTER.id);
    // Name defaulted from the hunter, since the user typed none.
    expect(body.name).toBe(REAL_HUNTER.name);
    expect(store.getState().loadoutLists.items).toHaveLength(2);
  });

  it("does not overwrite a name the user already typed", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ id: "new", name: "My own name", hunterId: REAL_HUNTER.id, accent: "#b04a3e" }),
    }));

    renderPanel(base([], []));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /\+ New list/ })));
    await act(async () =>
      fireEvent.change(screen.getByLabelText("New list name"), { target: { value: "My own name" } })
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Portrait:/ })));
    await act(async () => fireEvent.click(screen.getByTestId(`hunter-tile-${REAL_HUNTER.id}`)));

    expect(screen.getByLabelText("New list name").value).toBe("My own name");
  });

  it("creates a list with a null hunterId from the explicit no-portrait option", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ id: "new", name: "New list", hunterId: null, accent: "#b04a3e" }),
    }));

    renderPanel(base([], []));
    await openPickerFromCreateForm();
    await act(async () => fireEvent.click(screen.getByTestId("hunter-tile-none")));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create list" })));

    expect(JSON.parse(global.fetch.mock.calls[0][1].body).hunterId).toBeNull();
    // …and it renders a monogram from its own name, not a stranger's silhouette.
    expect(screen.queryByTestId("list-art-new")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("list-card-new")).getByText("N")).toBeInTheDocument();
  });

  it("returns focus to the trigger when the picker is dismissed with Escape", async () => {
    renderPanel(base([], []));
    const trigger = await openPickerFromCreateForm();

    await act(async () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("previews the accent the new list will be assigned", async () => {
    // Preview only — the server assigns least-used-first and the created record wins.
    renderPanel(base([list("a", "Alpha", { accent: "#b04a3e" })], []));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /\+ New list/ })));
    expect(screen.getByTestId("create-accent-preview").style.background).toContain("--list-accent-2");
  });
});
