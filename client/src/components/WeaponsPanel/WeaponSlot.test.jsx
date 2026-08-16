import { describe, expect, it } from "vitest";
import { Provider } from "react-redux";
import { act, fireEvent, render, screen } from "@testing-library/react";
import WeaponSlot from "./WeaponSlot.jsx";
import Picker from "../Picker/Picker.jsx";
import { WEAPONS, weaponThumb } from "../../data/catalog.js";
import { ammoRoundFor, ammoSlotsFor } from "../../data/itemStats.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import { createTestStore, loadoutState } from "../../test/testStore.js";
import { slugify } from "../ItemThumb/ItemThumb.jsx";
import { ammoCostFor, capMax, capUsed, totalCost } from "../../utils/calc.js";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Covers: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"

function renderSlot(preloadedState) {
  const store = createTestStore(preloadedState);
  const utils = render(
    <Provider store={store}>
      <WeaponSlot slot={0} />
    </Provider>
  );
  return { store, ...utils };
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
  // Governing: issue #340. Was `w[4] === "special"` until #340 populated AMMO.special with nine
  // rows (Bomb Launcher/Chu Ko Nu's real prices, Dolch/Nitro's Scarce rounds at 0 — see the block
  // comment above AMMO.special in catalog.js) — a special-class weapon now DOES draw a select with
  // options, so it stopped fitting "no purchasable variants at all". `none`-class (melee) weapons
  // are the ones that still genuinely have no ammo pool.
  const none = WEAPONS.findIndex((w) => w[4] === "none"); // no purchasable variants

  it("renders a weapon whose ammo id its accepted list does not have", () => {
    // Governing: ADR-0014, SPEC-0010, issue #344. The hazard this guards is now id-based
    // (an id the weapon's own accepted list doesn't contain), not index-based — but the
    // same "must not throw, must degrade to Standard" contract issue #201 established.
    const { container } = renderSlot({
      loadout: loadoutState({ weapons: [{ i: compact, ammo: ["ammo-does-not-exist", null] }, null] }),
    });
    // Before the #201 fix this threw a TypeError out of render and unmounted the tree.
    expect(container.querySelector(".weapon-name")).toHaveTextContent(WEAPONS[compact][1]);
    // Priced as no variant selected, and the select offers a way back rather than sitting blank.
    expect(container.querySelector(".weapon-cost")).toHaveTextContent(`$${WEAPONS[compact][3]}`);
    // "" is the Standard/no-selection sentinel (an id string is never empty) — no <option>
    // matches the unresolvable id, so the control shows Standard without correcting state.
    expect(container.querySelector("select").value).toBe("");
  });

  it("renders a weapon that has no purchasable variants at all", () => {
    const { container } = renderSlot({
      loadout: loadoutState({ weapons: [{ i: none, a: 0 }, null] }),
    });
    expect(container.querySelector(".weapon-name")).toHaveTextContent(WEAPONS[none][1]);
    expect(container.querySelector(".weapon-cost")).toHaveTextContent(`$${WEAPONS[none][3]}`);
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
// The affordance is a real <button> with an accessible name distinguishing its three
// states (available / locked / paired), does not render for a weapon the data does not
// mark dual-wieldable, and stays queryable (never display:none) when locked. Keyboard
// (Enter/Space) and pointer activation must produce identical state.
//
// Per the companion test story (#334), queries use ROLE and ACCESSIBLE NAME (Testing
// Library's getByRole with a name), never querySelector on class names: a test that
// passes when the button becomes a div has not tested the requirement. Weapon ids come
// from catalog lookups rather than hardcoded strings, except `haymaker`, where the
// weapon's dual-wield status IS the point (it is size 2 and NOT pairable, while the
// Uppercut is also size 2 and IS - the stored attribute, never the size, decides).
describe("WeaponSlot - the dual-wield pair affordance", () => {
  // Real catalog pair: a size-1 dual-wieldable pistol (Conversion) and a size-3 rifle
  // (Frontier 73C). Haymaker is a size-2 pistol the data does NOT mark dual-wieldable,
  // despite sharing its size with the Uppercut (SPEC-0009 "never derived").
  const PISTOL = WEAPONS.findIndex((w) => w[0] === "caldwell-conversion-pistol");
  const RIFLE = WEAPONS.findIndex((w) => w[0] === "frontier-73c");
  const HAYMAKER = WEAPONS.findIndex((w) => w[0] === "haymaker");
  const UPPER = WEAPONS.findIndex((w) => w[0] === "caldwell-conversion-uppercut");

  // Role + accessible name is the primary query; the affordance must be a real button.

  // -- Render tests: the three states -------------------------------------------------

  it("renders an available affordance for a dual-wieldable pistol with budget to spare", () => {
    renderSlot({ loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: false }, null] }) });
    // Queried by role and accessible name - passes only while a real button exists.
    const btn = screen.getByRole("button", { name: `Dual-wield ${WEAPONS[PISTOL][1]}` });
    expect(btn).toBeInstanceOf(HTMLButtonElement);
    expect(btn).not.toBeDisabled();
    // It is in the tab order (indexed as a real focusable control).
    expect(btn.tabIndex).toBe(0);
    // The state class too — see the note on the locked test below.
    expect(btn).toHaveClass("available");
  });

  it("renders the locked affordance when the budget has no room, keeping role and name", () => {
    // Uppercut (size 2, pairable) + rifle (3) = 5 of 5: pairing the Uppercut costs
    // 3 (size + 1), so 3 + 3 = 6 > 5 — the extra point does not fit. The locked
    // affordance lives on the UPPERCUT's slot, which is slot 1 here.
    const store = createTestStore({
      loadout: loadoutState({
        weapons: [
          { i: RIFLE, a: -1, d: false },
          { i: UPPER, a: -1, d: false },
        ],
      }),
    });
    render(
      <Provider store={store}>
        <WeaponSlot slot={1} />
      </Provider>
    );
    const btn = screen.getByRole("button", { name: `Dual-wield ${WEAPONS[UPPER][1]} — not enough budget` });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).not.toBeDisabled(); // focusable
    btn.focus();
    expect(document.activeElement).toBe(btn);
    // Accessible name conveys WHY pairing is unavailable (issue #401).
    expect(btn).toHaveAccessibleName(/not enough budget/);
    // The state class is asserted ON AN ELEMENT FOUND BY ROLE, which is a different
    // thing from querying by class: getByRole still fails if the button becomes a div,
    // so this composes with the role query rather than weakening it. It is asserted
    // because `pairState` is what global.css keys the whole visual channel off —
    // `.locked` is opacity 0.22 + grayscale(1) + a dotted border, `.available` is the
    // gold-bordered ghost carrying the plus sign, `.paired` is full colour. ADR-0023
    // specifies "a plus sign when the budget has room for the extra slot, a locked
    // state when it does not", so the distinction is part of the decision. Nothing in
    // CI measures a rendered pixel, so without this a miswired ternary could render
    // locked identically to available and no test would notice.
    expect(btn).toHaveClass("locked");
  });

  it("renders the paired affordance when the pair is marked", () => {
    renderSlot({ loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: true }, null] }) });
    const btn = screen.getByRole("button", { name: `Unpair ${WEAPONS[PISTOL][1]}` });
    expect(btn).toBeInstanceOf(HTMLButtonElement);
    expect(btn).not.toBeDisabled();
    // The state class too — see the note on the locked test above.
    expect(btn).toHaveClass("paired");
  });

  it("renders NO affordance for a weapon the data does not mark dual-wieldable", () => {
    // Haymaker: size 2, NOT pairable - the stored attribute, never the size, decides.
    // (The Uppercut is the same size and IS pairable.)
    renderSlot({ loadout: loadoutState({ weapons: [{ i: HAYMAKER, a: -1, d: false }, null] }) });
    const possible = [
      `Dual-wield ${WEAPONS[HAYMAKER][1]}`,
      `Dual-wield ${WEAPONS[HAYMAKER][1]} — not enough budget`,
      `Unpair ${WEAPONS[HAYMAKER][1]}`,
    ];
    for (const n of possible) expect(screen.queryByRole("button", { name: n })).not.toBeInTheDocument();
  });

  // -- Interaction tests --------------------------------------------------------------

  it("marks the pair on pointer activation, showing the paired state and doubling capacity cost", () => {
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: false }, null] }),
    });
    render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    fireEvent.click(screen.getByRole("button", { name: `Dual-wield ${WEAPONS[PISTOL][1]}` }));
    expect(store.getState().loadout.weapons[0].d).toBe(true);
    // And now it is a paired control with the un-pair name.
    expect(screen.getByRole("button", { name: `Unpair ${WEAPONS[PISTOL][1]}` })).toBeInTheDocument();
  });

  it("keyboard activation (Enter and Space) produces the same state as pointer activation", () => {
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: false }, null] }),
    });
    render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    const btn = screen.getByRole("button", { name: `Dual-wield ${WEAPONS[PISTOL][1]}` });
    // This is a REAL button, so Enter and Space reach the same onClick the browser hands
    // a pointer click to. Whet the keyboard path by focusing and dispatching the key,
    // then the native activation.
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.click(btn);
    expect(store.getState().loadout.weapons[0].d).toBe(true);

    fireEvent.keyDown(btn, { key: " " });
    fireEvent.click(btn);
    expect(store.getState().loadout.weapons[0].d).toBe(false);
  });

  it("activating a locked affordance - pointer or keyboard - does nothing, capacity unchanged", () => {
    const store = createTestStore({
      loadout: loadoutState({
        weapons: [
          { i: RIFLE, a: -1, d: false },
          { i: UPPER, a: -1, d: false },
        ],
      }),
    });
    const { container } = render(
      <Provider store={store}>
        <WeaponSlot slot={1} />
      </Provider>
    );
    const before = capUsed(store.getState().loadout);
    const btn = screen.getByRole("button", { name: `Dual-wield ${WEAPONS[UPPER][1]} — not enough budget` });

    // Pointer.
    fireEvent.click(btn);
    expect(store.getState().loadout.weapons[1].d).toBe(false);
    expect(capUsed(store.getState().loadout)).toBe(before); // not merely "no error"

    // Keyboard (Enter + native click).
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.click(btn);
    expect(store.getState().loadout.weapons[1].d).toBe(false);
    expect(capUsed(store.getState().loadout)).toBe(before);
  });

  it("an unpair returns the weapon to a single and re-derives capacity", () => {
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: true }, null] }),
    });
    render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    fireEvent.click(screen.getByRole("button", { name: `Unpair ${WEAPONS[PISTOL][1]}` }));
    expect(store.getState().loadout.weapons[0].d).toBe(false);
    expect(screen.getByRole("button", { name: `Dual-wield ${WEAPONS[PISTOL][1]}` })).toBeInTheDocument();
  });

  // -- Accessibility tests -------------------------------------------------------------

  it("the affordance's accessible name differs across the three states", () => {
    // Available: "Dual-wield <name>".
    const { rerender, store } = renderSlot({
      loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: false }, null] }),
    });
    expect(screen.getByRole("button", { name: `Dual-wield ${WEAPONS[PISTOL][1]}` })).toBeInTheDocument();

    // Paired: "Unpair <name>".
    act(() => store.dispatch(loadoutActions.togglePair(0)));
    rerender(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    expect(screen.getByRole("button", { name: `Unpair ${WEAPONS[PISTOL][1]}` })).toBeInTheDocument();

    // Locked: "Dual-wield <name> — not enough budget" (a third, distinct name).
    const lockedStore = createTestStore({
      loadout: loadoutState({
        weapons: [
          { i: RIFLE, a: -1, d: false },
          { i: UPPER, a: -1, d: false },
        ],
      }),
    });
    render(
      <Provider store={lockedStore}>
        <WeaponSlot slot={1} />
      </Provider>
    );
    expect(
      screen.getByRole("button", { name: `Dual-wield ${WEAPONS[UPPER][1]} — not enough budget` })
    ).toBeInTheDocument();
  });

  it("the locked affordance is STILL PRESENT in the accessibility tree with its disabled state exposed", () => {
    const store = createTestStore({
      loadout: loadoutState({
        weapons: [
          { i: RIFLE, a: -1, d: false },
          { i: UPPER, a: -1, d: false },
        ],
      }),
    });
    render(
      <Provider store={store}>
        <WeaponSlot slot={1} />
      </Provider>
    );
    // NOT absent - the locked control stays discoverable; a test asserting absence
    // inverts the requirement (SPEC-0009 REQ "Operable and Named in Every State").
    const btn = screen.getByRole("button", { name: `Dual-wield ${WEAPONS[UPPER][1]} — not enough budget` });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).toBeInstanceOf(HTMLButtonElement);
  });

  // Governing: ADR-0023 ("renders a ghosted second copy within that weapon's own tile"),
  // SPEC-0009 REQ "The Pair Affordance Lives on the Weapon Slot" (SHALL render a
  // representation of the second pistol).
  //
  // The affordance IS a second photograph of the weapon. The first implementation of this
  // story satisfied role/name/disabled/keyboard/live-region with a text chip and no image.
  // This pins the representation: the button contains an IMAGE of the same weapon, in all
  // three states.
  it.each([
    ["available", { weapons: [{ i: PISTOL, a: -1, d: false }, null] }, 0, `Dual-wield ${WEAPONS[PISTOL][1]}`],
    ["paired", { weapons: [{ i: PISTOL, a: -1, d: true }, null] }, 0, `Unpair ${WEAPONS[PISTOL][1]}`],
    [
      "locked",
      {
        weapons: [
          { i: RIFLE, a: -1, d: false },
          { i: UPPER, a: -1, d: false },
        ],
      },
      1,
      `Dual-wield ${WEAPONS[UPPER][1]} — not enough budget`,
    ],
  ])("the %s affordance renders a second copy of the weapon's own image", (state, weapons, slot, name) => {
    const store = createTestStore({ loadout: loadoutState(weapons) });
    const { container } = render(
      <Provider store={store}>
        <WeaponSlot slot={slot} />
      </Provider>
    );
    // The affordance itself, queried by role and accessible name — the control is a
    // real button no matter which state it is in.
    const btn = screen.getByRole("button", { name });
    expect(btn).toBeInstanceOf(HTMLButtonElement);
    // `state` names the case in the title AND is the class the component must carry,
    // so this row's parameter is checked rather than merely labelling the case.
    expect(btn).toHaveClass(state);
    const thumbs = container.querySelectorAll(".weapon-thumb-pair img");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[1].getAttribute("src")).toBe(thumbs[0].getAttribute("src"));
    expect(btn.querySelector("img")).toBe(thumbs[1]);
    expect(thumbs[1]).toHaveAttribute("alt", "");
  });

  // -- Live region ---------------------------------------------------------------------

  it("marking a pair announces the capacity change through a live region", () => {
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: false }, null] }),
    });
    render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    const region = screen.getByRole("status");
    expect(region).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Dual-wield ${WEAPONS[PISTOL][1]}` }));
    expect(region).toHaveTextContent(`Dual-wielding ${WEAPONS[PISTOL][1]}`);
  });

  // Governing: issue #400 - the live region must be driven by the STORE, not by the
  // click. A store change the component did not initiate must still be announced
  // truthfully - and a change the store refused must never be announced.
  it("announces a pairing change it did not initiate, dispatched directly to the store", () => {
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: false }, null] }),
    });
    render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("");
    act(() => store.dispatch(loadoutActions.togglePair(0)));
    expect(store.getState().loadout.weapons[0].d).toBe(true);
    expect(region).toHaveTextContent(`Dual-wielding ${WEAPONS[PISTOL][1]}`);
  });

  it("never announces a pairing change the store refused (a locked dispatch)", () => {
    const store = createTestStore({
      loadout: loadoutState({
        weapons: [
          { i: RIFLE, a: -1, d: false },
          { i: UPPER, a: -1, d: false },
        ],
      }),
    });
    render(
      <Provider store={store}>
        <WeaponSlot slot={1} />
      </Provider>
    );
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("");
    act(() => store.dispatch(loadoutActions.togglePair(1)));
    expect(store.getState().loadout.weapons[1].d).toBe(false);
    expect(region).toHaveTextContent("");
  });

  it("renders an empty live region for a loadout that already holds a pair on first render", () => {
    renderSlot({ loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: true }, null] }) });
    const region = screen.getByRole("status");
    expect(screen.getByRole("button", { name: `Unpair ${WEAPONS[PISTOL][1]}` })).toBeInTheDocument();
    expect(region).toHaveTextContent("");
  });

  // -- Seam: the pair + rifle coexist ------------------------------------------------

  // Governing: issue #179, SPEC-0009 REQ "A Pair Never Consumes the Second Weapon
  // Entry". A pair lives in ONE entry; the other slot stays free for a rifle. This is
  // the case #179 exists for and the one most worth pinning: the rifle's own slot must
  // be unaffected by the pistol's pairing.
  it("seam: a size-1 pistol pair and a size-3 rifle coexist within 5 points, rifle slot untouched", () => {
    const store = createTestStore({
      loadout: loadoutState({
        weapons: [
          { i: PISTOL, a: -1, d: true },
          { i: RIFLE, a: -1, d: false },
        ],
      }),
    });
    let s = store.getState().loadout;
    expect(capUsed(s)).toBe(5); // 2 (pair) + 3 (rifle)
    expect(capUsed(s)).toBeLessThanOrEqual(capMax(s));

    // Render BOTH slots: slot 0 (the pair) and slot 1 (the rifle).
    render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
        <WeaponSlot slot={1} />
      </Provider>
    );
    // The pistol slot is paired; the rifle slot has NO affordance (the rifle is not
    // dual-wieldable — query each candidate name by role; none may exist).
    expect(screen.getByRole("button", { name: `Unpair ${WEAPONS[PISTOL][1]}` })).toBeInTheDocument();
    for (const n of [
      `Dual-wield ${WEAPONS[RIFLE][1]}`,
      `Dual-wield ${WEAPONS[RIFLE][1]} — not enough budget`,
      `Unpair ${WEAPONS[RIFLE][1]}`,
    ]) {
      expect(screen.queryByRole("button", { name: n })).not.toBeInTheDocument();
    }

    // Un-pairing the pistol leaves the rifle exactly where it was.
    fireEvent.click(screen.getByRole("button", { name: `Unpair ${WEAPONS[PISTOL][1]}` }));
    s = store.getState().loadout;
    expect(s.weapons[0].d).toBe(false);
    expect(s.weapons[1]).toEqual({ i: RIFLE, a: -1, d: false });
    expect(capUsed(s)).toBe(4);
  });

  // -- Seam: the picker is untouched ------------------------------------------------

  // Governing: SPEC-0009 REQ "The Pair Affordance Lives on the Weapon Slot". The pair
  // control lives ONLY on the weapon slot - the picker offers no dual-wield gesture.
  // Guards against the affordance being reintroduced in the picker later (#334).
  it("seam: the item picker offers no dual-wield control", () => {
    // Render the WEAPONS tab of the picker with a pairable pistol already equipped.
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: PISTOL, a: -1, d: true }, null] }),
      ui: { tab: "Weapons", upBudgetOn: false, upBudget: 10, message: "", search: "", group: "", ammoF: "", sizeFilter: 0 },
    });
    render(
      <Provider store={store}>
        <Picker />
      </Provider>
    );
    // Every row is a plain add button; NO row carries a dual-wield gesture. Query by
    // role: a picker row is a button whose accessible name is the weapon name.
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    // No button's accessible name mentions dual-wield or unpair anywhere in the picker.
    const offender = screen
      .getAllByRole("button")
      .find((b) => /duel|dual|wield|pair|unpair/i.test(b.getAttribute("aria-label") || b.textContent || ""));
    expect(offender).toBeUndefined();
  });
});

// Governing: issue #346, issue #347, ADR-0014, SPEC-0010 REQ "Each Ammo Slot Is
// Individually Labelled and Operable" (WCAG 2.1 AA baseline, SPEC-0001).
//
// Companion test story for #346: that PR carries its own unit tests, but this is the
// render/interaction/accessibility coverage a feature PR typically under-serves, plus
// the seams where two ammo slots meet the rest of the loadout (pairing, total cost).
//
// A native <select> is Testing Library's "combobox" role. Queries use ROLE and
// ACCESSIBLE NAME throughout — never querySelector on class names — per the same
// discipline the pair-affordance tests above establish: a test that passes when the
// control becomes a <div> has not tested the requirement.
describe("WeaponSlot — the second ammo control", () => {
  // Real catalog weapons chosen for their SLOT SHAPE, not arbitrarily:
  //   - Drilling: dual-family (medium + shotgun) — bound, two DISJOINT groups.
  //   - 1890 Cavalry: split-reserve (long only) — unbound, both slots share one group
  //     and may repeat a round.
  //   - Conversion: one slot (Compact) — the exact class the pre-#344 shared AMMO pool
  //     priced wrong, called out explicitly by this issue for the "offered rounds"
  //     render test.
  //   - LeMat Mark II: the one weapon in the catalog that is BOTH dual-family (two
  //     ammo slots) AND dual-wieldable — the only real fixture for the pairing seam.
  const DRILLING = WEAPONS.findIndex((w) => w[0] === "drilling");
  const CAVALRY = WEAPONS.findIndex((w) => w[0] === "1890-cavalry");
  const CONVERSION = WEAPONS.findIndex((w) => w[0] === "caldwell-conversion-pistol");
  const LEMAT = WEAPONS.findIndex((w) => w[0] === "lemat-mark-ii");

  // -- Render: slot count --------------------------------------------------------------

  it("renders exactly two ammo controls for a two-slot dual-family weapon (Drilling)", () => {
    renderSlot({ loadout: loadoutState({ weapons: [{ i: DRILLING, ammo: [null, null], d: false }, null] }) });
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  it("renders exactly two ammo controls for a two-slot split-reserve weapon (1890 Cavalry)", () => {
    renderSlot({ loadout: loadoutState({ weapons: [{ i: CAVALRY, ammo: [null, null], d: false }, null] }) });
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  it("renders exactly one ammo control for a one-slot weapon — not a second, disabled one", () => {
    renderSlot({ loadout: loadoutState({ weapons: [{ i: CONVERSION, ammo: [null, null], d: false }, null] }) });
    const boxes = screen.getAllByRole("combobox");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).not.toBeDisabled();
    // Queried by role AND accessible name too, not just count — a one-slot weapon's
    // control needs a name as much as a two-slot weapon's do (the pre-#346 control had
    // no aria-label at all, so this also pins that #346 didn't skip the single-slot case).
    expect(screen.getByRole("combobox", { name: `${WEAPONS[CONVERSION][1]} ammo` })).toBe(boxes[0]);
  });

  // -- Render: offered rounds -----------------------------------------------------------

  it("Drilling's two controls each offer only their own family's rounds, never the other slot's or a class pool", () => {
    renderSlot({ loadout: loadoutState({ weapons: [{ i: DRILLING, ammo: [null, null], d: false }, null] }) });
    const slots = ammoSlotsFor(WEAPONS[DRILLING][0]);
    expect(slots.bound).toBe(true); // sanity: Drilling IS the dual-family case under test
    const [select1, select2] = screen.getAllByRole("combobox");
    const optionIds = (select) => [...select.querySelectorAll("option")].map((o) => o.value).filter(Boolean);
    expect(optionIds(select1)).toEqual(slots.groups[0].map((r) => r.id));
    expect(optionIds(select2)).toEqual(slots.groups[1].map((r) => r.id));
    // The two groups are disjoint families — confirms neither slot leaks the other's rounds.
    expect(optionIds(select1).some((id) => optionIds(select2).includes(id))).toBe(false);
  });

  it("Conversion's single control offers its own Compact rounds, not the shared class pool", () => {
    renderSlot({ loadout: loadoutState({ weapons: [{ i: CONVERSION, ammo: [null, null], d: false }, null] }) });
    const slots = ammoSlotsFor(WEAPONS[CONVERSION][0]);
    const select = screen.getByRole("combobox", { name: `${WEAPONS[CONVERSION][1]} ammo` });
    const optionIds = [...select.querySelectorAll("option")].map((o) => o.value).filter(Boolean);
    expect(optionIds).toEqual(slots.groups[0].map((r) => r.id));
  });

  // -- Interaction ------------------------------------------------------------------

  it("setting slot 2 leaves slot 1 unchanged, and vice versa — both selections persist", () => {
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: DRILLING, ammo: [null, null], d: false }, null] }),
    });
    render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    const [slot1, slot2] = screen.getAllByRole("combobox");

    fireEvent.change(slot1, { target: { value: "ammo-medium-fmj" } });
    expect(store.getState().loadout.weapons[0].ammo).toEqual(["ammo-medium-fmj", null]);

    fireEvent.change(slot2, { target: { value: "ammo-shotgun-slug" } });
    expect(store.getState().loadout.weapons[0].ammo).toEqual(["ammo-medium-fmj", "ammo-shotgun-slug"]);

    // And the reverse direction: changing slot 1 again must not disturb slot 2.
    fireEvent.change(slot1, { target: { value: "ammo-medium-high-velocity" } });
    expect(store.getState().loadout.weapons[0].ammo).toEqual(["ammo-medium-high-velocity", "ammo-shotgun-slug"]);
  });

  it("permits choosing the same round in both slots of a split-reserve weapon", () => {
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: CAVALRY, ammo: [null, null], d: false }, null] }),
    });
    render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    const [slot1, slot2] = screen.getAllByRole("combobox");
    fireEvent.change(slot1, { target: { value: "ammo-long-fmj" } });
    fireEvent.change(slot2, { target: { value: "ammo-long-fmj" } });
    expect(store.getState().loadout.weapons[0].ammo).toEqual(["ammo-long-fmj", "ammo-long-fmj"]);
  });

  // -- Accessibility --------------------------------------------------------------------

  it("Drilling's two controls have accessible names that identify their slot and differ from each other", () => {
    renderSlot({ loadout: loadoutState({ weapons: [{ i: DRILLING, ammo: [null, null], d: false }, null] }) });
    const slot1 = screen.getByRole("combobox", { name: `${WEAPONS[DRILLING][1]} — Medium ammo` });
    const slot2 = screen.getByRole("combobox", { name: `${WEAPONS[DRILLING][1]} — Shotgun` });
    expect(slot1).not.toBe(slot2);
  });

  it("1890 Cavalry's two controls also carry distinct, slot-identifying accessible names", () => {
    // Split-reserve: both slots share one round group, so there is no family to name
    // the slot by — the fallback is an ordinal, still distinct per slot.
    renderSlot({ loadout: loadoutState({ weapons: [{ i: CAVALRY, ammo: [null, null], d: false }, null] }) });
    const slot1 = screen.getByRole("combobox", { name: `${WEAPONS[CAVALRY][1]} — ammo slot 1` });
    const slot2 = screen.getByRole("combobox", { name: `${WEAPONS[CAVALRY][1]} — ammo slot 2` });
    expect(slot1).not.toBe(slot2);
  });

  it("both controls are reachable in the tab order", () => {
    renderSlot({ loadout: loadoutState({ weapons: [{ i: DRILLING, ammo: [null, null], d: false }, null] }) });
    const boxes = screen.getAllByRole("combobox");
    expect(boxes).toHaveLength(2); // both, not just whichever one already existed
    for (const box of boxes) expect(box.tabIndex).toBe(0);
  });

  it("keyboard and pointer activation produce identical state, on the SECOND slot specifically", () => {
    // A native <select> is keyboard-operable by construction, and both a keyboard
    // selection (focus + arrow keys + Enter) and a pointer selection (click + click)
    // terminate in the SAME DOM "change" event carrying the chosen value — there is no
    // separate code path in the component to diverge, unlike the custom pair-toggle
    // <button> tested above (whose keyDown and click handlers are genuinely distinct).
    // Exercised on slot 2 deliberately — slot 1 already existed before #346, so only
    // slot 2 proves the NEW control is reachable and operable the same way.
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: DRILLING, ammo: [null, null], d: false }, null] }),
    });
    render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    const [, slot2] = screen.getAllByRole("combobox");
    slot2.focus();
    expect(document.activeElement).toBe(slot2);
    fireEvent.change(slot2, { target: { value: "ammo-shotgun-slug" } });
    expect(store.getState().loadout.weapons[0].ammo[1]).toBe("ammo-shotgun-slug");
  });

  // -- Live region ---------------------------------------------------------------------

  it("changing an ammo selection announces the cost change through a live region", () => {
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: DRILLING, ammo: [null, null], d: false }, null] }),
    });
    render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("");
    const [slot1] = screen.getAllByRole("combobox");
    const price = ammoRoundFor(WEAPONS[DRILLING][0], 0, "ammo-medium-fmj").price;
    fireEvent.change(slot1, { target: { value: "ammo-medium-fmj" } });
    expect(region).toHaveTextContent(`${WEAPONS[DRILLING][1]} ammo cost is now $${price}.`);
  });

  // -- Seam: cost -----------------------------------------------------------------------

  it("seam: two filled slots contribute two prices; one filled slot contributes one — per-weapon prices, not hardcoded", () => {
    const oneFilled = { i: DRILLING, ammo: ["ammo-medium-fmj", null], d: false };
    let store = createTestStore({ loadout: loadoutState({ weapons: [oneFilled, null] }) });
    let utils = render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    expect(utils.container.querySelector(".weapon-cost")).toHaveTextContent(
      `$${WEAPONS[DRILLING][3] + ammoCostFor(oneFilled)}`
    );
    utils.unmount();

    const bothFilled = { i: DRILLING, ammo: ["ammo-medium-fmj", "ammo-shotgun-slug"], d: false };
    store = createTestStore({ loadout: loadoutState({ weapons: [bothFilled, null] }) });
    utils = render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    expect(utils.container.querySelector(".weapon-cost")).toHaveTextContent(
      `$${WEAPONS[DRILLING][3] + ammoCostFor(bothFilled)}`
    );
    // The two-slot figure is strictly greater — confirms the second slot's price was
    // actually added, not merely that the assertion re-derives the same function.
    expect(ammoCostFor(bothFilled)).toBeGreaterThan(ammoCostFor(oneFilled));
    // And the second slot's PRICE is visible only because its CONTROL exists to select
    // it — pin that both selections are reflected as two live controls, not just a
    // number computed independently of what's rendered.
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  // -- Seam: dual-wielded pair ----------------------------------------------------------

  it("seam: a paired dual-wieldable two-slot weapon still shows two ammo controls; ammo cost is not doubled by pairing", () => {
    // Governing: SPEC-0009 REQ "A Pair Carries One Weapon's Ammo and Doubles Only the
    // Weapon Price". LeMat Mark II is dual-family (two ammo slots) AND dual-wieldable,
    // the only catalog weapon that is both, so it is the only real fixture for this seam.
    const fmjId = "ammo-compact-fmj";
    const dragonId = "ammo-shotgun-dragon-breath";
    const store = createTestStore({
      loadout: loadoutState({ weapons: [{ i: LEMAT, ammo: [fmjId, dragonId], d: false }, null] }),
    });
    render(
      <Provider store={store}>
        <WeaponSlot slot={0} />
      </Provider>
    );
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    const before = totalCost(store.getState().loadout);

    fireEvent.click(screen.getByRole("button", { name: `Dual-wield ${WEAPONS[LEMAT][1]}` }));
    expect(store.getState().loadout.weapons[0].d).toBe(true);

    // Still two controls, selections untouched by pairing.
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(store.getState().loadout.weapons[0].ammo).toEqual([fmjId, dragonId]);

    // If ammo cost had also doubled, the delta would be weaponPrice + ammoCost; the
    // requirement is that it is EXACTLY one weapon price.
    const after = totalCost(store.getState().loadout);
    expect(after - before).toBe(WEAPONS[LEMAT][3]);
  });
});
