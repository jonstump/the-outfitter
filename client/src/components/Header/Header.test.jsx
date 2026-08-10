import { describe, expect, it } from "vitest";
import { Provider } from "react-redux";
import { render } from "@testing-library/react";
import Header from "./Header.jsx";
import { createTestStore, loadoutState } from "../../test/testStore.js";

// Issue #66: the two header stats disagreed about what to do when you blow past a limit.
// Total cost reddened when over budget; trait points was hardcoded gold and never reacted,
// even though ActionsPanel already computed and displayed the same over-cap state. These
// pin both halves — the colour rule and the dropped "UP" suffix.

const OVER = "rgb(201, 107, 91)"; // #c96b5b, the shared over-the-limit colour
const GOLD = "rgb(196, 160, 94)"; // #c4a05e, trait points at or under the cap

function renderHeader(ui, loadout) {
  const store = createTestStore({
    loadout: loadoutState(loadout),
    ...(ui ? { ui } : {}),
  });
  const utils = render(
    <Provider store={store}>
      <Header />
    </Provider>
  );
  const stat = (label) =>
    [...utils.container.querySelectorAll(".header-stat")].find((n) =>
      n.querySelector(".header-stat-label")?.textContent === label
    );
  return { ...utils, value: (label) => stat(label).querySelector(".header-stat-value") };
}

// Quartermaster (8 UP) + Fanning (8 UP) = 16, comfortably over any cap we set below.
const twoBigTraits = { traits: ["quartermaster", "fanning"] };

describe("Header trait points", () => {
  it("renders a bare number with no UP suffix", () => {
    const { value } = renderHeader(undefined, twoBigTraits);
    expect(value("Trait points")).toHaveTextContent(/^16$/);
  });

  it("goes red when the trait cap is on and traits exceed it", () => {
    const { value } = renderHeader({ upBudgetOn: true, upBudget: 10 }, twoBigTraits);
    expect(value("Trait points")).toHaveStyle({ color: OVER });
  });

  it("stays gold when the cap is on and traits are at or under it", () => {
    const { value } = renderHeader({ upBudgetOn: true, upBudget: 16 }, twoBigTraits);
    expect(value("Trait points")).toHaveStyle({ color: GOLD });
  });

  it("stays gold when the cap is off, however many points are spent", () => {
    // The regression risk in the other direction: a cap that is off must never redden
    // the stat, or turning the feature off would still nag.
    const { value } = renderHeader({ upBudgetOn: false, upBudget: 1 }, twoBigTraits);
    expect(value("Trait points")).toHaveStyle({ color: GOLD });
  });
});

describe("Header total cost", () => {
  // Unchanged behaviour, pinned alongside so the two stats stay symmetrical.
  it("goes red when over budget and stays pale when under", () => {
    const overSpent = { weapons: [{ i: 14, a: -1 }, null] }; // Dolch 96, $690
    const over = renderHeader({ budgetOn: true, budget: 100 }, overSpent);
    expect(over.value("Total cost")).toHaveStyle({ color: OVER });

    const under = renderHeader({ budgetOn: true, budget: 800 }, overSpent);
    expect(under.value("Total cost")).not.toHaveStyle({ color: OVER });
  });
});
