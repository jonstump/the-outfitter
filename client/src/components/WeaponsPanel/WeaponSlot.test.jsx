import { describe, expect, it } from "vitest";
import { Provider } from "react-redux";
import { fireEvent, render } from "@testing-library/react";
import WeaponSlot from "./WeaponSlot.jsx";
import { WEAPONS, weaponThumb } from "../../data/catalog.js";
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
      <WeaponSlot slot={0} />
    </Provider>
  );
}

describe("WeaponSlot", () => {
  it("renders the scraped image as the primary tier for a filled slot", () => {
    const weaponIndex = WEAPONS.findIndex((w) => w[4] === "compact");
    const def = WEAPONS[weaponIndex];
    const { container } = renderSlot({
      loadout: loadoutState({ weapons: [{ i: weaponIndex, a: -1 }, null] }),
    });

    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", `/images/weapons/${slugify(def[1])}.jpg`);
    expect(container.querySelector(".weapon-thumb")).toBeInTheDocument();
  });

  it("falls back to the SVG icon once every extension fails to load — including for Weapons", () => {
    // This is the specific regression this issue calls out: pre-#8, Weapons only ever rendered an
    // SVG icon. Confirm that SVG-only-forever behavior is gone (photo is tried first) *and* that
    // the SVG fallback still works when the photo genuinely isn't available.
    const weaponIndex = WEAPONS.findIndex((w) => w[4] === "none");
    const def = WEAPONS[weaponIndex];
    const { container } = renderSlot({
      loadout: loadoutState({ weapons: [{ i: weaponIndex, a: -1 }, null] }),
    });

    let img = container.querySelector("img");
    ["jpeg", "png", "webp"].forEach((ext) => {
      fireEvent.error(img);
      img = container.querySelector("img");
      expect(img).toHaveAttribute("src", `/images/weapons/${slugify(def[1])}.${ext}`);
    });
    fireEvent.error(img);

    expect(container.querySelector("img")).not.toBeInTheDocument();
    const svg = container.querySelector(".weapon-thumb svg");
    expect(svg).toBeInTheDocument();
    expect(svg.querySelector("path")).toHaveAttribute("d", weaponThumb(def));
  });

  it("applies the shared .item-thumb container class regardless of photo-vs-SVG state", () => {
    const weaponIndex = 0;
    const { container } = renderSlot({
      loadout: loadoutState({ weapons: [{ i: weaponIndex, a: -1 }, null] }),
    });
    expect(container.querySelector(".weapon-thumb")).toHaveClass("item-thumb", "weapon-thumb");
  });

  it("renders no thumbnail for an empty slot", () => {
    const { container } = renderSlot({ loadout: loadoutState() });
    expect(container.querySelector(".item-thumb")).not.toBeInTheDocument();
    expect(container.querySelector(".empty-slot")).toBeInTheDocument();
  });
});
