import { describe, expect, it } from "vitest";
import { Provider } from "react-redux";
import { fireEvent, render, screen, within } from "@testing-library/react";
import ActionsPanel from "../components/ActionsPanel/ActionsPanel.jsx";
import RandomizerPanel from "../components/RandomizerPanel/RandomizerPanel.jsx";
import LoadoutListsPanel from "../components/LoadoutListsPanel/LoadoutListsPanel.jsx";
import Picker from "../components/Picker/Picker.jsx";
import WeaponsPanel from "../components/WeaponsPanel/WeaponsPanel.jsx";
import { createTestStore, loadoutState } from "../test/testStore.js";
import { AMMO, WEAPONS } from "../data/catalog.js";
import {
  CSS_RULES,
  declarationsIn,
  effectiveDeclaration,
  family,
  parseStylesheet,
  readGlobalCss,
  resting,
  restingDeclaration,
  restingDeclarationIn,
  specificity,
  targets,
  token,
  tokenIn,
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
//
// AND IT ASSERTS THE OUTPUT OF THE SCALE, NOT ONLY ITS INPUTS. The first version of this
// file read padding and font-size and stopped there. Padding and font-size are what go INTO
// a control's height; the tokens that decide the height itself — `--control-line`,
// `--control-h` and their -sm twins — appeared nowhere, so deleting `height: var(--control-h)`
// from `.select` (the single line that makes a dropdown 50px instead of 52px, i.e. the entire
// point of the issue) left the suite green, as did `--control-h: 50px → 62px` and
// `--control-line: 24px → normal`. That is the same shape of gap that let the original 2px
// mismatch ship. The height arithmetic is asserted directly below.
// ---------------------------------------------------------------------------------------

const SHEET = readGlobalCss();

const px = (value) => Number.parseFloat(value);

/** The two steps, named by the tokens that define them. */
const STEPS = {
  default: {
    name: "default",
    padY: "--control-pad-y",
    line: "--control-line",
    height: "--control-h",
  },
  sm: {
    name: "-sm",
    padY: "--control-pad-y-sm",
    line: "--control-line-sm",
    height: "--control-h-sm",
  },
};

// Every control the scale covers, the step it takes, and the token its horizontal inset comes
// from. Fields take a tighter inset than buttons at the same step — see the note in :root.
// `height` is listed only for the selects, because they are the only controls that declare
// one: everything else lands on the step's total by arithmetic, and a height on any of them
// would be a second, competing source of truth.
const SCALE = [
  { selector: ".btn", step: "default", padX: "--control-pad-x" },
  { selector: ".btn-primary", step: "default", padX: "--control-pad-x" },
  { selector: ".btn-gold", step: "default", padX: "--control-pad-x" },
  { selector: ".btn-outline", step: "default", padX: "--control-pad-x" },
  { selector: ".text-input", step: "default", padX: "--field-pad-x" },
  { selector: ".select", step: "default", padX: "--field-pad-x", declaresHeight: true },
  { selector: ".toggle-btn", step: "sm", padX: "--control-pad-x-sm" },
  { selector: ".chip", step: "sm", padX: "--control-pad-x-sm" },
  { selector: ".number-input", step: "sm", padX: "--field-pad-x-sm" },
  { selector: ".select-sm", step: "sm", padX: "--field-pad-x-sm", declaresHeight: true },
];

const SCALED = SCALE.map((c) => c.selector);

/** `padding` and `font-size` as the exact rule for `selector` declares them. */
const geometry = (selector) => ({
  padding: resting(selector, "padding"),
  fontSize: resting(selector, "font-size"),
});

// --- the three predicates the scale rests on, each as a function of a parsed stylesheet -----
//
// Written against `rules` rather than against global.css directly so each can be RUN AGAINST A
// MUTATION and shown to bite. Previously the floor check and the WCAG check restated numbers
// that the exact-value test above them already pinned, so neither could go red on its own: any
// edit that broke them broke that test first, and they were decoration. Below, each asserts on
// the real sheet and then falsifies itself on a doctored one.

/** Every scale token whose value has dropped below the largest that existed before it. */
const floorViolations = (rules, floors) =>
  Object.entries(floors).filter(([name, floor]) => px(tokenIn(rules, name)) < floor).map(([name]) => name);

/**
 * A step's total rendered height, from its own tokens: padding on both edges, the line box,
 * and two 1px borders.
 *
 * The line box is `--control-line`, which is what the stylesheet actually applies. It used to
 * be `font-size * 1.2` — a ratio global.css uses nowhere, which put the default step at 47px
 * and left the WCAG 2.5.5 claim resting on a number no control has ever rendered at.
 */
const stepHeight = (rules, step) => 2 * px(tokenIn(rules, step.padY)) + px(tokenIn(rules, step.line)) + 2;

/** The height the step DECLARES, which selects take verbatim. */
const declaredHeight = (rules, step) => px(tokenIn(rules, step.height));

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

  it("reads the token the cascade ends on, not the first one written", () => {
    // `:root` is not a single block by decree, and the last unconditional declaration wins.
    // Reading the first meant an appended `:root { --control-pad-y: 4px }` — or a themed
    // block near the bottom of the file — moved every control in the app with every
    // assertion in this file still green.
    expect(tokenIn(parseStylesheet(`${SHEET}\n:root { --control-pad-y: 4px }`), "--control-pad-y")).toBe("4px");
    // A CONDITIONAL redefinition is refused rather than ignored: it is a cascade this helper
    // does not model, and answering with the unconditional value would be answering a
    // question nobody asked.
    const conditional = parseStylesheet(
      `${SHEET}\n@media (prefers-color-scheme: light) { :root { --control-pad-y: 4px } }`
    );
    expect(() => tokenIn(conditional, "--control-pad-y")).toThrow(/prefers-color-scheme/);
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
    expect(floorViolations(CSS_RULES, floors)).toEqual([]);
    // And the two steps stay ordered: -sm is the denser one, never accidentally the larger.
    expect(px(token("--control-pad-y-sm"))).toBeLessThan(px(token("--control-pad-y")));
    expect(px(token("--control-font-sm"))).toBeLessThan(px(token("--control-font")));

    // The check is not decoration: a sheet that shrinks a control to reach consistency names
    // the offender.
    const shrunk = parseStylesheet(`${SHEET}\n:root { --control-pad-y: 8px; --control-font-sm: 14px }`);
    expect(floorViolations(shrunk, floors)).toEqual(["--control-pad-y", "--control-font-sm"]);
  });

  it("clears the 44px target at the default step and the 24px minimum at -sm", () => {
    // Not a measurement — jsdom lays nothing out. It is arithmetic on the declared values,
    // which is what the scale is: padding on both edges, plus the line box the stylesheet
    // pins, plus two 1px borders. The point is that the numbers chosen leave the default step
    // above WCAG 2.5.5's 44px AAA target rather than merely above where it started.
    expect(stepHeight(CSS_RULES, STEPS.default)).toBeGreaterThanOrEqual(44);
    // SC 2.5.8 (AA) asks 24px; the dense step clears it with room rather than by a hair.
    expect(stepHeight(CSS_RULES, STEPS.sm)).toBeGreaterThanOrEqual(24);

    // Same falsification: a line-height trimmed to fit more on screen drops the default step
    // under the target, and this check is what says so.
    const trimmed = parseStylesheet(`${SHEET}\n:root { --control-line: 12px }`);
    expect(stepHeight(trimmed, STEPS.default)).toBeLessThan(44);
  });

  it("pins each step's height to the arithmetic of its own tokens", () => {
    // THE INVARIANT THE WHOLE SCALE HANGS ON, and the one that was unasserted:
    //
    //   --control-h    === 2 * --control-pad-y    + --control-line    + 2   (50 = 12+12+24+2)
    //   --control-h-sm === 2 * --control-pad-y-sm + --control-line-sm + 2   (43 =  9+ 9+23+2)
    //
    // `--control-h` is what a <select> takes, because a select sizes its content box from a
    // UA intrinsic minimum and ignores line-height; every other control lands on the same
    // total from padding and line box alone. If the two sides of this equation drift, a
    // dropdown is a different height from the button beside it — which is issue #134, exactly
    // and entirely.
    expect(stepHeight(CSS_RULES, STEPS.default)).toBe(declaredHeight(CSS_RULES, STEPS.default));
    expect(declaredHeight(CSS_RULES, STEPS.default)).toBe(50);

    expect(stepHeight(CSS_RULES, STEPS.sm)).toBe(declaredHeight(CSS_RULES, STEPS.sm));
    expect(declaredHeight(CSS_RULES, STEPS.sm)).toBe(43);

    // The `+ 2` is two 1px borders, and it is only a border-box height because of this rule.
    // Under `content-box` every control would render 2px taller than the token says.
    const boxSizing = CSS_RULES.filter((r) => r.selectors.includes("*")).flatMap((r) =>
      declarationsIn(r.body, "box-sizing")
    );
    expect(boxSizing).toContain("border-box");
  });

  it("refuses `normal`, which is what the line-height tokens exist to replace", () => {
    // `line-height: normal` is resolved by the UA per element type, and a <select>'s
    // intrinsic content box is taller than a <button>'s — the 52px-vs-50px gap the issue was
    // filed about. A token reverting to `normal` makes the arithmetic above unevaluable,
    // which is the correct outcome and is asserted rather than assumed.
    for (const step of Object.values(STEPS)) {
      expect(token(step.line), `${step.name} line-height`).toMatch(/^\d+(\.\d+)?px$/);
    }
    const reverted = parseStylesheet(`${SHEET}\n:root { --control-line: normal }`);
    expect(stepHeight(reverted, STEPS.default)).toBeNaN();
  });
});

describe("every button, input and select consumes the scale", () => {
  // The default step. `.btn-primary` is in here deliberately: its 12px/17.5px is what SET the
  // default step, so it consuming the tokens is what stops the scale drifting away from the
  // control it was measured from.
  it.each(SCALE.filter((c) => c.step === "default").map((c) => [c.selector, c.padX]))(
    "sizes %s from the default step",
    (selector, xToken) => {
      const { padding, fontSize } = geometry(selector);
      expect(padding).toBe(`var(--control-pad-y) var(${xToken})`);
      expect(fontSize).toBe("var(--control-font)");
    }
  );

  it.each(SCALE.filter((c) => c.step === "sm").map((c) => [c.selector, c.padX]))(
    "sizes %s from the -sm step",
    (selector, xToken) => {
      const { padding, fontSize } = geometry(selector);
      expect(padding).toBe(`var(--control-pad-y-sm) var(${xToken})`);
      expect(fontSize).toBe("var(--control-font-sm)");
    }
  );

  it.each(SCALE.map((c) => [c.selector, STEPS[c.step].line]))(
    "gives %s the line-height of its own step",
    (selector, lineToken) => {
      // The half of the scale that was declared and never asserted. `.number-input` is why
      // this test exists as a sweep rather than a spot check: it took `--control-line` (the
      // DEFAULT step's 24px) while its padding and font were -sm, so it rendered 44px between
      // two 43px toggles on the budget row — #134's own defect, reintroduced by #134's fix,
      // with a test one line above claiming in prose that the row matched.
      expect(resting(selector, "line-height")).toBe(`var(${lineToken})`);
    }
  );

  it.each(SCALE.map((c) => [c.selector, c.declaresHeight ? STEPS[c.step].height : null]))(
    "settles %s's height the one way its control type allows",
    (selector, heightToken) => {
      if (heightToken) {
        // Selects, and only selects. `appearance: auto` sizes the content box from a UA
        // intrinsic minimum and ignores line-height, so the step's total has to be stated
        // outright — this is the line whose deletion left 453/453 green.
        expect(resting(selector, "height")).toBe(`var(${heightToken})`);
      } else {
        // Everything else derives it. A height here would be a second source of truth that
        // agrees with the arithmetic today and stops agreeing the first time a token moves.
        expect(restingDeclaration(selector, "height")).toBeNull();
      }
      // Neither kind may set a floor or a ceiling: both diverge from the declared step while
      // padding, font-size and line-height all still read correctly.
      expect(restingDeclaration(selector, "min-height")).toBeNull();
      expect(restingDeclaration(selector, "max-height")).toBeNull();
    }
  );

  it.each(SCALE.map((c) => [c.selector]))("gives %s the 1px border the arithmetic assumes", (selector) => {
    // The `+ 2` in every step total. A 2px border makes the control 2px taller than its token
    // says while padding, font-size and line-height all still read correctly — the same class
    // of divergence the height tokens exist to prevent.
    expect(resting(selector, "border")).toMatch(/^1px\b/);
    for (const property of family("border").filter((p) => /width/.test(p))) {
      expect(restingDeclaration(selector, property), `${selector} { ${property} }`).toBeNull();
    }
  });

  it("leaves the selects' native appearance alone, which is why they need a height at all", () => {
    // Recorded as a decision rather than left implicit: `appearance: none` would also fix the
    // select's height, at the cost of hand-rolling a disclosure arrow on every platform. The
    // height token is the smaller answer, and it is the RIGHT answer only while the control
    // is still a native select. Changing this changes the reasoning, so it fails a test.
    expect(restingDeclaration(".select", "appearance")).toBeNull();
    expect(restingDeclaration(".select-sm", "appearance")).toBeNull();
    expect(restingDeclaration(".select", "-webkit-appearance")).toBeNull();
    expect(restingDeclaration(".select-sm", "-webkit-appearance")).toBeNull();
  });

  it("writes no literal padding or font-size on any of them", () => {
    // The scale is only one place while nothing restates it. A literal here is how seven
    // geometries came about, so its ABSENCE is the assertion — a rule that hard-codes `10px
    // 16px` again fails this even though every var-based assertion above still passes.
    //
    // Through `family()`, so `padding-left` is as visible as `padding`. Property matching is
    // exact by name, which is right for reading a value and wrong for asserting an absence.
    const properties = [...family("padding"), "font-size", "line-height"];
    for (const selector of SCALED) {
      for (const rule of CSS_RULES.filter((r) => r.selectors.some((s) => s === selector || s.startsWith(`${selector} `)))) {
        for (const property of properties) {
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

// ---------------------------------------------------------------------------------------
// No call site patches around the scale.
//
// The base rules being right is half of "one scale". The other half is that nothing anywhere
// restates a size for a control that has one — the pattern the issue describes as "each call
// site patched the difference locally", which is how the scale stops being the answer.
//
// The guard used to cover `select` alone, matched by element name, so `.actions-row .btn-gold
// { padding: 4px 8px }` and `.btn:hover { padding: 2px 4px }` were both still permitted. It
// covers every scaled class and the three control ELEMENTS now: a descendant rule can reach a
// control either way.
// ---------------------------------------------------------------------------------------

const BARE_ELEMENTS = ["select", "button", "input"];

/** Every property that decides how tall a control renders, shorthands expanded. */
const GEOMETRY_PROPERTIES = [
  ...family("padding"),
  "font-size", "line-height", "height", "min-height", "max-height",
  ...family("border").filter((p) => /width/.test(p)),
];

/**
 * Selectors that reach a scaled control from somewhere OTHER than its own base rule —
 * ancestor-scoped (`.actions-row .btn-gold`), state-pseudo (`.btn:hover`), compound
 * (`.chip.active`), or by element name (`.hp-filter select`).
 */
const isPerSiteOverride = (selector) => {
  const s = selector.trim();
  if (SCALED.includes(s) || BARE_ELEMENTS.includes(s)) return false;
  const rightmost = s.split(/[\s>+~]+/).filter(Boolean).pop() || "";
  const byClass = SCALED.some((base) => targets(s, base.slice(1)));
  const byElement = BARE_ELEMENTS.some((el) => new RegExp(`(^|[^\\w\\-.])${el}(?![\\w-])`).test(rightmost));
  return byClass || byElement;
};

const perSiteOverrides = (rules) =>
  rules.flatMap((rule) => (rule.selectors.some(isPerSiteOverride) ? [rule] : []));

const sizesDeclaredBy = (rules) =>
  perSiteOverrides(rules).flatMap((rule) =>
    GEOMETRY_PROPERTIES.flatMap((property) =>
      declarationsIn(rule.body, property).map((value) => `${rule.selectors.join(", ")} { ${property}: ${value} }`)
    )
  );

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

  it("has no per-site size override on any control anywhere", () => {
    // The criterion is that these are REMOVED rather than added to. A descendant rule may set
    // width — that is the call site's layout — but the moment one sets a size, the scale has
    // stopped being the answer and the next call site will patch around it too.
    const reached = perSiteOverrides(CSS_RULES);
    expect(reached.length, "the guard matched nothing at all, so it proves nothing").toBeGreaterThan(4);
    // The states and call sites it is actually watching, named so a refactor that renames them
    // out of the guard's reach is visible rather than silent.
    const selectors = reached.flatMap((r) => r.selectors.filter(isPerSiteOverride));
    for (const expected of [".btn:hover", ".chip.active", ".toggle-btn.on", ".ll-lcard-move select"]) {
      expect(selectors).toContain(expected);
    }
    expect(sizesDeclaredBy(CSS_RULES)).toEqual([]);
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

  it("sees a size override coming back, on a select OR on a button", () => {
    const overridden = parseStylesheet(
      `${SHEET}\n.hp-filter select { padding: 4px 8px }\n.actions-row .btn-gold { padding: 4px 8px }\n.btn:hover { padding: 2px 4px }`
    );
    expect(sizesDeclaredBy(overridden)).toEqual([
      ".hp-filter select { padding: 4px 8px }",
      ".actions-row .btn-gold { padding: 4px 8px }",
      ".btn:hover { padding: 2px 4px }",
    ]);
  });

  it("sees a shorthand written as a longhand", () => {
    // `padding-left` used to be invisible where `padding` was asserted, which is a patch this
    // guard was meant to catch wearing a different name.
    const sneaky = parseStylesheet(`${SHEET}\n.actions-row .btn { padding-left: 4px }`);
    expect(sizesDeclaredBy(sneaky)).toEqual([".actions-row .btn { padding-left: 4px }"]);
  });

  it("weighs a pseudo-element as a type selector rather than as a class", () => {
    // `specificity()` ordered `effective()`'s candidates, and its pseudo-CLASS alternative was
    // satisfied starting from the second colon of a `::` sequence — so `::after` scored 100
    // instead of 1 and a pseudo-element rule outranked a two-class one that really beats it.
    expect(specificity(".ll-card-open::after")).toBeLessThan(specificity(".ll-card.ll-card-open"));
    expect(specificity("::-webkit-scrollbar")).toBe(specificity("div"));
    // The pseudo-CLASS reading is untouched: `:hover` is still a class-weight selector.
    expect(specificity(".btn:hover")).toBe(specificity(".btn.on"));
  });

  it("distinguishes a resting geometry from a hover one", () => {
    // The specific trap this repo has been caught by. A `:hover` rule declaring padding must
    // NOT be able to answer for the base selector — `resting()` reads the exact selector, while
    // a cascade-resolving read would take the hover value because it is more specific.
    const withHover = `${SHEET}\n.btn:hover { padding: 99px }`;
    expect(paddingOf(withHover, ".btn")).toBe("var(--control-pad-y) var(--control-pad-x)");
    expect(effectiveDeclaration(parseStylesheet(withHover), ".btn", "padding")).toBe("99px");
  });

  it("refuses a geometry restated inside a media query rather than ignoring it", () => {
    // `resting()` is what every geometry assertion in this file goes through, and it used to
    // read the unconditional value and say nothing about a conditional one — so a
    // `@media (prefers-color-scheme: light)` block could restate any of them unseen.
    const conditional = parseStylesheet(
      `${SHEET}\n@media (prefers-color-scheme: light) { .btn { padding: 2px 4px } }`
    );
    expect(() => restingDeclarationIn(conditional, ".btn", "padding")).toThrow(/prefers-color-scheme/);
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
    //
    // THE SWEEP HAS TO MOUNT THE SELECTS TO SWEEP THEM. It used to render `Picker`, which has
    // none, and `HunterPicker`'s two — the ones this issue put `.select` on — only exist while
    // the create form has the portrait dialog open, which no state here set. Removing either
    // class survived the sweep entirely. The dialog is opened below, from the create form, by
    // the same route a user takes.
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
        ui: { ...createTestStore().getState().ui, selectedListId: "a", creatingList: true },
      }),
      <>
        <ActionsPanel />
        <WeaponsPanel />
        <LoadoutListsPanel />
        <Picker />
      </>
    );

    fireEvent.click(screen.getByRole("button", { name: /^Portrait:/ }));
    // The hunter picker's two filter dropdowns, which are only reachable this way.
    expect(screen.getByLabelText("Filter by acquisition")).toBeTruthy();
    expect(screen.getByLabelText("Filter by availability")).toBeTruthy();

    const selects = [...document.querySelectorAll("select")];
    expect(selects.length).toBeGreaterThanOrEqual(5);
    for (const select of selects) {
      expect(
        select.classList.contains("select") || select.classList.contains("select-sm"),
        `<select> with class "${select.className}" carries neither .select nor .select-sm`
      ).toBe(true);
    }
  });
});

describe("the controls that share a row share a step", () => {
  it("puts the randomizer's row and the save row on the default step", () => {
    // Random loadout and Clear moved to RandomizerPanel when it was split out to sit beside
    // the traits grid. The rule they were pinning is unchanged — controls sharing a row share
    // a sizing step — so the assertion followed them rather than being dropped.
    withStore(baseState({ ui: createTestStore().getState().ui }), <RandomizerPanel />);
    const randomizerRow = document.querySelector(".randomizer-actions");
    expect(within(randomizerRow).getByRole("button", { name: "Random loadout" })).toHaveClass("btn-primary");
    expect(within(randomizerRow).getByRole("button", { name: "Clear" })).toHaveClass("btn");

    withStore(baseState({ ui: createTestStore().getState().ui }), <ActionsPanel />);
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

    // And the same height, which is the claim this test was making in prose while checking
    // only the padding token. `.number-input` was 44px between two 43px toggles, because its
    // line-height came from the default step.
    for (const selector of [".toggle-btn", ".number-input"]) {
      expect(resting(selector, "line-height")).toBe("var(--control-line-sm)");
      expect(resting(selector, "padding")).toMatch(/^var\(--control-pad-y-sm\)/);
      expect(resting(selector, "font-size")).toBe("var(--control-font-sm)");
    }
  });

  it("classes the create form's name field, which had no class at all", () => {
    withStore(
      baseState({ ui: { ...createTestStore().getState().ui, creatingList: true } }),
      <LoadoutListsPanel />
    );
    expect(screen.getByLabelText("New list name")).toHaveClass("text-input");
  });
});
