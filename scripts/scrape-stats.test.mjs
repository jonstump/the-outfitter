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
  InfoboxFieldNotFoundError,
  InfoboxNotFoundError,
  ItemPageNotFoundError,
  NetworkFailureError,
  RateLimiter,
  RobotsDisallowedError,
  classifyPageFetchError,
  createSummary,
  extractInfoboxes,
  formatSummary,
  parseArgs,
  parseInfoboxFields,
  readInfoboxField,
  runStatsScrape,
  scrapeItemStats,
  sliceBalancedDiv,
  textContent,
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

/** A fetchFn that serves robots.txt permissively and routes every wiki page to `pageBody`. */
function fakeFetch(pageBody, { robots = "User-agent: *\nDisallow:\n", onPage } = {}) {
  return async (url) => {
    if (url.endsWith("/robots.txt")) return { ok: true, status: 200, text: async () => robots };
    if (onPage) return onPage(url);
    return okResponse(pageBody);
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
    fetchFn: fakeFetch(ONE_INFOBOX_PAGE),
    rateLimiter: noWait,
    robotsGroups: allowAll,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.infoboxCount, 1);
  assert.equal(result.fields.Price, "75");
});

test("scrapeItemStats: returns every variant's fields, choosing none of them", async () => {
  const result = await scrapeItemStats(target, {
    fetchFn: fakeFetch(TWO_INFOBOX_PAGE),
    rateLimiter: noWait,
    robotsGroups: allowAll,
  });
  // Which infobox describes the catalog row is #184's decision; this story hands over all of them.
  assert.equal(result.variants.length, 2);
  assert.equal(result.variants[0].Price, "75");
  assert.equal(result.variants[1].Price, "120");
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
    return call === 1 ? errResponse(500) : okResponse(ONE_INFOBOX_PAGE);
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
    { fetchFn: fakeFetch(ONE_INFOBOX_PAGE), log: (e) => lines.push(e) }
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

test("this story writes nothing: the module imports no filesystem API", async () => {
  const src = await readFile(path.join(__dirname, "scrape-stats.mjs"), "utf8");
  assert.equal(
    /from\s+["']node:fs/.test(src),
    false,
    "scrape-stats.mjs must not import a filesystem API — the dataset write is #184"
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
