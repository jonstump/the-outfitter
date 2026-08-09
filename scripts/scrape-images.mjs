#!/usr/bin/env node
// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time, Self-Hosted Scrape)
// Implements: SPEC-0001 REQ "Ethical, Self-Hosted Image Sourcing", SPEC-0001 REQ "Error Handling Standards"
//
// scripts/scrape-images.mjs
//
// Offline, on-demand scrape of huntshowdown.wiki.gg for catalog item images. This script is a
// standalone tool, NOT part of the app's runtime or build path:
//
//   - It is NOT wired into `npm run build`, `npm run dev`, `npm start`, or any CI config (this
//     repo has no CI yet — there is nothing to avoid wiring it into, but the constraint stands
//     for whenever CI is added).
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
//   - Sentinel error classes below let callers distinguish failure modes programmatically:
//     ItemPageNotFoundError, ImageAssetNotFoundError, NetworkFailureError, RobotsDisallowedError.
//   - A single item's failure is caught per-item and never aborts the run; it is recorded in a
//     structured per-run summary (succeeded/failed/skipped, with reasons) and logged with the
//     item name, URL, and reason — never silently swallowed.

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WEAPONS, TOOLS, TRAITS, CONS } from "../client/src/data/catalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

export const WIKI_ORIGIN = "https://huntshowdown.wiki.gg";
export const DEFAULT_DELAY_MS = 1500;
export const USER_AGENT =
  "TheOutfitterScrapeBot/1.0 (+https://github.com/jonstump/the-outfitter; contact: jmstump@gmail.com; " +
  "one-time offline catalog image scrape per ADR-0002, not a crawler)";
export const IMAGES_ROOT = path.join(REPO_ROOT, "client", "public", "images");

// ---------------------------------------------------------------------------
// Sentinel errors (SPEC-0001 "Error Handling Standards": domain-specific failure modes the
// scrape script needs to distinguish programmatically, e.g. "item page not found" vs. "image
// asset not found on an existing page" vs. "network/rate-limit failure").
// ---------------------------------------------------------------------------

export class ScrapeError extends Error {
  constructor(message, { cause, item, url } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = this.constructor.name;
    this.item = item;
    this.url = url;
  }
}

/** The catalog item's wiki page could not be located (e.g. HTTP 404). */
export class ItemPageNotFoundError extends ScrapeError {}

/** The item's wiki page loaded, but no usable image asset could be located on it. */
export class ImageAssetNotFoundError extends ScrapeError {}

/** A network, HTTP, or rate-limit failure occurred while talking to the wiki. */
export class NetworkFailureError extends ScrapeError {}

/** robots.txt disallows fetching the resource this script needed. */
export class RobotsDisallowedError extends ScrapeError {}

// ---------------------------------------------------------------------------
// Slugification — must match the {slug} half of the shared asset-path contract with issue #8:
// client/public/images/{category}/{slug}.{ext}, keyed by catalog item name (e.g.
// "Nagant M1895" -> "nagant-m1895"). Do not change this without also updating #8's IMAGES lookup.
// ---------------------------------------------------------------------------

const COMBINING_DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

export function slugify(name) {
  return name
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICS_RE, "") // strip combining diacritics
    .toLowerCase()
    .replace(/'/g, "") // drop apostrophes rather than turning them into hyphens
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Catalog -> scrape target list. Deliberately narrow: only the four categories and the specific
// items the catalog defines, never a wholesale wiki mirror.
// ---------------------------------------------------------------------------

export const CATEGORY_SOURCES = {
  weapons: WEAPONS,
  tools: TOOLS,
  traits: TRAITS,
  consumables: CONS,
};

export const CATEGORIES = Object.keys(CATEGORY_SOURCES);

export function collectCatalogItems(categories = CATEGORIES) {
  const items = [];
  for (const category of categories) {
    const rows = CATEGORY_SOURCES[category];
    if (!rows) continue;
    for (const row of rows) {
      // Catalog tuples are id-first ([id, name, ...]) since the stable-id
      // refactor; the display name (row[1]) drives the wiki URL and slug.
      const name = row[1];
      items.push({ category, name, slug: slugify(name) });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// robots.txt: fetch, parse, and enforce.
// ---------------------------------------------------------------------------

/** Parse robots.txt text into an array of { userAgents: string[], rules: [{type, path}] } groups. */
export function parseRobotsTxt(text) {
  const groups = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const sepIdx = line.indexOf(":");
    if (sepIdx === -1) continue;
    const key = line.slice(0, sepIdx).trim().toLowerCase();
    const value = line.slice(sepIdx + 1).trim();

    if (key === "user-agent") {
      if (current && current.rules.length === 0) {
        current.userAgents.push(value);
      } else {
        current = { userAgents: [value], rules: [] };
        groups.push(current);
      }
    } else if ((key === "allow" || key === "disallow") && current) {
      current.rules.push({ type: key, path: value });
    }
  }
  return groups;
}

function selectRobotsGroup(groups, userAgent) {
  const uaLower = userAgent.toLowerCase();
  const specific = groups.find((g) => g.userAgents.some((a) => a !== "*" && uaLower.includes(a.toLowerCase())));
  if (specific) return specific;
  return groups.find((g) => g.userAgents.includes("*")) || null;
}

/** Longest-matching-prefix rule, ties broken in favor of Allow (standard robots.txt semantics). */
export function isAllowedByRobots(groups, userAgent, pathToCheck) {
  const group = selectRobotsGroup(groups, userAgent);
  if (!group) return true;

  let winner = null;
  for (const rule of group.rules) {
    if (rule.path === "") continue; // "Disallow:" with no path means "allow everything"
    if (pathToCheck.startsWith(rule.path)) {
      if (
        !winner ||
        rule.path.length > winner.length ||
        (rule.path.length === winner.length && rule.type === "allow")
      ) {
        winner = { type: rule.type, length: rule.path.length };
      }
    }
  }
  return !winner || winner.type === "allow";
}

export async function fetchRobotsTxt(fetchFn, userAgent) {
  const url = `${WIKI_ORIGIN}/robots.txt`;
  let res;
  try {
    res = await fetchFn(url, { headers: { "User-Agent": userAgent } });
  } catch (err) {
    throw new NetworkFailureError(`failed to fetch robots.txt at ${url}: ${err.message}`, { cause: err, url });
  }
  if (res.status === 404) {
    // No robots.txt published: nothing to respect, treated as allow-all.
    return [];
  }
  if (!res.ok) {
    throw new NetworkFailureError(`failed to fetch robots.txt at ${url}: HTTP ${res.status}`, { url });
  }
  const text = await res.text();
  return parseRobotsTxt(text);
}

// ---------------------------------------------------------------------------
// Rate limiting: a minimum delay is enforced between any two requests to the wiki.
// ---------------------------------------------------------------------------

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RateLimiter {
  constructor(minDelayMs, { now = () => Date.now(), sleep = defaultSleep } = {}) {
    this.minDelayMs = minDelayMs;
    this.now = now;
    this.sleep = sleep;
    this.lastRequestAt = null;
  }

  async wait() {
    if (this.lastRequestAt !== null) {
      const elapsed = this.now() - this.lastRequestAt;
      const remaining = this.minDelayMs - elapsed;
      if (remaining > 0) {
        await this.sleep(remaining);
      }
    }
    this.lastRequestAt = this.now();
  }
}

// ---------------------------------------------------------------------------
// Wiki page / image URL resolution.
// ---------------------------------------------------------------------------

export function buildItemPageUrl(itemName) {
  const title = itemName.trim().replace(/\s+/g, "_");
  return `${WIKI_ORIGIN}/wiki/${encodeURIComponent(title)}`;
}

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

  const { category, name: item, slug } = target;
  const destPath = path.join(imagesRoot, category, `${slug}.jpg`); // extension resolved after fetch; placeholder for existence probing below
  const destDir = path.join(imagesRoot, category);

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

  const pageUrl = buildItemPageUrl(item);
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
