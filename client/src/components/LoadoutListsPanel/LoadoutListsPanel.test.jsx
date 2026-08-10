import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import LoadoutListsPanel, {
  CARD_MIN_PX,
  CELL_MIN_PX,
  EQUIP_CELLS,
  EQUIP_COLUMNS,
  PREVIEW_EMPTY_LABEL,
  PREVIEW_GAP_PX,
  TRAIT_CELLS,
  TRAIT_COLUMNS,
  WEAPON_ASSET_WIDTH,
  WEAPON_CELLS,
  WEAPON_MIN_DRAWN_PX,
  previewGroups,
  previewSummary,
} from "./LoadoutListsPanel.jsx";
import * as panelModule from "./LoadoutListsPanel.jsx";
import { createTestStore } from "../../test/testStore.js";
import { LS_SELECTED_LIST } from "../../store/uiSlice.js";
import { slugify } from "../../utils/slugify.js";
import { emptyLoadout, fromData, toData } from "../../utils/loadoutCodec.js";
import { saveCurrent } from "../../store/savedLoadoutsSlice.js";
import { UNASSIGNED } from "../../utils/listOrdering.js";
import { HUNTERS } from "../../data/hunters.js";
import { TRAITS } from "../../data/catalog.js";

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
    expect(tile.className).toBe("hp-tile-choose");
    // The tile is the grid ROW around that cell (#114 — see the note in HunterPicker.jsx on
    // why the tiles are a grid and no longer a listbox). Its class list is what would carry
    // an in-use variant if one existed; the store above has a list referencing this hunter
    // and nothing about the tile says so.
    expect(tile.closest('[role="row"]').className).toBe("hp-tile");
    expect(within(tile).queryByText(/in use|used/i)).not.toBeInTheDocument();

    await act(async () => fireEvent.click(tile));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create list" })));

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.hunterId).toBe(REAL_HUNTER.id);
    // Name defaulted from the hunter, since the user typed none.
    expect(body.name).toBe(REAL_HUNTER.name);
    expect(store.getState().loadoutLists.items).toHaveLength(2);
  });

  it("shows ONLY the favorite marking on a hunter that is both favorited and in use", async () => {
    // Governing: SPEC-0003 REQ "Favorite Hunters", REQ "The Hunter Picker Does Not Restrict
    // or Mark Reuse" — acceptance criterion 9, at the INTERSECTION the two halves are each
    // tested at separately. Favorited-and-unused and unfavorited-but-in-use both pass
    // trivially; the state SPEC-0003 actually forbids conflating is a hunter in BOTH, where
    // a star could be read as "already used" or an in-use variant could quietly ride along
    // on the class that carries the star.
    //
    // The store below puts list "a" on this hunter AND puts the hunter in the user's
    // favorites, then asserts the tile carries exactly the favorite class and no reuse
    // signal of any kind.
    const store = renderPanel({
      ...base([list("a", "First rat", { hunterId: REAL_HUNTER.id })], []),
      hunterFavorites: { ids: [REAL_HUNTER.id], status: "succeeded", error: null },
    });
    expect(store.getState().loadoutLists.items[0].hunterId).toBe(REAL_HUNTER.id);
    await openPickerFromCreateForm();

    const tile = screen.getByTestId(`hunter-tile-${REAL_HUNTER.id}`);
    const row = tile.closest('[role="row"]');

    // Exactly the favorite variant. `hp-tile-fav` and nothing beside it — no in-use class
    // can hide in this list.
    expect(row.className.split(" ").sort()).toEqual(["hp-tile", "hp-tile-fav"]);
    // The favorite state is announced, and announced as a favorite.
    expect(
      within(row).getByRole("button", { name: new RegExp(`unfavorite ${REAL_HUNTER.name}`, "i") })
    ).toHaveAttribute("aria-pressed", "true");
    // Nothing marks it as used, and nothing takes it out of play.
    expect(row).not.toHaveAttribute("aria-disabled");
    expect(tile).not.toHaveAttribute("aria-disabled");
    expect(tile).not.toHaveAttribute("disabled");
    // aria-selected lives on the choose cell, and "false" here is the point: the only
    // selection state the picker knows is THIS list's current portrait, not another list's.
    expect(tile).toHaveAttribute("aria-selected", "false");
    expect(within(row).queryByText(/in use|used|already/i)).not.toBeInTheDocument();
    expect(row.getAttribute("title")).toBeNull();

    // And it is still choosable, which is the behavioural half of "does not restrict".
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ id: "new", name: REAL_HUNTER.name, hunterId: REAL_HUNTER.id, accent: "#7a8a4e" }),
    }));
    await act(async () => fireEvent.click(tile));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create list" })));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).hunterId).toBe(REAL_HUNTER.id);
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

// ---------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------
// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
// Hunter Portraits), SPEC-0003 REQ "Filed Loadouts Preview Their Contents", SPEC-0003 REQ
// "Saved Loadouts Render as a Card Grid", SPEC-0003 Accessibility Requirements "Loadout
// Previews Are Supplementary, Not the Card's Identity"
//
// These replace the strip tests written for #139/#150. That preview was one undifferentiated
// line of 34x24 thumbs that shed content as the viewport narrowed; the requirement it
// conformed to has been amended and the shedding rule withdrawn, so every assertion about
// capacity, shedding order and "+N more"-by-width is gone with the code it described.
//
// Two spec scenarios are deliberately NOT here. "Equipment sits in its own cell" and "An
// unresolvable item leaves a hole" are marked in the spec as exercisable only once SPEC-0006's
// sparse model lands: today's decoder filters unresolvable ids and packs what survives before
// any preview sees it, so neither is falsifiable. The placement rule is implemented (every
// group is a fixed-length array indexed by cell); a test that cannot fail is not written.
// ---------------------------------------------------------------------------------------

// A raw v1 payload, written the way a stored record actually carries it. Built by hand
// rather than through toData() so a test can reference an id the catalog does NOT have —
// and so it can carry more traits than the game's per-hunter maximum, which toData() has no
// reason to help with and the server accepts.
const v1 = ({ w = [], e = [], tr = [] }) => ({
  v: 1,
  w: [w[0] ?? null, w[1] ?? null],
  e,
  tr,
  n: "",
  b: 0,
});

const filed = (id, name, payload, listId = null) => ({
  id, name, data: payload, listId, updatedAt: "2026-01-01",
});

const previewOf = (id) => screen.getByTestId(`loadout-preview-${id}`);
const cardOf = (id) => screen.getByTestId(`loadout-card-${id}`);
const cellsIn = (testid) => [...screen.getByTestId(testid).querySelectorAll(".ll-lp-cell")];
const filledIn = (testid) => cellsIn(testid).filter((c) => !c.classList.contains("ll-lp-cell-empty"));
const emptyIn = (testid) => cellsIn(testid).filter((c) => c.classList.contains("ll-lp-cell-empty"));
const drawn = (id) => [...previewOf(id).querySelectorAll("img")].map((img) => img.getAttribute("src"));

// The stylesheet is read as data because jsdom performs no layout. The size floors this
// requirement pins are numbers in the component and are handed to global.css as custom
// properties; asserting the constants alone would prove nothing about what is drawn, and
// asserting a computed pixel width is not something jsdom can answer. What IS assertable —
// and what the strip's failure argues for — is that the rules enforcing the floors read
// those properties rather than literals of their own.
//
// Located from the working directory rather than from `import.meta.url`, which under the
// jsdom environment resolves against the dev server's origin rather than the filesystem.
// Either candidate is right depending on whether the runner was started in the workspace or
// at the repo root; neither existing is a broken test, not a skipped one.
const CSS_PATH = ["src/styles/global.css", "client/src/styles/global.css"].find(existsSync);
// Comments are stripped before parsing so prose about widths and floors can never satisfy —
// or break — an assertion about declarations. Every rule naming the selector contributes,
// rather than the first one found, so a later override cannot hide from the assertion.
const CSS_RULES = [
  ...readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map(([, selectors, body]) => ({ selectors: selectors.split(",").map((s) => s.trim()), body }));

const ruleFor = (selector) => {
  const bodies = CSS_RULES.filter((r) => r.selectors.includes(selector)).map((r) => r.body);
  if (!bodies.length) throw new Error(`no CSS rule for ${selector}`);
  return bodies.join("\n");
};

// Spelled out per category, not `expect.any(String)`: the /images/{category}/ segment is the
// only place the tool/consumable split is observable from outside, so pinning it is what
// stops TOOLS/toolThumb being substituted for CONS/consThumb without a test noticing
// (SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback").
const SPARKS = `/images/weapons/${slugify("Sparks LRR")}.jpg`;
const CONVERSION = `/images/weapons/${slugify("Caldwell Conversion Pistol")}.jpg`;
const FIRST_AID = `/images/tools/${slugify("First Aid Kit")}.jpg`;
const KNIFE = `/images/tools/${slugify("Knife")}.jpg`;
const VITALITY = `/images/consumables/${slugify("Vitality Shot")}.jpg`;
const DYNAMITE = `/images/consumables/${slugify("Dynamite Stick")}.jpg`;
const THROWING_KNIVES = `/images/tools/${slugify("Throwing Knives")}.jpg`;
const QUARTERMASTER = `/images/traits/${slugify("Quartermaster")}.jpg`;

// Two weapons, five equipment, one trait — every category occupied and none of them full.
const LOADED = v1({
  w: [["sparks-lrr", -1], ["caldwell-conversion-pistol", -1]],
  e: [
    ["T", "first-aid-kit"],
    ["T", "knife"],
    ["C", "vitality-shot"],
    ["C", "dynamite-stick"],
    ["T", "throwing-knives"],
  ],
  tr: ["quartermaster"],
});

// Eighteen traits — three past the grid. Reachable today and not a contrivance: the
// trait-point budget is off by default (`upBudgetOn: false` in the fixture below, which is
// also the app's default), the catalog holds 32 traits and the server accepts 40.
const EIGHTEEN_TRAIT_IDS = TRAITS.slice(0, 18).map((t) => t[0]);
const OVERSTUFFED = v1({ w: [["sparks-lrr", -1]], tr: EIGHTEEN_TRAIT_IDS });

describe("the categorised loadout preview", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => {
      throw new Error("no request may be issued to render a preview");
    });
  });

  it("derives the preview from the record's own data, issuing no request", () => {
    renderPanel(base([], [filed("1", "long ammo", LOADED)], { unassignedOpen: true }));

    // Everything drawn came out of `data`; nothing was fetched to learn what the loadout
    // holds. Every tile is named, including both consumables — a consumable resolving under
    // /images/tools/ is asserted against nowhere else in the suite.
    expect(drawn("1")).toEqual([
      SPARKS, CONVERSION, FIRST_AID, KNIFE, VITALITY, DYNAMITE, THROWING_KNIVES, QUARTERMASTER,
    ]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("groups weapons, tools and consumables, and traits separately", () => {
    renderPanel(base([], [filed("1", "long ammo", LOADED)], { unassignedOpen: true }));

    // Three groups, drawn in the order a build is read, and each one its own region rather
    // than a run of tiles in a single line.
    const groups = [...previewOf("1").querySelectorAll(".ll-lp-group")];
    expect(groups.map((g) => g.dataset.testid)).toEqual([
      "preview-weapons-1", "preview-equipment-1", "preview-traits-1",
    ]);
    expect(groups.map((g) => g.textContent.replace(/\+\d+ more/, "").trim())).toEqual([
      "Weapons", "Tools & consumables", "Traits",
    ]);

    // Each item landed in the group its category belongs to — the split is not merely a
    // label, so a tool cannot quietly render among the traits.
    const src = (el) => el.querySelector("img")?.getAttribute("src");
    expect(filledIn("preview-weapons-1").map(src)).toEqual([SPARKS, CONVERSION]);
    expect(filledIn("preview-equipment-1").map(src)).toEqual([
      FIRST_AID, KNIFE, VITALITY, DYNAMITE, THROWING_KNIVES,
    ]);
    expect(filledIn("preview-traits-1").map(src)).toEqual([QUARTERMASTER]);
  });

  it("draws eight equipment cells as two rows of four, and fifteen trait cells", () => {
    renderPanel(base([], [filed("1", "long ammo", LOADED)], { unassignedOpen: true }));

    expect(cellsIn("preview-weapons-1")).toHaveLength(WEAPON_CELLS);
    expect(cellsIn("preview-equipment-1")).toHaveLength(8);
    expect(cellsIn("preview-traits-1")).toHaveLength(15);
    expect([EQUIP_CELLS, TRAIT_CELLS]).toEqual([8, 15]);

    // Two rows of four, matching the builder's own equipment grid. The column count is fixed
    // rather than auto-filled, which is what makes "8 cells" mean a shape and not a total.
    expect(EQUIP_CELLS / EQUIP_COLUMNS).toBe(2);
    expect(previewOf("1").style.getPropertyValue("--ll-equip-cols")).toBe("4");
    expect(previewOf("1").style.getPropertyValue("--ll-trait-cols")).toBe(String(TRAIT_COLUMNS));

    // The cells the loadout does not fill are drawn, not collapsed away — a filled cell is
    // information and so is an empty one.
    expect(emptyIn("preview-equipment-1")).toHaveLength(3);
    expect(emptyIn("preview-traits-1")).toHaveLength(14);
  });

  it("keeps the trait grid's shape when the loadouts and the trait budget differ", () => {
    // Fifteen is the game's per-hunter maximum, deliberately not derived from the
    // trait-point cap — which is user-settable, so deriving from it would reflow the grid
    // when a setting changed. Both loadouts render fifteen cells under a cap of 4.
    renderPanel(
      base(
        [],
        [
          filed("1", "one trait", v1({ tr: ["quartermaster"] })),
          filed("2", "nine traits", v1({ tr: TRAITS.slice(0, 9).map((t) => t[0]) })),
        ],
        { unassignedOpen: true, upBudgetOn: true, upBudget: 4 }
      )
    );

    expect(cellsIn("preview-traits-1")).toHaveLength(TRAIT_CELLS);
    expect(cellsIn("preview-traits-2")).toHaveLength(TRAIT_CELLS);
    // The filled cells differ while the grid's shape does not.
    expect(filledIn("preview-traits-1")).toHaveLength(1);
    expect(filledIn("preview-traits-2")).toHaveLength(9);
  });

  it("fills fifteen trait cells and states the remainder as a count", () => {
    renderPanel(base([], [filed("1", "everything", OVERSTUFFED)], { unassignedOpen: true }));

    // The grid does not grow, does not scroll and does not clip silently: it holds fifteen,
    // and the three it cannot hold are stated.
    expect(cellsIn("preview-traits-1")).toHaveLength(15);
    expect(filledIn("preview-traits-1")).toHaveLength(15);
    expect(emptyIn("preview-traits-1")).toHaveLength(0);
    expect(previewOf("1")).toHaveTextContent("+3 more");

    // The other grids are unmoved by it.
    expect(cellsIn("preview-weapons-1")).toHaveLength(WEAPON_CELLS);
    expect(cellsIn("preview-equipment-1")).toHaveLength(EQUIP_CELLS);
  });

  it("states an empty loadout rather than rendering three empty grids", () => {
    renderPanel(base([], [filed("1", "nothing yet", v1({}))], { unassignedOpen: true }));

    expect(previewOf("1")).toHaveTextContent(PREVIEW_EMPTY_LABEL);
    expect(previewOf("1").querySelectorAll(".ll-lp-cell")).toHaveLength(0);
    expect(screen.queryByTestId("preview-traits-1")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("draws the grids for a traits-only loadout — it holds something", () => {
    // The empty statement is for a loadout holding NOTHING. Under the strip this case had no
    // imagery at all and fell into the empty branch with its traits tacked onto the copy;
    // traits are drawn now, so a traits-only loadout is an ordinary preview.
    renderPanel(base([], [filed("1", "perks only", v1({ tr: ["quartermaster"] }))], { unassignedOpen: true }));

    expect(previewOf("1")).not.toHaveTextContent(PREVIEW_EMPTY_LABEL);
    expect(filledIn("preview-traits-1")).toHaveLength(1);
    expect(cellsIn("preview-weapons-1").every((c) => c.classList.contains("ll-lp-cell-empty"))).toBe(true);
  });

  it("omits an item that no longer resolves, without a placeholder or a broken tile", () => {
    const payload = v1({
      w: [["sparks-lrr", -1], ["weapon-that-left-the-game", -1]],
      e: [["T", "first-aid-kit"], ["T", "tool-that-left-the-game"]],
      tr: ["quartermaster", "trait-that-left-the-game"],
    });
    renderPanel(base([], [filed("1", "stale", payload)], { unassignedOpen: true }));

    // fromData already dropped the unknown ids; the preview neither re-checks nor back-fills.
    expect(drawn("1")).toEqual([SPARKS, FIRST_AID, QUARTERMASTER]);
    expect(previewOf("1")).toHaveAccessibleName("Holds Sparks LRR, 1 tool, 1 trait");
    expect(screen.getByRole("button", { name: "stale" })).toBeInTheDocument();
  });

  it("carries ONE text equivalent for the whole preview, and marks the imagery decorative", () => {
    renderPanel(base([], [filed("1", "long ammo", LOADED)], { unassignedOpen: true }));

    // ONE announcement, not twenty-five: the whole panel is a single role="img". Weapons are
    // named because a build is identified by them; everything else is a count, because eight
    // tool names in one label is not a summary.
    expect(
      screen.getByRole("img", {
        name: "Holds Sparks LRR, Caldwell Conversion Pistol, 3 tools, 2 consumables, 1 trait",
      })
    ).toBe(previewOf("1"));
    expect(within(cardOf("1")).getAllByRole("img")).toHaveLength(1);

    for (const img of previewOf("1").querySelectorAll("img")) {
      expect(img).toHaveAttribute("alt", "");
      expect(img).toHaveAttribute("loading", "lazy");
    }
    // The visible category captions and the overflow count label the preview for the eye
    // only — the one aria-label is the whole announcement.
    for (const cap of previewOf("1").querySelectorAll(".ll-lp-cap")) {
      expect(cap).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("never announces an empty cell", () => {
    // A fifteen-cell trait grid holding four traits must not read as eleven blanks.
    renderPanel(
      base([], [filed("1", "four perks", v1({ tr: TRAITS.slice(0, 4).map((t) => t[0]) }))], {
        unassignedOpen: true,
      })
    );

    const blanks = emptyIn("preview-traits-1");
    expect(blanks).toHaveLength(11);
    for (const cell of blanks) {
      expect(cell).toHaveAttribute("aria-hidden", "true");
      expect(cell).toBeEmptyDOMElement();
    }
    // Nothing inside the preview is separately reachable — the card offers one image, and
    // the next card is one step away rather than twenty-five.
    expect(within(cardOf("1")).getAllByRole("img")).toEqual([previewOf("1")]);
    expect(previewOf("1")).toHaveAccessibleName("Holds 4 traits");
  });

  it("describes what the loadout holds, not what it drew", () => {
    renderPanel(base([], [filed("1", "everything", OVERSTUFFED)], { unassignedOpen: true }));

    // Eighteen held, fifteen drawn. The text equivalent describes the record, so a screen
    // reader is not told the grid's capacity in place of the loadout's contents.
    expect(previewOf("1")).toHaveAccessibleName("Holds Sparks LRR, 18 traits");
    expect(filledIn("preview-traits-1")).toHaveLength(15);
    // …and the count that reconciles the two is decorative, so it can never contradict it.
    expect(previewOf("1").querySelector(".ll-lp-more")).toHaveAttribute("aria-hidden", "true");
  });

  it("writes nothing and mutates nothing to render a preview", () => {
    const store = renderPanel(base([], [filed("1", "long ammo", LOADED)], { unassignedOpen: true }));

    // The fetch assertion is cheap here (the fixture preloads status "succeeded", so no
    // thunk runs regardless) but still catches a preview implemented WITH a request. The
    // assertion actually carrying the "no write" AC is the next one: the stored record is
    // byte-identical to the input after rendering.
    expect(global.fetch).not.toHaveBeenCalled();
    expect(store.getState().savedLoadouts.items[0].data).toEqual(LOADED);
  });

  it("pins the size floors, and hands them to the stylesheet rather than restating them", () => {
    renderPanel(base([], [filed("1", "long ammo", LOADED)], { unassignedOpen: true }));

    // A weapon at no less than 50% of its intrinsic asset width; a cell at no less than
    // 48 CSS px on its shorter edge. Weapon art is 512x128, and the strip this replaces drew
    // it at 34x24 — about 7% — while conforming to a requirement that said only "preview".
    expect(WEAPON_ASSET_WIDTH).toBe(512);
    expect(WEAPON_MIN_DRAWN_PX).toBe(WEAPON_ASSET_WIDTH / 2);
    expect(CELL_MIN_PX).toBe(48);
    // The two floors meet by construction: five trait columns at the cell floor, plus their
    // gaps, is exactly the weapon floor. One minimum width therefore satisfies both, and no
    // card can be wide enough to draw one at full size and not the other.
    expect(TRAIT_COLUMNS * CELL_MIN_PX + (TRAIT_COLUMNS - 1) * PREVIEW_GAP_PX).toBe(WEAPON_MIN_DRAWN_PX);
    expect(CARD_MIN_PX).toBeGreaterThanOrEqual(WEAPON_MIN_DRAWN_PX);

    expect(previewOf("1").style.getPropertyValue("--ll-weapon-min")).toBe(`${WEAPON_MIN_DRAWN_PX}px`);
    expect(previewOf("1").style.getPropertyValue("--ll-cell-min")).toBe(`${CELL_MIN_PX}px`);
    expect(screen.getByTestId("loadout-card-grid").style.getPropertyValue("--ll-card-min")).toBe(
      `${CARD_MIN_PX}px`
    );

    // …and the stylesheet enforces them by READING those properties. A floor that lives only
    // in a stylesheet is a floor nothing can check, which is exactly how 34x24 shipped.
    expect(ruleFor(".ll-lp")).toMatch(/min-width:\s*var\(--ll-weapon-min/);
    expect(ruleFor(".ll-lp-weapon")).toMatch(/width:\s*100%/);
    expect(ruleFor(".ll-lp-slot")).toMatch(/min-width:\s*var\(--ll-cell-min/);
    expect(ruleFor(".ll-lp-slot")).toMatch(/min-height:\s*var\(--ll-cell-min/);
    expect(ruleFor(".ll-lp-equip")).toMatch(/repeat\(var\(--ll-equip-cols[^)]*\), minmax\(var\(--ll-cell-min/);
    expect(ruleFor(".ll-lp-traits")).toMatch(/repeat\(var\(--ll-trait-cols[^)]*\), minmax\(var\(--ll-cell-min/);
  });

  it("has no shed-by-width machinery left anywhere", async () => {
    // #150's strip degraded along one ordered list as the viewport narrowed. That rule is
    // WITHDRAWN, not merely unused — a fixed-cell grid has no such list, and dropping cells
    // would destroy the constant shape the grid exists to hold. Left dormant, it is what a
    // later reader restores.
    for (const gone of ["previewEntries", "shedPreview", "previewCapacity", "previewEmptyLabel"]) {
      expect(panelModule[gone]).toBeUndefined();
    }

    const spy = vi.spyOn(window, "addEventListener");
    renderPanel(base([], [filed("1", "long ammo", LOADED)], { unassignedOpen: true }));
    expect(spy.mock.calls.map(([type]) => type)).not.toContain("resize");
    spy.mockRestore();
  });

  it("arranges a decoded loadout into fixed-length groups, as pure functions", () => {
    // Asserted directly as well as through the DOM: the placement rule is "each item at its
    // stored cell, holes rendered as holes", and that is a property of the arrangement, not
    // of the markup. It is also the half of the rule that survives SPEC-0006 unchanged.
    const groups = previewGroups(fromData(LOADED));

    expect(groups.weapons).toHaveLength(WEAPON_CELLS);
    expect(groups.equipment).toHaveLength(EQUIP_CELLS);
    expect(groups.traits).toHaveLength(TRAIT_CELLS);
    expect(groups.equipment.map((c) => c?.kind)).toEqual([
      "tool", "tool", "consumable", "consumable", "tool", undefined, undefined, undefined,
    ]);
    expect(groups.empty).toBe(false);
    expect(groups.traitOverflow).toBe(0);

    const over = previewGroups(fromData(OVERSTUFFED));
    expect(over.traitsHeld).toBe(18);
    expect(over.traitOverflow).toBe(3);
    expect(over.traits.filter(Boolean)).toHaveLength(TRAIT_CELLS);

    const nothing = previewGroups(fromData(v1({})));
    expect(nothing.empty).toBe(true);
    expect(previewSummary(nothing)).toBe(PREVIEW_EMPTY_LABEL);
  });
});

// ---------------------------------------------------------------------------------------
// Governing: SPEC-0003 REQ "Saved Loadouts Render as a Card Grid"
// ---------------------------------------------------------------------------------------

describe("saved loadouts as a card grid", () => {
  it("renders each loadout as a card in a grid, carrying every control the row had", () => {
    renderPanel(
      base(
        [list("a", "Alpha")],
        [filed("1", "long ammo", LOADED, "a"), filed("2", "shotgun", v1({ w: [["romero-77", -1]] }), "a")],
        { selectedListId: "a" }
      )
    );

    const grid = screen.getByTestId("loadout-card-grid");
    expect(within(grid).getAllByTestId(/^loadout-card-\d+$/)).toHaveLength(2);

    const card = cardOf("1");
    expect(within(card).getByRole("button", { name: "long ammo" })).toBeInTheDocument();
    expect(within(card).getByText("$354")).toBeInTheDocument();
    expect(within(card).getByTestId("loadout-preview-1")).toBeInTheDocument();
    expect(within(card).getByLabelText("List for long ammo")).toBeInTheDocument();
    expect(within(card).getByLabelText("Delete loadout: long ammo")).toBeInTheDocument();
  });

  it("files a loadout into another list from the card, with no pointer gesture", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => filed("1", "My build", LOADED, "b"),
    }));

    const store = renderPanel(
      base([list("a", "Alpha"), list("b", "Beta")], [filed("1", "My build", LOADED, "a")], {
        selectedListId: "a",
      })
    );

    // An explicit control on the card, in the tab order, named for the loadout it moves.
    // Native <select>, so keyboard operation, type-ahead and Escape-to-cancel come from the
    // platform — nothing here is reachable only by dragging.
    const select = within(cardOf("1")).getByLabelText("List for My build");
    expect(select.tagName).toBe("SELECT");
    expect(select).toBeEnabled();
    expect(select.value).toBe("a");
    expect(within(select).getByRole("option", { name: "Beta" })).toBeInTheDocument();

    await act(async () => fireEvent.change(select, { target: { value: "b" } }));
    expect(store.getState().savedLoadouts.items[0].listId).toBe("b");
  });

  it("does not reuse the list card's portrait, accent frame and loadout count", () => {
    renderPanel(
      base([list("a", "Rat builds", { hunterId: REAL_HUNTER.id, accent: "#5a6e96" })],
        [filed("1", "long ammo", LOADED, "a")], { selectedListId: "a" })
    );

    // The list card immediately above has all three. That is the combination a loadout card
    // may not repeat, and the distinction may not rest on size, since both grids reflow.
    const listCard = screen.getByTestId("list-card-a");
    expect(listCard.querySelector("img")).toBeInTheDocument();
    expect(listCard).toHaveAttribute("data-accent", "#5a6e96");
    expect(within(listCard).getByText(/^\d+ loadouts?$/)).toBeInTheDocument();

    const card = cardOf("1");
    expect(card.querySelector("img[src^='/images/hunters/']")).toBeNull();
    expect(card).not.toHaveAttribute("data-accent");
    expect(card.style.getPropertyValue("--ll-accent")).toBe("");
    expect(within(card).queryByText(/^\d+ loadouts?$/)).not.toBeInTheDocument();
    // And it is not even the same kind of element: a list card IS a button, a loadout card
    // is an article that contains them.
    expect(listCard.tagName).toBe("BUTTON");
    expect(card.tagName).toBe("ARTICLE");
  });

  it("reflows by count at a phone width, shedding no cell", () => {
    // The grid's only responsive rule is auto-fill against a minimum track, so cards go
    // fewer per row and nothing inside them is dropped. jsdom performs no layout, so what is
    // assertable is that rule plus the invariant it exists to protect — identical cell counts
    // to the wide render above, at a width where the old strip was down to two tiles.
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 360 });
    renderPanel(base([], [filed("1", "long ammo", LOADED)], { unassignedOpen: true }));

    expect(cellsIn("preview-weapons-1")).toHaveLength(WEAPON_CELLS);
    expect(cellsIn("preview-equipment-1")).toHaveLength(EQUIP_CELLS);
    expect(cellsIn("preview-traits-1")).toHaveLength(TRAIT_CELLS);
    expect(drawn("1")).toHaveLength(8);

    expect(ruleFor(".ll-cards")).toMatch(/repeat\(auto-fill, minmax\(var\(--ll-card-min[^)]*\), 1fr\)\)/);
    // Nothing in the card is laid out at a fixed width, so no card overflows horizontally.
    expect(ruleFor(".ll-lcard")).toMatch(/min-width:\s*0/);
    // `min-width` is allowed; a bare `width` is not — a fixed width is how a grid stops
    // reflowing and starts overflowing.
    expect(ruleFor(".ll-cards")).not.toMatch(/(?<![-\w])width:/);
    expect(ruleFor(".ll-lcard")).not.toMatch(/(?<![-\w])width:/);

    // The controls that identify and file a loadout survive the narrowest width.
    expect(screen.getByRole("button", { name: "long ammo" })).toBeInTheDocument();
    expect(screen.getByText("$354")).toBeInTheDocument();
    expect(screen.getByLabelText("List for long ammo")).toBeEnabled();
  });
});
