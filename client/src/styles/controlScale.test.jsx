import { describe, expect, it } from "vitest";
import { Provider } from "react-redux";
import { render, screen, within } from "@testing-library/react";
import ActionsPanel from "../components/ActionsPanel/ActionsPanel.jsx";
import LoadoutListsPanel from "../components/LoadoutListsPanel/LoadoutListsPanel.jsx";
import Picker from "../components/Picker/Picker.jsx";
import WeaponsPanel from "../components/WeaponsPanel/WeaponsPanel.jsx";
import { createTestStore, loadoutState } from "../test/testStore.js";
import { AMMO, WEAPONS } from "../data/catalog.js";
import {
  CSS_RULES,
  declarationsIn,
  effectiveDeclaration,
  parseStylesheet,
  readGlobalCss,
  resting,
  restingDeclaration,
} from "../test/cssRules.js";

// ---------------------------------------------------------------------------------------
// Issue #134 — one control size scale.
//
// NOT governed by an ADR or a spec, which the issue names as part of the problem: nothing
// wrote down what size a control should be, so seven of them were invented and a `<select>`
// got none at all. This file is where that omission is repaired — the scale is asserted here
// rather than described in prose that a stylesheet can quietly diverge from.
//
// It lives beside global.css rather than in any component's suite because the scale is
// app-wide BY CONSTRUCTION. It is consumed by the header, the picker, the equipment and
// weapons panels, the actions panel and the loadouts panel alike, and an assertion parked in
// one of those suites would silently stop covering the other five.
//
// EVERY ASSERTION HERE READS THE EXACT SELECTOR, through `resting()`. This repo has a
// documented failure mode of CSS tests that cannot fail — one helper joined every matching
// rule body so any rule anywhere satisfied it, and one assertion read a hover colour while
// claiming to check the resting one. `.btn:hover`, `.btn-outline:hover` and `.chip.active`
// all outrank their base rules on specificity, so a cascade-resolving read would answer for
// the wrong state. Geometry is a property of a control that nobody is pointing at.
// ---------------------------------------------------------------------------------------

const SHEET = readGlobalCss();

/** Every declaration of `property` on the `:root` block — i.e. the scale's own values. */
const token = (name) => {
  const root = CSS_RULES.find((rule) => rule.selectors.includes(":root"));
  const values = declarationsIn(root.body, name);
  if (!values.length) throw new Error(`:root declares no ${name}`);
  return values[values.length - 1];
};

/** `padding` and `font-size` as the exact rule for `selector` declares them. */
const geometry = (selector) => ({
  padding: resting(selector, "padding"),
  fontSize: resting(selector, "font-size"),
});

const px = (value) => Number.parseFloat(value);

describe("the control size scale exists in one place", () => {
  it("declares both steps as :root tokens", () => {
    // The acceptance criterion is that the scale "lives in one place with a comment explaining
    // which variant is for what, so the next control added has an obvious size to reach for".
    // These are the names that must exist for that to be true.
    expect(token("--control-pad-y")).toBe("12px");
    expect(token("--control-pad-x")).toBe("18px");
    expect(token("--field-pad-x")).toBe("12px");
    expect(token("--control-font")).toBe("17.5px");

    expect(token("--control-pad-y-sm")).toBe("9px");
    expect(token("--control-pad-x-sm")).toBe("14px");
    expect(token("--field-pad-x-sm")).toBe("10px");
    expect(token("--control-font-sm")).toBe("16.5px");
  });

  it("grew the small controls rather than shrinking the large ones", () => {
    // The load-bearing constraint. `.hp-fav` already records that 28px sits below WCAG 2.5.5's
    // 44px target; a scale that reached consistency by coming DOWN would have pushed more
    // controls under it. So every value in the scale is at least the largest that already
    // existed at its step, and these are those prior maxima, spelled out.
    //
    // default: .btn-primary's 12px padding-y and 17.5px font, .btn-gold/.btn-outline's 18px
    //          padding-x, .text-input's 12px field inset.
    // -sm:     .toggle-btn's 9px/14px, .number-input's 10px field inset and 16.5px font.
    const floors = {
      "--control-pad-y": 12, "--control-pad-x": 18, "--field-pad-x": 12, "--control-font": 17.5,
      "--control-pad-y-sm": 9, "--control-pad-x-sm": 14, "--field-pad-x-sm": 10, "--control-font-sm": 16.5,
    };
    for (const [name, floor] of Object.entries(floors)) {
      expect(px(token(name))).toBeGreaterThanOrEqual(floor);
    }
    // And the two steps stay ordered: -sm is the denser one, never accidentally the larger.
    expect(px(token("--control-pad-y-sm"))).toBeLessThan(px(token("--control-pad-y")));
    expect(px(token("--control-font-sm"))).toBeLessThan(px(token("--control-font")));
  });

  it("clears the 44px target at the default step and the 24px minimum at -sm", () => {
    // Not a measurement — jsdom lays nothing out. It is arithmetic on the declared values,
    // which is what the scale is: padding on both edges, plus a line box, plus two 1px borders.
    // The point is that the numbers chosen leave the default step above WCAG 2.5.5's 44px AAA
    // target rather than merely above where it started.
    const lineBox = (fontSize) => px(fontSize) * 1.2;
    const height = (padY, fontSize) => 2 * px(padY) + lineBox(fontSize) + 2;

    expect(height(token("--control-pad-y"), token("--control-font"))).toBeGreaterThanOrEqual(44);
    // SC 2.5.8 (AA) asks 24px; the dense step clears it with room rather than by a hair.
    expect(height(token("--control-pad-y-sm"), token("--control-font-sm"))).toBeGreaterThanOrEqual(24);
  });
});

describe("every button, input and select consumes the scale", () => {
  // The default step. `.btn-primary` is in here deliberately: its 12px/17.5px is what SET the
  // default step, so it consuming the tokens is what stops the scale drifting away from the
  // control it was measured from.
  it.each([
    [".btn", "--control-pad-x"],
    [".btn-primary", "--control-pad-x"],
    [".btn-gold", "--control-pad-x"],
    [".btn-outline", "--control-pad-x"],
    [".text-input", "--field-pad-x"],
    [".select", "--field-pad-x"],
  ])("sizes %s from the default step", (selector, xToken) => {
    const { padding, fontSize } = geometry(selector);
    expect(padding).toBe(`var(--control-pad-y) var(${xToken})`);
    expect(fontSize).toBe("var(--control-font)");
  });

  it.each([
    [".toggle-btn", "--control-pad-x-sm"],
    [".chip", "--control-pad-x-sm"],
    [".number-input", "--field-pad-x-sm"],
    [".select-sm", "--field-pad-x-sm"],
  ])("sizes %s from the -sm step", (selector, xToken) => {
    const { padding, fontSize } = geometry(selector);
    expect(padding).toBe(`var(--control-pad-y-sm) var(${xToken})`);
    expect(fontSize).toBe("var(--control-font-sm)");
  });

  it("writes no literal padding or font-size on any of them", () => {
    // The scale is only one place while nothing restates it. A literal here is how seven
    // geometries came about, so its ABSENCE is the assertion — a rule that hard-codes `10px
    // 16px` again fails this even though every var-based assertion above still passes.
    const scaled = [
      ".btn", ".btn-primary", ".btn-gold", ".btn-outline", ".toggle-btn", ".chip",
      ".text-input", ".number-input", ".select", ".select-sm",
    ];
    for (const selector of scaled) {
      for (const rule of CSS_RULES.filter((r) => r.selectors.some((s) => s === selector || s.startsWith(`${selector} `)))) {
        for (const property of ["padding", "font-size", "padding-top", "padding-bottom", "padding-left", "padding-right"]) {
          for (const value of declarationsIn(rule.body, property)) {
            expect(value, `${selector} { ${property}: ${value} }`).toMatch(/^var\(--/);
          }
        }
      }
    }
  });
});

describe("the pairs that were distinctions without a difference", () => {
  it("gives .btn-gold and .btn-outline one geometry, differing only in colour", () => {
    // They were two rules with byte-identical padding, font-size and letter-spacing. Asserting
    // the SHARED rule exists — rather than that the two happen to agree today — is what stops
    // them drifting apart again.
    const shared = CSS_RULES.find(
      (rule) => rule.selectors.includes(".btn-gold") && rule.selectors.includes(".btn-outline")
    );
    expect(shared, "no rule declares .btn-gold and .btn-outline together").toBeTruthy();
    expect(declarationsIn(shared.body, "padding")).toHaveLength(1);
    expect(declarationsIn(shared.body, "font-size")).toHaveLength(1);

    // Each modifier carries colour and nothing that changes its size or shape.
    for (const selector of [".btn-gold", ".btn-outline"]) {
      const own = CSS_RULES.filter((r) => r.selectors.length === 1 && r.selectors[0] === selector);
      const properties = own.flatMap((r) => [...r.body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map(([, p]) => p));
      expect(properties.sort()).not.toContain("padding");
      expect(properties).not.toContain("font-size");
      for (const property of properties) expect(property).toMatch(/color/);
    }
  });

  it("gives .toggle-btn and .chip one geometry, differing only in their on/active colours", () => {
    // These differed by half a pixel of font size, which is not a difference anyone chose.
    const shared = CSS_RULES.find(
      (rule) => rule.selectors.includes(".toggle-btn") && rule.selectors.includes(".chip")
    );
    expect(shared, "no rule declares .toggle-btn and .chip together").toBeTruthy();
    // Declared ONCE, in the shared rule — not twice in agreement, which is the state they were
    // in before and the state they drifted out of.
    for (const selector of [".toggle-btn", ".chip"]) {
      const declaring = CSS_RULES.filter(
        (rule) => rule.selectors.includes(selector) && declarationsIn(rule.body, "padding").length
      );
      expect(declaring, `${selector} padding declared in ${declaring.length} rules`).toHaveLength(1);
      expect(declaring[0]).toBe(shared);
    }
  });

  it("leaves the square hit targets out of the text-control scale", () => {
    // `.size-chip` and `.icon-btn` are deliberately excluded: their size IS their shape, and
    // giving them a text control's horizontal padding would stretch them into lozenges. Pinned
    // so a later pass "finishing the job" has to argue with a test rather than with a comment.
    expect(resting(".size-chip", "min-width")).toBe("34px");
    expect(resting(".size-chip", "height")).toBe("34px");
    expect(restingDeclaration(".size-chip", "padding")).toBeNull();
    expect(resting(".icon-btn", "width")).toBe("28px");
    expect(resting(".icon-btn", "height")).toBe("28px");
    expect(restingDeclaration(".icon-btn", "padding")).toBeNull();
  });
});

describe("dropdowns have an explicit contract", () => {
  it("no longer sizes a bare select element", () => {
    // The bigger half of the issue: selects never got a class, so they fell through to
    // `select { padding: 6px 8px }` — a geometry that matched no button in the app, which is
    // why every dropdown sat visibly short of the control beside it.
    for (const rule of CSS_RULES.filter((r) => r.selectors.includes("select"))) {
      for (const property of ["padding", "font-size", "background", "border"]) {
        expect(declarationsIn(rule.body, property), `select { ${property} }`).toHaveLength(0);
      }
    }
    // The shared class carries it instead.
    expect(resting(".select", "background")).toBe("var(--input-bg)");
    expect(resting(".select-sm", "background")).toBe("var(--input-bg)");
  });

  it("has no per-site padding or font-size override on a select anywhere", () => {
    // The criterion is that these are REMOVED rather than added to. A descendant rule may set
    // width — that is the call site's layout — but the moment one sets a size, the scale has
    // stopped being the answer and the next call site will patch around it too.
    const perSite = CSS_RULES.filter((rule) =>
      rule.selectors.some((s) => /\bselect\b/.test(s) && s !== "select" && !/^\.select(-sm)?$/.test(s.trim()))
    );
    expect(perSite.length, "expected .ll-lcard-move select to still exist").toBeGreaterThan(0);
    for (const rule of perSite) {
      for (const property of ["padding", "font-size"]) {
        expect(declarationsIn(rule.body, property), `${rule.selectors.join(", ")} { ${property} }`).toHaveLength(0);
      }
    }
  });
});

describe("the rules that hold the scale in place can fail", () => {
  // The assertions above are only worth their runtime if they go red when the thing they
  // describe stops being true. Each stylesheet below is global.css plus one edit of the kind
  // that would silently reintroduce the problem, read through the same helpers.
  const paddingOf = (css, selector) =>
    parseStylesheet(css)
      .filter((rule) => rule.selectors.includes(selector))
      .flatMap((rule) => declarationsIn(rule.body, "padding"))
      .pop() ?? null;

  it("sees a literal that replaces a token", () => {
    expect(paddingOf(SHEET, ".btn")).toBe("var(--control-pad-y) var(--control-pad-x)");
    expect(paddingOf(`${SHEET}\n.btn { padding: 10px 16px }`, ".btn")).toBe("10px 16px");
  });

  it("sees a select size override coming back", () => {
    const overridden = parseStylesheet(`${SHEET}\n.hp-filter select { padding: 4px 8px }`);
    const offenders = overridden.filter(
      (rule) => rule.selectors.some((s) => /\bselect\b/.test(s) && s !== "select" && !/^\.select(-sm)?$/.test(s.trim()))
    );
    expect(offenders.flatMap((r) => declarationsIn(r.body, "padding"))).toContain("4px 8px");
  });

  it("distinguishes a resting geometry from a hover one", () => {
    // The specific trap this repo has been caught by. A `:hover` rule declaring padding must
    // NOT be able to answer for the base selector — `resting()` reads the exact selector, while
    // a cascade-resolving read would take the hover value because it is more specific.
    const withHover = `${SHEET}\n.btn:hover { padding: 99px }`;
    expect(paddingOf(withHover, ".btn")).toBe("var(--control-pad-y) var(--control-pad-x)");
    expect(effectiveDeclaration(parseStylesheet(withHover), ".btn", "padding")).toBe("99px");
  });
});

// ---------------------------------------------------------------------------------------
// And the rendered half: the classes actually reach the elements. A stylesheet that declares
// a perfect scale nothing wears is the same bug in a different file.
// ---------------------------------------------------------------------------------------

const withStore = (preloaded, ui) =>
  render(
    <Provider store={createTestStore(preloaded)}>{ui}</Provider>
  );

// `weapons[n].i` is an INDEX into WEAPONS, and the ammo select only renders for a weapon whose
// ammo family has variants — the whole point of the slot is that dropdown.
const WEAPON_WITH_AMMO = WEAPONS.findIndex((w) => (AMMO[w[4]] || []).length > 0);

const baseState = (overrides = {}) => ({
  loadout: loadoutState(),
  loadoutLists: { items: [], status: "succeeded", error: null },
  savedLoadouts: { items: [], status: "succeeded", error: null },
  ...overrides,
});

describe("every rendered select carries the contract", () => {
  it("classes the loadout-lists sort control and the move control", () => {
    const listRecord = { id: "a", name: "Alpha", hunterId: null, accent: "#b04a3e", createdAt: "2026-01-01" };
    withStore(
      baseState({
        loadoutLists: { items: [listRecord], status: "succeeded", error: null },
        savedLoadouts: {
          items: [{ id: "1", name: "long ammo", data: {}, listId: "a", updatedAt: "2026-01-01" }],
          status: "succeeded",
          error: null,
        },
        ui: { ...createTestStore().getState().ui, selectedListId: "a" },
      }),
      <LoadoutListsPanel />
    );

    // The header's sort dropdown sits on a row with "+ New list" — the worst instance the
    // issue names, a bare select at 6px/8px beside a .btn-outline at 10px/18px.
    expect(screen.getByLabelText("Order lists by")).toHaveClass("select");
    // The move control on a loadout card takes the dense step.
    expect(screen.getByLabelText("List for long ammo")).toHaveClass("select-sm");
  });

  it("classes the weapon slot's ammo control, with no inline font size left on it", () => {
    withStore(
      baseState({ loadout: loadoutState({ weapons: [{ i: WEAPON_WITH_AMMO, a: -1 }, null] }) }),
      <WeaponsPanel />
    );
    const ammo = document.querySelector(".ammo-row select");
    expect(ammo).toHaveClass("select-sm");
    // The inline `fontSize: 15.5` was a local patch over the bare element rule. An inline size
    // outranks the whole stylesheet, so leaving one behind would exempt this control from the
    // scale entirely while every CSS assertion above stayed green.
    expect(ammo.style.fontSize).toBe("");
  });

  it("leaves no select in the app without one of the two classes", () => {
    // Swept rather than enumerated: a select added later with no class renders at browser
    // defaults, which is exactly the state this issue was filed about.
    const listRecord = { id: "a", name: "Alpha", hunterId: null, accent: "#b04a3e", createdAt: "2026-01-01" };
    withStore(
      baseState({
        loadout: loadoutState({ weapons: [{ i: WEAPON_WITH_AMMO, a: -1 }, null] }),
        loadoutLists: { items: [listRecord], status: "succeeded", error: null },
        savedLoadouts: {
          items: [{ id: "1", name: "long ammo", data: {}, listId: "a", updatedAt: "2026-01-01" }],
          status: "succeeded",
          error: null,
        },
        ui: { ...createTestStore().getState().ui, selectedListId: "a" },
      }),
      <>
        <ActionsPanel />
        <WeaponsPanel />
        <LoadoutListsPanel />
        <Picker />
      </>
    );

    const selects = [...document.querySelectorAll("select")];
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(
        select.classList.contains("select") || select.classList.contains("select-sm"),
        `<select> with class "${select.className}" carries neither .select nor .select-sm`
      ).toBe(true);
    }
  });
});

describe("the controls that share a row share a step", () => {
  it("puts the actions row and the save row on the default step", () => {
    withStore(baseState({ ui: createTestStore().getState().ui }), <ActionsPanel />);

    const actionsRow = document.querySelector(".actions-row");
    expect(within(actionsRow).getByRole("button", { name: "Random loadout" })).toHaveClass("btn-primary");
    expect(within(actionsRow).getByRole("button", { name: "Clear" })).toHaveClass("btn");

    const saveRow = document.querySelector(".save-row");
    expect(saveRow.querySelector("input")).toHaveClass("text-input");
    expect(within(saveRow).getByRole("button", { name: /^Save to / })).toHaveClass("btn-gold");
    expect(within(saveRow).getByRole("button", { name: "Share link" })).toHaveClass("btn-outline");
  });

  it("puts the budget row's toggle and its number field on the same -sm step", () => {
    // The row that would have mismatched had `.toggle-btn` gone to the default step while
    // `.number-input` stayed dense. Both are -sm, which is what makes them the same height.
    withStore(
      baseState({ ui: { ...createTestStore().getState().ui, budgetOn: true } }),
      <ActionsPanel />
    );
    const row = document.querySelector(".budget-row");
    expect(within(row).getByRole("button", { name: /^Budget/ })).toHaveClass("toggle-btn");
    expect(row.querySelector("input[type=number]")).toHaveClass("number-input");
  });

  it("classes the create form's name field, which had no class at all", () => {
    withStore(
      baseState({ ui: { ...createTestStore().getState().ui, creatingList: true } }),
      <LoadoutListsPanel />
    );
    expect(screen.getByLabelText("New list name")).toHaveClass("text-input");
  });
});
