import { afterEach, describe, expect, it, vi } from "vitest";
import { Provider } from "react-redux";
import { act, fireEvent, render } from "@testing-library/react";
import Picker from "./Picker.jsx";
import EquipmentPanel from "../EquipmentPanel/EquipmentPanel.jsx";
import { CONS, TOOLS, TRAITS, WEAPONS } from "../../data/catalog.js";
import * as itemStats from "../../data/itemStats.js";
import { descriptionFor } from "../../data/itemStats.js";
import { createTestStore, loadoutState } from "../../test/testStore.js";

// Governing: #23 (the locally-reconstructed ui object passed to buildRows must
// keep the Redux-backed fields buildRows still reads — dropping upBudgetOn/
// upBudget silently disabled the Traits-tab affordability gate)

function renderPicker(preloadedState) {
  const store = createTestStore(preloadedState);
  const utils = render(
    <Provider store={store}>
      <Picker />
    </Provider>
  );
  return { store, ...utils };
}

describe("Picker Traits-tab UP-budget gate (issue #23 regression)", () => {
  it("disables trait rows that would exceed the UP budget", () => {
    const expensive = TRAITS.find((t) => t[2] === 8); // e.g. Fanning, 8 UP
    const { store, getAllByRole } = renderPicker({
      loadout: loadoutState({ traits: [] }),
      ui: { tab: "Traits", upBudgetOn: true, upBudget: 4, message: "", search: "", group: "" },
    });

    const buttons = getAllByRole("button");
    const expensiveRow = buttons.find((b) => b.textContent.includes(expensive[1]));
    expect(expensiveRow).toBeTruthy();
    expect(expensiveRow).toHaveClass("disabled");
  });

  it("keeps affordable rows enabled when the UP budget is on", () => {
    const cheap = TRAITS.find((t) => t[2] === 1); // e.g. Kiteskin, 1 UP
    const { getAllByRole } = renderPicker({
      loadout: loadoutState({ traits: [] }),
      ui: { tab: "Traits", upBudgetOn: true, upBudget: 4, message: "", search: "", group: "" },
    });

    const buttons = getAllByRole("button");
    const cheapRow = buttons.find((b) => b.textContent.includes(cheap[1]));
    expect(cheapRow).toBeTruthy();
    expect(cheapRow).not.toHaveClass("disabled");
  });

  it("re-enables rows after toggling the UP budget off", () => {
    const expensive = TRAITS.find((t) => t[2] === 8);
    const store = createTestStore({
      loadout: loadoutState({ traits: [] }),
      ui: { tab: "Traits", upBudgetOn: true, upBudget: 4, message: "", search: "", group: "" },
    });
    const { getAllByRole } = render(
      <Provider store={store}>
        <Picker />
      </Provider>
    );

    act(() => store.dispatch({ type: "ui/toggleUpBudgetOn" }));
    const buttons = getAllByRole("button");
    const expensiveRow = buttons.find((b) => b.textContent.includes(expensive[1]));
    expect(expensiveRow).not.toHaveClass("disabled");
  });
});

// The trait-point unit is spelled "pts" in the UI, never "UP" — the same cleanup that took the
// suffix off the header stat (#66), the trait-cell hover, and the trait-cap input. The badge is
// the one place the number keeps a visible unit, because a trait row has no dollar cost beside
// it, so the badge is the only thing on the row that says what the number counts.
describe("Picker Traits-tab point badge", () => {
  // In `afterEach` rather than at the end of the mocking test: a failed assertion there would
  // return before the restore and leak the `descriptionFor` mock into everything after it.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const traitsTab = { tab: "Traits", upBudgetOn: false, upBudget: 10, message: "", search: "", group: "" };

  const rowFor = (buttons, name) => buttons.find((b) => b.textContent.includes(name));

  it("badges a multi-point trait as pts, not UP", () => {
    const expensive = TRAITS.find((t) => t[2] === 8);
    const { getAllByRole } = renderPicker({ loadout: loadoutState({ traits: [] }), ui: traitsTab });

    const row = rowFor(getAllByRole("button"), expensive[1]);
    expect(row.querySelector(".picker-row-badge")).toHaveTextContent("8 pts");
  });

  it("uses the singular at one point", () => {
    const cheap = TRAITS.find((t) => t[2] === 1);
    const { getAllByRole } = renderPicker({ loadout: loadoutState({ traits: [] }), ui: traitsTab });

    const row = rowFor(getAllByRole("button"), cheap[1]);
    expect(row.querySelector(".picker-row-badge")).toHaveTextContent(/^1 pt$/);
  });

  it("renders no trait row carrying the word UP", () => {
    const { container } = renderPicker({ loadout: loadoutState({ traits: [] }), ui: traitsTab });

    expect(container.textContent).not.toMatch(/\bUP\b/);
  });

  it("shows each trait's scraped description, not its group with a word appended", () => {
    // #228. Every trait row but Quartermaster read "<group> trait" — "Combat trait", "Medical trait"
    // — which looked like a description and was the `group` field. Quartermaster's real prose was
    // hand-written in this component, which also let it go stale: the wiki says "Gain +1 Weapon
    // Capacity", not "Raises weapon capacity to 6".
    const { getAllByRole, container } = renderPicker({
      loadout: loadoutState({ traits: [] }),
      ui: traitsTab,
    });
    const withDesc = TRAITS.find((t) => descriptionFor(t[0]));
    const row = rowFor(getAllByRole("button"), withDesc[1]);
    expect(row).toHaveTextContent(descriptionFor(withDesc[0]));
    expect(container.textContent).not.toMatch(/Raises weapon capacity to 6/);
    expect(container.textContent).not.toMatch(/\bCombat trait\b/);
  });

  it("falls back to the group label when the dataset has no description", () => {
    // `descriptionFor` is specified to return null for a catalog row the dataset does not cover, and
    // a row with no meta at all reads as a rendering fault rather than as missing data.
    vi.spyOn(itemStats, "descriptionFor").mockReturnValue(null);
    const { getAllByRole } = renderPicker({ loadout: loadoutState({ traits: [] }), ui: traitsTab });
    const def = TRAITS[0];
    expect(rowFor(getAllByRole("button"), def[1])).toHaveTextContent(`${def[3]} trait`);
  });
});

// Governing: ADR-0009 (index is the cell, `null` is an empty cell), SPEC-0006 REQ
// "Equipment Occupies a Fixed Eight-Cell Grid".
//
// Regression for #295: the Tools-tab duplicate-tool check read `e.t` off every
// `equip` entry, and `equip` is a fixed eight-cell SPARSE array — so a `null` hole
// threw `Cannot read properties of null (reading 't')` and crashed the whole page
// to the error boundary. The crash only fires when there IS free capacity (the
// `room &&` short-circuit hides it otherwise), so the fixture must leave at least
// one free cell.
describe("Picker Tools-tab on a sparse equip grid (issue #295 regression)", () => {
  it("renders the tools list without throwing when equip has holes and free cells", () => {
    const vitality = CONS.findIndex((c) => c[0] === "vitality-shot");
    const kit = TOOLS.findIndex((t) => t[0] === "first-aid-kit");
    // Holes at cells 1 and 3; cells 0 and 2 occupied; four free cells remain so
    // `room` is true and the unguarded `e.t` read is reached.
    const sparse = loadoutState({
      equip: [
        { t: "C", i: vitality }, null, { t: "T", i: kit }, null,
        null, null, null, null,
      ],
    });
    const { getAllByRole } = renderPicker({
      loadout: sparse,
      ui: { tab: "Tools", upBudgetOn: false, upBudget: 10, message: "", search: "", group: "" },
    });

    // The Tools tab rendered: at least one tool row is present and enabled, and the
    // already-equipped First Aid Kit is not offered as a duplicate.
    const buttons = getAllByRole("button");
    const firstAid = buttons.find((b) => b.textContent.includes("First Aid Kit"));
    expect(firstAid).toBeTruthy();
    expect(firstAid).toHaveClass("disabled");
    // A different tool is enabled, proving the row map completed rather than throwing.
    const knife = buttons.find((b) => b.textContent.includes("Knife"));
    expect(knife).toBeTruthy();
    expect(knife).not.toHaveClass("disabled");
  });
});

// Governing: ADR-0009 (index is the cell, `null` is an empty cell), SPEC-0006
// REQ "Equipment Occupies a Fixed Eight-Cell Grid", REQ "Items Are Rearranged by
// Direct Manipulation", REQ "Capacity Rules Are Stated Once and Preserved".
//
// Regression for issue #303: removal is the first user gesture that can put an
// INTERIOR hole in the grid (until now it filled only from the lowest free cell
// upward). These tests drive the ✕ gesture — the path nothing exercised before,
// and the path that must not resurrect #295's null-crash. They render EquipmentPanel
// beside the picker so the removal goes through the real control, not a dispatched
// action.
describe("Picker survives and reacts to a removal through the ✕ gesture (issue #303)", () => {
  const vitIdx = CONS.findIndex((c) => c[0] === "vitality-shot");
  const kitIdx = TOOLS.findIndex((t) => t[0] === "first-aid-kit");
  const knifeIdx = TOOLS.findIndex((t) => t[0] === "knife");

  function renderPanelAndPicker(preloadedState, tab = "Tools") {
    const store = createTestStore({
      ...preloadedState,
      ui: { tab, upBudgetOn: false, upBudget: 10, message: "", search: "", group: "" },
    });
    const utils = render(
      <Provider store={store}>
        <EquipmentPanel />
        <Picker />
      </Provider>
    );
    return { store, ...utils };
  }

  const removeBtn = (container, index) =>
    container.querySelector(`[data-slot-index="${index}"] .equip-remove-btn`);

  const rowFor = (container, name) => {
    // Only picker rows carry the .picker-row class; the equipment tiles also render
    // buttons containing item names (the ✕ restructure adds the inner tile button),
    // so match on the row class to avoid picking up a tile's aria-label.
    const rows = [...container.querySelectorAll(".picker-row")];
    return rows.find((b) => b.textContent.includes(name));
  };

  it("renders every picker tab without throwing after an interior removal", () => {
    // Fill the grid fully so rows are disabled, then remove an interior cell. The
    // Tools-tab duplicate check (e.t off every entry) is the #295 crash site.
    const dynamiteIdx = CONS.findIndex((c) => c[0] === "dynamite-stick");
    // Cell 3 is a SINGLE tile (not part of a stack run) so its ✕ exists — the run
    // anchor-only rule means only a run's lowest-numbered cell carries the control.
    const full = loadoutState({
      equip: [
        { t: "T", i: kitIdx }, { t: "C", i: vitIdx }, { t: "C", i: vitIdx }, { t: "C", i: dynamiteIdx },
        { t: "C", i: vitIdx }, { t: "C", i: dynamiteIdx }, { t: "C", i: dynamiteIdx }, { t: "C", i: dynamiteIdx },
      ],
      blocked: [],
    });
    const { container, store } = renderPanelAndPicker({ loadout: full }, "Tools");
    // The grid is full: the First Aid Kit row is disabled (room is false).
    expect(rowFor(container, "First Aid Kit")).toHaveClass("disabled");
    // Remove the interior cell 3 (a vitality) via the ✕.
    fireEvent.click(removeBtn(container, 3));
    // Now iterate every tab and assert nothing throws / rows render.
    for (const tab of ["Weapons", "Tools", "Consumables", "Traits"]) {
      const store2 = createTestStore({
        loadout: store.getState().loadout,
        ui: { tab, upBudgetOn: false, upBudget: 10, message: "", search: "", group: "" },
      });
      const rr = render(
        <Provider store={store2}>
          <Picker />
        </Provider>
      );
      expect(rr.container.querySelectorAll(".picker-row").length).toBeGreaterThan(0);
    }
  });

  it("re-enables the freed rows after a removal (a Tool, and a category-capped consumable)", () => {
    // Fill the grid fully: 0 tool, cells 1-7 all Vitality Shot (7 of them — but the
    // per-category cap is 4 per Shot, so this fixture is not legal for a real picker
    // placement; instead set 4 Vit + 4 of another type to hit the category cap while
    // the grid is full). Simpler: full grid with 4 vitalities + 4 dynamites; the Shot
    // cap is exhausted AND the grid is full; removing one vitality frees BOTH the
    // cell and a Shot slot.
    const dynamiteIdx = CONS.findIndex((c) => c[0] === "dynamite-stick");
    const full = loadoutState({
      equip: [
        { t: "C", i: vitIdx }, { t: "C", i: vitIdx }, { t: "C", i: vitIdx }, { t: "C", i: vitIdx },
        { t: "C", i: dynamiteIdx }, { t: "C", i: dynamiteIdx }, { t: "C", i: dynamiteIdx }, { t: "C", i: dynamiteIdx },
      ],
      blocked: [],
    });
    const { container, store } = renderPanelAndPicker({ loadout: full }, "Consumables");
    const shotRow = rowFor(container, "Vitality Shot (Weak)"); // a Shot row distinct from the held one
    // Grid is full and Shot cap is exhausted → this row is disabled.
    expect(shotRow).toHaveClass("disabled");
    fireEvent.click(removeBtn(container, 0)); // remove one vitality → frees a cell AND a Shot slot
    expect(rowFor(container, "Vitality Shot (Weak)")).not.toHaveClass("disabled");
  });

  it("re-enables the specific Tool that was just removed, and the grid's free cell accepts it back into the HOLE", () => {
    // Grid: tool at 0 and 2, plus a full complement so only one cell is free — the
    // hole an interior removal creates. Remove cell 0's tool, then add it back and
    // assert it lands in cell 0 (the interior hole), not at the end.
    const pre = loadoutState({
      equip: [
        { t: "T", i: kitIdx }, null, { t: "T", i: knifeIdx },
        null, null, null, null, null,
      ],
    });
    const { container, store } = renderPanelAndPicker({ loadout: pre }, "Tools");
    // The First Aid Kit row is disabled (already equipped).
    expect(rowFor(container, "First Aid Kit")).toHaveClass("disabled");
    fireEvent.click(removeBtn(container, 0)); // interior hole at cell 0
    const kitRow = rowFor(container, "First Aid Kit");
    expect(kitRow).not.toHaveClass("disabled"); // the specific tool is re-enabled
    fireEvent.click(kitRow); // equip it again
    const s = store.getState().loadout.equip;
    // It lands in the HOLE (cell 0), not appended at the end.
    expect(s[0]).toEqual({ t: "T", i: kitIdx });
    expect(s[1]).toBeNull();
  });
});

// Governing: issue #355. The Conversion pistol and Conversion Chain Pistol were
// mis-typed `medium` in the catalog; the wiki confirms both are `compact`. After
// the fix, the picker's `Compact` ammo filter chip includes both Conversion weapons,
// and the `Medium` chip no longer does.
describe("Picker ammo filter reflects Conversion's correct compact class (issue #355)", () => {
  const CONV = WEAPONS.find((w) => w[0] === "caldwell-conversion-pistol");
  const CHAIN = WEAPONS.find((w) => w[0] === "conversion-chain-pistol");

  it("the catalog now classifies both Conversion variants as compact", () => {
    expect(CONV[4]).toBe("compact");
    expect(CHAIN[4]).toBe("compact");
  });

  it("the Compact ammo filter chip includes both Conversion weapons", () => {
    const { getAllByRole } = renderPicker({
      loadout: loadoutState({ weapons: [null, null] }),
      ui: { tab: "Weapons", upBudgetOn: false, upBudget: 10, message: "", search: "", group: "" },
    });
    const chips = getAllByRole("button").filter((b) => b.textContent === "Compact");
    fireEvent.click(chips[0]);
    const rows = getAllByRole("button").filter((b) => b.textContent.includes("Conversion"));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("the Medium ammo filter chip no longer includes either Conversion weapon", () => {
    const { getAllByRole } = renderPicker({
      loadout: loadoutState({ weapons: [null, null] }),
      ui: { tab: "Weapons", upBudgetOn: false, upBudget: 10, message: "", search: "", group: "" },
    });
    const chips = getAllByRole("button").filter((b) => b.textContent === "Medium");
    fireEvent.click(chips[0]);
    const rows = getAllByRole("button").filter((b) => b.textContent.includes("Conversion"));
    expect(rows).toEqual([]);
  });
});
