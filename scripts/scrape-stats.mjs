#!/usr/bin/env node
// Governing: ADR-0005 (Scrape Item Stats and Descriptions from huntshowdown.wiki.gg into a
// Generated, Committed Data File), ADR-0002 (the ethics posture this inherits unchanged)
// Implements: SPEC-0007 REQ "Offline, Human-Invoked Stats Scrape", SPEC-0007 REQ "Error Handling
// Standards"
//
// scripts/scrape-stats.mjs
//
// Offline, human-invoked scrape of huntshowdown.wiki.gg for catalog item stats. Like its two
// siblings it is a standalone tool, NOT part of the app's runtime or build path:
//
//   - It is NOT wired into `npm run build`, `npm run dev`, `npm start`, or any CI job. CI reaches
//     it only through `npm test` -> `test:scrape`, which runs the unit tests with an injected
//     fetchFn and makes zero requests to huntshowdown.wiki.gg.
//   - It must be invoked manually and deliberately by a human:
//
//       node scripts/scrape-stats.mjs [options]
//
//     Options:
//       --only=weapons,tools,traits,consumables   Limit the run to these categories (default: all)
//       --delay-ms=1500                           Minimum delay between requests (default: 1500ms)
//       --limit=N                                 Stop after N items (useful for a smoke run)
//       --dry-run                                 Resolve URLs and check robots.txt, but fetch
//                                                  nothing
//
// WHAT THIS SCRIPT DOES NOT DO YET, DELIBERATELY
//
// It writes nothing. Not `client/src/data/itemStats.json`, not `catalog.js`, not a byte anywhere.
// This is the skeleton story (#183): the run loop, the robots and rate-limit posture, the parse
// seam, and the error contract. The generated dataset is #184 and the guarded write-through to
// catalog.js is #185, and both are specified before either is built precisely so the dangerous
// half arrives last. A run today fetches each item's page, extracts its infobox fields, and
// reports what it found — which is enough to exercise the whole path against real markup without
// putting anything on disk.
//
// Error handling (SPEC-0007 REQ "Error Handling Standards"):
//   - Every layer boundary (robots fetch, page fetch, infobox extraction, field read) wraps its
//     failure with contextual information: item name, URL, and reason.
//   - Four sentinel classes stay distinguishable rather than collapsing into one generic error —
//     ItemPageNotFoundError (no page), InfoboxNotFoundError (page but no infobox),
//     InfoboxFieldNotFoundError (infobox but no such field), and NetworkFailureError (transport or
//     rate limit). They mean different things: the first two usually indicate resolution landed on
//     the wrong page, the third is a genuine gap in the wiki's data, and the fourth is transient.
//   - A single item's failure is caught per-item and never aborts the run. robots.txt being
//     unreadable IS fatal, because we cannot honor a policy we cannot read.
//
// Shared wiki client (ADR-0005): slug derivation, robots handling, the rate limiter, the user
// agent, the sentinel errors, catalog -> scrape-target resolution, and the run-summary helpers all
// live in scripts/lib/wiki.mjs and are imported here. This file defines none of them. A second
// copy of slugify() in particular would drift from the on-disk asset path contract, which is the
// exact failure ADR-0005 extracted that module to prevent (and which issue #119 already caught
// once, on the client end).

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CATEGORIES,
  DEFAULT_DELAY_MS,
  InfoboxFieldNotFoundError,
  InfoboxNotFoundError,
  ItemPageNotFoundError,
  KNOWN_CATALOG_DUPLICATES,
  NetworkFailureError,
  RateLimiter,
  RobotsDisallowedError,
  USER_AGENT,
  buildItemPageUrl,
  collectCatalogItems,
  createSummary,
  fetchRobotsTxt,
  isAllowedByRobots,
  logStructured,
  recordResult,
  resolveWikiPath,
} from "./lib/wiki.mjs";

// Re-exported so the test file and any future consumer import the shared definitions through this
// module rather than reaching past it. Defined exactly once, in scripts/lib/wiki.mjs.
export {
  CATEGORIES,
  DEFAULT_DELAY_MS,
  InfoboxFieldNotFoundError,
  InfoboxNotFoundError,
  ItemPageNotFoundError,
  NetworkFailureError,
  RateLimiter,
  RobotsDisallowedError,
  ScrapeError,
  USER_AGENT,
  buildItemPageUrl,
  collectCatalogItems,
  createSummary,
  recordResult,
  resolveWikiPath,
  slugify,
} from "./lib/wiki.mjs";

// ---------------------------------------------------------------------------
// Infobox extraction — the payload-specific half, and the seam #184 builds the dataset on.
//
// huntshowdown.wiki.gg renders item stats with the Druid skin's infobox, not MediaWiki's
// portable-infobox. That is good news for parsing: every field carries its own name in a class
// rather than being positional or label-matched, so a field read is
//
//     <div class="druid-data druid-data-Price druid-data-nonempty">75&#160;<a>…</a></div>
//              -> fields.Price === "75"
//
// Observed field names on a weapon page: Price, Size, Update, Source, AmmoType, Loaded, Extra,
// Damage, MuzzleVelocity, DropRange, RateofFire, CycleTime, Spread, Sway, VerticalRecoil,
// ReloadSpeed, MeleeDamage, HeavyMeleeDamage, StaminaConsumption, Description. That set covers
// the weapon audit's §3.0 list, which is a floor on what a stats scrape must capture rather than
// a ceiling — dual-wieldability, for one, lives in the Description prose and not in any field
// (issue #178).
//
// A page carries SEVERAL infoboxes — one per variant, six on Weapons/Ranger_73 — and the first is
// not reliably the base weapon. Deciding which infobox describes the catalog row is #184's
// problem, not this story's; extractInfoboxes returns all of them in document order and lets the
// caller choose.
// ---------------------------------------------------------------------------

const INFOBOX_OPEN = /<div\b[^>]*class="[^"]*\bdruid-infobox\b[^"]*"[^>]*>/gi;

/**
 * Slice out the balanced <div>…</div> beginning at `startIdx`.
 *
 * Deliberately a scanner rather than a regex: infobox internals nest, and a lazy
 * `<div[^>]*>.*?</div>` stops at the first inner close tag, silently truncating the block. Returns
 * null when the document ends before the div closes (malformed HTML), so the caller can treat that
 * as "no usable infobox" rather than acting on a partial slice.
 */
export function sliceBalancedDiv(html, startIdx) {
  const tag = /<(\/?)div\b[^>]*?(\/?)>/gi;
  tag.lastIndex = startIdx;
  let depth = 0;
  let match;
  while ((match = tag.exec(html)) !== null) {
    const isClose = match[1] === "/";
    const isSelfClosing = match[2] === "/";
    if (isSelfClosing) continue;
    depth += isClose ? -1 : 1;
    if (depth === 0) return html.slice(startIdx, tag.lastIndex);
  }
  return null;
}

/** Every infobox block on the page, in document order. Empty array when the page carries none. */
export function extractInfoboxes(html) {
  const blocks = [];
  INFOBOX_OPEN.lastIndex = 0;
  let match;
  while ((match = INFOBOX_OPEN.exec(html)) !== null) {
    const block = sliceBalancedDiv(html, match.index);
    if (block) {
      blocks.push(block);
      INFOBOX_OPEN.lastIndex = match.index + block.length;
    }
  }
  return blocks;
}

/** Strip tags and entities down to the text a reader would see, with whitespace collapsed. */
export function textContent(fragment) {
  return fragment
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Read every `druid-data-{Field}` value out of one infobox block into a plain object.
 *
 * `druid-data-nonempty` and `druid-data-wide` are presentation modifiers rather than field names
 * and are excluded — treating them as fields would invent two that no item has.
 */
const FIELD_MODIFIERS = new Set(["nonempty", "wide", "empty"]);

export function parseInfoboxFields(infoboxHtml) {
  const fields = {};
  const dataOpen = /<div\b[^>]*class="([^"]*\bdruid-data\b[^"]*)"[^>]*>/gi;
  let match;
  while ((match = dataOpen.exec(infoboxHtml)) !== null) {
    const names = (match[1].match(/druid-data-([A-Za-z0-9_]+)/g) || [])
      .map((c) => c.replace("druid-data-", ""))
      .filter((n) => !FIELD_MODIFIERS.has(n));
    if (names.length === 0) continue;

    const block = sliceBalancedDiv(infoboxHtml, match.index);
    if (block === null) continue;
    const inner = block.replace(/^<div\b[^>]*>/i, "").replace(/<\/div>$/i, "");
    const value = textContent(inner);
    for (const name of names) {
      // First occurrence wins: a field repeated within one infobox is a markup quirk, and taking
      // the last would silently prefer whichever the page happened to render second.
      if (!(name in fields)) fields[name] = value;
    }
    dataOpen.lastIndex = match.index + block.length;
  }
  return fields;
}

/**
 * Read one field, or throw. Use where a caller genuinely requires the field — a caller that can
 * proceed without it should read `fields[name]` directly rather than catching this.
 */
export function readInfoboxField(fields, name, { item, url } = {}) {
  const value = fields?.[name];
  if (value === undefined || value === "") {
    throw new InfoboxFieldNotFoundError(
      `infobox for "${item}" has no "${name}" field at ${url}`,
      { item, url, field: name }
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Failure classification at the page-fetch boundary.
// ---------------------------------------------------------------------------

export function classifyPageFetchError(status, item, url) {
  if (status === 404) {
    return new ItemPageNotFoundError(`item page not found for "${item}": HTTP 404 at ${url}`, { item, url });
  }
  return new NetworkFailureError(`failed to fetch item page for "${item}": HTTP ${status} at ${url}`, {
    item,
    url,
  });
}

// ---------------------------------------------------------------------------
// Per-item scrape.
// ---------------------------------------------------------------------------

/**
 * Scrape one catalog item's stats. Every failure throws a sentinel with item and url attached;
 * callers catch per-item (see runStatsScrape) so one item never aborts the run.
 */
export async function scrapeItemStats(target, deps) {
  const { fetchFn, rateLimiter, robotsGroups, userAgent = USER_AGENT, dryRun = false } = deps;

  const { category, id, name: item } = target;
  const wikiPath = target.wikiPath !== undefined ? target.wikiPath : resolveWikiPath(category, id, item);

  // Known duplicates have no page of their own. Skip before spending a request so they surface as
  // an explained skip rather than as a 404 in the failed bucket.
  if (wikiPath === null) {
    const reason = KNOWN_CATALOG_DUPLICATES[id] || "no wiki page mapped for this catalog entry";
    return { status: "skipped", category, id, item, reason: `no wiki page: ${reason}` };
  }

  const pageUrl = buildItemPageUrl(wikiPath);
  const pagePath = new URL(pageUrl).pathname;

  if (!isAllowedByRobots(robotsGroups, userAgent, pagePath)) {
    throw new RobotsDisallowedError(`robots.txt disallows fetching "${item}" at ${pagePath}`, {
      item,
      url: pageUrl,
    });
  }

  if (dryRun) {
    return { status: "skipped", category, id, item, reason: `dry-run: would fetch ${pageUrl}` };
  }

  await rateLimiter.wait();

  let res;
  try {
    res = await fetchFn(pageUrl, { headers: { "User-Agent": userAgent } });
  } catch (err) {
    throw new NetworkFailureError(`network failure fetching item page for "${item}" at ${pageUrl}: ${err.message}`, {
      cause: err,
      item,
      url: pageUrl,
    });
  }
  if (!res.ok) throw classifyPageFetchError(res.status, item, pageUrl);

  const html = await res.text();
  const infoboxes = extractInfoboxes(html);
  if (infoboxes.length === 0) {
    throw new InfoboxNotFoundError(`no infobox on page for "${item}" at ${pageUrl}`, { item, url: pageUrl });
  }

  // All of them, in document order. Which one describes the catalog row is #184's decision — a
  // page carries one infobox per variant and the first is not reliably the base item.
  const variants = infoboxes.map((block) => parseInfoboxFields(block));

  return {
    status: "succeeded",
    category,
    id,
    item,
    url: pageUrl,
    infoboxCount: infoboxes.length,
    fields: variants[0],
    variants,
  };
}

// ---------------------------------------------------------------------------
// Run orchestration: per-item try/catch, never lets one item's failure abort the run.
// ---------------------------------------------------------------------------

export async function runStatsScrape(options, deps) {
  const { categories = CATEGORIES, delayMs = DEFAULT_DELAY_MS, dryRun = false, limit = null } = options;
  const { fetchFn, userAgent = USER_AGENT, log = logStructured } = deps;

  const summary = createSummary();

  let robotsGroups;
  try {
    robotsGroups = await fetchRobotsTxt(fetchFn, userAgent);
  } catch (err) {
    // Fatal and run-level, not per-item: we cannot honor robots.txt if we cannot read it, so fail
    // closed rather than assume permission.
    log({ level: "error", event: "robots-fetch-failed", reason: err.message });
    throw err;
  }

  const rateLimiter = new RateLimiter(delayMs);
  let items = collectCatalogItems(categories);
  if (limit !== null && limit >= 0) items = items.slice(0, limit);

  for (const target of items) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await scrapeItemStats(target, { ...deps, robotsGroups, rateLimiter, userAgent, dryRun });
      recordResult(summary, result);
      log({
        level: "info",
        event: `item-${result.status}`,
        category: target.category,
        item: target.name,
        id: target.id,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.infoboxCount ? { infoboxes: result.infoboxCount } : {}),
        ...(result.fields ? { fields: Object.keys(result.fields).length } : {}),
      });
    } catch (err) {
      recordResult(summary, {
        status: "failed",
        category: target.category,
        id: target.id,
        item: target.name,
        errorType: err.name,
        reason: err.message,
        url: err.url,
      });
      log({
        level: "error",
        event: "item-failed",
        category: target.category,
        item: target.name,
        id: target.id,
        errorType: err.name,
        reason: err.message,
        url: err.url,
      });
    }
  }

  log({
    level: "info",
    event: "run-summary",
    succeeded: summary.succeeded.length,
    failed: summary.failed.length,
    skipped: summary.skipped.length,
  });

  return summary;
}

export function formatSummary(summary) {
  const lines = [
    `scrape-stats summary: ${summary.succeeded.length} succeeded, ${summary.failed.length} failed, ` +
      `${summary.skipped.length} skipped`,
  ];
  for (const f of summary.failed) {
    lines.push(`  FAILED  ${f.category}/${f.id} ("${f.item}") [${f.errorType}]: ${f.reason}`);
  }
  for (const s of summary.skipped) {
    lines.push(`  SKIPPED ${s.category}/${s.id} ("${s.item}"): ${s.reason}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI entrypoint (only when executed directly — never on import, so the tests importing the
// functions above never trigger a live run).
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = { categories: CATEGORIES, delayMs: DEFAULT_DELAY_MS, dryRun: false, limit: null };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--only=")) {
      options.categories = arg
        .slice("--only=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--delay-ms=")) {
      const parsed = Number(arg.slice("--delay-ms=".length));
      if (Number.isFinite(parsed) && parsed >= 0) options.delayMs = parsed;
    } else if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (Number.isInteger(parsed) && parsed >= 0) options.limit = parsed;
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(
    `scrape-stats: starting (${options.categories.join(", ")}), delay=${options.delayMs}ms, ` +
      `dry-run=${options.dryRun}${options.limit === null ? "" : `, limit=${options.limit}`}`
  );
  console.log("scrape-stats: manual, offline tool per ADR-0002/ADR-0005 — not run by build/dev/CI.");
  console.log("scrape-stats: this story reports only and writes no files (see #184 for the dataset).");

  const summary = await runStatsScrape(options, { fetchFn: fetch });
  console.log(formatSummary(summary));

  process.exitCode = summary.failed.length > 0 ? 1 : 0;
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((err) => {
    console.error(`scrape-stats: fatal error: ${err.message}`);
    if (err.cause) console.error(`  caused by: ${err.cause.message || err.cause}`);
    process.exitCode = 1;
  });
}
