import { describe, expect, it } from "vitest";
import { HUNTERS } from "./hunters.js";

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
