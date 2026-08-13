import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  descriptionOf,
  previewGroups,
  previewSummary,
  resolveListDescription,
  resolveLoadoutNote,
} from "./LoadoutListsPanel.jsx";
import * as panelModule from "./LoadoutListsPanel.jsx";
import { createTestStore } from "../../test/testStore.js";
import {
  CSS_RULES,
  effective,
  effectiveDeclaration,
  parseStylesheet,
  readGlobalCss,
  resting,
  restingDeclaration,
} from "../../test/cssRules.js";
import { LS_SELECTED_LIST } from "../../store/uiSlice.js";
import { slugify } from "../../utils/slugify.js";
import { FORMAT_VERSION, emptyLoadout, encodeShareUrl, fromData, toData } from "../../utils/loadoutCodec.js";
import { saveCurrent } from "../../store/savedLoadoutsSlice.js";
import { UNASSIGNED } from "../../utils/listOrdering.js";
import { createList } from "../../api/loadouts.js";
import { HUNTERS } from "../../data/hunters.js";
import { CONS, TOOLS, TRAITS } from "../../data/catalog.js";

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

  it("moves focus to the Unassigned list card after a successful retire (issue #131)", async () => {
    // Governing: SPEC-0003 REQ "Focus Management". The Retire trigger lives inside
    // ExpandedList, and the success path deselects the list (unmounting ExpandedList)
    // before closing the dialog — so returnFocus() targets a detached node and focus
    // falls to <body>. The fix focuses the Unassigned list card (always present in the
    // selector, and the control that now holds the retired list's loadouts) before the
    // dialog closes. Asserting the actual activeElement, not a mock.
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    renderPanel(base([list("a", "Alpha")], [loadout("1", "My build", "a")], {
      selectedListId: "a",
      confirmRetireListId: "a",
    }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retire list" }));
    });

    const unassignedCard = screen.getByTestId("list-card-__unassigned__");
    expect(unassignedCard).toBeInTheDocument();
    expect(document.activeElement).toBe(unassignedCard);
    expect(document.activeElement).not.toBe(document.body);
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

// Governing: ADR-0007 (as amended 2026-08-10), SPEC-0004 REQ "Consumption Contract
// Compatibility", SPEC-0003 REQ "Hunter Dataset Consumption Contract"
//
// REWRITTEN, not deleted (#148). This was "portrait sizes across contexts" and asserted the
// card and the expanded header asked for DIFFERENT assets, then that each fell back to the
// other before the placeholder. There is one asset now, so the property worth pinning here
// inverted: the two surfaces must agree, and the ladder must stop at two rungs.
describe("portraits across contexts", () => {
  it("asks for the same single portrait on a card and in the expanded header", () => {
    renderPanel(
      base([list("a", "Rat builds", { hunterId: REAL_HUNTER.id })], [], { selectedListId: "a" })
    );
    const expected = `/images/hunters/${REAL_HUNTER.portrait}.avif`;
    expect(screen.getByTestId("list-art-a").querySelector("img")).toHaveAttribute("src", expected);
    expect(screen.getByTestId("list-expanded-art").querySelector("img")).toHaveAttribute(
      "src",
      expected
    );
  });

  it("goes straight to the placeholder when that portrait fails", () => {
    renderPanel(base([list("a", "Rat builds", { hunterId: REAL_HUNTER.id })], []));
    const art = screen.getByTestId("list-art-a");
    fireEvent.error(art.querySelector("img"));
    // No second request: the size the old middle rung retried no longer exists on disk.
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

  // --- The radiogroup's keyboard model, which was announced and not implemented -----------
  //
  // `role="radiogroup"` over six `<button role="radio">` is a PROMISE: one tab stop, arrows
  // inside it, and "3 of 6" announced instead of six unrelated toggles. Arrow keys come free
  // with `<input type="radio">` and with nothing else, and this widget had no `onKeyDown` and
  // no `tabIndex` at all — so AT announced a radiogroup and the user got six tab stops. Three
  // places said otherwise, two of them written by #135 and one of them the design handoff.
  //
  // Driven with REAL KEY EVENTS rather than by asserting an attribute: the attribute is what
  // was already there and true, and the behaviour is what was missing.

  const swatches = (name) => within(screen.getByRole("radiogroup", { name })).getAllByRole("radio");
  const CREATE_GROUP = "Accent colour for the new list";
  const checkedName = (group) =>
    swatches(group).find((r) => r.getAttribute("aria-checked") === "true")?.getAttribute("aria-label") ?? null;

  it("has exactly one tab stop, and it is the checked swatch", () => {
    renderPanel(base([list("a", "Alpha", { accent: "#8a5e86" })], [], { selectedListId: "a" }));
    const group = swatches(/^Accent colour for/);
    const tabbable = group.filter((r) => r.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName("Plum");
    // Every other swatch is reachable by arrow key and not by Tab. Six native tab stops is
    // what six independent buttons look like, and it put "Create list" seven presses away.
    expect(group.filter((r) => r.tabIndex === -1)).toHaveLength(5);
  });

  it("moves and selects with Left/Right and Up/Down, wrapping at both ends", () => {
    // On the create form, where the value is local state and no request is involved. The
    // palette order is Clay, Olive, Slate, Teal, Plum, Amber, and an empty list seeds Clay.
    renderPanel(base([], [], { creatingList: true }));
    expect(checkedName(CREATE_GROUP)).toBe("Clay");

    const press = (key) => {
      const from = swatches(CREATE_GROUP).find((r) => r.tabIndex === 0);
      fireEvent.keyDown(from, { key });
    };

    press("ArrowRight");
    expect(checkedName(CREATE_GROUP)).toBe("Olive");
    // Focus follows the selection, which is what makes it one widget rather than a group with
    // a cursor of its own.
    expect(document.activeElement).toHaveAccessibleName("Olive");

    press("ArrowDown");
    expect(checkedName(CREATE_GROUP)).toBe("Slate");

    press("ArrowLeft");
    expect(checkedName(CREATE_GROUP)).toBe("Olive");
    press("ArrowUp");
    expect(checkedName(CREATE_GROUP)).toBe("Clay");

    // Wrapping, both directions — a radiogroup is a ring, not a line with two dead ends.
    press("ArrowLeft");
    expect(checkedName(CREATE_GROUP)).toBe("Amber");
    press("ArrowRight");
    expect(checkedName(CREATE_GROUP)).toBe("Clay");
  });

  it("jumps to the ends with Home and End, and selects with Space and Enter", () => {
    renderPanel(base([], [], { creatingList: true }));
    const press = (key) => fireEvent.keyDown(swatches(CREATE_GROUP).find((r) => r.tabIndex === 0), { key });

    press("End");
    expect(checkedName(CREATE_GROUP)).toBe("Amber");
    expect(document.activeElement).toHaveAccessibleName("Amber");

    press("Home");
    expect(checkedName(CREATE_GROUP)).toBe("Clay");

    // Space and Enter select the focused swatch. After a move that is a no-op, which is the
    // point — the one case they matter is the swatch Tab landed on.
    press("Enter");
    expect(checkedName(CREATE_GROUP)).toBe("Clay");
    press(" ");
    expect(checkedName(CREATE_GROUP)).toBe("Clay");
  });

  it("writes the arrow-key choice through the same path a click takes", async () => {
    // The expanded header's picker, where selecting dispatches a PATCH. Arrow keys are not a
    // second, read-only way to move a cursor: moving IS selecting, and it persists.
    global.fetch = vi.fn(async (url, opts) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "a", name: "Alpha", hunterId: null, ...JSON.parse(opts.body) }),
    }));

    const store = renderPanel(base([list("a", "Alpha", { accent: "#b04a3e" })], [], { selectedListId: "a" }));
    const clay = screen.getByRole("radio", { name: "Clay" });
    await act(async () => fireEvent.keyDown(clay, { key: "ArrowRight" }));

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ accent: "#7a8a4e" });
    expect(store.getState().loadoutLists.items[0].accent).toBe("#7a8a4e");
    expect(screen.getByTestId("list-card-a")).toHaveAttribute("data-accent", "#7a8a4e");
  });

  it("stays operable when the stored accent is not in the palette", () => {
    // A record written before the palette was fixed, or by hand. Nothing is checked, which is
    // the truth — `accentVar` degrades it to a neutral border rather than painting an unvetted
    // colour — but the group must not become unreachable on the way. The roving tab stop falls
    // back to the first swatch, and one arrow press resolves the record onto the palette.
    global.fetch = vi.fn(async (url, opts) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "a", name: "Alpha", hunterId: null, ...JSON.parse(opts.body) }),
    }));

    renderPanel(base([list("a", "Alpha", { accent: "#123456" })], [], { selectedListId: "a" }));
    const group = swatches(/^Accent colour for/);
    expect(group.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(0);
    expect(screen.getByTestId("list-card-a").style.getPropertyValue("--ll-accent")).toBe("var(--border)");

    const tabbable = group.filter((r) => r.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName("Clay");
  });

  // --- The swatches themselves: size, and three visible states -----------------------------

  it("gives the swatches a 24px target, the minimum this project cites twice", () => {
    // SC 2.5.8 (AA). `.icon-btn` and `.hp-fav` both record 24px as the floor, and these were
    // 18×18 — with #135 taking the create form from zero targets (the old swatch was
    // decorative and aria-hidden) to six. A swatch carries no content, so the "determined by
    // content" exemption does not apply: its size is a free choice.
    expect(resting(".ll-accent-swatch", "width")).toBe("24px");
    expect(resting(".ll-accent-swatch", "height")).toBe("24px");
    expect(Number.parseFloat(resting(".ll-accent-swatch", "width"))).toBeGreaterThanOrEqual(24);
  });

  it("gives focus its own channel, distinct from both checked and hover (WCAG 2.4.7)", () => {
    // The defect: `-on` set an author `outline`, which REPLACES the UA's :focus-visible ring
    // rather than adding to it, and `:focus-visible` only re-set the `border-color` that `-on`
    // had already set. Focusing the checked swatch produced no pixel change whatsoever — and
    // on first run `previewNextAccent([])` pre-checks Clay, the create form's FIRST swatch, so
    // the very first Tab out of the name field landed on invisible focus.
    const focus = resting(".ll-accent-swatch:focus-visible", "outline");
    expect(focus).toContain("var(--gold-bright)");
    expect(focus).toMatch(/2px/);

    // Only focus owns the outline. Either of the other two states writing it is the bug.
    expect(restingDeclaration(".ll-accent-swatch-on", "outline")).toBeNull();
    expect(restingDeclaration(".ll-accent-swatch:hover", "outline")).toBeNull();
    expect(restingDeclaration(".ll-accent-swatch", "outline")).toBeNull();

    // And focus is not merely re-stating what checked already says: the property it changes
    // must be one `-on` does not set, or the checked swatch shows nothing on focus again.
    const onProperties = new Set(
      CSS_RULES.filter((r) => r.selectors.includes(".ll-accent-swatch-on"))
        .flatMap((r) => [...r.body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map(([, p]) => p))
    );
    const focusProperties = CSS_RULES.filter((r) => r.selectors.includes(".ll-accent-swatch:focus-visible"))
      .flatMap((r) => [...r.body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map(([, p]) => p));
    expect(focusProperties.length).toBeGreaterThan(0);
    for (const property of focusProperties) expect(onProperties).not.toContain(property);
  });

  it("keeps checked and hover apart from each other too", () => {
    // Three states, three readings. Checked is the one that persists, so it gets the ring the
    // other two do not draw.
    expect(resting(".ll-accent-swatch-on", "box-shadow")).toContain("inset");
    expect(resting(".ll-accent-swatch-on", "border-color")).toBe("var(--gold-bright)");
    expect(restingDeclaration(".ll-accent-swatch:hover", "box-shadow")).toBeNull();
    expect(resting(".ll-accent-swatch:hover", "border-color")).toBe("var(--gold-bright)");
  });

  // --- Issue #132: the OPEN card keeps its accent ----------------------------------------

  it("keeps the open card's accent — selection is drawn on its own channel", () => {
    // `.ll-card-open { border-color: var(--gold) }` used to overwrite the accent, so the one
    // card the user was concentrating on was the one card showing no identity. Selection moved
    // to an inset ring; the border still paints the accent.
    renderPanel(base([list("a", "Alpha", { accent: "#5e8a8a" })], [], { selectedListId: "a" }));
    const card = screen.getByTestId("list-card-a");

    expect(card.className).toContain("ll-card-open");
    expect(card).toHaveAttribute("data-accent", "#5e8a8a");
    expect(card.style.getPropertyValue("--ll-accent")).toBe("var(--list-accent-4)");

    // The whole point is an ABSENCE — this rule must declare no border-color at all, because
    // any value it names is a value that replaces the accent.
    expect(restingDeclaration(".ll-card-open", "border-color")).toBeNull();
    expect(restingDeclaration(".ll-card-open", "border")).toBeNull();
    // …and the accent is still what the border reads, on the base rule.
    expect(resting(".ll-card", "border")).toContain("var(--ll-accent");
  });

  it("keeps the accent through hover and focus too, which is a question about the CASCADE", () => {
    // THE HALF THAT WAS MISSING. `.ll-card-open` declaring no border-color settles nothing on
    // its own: `.ll-card:hover, .ll-card:focus-visible { border-color: var(--gold-border) }` is
    // specificity (0,2,0) against `.ll-card`'s (0,1,0), so pointing at the open card — or
    // tabbing to it — painted the accent out and restored #132's exact complaint. The previous
    // test read `.ll-card-open` with `resting()` and could not see that.
    //
    // So this one asks the cascade: across EVERY rule in the sheet that can match a card, what
    // border-color ends up in effect? The answer must be "none declared anywhere", leaving the
    // base rule's `border: 3px solid var(--ll-accent, …)` as the only thing painting the frame.
    expect(effectiveDeclaration(CSS_RULES, ".ll-card", "border-color")).toBeNull();
    expect(effectiveDeclaration(CSS_RULES, ".ll-card", "border")).toContain("var(--ll-accent");

    // And it bites: the rule that used to be there is exactly what it now reports.
    const restored = parseStylesheet(`${readGlobalCss()}\n.ll-card:hover { border-color: var(--gold-border) }`);
    expect(effectiveDeclaration(restored, ".ll-card", "border-color")).toBe("var(--gold-border)");
  });

  it("gives hover, focus and open three channels, none of them the border", () => {
    // Three states that co-occur constantly — a keyboard user tabs onto the card that is open,
    // a mouse user hovers it — so each needs a channel of its own, and none of them may be the
    // channel the accent uses.
    expect(resting(".ll-card:hover", "filter")).toMatch(/brightness/);
    expect(restingDeclaration(".ll-card:hover", "border-color")).toBeNull();
    expect(restingDeclaration(".ll-card:hover", "box-shadow")).toBeNull();

    const focus = resting(".ll-card:focus-visible", "outline");
    expect(focus).toContain("var(--gold)");
    expect(focus).toMatch(/3px/);
    // Outboard of the frame, so it reads as a ring around the card rather than as part of it —
    // which is what keeps it distinct from the open ring drawn inboard.
    expect(resting(".ll-card:focus-visible", "outline-offset")).toBe("2px");
    expect(restingDeclaration(".ll-card:focus-visible", "border-color")).toBeNull();

    // Selection owns neither of the other two properties.
    expect(restingDeclaration(".ll-card-open::after", "outline")).toBeNull();
    expect(restingDeclaration(".ll-card-open::after", "filter")).toBeNull();
  });

  it("distinguishes the open card by drawn weight, not by hue alone — on all four edges", () => {
    // SC 1.4.1. The ring ADDS 3px of edge rather than recolouring 3px of it, so an open card
    // is distinguishable from a closed one whether or not gold and the accent can be told
    // apart — and --gold stays reserved for interactive/selected state, never entering the
    // accent palette or being painted as a frame.
    //
    // "ON ALL FOUR EDGES" is the correction. The ring was `box-shadow: inset`, and an inset
    // shadow paints in its own box's background layer — BELOW every positioned descendant.
    // `.ll-card-plate` is absolutely positioned, pinned to the bottom edge, and carries a
    // 0.95-alpha gradient, so the bottom ~35px of the ring was underneath it: the claim held
    // on three edges and failed on the one the eye goes to, because that is where the name is.
    const ring = resting(".ll-card-open::after", "border");
    expect(ring).toContain("var(--gold)");
    expect(ring).toMatch(/3px/);
    expect(resting(".ll-card-open::after", "inset")).toBe("0");
    expect(resting(".ll-card-open::after", "position")).toBe("absolute");
    // The occluded technique is gone rather than supplemented — two rings would be two
    // answers to "how thick is an open card's frame".
    expect(restingDeclaration(".ll-card-open", "box-shadow")).toBeNull();

    // WHY IT PAINTS ABOVE THE PLATE, as two facts a stylesheet can hold: the ring stacks at 1
    // and the plate does not stack at all. (jsdom lays nothing out, so this is the structural
    // claim, not a measured one — the rendered check is a browser pass.)
    expect(Number.parseInt(resting(".ll-card-open::after", "z-index"), 10)).toBeGreaterThanOrEqual(1);
    expect(restingDeclaration(".ll-card-plate", "z-index")).toBeNull();
    // It is decoration, so it must not eat the card's own clicks.
    expect(resting(".ll-card-open::after", "pointer-events")).toBe("none");

    // No palette value is ever written here — the accent must not start competing with --gold
    // from the other direction either.
    expect(ring).not.toMatch(/--list-accent|#[0-9a-f]{6}/i);
  });

  it("still marks the open card programmatically", () => {
    // The non-visual half of the same fact, and the reason the ring does not have to carry it
    // alone.
    renderPanel(base([list("a", "Alpha"), list("b", "Beta")], [], { selectedListId: "a" }));
    expect(screen.getByTestId("list-card-a")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("list-card-b")).toHaveAttribute("aria-pressed", "false");
  });
});

// ---------------------------------------------------------------------------------------
// Issue #136 — the "Default list for saved loadouts" badge is gone.
//
// Governing: SPEC-0003 REQ "The Selected List Is Client State". The requirement is on the
// BEHAVIOUR ("while a list is selected, a new save SHALL default to filing into that list"),
// never on a label, so removing the badge is spec-legal. What is not acceptable is removing it
// and leaving the behaviour undiscoverable — so the destination moved to the save control, and
// ActionsPanel.test.jsx asserts that half.
// ---------------------------------------------------------------------------------------

describe("the expanded header carries no badge", () => {
  it("shows no 'default list' pill on an expanded list", () => {
    renderPanel(base([list("a", "Alpha")], [], { selectedListId: "a" }));
    const head = screen.getByTestId("list-expanded");
    expect(within(head).queryByText(/default list/i)).not.toBeInTheDocument();
    expect(head.querySelector(".ll-badge")).toBeNull();
  });

  it("shows no 'not filed into any list' pill on Unassigned either", () => {
    // The acceptance criterion is explicit that Unassigned's variant goes under the same
    // decision rather than being left behind as the last badge on screen.
    renderPanel(base([], [loadout("1", "x", null)], { unassignedOpen: true }));
    const head = screen.getByTestId("list-expanded");
    expect(within(head).queryByText(/not filed into any list/i)).not.toBeInTheDocument();
    expect(head.querySelector(".ll-badge")).toBeNull();
  });

  it("leaves no orphaned .ll-badge rule in global.css", () => {
    // Nothing else used it, so the rule goes with the markup. Left behind, it is what the next
    // non-interactive label in this panel reaches for — which is how it got here.
    expect(restingDeclaration(".ll-badge", "border")).toBeNull();
    expect(CSS_RULES.some((rule) => rule.selectors.some((s) => s.includes("ll-badge")))).toBe(false);
  });

  it("has nothing left in the expanded header styled as interactive that is not", () => {
    // The badge's actual defect, stated precisely: --gold-border and --gold-bright are the
    // theme's INTERACTIVE colours (see the palette rationale in :root, and #132), which is why
    // a pill wearing them read as a button. So the rule is about those colours specifically —
    // not about borders, since `.ll-expanded-art` legitimately frames the portrait in a
    // neutral --divider and always did.
    renderPanel(base([list("a", "Alpha")], [], { selectedListId: "a" }));
    const inert = [...screen.getByTestId("list-expanded").querySelectorAll(".ll-expanded-head *")]
      .filter((el) => el.tagName !== "BUTTON" && !el.closest("button") && el.className);

    expect(inert.length).toBeGreaterThan(0);
    for (const el of inert) {
      for (const className of String(el.className).split(" ").filter(Boolean)) {
        for (const property of ["border", "border-color", "color"]) {
          const value = restingDeclaration(`.${className}`, property);
          if (value !== null) expect(value, `.${className} { ${property}: ${value} }`).not.toMatch(/--gold/);
        }
      }
    }
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

});

// ---------------------------------------------------------------------------------------
// Issue #135 — choosing a list's accent before it exists.
//
// Governing: SPEC-0003 REQ "Lists Are Visually Distinguishable Independent of Portrait and
// Name", as widened on 2026-08-10: "the creating user MAY supply an accent, which SHALL be
// validated against the palette and used as given. When the user supplies none, assignment on
// creation SHALL select the least-used palette value among the owner's existing lists."
//
// REPLACES "previews the accent the new list will be assigned", which asserted the inline
// background of an `aria-hidden` span. That span is gone: it showed a colour that looked
// choosable and was not, which is the whole of what this issue was about.
// ---------------------------------------------------------------------------------------

describe("choosing an accent on the create form", () => {
  const openCreateForm = async () => {
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /\+ New list/ })));
    return screen.getByRole("radiogroup", { name: "Accent colour for the new list" });
  };

  const created = (accent) => ({ id: "new", name: "New list", hunterId: null, accent });

  it("offers all six palette values, pre-selected to the least-used one", async () => {
    // "a" holds Clay, so least-used-first lands on Olive — the same answer the server would
    // reach on its own. Doing nothing therefore still produces exactly today's list.
    renderPanel(base([list("a", "Alpha", { accent: "#b04a3e" })], []));
    const group = await openCreateForm();

    const swatches = within(group).getAllByRole("radio");
    expect(swatches.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Clay", "Olive", "Slate", "Teal", "Plum", "Amber",
    ]);
    const checked = swatches.filter((s) => s.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAccessibleName("Olive");
  });

  it("sends the chosen accent on the POST and gives the created list that accent", async () => {
    // The acceptance criterion in full: chosen, sent, and the accent the list HAS — with no
    // second request. A create-then-PATCH would satisfy a weaker reading of "the list has the
    // chosen accent" while leaving a window in which it has the wrong one.
    global.fetch = vi.fn(async (_url, opts) => ({
      ok: true,
      status: 201,
      json: async () => created(JSON.parse(opts.body).accent),
    }));

    const store = renderPanel(base([list("a", "Alpha", { accent: "#b04a3e" })], []));
    const group = await openCreateForm();
    await act(async () => fireEvent.click(within(group).getByRole("radio", { name: "Plum" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create list" })));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(String(url)).toContain("/api/loadout-lists");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body).accent).toBe("#8a5e86");

    // No post-create PATCH: the one request above is the whole of it.
    expect(global.fetch.mock.calls.map(([, o]) => o.method)).toEqual(["POST"]);
    expect(store.getState().loadoutLists.items.find((l) => l.id === "new").accent).toBe("#8a5e86");
    expect(screen.getByTestId("list-card-new")).toHaveAttribute("data-accent", "#8a5e86");
  });

  it("sends the seeded least-used value when the user touches nothing", async () => {
    global.fetch = vi.fn(async (_url, opts) => ({
      ok: true,
      status: 201,
      json: async () => created(JSON.parse(opts.body).accent),
    }));

    renderPanel(base([list("a", "Alpha", { accent: "#b04a3e" })], []));
    await openCreateForm();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create list" })));

    expect(JSON.parse(global.fetch.mock.calls[0][1].body).accent).toBe("#7a8a4e");
  });

  it("omits the key entirely when no accent is supplied, so least-used stays the server's job", async () => {
    // The OTHER branch of the requirement, asserted at the seam that decides it. The panel
    // always sends one, so this is the API wrapper's contract: an absent accent must leave the
    // key off the body rather than send null, because absence is what routes the server to
    // `nextAccent(...)`. The server's own test for that behaviour is what stays green.
    global.fetch = vi.fn(async () => ({ ok: true, status: 201, json: async () => created("#b04a3e") }));

    await createList({ name: "No accent", hunterId: null });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ name: "No accent", hunterId: null });

    await createList({ name: "With one", hunterId: null, accent: "#5e8a8a" });
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
      name: "With one", hunterId: null, accent: "#5e8a8a",
    });
  });

  it("is the SAME picker in both places — one radiogroup, one set of colour names", async () => {
    // The acceptance criterion is "used in both places rather than duplicated", and a second
    // copy is only ever detectable by the two drifting. So: identical swatch names, identical
    // roles, identical keyboard model — and labels that differ in exactly the one way they
    // must, because the create form has no list to name.
    renderPanel(base([list("a", "Alpha", { accent: "#b04a3e" })], [], { selectedListId: "a" }));
    const expanded = screen.getByRole("radiogroup", { name: "Accent colour for Alpha" });
    const create = await openCreateForm();

    const namesIn = (group) =>
      within(group).getAllByRole("radio").map((r) => r.getAttribute("aria-label"));
    expect(namesIn(create)).toEqual(namesIn(expanded));
    // Both are radiogroups of six radios — not a listbox here and a row of toggles there.
    expect(within(create).getAllByRole("radio")).toHaveLength(6);
    expect(within(expanded).getAllByRole("radio")).toHaveLength(6);
    // And each has exactly one value in effect, which is what makes them radiogroups at all.
    for (const group of [create, expanded]) {
      expect(within(group).getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true"))
        .toHaveLength(1);
    }
  });

  it("names itself without a list, since there is no list yet", async () => {
    // The expanded picker names the list it belongs to; that phrasing is unavailable here and
    // "Accent colour for undefined" is the bug this asserts against.
    renderPanel(base([], []));
    const group = await openCreateForm();
    expect(group).toHaveAccessibleName("Accent colour for the new list");
    expect(group.getAttribute("aria-label")).not.toMatch(/undefined|null/);
  });

  it("has no decorative accent swatch left anywhere on the form", async () => {
    // Withdrawn, not merely unused: an `aria-hidden` colour beside a name field is the thing
    // that read as clickable, and left in place it is what a later reader restores.
    renderPanel(base([], []));
    await openCreateForm();
    expect(screen.queryByTestId("create-accent-preview")).not.toBeInTheDocument();
    expect(document.querySelector(".ll-create-accent")).toBeNull();
    expect(restingDeclaration(".ll-create-accent", "width")).toBeNull();
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
// Two spec scenarios used to be deliberately absent here — "Equipment sits in its own cell"
// and "An unresolvable item leaves a hole" — on the grounds that the decoder filtered
// unresolvable ids and packed what survived, so neither was falsifiable and "a test that
// cannot fail is not written". SPEC-0006's sparse model shipped and both premises died with
// it: v2 decodes positionally and returns `null` in place for an id it cannot resolve. Both
// scenarios are now falsifiable, and both are tested below.
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

// ---------------------------------------------------------------------------------------
// Reading the size floors out of the stylesheet.
//
// The parser, the cascade resolver and the exact-selector reader moved to
// ../../test/cssRules.js when the control size scale landed (#134) and needed asserting from
// a suite that is not this component's. Everything about what they do and do not prove — in
// particular why a geometry assertion must go through `resting()` and never `effective()` —
// is documented at the top of that file.
// ---------------------------------------------------------------------------------------

// Spelled out per category, not `expect.any(String)`: the /images/{category}/ segment is the
// only place the tool/consumable split is observable from outside, so pinning it is what
// stops TOOLS/toolThumb being substituted for CONS/consThumb without a test noticing
// (SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback").
const SPARKS = `/images/weapons/${slugify("Sparks")}.jpg`;
const CONVERSION = `/images/weapons/${slugify("Conversion")}.jpg`;
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

// Eighteen traits — three past the grid. A record written before the cap: this used to be an
// ordinary savable loadout, because the trait-point budget is off by default and the server
// accepted forty.
//
// Governing: ADR-0012 (fifteen-trait cap), SPEC-0003 REQ "A Loadout Holds At Most Fifteen Traits"
//
// It is still a valid fixture, and what it now tests is the other half of the decision: an
// over-cap record is not stranded. It loads, decodes to fifteen, and renders — so through the
// panel this payload draws a FULL grid with no remainder, and the next save writes fifteen back.
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
    // Spelled out rather than compared against the constants that set them: `toBe(
    // String(TRAIT_COLUMNS))` holds whatever TRAIT_COLUMNS becomes, and 4 and 5 are the
    // shapes the requirement names.
    expect(previewOf("1").style.getPropertyValue("--ll-equip-cols")).toBe("4");
    expect(previewOf("1").style.getPropertyValue("--ll-trait-cols")).toBe("5");

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

  it("fills fifteen trait cells for an over-cap record, with no remainder left to state", () => {
    // Governing: ADR-0012 (fifteen-trait cap), SPEC-0003 REQ "A Loadout Holds At Most Fifteen Traits"
    //
    // The eighteen-trait record loads rather than erroring — that is the clamp doing its job —
    // and the card never sees the three past the cap, because decode dropped them. So the grid
    // is full and there is no overflow count. The overflow RENDERING is kept as defence and is
    // asserted against previewGroups below, where an over-cap loadout can still be constructed;
    // it is unreachable through a stored record now, which is the point of the cap.
    renderPanel(base([], [filed("1", "everything", OVERSTUFFED)], { unassignedOpen: true }));

    // The grid does not grow, does not scroll and does not clip silently.
    expect(cellsIn("preview-traits-1")).toHaveLength(15);
    expect(filledIn("preview-traits-1")).toHaveLength(15);
    expect(emptyIn("preview-traits-1")).toHaveLength(0);
    expect(previewOf("1")).not.toHaveTextContent("more");
    expect(previewOf("1").querySelector(".ll-lp-more")).toBeNull();

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
    expect(previewOf("1")).toHaveAccessibleName("Holds Sparks, 1 tool, 1 trait");
    expect(screen.getByRole("button", { name: "stale" })).toBeInTheDocument();
  });

  it("carries ONE text equivalent for the whole preview, and marks the imagery decorative", () => {
    renderPanel(base([], [filed("1", "long ammo", LOADED)], { unassignedOpen: true }));

    // ONE announcement, not twenty-five: the whole panel is a single role="img". Weapons are
    // named because a build is identified by them; everything else is a count, because eight
    // tool names in one label is not a summary.
    expect(
      screen.getByRole("img", {
        name: "Holds Sparks, Conversion, 3 tools, 2 consumables, 1 trait",
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

  it("describes what the loadout holds, counting what survived decode", () => {
    renderPanel(base([], [filed("1", "everything", OVERSTUFFED)], { unassignedOpen: true }));

    // The label still states what the LOADOUT holds rather than the grid's capacity — the two
    // simply coincide now, because the eighteen-trait record reaches the card as fifteen
    // (ADR-0012). Announcing eighteen here would describe traits the app has dropped.
    expect(previewOf("1")).toHaveAccessibleName("Holds Sparks, 15 traits");
    expect(filledIn("preview-traits-1")).toHaveLength(15);
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

    // The card's minimum track carries the preview's floor plus every border and padding
    // between the two — including `.item-thumb`'s own 1px, which under `box-sizing:
    // border-box` comes out of the image's content box. Asserted as the arithmetic rather
    // than as 284, because the number is only ever right relative to those parts.
    expect(CARD_MIN_PX).toBe(WEAPON_MIN_DRAWN_PX + 2 * (1 + 12 + 1));

    // The properties reach the DOM carrying the NORMATIVE numbers, spelled out. Comparing
    // them against the constants that set them would be a tautology — it would survive
    // WEAPON_MIN_DRAWN_PX becoming 34, which is the failure this whole requirement exists to
    // prevent. 256px and 48px are what SPEC-0003 pins, so 256px and 48px is what is asserted.
    expect(previewOf("1").style.getPropertyValue("--ll-weapon-min")).toBe("256px");
    expect(previewOf("1").style.getPropertyValue("--ll-cell-min")).toBe("48px");
    expect(previewOf("1").style.getPropertyValue("--ll-preview-gap")).toBe("4px");
    expect(screen.getByTestId("loadout-card-grid").style.getPropertyValue("--ll-card-min")).toBe("284px");

    // …and the stylesheet enforces them by READING those properties. A floor that lives only
    // in a stylesheet is a floor nothing can check, which is exactly how 34x24 shipped.
    //
    // `effective()` resolves what the cascade would apply — see the note above it for what
    // that does and does not prove. It is not a pixel measurement: jsdom does no layout.
    expect(effective(".ll-lp", "min-width")).toMatch(/^min\(var\(--ll-weapon-min[^)]*\),\s*100%\)$/);
    expect(effective(".ll-lp-weapon", "width")).toBe("100%");
    expect(effective(".ll-lp-slot", "min-width")).toMatch(/^min\(var\(--ll-cell-min[^)]*\),\s*100%\)$/);
    // Not capped, deliberately: past the floor a cell grows taller rather than clipping.
    expect(effective(".ll-lp-slot", "min-height")).toMatch(/^var\(--ll-cell-min[^)]*\)$/);
    for (const [selector, cols] of [
      [".ll-lp-equip", "--ll-equip-cols"],
      [".ll-lp-traits", "--ll-trait-cols"],
    ]) {
      const tracks = effective(selector, "grid-template-columns").replace(/\s+/g, " ");
      // A fixed column count, each track floored at the cell minimum…
      expect(tracks).toMatch(new RegExp(`^repeat\\( ?var\\(${cols}[^)]*\\), minmax\\( ?min\\( ?var\\(--ll-cell-min`));
      // …capped at the share of the row a column can have, so five of them come to 100% of a
      // narrow card rather than to 256px inside a 168px one.
      expect(tracks).toMatch(
        new RegExp(
          `calc\\( ?\\(100% - \\(var\\(${cols}[^)]*\\) - 1\\) \\* var\\(--ll-preview-gap[^)]*\\)\\) / var\\(${cols}`
        )
      );
    }
  });

  it("resolves the cascade, so an override of a size floor fails these assertions", () => {
    // The assertion above is the one this PR rests on for the floors, so its ability to FAIL
    // is itself asserted. Each stylesheet below is global.css plus one override of the kind
    // that would silently lower a floor in production; the previous helper — which joined
    // every matching rule body and matched against the lot — stayed green through all three.
    const SHEET = readGlobalCss();
    const floorOf = (css) => effectiveDeclaration(parseStylesheet(css), ".ll-lp", "min-width");

    expect(floorOf(SHEET)).toMatch(/^min\(var\(--ll-weapon-min/);
    // A later rule of equal specificity wins on source order.
    expect(floorOf(`${SHEET}\n.ll-lp { min-width: 0 }`)).toBe("0");
    // A more specific rule wins wherever it sits.
    expect(floorOf(`${SHEET}\n.panel .ll-lp { min-width: 12px }`)).toBe("12px");
    // A rule inside a conditional at-rule is NOT merged into the unconditional bucket, which
    // is what the old `([^{}]+)\{([^{}]*)\}` parse did; it is refused, by name.
    expect(() => floorOf(`${SHEET}\n@media (max-width: 900px) { .ll-lp { min-width: 0 } }`)).toThrow(
      /@media \(max-width: 900px\)/
    );
    // And a rule that cannot match the element does not answer for it.
    expect(floorOf(`${SHEET}\n.ll-lp-slot { min-width: 0 }\n.ll-lp .thing { min-width: 0 }`)).toMatch(
      /^min\(var\(--ll-weapon-min/
    );
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
    // The record decodes through the v1->v2 lift (SPEC-0006 "Version 1 Records Migrate
    // Losslessly"): packed insertion order becomes the cells the items rendered in, so
    // the five items sit in cells 0-4 and cells 5-7 are holes.
    expect(groups.equipment.map((c) => c?.kind)).toEqual([
      "tool", "tool", "consumable", "consumable", "tool", undefined, undefined, undefined,
    ]);
    expect(groups.empty).toBe(false);
    expect(groups.traitOverflow).toBe(0);

    // Governing: ADR-0012 (fifteen-trait cap), SPEC-0003 REQ "Filed Loadouts Preview Their Contents"
    //
    // Built directly rather than decoded, because no decoder produces this shape any more. The
    // overflow arrangement is kept deliberately: enforcement bounds what the app WRITES and the
    // preview renders what it READS, so a record predating the cap, a decoder that regresses, or
    // a payload arriving by some path not yet imagined still reaches here — and a component that
    // trusts an invariant it does not itself enforce is how a bad ammo index blanked the page.
    const over = previewGroups({ ...fromData(OVERSTUFFED), traits: EIGHTEEN_TRAIT_IDS });
    expect(over.traitsHeld).toBe(18);
    expect(over.traitOverflow).toBe(3);
    expect(over.traits.filter(Boolean)).toHaveLength(TRAIT_CELLS);

    const nothing = previewGroups(fromData(v1({})));
    expect(nothing.empty).toBe(true);
    expect(previewSummary(nothing)).toBe(PREVIEW_EMPTY_LABEL);
  });

  // Covers: SPEC-0003 REQ "Filed Loadouts Preview Their Contents", scenario "Equipment sits
  // in its own cell". Falsifiable only since SPEC-0006's sparse model shipped — before it,
  // the decoder packed everything forward and a gap could not be expressed.
  it("draws each item at its stored cell, leaving gaps as empty cells", () => {
    const kit = { t: "T", i: TOOLS.findIndex((t) => t[0] === "first-aid-kit") };
    const groups = previewGroups({
      weapons: [null, null],
      equip: [null, null, kit, null, null, null, null, { t: "C", i: 0 }],
      traits: [],
    });

    // The point of the scenario is the NEGATIVE: nothing packs toward cell 0. An
    // implementation that filtered holes would put the kit in cell 0 and pass a
    // "two items are drawn" assertion, so assert the positions, not the count.
    expect(groups.equipment[2]?.kind).toBe("tool");
    expect(groups.equipment[7]?.kind).toBe("consumable");
    expect(groups.equipment[0]).toBeNull();
    expect(groups.equipment[1]).toBeNull();
    expect(groups.equipment.filter(Boolean)).toHaveLength(2);
    expect(groups.equipment).toHaveLength(EQUIP_CELLS);
  });

  // Covers: SPEC-0003 REQ "Filed Loadouts Preview Their Contents", scenario "An unresolvable
  // item leaves a hole". The v2 decoder returns `null` in place for an id it cannot resolve
  // ("leaves a hole; later cells must not shift" — loadoutCodec.js), so the retired item's
  // cell reaches the preview empty rather than being filtered out upstream.
  it("leaves a retired item's cell empty without shifting later items into it", () => {
    const decoded = fromData({
      v: FORMAT_VERSION,
      w: [null, null],
      e: [["T", "no-such-item-at-all"], null, ["T", TOOLS[0][0]], null, null, null, null, ["C", CONS[0][0]]],
      tr: [],
      n: "",
      b: [],
    });
    // The decoder's half of the contract, asserted before the preview's, because a decoder
    // that packed would make the preview look correct while the cells were already wrong.
    expect(decoded.equip[0]).toBeNull();
    expect(decoded.equip[2]).not.toBeNull();

    const groups = previewGroups(decoded);
    expect(groups.equipment[0]).toBeNull();
    expect(groups.equipment[2]?.kind).toBe("tool");
    expect(groups.equipment[7]?.kind).toBe("consumable");
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
    expect(within(card).getByText("$388")).toBeInTheDocument();
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

  it("reflows by count and sheds no cell, and caps every width floor at the room available", () => {
    // NO VIEWPORT WIDTH IS SET, and none is read. jsdom performs no layout, so this test
    // does not — and cannot — measure a card against a 360px viewport; the version of it
    // that assigned `window.innerWidth = 360` was measuring nothing, since `useViewportWidth`
    // was withdrawn with the shed rule, and it passed while the grid overflowed by ~50px at
    // exactly that width. The pixel widths are verified in a browser instead: at 320/360/375/
    // 390/412 CSS px, against the real containment chain, every element's scrollWidth equals
    // its clientWidth and the document does not scroll horizontally.
    //
    // What IS assertable from here is the SHAPE of the rules that produce that result, and
    // the invariant they exist to protect. Each of the three below fails if the cap is
    // dropped, and each is resolved through the cascade rather than matched anywhere in the
    // file — see `effective()`.
    renderPanel(base([], [filed("1", "long ammo", LOADED)], { unassignedOpen: true }));

    // 1. The grid can reach a single column no wider than the space there is. Without the
    //    `min(..., 100%)` the min sizing function is a fixed 284px, which is a 284px track in
    //    a 194px panel — the overflow this replaced.
    expect(effective(".ll-cards", "grid-template-columns").replace(/\s+/g, " ")).toMatch(
      /^repeat\( ?auto-fill, minmax\( ?min\(var\(--ll-card-min[^)]*\), 100%\), 1fr\)\)$/
    );
    // 2. The preview inside the card is capped the same way, so the card box shrinking is not
    //    all that happens — `.ll-lcard { min-width: 0 }` alone let the contents spill out of it.
    expect(effective(".ll-lcard", "min-width")).toBe("0");
    expect(effective(".ll-lp", "min-width")).toMatch(/100%\)$/);
    // 3. …and so are the cells, which is what makes the spec's degradation reachable: they
    //    scale toward the 48px floor and past it on a phone, rather than pinning the grid at
    //    256px inside a card that is 168px wide.
    expect(effective(".ll-lp-slot", "min-width")).toMatch(/100%\)$/);
    for (const selector of [".ll-lp-equip", ".ll-lp-traits"]) {
      expect(effective(selector, "grid-template-columns")).toMatch(/100%/);
    }
    // A bare `width` is how a grid stops reflowing and starts overflowing; `min-width` is
    // fine. `effective()` returning null is the assertion that nothing declares it at all.
    expect(effectiveDeclaration(CSS_RULES, ".ll-cards", "width")).toBeNull();
    expect(effectiveDeclaration(CSS_RULES, ".ll-lcard", "width")).toBeNull();

    // The invariant the whole responsive rule exists to protect: reflow is BY COUNT. No
    // width, however narrow, drops a cell — the grids keep their shape and the card grows
    // taller, which is why `.ll-lp-slot`'s min-HEIGHT is the one floor left uncapped.
    expect(cellsIn("preview-weapons-1")).toHaveLength(WEAPON_CELLS);
    expect(cellsIn("preview-equipment-1")).toHaveLength(EQUIP_CELLS);
    expect(cellsIn("preview-traits-1")).toHaveLength(TRAIT_CELLS);
    expect(drawn("1")).toHaveLength(8);
    expect(effective(".ll-lp-slot", "min-height")).toMatch(/^var\(--ll-cell-min[^)]*\)$/);

    // And every control that identifies and files a loadout is still there.
    expect(screen.getByRole("button", { name: "long ammo" })).toBeInTheDocument();
    expect(screen.getByText("$388")).toBeInTheDocument();
    expect(screen.getByLabelText("List for long ammo")).toBeEnabled();
  });

  it("gives each loadout card its name as an accessible name", () => {
    // SPEC-0003 makes the loadout's name the accessible identity of its card. An unlabelled
    // <article> is announced as a bare region boundary, so a grid of them is a run of
    // identical stops with the name merely the first focusable thing inside.
    renderPanel(
      base([], [filed("1", "long ammo", LOADED), filed("2", "shotgun rush", LOADED)], {
        unassignedOpen: true,
      })
    );

    expect(screen.getByRole("article", { name: "long ammo" })).toBe(cardOf("1"));
    expect(screen.getByRole("article", { name: "shotgun rush" })).toBe(cardOf("2"));
  });
});

// ---------------------------------------------------------------------------------------
// Governing: ADR-0006 (list filing model), ADR-0007 (dataset carries descriptions),
// SPEC-0003 REQ "Lists Carry an Editable Description", REQ "Loadouts Carry a Description of
// Their Own", REQ "Hunter Dataset Consumption Contract", REQ "The Saved-Loadout Wire Format
// Is Unchanged"
//
// TWO descriptions, and they are tested apart because they are not the same feature.
//
// The LIST's is the one with an inherited default, so the three-state rule lives in that
// suite: null/absent means "never edited, inherit live", "" means "deliberately blank",
// non-empty means the user's words. design.md's risk register names the way they get
// collapsed — a truthy check — so the pair that matters most is "a cleared description stays
// blank" and "an unedited list inherits": `list.description || inherited` passes the second
// and fails the first, and `=== null` instead of `?? null` fails the first while passing the
// second.
//
// The LOADOUT's inherits nothing (#181). Its suite exists mostly to prove the ABSENCE: no
// hunter's text reaches a card, moving a loadout changes nothing about its note, and there is
// no restore control to offer. The editing, focus and bounding behaviour is shared code, and
// is exercised on whichever surface reads more naturally rather than twice over.
// ---------------------------------------------------------------------------------------

// The two hunters SPEC-0003's scenarios name by hand. Found by name rather than by index so
// the fixtures say what the spec says; both are ordinary committed roster entries.
const TURNCOAT = HUNTERS.find((h) => h.name === "The Turncoat");
const RAT = HUNTERS.find((h) => h.name === "The Rat");

// A record whose `description` key is PRESENT. `filed()` and `list()` above produce one with
// the key absent, which is the other half of the "never edited" state and must behave
// identically — every record written before the field existed is in exactly that shape.
const describedAs = (item, description) => ({ ...item, description });

const descOf = (id) => screen.queryByTestId(`loadout-desc-${id}`);
const listDescOf = (id) => screen.queryByTestId(`list-desc-${id}`);
const header = () => screen.getByTestId("list-expanded");
const editControl = (id, name, action = "Edit") =>
  within(cardOf(id)).getByRole("button", { name: `${action} description: ${name}` });
const listEditControl = (name, action = "Edit") =>
  within(header()).getByRole("button", { name: `${action} description: ${name}` });

/**
 * Run `fn` with every `<p>` reporting the given heights.
 *
 * jsdom implements no layout: `clientHeight` and `scrollHeight` are 0 on everything, so the
 * component cannot measure whether its clamped paragraph is hiding anything. Stubbing them
 * on the prototype is what lets both answers be exercised — and is the reason the component
 * treats a zero client height as "nothing measured this" rather than "nothing is hidden".
 */
const withParagraphHeights = (clientHeight, scrollHeight, fn) => {
  const proto = window.HTMLParagraphElement.prototype;
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => clientHeight });
  Object.defineProperty(proto, "scrollHeight", { configurable: true, get: () => scrollHeight });
  try {
    return fn();
  } finally {
    delete proto.clientHeight;
    delete proto.scrollHeight;
  }
};

describe("list descriptions", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => {
      throw new Error("no request may be issued to RENDER a description");
    });
  });

  it("has both hunters the spec's scenarios name", () => {
    // The fixtures below are worthless if these silently resolve to undefined.
    expect(TURNCOAT?.description?.length).toBeGreaterThan(0);
    expect(RAT?.description?.length).toBeGreaterThan(0);
    expect(TURNCOAT.description).not.toBe(RAT.description);
  });

  // --- Inheritance -------------------------------------------------------------------

  it("renders its hunter's description for a list that has never been described", () => {
    const store = renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })], [filed("1", "long ammo", LOADED, "a")], {
        selectedListId: "a",
      })
    );

    expect(listDescOf("a")).toHaveTextContent(TURNCOAT.description);
    // …and NOTHING was written to get it there. The default is resolved at render time, so
    // the stored record still carries no description at all and no request was issued.
    expect(store.getState().loadoutLists.items[0]).not.toHaveProperty("description");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("treats an explicit null exactly as it treats an absent key", () => {
    // Every list record written before this field existed has the key ABSENT, so a `=== null`
    // check would deny inheritance to the entire collection while passing the test above.
    renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: null })],
        [filed("1", "long ammo", LOADED, "a")], { selectedListId: "a" })
    );
    expect(listDescOf("a")).toHaveTextContent(TURNCOAT.description);
  });

  it("says whose description it is, visibly and to assistive tech alike", () => {
    // SPEC-0003 Accessibility: an inherited description MUST NOT be announced as though the
    // user wrote it, and the visual marking settled by #181 — italic and de-emphasised — is
    // presentational only, so the fact is carried in TEXT as well. One plain element does
    // both, rather than styling plus a separate sr-only string that could drift from it.
    renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })], [filed("1", "long ammo", LOADED, "a")], {
        selectedListId: "a",
      })
    );

    const from = screen.getByTestId("list-desc-from-a");
    expect(from).toHaveTextContent(`From ${TURNCOAT.name}`);
    expect(from).not.toHaveAttribute("aria-hidden");
    expect(listDescOf("a")).toHaveAttribute("data-source", "inherited");
  });

  it("marks an inherited description italic and de-emphasised, and a written one neither", () => {
    // The visual half of the same rule (#181). Both states are asserted, because a rule that
    // styled BOTH the same way would satisfy "inherited is italic" on its own while marking
    // nothing at all.
    expect(resting('.ll-desc[data-source="inherited"]', "font-style")).toBe("italic");
    expect(resting('.ll-desc[data-source="inherited"]', "color")).toBe("var(--text-muted)");
    expect(resting(".ll-desc", "color")).toBe("var(--text)");
    expect(resting(".ll-desc", "color")).not.toBe(resting('.ll-desc[data-source="inherited"]', "color"));

    // …and the attribute the rules hang off is really applied, in both directions.
    const lists = [
      list("a", "Turncoat builds", { hunterId: TURNCOAT.id }),
      list("b", "Written", { hunterId: RAT.id, description: "my own words" }),
    ];
    renderPanel(base(lists, [], { selectedListId: "a" }));
    expect(listDescOf("a")).toHaveAttribute("data-source", "inherited");
    cleanup();
    renderPanel(base(lists, [], { selectedListId: "b" }));
    expect(listDescOf("b")).toHaveAttribute("data-source", "own");
  });

  it("renders a user's own description without attributing it to a hunter", () => {
    renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: "my own words" })],
        [filed("1", "long ammo", LOADED, "a")], { selectedListId: "a" })
    );

    expect(listDescOf("a")).toHaveTextContent("my own words");
    expect(listDescOf("a")).toHaveAttribute("data-source", "own");
    expect(screen.queryByTestId("list-desc-from-a")).not.toBeInTheDocument();
    expect(screen.queryByText(TURNCOAT.description)).not.toBeInTheDocument();
  });

  it("renders nothing at all for a deliberately blank description", () => {
    // The state a truthy check destroys. "" is not "never edited": the hunter's lore must not
    // come back, and no empty element may be rendered in its place either.
    renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: "" })],
        [filed("1", "long ammo", LOADED, "a")], { selectedListId: "a" })
    );

    expect(listDescOf("a")).not.toBeInTheDocument();
    expect(screen.queryByText(TURNCOAT.description)).not.toBeInTheDocument();
    expect(screen.queryByTestId("list-desc-from-a")).not.toBeInTheDocument();
    // The list stays fully usable, and both actions are still offered: add one, or go back
    // to inheriting — clearing is explicitly NOT the path back.
    expect(listEditControl("Turncoat builds", "Add")).toBeInTheDocument();
    expect(within(header()).getByLabelText("Use hunter's description: Turncoat builds")).toBeInTheDocument();
  });

  // --- Nothing to inherit from -------------------------------------------------------

  it("renders no description for a list with no hunter to inherit from", () => {
    renderPanel(base([list("a", "No portrait")], [filed("2", "portraitless", LOADED, "a")], { selectedListId: "a" }));

    expect(listDescOf("a")).not.toBeInTheDocument();
    // The list is fully usable: it renders, it holds its loadout, and writing a description
    // is still offered — it just has no default to start from.
    expect(header()).toBeInTheDocument();
    expect(cardOf("2")).toBeInTheDocument();
    expect(listEditControl("No portrait", "Add")).toBeInTheDocument();
    // …and no restore control, because there is nothing stored to restore FROM.
    expect(within(header()).queryByLabelText(/^Use hunter/)).not.toBeInTheDocument();
  });

  it("survives a hunterId that is no longer in the dataset", () => {
    renderPanel(
      base([list("b", "Gone", { hunterId: "left-the-roster" })], [filed("3", "orphan", LOADED, "b")], {
        selectedListId: "b",
      })
    );

    expect(listDescOf("b")).not.toBeInTheDocument();
    // Neither the list nor its loadouts fail: both still render everything else.
    expect(within(cardOf("3")).getByRole("button", { name: "orphan" })).toBeInTheDocument();
    expect(header()).toBeInTheDocument();
  });

  it("offers no description at all on Unassigned", () => {
    // Unassigned is a rendering of the loadouts filed nowhere, not a record — there is no id
    // to write to and no hunter to inherit from, so the block is absent rather than empty.
    renderPanel(base([list("a", "Alpha")], [filed("1", "stray", LOADED)], { unassignedOpen: true }));

    // Scoped to the header's OWN block rather than to the expanded region, which also contains
    // the loadout cards — each of which carries a description control of its own, and should.
    expect(header().querySelector(".ll-expanded-desc")).toBeNull();
    expect(screen.queryByLabelText(/description: Unassigned/)).not.toBeInTheDocument();
    // The cards inside it are untouched, and still offer their own notes.
    expect(within(cardOf("1")).getByRole("button", { name: "stray" })).toBeInTheDocument();
    expect(editControl("1", "stray", "Add")).toBeInTheDocument();
  });

  it("tolerates a dataset entry with an absent or empty description", () => {
    // The rule where it is decided. All four inputs are states SPEC-0003 requires a consumer
    // to survive; the DOM half of the same scenario is the test below.
    expect(descriptionOf({ id: "x", name: "X", description: "lore" })).toBe("lore");
    expect(descriptionOf({ id: "x", name: "X", description: "" })).toBeNull();
    expect(descriptionOf({ id: "x", name: "X" })).toBeNull();
    expect(descriptionOf(null)).toBeNull(); // what hunterFor returns for an unknown id
    expect(descriptionOf(undefined)).toBeNull();
  });

  it("renders nothing for a hunter that EXISTS but offers no description", () => {
    // SPEC-0003 Scenario "A hunter carrying no description yields no default", end to end.
    // The pure-function assertion above cannot reach it: it proves the resolver's answer, not
    // that resolve -> render survives the case, and the two differ in exactly the way that
    // matters — a hunter present in the dataset resolves to a real entry with a real NAME, so
    // an implementation keying the attribution off `hunter !== null` rather than off the text
    // renders an empty description block headed "From The Turncoat".
    //
    // Every committed roster entry carries prose, so the entry is blanked for the duration of
    // this test and restored in a `finally`. Corrupting the committed dataset to create a
    // fixture would be worse: the file is GENERATED by the scrape and a re-run would silently
    // delete the case.
    const entry = HUNTERS.find((h) => h.id === TURNCOAT.id);
    const original = entry.description;
    try {
      entry.description = "";
      renderPanel(
        base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })], [filed("1", "long ammo", LOADED, "a")], {
          selectedListId: "a",
        })
      );

      // No description, and no empty element or placeholder standing in for one.
      expect(listDescOf("a")).not.toBeInTheDocument();
      expect(screen.queryByTestId("list-desc-from-a")).not.toBeInTheDocument();
      expect(within(header()).queryByLabelText(/^More of description/)).not.toBeInTheDocument();

      // Neither the list nor its loadouts fail, and the list stays fully usable — including
      // the offer to write a description, which is the only one it can now have.
      expect(within(cardOf("1")).getByRole("button", { name: "long ammo" })).toBeInTheDocument();
      expect(listEditControl("Turncoat builds", "Add")).toBeInTheDocument();
      // Nothing is STORED, so there is nothing to restore to — the empty dataset entry is a
      // missing default, not a written state.
      expect(within(header()).queryByLabelText(/^Use hunter/)).not.toBeInTheDocument();
    } finally {
      entry.description = original;
    }
  });

  it("resolves the three stored states without collapsing any pair", () => {
    // The rule itself, asserted directly: the DOM tests above can only show two outcomes
    // (text or no text), and "deliberately blank" and "nothing to inherit" look identical
    // from there while differing in what the next write means.
    const withHunter = { id: "a", name: "Turncoat builds", hunterId: TURNCOAT.id };

    expect(resolveListDescription(withHunter)).toEqual({
      text: TURNCOAT.description, inherited: true, hunterName: TURNCOAT.name,
    });
    expect(resolveListDescription({ ...withHunter, description: null })).toEqual({
      text: TURNCOAT.description, inherited: true, hunterName: TURNCOAT.name,
    });
    expect(resolveListDescription({ ...withHunter, description: "" })).toEqual({
      text: null, inherited: false, hunterName: null,
    });
    expect(resolveListDescription({ ...withHunter, description: "mine" })).toEqual({
      text: "mine", inherited: false, hunterName: null,
    });
    // Nothing to inherit, which is NOT the same stored state as "" even though it renders
    // the same: one offers a restore control and the other does not.
    expect(resolveListDescription({ id: "a", name: "No portrait", hunterId: null })).toEqual({
      text: null, inherited: false, hunterName: null,
    });
    expect(resolveListDescription(null)).toEqual({ text: null, inherited: false, hunterName: null });
  });

  // --- Editing ------------------------------------------------------------------------

  it("edits an inherited description into the user's own, and stops inheriting", async () => {
    const sent = [];
    global.fetch = vi.fn(async (url, opts) => {
      sent.push({ url: String(url), method: opts.method, raw: opts.body, body: JSON.parse(opts.body) });
      return {
        ok: true, status: 200,
        json: async () => list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: "my own words" }),
      };
    });

    const store = renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })], [], { selectedListId: "a" })
    );

    await act(async () => fireEvent.click(listEditControl("Turncoat builds")));
    const field = screen.getByLabelText("Description for Turncoat builds");
    // Seeded with the text the user is looking at — the spec's own cap rationale calls the
    // inherited text "the text a user starts from when they edit".
    expect(field.value).toBe(TURNCOAT.description);

    fireEvent.change(field, { target: { value: "my own words" } });
    await act(async () => fireEvent.click(within(header()).getByLabelText("Save description: Turncoat builds")));

    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("PATCH");
    expect(sent[0].url).toMatch(/\/api\/loadout-lists\/a$/);
    expect(sent[0].body.description).toBe("my own words");
    // Describing a list is not a rename, a re-portraiting or a recolour: those keys are
    // absent, so the server leaves all three alone.
    expect(Object.keys(sent[0].body)).toEqual(["description"]);

    expect(store.getState().loadoutLists.items[0].description).toBe("my own words");
    expect(listDescOf("a")).toHaveTextContent("my own words");
    expect(screen.queryByText(TURNCOAT.description)).not.toBeInTheDocument();
  });

  it("clears a description to empty and does not re-inherit", async () => {
    const sent = [];
    global.fetch = vi.fn(async (url, opts) => {
      sent.push({ raw: opts.body, body: JSON.parse(opts.body) });
      return {
        ok: true, status: 200,
        json: async () => list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: "" }),
      };
    });

    const store = renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: "mine" })], [], {
        selectedListId: "a",
      })
    );

    await act(async () => fireEvent.click(listEditControl("Turncoat builds")));
    fireEvent.change(screen.getByLabelText("Description for Turncoat builds"), { target: { value: "" } });
    await act(async () => fireEvent.click(within(header()).getByLabelText("Save description: Turncoat builds")));

    // The empty string reaches the wire AS an empty string. Asserted on the raw body too: a
    // helpful `description || null` between here and fetch would still produce a 200 and a
    // plausible-looking store, and only the bytes show it.
    expect(sent[0].raw).toBe(JSON.stringify({ description: "" }));
    expect(sent[0].body.description).toBe("");

    expect(store.getState().loadoutLists.items[0].description).toBe("");
    expect(listDescOf("a")).not.toBeInTheDocument();
    expect(screen.queryByText(TURNCOAT.description)).not.toBeInTheDocument();
  });

  it("restores inheritance with an explicit null, and shows the hunter's text again", async () => {
    const sent = [];
    global.fetch = vi.fn(async (url, opts) => {
      sent.push({ raw: opts.body, body: JSON.parse(opts.body) });
      return {
        ok: true, status: 200,
        json: async () => list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: null }),
      };
    });

    const store = renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: "mine" })], [], {
        selectedListId: "a",
      })
    );

    await act(async () =>
      fireEvent.click(within(header()).getByLabelText("Use hunter's description: Turncoat builds"))
    );

    // The KEY must survive JSON.stringify — `{ description: undefined }` serialises to `{}`,
    // which changes nothing at all on the server. Byte-for-byte, therefore.
    expect(sent[0].raw).toBe(JSON.stringify({ description: null }));
    expect(store.getState().loadoutLists.items[0].description).toBeNull();
    expect(listDescOf("a")).toHaveTextContent(TURNCOAT.description);
    expect(listDescOf("a")).toHaveAttribute("data-source", "inherited");
  });

  it("re-inherits from the new hunter when an unedited list is re-portraited", () => {
    // The consequence the spec calls out: because the default is resolved and never copied,
    // changing the hunter changes the description with no write to the description at all.
    const store = renderPanel(
      base([list("a", "Builds", { hunterId: TURNCOAT.id })], [], { selectedListId: "a" })
    );
    expect(listDescOf("a")).toHaveTextContent(TURNCOAT.description);

    cleanup();
    const rehunted = store.getState().loadoutLists.items.map((l) => ({ ...l, hunterId: RAT.id }));
    renderPanel(base(rehunted, [], { selectedListId: "a" }));

    expect(listDescOf("a")).toHaveTextContent(RAT.description);
    expect(screen.queryByText(TURNCOAT.description)).not.toBeInTheDocument();
  });

  it("keeps an edited description when the list is re-portraited", () => {
    const lists = [list("a", "Builds", { hunterId: RAT.id, description: "mine, and staying" })];
    renderPanel(base(lists, [], { selectedListId: "a" }));

    expect(listDescOf("a")).toHaveTextContent("mine, and staying");
    expect(screen.queryByText(RAT.description)).not.toBeInTheDocument();
  });

  it("abandons an in-progress edit on Escape, writing nothing", async () => {
    renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: "mine" })], [], {
        selectedListId: "a",
      })
    );

    await act(async () => fireEvent.click(listEditControl("Turncoat builds")));
    const field = screen.getByLabelText("Description for Turncoat builds");
    fireEvent.change(field, { target: { value: "half-written" } });
    await act(async () => fireEvent.keyDown(field, { key: "Escape" }));

    expect(screen.queryByLabelText("Description for Turncoat builds")).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(listDescOf("a")).toHaveTextContent("mine");
  });

  it("is fully keyboard-operable, and does not trap Tab in the field", async () => {
    // SPEC-0003 Accessibility: editing MUST be achievable without a pointer, the control must
    // name both the action and its subject, and "because a description may be long, the editor
    // MUST NOT trap Tab as a text-insertion key".
    renderPanel(base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })], [], { selectedListId: "a" }));

    const trigger = listEditControl("Turncoat builds");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).not.toHaveAttribute("tabindex", "-1");

    await act(async () => fireEvent.click(trigger));
    const field = screen.getByLabelText("Description for Turncoat builds");
    expect(field.tagName).toBe("TEXTAREA");
    expect(document.activeElement).toBe(field);
    // fireEvent returns false when a handler called preventDefault, which is how a field
    // swallows Tab. Nothing here does, so focus leaves for the buttons beside it.
    expect(fireEvent.keyDown(field, { key: "Tab" })).toBe(true);
    for (const label of ["Save description: Turncoat builds", "Cancel editing description: Turncoat builds"]) {
      expect(within(header()).getByLabelText(label).tagName).toBe("BUTTON");
    }
  });

  it("puts the description in the HEADER's tab order, before the cards below it", () => {
    // SPEC-0003 Accessibility, as amended by #181: the description sits in the expanded list
    // header, so a keyboard user must reach it while still in the header — beside rename and
    // accent — rather than after every loadout in the list.
    renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })], [filed("1", "long ammo", LOADED, "a")], {
        selectedListId: "a",
      })
    );

    // Document order IS tab order here: nothing in this panel sets a positive tabindex.
    const stops = [...header().querySelectorAll("button, select, input, textarea")];
    const rename = stops.findIndex((el) => el.textContent.trim() === "rename");
    const describe = stops.indexOf(listEditControl("Turncoat builds"));
    const firstCardStop = stops.findIndex((el) => cardOf("1").contains(el));

    expect(rename).toBeGreaterThanOrEqual(0);
    expect(firstCardStop).toBeGreaterThanOrEqual(0);
    expect(describe).toBeGreaterThan(rename);
    expect(describe).toBeLessThan(firstCardStop);
  });

  it("starts clean when a different list is opened in the same panel", async () => {
    // The expanded panel is ONE component instance reused across lists — it is not keyed, and
    // its rename field already carries an effect to resync for exactly this reason. So the
    // description block's own state (an open editor, a half-typed draft, a revealed
    // paragraph) would otherwise survive the switch, and a save would write one list's words
    // onto another's record.
    const lists = [
      list("a", "Turncoat builds", { hunterId: TURNCOAT.id }),
      list("b", "Rat builds", { hunterId: RAT.id, description: "the rat's own note" }),
    ];
    renderPanel(base(lists, [], { selectedListId: "a" }));

    await act(async () => fireEvent.click(listEditControl("Turncoat builds")));
    fireEvent.change(screen.getByLabelText("Description for Turncoat builds"), {
      target: { value: "half-typed, and meant for A" },
    });

    await act(async () => fireEvent.click(screen.getByTestId("list-card-b")));

    // No editor, and nothing of A's draft anywhere near B.
    expect(screen.queryByLabelText(/^Description for/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("half-typed, and meant for A")).not.toBeInTheDocument();
    expect(listDescOf("b")).toHaveTextContent("the rat's own note");
    expect(global.fetch).not.toHaveBeenCalled();

    // …and the reveal resets too: B's own text is short, so an inherited "revealed" state
    // carried over from A would leave a "less" control over nothing to collapse.
    expect(within(header()).queryByLabelText(/^Less of description/)).not.toBeInTheDocument();
  });

  it("gives every control an accessible name CONTAINING its visible label", async () => {
    // WCAG 2.5.3 Label in Name (Level A). Speech input matches what the user can SEE, so a
    // button reading "more" whose name is "Reveal the whole description" answers to nothing a
    // Voice Control user can say; "click more" simply does nothing. The subject still has to
    // be in there — the same block renders on every card below — so the visible word leads
    // and the name follows.
    //
    // Asserted over every control the block renders, in each of its states, rather than as a
    // list of expected strings: a list of strings is satisfied by renaming the test.
    const check = () => {
      for (const button of within(header()).getAllByRole("button")) {
        const visible = button.textContent.trim();
        const name = button.getAttribute("aria-label") ?? visible;
        if (!visible || button.className !== "ll-desc-btn") continue;
        expect(name.toLowerCase(), `"${visible}" is not in its accessible name "${name}"`).toContain(
          visible.toLowerCase()
        );
        expect(name).toContain("Turncoat builds");
      }
    };

    renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: "mine" })], [], {
        selectedListId: "a",
      })
    );
    // Resting: more / edit / use hunter's.
    check();
    await act(async () =>
      fireEvent.click(within(header()).getByLabelText("More of description: Turncoat builds"))
    );
    // Revealed: less.
    check();
    await act(async () => fireEvent.click(listEditControl("Turncoat builds")));
    // Editing: save / cancel.
    check();
  });

  // --- A no-op save is a no-op, whatever the field was seeded with ---------------------

  it("does not adopt the hunter's text as the user's own on a save that changed nothing", async () => {
    // The field seeds from the RESOLVED text, so "click edit to read the clamped lore, click
    // save" submits a draft equal to the hunter's prose while the stored value is still null.
    // Comparing the draft against `stored` there writes the lore INTO the record — which
    // SPEC-0003 forbids outright ("The system MUST NOT write that text into the record in
    // order to display it") — and quietly severs the list from its hunter: no future re-scrape
    // reaches it and re-portraiting no longer re-inherits. The only visible signal is the
    // "From The Turncoat" attribution disappearing.
    const store = renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })], [], { selectedListId: "a" })
    );

    await act(async () => fireEvent.click(listEditControl("Turncoat builds")));
    expect(screen.getByLabelText("Description for Turncoat builds").value).toBe(TURNCOAT.description);
    await act(async () => fireEvent.click(within(header()).getByLabelText("Save description: Turncoat builds")));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(store.getState().loadoutLists.items[0]).not.toHaveProperty("description");
    // Still inheriting, still attributed, still live.
    expect(listDescOf("a")).toHaveAttribute("data-source", "inherited");
    expect(screen.getByTestId("list-desc-from-a")).toHaveTextContent(`From ${TURNCOAT.name}`);
  });

  it("does not opt a list out of inheriting when 'add description' is saved untouched", async () => {
    // The other half of the same disagreement: with nothing stored and nothing to inherit,
    // the field seeds with "" while `stored` is null, so `draft !== stored` calls an untouched
    // empty field a change and writes `""` — the deliberately-blank state, which never
    // re-inherits. The list would silently stop tracking any hunter it is later given.
    const store = renderPanel(base([list("a", "No portrait")], [], { selectedListId: "a" }));

    await act(async () => fireEvent.click(listEditControl("No portrait", "Add")));
    expect(screen.getByLabelText("Description for No portrait").value).toBe("");
    await act(async () => fireEvent.click(within(header()).getByLabelText("Save description: No portrait")));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(store.getState().loadoutLists.items[0]).not.toHaveProperty("description");
    expect(store.getState().ui.message).toBe("");
    // The restore control is still absent, which is the readable proof that nothing was
    // stored: it is offered whenever anything is.
    expect(within(header()).queryByLabelText(/^Use hunter/)).not.toBeInTheDocument();
  });

  it("still lets a user adopt the inherited text by editing it", async () => {
    // The guard above must not make deliberate adoption impossible — it only requires that
    // the adoption be an act rather than an accident.
    const sent = [];
    global.fetch = vi.fn(async (url, opts) => {
      sent.push(JSON.parse(opts.body));
      return {
        ok: true, status: 200,
        json: async () =>
          list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: `${TURNCOAT.description} — mine now` }),
      };
    });

    renderPanel(base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })], [], { selectedListId: "a" }));

    await act(async () => fireEvent.click(listEditControl("Turncoat builds")));
    fireEvent.change(screen.getByLabelText("Description for Turncoat builds"), {
      target: { value: `${TURNCOAT.description} — mine now` },
    });
    await act(async () => fireEvent.click(within(header()).getByLabelText("Save description: Turncoat builds")));

    expect(sent).toHaveLength(1);
    expect(sent[0].description).toBe(`${TURNCOAT.description} — mine now`);
    expect(listDescOf("a")).toHaveAttribute("data-source", "own");
  });

  // --- A refused write must not destroy the draft --------------------------------------

  it("keeps the editor open with the text intact when the server refuses the description", async () => {
    // There is deliberately no client-side cap — the number lives on the server — so the
    // first a user hears of one is the 400. Closing the editor before the write settles
    // discards the draft from React state, re-renders the old text, and leaves a banner
    // explaining a failure the user can no longer retry. The prose IS the feature.
    const tooLong = "x".repeat(1500);
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "description must be at most 1000 characters" }),
    }));

    const store = renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: "mine" })], [], {
        selectedListId: "a",
      })
    );

    await act(async () => fireEvent.click(listEditControl("Turncoat builds")));
    fireEvent.change(screen.getByLabelText("Description for Turncoat builds"), { target: { value: tooLong } });
    await act(async () => fireEvent.click(within(header()).getByLabelText("Save description: Turncoat builds")));

    const field = screen.getByLabelText("Description for Turncoat builds");
    expect(field).toBeInTheDocument();
    expect(field.value).toBe(tooLong);
    // The failure is announced, and the stored record is untouched, so the retry is a click.
    expect(store.getState().ui.message).toContain("Couldn't update the description");
    expect(store.getState().ui.message).toContain("at most 1000 characters");
    expect(store.getState().loadoutLists.items[0].description).toBe("mine");

    // …and it really is a retry, not a dead editor: a second attempt that succeeds closes it.
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: "short enough" }),
    }));
    fireEvent.change(screen.getByLabelText("Description for Turncoat builds"), {
      target: { value: "short enough" },
    });
    await act(async () => fireEvent.click(within(header()).getByLabelText("Save description: Turncoat builds")));
    expect(screen.queryByLabelText("Description for Turncoat builds")).not.toBeInTheDocument();
    expect(listDescOf("a")).toHaveTextContent("short enough");
  });

  // --- Focus never lands on <body> -----------------------------------------------------
  //
  // Governing: SPEC-0003 Accessibility Requirements ("Focus Management"), WCAG 2.4.3.
  //
  // Each of these four exits unmounts the control that had focus, and React hands focus to
  // `<body>` when that happens — from which a keyboard user must Tab back through the header
  // and the sort select. Nothing in the suite asserted `document.activeElement` before, which
  // is why three rounds of mutation testing could not have caught it: there was no test to
  // kill.

  it("returns focus to the trigger after a save closes the editor", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => list("a", "Builds", { description: "my own words" }),
    }));
    renderPanel(base([list("a", "Builds", { description: "mine" })], [], { selectedListId: "a" }));

    await act(async () => fireEvent.click(listEditControl("Builds")));
    fireEvent.change(screen.getByLabelText("Description for Builds"), { target: { value: "my own words" } });
    await act(async () => fireEvent.click(within(header()).getByLabelText("Save description: Builds")));

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(listEditControl("Builds"));
  });

  it("returns focus to the trigger when Escape abandons the edit", async () => {
    renderPanel(base([list("a", "Builds", { description: "mine" })], [], { selectedListId: "a" }));

    await act(async () => fireEvent.click(listEditControl("Builds")));
    const field = screen.getByLabelText("Description for Builds");
    fireEvent.change(field, { target: { value: "half-written" } });
    await act(async () => fireEvent.keyDown(field, { key: "Escape" }));

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(listEditControl("Builds"));
  });

  it("returns focus to the trigger when cancel closes the editor", async () => {
    renderPanel(base([list("a", "Builds", { description: "mine" })], [], { selectedListId: "a" }));

    await act(async () => fireEvent.click(listEditControl("Builds")));
    await act(async () => fireEvent.click(within(header()).getByLabelText("Cancel editing description: Builds")));

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(listEditControl("Builds"));
  });

  it("returns focus to a surviving control when 'use hunter's' unmounts itself", async () => {
    // The restore control is offered only while something is stored, so a successful restore
    // removes the very button that was clicked. The trigger beside it survives and owns the
    // result — the description is now the hunter's again, and editing is what you do next.
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: null }),
    }));
    renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: "mine" })], [], {
        selectedListId: "a",
      })
    );

    const restore = within(header()).getByLabelText("Use hunter's description: Turncoat builds");
    restore.focus();
    await act(async () => fireEvent.click(restore));

    expect(within(header()).queryByLabelText(/^Use hunter/)).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(listEditControl("Turncoat builds"));
  });

  // --- Placement, bounded height, and the reveal -----------------------------------------

  it("renders in the expanded header and never on the list card in the selector", () => {
    // SPEC-0003, as settled by #181. The card is a compact scanning target — portrait, name,
    // count — and a paragraph of lore on each one would swamp the grid it exists to let you
    // scan. Asserted for a described list AND an inheriting one, since either could leak.
    const lists = [
      list("a", "Turncoat builds", { hunterId: TURNCOAT.id }),
      list("b", "Written", { hunterId: RAT.id, description: "my own words" }),
    ];
    renderPanel(base(lists, [], { selectedListId: "a" }));

    expect(header().querySelector(".ll-expanded-desc")).toContainElement(listDescOf("a"));
    for (const id of ["a", "b"]) {
      const card = screen.getByTestId(`list-card-${id}`);
      expect(card.querySelector(".ll-desc-wrap")).toBeNull();
      expect(card).not.toHaveTextContent(TURNCOAT.description);
      expect(card).not.toHaveTextContent("my own words");
    }
  });

  it("bounds the rendered description and offers a control that reveals the rest", async () => {
    // SPEC-0003: bounded in height with an affordance to reveal the rest. Hunter lore runs to
    // several hundred characters — 404 at the roster's longest — so unclamped it would push
    // the card grid below it off the screen.
    renderPanel(base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })], [], { selectedListId: "a" }));

    expect(listDescOf("a")).toHaveClass("ll-desc-clamped");
    const reveal = within(header()).getByLabelText("More of description: Turncoat builds");
    expect(reveal).toHaveAttribute("aria-expanded", "false");
    // `aria-expanded` has to say what it expands. Without `aria-controls` a screen reader
    // announces a state with no target, and the paragraph it governs is a sibling rather
    // than a child, so nothing implies the relationship structurally.
    expect(reveal).toHaveAttribute("aria-controls", listDescOf("a").id);
    expect(listDescOf("a").id).toBeTruthy();

    await act(async () => fireEvent.click(reveal));
    expect(listDescOf("a")).not.toHaveClass("ll-desc-clamped");
    expect(within(header()).getByLabelText("Less of description: Turncoat builds")).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    // The clamp is what bounds it, and it is a real rule in the stylesheet rather than a
    // class name nothing acts on. `effective()` resolves it through the cascade.
    expect(effective(".ll-desc-clamped", "overflow")).toBe("hidden");
    expect(effective(".ll-desc-clamped", "-webkit-line-clamp")).toBe("3");
  });

  it("offers the reveal only when text is actually hidden, measured rather than assumed", () => {
    // An always-on control reports `aria-expanded="false"` over fully visible text, which
    // tells a screen-reader user there is more to read when there is not — and does nothing
    // at all when clicked. So the answer is measured off the clamped paragraph.
    //
    // jsdom implements no layout, so the heights are stubbed on the prototype: that is the
    // whole reason the component's initial state is `true` and a zero client height is
    // treated as "not measured" rather than as "nothing hidden".
    const fixture = base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })], [], { selectedListId: "a" });

    withParagraphHeights(57, 240, () => renderPanel(fixture));
    expect(within(header()).queryByLabelText("More of description: Turncoat builds")).toBeInTheDocument();

    cleanup();
    withParagraphHeights(57, 57, () => renderPanel(fixture));
    // Three lines of prose that fit in three lines of box: nothing is hidden, so there is
    // nothing to reveal and no control claiming otherwise.
    expect(within(header()).queryByLabelText("More of description: Turncoat builds")).not.toBeInTheDocument();
    // …and the text and the edit control are untouched by the measurement.
    expect(listDescOf("a")).toHaveTextContent(TURNCOAT.description);
    expect(listEditControl("Turncoat builds")).toBeInTheDocument();
  });

  it("bounds the REVEALED state too, and makes it reachable by keyboard while it scrolls", () => {
    expect(effective(".ll-desc-open", "max-height")).toBeTruthy();
    expect(effective(".ll-desc-open", "overflow-y")).toBe("auto");
    // And the class is really applied, rather than being a rule nothing wears.
    renderPanel(base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })], [], { selectedListId: "a" }));
    expect(listDescOf("a")).not.toHaveAttribute("tabindex");
    fireEvent.click(within(header()).getByLabelText("More of description: Turncoat builds"));
    expect(listDescOf("a")).toHaveClass("ll-desc-open");
    // A bounded scroll container that cannot take focus cannot be scrolled by keyboard in
    // Chrome (WCAG 2.1.1) — so it is a tab stop exactly while it is one, and not before.
    expect(listDescOf("a")).toHaveAttribute("tabindex", "0");
  });

  it("clears WCAG AA contrast for the description, the inherited variant and the controls", () => {
    // SPEC-0003 makes WCAG 2.1 AA mandatory. All three are 13px/400 — body text, so SC 1.4.3
    // asks 4.5:1, not the 3:1 large-text allowance. #181 added the de-emphasised variant, and
    // "greyed" is licence to lower the EMPHASIS, never the contrast: --text-dim would read as
    // the same design intent and fails at 4.09:1 on the card's --panel.
    //
    // Measured against BOTH surfaces the block now renders on. The expanded header is
    // --scroll-track and the loadout card is --panel; passing on one proves nothing about the
    // other, and --panel is the lighter (so tighter) of the two.
    const colors = {
      "--panel": "#1a1510", "--scroll-track": "#17130c",
      "--text": "#e6d9ba", "--text-dim": "#857659", "--text-muted": "#a3936f", "--gold": "#c4a05e",
    };
    const contrast = (a, b) => {
      const lum = (hex) => {
        const channels = [1, 3, 5]
          .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
          .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const [x, y] = [lum(a), lum(b)];
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    // The token these rules must NOT be using, asserted so the threshold below is not vacuous.
    expect(contrast(colors["--text-dim"], colors["--panel"])).toBeLessThan(4.5);

    // `.ll-desc-from` is in the loop, not exempt from it. It is 12px — still body text under
    // SC 1.4.3, which grants the 3:1 allowance only from 18.66px bold or 24px — and it is part of
    // the same de-emphasised inherited treatment, on both of the surfaces above. Covering three of
    // the four rules in this block left the requirement's "every surface" clause proven for the
    // prose but not for the label naming its source. (Review of #181.)
    for (const selector of [
      ".ll-desc",
      '.ll-desc[data-source="inherited"]',
      ".ll-desc-btn",
      ".ll-desc-from",
    ]) {
      const token = resting(selector, "color").replace(/var\(|\)/g, "").trim();
      expect(colors[token], `${selector} uses an unmeasured token ${token}`).toBeTruthy();
      for (const surface of ["--panel", "--scroll-track"]) {
        expect(
          contrast(colors[token], colors[surface]),
          `${selector} on ${surface}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("gives the controls a resting affordance that is not the prose beside them", () => {
    // An inherited description renders as italic 13px prose and these controls sit inline with
    // it. In the same italic, the same size and the same colour they were byte-identical to it
    // in presentation — at 320px the wrap puts "more edit" on the line below the lore, where
    // it reads as a trailing clause of the sentence rather than as two buttons. The distinction
    // must survive with colour removed (SC 1.4.1), so the underline is the load-bearing half.
    expect(resting(".ll-desc-btn", "text-decoration")).toContain("underline");
    expect(resting(".ll-desc-btn", "font-style")).toBe("normal");
    expect(resting(".ll-desc-btn", "color")).not.toBe(resting(".ll-desc", "color"));
    // A keyboard user has to be able to see which one they are on, too.
    expect(resting(".ll-desc-btn:focus-visible", "outline")).toBeTruthy();
  });

  // WHAT THIS FILE CANNOT PROVE, stated so a green suite is not mistaken for evidence of it.
  //
  // jsdom lays nothing out: every element reports clientHeight === 0. The reveal control is gated
  // on a measured `scrollHeight > clientHeight`, and the effect deliberately bails when
  // clientHeight is 0 — so in EVERY test here the `clamped` state is its initial `true`, and the
  // control is present because it was never measured, not because measurement found hidden text.
  // The assertions below check CSS declarations, not rendered geometry.
  //
  // So SPEC-0003's "bounded in height ... MUST NOT cause its container to overflow at any width"
  // rests on the manual browser pass recorded in the PR body, not on CI. A future change to the
  // header's flex context would not be caught here. (Review of #181.)
  it("cannot overflow, whatever prose it is given", () => {
    renderPanel(base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })], [], { selectedListId: "a" }));

    // Prose wraps, and so does a single unbroken 300-character token — the rule that keeps
    // "nothing overflows horizontally at any supported width" true of CONTENT, not just of
    // boxes. And nothing here declares a fixed width, which is how a flex child stops
    // reflowing and starts overflowing.
    expect(effective(".ll-desc", "overflow-wrap")).toBe("anywhere");
    expect(effective(".ll-desc", "min-width")).toBe("0");
    for (const selector of [".ll-desc", ".ll-desc-wrap", ".ll-desc-clamped"]) {
      expect(effectiveDeclaration(CSS_RULES, selector, "width")).toBeNull();
    }
  });

  it("renders both untrusted texts as text, never as markup", () => {
    // Both a user-supplied description and one resolved from the dataset are untrusted on
    // output; the scraped text is the LESS trustworthy of the two, since it originates
    // off-origin. Neither may be inserted as markup.
    const markup = "<img src=x onerror=alert(1)>bold</b>";
    renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id, description: markup })], [], {
        selectedListId: "a",
      })
    );

    const rendered = listDescOf("a");
    expect(rendered).toHaveTextContent(markup);
    expect(rendered.querySelector("img")).toBeNull();
    expect(rendered.innerHTML).not.toContain("<img");
    expect(rendered.children).toHaveLength(0);

    // …and it is not carried on an ATTRIBUTE either. `innerHTML` and `children` only see the
    // element's content, so a well-meant `title={text}` — the obvious way to make a clamped
    // description readable on hover — passes both while putting the untrusted string
    // somewhere it is never rendered as a text node. Checked across the whole block, since
    // the attribution span and the controls interpolate the same values.
    for (const el of [...header().querySelectorAll(".ll-desc-wrap, .ll-desc-wrap *")]) {
      for (const attr of el.attributes) {
        expect(attr.value, `${el.tagName}[${attr.name}] carries the raw description`).not.toContain("onerror");
      }
    }
  });
});

describe("loadout notes", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => {
      throw new Error("no request may be issued to RENDER a note");
    });
  });

  // --- It inherits NOTHING -------------------------------------------------------------

  it("renders no description for a loadout that has none, whatever its list says", () => {
    // The correction #181 makes. A loadout has no hunter of its own; reaching through its list
    // for one put the same paragraph of lore under every card filed there and left a note
    // about a specific build with nowhere of its own to live.
    renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })], [filed("1", "long ammo", LOADED, "a")], {
        selectedListId: "a",
      })
    );

    expect(descOf("1")).not.toBeInTheDocument();
    expect(within(cardOf("1")).queryByTestId("loadout-desc-from-1")).not.toBeInTheDocument();
    // The lore is on screen ONCE, in the header, rather than once per card.
    expect(screen.getAllByText(TURNCOAT.description)).toHaveLength(1);
    expect(listDescOf("a")).toHaveTextContent(TURNCOAT.description);
    // Writing one is still offered, and it is the only description this loadout can have.
    expect(editControl("1", "long ammo", "Add")).toBeInTheDocument();
  });

  it("offers no way back to an inherited state, because there is none", () => {
    // No restore control on a loadout, in EITHER stored state. "Use hunter's" would have
    // nothing to resolve, and a loadout whose note is cleared simply has no note.
    renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })],
        [describedAs(filed("1", "long ammo", LOADED, "a"), "mine"),
         describedAs(filed("2", "shotgun rush", LOADED, "a"), "")], { selectedListId: "a" })
    );

    for (const id of ["1", "2"]) {
      expect(within(cardOf(id)).queryByLabelText(/^Use hunter/)).not.toBeInTheDocument();
    }
    expect(descOf("1")).toHaveTextContent("mine");
    // "" renders as nothing, exactly as an absent key does — one state, not two.
    expect(descOf("2")).not.toBeInTheDocument();
    expect(screen.queryByText(TURNCOAT.description)).toBe(listDescOf("a"));
  });

  it("resolves a note without consulting a hunter at all", () => {
    // The rule itself. `resolveLoadoutNote` takes ONE argument: there is no list to pass and
    // therefore no path back to a hunter, which is what makes the absence structural rather
    // than a branch someone can re-add by accident.
    expect(resolveLoadoutNote({ id: "1" })).toEqual({ text: null, inherited: false, hunterName: null });
    expect(resolveLoadoutNote({ id: "1", description: null })).toEqual({
      text: null, inherited: false, hunterName: null,
    });
    expect(resolveLoadoutNote({ id: "1", description: "" })).toEqual({
      text: null, inherited: false, hunterName: null,
    });
    expect(resolveLoadoutNote({ id: "1", description: "mine" })).toEqual({
      text: "mine", inherited: false, hunterName: null,
    });
    expect(resolveLoadoutNote(null)).toEqual({ text: null, inherited: false, hunterName: null });
  });

  it("renders a note the same in a list, in Unassigned, and with a dangling listId", () => {
    // Filing is now irrelevant to what a card's description says, so the three cases that used
    // to differ are one case. The dangling `listId` in particular can no longer throw: there
    // is nothing for the card to look up.
    renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })],
        [describedAs(filed("1", "unassigned build", LOADED), "mine"),
         describedAs(filed("2", "stray", LOADED, "deleted-list"), "mine")], { unassignedOpen: true })
    );

    for (const id of ["1", "2"]) {
      expect(descOf(id)).toHaveTextContent("mine");
      expect(descOf(id)).toHaveAttribute("data-source", "own");
    }
  });

  // --- Writing one ----------------------------------------------------------------------

  it("writes a note, sending only the description key", async () => {
    const sent = [];
    global.fetch = vi.fn(async (url, opts) => {
      sent.push({ url: String(url), method: opts.method, raw: opts.body, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => describedAs(filed("1", "long ammo", LOADED, "a"), "my own words") };
    });

    const store = renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })], [filed("1", "long ammo", LOADED, "a")], {
        selectedListId: "a",
      })
    );

    await act(async () => fireEvent.click(editControl("1", "long ammo", "Add")));
    // Seeded EMPTY: there is no default to start from, so the editor opens on a blank field
    // rather than on prose the user would have to delete.
    const field = screen.getByLabelText("Description for long ammo");
    expect(field.value).toBe("");

    fireEvent.change(field, { target: { value: "my own words" } });
    await act(async () => fireEvent.click(within(cardOf("1")).getByLabelText("Save description: long ammo")));

    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("PATCH");
    expect(sent[0].url).toMatch(/\/api\/loadouts\/1$/);
    expect(sent[0].body.description).toBe("my own words");
    // A description write is not a move: the key is absent, so filing is left alone.
    expect("listId" in sent[0].body).toBe(false);

    expect(store.getState().savedLoadouts.items[0].description).toBe("my own words");
    expect(descOf("1")).toHaveTextContent("my own words");
  });

  it("clears a note to empty, sending the empty string as itself", async () => {
    const sent = [];
    global.fetch = vi.fn(async (url, opts) => {
      sent.push({ raw: opts.body, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => describedAs(filed("1", "long ammo", LOADED, "a"), "") };
    });

    const store = renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })],
        [describedAs(filed("1", "long ammo", LOADED, "a"), "mine")], { selectedListId: "a" })
    );

    await act(async () => fireEvent.click(editControl("1", "long ammo")));
    fireEvent.change(screen.getByLabelText("Description for long ammo"), { target: { value: "" } });
    await act(async () => fireEvent.click(within(cardOf("1")).getByLabelText("Save description: long ammo")));

    // Asserted on the raw body: a helpful `description || null` between here and fetch would
    // still produce a 200 and a plausible-looking store, and only the bytes show it.
    expect(sent[0].raw).toBe(JSON.stringify({ description: "" }));
    expect(store.getState().savedLoadouts.items[0].description).toBe("");
    expect(descOf("1")).not.toBeInTheDocument();
    // …and no hunter's lore rushes in to fill the gap.
    expect(within(cardOf("1")).queryByText(TURNCOAT.description)).not.toBeInTheDocument();
  });

  it("cancels without writing, leaving the stored text as it was", async () => {
    renderPanel(base([], [describedAs(filed("1", "long ammo", LOADED), "mine")], { unassignedOpen: true }));

    await act(async () => fireEvent.click(editControl("1", "long ammo")));
    fireEvent.change(screen.getByLabelText("Description for long ammo"), { target: { value: "discarded" } });
    await act(async () =>
      fireEvent.click(within(cardOf("1")).getByLabelText("Cancel editing description: long ammo"))
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(descOf("1")).toHaveTextContent("mine");
  });

  it("does not write when the text was not changed", async () => {
    renderPanel(base([], [describedAs(filed("1", "long ammo", LOADED), "mine")], { unassignedOpen: true }));

    await act(async () => fireEvent.click(editControl("1", "long ammo")));
    await act(async () => fireEvent.click(within(cardOf("1")).getByLabelText("Save description: long ammo")));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("writes nothing when 'add description' is saved untouched", async () => {
    const store = renderPanel(base([], [filed("1", "unassigned build", LOADED)], { unassignedOpen: true }));

    await act(async () => fireEvent.click(editControl("1", "unassigned build", "Add")));
    expect(screen.getByLabelText("Description for unassigned build").value).toBe("");
    await act(async () =>
      fireEvent.click(within(cardOf("1")).getByLabelText("Save description: unassigned build"))
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(store.getState().savedLoadouts.items[0]).not.toHaveProperty("description");
    expect(store.getState().ui.message).toBe("");
  });

  it("returns focus to the trigger after a save closes the editor", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => describedAs(filed("1", "long ammo", LOADED), "my own words"),
    }));
    renderPanel(base([], [describedAs(filed("1", "long ammo", LOADED), "mine")], { unassignedOpen: true }));

    await act(async () => fireEvent.click(editControl("1", "long ammo")));
    fireEvent.change(screen.getByLabelText("Description for long ammo"), { target: { value: "my own words" } });
    await act(async () => fireEvent.click(within(cardOf("1")).getByLabelText("Save description: long ammo")));

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(editControl("1", "long ammo"));
  });

  it("keeps the editor open with the text intact when the server refuses the note", async () => {
    const tooLong = "x".repeat(1500);
    global.fetch = vi.fn(async () => ({
      ok: false, status: 400,
      json: async () => ({ error: "description must be at most 1000 characters" }),
    }));

    const store = renderPanel(
      base([], [describedAs(filed("1", "long ammo", LOADED), "mine")], { unassignedOpen: true })
    );

    await act(async () => fireEvent.click(editControl("1", "long ammo")));
    fireEvent.change(screen.getByLabelText("Description for long ammo"), { target: { value: tooLong } });
    await act(async () => fireEvent.click(within(cardOf("1")).getByLabelText("Save description: long ammo")));

    const field = screen.getByLabelText("Description for long ammo");
    expect(field.value).toBe(tooLong);
    expect(store.getState().ui.message).toContain("Couldn't save the description");
    expect(store.getState().savedLoadouts.items[0].description).toBe("mine");
  });

  // --- Moving --------------------------------------------------------------------------

  it("leaves a note untouched by a move, in both directions", async () => {
    const sent = [];
    global.fetch = vi.fn(async (url, opts) => {
      sent.push({ raw: opts.body, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => describedAs(filed("1", "long ammo", LOADED, "b"), "my own words") };
    });

    const lists = [list("a", "Turncoat builds", { hunterId: TURNCOAT.id }), list("b", "Rat builds", { hunterId: RAT.id })];
    const store = renderPanel(
      base(lists, [describedAs(filed("1", "long ammo", LOADED, "a"), "my own words")], { selectedListId: "a" })
    );

    await act(async () =>
      fireEvent.change(within(cardOf("1")).getByLabelText("List for long ammo"), { target: { value: "b" } })
    );

    // A move says nothing about the description, so the key is absent — an omitted key is not
    // a reset, and this is the client half of that rule.
    expect(sent[0].raw).toBe(JSON.stringify({ listId: "b" }));
    expect("description" in sent[0].body).toBe(false);
    expect(store.getState().savedLoadouts.items[0].description).toBe("my own words");

    // …and it reads the same in its new home. Nothing about the destination's hunter reaches
    // the card, which is the whole difference #181 makes: a moved loadout keeps its own words
    // and picks up no lore at either end.
    cleanup();
    renderPanel(base(lists, store.getState().savedLoadouts.items, { selectedListId: "b" }));
    expect(descOf("1")).toHaveTextContent("my own words");
    expect(within(cardOf("1")).queryByText(RAT.description)).not.toBeInTheDocument();
    expect(within(cardOf("1")).queryByText(TURNCOAT.description)).not.toBeInTheDocument();
  });

  // --- The wire format is unchanged ------------------------------------------------------

  it("keeps the description out of the share URL and the local draft", () => {
    // REQ "The Saved-Loadout Wire Format Is Unchanged": `description` is a property of the
    // user's filing, not of the loadout. A recipient opening a share URL receives the build,
    // not the sender's notes about it.
    const plain = filed("1", "long ammo", LOADED, "a");
    const annotated = describedAs({ ...plain, listId: "b" }, "a note that must not travel");

    const urlPlain = encodeShareUrl(fromData(plain.data));
    const urlAnnotated = encodeShareUrl(fromData(annotated.data));

    expect(urlAnnotated).toBe(urlPlain); // byte-identical
    expect(urlAnnotated).not.toContain("note");
    expect(atob(urlAnnotated.split("#L=")[1])).not.toMatch(/description|listId/);

    // And the encoder drops both fields even when they are handed to it ON the loadout
    // model, which is the shape a future "share what I'm looking at" path would produce.
    // Without this the assertion above only proves that `fromData` never invented them.
    const carrying = { ...fromData(annotated.data), description: annotated.description, listId: "b" };
    expect(encodeShareUrl(carrying)).toBe(urlPlain);
    expect(JSON.stringify(toData(carrying))).not.toContain("note");

    // The same for the encoder every local draft goes through.
    const encoded = toData(fromData(annotated.data));
    expect(Object.keys(encoded)).not.toContain("description");
    expect(Object.keys(encoded)).not.toContain("listId");
    expect(JSON.stringify(encoded)).not.toContain("note");
  });

  it("keeps the LIST's description out of the share URL too", () => {
    // REQ "The Saved-Loadout Wire Format Is Unchanged", scenario "Neither description reaches a
    // share URL". Since #181 split the requirement there are two descriptions, and the case the
    // split newly creates is a loadout filed into a DESCRIBED list: the list's text is filing
    // state one level further out, so it must not travel either — including the inherited case,
    // where the text the user sees was never written to any record they own.
    const inDescribedList = filed("1", "long ammo", LOADED, "described-list");
    const bare = filed("1", "long ammo", LOADED, null);

    // Byte-identical to the same build with no description anywhere, list or loadout.
    expect(encodeShareUrl(fromData(inDescribedList.data))).toBe(encodeShareUrl(fromData(bare.data)));

    // And the list record's own text cannot reach the encoder: it is not on the loadout model at
    // all, so even handing the encoder a loadout carrying every filing field drops all of them.
    const carrying = {
      ...fromData(inDescribedList.data),
      listId: "described-list",
      description: "the loadout's note",
      listDescription: "the shelf's own words",
    };
    const url = encodeShareUrl(carrying);
    expect(url).toBe(encodeShareUrl(fromData(bare.data)));
    expect(atob(url.split("#L=")[1])).not.toMatch(/description|listId|shelf/);
    expect(JSON.stringify(toData(carrying))).not.toMatch(/shelf|note|described-list/);
  });

  // --- Bounded height, and the preview it must not displace -------------------------------

  it("bounds a long note and offers the reveal, exactly as the list's does", async () => {
    const longNote = "x ".repeat(400);
    renderPanel(
      base([], [describedAs(filed("1", "long ammo", LOADED), longNote)], { unassignedOpen: true })
    );

    expect(descOf("1")).toHaveClass("ll-desc-clamped");
    const reveal = within(cardOf("1")).getByLabelText("More of description: long ammo");
    expect(reveal).toHaveAttribute("aria-controls", descOf("1").id);
    await act(async () => fireEvent.click(reveal));
    expect(descOf("1")).toHaveClass("ll-desc-open");
    expect(descOf("1")).toHaveAttribute("tabindex", "0");
  });

  it("cannot overflow its card, and does not displace the preview", () => {
    renderPanel(
      base([list("a", "Turncoat builds", { hunterId: TURNCOAT.id })],
        [describedAs(filed("1", "long ammo", LOADED, "a"), "my own words")], { selectedListId: "a" })
    );

    // The description is a SIBLING of the preview, before it — so however long it runs, the
    // preview keeps its category structure and its cell counts (#171's guarantee).
    const card = cardOf("1");
    const order = [...card.children].map((el) => el.className);
    expect(order.indexOf("ll-desc-wrap")).toBeLessThan(order.findIndex((c) => c.startsWith("ll-lp")));
    expect(descOf("1").closest(".ll-lp")).toBeNull();
    expect(cellsIn("preview-weapons-1")).toHaveLength(WEAPON_CELLS);
    expect(cellsIn("preview-equipment-1")).toHaveLength(EQUIP_CELLS);
    expect(cellsIn("preview-traits-1")).toHaveLength(TRAIT_CELLS);
  });

  it("renders an untrusted note as text, never as markup", () => {
    const markup = "<img src=x onerror=alert(1)>bold</b>";
    renderPanel(
      base([], [describedAs(filed("1", "long ammo", LOADED), markup)], { unassignedOpen: true })
    );

    const rendered = descOf("1");
    expect(rendered).toHaveTextContent(markup);
    expect(rendered.querySelector("img")).toBeNull();
    expect(rendered.innerHTML).not.toContain("<img");
    expect(rendered.children).toHaveLength(0);

    for (const el of [...cardOf("1").querySelectorAll(".ll-desc-wrap, .ll-desc-wrap *")]) {
      for (const attr of el.attributes) {
        expect(attr.value, `${el.tagName}[${attr.name}] carries the raw description`).not.toContain("onerror");
      }
    }
  });
});
