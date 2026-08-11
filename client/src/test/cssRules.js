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
//   * It DOES refuse to answer at all when a conditional at-rule (`@media`, `@supports`,
//     `@container`) declares the same property for the same class — that is a cascade this
//     helper does not model, and silently merging it into the unconditional bucket is what the
//     old parse did. `effective()` throws, loudly, rather than guessing.
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
export const specificity = (selector) => {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
  const types = (selector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return ids * 10000 + classes * 100 + types;
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
 */
export function restingDeclaration(selector, property) {
  const values = CSS_RULES.filter((rule) => rule.selectors.includes(selector)).flatMap((rule) =>
    declarationsIn(rule.body, property)
  );
  return values.length ? values[values.length - 1] : null;
}

/** As above, and a missing declaration is a failure rather than a null. */
export const resting = (selector, property) => {
  const value = restingDeclaration(selector, property);
  if (value === null) throw new Error(`no rule in global.css declares ${property} for exactly ${selector}`);
  return value;
};
