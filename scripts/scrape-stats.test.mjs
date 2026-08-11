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
  applyCatalogWrites,
  buildStatsRecord,
  canonicalTitleFromPageName,
  categoryLineRange,
  classifyPageFetchError,
  createSummary,
  extractInfoboxTitle,
  extractInfoboxes,
  formatCatalogPlan,
  formatSummary,
  isPartialRun,
  parseArgs,
  parseInfoboxFields,
  parseNumeric,
  planCatalogWrites,
  rangeViolation,
  replaceTupleField,
  readInfoboxField,
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
  // The recorded reason names the duplication rather than leaving it as a bare skip.
  assert.match(result.reason, /Frontier 73C/);
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
