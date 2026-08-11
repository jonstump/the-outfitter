// Reading declarations out of global.css, for tests.
//
// EXTRACTED from LoadoutListsPanel.test.jsx (issue #134), unchanged in behaviour. The control
// size scale is app-wide by construction — it is consumed by the header, the picker, the
// equipment and weapons panels and the loadouts panel alike — so the assertions that hold it
// in place cannot live inside one component's suite. Two copies of a cascade resolver is how
// the two copies disagree, and the failure mode this file exists to prevent is precisely a
// helper that quietly answers a question other than the one asked.
//
// WHAT THIS DOES AND DOES NOT COVER, stated plainly, because the first version of this helper
// claimed the opposite of what it did:
//
//   * `effective()` DOES resolve the declaration the cascade would actually apply, among the
//     rules in global.css that can match an element carrying the given class: highest
//     specificity wins, and among equal specificity the last in source order wins. A later
//     `.ll-lp { min-width: 0 }`, or a higher-specificity `.panel .ll-lp { min-width: 12px }`,
//     therefore CHANGES the answer instead of being absorbed into it.
//   * BOTH `effective()` and `resting()` REFUSE to answer at all when a conditional at-rule
//     (`@media`, `@supports`, `@container`) declares the same property for the same selector —
//     that is a cascade this helper does not model, and silently merging it into the
//     unconditional bucket is what the old parse did. They throw, loudly, rather than guessing.
//     This paragraph claimed only `effective()` refused while `resting()` — which every
//     geometry assertion in the suite goes through — quietly ignored conditions, so a
//     `@media (prefers-color-scheme: light)` block could restate any of them unseen.
//   * It does NOT measure anything. jsdom performs no layout, so no assertion here is evidence
//     of a rendered pixel width. What it proves is which declaration a rule carries. Rendered
//     widths and heights are verified outside the suite, in a browser.
//   * It does NOT model `!important`, inline style, `@layer`, or `:where()`/`:is()`
//     specificity. global.css uses none of them for these selectors; `effective()` throws if it
//     meets `!important` so that stays true.
//
// `resting()` is the OTHER question, and mixing the two up is a documented failure mode in this
// repo: `effective()` matches by rightmost compound, so `.btn:hover` answers for `.btn` and,
// being more specific, outranks it. Anything about a control's appearance when nobody is
// pointing at it — geometry, contrast, the resting affordance — must use `resting()`.
//
// Located from the working directory rather than from `import.meta.url`, which under the jsdom
// environment resolves against the dev server's origin rather than the filesystem. Either
// candidate is right depending on whether the runner was started in the workspace or at the
// repo root; neither existing is a broken test, not a skipped one.

import { existsSync, readFileSync } from "node:fs";

export const CSS_PATH = ["src/styles/global.css", "client/src/styles/global.css"].find(existsSync);

/** The stylesheet's text, for tests that build a variant of it to prove a helper can fail. */
export const readGlobalCss = () => readFileSync(CSS_PATH, "utf8");

// Comments are stripped before parsing so prose about widths and floors can never satisfy —
// or break — an assertion about declarations.
export function parseStylesheet(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const conditions = [];
  let prelude = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // A statement at-rule (`@import`, `@charset`) ends at its semicolon and opens nothing.
    if (ch === ";" && !prelude.includes("{")) {
      prelude = "";
      continue;
    }
    if (ch === "{") {
      const head = prelude.trim();
      prelude = "";
      if (head.startsWith("@")) {
        // A nested at-rule. Keyframes and font-face hold no selectors worth matching; the
        // conditional group rules are remembered so a rule inside one is never mistaken for
        // an unconditional declaration.
        conditions.push(head);
        continue;
      }
      let depth = 1;
      let body = "";
      i++;
      for (; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}" && --depth === 0) break;
        body += text[i];
      }
      rules.push({
        selectors: head.split(",").map((s) => s.trim()).filter(Boolean),
        body,
        order: rules.length,
        conditions: [...conditions],
      });
      continue;
    }
    if (ch === "}") {
      conditions.pop();
      prelude = "";
      continue;
    }
    prelude += ch;
  }
  return rules;
}

export const CSS_RULES = parseStylesheet(readGlobalCss());

// a-b-c specificity, counted the way selectors level 4 counts it. Enough for this stylesheet,
// which uses no ids, no `:where()` and no `:is()`.
//
// PSEUDO-ELEMENTS COUNT AS TYPE SELECTORS, not as classes. The pseudo-CLASS alternative used
// to be written `:(?!:)[\w-]+`, whose lookahead is satisfied starting from the SECOND colon of
// a `::` sequence — so `::after` and `::-webkit-scrollbar` were weighed at 100 instead of 1.
// Nothing compared a `::` selector's specificity when that was found; `.ll-card-open::after`
// exists now, so the arithmetic is made right rather than left as a trap.
export const specificity = (selector) => {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g) || []).length;
  const elements = (selector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  const pseudoElements = (selector.match(/::[\w-]+/g) || []).length;
  return ids * 10000 + classes * 100 + elements + pseudoElements;
};

// Does this selector match an element carrying `className`? Only the rightmost compound
// selects, so `.ll-lcard-name` and `.ll-lcard-move select` do not answer for `.ll-lcard` —
// and the word boundary is what keeps `.ll-lp` from matching `.ll-lp-slot`.
export const targets = (selector, className) => {
  const rightmost = selector.split(/[\s>+~]+/).filter(Boolean).pop() || "";
  return new RegExp(`\\.${className}(?![\\w-])`).test(rightmost);
};

export const declarationsIn = (body, property) =>
  [...body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]*)`, "g"))].map(([, v]) => v.trim());

/**
 * The longhands a shorthand can be written as instead.
 *
 * `declarationsIn` matches the property NAME exactly — `padding` does not answer for
 * `padding-left`, which is correct for reading a value and wrong for asserting an absence.
 * "`.save-dest` declares no `border`" was satisfied by a rule declaring `border-bottom`, and
 * "no literal padding on a scaled control" by one declaring `padding-left`. Absence
 * assertions go through `family()` below so the property they name covers the ways of
 * writing it.
 *
 * Not exhaustive across CSS — exhaustive across the properties this suite asserts absent.
 */
export const LONGHANDS = {
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left", "padding-block", "padding-inline"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left", "margin-block", "margin-inline"],
  border: [
    "border-width", "border-style", "border-color",
    "border-top", "border-right", "border-bottom", "border-left",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
    "border-radius", "border-block", "border-inline",
  ],
  background: ["background-color", "background-image", "background-clip", "background-origin"],
  outline: ["outline-width", "outline-style", "outline-color", "outline-offset"],
  font: ["font-size", "font-family", "font-weight", "font-style", "font-variant"],
};

/** `property` plus every longhand that could be written in its place. */
export const family = (property) => [property, ...(LONGHANDS[property] ?? [])];

/**
 * The value of `property` that the cascade applies to an element carrying `classSelector`.
 *
 * Returns null when nothing declares it — which is itself assertable, and is how "no bare
 * `width` anywhere" is checked.
 */
export function effectiveDeclaration(rules, classSelector, property) {
  const className = classSelector.replace(/^\./, "");
  const candidates = rules
    .map((rule) => {
      const matching = rule.selectors.filter((sel) => targets(sel, className));
      if (!matching.length) return null;
      const values = declarationsIn(rule.body, property);
      if (!values.length) return null;
      return {
        rule,
        value: values[values.length - 1],
        weight: Math.max(...matching.map(specificity)),
      };
    })
    .filter(Boolean);

  const conditional = candidates.filter((c) => c.rule.conditions.length);
  if (conditional.length) {
    throw new Error(
      `${property} for ${classSelector} is also declared inside ${conditional
        .map((c) => c.rule.conditions.join(" "))
        .join(", ")}; this helper resolves unconditional rules only, so the assertion would ` +
        "be reading a value the cascade may not apply. Model the at-rule or move the floor."
    );
  }
  if (candidates.some((c) => /!\s*important/.test(c.value))) {
    throw new Error(`${property} for ${classSelector} uses !important, which this helper does not order`);
  }
  if (!candidates.length) return null;

  // Highest specificity wins; among equals, the last in source order.
  candidates.sort((a, b) => a.weight - b.weight || a.rule.order - b.rule.order);
  return candidates[candidates.length - 1].value;
}

/** As above, against global.css, and a missing declaration is a failure rather than a null. */
export const effective = (classSelector, property) => {
  const value = effectiveDeclaration(CSS_RULES, classSelector, property);
  if (value === null) throw new Error(`no rule in global.css declares ${property} for ${classSelector}`);
  return value;
};

/**
 * Every declaration of `property` from rules whose selector list CONTAINS exactly `selector`,
 * or null when there are none.
 *
 * The exact-match half of the pair. See the note at the top of this file for why a geometry or
 * a contrast assertion must never go through `effective()`.
 *
 * Refuses a conditional redefinition the same way `effectiveDeclaration` does, and for the
 * same reason: an `@media` block restating the property is a cascade this helper does not
 * model, and answering with the unconditional value would be answering a question nobody
 * asked. Since every geometry assertion in the suite comes through here, ignoring conditions
 * meant a media query could move any of them unseen.
 */
export function restingDeclarationIn(rules, selector, property) {
  const matching = rules.filter(
    (rule) => rule.selectors.includes(selector) && declarationsIn(rule.body, property).length
  );
  const conditional = matching.filter((rule) => rule.conditions.length);
  if (conditional.length) {
    throw new Error(
      `${property} for ${selector} is also declared inside ${conditional
        .map((r) => r.conditions.join(" "))
        .join(", ")}; this helper resolves unconditional rules only, so the assertion would ` +
        "be reading a value the cascade may not apply. Model the at-rule or move the declaration."
    );
  }
  const values = matching.flatMap((rule) => declarationsIn(rule.body, property));
  return values.length ? values[values.length - 1] : null;
}

export const restingDeclaration = (selector, property) => restingDeclarationIn(CSS_RULES, selector, property);

/** As above, and a missing declaration is a failure rather than a null. */
export const resting = (selector, property) => {
  const value = restingDeclaration(selector, property);
  if (value === null) throw new Error(`no rule in global.css declares ${property} for exactly ${selector}`);
  return value;
};

/**
 * Every declaration of `property` OR any of its longhands for exactly `selector`, as
 * `[property, value]` pairs. Empty when the selector writes none of them.
 *
 * What an absence assertion should use: `restingDeclaration(".save-dest", "border")` is null
 * while `.save-dest { border-bottom: 1px solid var(--gold-border) }` sits right there.
 */
export const restingFamily = (selector, property) =>
  family(property)
    .flatMap((p) => (restingDeclaration(selector, p) === null ? [] : [[p, restingDeclaration(selector, p)]]));

/**
 * The value of a custom property as `:root` finally declares it.
 *
 * NOT the first `:root` block. A stylesheet may open several, and the last unconditional one
 * wins — so reading the first meant an appended `:root { --control-pad-y: 4px }` moved every
 * control in the app while the tests that exist to pin the scale stayed green. A conditional
 * `:root` (a light-scheme block, say) is refused rather than ignored, for the same reason
 * `resting()` refuses one.
 */
export function tokenIn(rules, name) {
  const declaring = rules.filter(
    (rule) => rule.selectors.includes(":root") && declarationsIn(rule.body, name).length
  );
  const conditional = declaring.filter((rule) => rule.conditions.length);
  if (conditional.length) {
    throw new Error(
      `${name} is redeclared on :root inside ${conditional
        .map((r) => r.conditions.join(" "))
        .join(", ")}; this helper resolves unconditional rules only.`
    );
  }
  if (!declaring.length) throw new Error(`:root declares no ${name}`);
  const values = declaring.flatMap((rule) => declarationsIn(rule.body, name));
  return values[values.length - 1];
}

export const token = (name) => tokenIn(CSS_RULES, name);
