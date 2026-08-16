import { describe, expect, it } from "vitest";
import { HUNTERS, HUNTERS_BY_NAME, hunterFor, hunterNameFor } from "./hunters.js";

// Governing: SPEC-0004 (hunter roster dataset), SPEC-0003 REQ "Hunter Dataset Consumption
// Contract" (description rendering)
//
// Ports itemStats.test.js's "never leaves a space before punctuation from an inline link" to the
// hunter roster (issue #354). The hunter scraper's caption extraction (scripts/scrape-hunters.mjs
// extractCaption -> stripTags) had no tidyProse-equivalent cleanup pass, unlike the item scrape's
// parseDescription — so 26 of 242 hunter descriptions carried a stray space before punctuation or
// a possessive apostrophe, on screen in DescriptionBlock (LoadoutListsPanel.jsx) whenever a saved
// list's illustrating hunter has no stored description of its own.

describe("the generated hunter dataset", () => {
  it("never leaves a space before punctuation or a possessive apostrophe from an inline link", () => {
    const spaceBeforePunctuation = HUNTERS.filter((h) => /\s+[,.;:!?](\s|$)/.test(h.description ?? ""));
    const spaceBeforePossessive = HUNTERS.filter((h) => /\s['’]s\b/.test(h.description ?? ""));
    expect(spaceBeforePunctuation.map((h) => h.id)).toEqual([]);
    expect(spaceBeforePossessive.map((h) => h.id)).toEqual([]);
  });
});

// Governing: SPEC-0004 (hunter roster dataset), SPEC-0003 (hunter picker), issue #387
//
// `HUNTERS` is scrape-id order (scripts/scrape-hunters.mjs sorts `allEntries` by `id`), and
// that equals name order for every hunter EXCEPT `the-statesman`: its id does not start
// with "the-" the way its name starts with "The ", so it sits 171 tiles from its variant
// `desolations-delegate` ("The Statesman: Desolation's Delegate") when the picker consumed
// `HUNTERS` directly. `the-statesman`'s id is deliberately left untouched — re-keying it
// would break stored `hunterId` references and contradicts the id/name divergence
// SPEC-0004 sanctions (docs/openspec/specs/hunter-roster-dataset/spec.md, "A renamed
// hunter keeps its id") — so this pins `HUNTERS_BY_NAME`, the consumption-seam fix, instead.
describe("HUNTERS_BY_NAME", () => {
  it("orders every one of the 242 entries alphabetically by name", () => {
    expect(HUNTERS_BY_NAME).toHaveLength(HUNTERS.length);
    const names = HUNTERS_BY_NAME.map((h) => h.name);
    const expected = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(expected);
  });

  it("keeps the-statesman and desolations-delegate adjacent", () => {
    const ids = HUNTERS_BY_NAME.map((h) => h.id);
    const i = ids.indexOf("the-statesman");
    const j = ids.indexOf("desolations-delegate");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThanOrEqual(0);
    expect(Math.abs(i - j)).toBe(1);
  });

  it("carries the same set of entries as HUNTERS — reordered, not filtered or re-keyed", () => {
    expect(new Set(HUNTERS_BY_NAME.map((h) => h.id))).toEqual(new Set(HUNTERS.map((h) => h.id)));
  });

  // Sanity check per issue #387: ids are untouched by this fix, so every stored hunterId
  // still resolves the same entry whether looked up via HUNTERS or the name-ordered view.
  it("leaves hunterId lookups (hunterFor / hunterNameFor) unaffected — ids are untouched", () => {
    expect(hunterFor("the-statesman")?.name).toBe("The Statesman");
    expect(hunterFor("desolations-delegate")?.name).toBe("The Statesman: Desolation's Delegate");
    expect(hunterNameFor("the-statesman")).toBe("The Statesman");
    expect(hunterNameFor("desolations-delegate")).toBe("The Statesman: Desolation's Delegate");
  });
});
