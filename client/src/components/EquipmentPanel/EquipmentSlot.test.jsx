import { describe, expect, it } from "vitest";
import { Provider } from "react-redux";
import { fireEvent, render } from "@testing-library/react";
import EquipmentSlot from "./EquipmentSlot.jsx";
import { CONS, TOOLS, consThumb, toolThumb } from "../../data/catalog.js";
import { createTestStore, loadoutState } from "../../test/testStore.js";
import { slugify } from "../ItemThumb/ItemThumb.jsx";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Covers: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"

function renderSlot(preloadedState) {
  const store = createTestStore(preloadedState);
  return render(
    <Provider store={store}>
      <EquipmentSlot index={0} />
    </Provider>
  );
}

describe("EquipmentSlot — Tool entry", () => {
  it("renders the scraped image as the primary tier", () => {
    const toolIndex = 0;
    const def = TOOLS[toolIndex];
    const { container } = renderSlot({
      loadout: loadoutState({ equip: [{ t: "T", i: toolIndex }] }),
    });

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", `/images/tools/${slugify(def[1])}.jpg`);
  });

  it("falls back to the SVG icon once every extension fails to load", () => {
    const toolIndex = 0;
    const def = TOOLS[toolIndex];
    const { container } = renderSlot({
      loadout: loadoutState({ equip: [{ t: "T", i: toolIndex }] }),
    });

    let img = container.querySelector("img");
    ["jpeg", "png", "webp"].forEach(() => {
      fireEvent.error(img);
      img = container.querySelector("img");
    });
    fireEvent.error(img);

    expect(container.querySelector("img")).not.toBeInTheDocument();
    const svg = container.querySelector(".equip-thumb svg");
    expect(svg).toBeInTheDocument();
    expect(svg.querySelector("path")).toHaveAttribute("d", toolThumb(def));
  });
});

describe("EquipmentSlot — Consumable entry", () => {
  it("renders the scraped image as the primary tier, under the consumables category", () => {
    const consIndex = 0;
    const def = CONS[consIndex];
    const { container } = renderSlot({
      loadout: loadoutState({ equip: [{ t: "C", i: consIndex }] }),
    });

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", `/images/consumables/${slugify(def[1])}.jpg`);
  });

  it("falls back to the SVG icon once every extension fails to load", () => {
    const consIndex = 0;
    const def = CONS[consIndex];
    const { container } = renderSlot({
      loadout: loadoutState({ equip: [{ t: "C", i: consIndex }] }),
    });

    let img = container.querySelector("img");
    ["jpeg", "png", "webp"].forEach(() => {
      fireEvent.error(img);
      img = container.querySelector("img");
    });
    fireEvent.error(img);

    const svg = container.querySelector(".equip-thumb svg");
    expect(svg).toBeInTheDocument();
    expect(svg.querySelector("path")).toHaveAttribute("d", consThumb(def));
  });
});

describe("EquipmentSlot", () => {
  it("applies the shared .item-thumb container class regardless of photo-vs-SVG state", () => {
    const { container } = renderSlot({
      loadout: loadoutState({ equip: [{ t: "T", i: 0 }] }),
    });
    expect(container.querySelector(".equip-thumb")).toHaveClass("item-thumb", "equip-thumb");
  });

  it("renders no thumbnail for an empty slot", () => {
    const { container } = renderSlot({ loadout: loadoutState() });
    expect(container.querySelector(".item-thumb")).not.toBeInTheDocument();
    expect(container.querySelector(".empty-slot")).toBeInTheDocument();
  });
});
