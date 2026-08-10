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

/** Catalog category -> the wiki's own top-level namespace segment for that category. */
export const WIKI_CATEGORY = {
  weapons: "Weapons",
  tools: "Tools",
  traits: "Traits",
  consumables: "Consumables",
};

// ---------------------------------------------------------------------------
// Catalog id -> wiki page path.
//
// The wiki namespaces every item page under its category ("/wiki/Weapons/Nagant_M1895", not
// "/wiki/Nagant_M1895"), so the default resolution is `${WIKI_CATEGORY[category]}/${title}`,
// derived from the item's display name.
//
// Three things break that default and need the override table below:
//
//   1. Hunt's Update 2.0 ("1896") renamed most branded weapons — the catalog still carries a
//      number of pre-rename display names ("Sparks LRR", "Caldwell Pax") while the wiki moved to
//      the post-rename titles ("Sparks", "Pax").
//   2. Weapon *variants* live on subpages ("Sparks/Pistol", "Mosin-Nagant/Avtomat",
//      "Officer/Carbine"), which a flat display name can't express. Note the wiki flattens
//      compound variants into ONE segment — "Sparks/Pistol_Silencer", never
//      "Sparks/Pistol/Silencer" — so a path is at most three segments deep.
//   3. A few catalog items sit under a different wiki category than the catalog's own — the
//      Katana is a Tool here but a Weapon on the wiki.
//
// Values are paths relative to /wiki/ and INCLUDE the category segment, precisely so a cross-
// category item can be expressed. A `null` value means "deliberately has no wiki page" — see
// KNOWN_CATALOG_DUPLICATES below; those items are skipped without spending a request.
//
// KEYED BY CATALOG `id`, NOT BY DISPLAY NAME. This matters, and it is not stylistic:
// ADR-0005 makes the wiki authoritative for display names and has scrape-stats.mjs write
// renames back into catalog.js, while guaranteeing that `id` is never rewritten. A
// name-keyed table silently stops matching the first time that write-through runs — and the
// failure is invisible, because resolution then falls back to `Weapons/{new name}`, which is
// *usually* right for a plain rename and wrong exactly where it matters. "Nagant Officer
// Carbine" -> "Officer Carbine" would fall back to "Weapons/Officer_Carbine"; the real page is
// "Weapons/Officer/Carbine". Keying on the one field the ADR promises never changes makes the
// table survive its own success.
//
// Verified against the wiki's own sitemap (sitemap-huntshowdown_en-NS_0), not by probing URLs one
// at a time. When a DLC ships or the catalog changes, re-verify the same way: pull the sitemap
// index at /sitemaps/sitemap-index-huntshowdown_en.xml, expand the NS_0 gzip, and diff the
// resolved paths against it — two requests instead of one per item. Note the sitemap lags live
// edits by months, so treat "absent from the sitemap" as "check this one by hand", not "gone".
// For discovering pages the catalog does not yet have (every variant, and a dozen-odd base
// weapons), /wiki/Category:Weapons is the authority, not the sitemap — see
// docs/audits/weapon-catalog-wiki-audit.md.
// ---------------------------------------------------------------------------

export const WIKI_TITLE_OVERRIDES = {
  weapons: {
    "caldwell-conversion-pistol": "Weapons/Conversion",
    "caldwell-conversion-uppercut": "Weapons/Uppercut",
    "caldwell-pax": "Weapons/Pax",
    "caldwell-rival-78": "Weapons/Rival_78",
    "crown-king-auto-5": "Weapons/Auto-5",
    "krag-m1894": "Weapons/Krag",
    "lemat-mark-ii": "Weapons/LeMat",
    "martini-henry-ic1": "Weapons/Martini-Henry",
    "mosin-nagant-avtomat": "Weapons/Mosin-Nagant/Avtomat",
    "mosin-nagant-m1891": "Weapons/Mosin-Nagant",
    "nagant-officer-carbine": "Weapons/Officer/Carbine",
    "scottfield-model-3": "Weapons/Scottfield",
    "sparks-lrr": "Weapons/Sparks",
    "sparks-pistol": "Weapons/Sparks/Pistol",
    "vetterli-71-karabiner": "Weapons/Vetterli_71",
    "winfield-1876-centennial": "Weapons/Centennial",
    // Not a duplicate: this IS the live weapon the wiki now calls "Ranger 73". It was mapped to
    // null until the wiki audit, on the mistaken belief that a separate "Ranger 73" catalog row
    // covered it — there is no such row, so the only entry for this weapon was being skipped
    // outright. Per ADR-0005 the id stays `winfield-m1873`; only the display name is stale.
    "winfield-m1873": "Weapons/Ranger_73",
    // Genuine duplicate — see KNOWN_CATALOG_DUPLICATES.
    "winfield-m1873c": null,
  },
  tools: {
    // The wiki files the Katana under Weapons even though the catalog treats it as a Tool.
    katana: "Weapons/Katana",
    // The wiki pluralizes the placeable trap pages; the catalog uses the singular in-game label.
    "alert-trip-mine": "Tools/Alert_Trip_Mines",
    "concertina-trip-mine": "Tools/Concertina_Trip_Mines",
    "poison-trip-mine": "Tools/Poison_Trip_Mines",
  },
  traits: {},
  consumables: {
    // Duplicate of the TOOLS entry "Choke Bombs" — see KNOWN_CATALOG_DUPLICATES.
    "choke-bomb": null,
  },
};

/**
 * Catalog entries that have no wiki page of their own because they duplicate another entry.
 * These are skipped deliberately (no request spent, not counted as failures) and reported in the
 * run summary so the duplication stays visible rather than looking like a scrape bug.
 *
 * Keyed by catalog id, for the same reason WIKI_TITLE_OVERRIDES is.
 *
 * These rows cannot simply be deleted from catalog.js: loadoutCodec.js's legacy (pre-versioning)
 * decoder resolves weapons by raw array position, so removing a row shifts every later weapon
 * and silently remaps old saved loadouts to the wrong items. Retiring one needs the same
 * treatment the Choke/Stalker Beetle tool slots got — an explicit legacy-index carve-out — not
 * a splice.
 */
export const KNOWN_CATALOG_DUPLICATES = {
  "winfield-m1873c":
    'stale pre-1896 name; duplicates the "Frontier 73C" entry, which is already in the catalog ' +
    "and maps to Weapons/Frontier_73C",
  "choke-bomb": 'duplicates the TOOLS entry "Choke Bombs", which maps to Tools/Choke_Bombs',
};

/**
 * Resolve a catalog item to its wiki page path (relative to /wiki/, category segment included),
 * or null when the item is a known duplicate with no page of its own.
 *
 * `id` selects the override; `name` only feeds the default namespaced path. Passing an id with
 * no override (or no id at all) falls back to the display name, which is correct for the
 * majority of the catalog.
 */
export function resolveWikiPath(category, id, name) {
  const overrides = WIKI_TITLE_OVERRIDES[category];
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, id)) {
    return overrides[id];
  }
  const namespace = WIKI_CATEGORY[category];
  if (!namespace) return null;
  return `${namespace}/${name.trim().replace(/\s+/g, "_")}`;
}

export function collectCatalogItems(categories = CATEGORIES) {
  const items = [];
  for (const category of categories) {
    const rows = CATEGORY_SOURCES[category];
    if (!rows) continue;
    for (const row of rows) {
      // Catalog tuples are id-first ([id, name, ...]) since the stable-id refactor. The id
      // selects any wiki-path override; the display name (row[1]) drives the default path and
      // the on-disk image slug.
      const id = row[0];
      const name = row[1];
      items.push({
        category,
        id,
        name,
        slug: slugify(name),
        wikiPath: resolveWikiPath(category, id, name),
      });
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

/**
 * Collect the rules that apply to `userAgent`, merging EVERY matching group rather than taking
 * the first.
 *
 * The strict reading of the standard is "one group wins", but real files routinely split the same
 * agent across several blocks — huntshowdown.wiki.gg publishes a Cloudflare-managed `User-agent: *`
 * block containing only `Allow: /`, followed by wiki.gg's own `User-agent: *` block with ~99
 * Disallow rules. Taking the first match would silently discard the second block and let us fetch
 * paths the site explicitly disallows (e.g. /wiki/File:, /wiki/Special:). Merging fails closed.
 */
function selectRobotsRules(groups, userAgent) {
  const uaLower = userAgent.toLowerCase();
  const specific = groups.filter((g) => g.userAgents.some((a) => a !== "*" && uaLower.includes(a.toLowerCase())));
  const matched = specific.length > 0 ? specific : groups.filter((g) => g.userAgents.includes("*"));
  return matched.flatMap((g) => g.rules);
}

/** Longest-matching-prefix rule, ties broken in favor of Allow (standard robots.txt semantics). */
export function isAllowedByRobots(groups, userAgent, pathToCheck) {
  const rules = selectRobotsRules(groups, userAgent);
  if (rules.length === 0) return true;

  let winner = null;
  for (const rule of rules) {
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

/**
 * Build the wiki URL for a page path produced by resolveWikiPath (e.g. "Weapons/Sparks/Pistol").
 *
 * Each path segment is encoded independently: encodeURIComponent over the whole path would turn
 * the namespace and variant separators into %2F and 404 every namespaced page.
 */
export function buildItemPageUrl(wikiPath) {
  const encoded = wikiPath
    .split("/")
    .map((segment) => encodeURIComponent(segment.trim().replace(/\s+/g, "_")))
    .join("/");
  return `${WIKI_ORIGIN}/wiki/${encoded}`;
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
