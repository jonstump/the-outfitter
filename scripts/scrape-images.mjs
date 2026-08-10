#!/usr/bin/env node
// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time, Self-Hosted Scrape),
// ADR-0005 (shared wiki client: this script owns image sourcing only, and imports the pieces that must not diverge)
// Implements: SPEC-0001 REQ "Ethical, Self-Hosted Image Sourcing", SPEC-0001 REQ "Error Handling Standards"
//
// scripts/scrape-images.mjs
//
// Offline, on-demand scrape of huntshowdown.wiki.gg for catalog item images. This script is a
// standalone tool, NOT part of the app's runtime or build path:
//
//   - It is NOT wired into `npm run build`, `npm run dev`, or `npm start`. CI (.github/workflows/
//     ci.yml) references it only through `npm run test:scrape-images`, which exercises the unit
//     tests with an injected fetchFn — CI never invokes a live scrape and makes zero requests to
//     huntshowdown.wiki.gg.
//   - It must be invoked manually and deliberately by a human:
//
//       node scripts/scrape-images.mjs [options]
//
//     Options:
//       --only=weapons,tools,traits,consumables   Limit the run to these categories (default: all)
//       --delay-ms=1500                           Minimum delay between requests to the wiki (default: 1500ms)
//       --force                                   Re-download images that already exist on disk
//       --dry-run                                 Resolve URLs and check robots.txt, but do not
//                                                  fetch images or write files
//
// Running the app, its dev server, or its build never triggers any request to huntshowdown.wiki.gg
// — see ADR-0002 and SPEC-0001's "Ethical, Self-Hosted Image Sourcing" requirement. Images are
// self-hosted at client/public/images/{category}/{slug}.{ext} and served from the app's own
// origin; nothing in the app renders a live <img src="https://huntshowdown.wiki.gg/..."> URL.
//
// This script respects robots.txt (aborts the whole run if robots.txt itself can't be fetched or
// parsed, rather than assuming it's permissive), rate-limits every request to the wiki, and
// fetches only the specific item images the catalog needs (see collectCatalogItems below) — it
// does not mirror the wiki wholesale.
//
// Error handling (SPEC-0001 "Error Handling Standards"):
//   - Every layer boundary (robots.txt fetch, page fetch, image extraction, image fetch, disk
//     write) wraps its failure with contextual information (item name, URL, reason).
//   - Sentinel error classes (imported from scripts/lib/wiki.mjs) let callers distinguish failure
//     modes programmatically: ItemPageNotFoundError, ImageAssetNotFoundError, NetworkFailureError,
//     RobotsDisallowedError.
//   - A single item's failure is caught per-item and never aborts the run; it is recorded in a
//     structured per-run summary (succeeded/failed/skipped, with reasons) and logged with the
//     item name, URL, and reason — never silently swallowed.
//
// Shared wiki client (ADR-0005): slug derivation, robots.txt fetching and evaluation, the rate
// limiter, the user agent, the sentinel error classes, and catalog -> scrape-target resolution all
// live in scripts/lib/wiki.mjs and are imported here. They are re-exported below so this module's
// public surface is unchanged for existing importers, but this file defines none of them — a second
// copy of slugify() would drift from the on-disk image path contract, which is precisely the failure
// ADR-0005 extracted the module to prevent.

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CATEGORIES,
  DEFAULT_DELAY_MS,
  ImageAssetNotFoundError,
  ItemPageNotFoundError,
  KNOWN_CATALOG_DUPLICATES,
  NetworkFailureError,
  RateLimiter,
  RobotsDisallowedError,
  ScrapeError,
  USER_AGENT,
  buildItemPageUrl,
  collectCatalogItems,
  fetchRobotsTxt,
  isAllowedByRobots,
  resolveWikiPath,
} from "./lib/wiki.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

export const IMAGES_ROOT = path.join(REPO_ROOT, "client", "public", "images");

// Re-exported from the shared wiki client so this module's import surface is unchanged. These are
// defined exactly once, in scripts/lib/wiki.mjs (ADR-0005 confirmation criterion).
export {
  CATEGORIES,
  CATEGORY_SOURCES,
  DEFAULT_DELAY_MS,
  ImageAssetNotFoundError,
  ItemPageNotFoundError,
  KNOWN_CATALOG_DUPLICATES,
  NetworkFailureError,
  RateLimiter,
  RobotsDisallowedError,
  ScrapeError,
  USER_AGENT,
  WIKI_CATEGORY,
  WIKI_ORIGIN,
  WIKI_TITLE_OVERRIDES,
  buildItemPageUrl,
  collectCatalogItems,
  fetchRobotsTxt,
  isAllowedByRobots,
  parseRobotsTxt,
  resolveWikiPath,
  slugify,
} from "./lib/wiki.mjs";

// ---------------------------------------------------------------------------
// Image extraction — the part of the scrape that is specific to this script's payload. Everything
// above the line is shared; everything below it is image sourcing and belongs here.
// ---------------------------------------------------------------------------

/**
 * Best-effort extraction of a representative image URL from an item's wiki page HTML.
 * Prefers the og:image meta tag (a stable location independent of the page's infobox markup/skin),
 * falling back to the first image inside a portable-infobox-style container.
 */
export function extractImageUrl(html) {
  const ogMatch =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i);
  if (ogMatch) return ogMatch[1];

  const infoboxMatch = html.match(
    /<(?:figure|div)[^>]*class=["'][^"']*\b(?:pi-image|infobox-image|image)\b[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i
  );
  if (infoboxMatch) return infoboxMatch[1];

  return null;
}

const CONTENT_TYPE_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export function extForContentType(contentType, fallbackUrl) {
  if (contentType) {
    const base = contentType.split(";")[0].trim().toLowerCase();
    if (CONTENT_TYPE_EXT[base]) return CONTENT_TYPE_EXT[base];
  }
  const match = (fallbackUrl || "").match(/\.([a-z0-9]{2,4})(?:\?|#|$)/i);
  if (match) return match[1].toLowerCase();
  return "jpg";
}

function classifyPageFetchError(status, item, url) {
  if (status === 404) {
    return new ItemPageNotFoundError(`item page not found for "${item}": HTTP 404 at ${url}`, { item, url });
  }
  return new NetworkFailureError(`failed to fetch item page for "${item}": HTTP ${status} at ${url}`, {
    item,
    url,
  });
}

function classifyImageFetchError(status, item, url) {
  return new NetworkFailureError(`failed to fetch image for "${item}": HTTP ${status} at ${url}`, { item, url });
}

// ---------------------------------------------------------------------------
// Structured logging + per-run summary (SPEC-0001: "Structured logging MUST be used for scrape
// reporting", "a per-run summary of succeeded/failed/skipped items").
// ---------------------------------------------------------------------------

export function logStructured(event, { write = (line) => console.log(line) } = {}) {
  write(JSON.stringify({ ts: new Date().toISOString(), ...event }));
}

export function createSummary() {
  return { succeeded: [], failed: [], skipped: [] };
}

export function recordResult(summary, result) {
  summary[result.status].push(result);
  return summary;
}

export function formatSummary(summary) {
  const lines = [
    `scrape-images summary: ${summary.succeeded.length} succeeded, ${summary.failed.length} failed, ${summary.skipped.length} skipped`,
  ];
  for (const f of summary.failed) {
    lines.push(`  FAILED  ${f.category}/${f.slug} ("${f.item}"): ${f.reason}`);
  }
  for (const s of summary.skipped) {
    lines.push(`  SKIPPED ${s.category}/${s.slug} ("${s.item}"): ${s.reason}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Per-item scrape.
// ---------------------------------------------------------------------------

async function pathExists(fsAccess, filePath) {
  try {
    await fsAccess(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scrape a single catalog item's image. Every failure mode throws one of the sentinel error
 * classes above with item/url context attached; callers are expected to catch per-item (see
 * runScrape) so one item's failure never aborts the whole run.
 */
export async function scrapeItem(target, deps) {
  const {
    fetchFn,
    rateLimiter,
    robotsGroups,
    userAgent = USER_AGENT,
    imagesRoot = IMAGES_ROOT,
    fsMkdir = mkdir,
    fsWriteFile = writeFile,
    fsAccess = access,
    force = false,
    dryRun = false,
  } = deps;

  const { category, id, name: item, slug } = target;
  const wikiPath =
    target.wikiPath !== undefined ? target.wikiPath : resolveWikiPath(category, id, item);
  const destDir = path.join(imagesRoot, category);

  // Known catalog duplicates have no wiki page of their own. Skip them before spending a request
  // so they surface as an explained skip rather than a 404 in the failed bucket.
  if (wikiPath === null) {
    const reason = KNOWN_CATALOG_DUPLICATES[id] || "no wiki page mapped for this catalog entry";
    return { status: "skipped", category, item, slug, reason: `no wiki page: ${reason}` };
  }

  // Skip re-downloading if any extension of this slug already exists on disk, unless --force.
  if (!force) {
    for (const ext of Object.values(CONTENT_TYPE_EXT)) {
      const candidate = path.join(destDir, `${slug}.${ext}`);
      // eslint-disable-next-line no-await-in-loop
      if (await pathExists(fsAccess, candidate)) {
        return { status: "skipped", category, item, slug, reason: `already exists at ${candidate}` };
      }
    }
  }

  const pageUrl = buildItemPageUrl(wikiPath);
  const pagePath = new URL(pageUrl).pathname;

  if (!isAllowedByRobots(robotsGroups, userAgent, pagePath)) {
    throw new RobotsDisallowedError(`robots.txt disallows fetching "${item}" at ${pagePath}`, {
      item,
      url: pageUrl,
    });
  }

  await rateLimiter.wait();

  let pageRes;
  try {
    pageRes = await fetchFn(pageUrl, { headers: { "User-Agent": userAgent } });
  } catch (err) {
    throw new NetworkFailureError(`network failure fetching item page for "${item}" at ${pageUrl}: ${err.message}`, {
      cause: err,
      item,
      url: pageUrl,
    });
  }
  if (!pageRes.ok) {
    throw classifyPageFetchError(pageRes.status, item, pageUrl);
  }

  const html = await pageRes.text();
  const rawImageUrl = extractImageUrl(html);
  if (!rawImageUrl) {
    throw new ImageAssetNotFoundError(`image asset not found on page for "${item}" at ${pageUrl}`, {
      item,
      url: pageUrl,
    });
  }

  const imageUrl = new URL(rawImageUrl, pageUrl).toString();
  const imagePath = new URL(imageUrl).pathname;

  if (!isAllowedByRobots(robotsGroups, userAgent, imagePath)) {
    throw new RobotsDisallowedError(`robots.txt disallows fetching image for "${item}" at ${imagePath}`, {
      item,
      url: imageUrl,
    });
  }

  if (dryRun) {
    return { status: "skipped", category, item, slug, reason: `dry-run: would fetch ${imageUrl}` };
  }

  await rateLimiter.wait();

  let imageRes;
  try {
    imageRes = await fetchFn(imageUrl, { headers: { "User-Agent": userAgent } });
  } catch (err) {
    throw new NetworkFailureError(`network failure fetching image for "${item}" at ${imageUrl}: ${err.message}`, {
      cause: err,
      item,
      url: imageUrl,
    });
  }
  if (!imageRes.ok) {
    throw classifyImageFetchError(imageRes.status, item, imageUrl);
  }

  const contentType = typeof imageRes.headers?.get === "function" ? imageRes.headers.get("content-type") : null;
  const ext = extForContentType(contentType, imageUrl);
  const finalDestPath = path.join(destDir, `${slug}.${ext}`);

  let buffer;
  try {
    const arrayBuffer = await imageRes.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch (err) {
    throw new NetworkFailureError(`failed to read image bytes for "${item}" at ${imageUrl}: ${err.message}`, {
      cause: err,
      item,
      url: imageUrl,
    });
  }

  try {
    await fsMkdir(destDir, { recursive: true });
    await fsWriteFile(finalDestPath, buffer);
  } catch (err) {
    throw new ScrapeError(`failed to write image for "${item}" to ${finalDestPath}: ${err.message}`, {
      cause: err,
      item,
      url: imageUrl,
    });
  }

  return { status: "succeeded", category, item, slug, path: finalDestPath };
}

// ---------------------------------------------------------------------------
// Run orchestration: per-item try/catch, never lets one item's failure abort the run.
// ---------------------------------------------------------------------------

export async function runScrape(options, deps) {
  const { categories = CATEGORIES, delayMs = DEFAULT_DELAY_MS, force = false, dryRun = false } = options;
  const { fetchFn, userAgent = USER_AGENT, log = logStructured } = deps;

  const summary = createSummary();

  let robotsGroups;
  try {
    robotsGroups = await fetchRobotsTxt(fetchFn, userAgent);
  } catch (err) {
    // robots.txt itself is unreachable: fail closed rather than assuming permission. This is a
    // fatal, run-level condition (not a per-item one) — we cannot honor robots.txt if we can't
    // read it.
    log({ level: "error", event: "robots-fetch-failed", reason: err.message });
    throw err;
  }

  const rateLimiter = new RateLimiter(delayMs);
  const items = collectCatalogItems(categories);

  for (const target of items) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await scrapeItem(target, {
        ...deps,
        robotsGroups,
        rateLimiter,
        userAgent,
        force,
        dryRun,
      });
      recordResult(summary, result);
      log({
        level: result.status === "skipped" ? "info" : "info",
        event: `item-${result.status}`,
        category: target.category,
        item: target.name,
        slug: target.slug,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.path ? { path: result.path } : {}),
      });
    } catch (err) {
      recordResult(summary, {
        status: "failed",
        category: target.category,
        item: target.name,
        slug: target.slug,
        errorType: err.name,
        reason: err.message,
      });
      log({
        level: "error",
        event: "item-failed",
        category: target.category,
        item: target.name,
        slug: target.slug,
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

// ---------------------------------------------------------------------------
// CLI entrypoint (only runs when this file is executed directly, e.g.
// `node scripts/scrape-images.mjs` — never on import, so tests importing the functions above
// never trigger a live run).
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { categories: CATEGORIES, delayMs: DEFAULT_DELAY_MS, force: false, dryRun: false };
  for (const arg of argv) {
    if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--only=")) {
      options.categories = arg
        .slice("--only=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--delay-ms=")) {
      const parsed = Number(arg.slice("--delay-ms=".length));
      if (Number.isFinite(parsed) && parsed >= 0) options.delayMs = parsed;
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(
    `scrape-images: starting (${options.categories.join(", ")}), delay=${options.delayMs}ms, force=${options.force}, dry-run=${options.dryRun}`
  );
  console.log(`scrape-images: this is a manual, offline tool per ADR-0002 — not run by build/dev/CI.`);

  const summary = await runScrape(options, { fetchFn: fetch });
  console.log(formatSummary(summary));

  process.exitCode = summary.failed.length > 0 ? 1 : 0;
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((err) => {
    console.error(`scrape-images: fatal error: ${err.message}`);
    if (err.cause) console.error(`  caused by: ${err.cause.message || err.cause}`);
    process.exitCode = 1;
  });
}
