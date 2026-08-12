// Governing: ADR-0005 (Scrape Item Stats into a Generated, Committed Data File)
// Implements: SPEC-0007 REQ "Offline, Human-Invoked Stats Scrape", SPEC-0007 REQ "Error Handling
// Standards"
//
// Unit tests for scripts/scrape-stats.mjs. No live network call is made anywhere in this file —
// HTTP is faked via an injected fetchFn — per the constraint that this script must never be
// exercised against the real huntshowdown.wiki.gg as a side effect of testing.
//
// The infobox fixtures below are trimmed from real markup fetched from
// /wiki/Weapons/Ranger_73 on 2026-08-10, not invented: the wiki renders stats with the Druid
// skin's infobox, where each field carries its own name in a class
// (`druid-data druid-data-Price druid-data-nonempty`). Writing these against imagined
// portable-infobox markup would have produced a parser that passes its tests and fails on a real
// page.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CATEGORIES,
  InfoboxFieldNotFoundError,
  InfoboxNotFoundError,
  ItemPageNotFoundError,
  NetworkFailureError,
  RateLimiter,
  RobotsDisallowedError,
  acquisitionOf,
  acquisitionClassesFrom,
  parseDescription,
  parsePageCategories,
  applyCatalogWrites,
  buildStatsRecord,
  canonicalTitleFromPageName,
  categoryLineRange,
  CATEGORY_INDEX,
  classifyPage,
  classifyPageFetchError,
  createSummary,
  extractInfoboxTitle,
  extractInfoboxes,
  formatCatalogPlan,
  formatCoverage,
  formatSummary,
  isPartialRun,
  parseArgs,
  parseCategoryMembers,
  parseInfoboxFields,
  parseNumeric,
  planCatalogWrites,
  rangeViolation,
  replaceTupleField,
  readInfoboxField,
  runDiscovery,
  runStatsScrape,
  scrapeItemStats,
  selectBaseInfobox,
  sliceBalancedDiv,
  textContent,
  writeStatsFile,
} from "./scrape-stats.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRICE_ROW =
  '<div class="druid-row druid-row-Price"><div class="druid-label druid-label-Price">Price</div>' +
  '<div class="druid-data druid-data-Price druid-data-nonempty">\n75&#160;' +
  '<a href="/wiki/Hunt_Dollars" title="Hunt Dollars"><img alt="Hunt Dollars" src="/x.png" /></a></div></div>';

const SIZE_ROW =
  '<div class="druid-row druid-row-Size"><div class="druid-label druid-label-Size">Size</div>' +
  '<div class="druid-data druid-data-Size druid-data-nonempty">\n' +
  '<a href="/wiki/Category:Weapons/Size_4" title="Category:Weapons/Size 4">4</a> ' +
  '<a href="/wiki/Category:Weapons/4"><img alt="4" src="/y.png" /></a></div></div>';

const AMMO_ROW =
  '<div class="druid-row druid-row-AmmoType"><div class="druid-label druid-label-AmmoType">Ammo Type</div>' +
  '<div class="druid-data druid-data-AmmoType druid-data-nonempty">\n' +
  '<a href="/wiki/Category:Compact_Ammo" title="Category:Compact Ammo">Compact</a></div></div>';

const infobox = (rows) => `<div class="druid-infobox druid-container">${rows}</div>`;

const ONE_INFOBOX_PAGE = `<html><body><p>intro</p>${infobox(PRICE_ROW + SIZE_ROW + AMMO_ROW)}</body></html>`;
const TWO_INFOBOX_PAGE =
  `<html><body>${infobox(PRICE_ROW)}<p>variant</p>` +
  `${infobox('<div class="druid-data druid-data-Price druid-data-nonempty">120</div>')}</body></html>`;

const okResponse = (body) => ({ ok: true, status: 200, text: async () => body });
const errResponse = (status) => ({ ok: false, status, text: async () => "" });

/**
 * A page whose RLCONF name and infobox title both derive from the URL being fetched.
 *
 * Since #184 the scrape selects its infobox by matching the page's canonical title, so a fixture
 * without a title resolves to nothing — correctly. Deriving both from the URL keeps the generic
 * fixture faithful to that contract instead of working around it.
 */
function pageForUrl(url, rows = PRICE_ROW + SIZE_ROW + AMMO_ROW) {
  const pageName = decodeURIComponent(new URL(url).pathname.replace(/^\/wiki\//, ""));
  const title = pageName.replace(/^[^/]+\//, "").replace(/[/_]+/g, " ");
  return (
    `<html><script>RLCONF={"wgPageName":"${pageName}","wgCurRevisionId":16192};</script><body>` +
    `<div class="druid-infobox druid-container"><div><div class="druid-title">${title}</div></div>${rows}</div>` +
    `</body></html>`
  );
}

/**
 * A fetchFn that serves robots.txt permissively and routes every wiki page to `pageBody`.
 * Passing no body yields a URL-derived page that selection can resolve.
 */
function fakeFetch(pageBody, { robots = "User-agent: *\nDisallow:\n", onPage } = {}) {
  return async (url) => {
    if (url.endsWith("/robots.txt")) return { ok: true, status: 200, text: async () => robots };
    if (onPage) return onPage(url);
    return okResponse(pageBody ?? pageForUrl(url));
  };
}

const noWait = { wait: async () => {} };

// ---------------------------------------------------------------------------
// sliceBalancedDiv
// ---------------------------------------------------------------------------

test("sliceBalancedDiv: returns the whole block when divs nest", () => {
  const html = '<div class="a"><div class="b">inner</div>tail</div>after';
  const block = sliceBalancedDiv(html, 0);
  assert.equal(block, '<div class="a"><div class="b">inner</div>tail</div>');
});

test("sliceBalancedDiv: a lazy regex would truncate here, the scanner does not", () => {
  const html = "<div><div><div>deep</div></div></div>";
  assert.equal(sliceBalancedDiv(html, 0), html);
  // The failure this scanner exists to avoid, stated as the contrast:
  assert.notEqual(html.match(/<div[^>]*>[\s\S]*?<\/div>/)[0], html);
});

test("sliceBalancedDiv: returns null on an unterminated div rather than a partial slice", () => {
  assert.equal(sliceBalancedDiv("<div><div>unclosed</div>", 0), null);
});

test("sliceBalancedDiv: self-closing divs do not change depth", () => {
  const html = "<div>a<div/>b</div>";
  assert.equal(sliceBalancedDiv(html, 0), html);
});

// ---------------------------------------------------------------------------
// extractInfoboxes
// ---------------------------------------------------------------------------

test("extractInfoboxes: finds the single infobox on a page", () => {
  const boxes = extractInfoboxes(ONE_INFOBOX_PAGE);
  assert.equal(boxes.length, 1);
  assert.match(boxes[0], /druid-data-Price/);
});

test("extractInfoboxes: returns every infobox in document order", () => {
  const boxes = extractInfoboxes(TWO_INFOBOX_PAGE);
  assert.equal(boxes.length, 2);
  assert.match(boxes[0], /75/);
  assert.match(boxes[1], /120/);
});

test("extractInfoboxes: returns an empty array when the page carries none", () => {
  assert.deepEqual(extractInfoboxes("<html><body><p>no infobox here</p></body></html>"), []);
});

// ---------------------------------------------------------------------------
// parseInfoboxFields
// ---------------------------------------------------------------------------

test("parseInfoboxFields: reads each field under its class-derived name", () => {
  const fields = parseInfoboxFields(infobox(PRICE_ROW + SIZE_ROW + AMMO_ROW));
  assert.equal(fields.Price, "75");
  assert.equal(fields.Size, "4");
  assert.equal(fields.AmmoType, "Compact");
});

test("parseInfoboxFields: presentation modifiers are not fields", () => {
  const fields = parseInfoboxFields(infobox(PRICE_ROW));
  assert.equal("nonempty" in fields, false);
  assert.equal("wide" in fields, false);
  assert.deepEqual(Object.keys(fields), ["Price"]);
});

test("parseInfoboxFields: strips markup and decodes entities to reader-visible text", () => {
  const row = '<div class="druid-data druid-data-Description">Bornheim No.&#160;3 &amp; friends</div>';
  assert.equal(parseInfoboxFields(infobox(row)).Description, "Bornheim No. 3 & friends");
});

test("parseInfoboxFields: first occurrence wins when a field repeats", () => {
  const rows =
    '<div class="druid-data druid-data-Price">75</div><div class="druid-data druid-data-Price">999</div>';
  assert.equal(parseInfoboxFields(infobox(rows)).Price, "75");
});

test("parseInfoboxFields: an infobox with no data rows yields no fields", () => {
  assert.deepEqual(parseInfoboxFields(infobox("<p>nothing</p>")), {});
});

test("textContent: drops script and style content rather than inlining it", () => {
  // Removing the element joins the text that surrounded it, which is what a reader sees.
  assert.equal(textContent("<div>a<script>var x=1;</script>b</div>"), "ab");
  assert.equal(textContent("<div>a<style>.x{}</style>b</div>"), "ab");
});

// ---------------------------------------------------------------------------
// readInfoboxField — SPEC-0007 "field absent from an existing infobox" is its own failure mode
// ---------------------------------------------------------------------------

test("readInfoboxField: returns the value when present", () => {
  assert.equal(readInfoboxField({ Price: "75" }, "Price", { item: "X", url: "u" }), "75");
});

/** assert.throws returns undefined, so capture the error when the test inspects its properties. */
function captureThrow(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return assert.fail("expected the call to throw, but it returned normally");
}

test("readInfoboxField: throws InfoboxFieldNotFoundError carrying item, url, and field", () => {
  const err = captureThrow(() =>
    readInfoboxField({ Price: "75" }, "Size", { item: "Ranger 73", url: "https://w/x" })
  );
  assert.ok(err instanceof InfoboxFieldNotFoundError);
  assert.equal(err.field, "Size");
  assert.equal(err.item, "Ranger 73");
  assert.equal(err.url, "https://w/x");
  assert.match(err.message, /has no "Size" field/);
});

test("readInfoboxField: an empty string counts as absent", () => {
  assert.throws(() => readInfoboxField({ Size: "" }, "Size", {}), InfoboxFieldNotFoundError);
});

// ---------------------------------------------------------------------------
// Failure modes stay distinguishable (SPEC-0007 REQ "Error Handling Standards")
// ---------------------------------------------------------------------------

test("classifyPageFetchError: 404 is a missing page, other statuses are network failures", () => {
  assert.ok(classifyPageFetchError(404, "X", "u") instanceof ItemPageNotFoundError);
  assert.ok(classifyPageFetchError(500, "X", "u") instanceof NetworkFailureError);
  assert.ok(classifyPageFetchError(429, "X", "u") instanceof NetworkFailureError);
});

test("a rate-limit failure and a missing field are distinct types, not one generic error", () => {
  const rateLimited = classifyPageFetchError(429, "A", "https://w/a");
  const missingField = new InfoboxFieldNotFoundError("no field", { item: "B", field: "Price" });
  assert.notEqual(rateLimited.name, missingField.name);
  assert.equal(rateLimited instanceof InfoboxFieldNotFoundError, false);
  assert.equal(missingField instanceof NetworkFailureError, false);
});

test("every sentinel carries the context its message promises", () => {
  const err = classifyPageFetchError(404, "Ranger 73", "https://w/Ranger_73");
  assert.equal(err.item, "Ranger 73");
  assert.equal(err.url, "https://w/Ranger_73");
  assert.match(err.message, /Ranger 73/);
  assert.match(err.message, /https:\/\/w\/Ranger_73/);
});

// ---------------------------------------------------------------------------
// scrapeItemStats
// ---------------------------------------------------------------------------

const target = { category: "weapons", id: "ranger-73", name: "Ranger 73", wikiPath: "Weapons/Ranger_73" };
const allowAll = [{ userAgents: ["*"], rules: [] }];

test("scrapeItemStats: parses fields from a page and reports how many infoboxes it saw", async () => {
  const result = await scrapeItemStats(target, {
    fetchFn: fakeFetch(),
    rateLimiter: noWait,
    robotsGroups: allowAll,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.infoboxCount, 1);
  assert.equal(result.fields.Price, "75");
});

test("scrapeItemStats: picks the titled base infobox out of several, not the first", async () => {
  // The skin comes first on the page. Before #184 this returned the skin's stats as the weapon's.
  const page =
    `<html><script>RLCONF={"wgPageName":"Weapons/Ranger_73","wgCurRevisionId":15379};</script><body>` +
    `<div class="druid-infobox druid-container"><div><div class="druid-title">Fifty Laurels</div></div>` +
    `<div class="druid-data druid-data-Price">999</div></div>` +
    `<div class="druid-infobox druid-container"><div><div class="druid-title">Ranger 73</div></div>` +
    `${PRICE_ROW}</div></body></html>`;
  const result = await scrapeItemStats(target, {
    fetchFn: fakeFetch(page),
    rateLimiter: noWait,
    robotsGroups: allowAll,
  });
  assert.equal(result.infoboxCount, 2);
  assert.equal(result.selection.index, 1);
  assert.equal(result.selection.title, "Ranger 73");
  assert.equal(result.fields.Price, "75", "the skin's 999 must not be read as the weapon's price");
});

test("scrapeItemStats: a page with no infobox is InfoboxNotFoundError, not a missing page", async () => {
  await assert.rejects(
    scrapeItemStats(target, {
      fetchFn: fakeFetch("<html><body>disambiguation</body></html>"),
      rateLimiter: noWait,
      robotsGroups: allowAll,
    }),
    InfoboxNotFoundError
  );
});

test("scrapeItemStats: a 404 is ItemPageNotFoundError", async () => {
  await assert.rejects(
    scrapeItemStats(target, {
      fetchFn: fakeFetch(null, { onPage: () => errResponse(404) }),
      rateLimiter: noWait,
      robotsGroups: allowAll,
    }),
    ItemPageNotFoundError
  );
});

test("scrapeItemStats: a body-read failure is a NetworkFailureError carrying the url", async () => {
  // fetch() resolves on headers; the body streams afterward, so a mid-response reset rejects at
  // res.text() rather than at the fetch. Unwrapped it would surface as a bare TypeError with no
  // url, collapsing a transport failure into an unclassified one.
  const err = await scrapeItemStats(target, {
    fetchFn: fakeFetch(null, {
      onPage: () => ({
        ok: true,
        status: 200,
        text: async () => {
          throw new TypeError("terminated");
        },
      }),
    }),
    rateLimiter: noWait,
    robotsGroups: allowAll,
  }).then(
    () => assert.fail("expected the body read to reject"),
    (e) => e
  );

  assert.ok(err instanceof NetworkFailureError);
  assert.equal(err.item, "Ranger 73");
  assert.match(err.url, /Weapons\/Ranger_73$/);
  assert.match(err.message, /terminated/);
  assert.equal(err.cause.name, "TypeError");
});

test("runStatsScrape: a body-read failure records the url, not an unclassified error", async () => {
  const summary = await runStatsScrape(
    { categories: ["traits"], delayMs: 0, limit: 1 },
    {
      fetchFn: fakeFetch(null, {
        onPage: () => ({
          ok: true,
          status: 200,
          text: async () => {
            throw new TypeError("terminated");
          },
        }),
      }),
      log: () => {},
    }
  );

  const failure = summary.failed[0];
  assert.equal(failure.errorType, "NetworkFailureError");
  assert.ok(failure.url, "failure records the URL");
  assert.ok(failure.item && failure.reason);
});

test("scrapeItemStats: a known duplicate is skipped without spending a request", async () => {
  let fetched = 0;
  const result = await scrapeItemStats(
    { category: "weapons", id: "winfield-m1873c", name: "Winfield M1873C", wikiPath: null },
    {
      fetchFn: async () => {
        fetched += 1;
        return okResponse("");
      },
      rateLimiter: noWait,
      robotsGroups: allowAll,
    }
  );
  assert.equal(result.status, "skipped");
  assert.equal(fetched, 0);
  assert.match(result.reason, /no wiki page/);
  // The reason used to quote KNOWN_CATALOG_DUPLICATES' explanation, which named the Frontier 73C. That
  // table is empty since #243 retired its last entry, so an unmapped item gets the generic reason —
  // still explained, still not a silent skip, which is the property this asserts.
  assert.match(result.reason, /no wiki page mapped for this catalog entry/);
});

test("scrapeItemStats: a robots-disallowed path throws before fetching", async () => {
  let fetched = 0;
  await assert.rejects(
    scrapeItemStats(target, {
      fetchFn: async () => {
        fetched += 1;
        return okResponse(ONE_INFOBOX_PAGE);
      },
      rateLimiter: noWait,
      robotsGroups: [{ userAgents: ["*"], rules: [{ type: "disallow", path: "/wiki/" }] }],
    }),
    RobotsDisallowedError
  );
  assert.equal(fetched, 0);
});

test("scrapeItemStats: --dry-run resolves the URL but fetches nothing", async () => {
  let fetched = 0;
  const result = await scrapeItemStats(target, {
    fetchFn: async () => {
      fetched += 1;
      return okResponse(ONE_INFOBOX_PAGE);
    },
    rateLimiter: noWait,
    robotsGroups: allowAll,
    dryRun: true,
  });
  assert.equal(result.status, "skipped");
  assert.equal(fetched, 0);
  assert.match(result.reason, /dry-run: would fetch/);
});

// ---------------------------------------------------------------------------
// runStatsScrape
// ---------------------------------------------------------------------------

test("runStatsScrape: one item's failure does not abort the run", async () => {
  let call = 0;
  const fetchFn = async (url) => {
    if (url.endsWith("/robots.txt")) return { ok: true, status: 200, text: async () => "User-agent: *\nDisallow:\n" };
    call += 1;
    return call === 1 ? errResponse(500) : okResponse(pageForUrl(url));
  };

  const summary = await runStatsScrape(
    { categories: ["traits"], delayMs: 0, limit: 3 },
    { fetchFn, log: () => {} }
  );

  assert.equal(summary.failed.length, 1);
  assert.equal(summary.succeeded.length, 2);
});

test("runStatsScrape: every failure records item, url, reason, and error type", async () => {
  const lines = [];
  const summary = await runStatsScrape(
    { categories: ["traits"], delayMs: 0, limit: 1 },
    { fetchFn: fakeFetch(null, { onPage: () => errResponse(404) }), log: (e) => lines.push(e) }
  );

  const failure = summary.failed[0];
  assert.ok(failure.item, "failure records the item name");
  assert.ok(failure.url, "failure records the URL");
  assert.ok(failure.reason, "failure records a reason");
  assert.equal(failure.errorType, "ItemPageNotFoundError");

  const logged = lines.find((l) => l.event === "item-failed");
  assert.ok(logged, "the failure is logged, not silently swallowed");
  assert.equal(logged.errorType, "ItemPageNotFoundError");
  assert.ok(logged.url && logged.reason && logged.item);
});

test("runStatsScrape: emits a structured per-run summary", async () => {
  const lines = [];
  await runStatsScrape(
    { categories: ["traits"], delayMs: 0, limit: 2 },
    { fetchFn: fakeFetch(), log: (e) => lines.push(e) }
  );
  const runSummary = lines.find((l) => l.event === "run-summary");
  assert.ok(runSummary);
  assert.equal(runSummary.succeeded, 2);
  assert.equal(runSummary.failed, 0);
});

test("runStatsScrape: an unreadable robots.txt is fatal for the whole run", async () => {
  const fetchFn = async (url) => {
    if (url.endsWith("/robots.txt")) return { ok: false, status: 500, text: async () => "" };
    throw new Error("should never reach a page fetch");
  };
  await assert.rejects(
    runStatsScrape({ categories: ["traits"], delayMs: 0, limit: 1 }, { fetchFn, log: () => {} }),
    NetworkFailureError
  );
});

test("runStatsScrape: --limit bounds the number of items visited", async () => {
  let pages = 0;
  const fetchFn = fakeFetch(null, {
    onPage: () => {
      pages += 1;
      return okResponse(ONE_INFOBOX_PAGE);
    },
  });
  await runStatsScrape({ categories: ["traits"], delayMs: 0, limit: 2 }, { fetchFn, log: () => {} });
  assert.equal(pages, 2);
});

test("formatSummary: names the failing item, its error type, and the reason", () => {
  const summary = createSummary();
  summary.failed.push({
    category: "weapons",
    id: "ranger-73",
    item: "Ranger 73",
    errorType: "ItemPageNotFoundError",
    reason: "HTTP 404",
  });
  const out = formatSummary(summary);
  assert.match(out, /Ranger 73/);
  assert.match(out, /ItemPageNotFoundError/);
  assert.match(out, /HTTP 404/);
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test("parseArgs: reads the documented flags", () => {
  const o = parseArgs(["--only=weapons,traits", "--delay-ms=0", "--limit=5", "--dry-run"]);
  assert.deepEqual(o.categories, ["weapons", "traits"]);
  assert.equal(o.delayMs, 0);
  assert.equal(o.limit, 5);
  assert.equal(o.dryRun, true);
});

test("parseArgs: a nonsense delay or limit is ignored rather than applied", () => {
  const o = parseArgs(["--delay-ms=abc", "--limit=-3"]);
  assert.equal(o.delayMs, 1500);
  assert.equal(o.limit, null);
});

// ---------------------------------------------------------------------------
// Structural guarantees this story promises
// ---------------------------------------------------------------------------

// This guard has narrowed twice rather than disappearing, which is the point of keeping it.
// #183: the module imported no filesystem API at all. #184: the dataset became its only write
// target. #185 adds catalog.js as a second — so the guard now pins the write set to exactly two
// paths, and a third one appearing has to be a deliberate edit to this assertion.
test("the module writes exactly two paths: the dataset, and the catalog under its flag", async () => {
  const src = await readFile(path.join(__dirname, "scrape-stats.mjs"), "utf8");
  const writeTargets = [...new Set([...src.matchAll(/fsWriteFile\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
  assert.deepEqual(writeTargets.sort(), ["catalogPath", "datasetPath"]);
});

test("a full run writes catalog.js not at all — verified against the committed tree", async () => {
  // The generated dataset is committed, so this asserts a property of the artifact rather than of
  // the code: itemStats.json exists, is marked generated, and catalog.js carries none of its data.
  const stats = JSON.parse(await readFile(path.join(__dirname, "..", "client", "src", "data", "itemStats.json"), "utf8"));
  assert.ok(stats._generated, "the dataset carries the generated marker SPEC-0007 requires");
  assert.match(stats._generated.warning, /do not hand-edit/i);

  const catalogSrc = await readFile(path.join(__dirname, "..", "client", "src", "data", "catalog.js"), "utf8");
  assert.equal(
    /sourceRevision|ingestedAt|_generated/.test(catalogSrc),
    false,
    "catalog.js stays hand-authored — generated stat data must not be interleaved into it"
  );
});

test("exactly one slug derivation exists under scripts/ (ADR-0005 confirmation criterion)", async () => {
  const entries = await readdir(__dirname, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".mjs")).map((e) => e.name);
  const defs = [];
  for (const name of [...files, path.join("lib", "wiki.mjs")]) {
    // eslint-disable-next-line no-await-in-loop
    const src = await readFile(path.join(__dirname, name), "utf8");
    if (/(?:export\s+)?function\s+slugify\s*\(/.test(src)) defs.push(name);
  }
  // The canonical definition lives in client/src/utils/slugify.js; scripts/ only re-exports it.
  assert.deepEqual(defs, [], `slugify() is defined under scripts/ in: ${defs.join(", ")}`);
});

test("the scrape is not wired into any npm script", async () => {
  const pkg = JSON.parse(await readFile(path.join(__dirname, "..", "package.json"), "utf8"));
  const scripts = Object.entries(pkg.scripts ?? {});
  const wired = scripts.filter(([, cmd]) => cmd.includes("scrape-stats") && !cmd.includes("test"));
  assert.deepEqual(wired, [], "scrape-stats.mjs must be human-invoked, never run by a build task");
});

test("the running app issues no request to the wiki", async () => {
  const clientSrc = path.join(__dirname, "..", "client", "src");
  const offenders = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(js|jsx)$/.test(entry.name)) {
        const src = await readFile(full, "utf8");
        for (const line of src.split("\n")) {
          if (!line.includes("huntshowdown.wiki.gg")) continue;
          // Attribution text and comments are expected; a fetch or an <img src> is not.
          if (/\b(fetch|axios|XMLHttpRequest)\b/.test(line) || /<img[^>]+src=/.test(line)) {
            offenders.push(`${path.relative(clientSrc, full)}: ${line.trim()}`);
          }
        }
      }
    }
  }
  await walk(clientSrc);
  assert.deepEqual(offenders, [], `client code must not reach the wiki at runtime:\n${offenders.join("\n")}`);
});

// ---------------------------------------------------------------------------
// #184 — variant selection, provenance, and the generated dataset
// ---------------------------------------------------------------------------

const titled = (title, rows = "") =>
  `<div class="druid-infobox druid-container"><div><div class="druid-title">${title}</div></div>${rows}</div>`;

const rlconf = (page, rev) =>
  `<script>RLCONF={"wgPageName":"${page}","wgCurRevisionId":${rev},"wgRevisionId":${rev}};</script>`;

test("canonicalTitleFromPageName: drops the category namespace and flattens the rest", () => {
  assert.equal(canonicalTitleFromPageName("Weapons/Nagant_M1895"), "Nagant M1895");
  assert.equal(canonicalTitleFromPageName("Weapons/Ranger_73"), "Ranger 73");
  assert.equal(canonicalTitleFromPageName("Tools/Alert_Trip_Mines"), "Alert Trip Mines");
});

test("canonicalTitleFromPageName: a variant subpage keeps both segments", () => {
  // Taking only the last segment would yield "Pistol" and match no infobox title.
  assert.equal(canonicalTitleFromPageName("Weapons/Sparks/Pistol"), "Sparks Pistol");
});

test("canonicalTitleFromPageName: empty input is null, not an empty string", () => {
  assert.equal(canonicalTitleFromPageName(""), null);
  assert.equal(canonicalTitleFromPageName(null), null);
});

test("extractInfoboxTitle: reads the infobox heading", () => {
  assert.equal(extractInfoboxTitle(titled("Nagant M1895")), "Nagant M1895");
  assert.equal(extractInfoboxTitle(infobox(PRICE_ROW)), null);
});

test("selectBaseInfobox: matches the canonical page title, not position", () => {
  // The base weapon is deliberately NOT first here — position would pick the skin.
  const boxes = [titled("Copperhead"), titled("Nagant M1895"), titled("Steelroot")];
  const sel = selectBaseInfobox(boxes, { canonicalTitle: "Nagant M1895", displayName: "Nagant M1895" });
  assert.equal(sel.index, 1);
  assert.equal(sel.method, "canonical-title");
});

test("selectBaseInfobox: falls back to the catalog display name", () => {
  const boxes = [titled("Skin"), titled("Hive Bomb")];
  const sel = selectBaseInfobox(boxes, { canonicalTitle: null, displayName: "Hive Bomb" });
  assert.equal(sel.index, 1);
  assert.equal(sel.method, "display-name");
});

test("selectBaseInfobox: the canonical title wins where the catalog name is stale", () => {
  // winfield-m1873 is named "Winfield M1873" in the catalog and "Ranger 73" on the wiki. Matching
  // the catalog name would fail on exactly the items the scrape exists to correct.
  const boxes = [titled("Fifty Laurels"), titled("Ranger 73")];
  const sel = selectBaseInfobox(boxes, { canonicalTitle: "Ranger 73", displayName: "Winfield M1873" });
  assert.equal(sel.index, 1);
  assert.equal(sel.method, "canonical-title");
});

test("selectBaseInfobox: no match is 'unresolved', never a silent index 0", () => {
  const sel = selectBaseInfobox([titled("Skin A"), titled("Skin B")], {
    canonicalTitle: "Something Else",
    displayName: "Also Not This",
  });
  assert.equal(sel.index, -1);
  assert.equal(sel.method, "unresolved");
  assert.deepEqual(sel.titles, ["Skin A", "Skin B"]);
});

test("selectBaseInfobox: title comparison ignores case and punctuation", () => {
  const sel = selectBaseInfobox([titled("Bornheim No. 3")], { canonicalTitle: "bornheim no 3" });
  assert.equal(sel.index, 0);
});

test("scrapeItemStats: records the revision and the canonical title as provenance", async () => {
  const page = `<html>${rlconf("Weapons/Nagant_M1895", 16192)}<body>${titled("Nagant M1895", PRICE_ROW)}</body></html>`;
  const result = await scrapeItemStats(
    { category: "weapons", id: "nagant-m1895", name: "Nagant M1895", wikiPath: "Weapons/Nagant_M1895" },
    { fetchFn: fakeFetch(page), rateLimiter: noWait, robotsGroups: allowAll }
  );
  assert.equal(result.revision, "16192");
  assert.equal(result.canonicalTitle, "Nagant M1895");
  assert.equal(result.selection.method, "canonical-title");
  assert.equal(result.fields.Price, "75");
});

test("scrapeItemStats: an unmatchable page fails rather than writing a skin's stats", async () => {
  const page = `<html>${rlconf("Weapons/Mystery", 1)}<body>${titled("Some Skin", PRICE_ROW)}</body></html>`;
  await assert.rejects(
    scrapeItemStats(
      { category: "weapons", id: "x", name: "Totally Different", wikiPath: "Weapons/Mystery" },
      { fetchFn: fakeFetch(page), rateLimiter: noWait, robotsGroups: allowAll }
    ),
    (err) => err instanceof InfoboxNotFoundError && /matches its title/.test(err.message)
  );
});

test("buildStatsRecord: the id is the key and is never duplicated into the record", () => {
  const record = buildStatsRecord(
    {
      item: "Nagant M1895",
      canonicalTitle: "Nagant M1895",
      url: "https://w/x",
      revision: "16192",
      infoboxCount: 5,
      selection: { index: 0, method: "canonical-title", title: "Nagant M1895" },
      fields: { Price: "24" },
    },
    { now: () => "2026-08-11T00:00:00.000Z" }
  );
  assert.equal("id" in record, false, "the catalog id is the key; a second copy could disagree");
  assert.equal(record.sourceRevision, "16192");
  assert.equal(record.ingestedAt, "2026-08-11T00:00:00.000Z");
  assert.equal(record.selectedBy, "canonical-title");
});

test("writeStatsFile: sorts keys and stamps the generated marker", async () => {
  let written = null;
  await writeStatsFile(
    { zeta: { fields: {} }, alpha: { fields: {} } },
    {
      datasetPath: "/tmp/x/itemStats.json",
      fsMkdir: async () => {},
      fsWriteFile: async (_p, body) => {
        written = JSON.parse(body);
      },
    }
  );
  assert.deepEqual(Object.keys(written.items), ["alpha", "zeta"]);
  assert.match(written._generated.warning, /do not hand-edit/i);
});

test("runStatsScrape: an unknown category fails loudly instead of visiting zero items", async () => {
  await assert.rejects(
    runStatsScrape({ categories: ["weapon"], delayMs: 0 }, { fetchFn: fakeFetch(ONE_INFOBOX_PAGE), log: () => {} }),
    (err) => /unknown category: weapon/.test(err.message) && /Valid values/.test(err.message)
  );
});

test("runStatsScrape: a partial run reports but never rewrites the dataset", async () => {
  let wrote = false;
  const page = `<html>${rlconf("Traits/X", 5)}<body>${titled("X", PRICE_ROW)}</body></html>`;
  const summary = await runStatsScrape(
    { categories: ["traits"], delayMs: 0, limit: 2 },
    { fetchFn: fakeFetch(page), log: () => {}, fsWriteFile: async () => { wrote = true; }, fsMkdir: async () => {} }
  );
  assert.equal(wrote, false, "a --limit run must not truncate the dataset to what it visited");
  assert.equal(summary.datasetPath, null);
});

test("runStatsScrape: --dry-run writes nothing", async () => {
  let wrote = false;
  await runStatsScrape(
    { categories: CATEGORIES, delayMs: 0, dryRun: true },
    { fetchFn: fakeFetch(ONE_INFOBOX_PAGE), log: () => {}, fsWriteFile: async () => { wrote = true; }, fsMkdir: async () => {} }
  );
  assert.equal(wrote, false);
});

// ---------------------------------------------------------------------------
// The committed dataset itself
// ---------------------------------------------------------------------------

test("every key in itemStats.json resolves to a live catalog id", async () => {
  const { WEAPONS, TOOLS, TRAITS, CONS } = await import("../client/src/data/catalog.js");
  const known = new Set([...WEAPONS, ...TOOLS, ...TRAITS, ...CONS].map((row) => row[0]));
  const stats = JSON.parse(await readFile(path.join(__dirname, "..", "client", "src", "data", "itemStats.json"), "utf8"));
  const orphans = Object.keys(stats.items).filter((id) => !known.has(id));
  assert.deepEqual(orphans, [], `itemStats.json keys must name real catalog items; orphans: ${orphans}`);
});

test("every record in itemStats.json carries provenance", async () => {
  const stats = JSON.parse(await readFile(path.join(__dirname, "..", "client", "src", "data", "itemStats.json"), "utf8"));
  const entries = Object.entries(stats.items);
  assert.ok(entries.length > 0);
  const missing = entries.filter(([, r]) => !r.sourceRevision || !r.ingestedAt).map(([id]) => id);
  assert.deepEqual(missing, [], `every record needs sourceRevision and ingestedAt; missing on: ${missing}`);
});

test("no record was selected by falling back to position", async () => {
  const stats = JSON.parse(await readFile(path.join(__dirname, "..", "client", "src", "data", "itemStats.json"), "utf8"));
  const methods = new Set(Object.values(stats.items).map((r) => r.selectedBy));
  assert.equal(methods.has("unresolved"), false, "an unresolved selection must fail its item, not be written");
});

// ---------------------------------------------------------------------------
// A renamed page keeps its id (SPEC-0007 REQ "Provenance Is Recorded and Ids Are Never
// Wiki-Derived", scenario "A renamed page does not re-key an item")
// ---------------------------------------------------------------------------

test("a renamed page keeps the catalog id and gains the new display name", async () => {
  // winfield-m1873 is "Winfield M1873" in the catalog and "Ranger 73" on the wiki — the exact
  // rename the audit found. The id is the wire format for saved loadouts and share URLs, so what
  // matters is that the wiki's new name reaches `name` and reaches NOTHING else.
  const page = `<html>${rlconf("Weapons/Ranger_73", 15379)}<body>${titled("Ranger 73", PRICE_ROW)}</body></html>`;
  const result = await scrapeItemStats(
    { category: "weapons", id: "winfield-m1873", name: "Winfield M1873", wikiPath: "Weapons/Ranger_73" },
    { fetchFn: fakeFetch(page), rateLimiter: noWait, robotsGroups: allowAll }
  );

  assert.equal(result.id, "winfield-m1873", "the scrape must not re-slug an existing id");
  assert.equal(result.canonicalTitle, "Ranger 73");

  const record = buildStatsRecord(result, { now: () => "2026-08-11T00:00:00.000Z" });
  assert.equal(record.name, "Ranger 73", "the new display name is recorded");
  assert.equal("id" in record, false);
  assert.equal(
    JSON.stringify(record).includes("winfield"),
    false,
    "nothing in the record is derived from the id, and nothing in it can re-key the item"
  );
});

test("a rename reaches the dataset key as the catalog id, never the wiki title", async () => {
  // End-to-end over the real catalog: every page answers with a title that is NOT the catalog's,
  // so every record is a rename. The keys must still be catalog ids.
  const { WEAPONS } = await import("../client/src/data/catalog.js");
  const catalogIds = new Set(WEAPONS.map((row) => row[0]));

  const renamedPage = (url) => {
    const pageName = decodeURIComponent(new URL(url).pathname.replace(/^\/wiki\//, ""));
    const namespace = pageName.split("/")[0];
    return (
      `<html>${rlconf(`${namespace}/Renamed_On_The_Wiki`, 42)}<body>` +
      `${titled("Renamed On The Wiki", PRICE_ROW)}</body></html>`
    );
  };

  const summary = await runStatsScrape(
    { categories: ["weapons"], delayMs: 0, limit: 3 },
    { fetchFn: fakeFetch(null, { onPage: (url) => okResponse(renamedPage(url)) }), log: () => {} }
  );

  const keys = Object.keys(summary.records);
  assert.ok(keys.length > 0, "the fixture should resolve by canonical title");
  for (const key of keys) {
    assert.ok(catalogIds.has(key), `${key} must be a catalog id, not a wiki-derived slug`);
    assert.equal(summary.records[key].name, "Renamed On The Wiki");
  }
});

// ---------------------------------------------------------------------------
// The dataset is never truncated silently
// ---------------------------------------------------------------------------

test("isPartialRun: a repeated --only value does not pad a partial run into a full one", () => {
  assert.equal(isPartialRun({ categories: CATEGORIES, limit: null }), false);
  assert.equal(isPartialRun({ categories: ["weapons", "tools", "traits"], limit: null }), true);
  assert.equal(isPartialRun({ categories: CATEGORIES, limit: 5 }), true);
  // Four entries, three distinct categories: a length comparison called this a full run.
  assert.equal(isPartialRun({ categories: ["weapons", "weapons", "tools", "traits"], limit: null }), true);
});

test("a duplicated category never rewrites the dataset", async () => {
  // The bug this replaces: --only=weapons,weapons,tools,traits passed the unknown-category check,
  // measured 4 long, and rewrote itemStats.json with every consumable deleted and no warning.
  let wrote = false;
  const summary = await runStatsScrape(
    { categories: ["weapons", "weapons", "tools", "traits"], delayMs: 0, limit: 2 },
    { fetchFn: fakeFetch(), log: () => {}, fsWriteFile: async () => { wrote = true; }, fsMkdir: async () => {} }
  );
  assert.equal(wrote, false);
  assert.equal(summary.datasetPath, null);
});

test("a run that would drop already-covered items writes nothing and names them", async () => {
  // ADR-0005's worst realistic failure is a wiki markup change the parser stops matching. Its first
  // symptom is a run that succeeds for a few items and fails the rest — and the write replaces the
  // file wholesale, so the survivors would be the whole dataset.
  let wrote = false;
  const covered = { items: { "already-covered-a": {}, "already-covered-b": {} } };
  const summary = await runStatsScrape(
    { categories: CATEGORIES, delayMs: 0 },
    {
      fetchFn: fakeFetch(),
      log: () => {},
      fsReadFile: async () => JSON.stringify(covered),
      fsWriteFile: async () => { wrote = true; },
      fsMkdir: async () => {},
    }
  );

  assert.equal(wrote, false, "coverage loss must be a decision, not a side effect");
  assert.equal(summary.datasetPath, null);
  assert.deepEqual(summary.droppedIds, ["already-covered-a", "already-covered-b"]);
  assert.match(formatSummary(summary), /DATASET NOT WRITTEN/);
  assert.match(formatSummary(summary), /--allow-shrink/);
});

test("--allow-shrink lets a genuine removal through", async () => {
  let wrote = null;
  const covered = { items: { "retired-item": {} } };
  const summary = await runStatsScrape(
    { categories: CATEGORIES, delayMs: 0, allowShrink: true },
    {
      fetchFn: fakeFetch(),
      log: () => {},
      fsReadFile: async () => JSON.stringify(covered),
      fsWriteFile: async (_p, body) => { wrote = JSON.parse(body); },
      fsMkdir: async () => {},
    }
  );

  assert.ok(wrote, "the flag is the operator saying the loss is intended");
  assert.equal("retired-item" in wrote.items, false);
  assert.deepEqual(summary.droppedIds, []);
});

test("a first run with no dataset on disk is not treated as a shrink", async () => {
  let wrote = false;
  await runStatsScrape(
    { categories: CATEGORIES, delayMs: 0 },
    {
      fetchFn: fakeFetch(),
      log: () => {},
      fsReadFile: async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); },
      fsWriteFile: async () => { wrote = true; },
      fsMkdir: async () => {},
    }
  );
  assert.equal(wrote, true, "nothing is covered yet, so nothing can be dropped");
});

test("parseArgs: --allow-shrink is off unless asked for", () => {
  assert.equal(parseArgs([]).allowShrink, false);
  assert.equal(parseArgs(["--allow-shrink"]).allowShrink, true);
});

test("parseArgs: --discover is off unless asked for, and composes with --dry-run", () => {
  // The discovery tests all call runDiscovery directly with an explicit options object, so the
  // flag-to-behaviour wiring was untested end to end — including the --dry-run interaction, which
  // is exactly the gap that let --discover fetch ~160 pages under a flag that promises none.
  assert.equal(parseArgs([]).discover, false);
  assert.equal(parseArgs(["--discover"]).discover, true);
  const both = parseArgs(["--discover", "--dry-run"]);
  assert.equal(both.discover, true);
  assert.equal(both.dryRun, true);
});

// ---------------------------------------------------------------------------
// #185 — catalog write-through: bounded, reviewable, opt-in
// ---------------------------------------------------------------------------

test("parseNumeric: accepts whole numbers, including comma-grouped", () => {
  assert.equal(parseNumeric("75"), 75);
  assert.equal(parseNumeric(" 1,015 "), 1015);
});

test("parseNumeric: refuses anything that is not a whole number", () => {
  // The lenient alternative — strip non-digits and take what is left — is exactly how
  // "wrong but well-formed" gets written: "1.5" would become 15 and land silently.
  assert.equal(parseNumeric("1.5"), null);
  assert.equal(parseNumeric("75 Hunt Dollars"), null);
  assert.equal(parseNumeric("~80"), null);
  assert.equal(parseNumeric(""), null);
  assert.equal(parseNumeric(undefined), null);
});

test("rangeViolation: accepts the ranges the game actually uses", () => {
  assert.equal(rangeViolation(1, "size"), null);
  // 17 of 38 weapons are size 4 or 5. ADR-0005 and SPEC-0007 as first written said 1..3, which
  // would have failed 45% of the arsenal on a correct parse.
  assert.equal(rangeViolation(4, "size"), null);
  assert.equal(rangeViolation(5, "size"), null);
  assert.equal(rangeViolation(9, "up"), null);
  assert.equal(rangeViolation(1015, "cost"), null);
});

test("rangeViolation: rejects implausible values with a reason naming the range", () => {
  assert.match(rangeViolation(7, "size"), /outside the plausible size range 1\.\.5/);
  assert.match(rangeViolation(0, "cost"), /outside the plausible cost range/);
});

test("planCatalogWrites: plans only the fields that actually differ", () => {
  const rows = { weapons: [["w1", "W One", 2, 30, "compact", "Pistols"]] };
  const records = { w1: { fields: { Price: "24", Size: "2" }, wikiUrl: "https://w/1" } };
  const { changes, rejected } = planCatalogWrites(records, rows);
  assert.equal(rejected.length, 0);
  assert.deepEqual(
    changes.map((c) => [c.label, c.from, c.to]),
    [["cost", 30, 24]] // Size matched, so it is not a change
  );
});

test("planCatalogWrites: an out-of-range value is refused, and the rest of the item still lands", () => {
  const rows = { weapons: [["w1", "W One", 2, 30, "compact", "Pistols"]] };
  const records = { w1: { fields: { Price: "24", Size: "9" }, wikiUrl: "https://w/1" } };
  const { changes, rejected } = planCatalogWrites(records, rows);
  assert.deepEqual(changes.map((c) => c.label), ["cost"], "the good field still lands");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].label, "size");
  assert.equal(rejected[0].url, "https://w/1", "the refusal carries the source URL");
  assert.match(rejected[0].reason, /outside the plausible size range/);
});

test("planCatalogWrites: traits map from Cost, not Price", () => {
  // The wiki labels Upgrade Points "Cost". Mapping traits to "Price" would silently plan nothing
  // for all 32 of them, which reads as "the trait table is already correct".
  const rows = { traits: [["t1", "T One", 4, "Combat"]] };
  const { changes } = planCatalogWrites({ t1: { fields: { Cost: "6" }, wikiUrl: "u" } }, rows);
  assert.deepEqual(changes.map((c) => [c.label, c.from, c.to]), [["up", 4, 6]]);
});

test("planCatalogWrites: never plans a write for group, type, ammoClass, or name", () => {
  const rows = { weapons: [["w1", "W One", 2, 30, "compact", "Pistols"]], consumables: [["c1", "C One", 50, "Shot", "Shots"]] };
  const records = {
    w1: { fields: { Price: "24", AmmoType: "medium", Description: "renamed thing" }, wikiUrl: "u" },
    // Traits carry a literal `Category` field — the exact trap, since it looks like `group`.
    c1: { fields: { Price: "50", Category: "Healing", Type: "Placeable" }, wikiUrl: "u" },
  };
  const { changes } = planCatalogWrites(records, rows);
  const touched = new Set(changes.map((c) => c.label));
  assert.deepEqual([...touched], ["cost"]);
  for (const forbidden of ["group", "type", "ammoClass", "name"]) {
    assert.equal(touched.has(forbidden), false, `${forbidden} must never be planned`);
  }
});

test("replaceTupleField: replaces one field and leaves the rest of the line byte-identical", () => {
  const line = '  ["nagant-m1895", "Nagant M1895", 1, 30, "compact", "Pistols"],';
  assert.equal(
    replaceTupleField(line, 3, 24),
    '  ["nagant-m1895", "Nagant M1895", 1, 24, "compact", "Pistols"],'
  );
});

test("replaceTupleField: a comma inside a quoted value does not split the tuple", () => {
  const line = '  ["x", "Crown, King & Co", 2, 30, "compact", "Shotguns"],';
  assert.equal(
    replaceTupleField(line, 3, 44),
    '  ["x", "Crown, King & Co", 2, 44, "compact", "Shotguns"],'
  );
});

test("replaceTupleField: refuses rather than mangling when the index is out of range", () => {
  assert.equal(replaceTupleField('  ["x", "X", 1],', 9, 5), null);
  assert.equal(replaceTupleField("  not a tuple at all", 1, 5), null);
});

test("applyCatalogWrites: locates rows by id and reports any it cannot find", () => {
  const source = [
    "// a comment that must survive",
    "export const WEAPONS = [",
    '  ["a", "A", 1, 10, "compact", "Pistols"],',
    '  ["b", "B", 2, 20, "medium", "Rifles"],',
    "];",
  ].join("\n");
  const { source: next, applied, unlocated } = applyCatalogWrites(source, [
    { id: "b", index: 3, to: 25, label: "cost", category: "weapons" },
    { id: "ghost", index: 3, to: 1, label: "cost", category: "weapons" },
  ]);
  assert.match(next, /\/\/ a comment that must survive/, "comments survive a surgical edit");
  assert.match(next, /\["b", "B", 2, 25, "medium", "Rifles"\]/);
  assert.match(next, /\["a", "A", 1, 10, "compact", "Pistols"\]/, "untouched rows are unchanged");
  assert.equal(applied.length, 1);
  assert.deepEqual(unlocated.map((u) => u.id), ["ghost"]);
});

test("formatCatalogPlan: prints old -> new per field, and the refusals with their reasons", () => {
  const out = formatCatalogPlan({
    changes: [{ category: "weapons", id: "nagant-m1895", label: "cost", from: 30, to: 24, url: "https://w/n" }],
    rejected: [{ category: "weapons", id: "x", label: "size", raw: "9", reason: "outside range", url: "https://w/x" }],
  });
  assert.match(out, /nagant-m1895\s+cost: 30 -> 24/);
  assert.match(out, /https:\/\/w\/n/);
  assert.match(out, /refused/);
  assert.match(out, /size: "9" — outside range/);
});

test("a default run never touches catalog.js", async () => {
  const writes = [];
  await runStatsScrape(
    { categories: CATEGORIES, delayMs: 0 },
    {
      fetchFn: fakeFetch(),
      log: () => {},
      fsMkdir: async () => {},
      fsReadFile: async () => JSON.stringify({ items: {} }),
      fsWriteFile: async (p) => writes.push(p),
    }
  );
  assert.equal(
    writes.some((p) => String(p).endsWith("catalog.js")),
    false,
    "without --write-catalog the catalog is not a write target"
  );
});

test("a --write-catalog run prints every change before it applies any of them", async () => {
  const events = [];
  const order = [];
  await runStatsScrape(
    { categories: CATEGORIES, delayMs: 0, writeCatalog: true },
    {
      fetchFn: fakeFetch(),
      log: (e) => events.push(e),
      fsMkdir: async () => {},
      fsReadFile: async (p) =>
        String(p).endsWith("catalog.js") ? (order.push("read-catalog"), "// empty") : JSON.stringify({ items: {} }),
      fsWriteFile: async (p) => {
        if (String(p).endsWith("catalog.js")) order.push("write-catalog");
      },
      printPlan: () => order.push("print-plan"),
    }
  );
  const firstChangeLog = events.findIndex((e) => e.event === "catalog-change");
  assert.ok(firstChangeLog !== -1, "every intended overwrite is logged");
  // The READABLE plan is printed before the file is even read, let alone written. Asserting only
  // ["read-catalog", "write-catalog"] let the table be printed after the rewrite while the banner
  // claimed otherwise — the machine-readable events were "before", the operator's view was not.
  assert.deepEqual(order, ["print-plan", "read-catalog", "write-catalog"]);
  const planEvent = events.find((e) => e.event === "catalog-plan");
  assert.ok(planEvent && planEvent.changes > 0);
});

test("a run that trips the shrink guard refuses the write-through even when asked", async () => {
  // The shrink guard's signal — a wiki markup change the parser no longer matches — is a reason to
  // distrust the parses that DID survive, and those are the ones that write to catalog.js. Gating
  // only the regenerable dataset on it left the budget math unprotected. (Review of #194.)
  const writes = [];
  const summary = await runStatsScrape(
    { categories: CATEGORIES, delayMs: 0, writeCatalog: true },
    {
      fetchFn: fakeFetch(),
      log: () => {},
      fsMkdir: async () => {},
      // The committed dataset covers an id this run did not resolve, so the run would shrink it.
      fsReadFile: async (p) =>
        String(p).endsWith("catalog.js")
          ? "// catalog"
          : JSON.stringify({ items: { "long-covered-id": { fields: {} } } }),
      fsWriteFile: async (p) => writes.push(String(p)),
    }
  );

  assert.equal(writes.some((p) => p.endsWith("catalog.js")), false, "catalog.js is not rewritten");
  assert.equal(writes.some((p) => p.endsWith("itemStats.json")), false, "nor is the dataset");
  assert.equal(summary.catalogPlan, null, "no plan is computed for a run whose parses are suspect");
  assert.match(summary.catalogSkipped, /shrink guard/, "and the refusal is reported, not silent");
});

test("a partial run refuses the write-through even when asked", async () => {
  const writes = [];
  const summary = await runStatsScrape(
    { categories: ["weapons"], delayMs: 0, writeCatalog: true },
    {
      fetchFn: fakeFetch(),
      log: () => {},
      fsMkdir: async () => {},
      fsReadFile: async () => "// catalog",
      fsWriteFile: async (p) => writes.push(String(p)),
    }
  );
  assert.equal(writes.some((p) => p.endsWith("catalog.js")), false);
  assert.equal(summary.catalogPlan, null, "no plan is even computed for a run that saw one category");
});

test("catalog.js states the wire-format gate beside the AMMO table", async () => {
  // SPEC-0007 requires the gate to live where an editor will see it, not only in the spec.
  const src = await readFile(path.join(__dirname, "..", "client", "src", "data", "catalog.js"), "utf8");
  const gate = src.slice(Math.max(0, src.indexOf("export const AMMO") - 1200), src.indexOf("export const AMMO"));
  assert.match(gate, /FORMAT_VERSION/);
  assert.match(gate, /bare index/i);
  assert.match(gate, /migration/i);
});

test("categoryLineRange: bounds each category's array", () => {
  const lines = [
    "export const WEAPONS = [",
    '  ["a", "A", 1, 10, "compact", "Pistols"],',
    "];",
    "export const TOOLS = [",
    '  ["a", "A tool", 20, "Melee"],',
    "];",
  ];
  assert.deepEqual(categoryLineRange(lines, "weapons"), [1, 2]);
  assert.deepEqual(categoryLineRange(lines, "tools"), [4, 5]);
  assert.equal(categoryLineRange(lines, "nonsense"), null);
});

test("applyCatalogWrites: a colliding id in another category is not written to", () => {
  // catalog.js's header says an id is unique WITHIN its category, so the same string is permitted
  // in two. Index 3 is `cost` in WEAPONS and `group` in TOOLS — an unscoped search would find the
  // tools row first here and write a number into its group slot.
  const source = [
    "export const TOOLS = [",
    '  ["shared-id", "A Tool", 20, "Melee"],',
    "];",
    "export const WEAPONS = [",
    '  ["shared-id", "A Weapon", 1, 10, "compact", "Pistols"],',
    "];",
  ].join("\n");

  const { source: next, applied, unlocated } = applyCatalogWrites(source, [
    { id: "shared-id", category: "weapons", index: 3, to: 99, label: "cost" },
  ]);

  assert.equal(unlocated.length, 0);
  assert.equal(applied.length, 1);
  assert.match(next, /\["shared-id", "A Weapon", 1, 99, "compact", "Pistols"\]/);
  assert.match(next, /\["shared-id", "A Tool", 20, "Melee"\]/, "the tools row keeps its group");
});

test("applyCatalogWrites: a row missing from its own category is unlocated, not found elsewhere", () => {
  const source = ['export const TOOLS = [', '  ["only-a-tool", "T", 20, "Melee"],', "];"].join("\n");
  const { applied, unlocated } = applyCatalogWrites(source, [
    { id: "only-a-tool", category: "weapons", index: 3, to: 5, label: "cost" },
  ]);
  assert.equal(applied.length, 0);
  assert.deepEqual(unlocated.map((u) => u.id), ["only-a-tool"]);
});

test("the readable plan is actually printed, not just exported", async () => {
  // formatCatalogPlan was built and tested but never wired into the run path, so an operator
  // running --write-catalog saw a wall of JSON events instead of the diff table. (Review of #194.)
  // The ordering test above owns "before the write"; this owns "main() supplies a real printer",
  // which no in-process test can see because main() is only reached through the CLI entrypoint.
  const src = await readFile(path.join(__dirname, "scrape-stats.mjs"), "utf8");
  const code = src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
  assert.match(code, /printPlan:\s*\(plan\)\s*=>\s*console\.log\(formatCatalogPlan\(plan\)\)/);
});

test("a --write-catalog run leaves the AMMO table byte-identical", async () => {
  // The one prohibition with no test behind it. Structurally unreachable — categoryLineRange bounds
  // every edit to one of the four category arrays — which is exactly why it is cheap to pin, and
  // why a future change to that bounding should fail here rather than in a released build.
  const ammo = [
    "export const AMMO = {",
    '  compact: [["fmj", "FMJ", 1, 15], ["dumdum", "Dum Dum", 2, 25]],',
    '  special: [["poison", "Poison", 1, 30]],',
    "};",
  ].join("\n");
  const source = [
    "export const WEAPONS = [",
    '  ["nagant", "Nagant M1895", 1, 30, "compact", "Pistols"],',
    "];",
    ammo,
  ].join("\n");

  const { source: next, applied } = applyCatalogWrites(source, [
    { id: "nagant", category: "weapons", index: 3, to: 24, label: "cost" },
  ]);

  assert.equal(applied.length, 1);
  assert.match(next, /\["nagant", "Nagant M1895", 1, 24, "compact", "Pistols"\]/, "the weapon row moved");
  assert.ok(next.includes(ammo), "and the AMMO table is untouched, tuple-shaped rows and all");
});

// ---------------------------------------------------------------------------
// #186 — discovery classification, canonical titles, acquisition class, coverage
// ---------------------------------------------------------------------------

const categoryPage = (pages) =>
  `<html><body><div id="mw-pages">` +
  pages.map((p) => `<a href="/wiki/${p.replace(/ /g, "_")}" title="${p}">${p}</a>`).join("") +
  `</div></body></html>`;

test("parseCategoryMembers: reads member pages and ignores namespace links", () => {
  const html = categoryPage(["Tools/Bear Traps", "Tools/Decoys", "Category:Tools", "File:X.png"]);
  assert.deepEqual(parseCategoryMembers(html), ["Tools/Bear Traps", "Tools/Decoys"]);
});

test("parseCategoryMembers: a page with no member list yields nothing", () => {
  assert.deepEqual(parseCategoryMembers("<html><body>no members here</body></html>"), []);
});

test("classifyPage: removal language makes a page a tombstone, with the sentence as evidence", () => {
  const c = classifyPage("<p>The Iron Repeater was removed from the game in Update 1.15.</p>");
  assert.equal(c.state, "removed");
  assert.match(c.evidence, /removed from the game/);
});

test("classifyPage: prototype language is its own class, not a synonym for removed", () => {
  // Nothing was taken away, so there is no legacy id to preserve — the two states mean
  // different things to whoever acts on the report.
  const c = classifyPage("<p>The Multitool was a prototype piece of equipment.</p>");
  assert.equal(c.state, "never-shipped");
});

test("classifyPage: an ordinary page is live, and says why", () => {
  const c = classifyPage("<p>Bear Traps are a placeable tool that immobilises hunters.</p>");
  assert.equal(c.state, "live");
  assert.equal(c.evidence, null);
});

test("classifyPage: a recorded tombstone is classified without reading the page", () => {
  const c = classifyPage("", { page: "Tools/Electric_Lamp" });
  assert.equal(c.state, "removed");
  assert.match(c.reason, /Update 2\.0/);
  assert.match(c.reason, /LEGACY_TOOL_IDS\[9\]/, "the reason names the carve-out that still exists");
});

test("classifyPage: the never-shipped tombstone keeps its own state", () => {
  assert.equal(classifyPage("", { page: "Tools/Multitool" }).state, "never-shipped");
});

test("classifyPage: a removal the page later reverses is live, not a tombstone", () => {
  // The real Shredder page, near-verbatim from the first live --discover run (2026-08-12), which
  // filed it as removed while it was purchasable in game. Update-history prose is chronological, so
  // the removal is a fact ABOUT THE PAST and the return supersedes it — reading only the first
  // removal sentence buries a live Scarce weapon in `not-an-item`, where nobody looks again.
  const c = classifyPage(
    "<p>radius has been halved Update 2.2.2 Shredder removed from the game " +
      "Post Malone's Murder Circus Encore Event Shredder returns as a Scarce weapon.</p>"
  );
  assert.equal(c.state, "live");
  assert.match(c.reason, /removed and later returned/);
  assert.match(c.evidence, /returns as a Scarce/, "the evidence quotes the return, not the removal");
});

test("classifyPage: a return stated BEFORE the removal does not rescue the page", () => {
  // Ordering is the entire signal. An item that came back and was then cut again is removed, and a
  // return-anywhere check would read the same page as live.
  const c = classifyPage(
    "<p>Update 1.9 The Cannon returns as a Scarce weapon. Update 2.4 The Cannon removed from the game.</p>"
  );
  assert.equal(c.state, "removed");
});

test("classifyPage: a removal AFTER a return wins, even phrased with a different pattern", () => {
  // removed -> returned -> removed again. The earlier version returned on the first matching PATTERN
  // in array order and anchored the return-check there, so the trailing removal — matching a later
  // pattern — was never consulted and the page read as live. Latest-statement-wins is what the
  // chronological argument actually implies. (Review of #230.)
  const c = classifyPage(
    "<p>Update 1.0 The Cannon removed from the game. Update 1.5 The Cannon returns as a Scarce " +
      "weapon. Update 2.0 The Cannon is no longer available.</p>"
  );
  assert.equal(c.state, "removed");
  assert.match(c.evidence, /no longer available/, "and the evidence quotes the statement that decided it");
});

test("classifyPage: a page confirmed live in game overrides its own removal prose", () => {
  const c = classifyPage("<p>Shredder removed from the game.</p>", { page: "Weapons/Shredder" });
  assert.equal(c.state, "live");
  assert.equal(c.evidence, "recorded in KNOWN_LIVE");
  assert.match(c.reason, /Scarce/, "the reason records what it came back as");
});

// The two real page shapes, trimmed. `headline` mirrors MediaWiki's own section markup, which is what
// parseDescription anchors on.
const headline = (id, text) => `<h2><span class="mw-headline" id="${id}">${text}</span></h2>`;
const TRAIT_PAGE_SHAPE = (prose) =>
  `<html><body><div class="mw-parser-output">${infobox(PRICE_ROW)}${prose}` +
  `${headline("Update_History", "Update History")}<p>Update 1.0 added it.</p></div></body></html>`;
const DESCRIBED_PAGE_SHAPE = (lead, described) =>
  `<html><body><div class="mw-parser-output">${infobox(PRICE_ROW)}${lead}` +
  `<h2 id="mw-toc-heading">Contents</h2>` +
  `${headline("Description", "Description")}<p>${described}</p>` +
  `${headline("Trivia", "Trivia")}<p>Named after a real rifle.</p></div></body></html>`;

test("parseDescription: a trait's description is the lead prose above its first section", () => {
  // Traits have no Description section — their headings are Information, Gallery, Update History — so
  // the lead prose is the description. (#228)
  const html = TRAIT_PAGE_SHAPE("<p>Your Hunter won't lose a Health Chunk when downed.</p>");
  assert.equal(parseDescription(html), "Your Hunter won't lose a Health Chunk when downed.");
});

test("parseDescription: prose under a Description section wins over the lead", () => {
  // Weapons, tools and consumables carry an explicit Description section. Preferring it means the page
  // decides which prose is the description, rather than us inferring it from position.
  const html = DESCRIBED_PAGE_SHAPE(
    "<p><i>See also: Frontier 73C, Infantry 73L.</i></p>",
    "Winfield made, lever-action repeating rifle. High fire-rate, large magazine."
  );
  assert.equal(
    parseDescription(html),
    "Winfield made, lever-action repeating rifle. High fire-rate, large magazine."
  );
});

test("parseDescription: a See-also hatnote is navigation and never the description", () => {
  // Without this, most of the catalog's `description` would have read "See also: ..." — a string that
  // looks like data and is a table of contents.
  const html = TRAIT_PAGE_SHAPE("<p><i>See also: Hellfire Bomb, Liquid Fire Bomb.</i></p>");
  assert.equal(parseDescription(html), null, "a page whose only lead prose is a hatnote states none");
});

test("parseDescription: the table of contents is not a section boundary", () => {
  // The TOC is `<h2 id="mw-toc-heading">Contents</h2>` with no mw-headline span. Anchoring on <h2>
  // put the lead boundary above the description on every page that has a TOC, yielding null for all
  // of them. Anchoring on the headline span is what makes the boundary mean "a real section".
  const html =
    `<html><body><div class="mw-parser-output">${infobox(PRICE_ROW)}` +
    `<h2 id="mw-toc-heading">Contents</h2><p>This portable foothold trap clamps loudly shut.</p>` +
    `${headline("Update_History", "Update History")}<p>changed</p></div></body></html>`;
  assert.equal(parseDescription(html), "This portable foothold trap clamps loudly shut.");
});

test("parseDescription: several lead paragraphs are kept, newline-joined", () => {
  // Necromancer's shape, and not only Necromancer's: 9 of the 32 traits carry a second paragraph,
  // each a conditional rule (`SOLO:`, `CATALYST:`, `SOLO CATALYST:`) that replaces the base effect
  // rather than restating it. Collapsing to the first paragraph would drop a mechanic from over a
  // quarter of them.
  const html = TRAIT_PAGE_SHAPE(
    "<p>Using Dark Sight, revive a downed teammate from a distance. (25m)</p>" +
      "<p>SOLO: You can revive your downed Hunter.</p>"
  );
  assert.equal(
    parseDescription(html),
    "Using Dark Sight, revive a downed teammate from a distance. (25m)\nSOLO: You can revive your downed Hunter."
  );
});

test("parseDescription: prose after the description's own section is not absorbed", () => {
  const html = DESCRIBED_PAGE_SHAPE("", "The description.");
  assert.equal(parseDescription(html), "The description.", "Trivia below it is excluded");
});

test("parseDescription: markup is stripped and entities decoded, so the value is plain text", () => {
  // SPEC-0003 requires descriptions be treated as untrusted and never inserted as markup. Stripping
  // here does not relieve a consumer of rendering it as text, but it does mean the stored value is
  // text rather than a fragment.
  const html = TRAIT_PAGE_SHAPE(
    '<p>Raises capacity to <a href="/wiki/Weapons">6</a> &amp; costs 8&#160;points.</p>'
  );
  assert.equal(parseDescription(html), "Raises capacity to 6 & costs 8 points.");
});

test("parseDescription: an inline link leaves no gap before punctuation", () => {
  // Real output before this: "Doubles the amount of Health restored by First Aid Kit ." and
  // "Using Dark Sight , revive" and "SOLO : You can revive". `textContent` turns every tag into a
  // space, which is correct for infobox values and wrong mid-sentence.
  const html = TRAIT_PAGE_SHAPE(
    '<p>Doubles the Health restored by <a href="/wiki/x">First Aid Kit</a>.</p>' +
      '<p><b>SOLO</b>: revive using <a href="/wiki/y">Dark Sight</a>, then heal.</p>'
  );
  assert.equal(
    parseDescription(html),
    "Doubles the Health restored by First Aid Kit.\nSOLO: revive using Dark Sight, then heal."
  );
});

test("parseDescription: a parenthetical after a sentence keeps its space", () => {
  // The punctuation fix must not chew up "distance. (25m)" into "distance.(25m)".
  const html = TRAIT_PAGE_SHAPE("<p>Revive a teammate from a distance. (25m)</p>");
  assert.equal(parseDescription(html), "Revive a teammate from a distance. (25m)");
});

test("parseDescription: a page with no prose at all yields null, not an empty string", () => {
  assert.equal(parseDescription(`<html><body><div class="mw-parser-output">${infobox(PRICE_ROW)}</div></body></html>`), null);
  assert.equal(parseDescription("<html><body>no parser output</body></html>"), null);
});

test("buildStatsRecord: carries the description, and null when the page stated none", () => {
  const base = {
    item: "X", canonicalTitle: "X", url: "u", revision: "1", infoboxCount: 1,
    selection: { index: 0, method: "canonical-title", title: "X" }, fields: {},
  };
  assert.equal(buildStatsRecord({ ...base, description: "Prose." }, { now: () => "t" }).description, "Prose.");
  assert.equal(buildStatsRecord(base, { now: () => "t" }).description, null, "absent becomes an explicit null");
});

test("parsePageCategories: reads the page's own category membership", () => {
  // The real Relentless catlinks block, trimmed. It is both Scarce and Burn, which is the case a
  // scalar cannot hold.
  const html =
    `<html><body><p>body</p><div id="catlinks" class="catlinks"><div id="mw-normal-catlinks">` +
    `<a href="/wiki/Special:Categories" title="Special:Categories">Categories</a>: ` +
    `<ul><li><a href="/wiki/Category:Traits/Supportive" title="Category:Traits/Supportive">Traits/Supportive</a></li>` +
    `<li><a href="/wiki/Category:Traits/Burn" title="Category:Traits/Burn">Traits/Burn</a></li>` +
    `<li><a href="/wiki/Category:Traits/Scarce" title="Category:Traits/Scarce">Traits/Scarce</a></li>` +
    `<li><a href="/wiki/Category:Traits" title="Category:Traits">Traits</a></li></ul></div></div></body></html>`;
  assert.deepEqual(parsePageCategories(html), [
    "Traits/Supportive",
    "Traits/Burn",
    "Traits/Scarce",
    "Traits",
  ]);
});

test("parsePageCategories: category-shaped links outside catlinks are not membership", () => {
  // SIZE_ROW's value links to Category:Weapons/Size_4. Reading the whole document would tag every
  // weapon with its own size as though the page declared it.
  const html = `<html><body>${infobox(SIZE_ROW)}<div id="catlinks"><ul><li>` +
    `<a href="/wiki/Category:Weapons" title="Category:Weapons">Weapons</a></li></ul></div></body></html>`;
  assert.deepEqual(parsePageCategories(html), ["Weapons"]);
});

test("parsePageCategories: category-shaped links AFTER the block are not membership either", () => {
  // The mirror of the test above, and the direction the first cut got wrong: the block was ended at a
  // fixed run of three closing divs and fell through to the whole document when that did not match.
  // Two divs close the real block (#catlinks wraps #mw-normal-catlinks), so a page laid out like this
  // tagged a Regular trait Scarce off a later nav link. (Review of #230.)
  const html =
    `<div id="catlinks" class="catlinks"><div id="mw-normal-catlinks"><ul>` +
    `<li><a href="/wiki/Category:Traits/Regular">Traits/Regular</a></li></ul></div></div>` +
    `<nav class="related"><a href="/wiki/Category:Traits/Scarce">Scarce traits</a>` +
    `<a href="/wiki/Category:Traits/Event">Event traits</a></nav>`;
  assert.deepEqual(parsePageCategories(html), ["Traits/Regular"]);
  assert.deepEqual(
    acquisitionClassesFrom(parsePageCategories(html)),
    ["Regular"],
    "a Regular trait does not acquire Scarce from markup outside the block"
  );
});

test("parsePageCategories: unbalanced markup fails closed rather than reading the document", () => {
  // No categories is incomplete data, which ADR-0013's bidirectional cost-0 test catches. A false
  // Scarce would instead make the rarity table endorse a wrong zero, which is the direction that
  // check exists to prevent.
  const html = `<div id="catlinks"><div id="mw-normal-catlinks"><ul><li>` +
    `<a href="/wiki/Category:Traits/Regular">Traits/Regular</a></li></ul>` +
    `<a href="/wiki/Category:Traits/Scarce">Scarce</a>`;
  assert.deepEqual(parsePageCategories(html), []);
});

test("parsePageCategories: a page with no catlinks block yields nothing", () => {
  assert.deepEqual(parsePageCategories("<html><body>no categories</body></html>"), []);
});

test("acquisitionClassesFrom: a trait can hold several rarity classes at once", () => {
  // Relentless and Rampage are Scarce AND Burn; All Ears is Scarce AND Event. The wiki's own data is
  // a set, so this returns one.
  assert.deepEqual(acquisitionClassesFrom(["Traits/Supportive", "Traits/Burn", "Traits/Scarce"]), [
    "Scarce",
    "Burn",
  ]);
  assert.deepEqual(acquisitionClassesFrom(["Traits/Scarce", "Traits/Event"]), ["Scarce", "Event"]);
});

test("acquisitionClassesFrom: order is stable regardless of the page's link order", () => {
  // Two runs must produce the same array for the same trait, or the dataset churns on every scrape.
  assert.deepEqual(
    acquisitionClassesFrom(["Traits/Event", "Traits/Scarce", "Traits/Burn"]),
    acquisitionClassesFrom(["Traits/Burn", "Traits/Event", "Traits/Scarce"])
  );
});

test("acquisitionClassesFrom: the functional taxonomy is excluded, because it is `group`", () => {
  // Traits/Supportive sits in the same catlinks block and is exactly the field SPEC-0007 forbids the
  // scrape from deriving. Solo and Catalyst are on that same axis per SPEC-0007's taxonomy sentence.
  const classes = acquisitionClassesFrom([
    "Traits/Supportive",
    "Traits/Offensive",
    "Traits/Movement",
    "Traits/Solo",
    "Traits/Catalyst",
  ]);
  assert.deepEqual(classes, [], "no functional category becomes an acquisition class");
});

test("acquisitionClassesFrom: Catalyst is a function, not a rarity", () => {
  // Beastface's real membership. It was reported as ["Regular","Catalyst"] — two rarities on one
  // trait — when it is one rarity plus one function. The wiki's own infobox settles it: all five
  // Catalyst traits state Type "Regular" and nothing else, where a two-rarity trait lists both
  // (Relentless is "Burn , Scarce"). (Review of #230.)
  assert.deepEqual(acquisitionClassesFrom(["Traits/Stealth", "Traits/Catalyst", "Traits/Regular"]), ["Regular"]);
});

test("acquisitionClassesFrom: Pact is on neither axis, so it yields no class", () => {
  // Category:Traits/Pact exists with zero members and states no axis, and SPEC-0007 lists it on
  // neither. A guessed rarity would be endorsed by ADR-0013's cost-0 check; no class is caught by it.
  assert.deepEqual(acquisitionClassesFrom(["Traits/Pact"]), []);
});

test("acquisitionClassesFrom: a Scarce weapon declares no rarity category, and gets no class", () => {
  // Flame Rifle's real catlinks. Weapons state rarity as the literal Price string "Scarce" instead,
  // so an empty set here is correct and NOT the same as "this item is Regular".
  assert.deepEqual(
    acquisitionClassesFrom(["Pages using duplicate arguments in template calls", "Weapons/Size 2", "Weapons"]),
    [],
    "and Weapons/Size 2 does not match on its last segment either"
  );
});

test("acquisitionOf: a Scarce trait states no cost at all, and is still known to be Scarce", () => {
  // The real shape: Scarce WEAPONS write the literal string "Scarce" as their Price, but Scarce
  // TRAITS carry no Cost row whatsoever. Purchasability is genuinely unresolved from the infobox —
  // the rarity class is the only thing that knows, which is why it is read from the categories.
  const a = acquisitionOf({ Unlock: "Bloodline Rank 1" }, { categories: ["Traits/Scarce", "Traits/Burn"] });
  assert.equal(a.priceStated, null);
  assert.equal(a.purchasable, null, "absent is not a determination");
  assert.deepEqual(a.acquisitionClasses, ["Scarce", "Burn"]);
});

test("acquisitionOf: with no categories passed, the classes key is absent rather than empty", () => {
  // Callers that never read a page must not appear to have found a trait with no rarity.
  assert.ok(!("acquisitionClasses" in acquisitionOf({ Price: "75" })));
});

test("acquisitionOf: a trait's Type is its acquisition class", () => {
  assert.equal(acquisitionOf({ Cost: "4", Type: "Burn" }).acquisition, "Burn");
  assert.equal(acquisitionOf({ Cost: "4", Type: "Regular" }).purchasable, true);
});

test("acquisitionOf: an unpurchasable item says so in words, and is not coerced", () => {
  // A Tarot Card's Price is the literal string "Scarce". The strict parser refuses it rather than
  // reading a number out of it, which is what makes purchasability fall out for free.
  const a = acquisitionOf({ Price: "Scarce" });
  assert.equal(a.purchasable, false);
  assert.equal(a.priceStated, "Scarce");
});

test("acquisitionOf: never reads the wiki's functional Category as acquisition", () => {
  // Traits carry Category = "Supportive"/"Offensive" — the taxonomy that looks like `group` and is
  // forbidden from becoming it.
  const a = acquisitionOf({ Cost: "4", Type: "Regular", Category: "Supportive" });
  assert.equal(a.acquisition, "Regular");
  assert.equal(JSON.stringify(a).includes("Supportive"), false);
});

test("buildStatsRecord: carries acquisition metadata and never a group", () => {
  const record = buildStatsRecord(
    {
      item: "Necromancer", canonicalTitle: "Necromancer", url: "u", revision: "1", infoboxCount: 1,
      selection: { index: 0, method: "canonical-title", title: "Necromancer" },
      fields: { Cost: "4", Type: "Burn", Category: "Supportive" },
    },
    { now: () => "t" }
  );
  assert.equal(record.acquisition, "Burn");
  assert.equal(record.purchasable, true);
  assert.equal("group" in record, false);
});

test("scrapeItemStats: reports a rename candidate when the page title differs", async () => {
  const page =
    `<html><script>RLCONF={"wgPageName":"Tools/Alert_Trip_Mines","wgCurRevisionId":1};</script><body>` +
    `<div class="druid-infobox druid-container"><div><div class="druid-title">Alert Trip Mines</div></div>` +
    `${PRICE_ROW}</div></body></html>`;
  const result = await scrapeItemStats(
    { category: "tools", id: "alert-trip-mine", name: "Alert Trip Mine", wikiPath: "Tools/Alert_Trip_Mines" },
    { fetchFn: fakeFetch(page), rateLimiter: noWait, robotsGroups: allowAll }
  );
  assert.deepEqual(result.renamed, { from: "Alert Trip Mine", to: "Alert Trip Mines" });
  assert.equal(result.id, "alert-trip-mine", "a rename never re-keys the item");
});

test("scrapeItemStats: no rename is reported when the titles agree", async () => {
  const result = await scrapeItemStats(target, { fetchFn: fakeFetch(), rateLimiter: noWait, robotsGroups: allowAll });
  assert.equal(result.renamed, null);
});

test("runDiscovery: classifies unmatched members and never proposes a tombstone as missing", async () => {
  const members = ["Tools/Bear Traps", "Tools/Electric Lamp", "Tools/Multitool", "Tools/Brand New Thing"];
  const fetchFn = async (url) => {
    // buildItemPageUrl percent-encodes each segment, so the colon arrives as %3A.
    if (decodeURIComponent(url).includes("Category:Tools")) return okResponse(categoryPage(members));
    // A stated price is what makes an unmatched page a genuine catalog gap. A page with no price
    // field at all is unresolved, not missing — see the test below.
    return okResponse(`<html><body><p>An ordinary tool page.</p>${infobox(PRICE_ROW)}</body></html>`);
  };
  const report = await runDiscovery(
    { categories: ["tools"], delayMs: 0 },
    { fetchFn, robotsGroups: allowAll, rateLimiter: noWait, log: () => {} }
  );
  const tools = report.tools;
  assert.equal(tools.wikiMembers, 4);
  assert.deepEqual(tools.tombstones.map((t) => [t.page, t.state]).sort(), [
    ["Tools/Electric Lamp", "removed"],
    ["Tools/Multitool", "never-shipped"],
  ]);
  assert.deepEqual(tools.missing.map((m) => m.page), ["Tools/Brand New Thing"]);
});

test("runDiscovery: a page with no price field is unresolved, not proposed as missing", async () => {
  // `purchasable` was two-valued, so "the page says its price is Scarce" (a determination the wiki
  // made) and "no Price or Cost field was found at all" (no evidence either way) both produced
  // false — and the second was printed as a deliberate exclusion. Splitting them costs the third
  // state, and SPEC-0007 forbids defaulting an unresolved attribute to a determination either way.
  const members = ["Tools/Unpriced Thing"];
  const fetchFn = async (url) => {
    if (decodeURIComponent(url).includes("Category:Tools")) return okResponse(categoryPage(members));
    return okResponse(`<html><body>${infobox(SIZE_ROW)}</body></html>`);
  };
  const report = await runDiscovery(
    { categories: ["tools"], delayMs: 0 },
    { fetchFn, robotsGroups: allowAll, rateLimiter: noWait, log: () => {} }
  );
  const tools = report.tools;
  assert.deepEqual(tools.missing.map((m) => m.page), [], "an unread price is not a catalog gap");
  assert.deepEqual(tools.unpurchasable.map((u) => u.page), [], "nor is it an exclusion");
  assert.deepEqual(tools.unresolved.map((u) => u.page), ["Tools/Unpriced Thing"]);
  assert.match(formatCoverage(report), /unresolved\s+Tools\/Unpriced Thing/);
});

test("CATEGORY_INDEX: traits are enumerated by every in-scope rarity index, not one redirect", () => {
  // A regression guard with a specific target. `Category:Purchasable_Traits` is a REDIRECT to
  // `Category:Traits/Regular`, so crawling it returned 58 members and a coverage figure that read as
  // complete while 14 Scarce and 18 Event traits were never enumerated. Naming the three indexes here
  // means reverting to the redirect fails a test rather than quietly shrinking the roster. (#231)
  assert.deepEqual(CATEGORY_INDEX.traits, [
    "Category:Traits/Regular",
    "Category:Traits/Scarce",
    "Category:Traits/Event",
  ]);
  for (const [category, indexes] of Object.entries(CATEGORY_INDEX)) {
    assert.ok(Array.isArray(indexes) && indexes.length > 0, `${category} maps to a non-empty list`);
    assert.ok(
      !indexes.includes("Category:Purchasable_Traits"),
      "the redirecting index is not used by any category"
    );
  }
});

test("runDiscovery: members are unioned across a category's indexes", async () => {
  // Member names are deliberately synthetic. An earlier version of this test used real Scarce and
  // Event trait names and asserted they landed in `unmatched` — which held only while the catalog
  // lacked them, so #157 adding Relentless broke a test about union behaviour for a reason that had
  // nothing to do with unions. What is under test is that a page from a non-Regular index is
  // enumerated at all, and that does not need a real roster gap to demonstrate.
  const perIndex = {
    "Category:Traits/Regular": ["Traits/Not In Catalog Regular"],
    "Category:Traits/Scarce": ["Traits/Not In Catalog Scarce"],
    "Category:Traits/Event": ["Traits/Not In Catalog Event"],
  };
  const fetchFn = async (url) => {
    const decoded = decodeURIComponent(url);
    for (const [index, members] of Object.entries(perIndex)) {
      if (decoded.includes(index.replace("Category:", "Category:").replace(/ /g, "_"))) {
        return okResponse(categoryPage(members));
      }
    }
    return okResponse(`<html><body>${infobox(PRICE_ROW)}</body></html>`);
  };
  const report = await runDiscovery(
    { categories: ["traits"], delayMs: 0 },
    { fetchFn, robotsGroups: allowAll, rateLimiter: noWait, log: () => {} }
  );
  const pages = report.traits.unmatched.map((u) => u.page).sort();
  assert.ok(pages.includes("Traits/Not In Catalog Scarce"), "a page from the Scarce index is enumerated");
  assert.ok(pages.includes("Traits/Not In Catalog Event"), "and so is one from the Event index");
  assert.equal(report.traits.wikiMembers, 3, "all three indexes contributed");
});

test("runDiscovery: a page listed by two indexes is one member and one gap, not two", async () => {
  // Six real traits are members of both the Scarce and the Event index. `matched` is computed as
  // members.length - unmatched.length, so a double-counted page inflates the member total AND
  // `matched` with it — the table would claim coverage it does not have.
  const shared = "Traits/All Ears";
  const fetchFn = async (url) => {
    const decoded = decodeURIComponent(url);
    if (decoded.includes("Traits/Regular")) return okResponse(categoryPage([]));
    if (decoded.includes("Traits/Scarce")) return okResponse(categoryPage([shared]));
    if (decoded.includes("Traits/Event")) return okResponse(categoryPage([shared]));
    return okResponse(`<html><body>${infobox(PRICE_ROW)}</body></html>`);
  };
  const report = await runDiscovery(
    { categories: ["traits"], delayMs: 0 },
    { fetchFn, robotsGroups: allowAll, rateLimiter: noWait, log: () => {} }
  );
  assert.equal(report.traits.wikiMembers, 1, "counted once, not twice");
  assert.equal(report.traits.unmatched.length, 1, "and classified once, not fetched twice");
  assert.deepEqual(report.traits.unmatched[0].listedIn, ["Category:Traits/Scarce", "Category:Traits/Event"]);
});

test("runDiscovery: matched arithmetic stays correct under de-duplication", async () => {
  // A catalog row matched by a page that two indexes list must not be double-credited.
  const fetchFn = async (url) => {
    const decoded = decodeURIComponent(url);
    if (decoded.includes("Traits/Regular")) return okResponse(categoryPage(["Traits/Quartermaster"]));
    if (decoded.includes("Traits/Scarce")) return okResponse(categoryPage(["Traits/Quartermaster"]));
    if (decoded.includes("Traits/Event")) return okResponse(categoryPage([]));
    return okResponse(`<html><body>${infobox(PRICE_ROW)}</body></html>`);
  };
  const report = await runDiscovery(
    { categories: ["traits"], delayMs: 0 },
    { fetchFn, robotsGroups: allowAll, rateLimiter: noWait, log: () => {} }
  );
  assert.equal(report.traits.wikiMembers, 1);
  assert.equal(report.traits.matched, 1, "not 2 — a page listed twice is one matched member");
  assert.equal(report.traits.unmatched.length, 0);
});

test("runDiscovery: every index is robots-checked, not only the first", async () => {
  // The index fetch was the one request that went out without asking, and #186 fixed that for a
  // single index. A list reintroduces the hole unless each entry is checked.
  const fetched = [];
  await assert.rejects(
    () =>
      runDiscovery(
        { categories: ["traits"], delayMs: 0 },
        {
          fetchFn: async (url) => {
            fetched.push(url);
            return okResponse(categoryPage([]));
          },
          // Allows the Regular index, disallows the Scarce one. The path is percent-encoded because
          // that is what `buildItemPageUrl` produces and therefore what the robots check is handed:
          // `Category:Traits/Scarce` becomes `/wiki/Category%3ATraits/Scarce`.
          robotsGroups: [
            { userAgents: ["*"], rules: [{ type: "disallow", path: "/wiki/Category%3ATraits/Scarce" }] },
          ],
          rateLimiter: noWait,
          log: () => {},
        }
      ),
    /robots\.txt disallows Category:Traits\/Scarce/
  );
  assert.deepEqual(fetched, [], "and it refuses before spending any request, including the allowed one");
});

test("formatCoverage: a multi-index category names the indexes behind its count", async () => {
  const out = formatCoverage({
    traits: {
      indexPages: ["Category:Traits/Regular", "Category:Traits/Scarce", "Category:Traits/Event"],
      wikiMembers: 84, catalogRows: 32, matched: 31,
      missing: [], unpurchasable: [], unresolved: [], tombstones: [], failures: [],
    },
    tools: {
      indexPages: ["Category:Tools"],
      wikiMembers: 23, catalogRows: 22, matched: 21,
      missing: [], unpurchasable: [], unresolved: [], tombstones: [], failures: [],
    },
  });
  assert.match(out, /indexes: Category:Traits\/Regular, Category:Traits\/Scarce, Category:Traits\/Event/);
  assert.ok(!/indexes: Category:Tools/.test(out), "a single-index category adds no noise");
});

test("runDiscovery: the category index is not fetched without a robots check", async () => {
  // This was the FIRST request the phase made, and the only one that went out without asking.
  const fetched = [];
  const fetchFn = async (url) => {
    fetched.push(url);
    return okResponse(categoryPage(["Tools/Whatever"]));
  };
  await assert.rejects(
    () =>
      runDiscovery(
        { categories: ["tools"], delayMs: 0 },
        {
          fetchFn,
          robotsGroups: [{ userAgents: ["*"], rules: [{ type: "disallow", path: "/wiki/" }] }],
          rateLimiter: noWait,
          log: () => {},
        }
      ),
    /robots\.txt disallows/
  );
  assert.deepEqual(fetched, [], "and it refuses before spending the request, not after");
});

test("runDiscovery: --dry-run resolves the indexes it would crawl and fetches none", async () => {
  // The documented --dry-run contract is "resolve URLs and check robots.txt, but fetch nothing".
  // Discovery is the most expensive phase in the script, so ignoring the flag meant the one mode
  // chosen to avoid requests made ~160 of them.
  const fetched = [];
  const report = await runDiscovery(
    { categories: ["tools"], delayMs: 0, dryRun: true },
    {
      fetchFn: async (url) => {
        fetched.push(url);
        return okResponse("");
      },
      robotsGroups: allowAll,
      rateLimiter: noWait,
      log: () => {},
    }
  );
  assert.deepEqual(fetched, [], "no request is made");
  assert.equal(report.tools.dryRun, true);
  assert.match(report.tools.indexUrls[0], /Category/);
  assert.match(formatCoverage(report), /dry-run — would crawl/);
});

test("runDiscovery: --dry-run names every index a multi-index category would crawl", async () => {
  // Traits map to three indexes. Reporting only the first would make the cheap mode the one that
  // hides the very thing #231 fixed.
  const report = await runDiscovery(
    { categories: ["traits"], delayMs: 0, dryRun: true },
    { fetchFn: async () => okResponse(""), robotsGroups: allowAll, rateLimiter: noWait, log: () => {} }
  );
  assert.equal(report.traits.indexUrls.length, 3);
  const out = formatCoverage(report);
  for (const name of ["Traits/Regular", "Traits/Scarce", "Traits/Event"]) {
    assert.ok(out.includes(name), `${name} is named in the dry-run output`);
  }
});

test("runDiscovery: an unfetchable page is reported as unreadable, not counted as missing", async () => {
  // A robots-disallowed page and an HTTP 429 both became { state: "live" }, which filed them under
  // `missing` — so a mid-crawl rate limit silently inflated the catalog-gap count, and the recorded
  // reason never reached the operator because only tombstones printed detail lines.
  const members = ["Tools/Rate Limited", "Tools/Exploding"];
  const fetchFn = async (url) => {
    const decoded = decodeURIComponent(url);
    if (decoded.includes("Category:Tools")) return okResponse(categoryPage(members));
    if (decoded.includes("Exploding")) throw new Error("socket hang up");
    return errResponse(429);
  };
  const report = await runDiscovery(
    { categories: ["tools"], delayMs: 0 },
    { fetchFn, robotsGroups: allowAll, rateLimiter: noWait, log: () => {} }
  );
  const tools = report.tools;
  assert.deepEqual(tools.missing.map((m) => m.page), [], "an unread page is not a catalog gap");
  assert.deepEqual(tools.failures.map((f) => f.page).sort(), ["Tools/Exploding", "Tools/Rate Limited"]);
  const out = formatCoverage(report);
  assert.match(out, /unreadable\s+Tools\/Rate Limited — HTTP 429/);
  assert.match(out, /unreadable\s+Tools\/Exploding — socket hang up/, "one page's throw does not end the crawl");
});

test("runDiscovery: the unmatched log event carries the acquisition metadata it parsed", async () => {
  // It was parsed into the report and dropped at the log boundary, so a finished run's durable
  // record could not say which missing traits were Burn or which pages were Scarce — the first live
  // run had to be reconstructed from raw JSON by hand to answer that.
  const events = [];
  const fetchFn = async (url) => {
    if (decodeURIComponent(url).includes("Category:Tools")) return okResponse(categoryPage(["Tools/Brand New Thing"]));
    return okResponse(ONE_INFOBOX_PAGE);
  };
  await runDiscovery(
    { categories: ["tools"], delayMs: 0 },
    { fetchFn, robotsGroups: allowAll, rateLimiter: noWait, log: (e) => events.push(e) }
  );
  const unmatched = events.find((e) => e.event === "discovery-unmatched");
  assert.equal(unmatched.purchasable, true);
  assert.equal(unmatched.priceStated, "75");
});

test("runDiscovery: an unread page omits the acquisition keys rather than logging a null verdict", async () => {
  // `purchasable: null` means "a page was read and stated no price" — three-valued on purpose. An
  // absent key means no infobox was read at all, and collapsing the two logs a determination the
  // run never made.
  const events = [];
  const fetchFn = async (url) => {
    if (decodeURIComponent(url).includes("Category:Tools")) return okResponse(categoryPage(["Tools/Gone"]));
    return errResponse(500);
  };
  await runDiscovery(
    { categories: ["tools"], delayMs: 0 },
    { fetchFn, robotsGroups: allowAll, rateLimiter: noWait, log: (e) => events.push(e) }
  );
  const unmatched = events.find((e) => e.event === "discovery-unmatched");
  assert.equal(unmatched.state, "unreadable");
  assert.ok(!("purchasable" in unmatched), "no key, rather than a null that reads as a finding");
});

test("formatCoverage: the missing bucket names its pages, with price and acquisition class", () => {
  // The one bucket that names real work was the only one with no detail line: the table reported 18
  // missing traits and the names existed nowhere but the raw JSON log.
  const out = formatCoverage({
    traits: {
      indexPage: "Category:Purchasable_Traits", wikiMembers: 58, catalogRows: 32, matched: 31,
      missing: [
        { page: "Traits/Scopesmith", priceStated: "4", acquisitionClasses: ["Regular"] },
        { page: "Traits/Relentless", priceStated: null, acquisitionClasses: ["Scarce", "Burn"] },
      ],
      unpurchasable: [], unresolved: [], tombstones: [], failures: [],
    },
  });
  assert.match(out, /missing\s+Traits\/Scopesmith — price "4", classes Regular/);
  assert.match(
    out,
    /missing\s+Traits\/Relentless — price null, classes Scarce\+Burn/,
    "a two-class trait reports both, rather than whichever the infobox named first"
  );
});

test("formatCoverage: a page with no rarity class prints no class suffix", () => {
  // Every weapon, tool and consumable is in this position. An empty bracket on ~105 lines would read
  // as a finding about them.
  const out = formatCoverage({
    weapons: {
      indexPage: "Category:Weapons", wikiMembers: 147, catalogRows: 39, matched: 38,
      missing: [{ page: "Weapons/Terminus", priceStated: "168", acquisitionClasses: [] }],
      unpurchasable: [], unresolved: [], tombstones: [], failures: [],
    },
  });
  assert.match(out, /missing\s+Weapons\/Terminus — price "168"$/m);
});

test("formatCoverage: reports missing and not-an-item as separate columns", () => {
  // A single "delta" number is what let the trait gap read as 26 missing traits when at least one
  // of them is a tombstone sitting in Category:Purchasable_Traits.
  const out = formatCoverage({
    traits: {
      indexPage: "Category:Purchasable_Traits", wikiMembers: 58, catalogRows: 32, matched: 32,
      missing: [{ page: "Traits/New One" }],
      unpurchasable: [],
      tombstones: [{ page: "Traits/Iron Repeater", state: "removed", reason: "merged into Iron Eye" }],
    },
  });
  assert.match(out, /wiki\s+58\s+catalog\s+32/);
  assert.match(out, /missing\s+1/);
  assert.match(out, /not-an-item\s+1/);
  assert.match(out, /removed\s+Traits\/Iron Repeater/);
});

test("runDiscovery: a live page the catalog excludes on purpose is not reported as missing", async () => {
  // A Tarot Card is a live page whose price is the literal word "Scarce". Reporting it as missing
  // is what made the consumables gap read as ~11 unknowns; separating it resolves them to zero.
  const members = ["Consumables/Frag Bomb", "Consumables/The Chariot"];
  const fetchFn = async (url) => {
    if (decodeURIComponent(url).includes("Category:Consumables")) return okResponse(categoryPage(members));
    return okResponse(
      '<div class="druid-infobox druid-container"><div><div class="druid-title">The Chariot</div></div>' +
        '<div class="druid-data druid-data-Price">Scarce</div></div>'
    );
  };
  const report = await runDiscovery(
    { categories: ["consumables"], delayMs: 0 },
    { fetchFn, robotsGroups: allowAll, rateLimiter: noWait, log: () => {} }
  );
  const cons = report.consumables;
  assert.deepEqual(cons.missing.map((m) => m.page), [], "nothing purchasable is missing");
  assert.deepEqual(cons.unpurchasable.map((u) => u.page), ["Consumables/The Chariot"]);
  assert.equal(cons.unpurchasable[0].priceStated, "Scarce");
});

test("catalog.js states the roster boundary in terms of purchasability", async () => {
  // SPEC-0007 REQ "Acquisition Class Is Captured": the boundary must be recorded where an editor
  // sees it, and phrased on purchasability rather than on any event's duration — the earlier
  // "limited-time event item" framing carried a revisit trigger that Update 2.8.1 has already fired.
  const src = await readFile(path.join(__dirname, "..", "client", "src", "data", "catalog.js"), "utf8");
  const boundary = src.slice(Math.max(0, src.indexOf("export const CONS") - 1600), src.indexOf("export const CONS"));
  assert.match(boundary, /hunt dollars/i);
  assert.match(boundary, /Scarce/);
  assert.match(boundary, /purchasab/i);
  // And phrased on purchasability rather than on an event's duration.
  assert.match(boundary, /permanence was never the criterion|not "limited-time|NOT "limited-time/i);
});
