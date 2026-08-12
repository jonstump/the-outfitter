import { afterEach, describe, expect, it, vi } from "vitest";
import { Provider } from "react-redux";
import { act, fireEvent, render } from "@testing-library/react";
import Picker from "./Picker.jsx";
import { TRAITS } from "../../data/catalog.js";
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
