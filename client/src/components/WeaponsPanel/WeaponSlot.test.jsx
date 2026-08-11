import { describe, expect, it } from "vitest";
import { Provider } from "react-redux";
import { act, fireEvent, render } from "@testing-library/react";
import WeaponSlot from "./WeaponSlot.jsx";
import { WEAPONS, weaponThumb } from "../../data/catalog.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
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

// Governing: issue #201 (a crafted share link permanently blanks the app)
//
// The decoder is what stops an out-of-range ammo index reaching the store, and it is tested
// where it lives (utils/loadoutCodec.test.js). These assert the second half of that fix: the
// slot resolves the variant rather than asserting one exists, so a future decode bug — or a
// state built some way nobody has thought of yet — costs a wrong label, not a white page.
describe("WeaponSlot — an unresolvable ammo variant", () => {
  const compact = WEAPONS.findIndex((w) => w[4] === "compact");
  const special = WEAPONS.findIndex((w) => w[4] === "special"); // no purchasable variants

  it("renders a weapon whose ammo index is past the end of its variant list", () => {
    const { container } = renderSlot({
      loadout: loadoutState({ weapons: [{ i: compact, a: 9999 }, null] }),
    });
    // Before the fix this threw a TypeError out of render and unmounted the tree.
    expect(container.querySelector(".weapon-name")).toHaveTextContent(WEAPONS[compact][1]);
    // Priced as no variant selected, and the select offers a way back rather than sitting blank.
    expect(container.querySelector(".weapon-cost")).toHaveTextContent(`$${WEAPONS[compact][3]}`);
    expect(container.querySelector("select").value).toBe("-1");
  });

  it("renders a weapon that has no purchasable variants at all", () => {
    const { container } = renderSlot({
      loadout: loadoutState({ weapons: [{ i: special, a: 0 }, null] }),
    });
    expect(container.querySelector(".weapon-name")).toHaveTextContent(WEAPONS[special][1]);
    expect(container.querySelector(".weapon-cost")).toHaveTextContent(`$${WEAPONS[special][3]}`);
    // An empty pool renders no ammo row, so there is no control to fall back to — the
    // assertion that matters is simply that the slot drew at all.
    expect(container.querySelector("select")).not.toBeInTheDocument();
  });
});

describe("WeaponSlot — memoized selector", () => {
  it("reflects a loadout change after dispatch (selector instance stays stable)", () => {
    const store = createTestStore({ loadout: loadoutState() });
    const { container } = render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    expect(container.querySelector(".empty-note")).toHaveTextContent("Primary");

    const weaponIndex = WEAPONS.findIndex((w) => w[2] === 2);
    act(() => store.dispatch(loadoutActions.addWeapon(weaponIndex)));
    expect(container.querySelector(".weapon-name")).toHaveTextContent(WEAPONS[weaponIndex][1]);

    // An unrelated UI change must not break the slot either.
    act(() => store.dispatch({ type: "ui/setMessage", payload: "hello" }));
    expect(container.querySelector(".weapon-name")).toHaveTextContent(WEAPONS[weaponIndex][1]);
  });
});
