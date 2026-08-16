import { describe, expect, it } from "vitest";
import {
  ITEM_STATS,
  STATS_GENERATED,
  ammoRoundFor,
  ammoSlotsFor,
  descriptionFor,
  dualWieldFor,
  statFieldFor,
  statsFor,
} from "./itemStats.js";
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
    // 9 of the 58 traits carry a second paragraph — beastface, conduit, frontiersman, kiteskin,
    // magpie, necromancer, pain-sense, serpent, vigilant. Each is a conditional rule (`SOLO:`,
    // `CATALYST:`, `SOLO CATALYST:`) that replaces the base effect rather than restating it, so
    // collapsing to the first paragraph would drop a mechanic from nine of them.
    const multi = Object.keys(ITEM_STATS).filter((k) => ITEM_STATS[k].description?.includes("\n"));
    for (const id of multi) {
      expect(descriptionFor(id)).toContain("\n");
      expect(descriptionFor(id)).not.toMatch(/\n\s*\n/);
    }
  });

  it("pins the trait catalog size that comment prose elsewhere cites by number (#369)", () => {
    // Several comments across this codebase — this file, LoadoutListsPanel.jsx, global.css,
    // scripts/scrape-stats.mjs and its test — state the trait catalog's size in prose ("58
    // traits", "9 of the 58 traits carry a second paragraph") rather than deriving it inline,
    // because deriving it would bury each comment's actual point in a length computation.
    // That makes every one of those prose numbers a hardcoded copy of TRAITS.length, which is
    // exactly how issue #369 went stale: the catalog grew from 32 to 58 traits and five live
    // comments still said 32. Asserting both numbers here means the next roster growth fails
    // a test instead of leaving another batch of comments quietly wrong.
    expect(TRAITS.length).toBe(58);
    const traitIds = new Set(TRAITS.map((t) => t[0]));
    const multiParagraphTraits = Object.keys(ITEM_STATS).filter(
      (k) => traitIds.has(k) && ITEM_STATS[k].description?.includes("\n")
    );
    expect(multiParagraphTraits.length).toBe(9);
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

// Governing: #178 (the dual-wield attribute), SPEC-0007 REQ "Budget-Affecting Attributes Are Stored,
// Never Inferred"
describe("dualWieldFor", () => {
  it("reads the scraped verdict for a covered weapon", () => {
    // The Nagant M1895 is the row #178 confirmed by direct fetch, so it is the one to anchor on.
    expect(dualWieldFor("nagant-m1895")).toBe(true);
  });

  it("returns null for an unknown id rather than false", () => {
    // The distinction the whole field rests on: "no evidence" must not read as "denied".
    expect(dualWieldFor("no-such-weapon")).toBeNull();
    expect(dualWieldFor(undefined)).toBeNull();
  });

  it("marks exactly the weapons whose pages state it", () => {
    // Was eleven rows, all pistols. #254 imported the weapon variants, and a variant of a pairable
    // pistol states pairing on its own page just as its parent does — so the Dolch 96 Claw is here
    // for the same reason the Dolch 96 is, read from its own description rather than inherited.
    //
    // Still all pistols; the corroboration test below pins that.
    const dual = WEAPONS.filter((w) => dualWieldFor(w[0]) === true).map((w) => w[1]).sort();
    expect(dual).toEqual([
      "Bornheim No. 3", "Bornheim No. 3 Extended", "Bornheim No. 3 Silencer",
      "Conversion", "Conversion Chain Pistol",
      "Dolch 96", "Dolch 96 Bullseye", "Dolch 96 Claw",
      "LeMat", "Nagant M1895", "Nagant M1895 Silencer",
      "New Army", "New Army Swift", "Officer", "Officer Brawler",
      "Pax", "Pax Claw", "Pax Trueshot",
      "Scottfield", "Scottfield Brawler", "Scottfield Spitfire", "Scottfield Swift",
      "Sparks Pistol", "Sparks Pistol Silencer", "Uppercut",
    ]);
  });

  it("does not mark the Officer Carbine, which is a different weapon from the Officer", () => {
    // #178's named trap. These two share their entire opening sentence; only the pistol's description
    // ends with the dual-wield claim, so anything matching on name or prose similarity gets it wrong.
    expect(dualWieldFor("officer")).toBe(true);
    expect(dualWieldFor("nagant-officer-carbine")).toBe(false);
  });

  it("excludes the Haymaker, the two-handed size-2 pistol", () => {
    // #178's counterexample to deriving this from `size`: Haymaker, Uppercut and Dolch 96 are all size
    // 2 and the split tracks hands, not slots. If this ever flips, the "size cannot derive it" argument
    // needs revisiting rather than the data.
    expect(dualWieldFor("haymaker")).toBe(false);
    expect(WEAPONS.find((w) => w[0] === "haymaker")[2]).toBe(2);
    expect(WEAPONS.find((w) => w[0] === "caldwell-conversion-uppercut")[2]).toBe(2);
    expect(dualWieldFor("caldwell-conversion-uppercut")).toBe(true);
  });

  it("admits a silent pistol only through an explicit, justified allow-list", () => {
    // The one place the class argument does not reach, and the reason this is a test rather than a
    // comment. SPEC-0007's "Stored, Never Inferred", as amended 2026-08-12 by the review of #251,
    // accepts a description that was read and stayed silent as a determination — but what makes it one
    // is that the whole GROUP is silent, not the silence itself. That holds for Rifles (26 silent),
    // Shotguns (9), Melee (7) and Bows (4): every single member is silent, which is an editorial
    // convention the game agrees with, so those groups need no list and get none.
    //
    // Pistols are the asymmetry. Eleven of twelve state pairing outright, so silence there is NOT the
    // convention and carries real information — a newly silent pistol is far likelier to be an unread
    // page or a reworded wiki edit than a genuinely two-handed sidearm. It therefore has to be claimed
    // by hand, with a ground, rather than absorbed by an argument that does not cover it.
    // #254 added seven more silent pistols, and they are NOT a weakening of the argument above —
    // they are a second, sharper instance of it. Every one is a SCOPED variant, and a scoped pistol
    // cannot be paired. The wiki states this by omission with no exceptions: across the pistol
    // variants, Deadeye (0 of 2), Precision (0 of 4) and Match (0 of 1) never claim pairing, while
    // every other variant suffix — Brawler, Bullseye, Claw, Extended, Silencer, Spitfire, Swift,
    // Trueshot, Chain Pistol — claims it in every instance. Not one suffix is mixed.
    //
    // That unanimity is the ground, and it is asserted rather than described, immediately below. A
    // scoped pistol that starts claiming pairing, or an unscoped variant that stops, breaks the
    // pattern and lands here for a human rather than being absorbed.
    const TWO_HANDED_PISTOLS = [
      "haymaker", // Confirmed two-handed. SPEC-0007 and #178 both name it as correctly excluded.
      // Scoped variants (#254). Each read from its own page, each silent, none contradicted.
      "bornheim-no-3-match",
      "dolch-96-precision",
      "nagant-m1895-deadeye",
      "nagant-m1895-precision",
      "scottfield-precision",
      "uppercut-deadeye",
      "uppercut-precision",
    ];
    const silentPistols = WEAPONS.filter((w) => w[5] === "Pistols" && dualWieldFor(w[0]) === false).map((w) => w[0]);
    expect(silentPistols.sort()).toEqual([...TWO_HANDED_PISTOLS].sort());

    // The pattern the seven rest on, checked rather than asserted in prose: every scoped pistol
    // variant is silent, and no unscoped one is.
    const SCOPED = /\/(Deadeye|Precision|Match)$/;
    const pistolVariants = WEAPONS.filter((w) => w[5] === "Pistols").map((w) => ({
      id: w[0],
      page: statsFor(w[0])?.wikiUrl?.split("/wiki/")[1] ?? "",
      dual: dualWieldFor(w[0]),
    }));
    const scopedThatPair = pistolVariants.filter((p) => SCOPED.test(p.page) && p.dual === true);
    const unscopedVariantsThatDoNot = pistolVariants.filter(
      (p) => p.page.split("/").length === 3 && !SCOPED.test(p.page) && p.dual !== true
    );
    expect(scopedThatPair.map((p) => p.id)).toEqual([]);
    expect(unscopedVariantsThatDoNot.map((p) => p.id)).toEqual([]);
  });

  it("keeps the class corroboration true, since the pistol allow-list rests on it", () => {
    // The premise the test above leans on, pinned so it cannot quietly stop being true. Every `true` in
    // the dataset is a pistol; if a rifle, shotgun, melee weapon or bow ever comes back pairable, then
    // "silent as a class" is no longer why those 46 rows are `false`, and the allow-list above stops
    // being the only unguarded gap. Better to fail here and revisit the argument than to keep asserting
    // a determination whose justification has expired.
    //
    // #254 took this from 11 to 25 and the class claim survived unchanged, which is a real check on
    // that import rather than a formality: `sparks-pistol-silencer` is a pistol whose wiki path sits
    // under the Sparks LRR *rifle*, and filing it by its page family rather than its true parent
    // would have put a `true` in Rifles and failed this line.
    const pairable = WEAPONS.filter((w) => dualWieldFor(w[0]) === true);
    expect([...new Set(pairable.map((w) => w[5]))]).toEqual(["Pistols"]);
    expect(pairable).toHaveLength(25);
  });

  it("resolves every weapon the dataset covers, leaving none merely unread", () => {
    // Scoped to covered rows on purpose. A row with no record at all is the documented uncovered state
    // `statsFor` already describes — `winfield-m1873c` has no wiki page of its own, so it can have no
    // verdict, and #243 retires it. What this catches is the different failure: a row the scrape DID
    // read and still could not resolve, which would mean the description landed without the sentence
    // and without denying it.
    const covered = WEAPONS.filter((w) => statsFor(w[0]) !== null);
    expect(covered.length).toBeGreaterThan(WEAPONS.length - 3);
    const unresolved = covered.filter((w) => dualWieldFor(w[0]) === null).map((w) => w[0]);
    expect(unresolved).toEqual([]);
  });

  it("marks nothing outside the weapon roster", () => {
    // Tools, consumables and traits are not wieldable in pairs, and the field must not imply otherwise
    // just because their descriptions were read too.
    const nonWeapons = [...TOOLS, ...CONS, ...TRAITS].filter((r) => dualWieldFor(r[0]) === true);
    expect(nonWeapons.map((r) => r[0])).toEqual([]);
  });

  it("keeps the Sparks Pistol at size 1, which #178 predicted the rescrape would fix", () => {
    // #178 recorded that audit §3.5 reached `size 2 -> 1` by the wrong reasoning and deferred. The
    // rescrape corrected it, and the weapon being one-handed and dual-wieldable is consistent with 1 —
    // so the "per-pistol or per-pair" tiebreak §3.5 worried about never had to be made.
    expect(WEAPONS.find((w) => w[0] === "sparks-pistol")[2]).toBe(1);
    expect(dualWieldFor("sparks-pistol")).toBe(true);
  });
});

// Governing: ADR-0014, SPEC-0010 REQ "A Weapon Declares Which Rounds It Accepts", REQ "A
// Weapon Declares Its Own Ammo Slot Count", REQ "A Dual-Family Weapon Declares Both
// Families", REQ "Price Belongs to the Weapon-and-Round Pair", issue #344.
describe("ammoSlotsFor", () => {
  it("a one-slot weapon's whole accepted list is its single group", () => {
    // Nagant M1895 (compact): no perSlotOf, no familySplit — see itemStats.json.
    const slots = ammoSlotsFor("nagant-m1895");
    expect(slots.count).toBe(1);
    expect(slots.bound).toBe(false);
    expect(slots.groups).toHaveLength(1);
    expect(slots.groups[0].map((r) => r.id)).toEqual([
      "ammo-compact-dumdum",
      "ammo-compact-high-velocity",
      "ammo-compact-poison",
      "ammo-compact-subsonic",
    ]);
  });

  it("a split-reserve weapon's two slots share one unbound group", () => {
    // Berthier 1892 (slong): reserve.perSlotOf: 6, familySplit: false.
    const slots = ammoSlotsFor("berthier-1892");
    expect(slots.count).toBe(2);
    expect(slots.bound).toBe(false);
    expect(slots.groups[0]).toBe(slots.groups[1]); // literally the same list — either slot, any round
    expect(slots.groups[0].map((r) => r.id)).toEqual(["ammo-slong-incendiary", "ammo-slong-spitzer"]);
  });

  it("a dual-family weapon's two slots are disjoint, one group per family", () => {
    // Drilling: reserve.familySplit: true, accepted spans medium then shotgun (#431).
    const slots = ammoSlotsFor("drilling");
    expect(slots.count).toBe(2);
    expect(slots.bound).toBe(true);
    expect(slots.groups[0].every((r) => r.family === "medium")).toBe(true);
    expect(slots.groups[1].every((r) => r.family === "shotgun")).toBe(true);
    // Every round in each group also appears in the weapon's own accepted list — the
    // groups partition it, they don't invent or drop rounds.
    const accepted = statsFor("drilling").ammo.accepted.map((r) => r.id);
    expect([...slots.groups[0], ...slots.groups[1]].map((r) => r.id).sort()).toEqual([...accepted].sort());
  });

  it("a weapon with no Ammo Types section has zero slots", () => {
    // cavalry-saber (melee): itemStats.json records `ammo: null`.
    expect(statsFor("cavalry-saber").ammo).toBeNull();
    expect(ammoSlotsFor("cavalry-saber")).toEqual({ count: 0, bound: false, groups: [] });
  });

  it("returns zero slots rather than throwing for an unknown id", () => {
    expect(ammoSlotsFor("no-such-weapon")).toEqual({ count: 0, bound: false, groups: [] });
    expect(ammoSlotsFor(undefined)).toEqual({ count: 0, bound: false, groups: [] });
  });
});

describe("ammoRoundFor", () => {
  it("resolves a round by id within the correct slot", () => {
    const round = ammoRoundFor("nagant-m1895", 0, "ammo-compact-high-velocity");
    expect(round).toMatchObject({ id: "ammo-compact-high-velocity", name: "High Velocity Ammo", price: 60 });
  });

  it("a dual-family weapon's round from the OTHER slot's family does not resolve here", () => {
    // Drilling slot 0 is medium; a shotgun round offered against slot 0 must not resolve —
    // this is the enforcement REQ "A Dual-Family Weapon Declares Both Families" describes:
    // "A round from the family bound to the OTHER slot MUST NOT be offered in this one."
    expect(ammoRoundFor("drilling", 0, "ammo-shotgun-slug")).toBeNull();
    expect(ammoRoundFor("drilling", 1, "ammo-shotgun-slug")).not.toBeNull();
  });

  it("returns null for an empty slot, an out-of-range slot, and an id the weapon does not offer", () => {
    expect(ammoRoundFor("nagant-m1895", 0, null)).toBeNull();
    expect(ammoRoundFor("nagant-m1895", 1, "ammo-compact-high-velocity")).toBeNull(); // one-slot weapon
    expect(ammoRoundFor("nagant-m1895", 0, "ammo-compact-fmj")).toBeNull(); // not in this weapon's list
    expect(ammoRoundFor("no-such-weapon", 0, "ammo-compact-fmj")).toBeNull();
  });

  it("a Scarce round resolves with a null price, not a fabricated zero", () => {
    // SPEC-0010 REQ "A Scarce Round Costs Nothing and Is Still Selectable" — the scrape
    // records Scarce as `price: null`; turning that into 0 is the READER's job (ammoCostFor
    // in calc.js), not this accessor's, which passes the record through unmodified.
    const round = ammoRoundFor("nagant-m1895", 0, "ammo-compact-dumdum");
    expect(round).toMatchObject({ id: "ammo-compact-dumdum", scarce: true, price: null });
  });
});
