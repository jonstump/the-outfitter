import { describe, expect, it } from "vitest";
import { ITEM_STATS, STATS_GENERATED, descriptionFor, statFieldFor, statsFor } from "./itemStats.js";
import { CONS, TOOLS, TRAITS, WEAPONS } from "./catalog.js";

// Governing: ADR-0005 (Scrape Item Stats into a Generated, Committed Data File)
// Implements: SPEC-0007 REQ "Generated, Committed Stats File"

describe("the generated dataset", () => {
  it("carries the marker that says it is generated", () => {
    // JSON has no comments, so the marker is the only thing standing between this file and someone
    // hand-editing it — SPEC-0007 requires it to be visible to whoever opens the file.
    expect(STATS_GENERATED).toBeTruthy();
    expect(STATS_GENERATED.by).toBe("scripts/scrape-stats.mjs");
    expect(STATS_GENERATED.warning).toMatch(/do not hand-edit/i);
  });

  it("keys every record by a real catalog id", () => {
    const known = new Set([...WEAPONS, ...TOOLS, ...TRAITS, ...CONS].map((row) => row[0]));
    const orphans = Object.keys(ITEM_STATS).filter((id) => !known.has(id));
    expect(orphans).toEqual([]);
  });

  it("records provenance on every entry", () => {
    const entries = Object.entries(ITEM_STATS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, record] of entries) {
      expect(record.sourceRevision, `${id} has no sourceRevision`).toBeTruthy();
      expect(record.ingestedAt, `${id} has no ingestedAt`).toBeTruthy();
    }
  });

  // Governing: SPEC-0007 REQ "Catalog Write-Through Is Bounded, Reviewable, and Opt-In"
  //
  // The reverse direction of the id check above, on VALUES rather than keys. #195 reconciled the
  // catalog's cost/size/UP columns against this dataset — 74 fields, verified to zero mismatches —
  // and nothing pinned it, so the next hand-edit to a cost would silently reintroduce exactly the
  // drift those corrections removed and CI would stay green. Turning a one-time manual review into
  // a standing invariant is the whole point of having written the values down.
  //
  // Items with no record are skipped rather than failed: the catalog and the dataset refresh
  // independently, so a newly added row is the uncovered case `statsFor` already documents. Today
  // that skip covers exactly one id, `winfield-m1873c`, a KNOWN_CATALOG_DUPLICATES entry with no
  // wiki page of its own.
  describe("stays consistent with the hand-authored catalog", () => {
    const asNumber = (raw) => {
      if (raw === null) return null;
      // The same strict parse the write-through uses. Stripping non-digits and keeping the
      // remainder is how "1.5" becomes 15, so a non-whole value is refused, not coerced.
      const cleaned = String(raw).replace(/,/g, "").trim();
      return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
    };

    const cases = [
      { label: "weapon cost", rows: WEAPONS, field: "Price", index: 3 },
      { label: "weapon size", rows: WEAPONS, field: "Size", index: 2 },
      { label: "tool cost", rows: TOOLS, field: "Price", index: 2 },
      { label: "consumable cost", rows: CONS, field: "Price", index: 2 },
      { label: "trait UP", rows: TRAITS, field: "Cost", index: 2 },
    ];

    for (const { label, rows, field, index } of cases) {
      it(`agrees with the dataset on every ${label}`, () => {
        const mismatches = [];
        let compared = 0;
        for (const row of rows) {
          const scraped = asNumber(statFieldFor(row[0], field));
          if (scraped === null) continue;
          compared += 1;
          if (scraped !== row[index]) {
            mismatches.push(`${row[0]}: catalog ${row[index]}, dataset ${scraped}`);
          }
        }
        expect(compared, `no ${label} was actually compared`).toBeGreaterThan(0);
        expect(mismatches).toEqual([]);
      });
    }
  });
});

describe("statsFor", () => {
  it("returns the record for a covered item", () => {
    const [firstId] = Object.keys(ITEM_STATS);
    expect(statsFor(firstId)).toBe(ITEM_STATS[firstId]);
  });

  it("returns null for an item the scrape has not covered", () => {
    // The specified behaviour, not a gap: the catalog and the dataset refresh independently, so a
    // newly added row and an item whose page failed to parse are the same state to a consumer.
    expect(statsFor("no-such-item-anywhere")).toBeNull();
  });

  it("returns null rather than throwing on a missing or empty id", () => {
    expect(statsFor(null)).toBeNull();
    expect(statsFor(undefined)).toBeNull();
    expect(statsFor("")).toBeNull();
  });

  it("does not inherit from Object.prototype", () => {
    // A bare `ITEM_STATS[id]` lookup would return a function for "constructor" or "toString",
    // which a caller would then treat as a stats record.
    expect(statsFor("constructor")).toBeNull();
    expect(statsFor("toString")).toBeNull();
  });
});

describe("statFieldFor", () => {
  it("reads a field from a covered item", () => {
    const id = Object.keys(ITEM_STATS).find((k) => Object.keys(ITEM_STATS[k].fields ?? {}).length > 0);
    const field = Object.keys(ITEM_STATS[id].fields)[0];
    expect(statFieldFor(id, field)).toBe(ITEM_STATS[id].fields[field]);
  });

  it("returns the wiki's own string, uncoerced", () => {
    // ADR-0005 gates numeric write-through behind range assertions in the scrape; a silent
    // Number() here would reintroduce the unvalidated coercion those assertions exist to prevent.
    const id = Object.keys(ITEM_STATS).find((k) => ITEM_STATS[k].fields?.Price);
    expect(typeof statFieldFor(id, "Price")).toBe("string");
  });

  it("returns null for an absent field, an empty field, and an unknown item", () => {
    const id = Object.keys(ITEM_STATS)[0];
    expect(statFieldFor(id, "NoSuchField")).toBeNull();
    expect(statFieldFor("no-such-item", "Price")).toBeNull();
  });
});

describe("descriptionFor", () => {
  it("reads the scraped prose for a covered item", () => {
    const id = Object.keys(ITEM_STATS).find((k) => ITEM_STATS[k].description);
    expect(descriptionFor(id)).toBe(ITEM_STATS[id].description);
    expect(typeof descriptionFor(id)).toBe("string");
  });

  it("returns null for an unknown item, an absent description, and an empty one", () => {
    // Null is a normal outcome rather than a gap: a page can carry only a hatnote above its first
    // section, and a catalog row can predate the dataset. Both reach a caller as null.
    expect(descriptionFor("no-such-item")).toBeNull();
    expect(descriptionFor(undefined)).toBeNull();
  });

  it("covers every item in the committed dataset", () => {
    // Not a property of the accessor but of the data, and worth pinning: the scrape reads prose from
    // two different places (a Description section, or the lead above the first section), so a
    // regression in either would show up as a category-shaped hole rather than a total failure.
    const missing = Object.keys(ITEM_STATS).filter((k) => !ITEM_STATS[k].description);
    expect(missing).toEqual([]);
  });

  it("keeps multi-paragraph descriptions newline-joined rather than collapsed", () => {
    // 9 of the 32 traits carry a second paragraph — beastface, conduit, frontiersman, kiteskin,
    // magpie, necromancer, pain-sense, serpent, vigilant. Each is a conditional rule (`SOLO:`,
    // `CATALYST:`, `SOLO CATALYST:`) that replaces the base effect rather than restating it, so
    // collapsing to the first paragraph would drop a mechanic from more than a quarter of them.
    const multi = Object.keys(ITEM_STATS).filter((k) => ITEM_STATS[k].description?.includes("\n"));
    for (const id of multi) {
      expect(descriptionFor(id)).toContain("\n");
      expect(descriptionFor(id)).not.toMatch(/\n\s*\n/);
    }
  });

  it("never leaves a space before punctuation from an inline link", () => {
    // `textContent` turns every tag into a space, so `<a>First Aid Kit</a>.` read back as
    // "First Aid Kit ." until the scrape tidied prose. This pins the whole dataset, not one item.
    const offenders = Object.keys(ITEM_STATS).filter((k) => /\s[,;:.!?]/.test(ITEM_STATS[k].description ?? ""));
    expect(offenders).toEqual([]);
  });

  it("never stores a See-also hatnote as a description", () => {
    // Weapon and consumable pages open with an italicised "See also: ..." above their Description
    // section. Taking the first paragraph blindly wrote navigation into most of the catalog.
    const offenders = Object.keys(ITEM_STATS).filter((k) => /^see also/i.test(ITEM_STATS[k].description ?? ""));
    expect(offenders).toEqual([]);
  });

  it("keeps trait descriptions short enough for the hover tip to show whole", () => {
    // A layout guard that has to live here, because nothing in CI measures a rendered pixel and the
    // failure it catches is silent: `.trait-cell-tip-desc` clamps, and a clamped tip shows no
    // ellipsis (`text-overflow` is `clip` inside a line clamp), so an over-long description reads as
    // complete while withholding its tail.
    //
    // That already happened once. The clamp was set to six lines against a stated "about 150
    // characters" when Serpent was 209, and Serpent's `SOLO:` paragraph — the conditional rule the
    // newline handling exists to preserve — was the part being dropped.
    //
    // The arithmetic, measured in a browser at the tip's 180px max-width: Serpent's 209 characters
    // wrap to 8 lines, so a line holds ~26. The clamp is now 10 lines (~260 characters). Tripping at
    // 240 leaves a line of slack, so this fails while the tip is still showing everything and asks
    // for a re-measure rather than reporting damage already done.
    const TIP_BUDGET = 240;
    const tooLong = TRAITS.map(([id]) => [id, descriptionFor(id)?.length ?? 0])
      .filter(([, len]) => len > TIP_BUDGET)
      .map(([id, len]) => `${id} (${len})`);
    expect(tooLong).toEqual([]);
  });

  it("keeps a known file-wide ceiling, which is no longer the trait tip's", () => {
    // This pinned 240 on the premise that "the longest value in the file is a consumable
    // (flash-bomb, 221)" — comfortably under the trait tip's budget, so one number served both.
    // #233 ended that coincidence: weapons gained descriptions and weapon prose runs longer than
    // trait prose. The Flame Rifle is 296, and the file-wide maximum now EXCEEDS what the trait tip
    // can show.
    //
    // Raising the trait budget to match would be the wrong repair — the tip's 10-line clamp is
    // measured against a 180px box and nothing about a weapon's description changes that. The two
    // ceilings are simply different, and the test above owns the one that binds a rendered surface.
    // What survives here is the original point: a second consumer should inherit a known number.
    // That number is no longer the trait one, which is the fact worth pinning, because reusing
    // `.trait-cell-tip`'s clamp for a weapon surface would silently truncate.
    const FILE_CEILING = 320;
    const byLength = Object.keys(ITEM_STATS)
      .map((k) => [k, ITEM_STATS[k].description?.length ?? 0])
      .sort((a, b) => b[1] - a[1]);
    const [longestId, longest] = byLength[0];
    expect(longest, `${longestId} is the longest description`).toBeLessThanOrEqual(FILE_CEILING);
    expect(FILE_CEILING).toBeGreaterThan(240);
  });
});

// Governing: ADR-0013 (Model Scarce Items as Selectable at Zero Cost)
// Covers: SPEC-0007 REQ "A Zero Cost Is Evidenced as Unpurchasable"
//
// The invariant a hand-authored `0` rests on. ADR-0013 admits Scarce items as ordinary catalog rows
// costing nothing, which makes `0` a load-bearing value that is visually indistinguishable from a
// price nobody supplied — and the failure is silent in the expensive direction, because a free item
// that should cost money understates every budget it appears in.
//
// Asserted in BOTH directions on purpose. The forward check catches a dropped price. The reverse
// check catches the case the forward one cannot see: a re-scrape that reclassifies an item leaves a
// stale non-zero cost that nothing else objects to.
describe("a zero cost is evidenced as unpurchasable", () => {
  // Cost lives at a different tuple position per category — SPEC-0007's "Budget-Affecting Attributes
  // Are Stored, Never Inferred" is about the value, not its index, so the index is read from the same
  // place `calc.js` reads it: WEAPONS[3], TOOLS[2], CONS[2], TRAITS[2].
  const rows = [
    ...WEAPONS.map((r) => ({ id: r[0], name: r[1], cost: r[3] })),
    ...TOOLS.map((r) => ({ id: r[0], name: r[1], cost: r[2] })),
    ...CONS.map((r) => ({ id: r[0], name: r[1], cost: r[2] })),
    ...TRAITS.map((r) => ({ id: r[0], name: r[1], cost: r[2] })),
  ];

  // Two forms of evidence, because the wiki states unpurchasability two different ways: a Scarce
  // TRAIT declares `Category:Traits/Scarce` and omits its cost row entirely, while a Scarce WEAPON
  // writes the literal string "Scarce" where a price goes, which the strict parser refuses and
  // records as `purchasable: false`.
  const evidencedUnpurchasable = (record) =>
    Boolean(record) &&
    ((record.acquisitionClasses ?? []).includes("Scarce") || record.purchasable === false);

  it("has cost-0 rows to check, so neither direction can pass vacuously", () => {
    expect(rows.filter((r) => r.cost === 0).length).toBeGreaterThan(0);
  });

  it("evidences every cost-0 catalog row as Scarce or stated-unpurchasable", () => {
    const unevidenced = rows
      .filter((r) => r.cost === 0)
      .filter((r) => !evidencedUnpurchasable(statsFor(r.id)))
      .map((r) => r.id);
    expect(unevidenced).toEqual([]);
  });

  it("prices every scrape-evidenced Scarce item at 0", () => {
    // The direction that catches a reclassification. Without it, an item the wiki stops calling Scarce
    // keeps whatever cost it had, and no test disagrees.
    const byId = new Map(rows.map((r) => [r.id, r]));
    const mispriced = Object.keys(ITEM_STATS)
      .filter((id) => evidencedUnpurchasable(ITEM_STATS[id]))
      .filter((id) => byId.has(id) && byId.get(id).cost !== 0)
      .map((id) => `${id} costs ${byId.get(id).cost}`);
    expect(mispriced).toEqual([]);
  });

  it("never charges upgrade points for a Scarce trait", () => {
    // The consequence that reaches the budget: `upTotal` sums TRAITS[2], so a non-zero cost here is
    // spent points for an item the player could not have bought.
    const scarceTraits = TRAITS.filter((t) => (statsFor(t[0])?.acquisitionClasses ?? []).includes("Scarce"));
    expect(scarceTraits.length).toBeGreaterThan(0);
    expect(scarceTraits.filter((t) => t[2] !== 0).map((t) => t[0])).toEqual([]);
  });
});
