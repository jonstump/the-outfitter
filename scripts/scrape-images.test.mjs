// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time, Self-Hosted Scrape)
// Implements: SPEC-0001 REQ "Ethical, Self-Hosted Image Sourcing", SPEC-0001 REQ "Error Handling Standards"
//
// Unit tests for scripts/scrape-images.mjs. No live network calls are made anywhere in this
// file — HTTP is faked via an injected fetchFn, and the filesystem is faked via injected
// fs-like functions, per the constraint that this script must never be exercised against the
// real huntshowdown.wiki.gg as a side effect of testing.

import test from "node:test";
import assert from "node:assert/strict";
import { CONS, TOOLS, TRAITS, WEAPONS } from "../client/src/data/catalog.js";

import {
  slugify,
  buildItemPageUrl,
  extractImageUrl,
  extForContentType,
  parseRobotsTxt,
  isAllowedByRobots,
  fetchRobotsTxt,
  RateLimiter,
  collectCatalogItems,
  resolveWikiPath,
  WIKI_TITLE_OVERRIDES,
  KNOWN_CATALOG_DUPLICATES,
  CATEGORIES,
  scrapeItem,
  runScrape,
  createSummary,
  recordResult,
  formatSummary,
  ScrapeError,
  ItemPageNotFoundError,
  ImageAssetNotFoundError,
  NetworkFailureError,
  RobotsDisallowedError,
} from "./scrape-images.mjs";

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

test("slugify: matches the documented shared-contract examples", () => {
  assert.equal(slugify("Nagant M1895"), "nagant-m1895");
  assert.equal(slugify("LeMat Mark II"), "lemat-mark-ii");
  assert.equal(slugify("Winfield M1873C"), "winfield-m1873c");
});

test("slugify: collapses non-alphanumeric runs into a single hyphen", () => {
  assert.equal(slugify("Crown & King Auto-5"), "crown-king-auto-5");
  assert.equal(slugify("Caldwell Conversion Uppercut"), "caldwell-conversion-uppercut");
});

test("slugify: strips leading/trailing hyphens and drops apostrophes", () => {
  assert.equal(slugify("  Bomb Lance  "), "bomb-lance");
  assert.equal(slugify("O'Brien's Special"), "obriens-special");
});

test("slugify: is idempotent", () => {
  const once = slugify("Mosin-Nagant M1891");
  assert.equal(slugify(once), once);
});

// The writer end of the asset-path contract must be the SAME function as the reader end in
// client/src/components/ItemThumb/ItemThumb.jsx — not merely one that agrees on the cases
// above. Both previously carried their own copy and the copies had drifted on apostrophes
// and diacritics, which is invisible at runtime: a mismatched slug renders the SVG fallback,
// exactly like an item that has not been scraped yet (issue #119).
//
// Value equality would pass again the moment someone reintroduced a local copy that happened
// to agree on the tested names. Identity is what fails.
test("slugify: is the canonical shared definition, not a scripts-local copy", async () => {
  const { slugify: canonical } = await import("../client/src/utils/slugify.js");
  assert.equal(slugify, canonical);
});

// ---------------------------------------------------------------------------
// buildItemPageUrl
// ---------------------------------------------------------------------------

test("buildItemPageUrl: spaces become underscores under /wiki/", () => {
  assert.equal(buildItemPageUrl("Weapons/Nagant M1895"), "https://huntshowdown.wiki.gg/wiki/Weapons/Nagant_M1895");
});

test("buildItemPageUrl: namespace and variant separators survive encoding", () => {
  // Regression: encodeURIComponent over the whole path turned every "/" into %2F, which 404s.
  assert.equal(buildItemPageUrl("Weapons/Sparks/Pistol"), "https://huntshowdown.wiki.gg/wiki/Weapons/Sparks/Pistol");
  assert.ok(!buildItemPageUrl("Weapons/Mosin-Nagant/Avtomat").includes("%2F"));
});

test("buildItemPageUrl: special characters inside a segment are percent-encoded", () => {
  const url = buildItemPageUrl("Weapons/Crown & King Auto-5");
  assert.ok(url.startsWith("https://huntshowdown.wiki.gg/wiki/Weapons/"));
  assert.ok(!url.includes(" "));
  assert.ok(url.includes("%26"), "the ampersand should be encoded");
  // Round-trips back to the original title once decoded.
  const decoded = decodeURIComponent(url.replace("https://huntshowdown.wiki.gg/wiki/Weapons/", "")).replace(/_/g, " ");
  assert.equal(decoded, "Crown & King Auto-5");
});

// ---------------------------------------------------------------------------
// resolveWikiPath / override table
// ---------------------------------------------------------------------------

test("resolveWikiPath: defaults to the item's own category namespace", () => {
  assert.equal(resolveWikiPath("weapons", "nagant-m1895", "Nagant M1895"), "Weapons/Nagant_M1895");
  assert.equal(resolveWikiPath("traits", "bulletgrubber", "Bulletgrubber"), "Traits/Bulletgrubber");
});

test("resolveWikiPath: applies pre-1896 rename overrides", () => {
  assert.equal(resolveWikiPath("weapons", "sparks-lrr", "Sparks LRR"), "Weapons/Sparks");
  assert.equal(resolveWikiPath("weapons", "caldwell-pax", "Caldwell Pax"), "Weapons/Pax");
  assert.equal(
    resolveWikiPath("weapons", "winfield-1876-centennial", "Winfield 1876 Centennial"),
    "Weapons/Centennial"
  );
});

test("resolveWikiPath: maps weapon variants to their subpage", () => {
  assert.equal(resolveWikiPath("weapons", "sparks-pistol", "Sparks Pistol"), "Weapons/Sparks/Pistol");
  assert.equal(
    resolveWikiPath("weapons", "mosin-nagant-avtomat", "Mosin-Nagant Avtomat"),
    "Weapons/Mosin-Nagant/Avtomat"
  );
  assert.equal(
    resolveWikiPath("weapons", "nagant-officer-carbine", "Nagant Officer Carbine"),
    "Weapons/Officer/Carbine"
  );
});

test("resolveWikiPath: can cross categories (the Katana is a Tool here, a Weapon on the wiki)", () => {
  assert.equal(resolveWikiPath("tools", "katana", "Katana"), "Weapons/Katana");
});

test("resolveWikiPath: pluralizes the trap tools the way the wiki does", () => {
  assert.equal(
    resolveWikiPath("tools", "alert-trip-mine", "Alert Trip Mine"),
    "Tools/Alert_Trip_Mines"
  );
  assert.equal(
    resolveWikiPath("tools", "poison-trip-mine", "Poison Trip Mine"),
    "Tools/Poison_Trip_Mines"
  );
});

test("resolveWikiPath: returns null for known catalog duplicates", () => {
  assert.equal(resolveWikiPath("weapons", "winfield-m1873c", "Winfield M1873C"), null);
});

// Issue #67: the "Choke Bomb" consumable duplicated the "Choke Bombs" tool and was skipped
// by the scrape rather than removed from the catalog. It is gone from CONS now, so the
// surviving tool must resolve normally and nothing may re-add a null override for the
// retired consumable id.
test("resolveWikiPath: the retired Choke Bomb duplicate is gone, the tool resolves", () => {
  assert.equal(resolveWikiPath("tools", "choke-bombs", "Choke Bombs"), "Tools/Choke_Bombs");
  assert.equal(KNOWN_CATALOG_DUPLICATES["choke-bomb"], undefined);
  assert.ok(!collectCatalogItems(["consumables"]).some((i) => i.id === "choke-bomb"));
});

// Regression: "Winfield M1873" is the live weapon the wiki calls "Ranger 73", not a duplicate.
// It was mapped to null, so the only catalog entry for that weapon was skipped by every run.
test("resolveWikiPath: Winfield M1873 resolves to the renamed Ranger 73 page, not null", () => {
  assert.equal(resolveWikiPath("weapons", "winfield-m1873", "Winfield M1873"), "Weapons/Ranger_73");
});

// The override table is keyed by catalog id precisely so that ADR-0005's name write-through
// (the wiki is authoritative for display names) cannot silently invalidate it. Renaming an item
// must not change which page it resolves to.
test("resolveWikiPath: overrides survive a display-name change", () => {
  assert.equal(
    resolveWikiPath("weapons", "nagant-officer-carbine", "Officer Carbine"),
    "Weapons/Officer/Carbine"
  );
  assert.equal(resolveWikiPath("weapons", "caldwell-pax", "Pax"), "Weapons/Pax");
});

test("every null override has an explanation in KNOWN_CATALOG_DUPLICATES", () => {
  for (const [category, overrides] of Object.entries(WIKI_TITLE_OVERRIDES)) {
    for (const [id, target] of Object.entries(overrides)) {
      if (target === null) {
        assert.ok(
          KNOWN_CATALOG_DUPLICATES[id],
          `${category}/"${id}" is mapped to null but has no KNOWN_CATALOG_DUPLICATES entry`
        );
      }
    }
  }
});

test("every override key names a real catalog item", () => {
  for (const [category, overrides] of Object.entries(WIKI_TITLE_OVERRIDES)) {
    const ids = new Set(collectCatalogItems([category]).map((i) => i.id));
    for (const id of Object.keys(overrides)) {
      assert.ok(ids.has(id), `override ${category}/"${id}" does not match any catalog item`);
    }
  }
});

// Guards the ADR-0005 invariant that ids are the stable key: a name-keyed override would pass
// the test above today and start failing silently the first time a rename lands.
test("override keys are catalog ids, never display names", () => {
  for (const [category, overrides] of Object.entries(WIKI_TITLE_OVERRIDES)) {
    for (const id of Object.keys(overrides)) {
      assert.equal(
        id,
        slugify(id),
        `override ${category}/"${id}" is not a slug-style catalog id (did you key it by display name?)`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// extractImageUrl
// ---------------------------------------------------------------------------

test("extractImageUrl: prefers the og:image meta tag", () => {
  const html = `<html><head><meta property="og:image" content="https://huntshowdown.wiki.gg/images/a/ab/Nagant.png"></head></html>`;
  assert.equal(extractImageUrl(html), "https://huntshowdown.wiki.gg/images/a/ab/Nagant.png");
});

test("extractImageUrl: handles reversed attribute order on the meta tag", () => {
  const html = `<meta content="https://huntshowdown.wiki.gg/images/x.png" property="og:image">`;
  assert.equal(extractImageUrl(html), "https://huntshowdown.wiki.gg/images/x.png");
});

test("extractImageUrl: falls back to an infobox image when there's no og:image", () => {
  const html = `<div class="pi-image"><img src="/images/b/bc/Item.jpg" alt="Item"></div>`;
  assert.equal(extractImageUrl(html), "/images/b/bc/Item.jpg");
});

test("extractImageUrl: returns null when nothing matches", () => {
  const html = `<html><body><p>No images here.</p></body></html>`;
  assert.equal(extractImageUrl(html), null);
});

// ---------------------------------------------------------------------------
// extForContentType
// ---------------------------------------------------------------------------

test("extForContentType: maps known content types", () => {
  assert.equal(extForContentType("image/png", "https://x/y"), "png");
  assert.equal(extForContentType("image/jpeg; charset=binary", "https://x/y"), "jpg");
});

test("extForContentType: falls back to the URL extension, then jpg", () => {
  assert.equal(extForContentType(null, "https://x/y/image.webp?foo=bar"), "webp");
  assert.equal(extForContentType(null, "https://x/y/no-extension"), "jpg");
});

// ---------------------------------------------------------------------------
// robots.txt parsing + enforcement
// ---------------------------------------------------------------------------

test("parseRobotsTxt: groups rules under their user-agent(s)", () => {
  const text = [
    "User-agent: *",
    "Disallow: /private/",
    "Allow: /private/allowed/",
    "",
    "User-agent: BadBot",
    "Disallow: /",
  ].join("\n");
  const groups = parseRobotsTxt(text);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].userAgents, ["*"]);
  assert.deepEqual(groups[0].rules, [
    { type: "disallow", path: "/private/" },
    { type: "allow", path: "/private/allowed/" },
  ]);
  assert.deepEqual(groups[1].userAgents, ["BadBot"]);
});

test("parseRobotsTxt: ignores comments and blank lines", () => {
  const text = "# comment\nUser-agent: *\n# another comment\nDisallow: /wiki/Special:\n";
  const groups = parseRobotsTxt(text);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].rules, [{ type: "disallow", path: "/wiki/Special:" }]);
});

test("isAllowedByRobots: allows paths with no matching rule", () => {
  const groups = parseRobotsTxt("User-agent: *\nDisallow: /admin/\n");
  assert.equal(isAllowedByRobots(groups, "AnyBot", "/wiki/Nagant_M1895"), true);
});

test("isAllowedByRobots: disallows paths matching a Disallow rule", () => {
  const groups = parseRobotsTxt("User-agent: *\nDisallow: /wiki/Special:\n");
  assert.equal(isAllowedByRobots(groups, "AnyBot", "/wiki/Special:Search"), false);
});

test("isAllowedByRobots: longest-prefix match wins, Allow overrides a shorter Disallow", () => {
  const groups = parseRobotsTxt("User-agent: *\nDisallow: /wiki/\nAllow: /wiki/Nagant_M1895\n");
  assert.equal(isAllowedByRobots(groups, "AnyBot", "/wiki/Nagant_M1895"), true);
  assert.equal(isAllowedByRobots(groups, "AnyBot", "/wiki/OtherPage"), false);
});

test("isAllowedByRobots: no groups at all means allow-all", () => {
  assert.equal(isAllowedByRobots([], "AnyBot", "/wiki/Anything"), true);
});

test("isAllowedByRobots: merges every matching '*' group, not just the first", () => {
  // Regression: huntshowdown.wiki.gg publishes a Cloudflare-managed "User-agent: *" block with
  // only "Allow: /", then wiki.gg's own "User-agent: *" block with the real Disallow list.
  // Taking the first matching group silently discarded the second one.
  const groups = parseRobotsTxt(
    ["User-agent: *", "Allow: /", "", "User-agent: *", "Disallow: /wiki/File:", "Disallow: /wiki/Special:"].join("\n")
  );
  assert.equal(groups.filter((g) => g.userAgents.includes("*")).length, 2, "fixture should have two '*' groups");
  assert.equal(isAllowedByRobots(groups, "AnyBot", "/wiki/File:Foo.png"), false);
  assert.equal(isAllowedByRobots(groups, "AnyBot", "/wiki/Special:Search"), false);
  assert.equal(isAllowedByRobots(groups, "AnyBot", "/wiki/Weapons/Nagant_M1895"), true);
});

test("isAllowedByRobots: a UA-specific group still wins over the wildcard groups", () => {
  const groups = parseRobotsTxt(["User-agent: *", "Disallow: /", "", "User-agent: GoodBot", "Allow: /"].join("\n"));
  assert.equal(isAllowedByRobots(groups, "GoodBot/1.0", "/wiki/Anything"), true);
  assert.equal(isAllowedByRobots(groups, "OtherBot/1.0", "/wiki/Anything"), false);
});

test("fetchRobotsTxt: parses a successful response", async () => {
  const fetchFn = async (url) => {
    assert.equal(url, "https://huntshowdown.wiki.gg/robots.txt");
    return {
      ok: true,
      status: 200,
      text: async () => "User-agent: *\nDisallow: /admin/\n",
    };
  };
  const groups = await fetchRobotsTxt(fetchFn, "TestAgent");
  assert.equal(groups.length, 1);
});

test("fetchRobotsTxt: a 404 is treated as allow-all (empty rule set)", async () => {
  const fetchFn = async () => ({ ok: false, status: 404, text: async () => "" });
  const groups = await fetchRobotsTxt(fetchFn, "TestAgent");
  assert.deepEqual(groups, []);
});

test("fetchRobotsTxt: a non-404 HTTP failure throws NetworkFailureError", async () => {
  const fetchFn = async () => ({ ok: false, status: 503, text: async () => "" });
  await assert.rejects(() => fetchRobotsTxt(fetchFn, "TestAgent"), NetworkFailureError);
});

test("fetchRobotsTxt: a network exception is wrapped as NetworkFailureError", async () => {
  const fetchFn = async () => {
    throw new Error("ECONNRESET");
  };
  await assert.rejects(() => fetchRobotsTxt(fetchFn, "TestAgent"), NetworkFailureError);
});

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

test("RateLimiter: does not sleep before the first request", async () => {
  const sleeps = [];
  const limiter = new RateLimiter(1000, { now: () => 0, sleep: async (ms) => sleeps.push(ms) });
  await limiter.wait();
  assert.deepEqual(sleeps, []);
});

test("RateLimiter: sleeps for the remaining delay on a subsequent request", async () => {
  const sleeps = [];
  let currentTime = 0;
  const limiter = new RateLimiter(1000, {
    now: () => currentTime,
    sleep: async (ms) => {
      sleeps.push(ms);
      currentTime += ms; // simulate time passing during the sleep
    },
  });
  await limiter.wait(); // t=0, no sleep, lastRequestAt=0
  currentTime = 300; // only 300ms elapsed
  await limiter.wait(); // needs to sleep 700ms more
  assert.deepEqual(sleeps, [700]);
});

test("RateLimiter: does not sleep if enough time has already elapsed", async () => {
  const sleeps = [];
  let currentTime = 0;
  const limiter = new RateLimiter(500, { now: () => currentTime, sleep: async (ms) => sleeps.push(ms) });
  await limiter.wait();
  currentTime = 1000; // well past the minimum delay
  await limiter.wait();
  assert.deepEqual(sleeps, []);
});

// ---------------------------------------------------------------------------
// collectCatalogItems
// ---------------------------------------------------------------------------

test("collectCatalogItems: covers all four categories by default", () => {
  const items = collectCatalogItems();
  const seenCategories = new Set(items.map((i) => i.category));
  assert.deepEqual([...seenCategories].sort(), [...CATEGORIES].sort());
  assert.ok(items.length > 50, "expected a substantial number of catalog items");
});

test("collectCatalogItems: each item has a name and a slug", () => {
  const items = collectCatalogItems(["weapons"]);
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(item.category, "weapons");
    assert.ok(item.name.length > 0);
    assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(item.slug), `unexpected slug shape: ${item.slug}`);
  }
});

test("collectCatalogItems: restricting to one category excludes the others", () => {
  const items = collectCatalogItems(["traits"]);
  assert.ok(items.every((i) => i.category === "traits"));
});

// ---------------------------------------------------------------------------
// summary aggregation
// ---------------------------------------------------------------------------

test("createSummary/recordResult: buckets results by status", () => {
  const summary = createSummary();
  recordResult(summary, { status: "succeeded", category: "weapons", item: "A", slug: "a" });
  recordResult(summary, { status: "failed", category: "tools", item: "B", slug: "b", reason: "boom" });
  recordResult(summary, { status: "skipped", category: "traits", item: "C", slug: "c", reason: "exists" });
  assert.equal(summary.succeeded.length, 1);
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.skipped.length, 1);
});

test("formatSummary: includes counts and per-item reasons for failed/skipped", () => {
  const summary = createSummary();
  recordResult(summary, { status: "failed", category: "weapons", item: "Nagant M1895", slug: "nagant-m1895", reason: "HTTP 404" });
  const text = formatSummary(summary);
  assert.match(text, /0 succeeded, 1 failed, 0 skipped/);
  assert.match(text, /Nagant M1895/);
  assert.match(text, /HTTP 404/);
});

// ---------------------------------------------------------------------------
// scrapeItem: per-item flow against a faked fetch + faked filesystem, including every sentinel
// error path and the "never crash the whole run" guarantee (exercised via runScrape below).
// ---------------------------------------------------------------------------

function makeFsStub({ existing = new Set() } = {}) {
  const written = [];
  return {
    written,
    fsAccess: async (p) => {
      if (!existing.has(p)) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
    },
    fsMkdir: async () => {},
    fsWriteFile: async (p, buf) => {
      written.push({ path: p, size: buf.length });
    },
  };
}

const okRobots = [];
const okRateLimiter = { wait: async () => {} };

test("scrapeItem: succeeds end-to-end with og:image extraction", async () => {
  const html = `<meta property="og:image" content="https://huntshowdown.wiki.gg/images/a/ab/Nagant.png">`;
  const fetchFn = async (url) => {
    if (url.includes("/wiki/")) {
      return { ok: true, status: 200, text: async () => html };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => new TextEncoder().encode("fake-bytes").buffer,
    };
  };
  const fs = makeFsStub();
  const result = await scrapeItem(
    { category: "weapons", name: "Nagant M1895", slug: "nagant-m1895" },
    { fetchFn, rateLimiter: okRateLimiter, robotsGroups: okRobots, ...fs }
  );
  assert.equal(result.status, "succeeded");
  assert.ok(result.path.endsWith("weapons/nagant-m1895.png"));
  assert.equal(fs.written.length, 1);
});

test("scrapeItem: skips when a file for the slug already exists and force is not set", async () => {
  const imagesRoot = `${process.cwd()}/whatever`;
  const fsExisting = new Set([`${imagesRoot}/weapons/nagant-m1895.png`]);
  const fs = makeFsStub({ existing: fsExisting });
  const fetchFn = async () => {
    throw new Error("should not be called");
  };
  const result = await scrapeItem(
    { category: "weapons", name: "Nagant M1895", slug: "nagant-m1895" },
    { fetchFn, rateLimiter: okRateLimiter, robotsGroups: okRobots, imagesRoot, ...fs }
  );
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /already exists/);
});

test("scrapeItem: skips a known catalog duplicate without spending a request", async () => {
  const fetchFn = async () => {
    throw new Error("should not be called for an item with no wiki page");
  };
  const fs = makeFsStub();
  const result = await scrapeItem(
    {
      category: "weapons",
      id: "winfield-m1873c",
      name: "Winfield M1873C",
      slug: "winfield-m1873c",
      wikiPath: null,
    },
    { fetchFn, rateLimiter: okRateLimiter, robotsGroups: okRobots, ...fs }
  );
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /no wiki page/);
  assert.match(result.reason, /Frontier 73C/);
  assert.equal(fs.written.length, 0);
});

test("scrapeItem: requests the namespaced page URL, not the bare item name", async () => {
  // Regression: the script used to build /wiki/Nagant_M1895, which 404s for every catalog item.
  const requested = [];
  const html = `<meta property="og:image" content="https://huntshowdown.wiki.gg/images/x.png">`;
  const fetchFn = async (url) => {
    requested.push(url);
    return { ok: true, status: 200, text: async () => html };
  };
  const fs = makeFsStub();
  await scrapeItem(
    { category: "weapons", name: "Nagant M1895", slug: "nagant-m1895" },
    { fetchFn, rateLimiter: okRateLimiter, robotsGroups: okRobots, dryRun: true, ...fs }
  );
  assert.equal(requested[0], "https://huntshowdown.wiki.gg/wiki/Weapons/Nagant_M1895");
});

test("scrapeItem: throws ItemPageNotFoundError on a 404 page", async () => {
  const fetchFn = async () => ({ ok: false, status: 404, text: async () => "" });
  const fs = makeFsStub();
  await assert.rejects(
    () =>
      scrapeItem(
        { category: "weapons", name: "Ghost Weapon", slug: "ghost-weapon" },
        { fetchFn, rateLimiter: okRateLimiter, robotsGroups: okRobots, ...fs }
      ),
    ItemPageNotFoundError
  );
});

test("scrapeItem: throws ImageAssetNotFoundError when the page has no extractable image", async () => {
  const fetchFn = async () => ({ ok: true, status: 200, text: async () => "<html>no image here</html>" });
  const fs = makeFsStub();
  await assert.rejects(
    () =>
      scrapeItem(
        { category: "tools", name: "Mystery Tool", slug: "mystery-tool" },
        { fetchFn, rateLimiter: okRateLimiter, robotsGroups: okRobots, ...fs }
      ),
    ImageAssetNotFoundError
  );
});

test("scrapeItem: throws NetworkFailureError on a non-404 page HTTP error", async () => {
  const fetchFn = async () => ({ ok: false, status: 503, text: async () => "" });
  const fs = makeFsStub();
  await assert.rejects(
    () =>
      scrapeItem(
        { category: "tools", name: "Some Tool", slug: "some-tool" },
        { fetchFn, rateLimiter: okRateLimiter, robotsGroups: okRobots, ...fs }
      ),
    NetworkFailureError
  );
});

test("scrapeItem: throws NetworkFailureError when the underlying fetch rejects", async () => {
  const fetchFn = async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  };
  const fs = makeFsStub();
  await assert.rejects(
    () =>
      scrapeItem(
        { category: "tools", name: "Unreachable Tool", slug: "unreachable-tool" },
        { fetchFn, rateLimiter: okRateLimiter, robotsGroups: okRobots, ...fs }
      ),
    NetworkFailureError
  );
});

test("scrapeItem: throws RobotsDisallowedError when robots.txt disallows the page path", async () => {
  const groups = parseRobotsTxt("User-agent: *\nDisallow: /wiki/\n");
  const fetchFn = async () => {
    throw new Error("should not be called");
  };
  const fs = makeFsStub();
  await assert.rejects(
    () =>
      scrapeItem(
        { category: "traits", name: "Blocked Trait", slug: "blocked-trait" },
        { fetchFn, rateLimiter: okRateLimiter, robotsGroups: groups, ...fs }
      ),
    RobotsDisallowedError
  );
});

test("scrapeItem: dry-run resolves the image URL but does not fetch or write it", async () => {
  const html = `<meta property="og:image" content="https://huntshowdown.wiki.gg/images/x.png">`;
  let imageFetchCalled = false;
  const fetchFn = async (url) => {
    if (url.includes("/wiki/")) return { ok: true, status: 200, text: async () => html };
    imageFetchCalled = true;
    throw new Error("should not fetch the image in dry-run mode");
  };
  const fs = makeFsStub();
  const result = await scrapeItem(
    { category: "consumables", name: "Vitality Shot", slug: "vitality-shot" },
    { fetchFn, rateLimiter: okRateLimiter, robotsGroups: okRobots, dryRun: true, ...fs }
  );
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /dry-run/);
  assert.equal(imageFetchCalled, false);
  assert.equal(fs.written.length, 0);
});

// ---------------------------------------------------------------------------
// runScrape: the run-level guarantee that one item's failure never aborts the whole run, and
// that a per-run structured summary is produced.
// ---------------------------------------------------------------------------

test("runScrape: one item's failure does not abort the run; summary captures both outcomes", async () => {
  const html = `<meta property="og:image" content="https://huntshowdown.wiki.gg/images/x.png">`;
  const fetchFn = async (url) => {
    if (url === "https://huntshowdown.wiki.gg/robots.txt") {
      return { ok: true, status: 200, text: async () => "User-agent: *\n" };
    }
    if (url.includes("/wiki/Traits/Quartermaster")) {
      return { ok: false, status: 404, text: async () => "" };
    }
    if (url.includes("/wiki/")) {
      return { ok: true, status: 200, text: async () => html };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => new TextEncoder().encode("bytes").buffer,
    };
  };
  const fs = makeFsStub();
  const logs = [];

  const summary = await runScrape(
    { categories: ["traits"], delayMs: 0 },
    { fetchFn, log: (e) => logs.push(e), ...fs }
  );

  assert.equal(summary.failed.length, 1);
  assert.equal(summary.failed[0].item, "Quartermaster");
  assert.ok(summary.succeeded.length > 0, "other traits should still have succeeded");

  const summaryLog = logs.find((l) => l.event === "run-summary");
  assert.ok(summaryLog, "expected a structured run-summary log entry");
  assert.equal(summaryLog.failed, 1);

  const failureLog = logs.find((l) => l.event === "item-failed");
  assert.ok(failureLog);
  assert.equal(failureLog.item, "Quartermaster");
  assert.ok(failureLog.reason.length > 0);
});

test("runScrape: aborts the whole run (fails closed) if robots.txt itself cannot be fetched", async () => {
  const fetchFn = async (url) => {
    if (url === "https://huntshowdown.wiki.gg/robots.txt") {
      throw new Error("network down");
    }
    throw new Error("should not reach item fetches");
  };
  const fs = makeFsStub();
  const logs = [];
  await assert.rejects(
    () => runScrape({ categories: ["traits"], delayMs: 0 }, { fetchFn, log: (e) => logs.push(e), ...fs }),
    NetworkFailureError
  );
  assert.ok(logs.some((l) => l.event === "robots-fetch-failed"));
});

// ---------------------------------------------------------------------------
// Sentinel error shape
// ---------------------------------------------------------------------------

test("sentinel errors carry item/url context and are distinguishable by class", () => {
  const err = new ItemPageNotFoundError("item page not found", { item: "Foo", url: "https://x/y" });
  assert.ok(err instanceof ScrapeError);
  assert.ok(err instanceof Error);
  assert.equal(err.item, "Foo");
  assert.equal(err.url, "https://x/y");
  assert.equal(err.name, "ItemPageNotFoundError");
});

// Governing: ADR-0002, SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback"
//
// The on-disk contract, asserted rather than eyeballed. It has been broken twice in quick succession
// and neither break produced an error: #157 added 26 trait rows with no art, so eight Stealth traits
// shared one group-keyed SVG; #232 renamed 18 items, and because `slugify(name)` IS the image path,
// every one of them would have pointed at a file that no longer existed. Both were caught by hand.
//
// Read from disk on purpose. The failure mode is a missing or misnamed FILE, so a fixture would test
// the wrong thing — this is the one place where touching the filesystem is the point.
test("image coverage: every catalog row has art, and no file is orphaned", async () => {
  const { readdirSync } = await import("node:fs");
  const rows = { weapons: WEAPONS, tools: TOOLS, traits: TRAITS, consumables: CONS };
  const missing = [];
  const orphaned = [];
  for (const [category, items] of Object.entries(rows)) {
    const dir = new URL(`../client/public/images/${category}/`, import.meta.url);
    const onDisk = new Set(readdirSync(dir).map((f) => f.replace(/\.[a-z0-9]+$/i, "")));
    for (const row of items) {
      // A known duplicate has no wiki page of its own, so it has no art to fetch. That is the same
      // list the scrape skips against, so the exemption cannot drift from the reason for it.
      if (Object.prototype.hasOwnProperty.call(KNOWN_CATALOG_DUPLICATES, row[0])) continue;
      if (!onDisk.has(slugify(row[1]))) missing.push(`${category}/${slugify(row[1])} (${row[0]})`);
    }
    const wanted = new Set(items.map((r) => slugify(r[1])));
    for (const file of onDisk) if (!wanted.has(file)) orphaned.push(`${category}/${file}`);
  }
  assert.deepEqual(missing, [], "a row with no art falls back to its GROUP's icon, so items share a glyph");
  // Orphans are the rename half: a file left behind under an old slug is dead weight, and its
  // presence means nothing is pointing at it.
  assert.deepEqual(orphaned, [], "an image no catalog row resolves to should be deleted or renamed");
});
