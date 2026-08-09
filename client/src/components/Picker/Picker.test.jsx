import { describe, expect, it } from "vitest";
import { Provider } from "react-redux";
import { act, fireEvent, render } from "@testing-library/react";
import Picker from "./Picker.jsx";
import { TRAITS } from "../../data/catalog.js";
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
    const expensive = TRAITS.find((t) => t[1] === 8); // Fanning, 8 UP pre-audit shape
    const { store, getAllByRole } = renderPicker({
      loadout: loadoutState({ traits: [] }),
      ui: { tab: "Traits", upBudgetOn: true, upBudget: 4, message: "", search: "", group: "" },
    });

    const buttons = getAllByRole("button");
    const expensiveRow = buttons.find((b) => b.textContent.includes(expensive[0]));
    expect(expensiveRow).toBeTruthy();
    expect(expensiveRow).toHaveClass("disabled");
  });

  it("keeps affordable rows enabled when the UP budget is on", () => {
    const cheap = TRAITS.find((t) => t[1] === 1); // e.g. Kiteskin
    const { getAllByRole } = renderPicker({
      loadout: loadoutState({ traits: [] }),
      ui: { tab: "Traits", upBudgetOn: true, upBudget: 4, message: "", search: "", group: "" },
    });

    const buttons = getAllByRole("button");
    const cheapRow = buttons.find((b) => b.textContent.includes(cheap[0]));
    expect(cheapRow).toBeTruthy();
    expect(cheapRow).not.toHaveClass("disabled");
  });

  it("re-enables rows after toggling the UP budget off", () => {
    const expensive = TRAITS.find((t) => t[1] === 8);
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
    const expensiveRow = buttons.find((b) => b.textContent.includes(expensive[0]));
    expect(expensiveRow).not.toHaveClass("disabled");
  });
});
