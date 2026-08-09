import { describe, expect, it } from "vitest";
import { Provider } from "react-redux";
import { fireEvent, render } from "@testing-library/react";
import TraitsPanel from "./TraitsPanel.jsx";
import { TRAITS, traitThumb } from "../../data/catalog.js";
import { createTestStore, loadoutState } from "../../test/testStore.js";
import { slugify } from "../ItemThumb/ItemThumb.jsx";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Covers: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"

function renderPanel(traits) {
  const store = createTestStore({ loadout: loadoutState({ traits }) });
  return render(
    <Provider store={store}>
      <TraitsPanel />
    </Provider>
  );
}

describe("TraitsPanel", () => {
  it("renders the scraped image as the primary tier for each taken trait", () => {
    const traitIndex = 0;
    const def = TRAITS[traitIndex];
    const { container } = renderPanel([def[0]]);

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", `/images/traits/${slugify(def[1])}.jpg`);
    expect(container.querySelector(".trait-thumb")).toBeInTheDocument();
  });

  it("falls back to the SVG icon once every extension fails to load", () => {
    const traitIndex = 0;
    const def = TRAITS[traitIndex];
    const { container } = renderPanel([def[0]]);

    let img = container.querySelector("img");
    ["jpeg", "png", "webp"].forEach(() => {
      fireEvent.error(img);
      img = container.querySelector("img");
    });
    fireEvent.error(img);

    expect(container.querySelector("img")).not.toBeInTheDocument();
    const svg = container.querySelector(".trait-thumb svg");
    expect(svg).toBeInTheDocument();
    expect(svg.querySelector("path")).toHaveAttribute("d", traitThumb(def));
  });

  it("applies the shared .item-thumb container class regardless of photo-vs-SVG state", () => {
    const { container } = renderPanel([TRAITS[0][0]]);
    expect(container.querySelector(".trait-thumb")).toHaveClass("item-thumb", "trait-thumb");
  });

  it("shows the empty-state note and no thumbnails when no traits are taken", () => {
    const { container, getByText } = renderPanel([]);
    expect(container.querySelector(".item-thumb")).not.toBeInTheDocument();
    expect(getByText(/None taken/)).toBeInTheDocument();
  });
});
