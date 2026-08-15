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

// Governing: ADR-0023, SPEC-0009 REQ "The Pair Affordance Lives on the Weapon Slot",
// REQ "It Is Operable and Named in Every State" (WCAG 2.1 AA baseline, SPEC-0001).
//
// The affordance is a real button with an accessible name distinguishing its three
// states (available / locked / paired), does not render for a weapon the data does not
// mark dual-wieldable, and stays queryable (never display:none) when locked. Keyboard
// (Enter/Space) and pointer activation must produce identical state.
describe("WeaponSlot — the dual-wield pair affordance", () => {
  // Real catalog pair: a size-1 dual-wieldable pistol (Conversion) and a size-3 rifle
  // (Frontier 73C). Haymaker is a size-2 pistol the data does NOT mark dual-wieldable,
  // despite sharing its size with the Uppercut (SPEC-0009 "never derived").
  const PISTOL = WEAPONS.findIndex((w) => w[0] === "caldwell-conversion-pistol");
  const RIFLE = WEAPONS.findIndex((w) => w[0] === "frontier-73c");
  const HAYMAKER = WEAPONS.findIndex((w) => w[0] === "haymaker");

  const pairButton = (c) => c.querySelector(".pair-toggle");

  it("renders an available affordance for a dual-wieldable pistol with budget to spare", () => {
    const { container } = renderSlot({
      loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: false }, null] }),
    });
    const btn = pairButton(container);
    expect(btn).toBeInTheDocument();
    expect(btn).toBeInstanceOf(HTMLButtonElement);
    expect(btn).toHaveClass("available");
    expect(btn).not.toBeDisabled();
    // Accessible name distinguishes the available state.
    expect(btn).toHaveAccessibleName(`Dual-wield ${WEAPONS[PISTOL][1]}`);
  });

  it("marks the pair on pointer activation, showing the paired state and doubling capacity cost", () => {
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: false }, null] }),
    });
    const { container } = render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    fireEvent.click(pairButton(container));
    expect(store.getState().loadout.weapons[0].d).toBe(true);
    const btn = pairButton(container);
    expect(btn).toHaveClass("paired");
    expect(btn).toHaveAccessibleName(`Unpair ${WEAPONS[PISTOL][1]}`);
  });

  it("keyboard activation (Enter and Space) produces the same state as pointer activation", () => {
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: false }, null] }),
    });
    const { container } = render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    const btn = pairButton(container);
    // This is a REAL button (proven by the first test of this block), so Enter and
    // Space reach the same onClick the browser hands a pointer click to. Whet the
    // keyboard path by focusing and dispatching the key, then the native activation.
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.click(btn); // the browser's Enter activates a focused button by clicking it
    expect(store.getState().loadout.weapons[0].d).toBe(true);

    fireEvent.keyDown(btn, { key: " " });
    fireEvent.click(btn); // Space does the same
    expect(store.getState().loadout.weapons[0].d).toBe(false);
  });

  it("moves to locked when the remaining budget cannot afford the extra point, stays queryable, focusable and aria-disabled", () => {
    // Uppercut (size 2, pairable) + rifle (3) = 5 of 5. Pairing the Uppercut costs 3
    // (size + 1), so 3 + 3 = 6 > 5 — the extra point does not fit, the affordance is
    // locked. It stays in the tab order (aria-disabled, not the native attribute), so a
    // keyboard-only user can reach the control whose accessible name says WHY pairing
    // is unavailable (issue #401, ADR-0023 "all three states").
    const UPPER = WEAPONS.findIndex((w) => w[0] === "caldwell-conversion-uppercut");
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: RIFLE, a: -1, d: false }, { i: UPPER, a: -1, d: false }] }),
    });
    const { container } = render(
      <Provider store={store}>
        <WeaponSlot slot={1} />
      </Provider>
    );
    const btn = pairButton(container);
    expect(btn).toBeInTheDocument(); // NOT absent — the locked affordance stays in the tree.
    expect(btn).toHaveClass("locked");
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).not.toBeDisabled(); // focusable: the native attribute would skip Tab
    expect(btn).toHaveAccessibleName(`Dual-wield ${WEAPONS[UPPER][1]} — not enough budget`);

    // The point of the story — this fails with `disabled`:
    btn.focus();
    expect(document.activeElement).toBe(btn);
    // And the accessible name is actually reachable: the reason lives on the control.
    expect(btn).toHaveAccessibleName(/not enough budget/);

    // Activation — pointer and keyboard — does nothing. With aria-disabled the click
    // REACHES the handler, so this proves the early return (and, underneath, the
    // reducer guard, which is the real enforcement).
    fireEvent.click(btn);
    expect(store.getState().loadout.weapons[1].d).toBe(false);
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.click(btn);
    expect(store.getState().loadout.weapons[1].d).toBe(false);
  });

  // Governing: ADR-0023 ("renders a ghosted second copy within that weapon's own tile"),
  // SPEC-0009 REQ "The Pair Affordance Lives on the Weapon Slot" ("SHALL render a
  // representation of the second pistol").
  //
  // The affordance IS a second photograph of the weapon. The first implementation of this
  // story satisfied every other assertion in this file — role, accessible name, disabled
  // state, keyboard, live region — with a `×1 ×2` TEXT chip and no image at all, because
  // nothing here asserted the representation. This is that assertion. It must fail if the
  // second copy of the weapon ever stops being rendered, in any of the three states.
  it.each([
    ["available", { weapons: [{ i: PISTOL, a: -1, d: false }, null] }, 0],
    ["paired", { weapons: [{ i: PISTOL, a: -1, d: true }, null] }, 0],
    // Uppercut (2, pairable) + rifle (3) = 5 of 5, so the extra point cannot be afforded —
    // the same arrangement the dedicated locked test above uses, read from slot 1.
    [
      "locked",
      () => ({
        weapons: [
          { i: RIFLE, a: -1, d: false },
          { i: WEAPONS.findIndex((w) => w[0] === "caldwell-conversion-uppercut"), a: -1, d: false },
        ],
      }),
      1,
    ],
  ])("the %s affordance renders a second copy of the weapon's own image", (state, weapons, slot) => {
    const store = createTestStore({ loadout: loadoutState(typeof weapons === "function" ? weapons() : weapons) });
    const { container } = render(
      <Provider store={store}>
        <WeaponSlot slot={slot} />
      </Provider>
    );
    const btn = pairButton(container);
    expect(btn).toHaveClass(state);

    // The control's content is an IMAGE of the same weapon as the real tile — not a label
    // describing one. Both thumbs resolve to the same source, and they sit together in the
    // tile's image area rather than the affordance living somewhere else in the slot.
    const thumbs = container.querySelectorAll(".weapon-thumb-pair img");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[1].getAttribute("src")).toBe(thumbs[0].getAttribute("src"));
    expect(btn.querySelector("img")).toBe(thumbs[1]);

    // Decorative: the button's accessible name already carries the meaning, so the second
    // photo must not announce the weapon's name a second time.
    expect(thumbs[1]).toHaveAttribute("alt", "");
    expect(btn).toHaveAccessibleName(/\S/);
  });

  it("renders no affordance for a weapon the data does not mark dual-wieldable", () => {
    // Haymaker (size 2) is not pairable; the Uppercut (also size 2) is — the stored
    // attribute, never the size, decides.
    const { container } = renderSlot({
      loadout: loadoutState({ weapons: [{ i: HAYMAKER, a: -1, d: false }, null] }),
    });
    expect(pairButton(container)).not.toBeInTheDocument();
  });

  it("an unpair returns the weapon to a single and re-derives capacity", () => {
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: true }, null] }),
    });
    const { container } = render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    expect(pairButton(container)).toHaveClass("paired");
    fireEvent.click(pairButton(container));
    expect(store.getState().loadout.weapons[0].d).toBe(false);
    expect(pairButton(container)).toHaveClass("available");
  });

  it("announces the pairing change through a live region", () => {
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: false }, null] }),
    });
    const { container } = render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    const region = container.querySelector('[role="status"]');
    expect(region).toBeInTheDocument();
    fireEvent.click(pairButton(container));
    expect(region.textContent).toContain("Dual-wielding");
  });

  // Governing: issue #400 — the live region must be driven by the STORE, not by the
  // click. A store change the component did not initiate (a refused dispatch, an
  // unpair over capacity, a decoded save) must still be announced truthfully — and a
  // change the store refused must never be announced.
  it("announces a pairing change it did not initiate, dispatched directly to the store", () => {
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: false }, null] }),
    });
    const { container } = render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    const region = container.querySelector('[role="status"]');
    expect(region.textContent).toBe("");

    // Dispatch togglePair straight to the store — the button is not involved. The
    // announcement must follow the state change anyway.
    act(() => store.dispatch(loadoutActions.togglePair(0)));
    expect(store.getState().loadout.weapons[0].d).toBe(true);
    expect(region.textContent).toContain(`Dual-wielding ${WEAPONS[PISTOL][1]}`);
  });

  it("never announces a pairing change the store refused (a locked dispatch)", () => {
    // Uppercut (2, pairable) + rifle (3) = 5 of 5. Dispatching the pair directly is
    // REFUSED by the reducer — the region must stay silent, because the store did not
    // change.
    const UPPER = WEAPONS.findIndex((w) => w[0] === "caldwell-conversion-uppercut");
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: RIFLE, a: -1, d: false }, { i: UPPER, a: -1, d: false }] }),
    });
    const { container } = render(
      <Provider store={store}>
        <WeaponSlot slot={1} />
      </Provider>
    );
    const region = container.querySelector('[role="status"]');
    expect(region.textContent).toBe("");

    act(() => store.dispatch(loadoutActions.togglePair(1)));
    expect(store.getState().loadout.weapons[1].d).toBe(false); // refused by the guard
    expect(region.textContent).toBe(""); // and no false announcement
  });

  it("renders an empty live region for a loadout that already holds a pair on first render", () => {
    // A decoded save (or a reload) that lands with d: true must arrive silently — the
    // first render never announces, so a pair that was already there is not reported as
    // if it had just been created.
    const { container } = renderSlot({
      loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: true }, null] }),
    });
    const region = container.querySelector('[role="status"]');
    expect(pairButton(container)).toHaveClass("paired");
    expect(region.textContent).toBe("");
  });
});
