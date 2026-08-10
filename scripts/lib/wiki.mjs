// Governing: ADR-0005 (Scrape Item Stats and Descriptions into a Generated Data File — "two scripts,
// one shared wiki client"), ADR-0007 (Hunter Roster Dataset — extends ADR-0005 and consumes this same
// module), ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Implements: SPEC-0001 REQ "Ethical, Self-Hosted Image Sourcing", SPEC-0001 REQ "Error Handling
// Standards". This module is payload-agnostic — those requirements bind every consumer of it, not
// just the image scrape.
//
// scripts/lib/wiki.mjs
//
// The shared wiki client. Every piece in this file is something more than one scrape script needs and
// that must not diverge between them: slug derivation, robots.txt fetching and evaluation, the rate
// limiter, the user agent, the sentinel error classes, and the catalog -> scrape-target resolution.
//
// ADR-0005 calls this extraction "a prerequisite, not a follow-up" for exactly one reason: slugify()
// is a hard contract with the on-disk image path (client/public/images/{category}/{slug}.{ext}) and
// with ItemThumb's URL derivation. Two copies drift, and the failure mode is images silently not
// resolving. The same argument covers robots handling and the rate limiter, where a second copy would
// mean a second script quietly scraping on terms the first one honors.
//
// This module is import-only — it has no CLI entrypoint and performs no I/O on import. Consumers
// today: scripts/scrape-images.mjs. Consumers planned: scripts/scrape-stats.mjs (ADR-0005) and
// scripts/scrape-hunters.mjs (ADR-0007, whose confirmation criteria require it to import slug
// derivation, robots handling, rate limiting, the user agent, and the sentinel errors from here).
//
// Note on USER_AGENT: the string still describes itself as an image scrape, which is accurate for
// today's only consumer. It is deliberately left as-is here so this extraction stays byte-for-byte
// behaviour-preserving; generalize it when the second consumer lands, since the wiki sees it on
// every request either script makes.
//
// Note for future work: ADR-0005's out-of-scope section anticipates a revision-history-driven
// refresh built on MediaWiki's API rather than HTML page fetches. Nothing here assumes HTML scraping
// is the only access mode — the robots, rate-limit, and user-agent pieces apply to either.

import { WEAPONS, TOOLS, TRAITS, CONS } from "../../client/src/data/catalog.js";

export const WIKI_ORIGIN = "https://huntshowdown.wiki.gg";
export const DEFAULT_DELAY_MS = 1500;
export const USER_AGENT =
  "TheOutfitterScrapeBot/1.0 (+https://github.com/jonstump/the-outfitter; contact: jmstump@gmail.com; " +
  "one-time offline catalog image scrape per ADR-0002, not a crawler)";

// ---------------------------------------------------------------------------
// Sentinel errors (SPEC-0001 "Error Handling Standards": domain-specific failure modes the
// scrape scripts need to distinguish programmatically, e.g. "item page not found" vs. "image
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
//
// This is the single definition in the repo, by ADR-0005's confirmation criterion: grepping scripts/
// for a second definition of it must return nothing.
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
// Catalog display name -> wiki page path.
//
// The wiki namespaces every item page under its category ("/wiki/Weapons/Nagant_M1895", not
// "/wiki/Nagant_M1895"), so the default resolution is `${WIKI_CATEGORY[category]}/${title}`.
//
// Two things break that default and need the override table below:
//
//   1. Hunt's Update 2.0 ("1896") renamed most branded weapons — the catalog still carries a
//      number of pre-rename display names ("Sparks LRR", "Caldwell Pax") while the wiki moved to
//      the post-rename titles ("Sparks", "Pax"). Weapon *variants* also live on subpages
//      ("Sparks/Pistol", "Mosin-Nagant/Avtomat"), which the flat display name can't express.
//   2. A few catalog items sit under a different wiki category than the catalog's own — the
//      Katana is a Tool here but a Weapon on the wiki.
//
// Values are paths relative to /wiki/ and INCLUDE the category segment, precisely so a cross-
// category item can be expressed. A `null` value means "deliberately has no wiki page" — see
// KNOWN_CATALOG_DUPLICATES below; those items are skipped without spending a request.
//
// Verified against the wiki's own sitemap (sitemap-huntshowdown_en-NS_0), not by probing URLs one
// at a time. When a DLC ships or the catalog changes, re-verify the same way: pull the sitemap
// index at /sitemaps/sitemap-index-huntshowdown_en.xml, expand the NS_0 gzip, and diff the
// resolved paths against it — two requests instead of one per item. Note the sitemap lags live
// edits by months, so treat "absent from the sitemap" as "check this one by hand", not "gone".
// ---------------------------------------------------------------------------

export const WIKI_TITLE_OVERRIDES = {
  weapons: {
    "Caldwell Conversion Pistol": "Weapons/Conversion",
    "Caldwell Conversion Uppercut": "Weapons/Uppercut",
    "Caldwell Pax": "Weapons/Pax",
    "Caldwell Rival 78": "Weapons/Rival_78",
    "Crown & King Auto-5": "Weapons/Auto-5",
    "Krag M1894": "Weapons/Krag",
    "LeMat Mark II": "Weapons/LeMat",
    "Martini-Henry IC1": "Weapons/Martini-Henry",
    "Mosin-Nagant Avtomat": "Weapons/Mosin-Nagant/Avtomat",
    "Mosin-Nagant M1891": "Weapons/Mosin-Nagant",
    "Nagant Officer Carbine": "Weapons/Officer/Carbine",
    "Scottfield Model 3": "Weapons/Scottfield",
    "Sparks LRR": "Weapons/Sparks",
    "Sparks Pistol": "Weapons/Sparks/Pistol",
    "Vetterli 71 Karabiner": "Weapons/Vetterli_71",
    "Winfield 1876 Centennial": "Weapons/Centennial",
    // Stale pre-rename duplicates — see KNOWN_CATALOG_DUPLICATES.
    "Winfield M1873": null,
    "Winfield M1873C": null,
  },
  tools: {
    // The wiki files the Katana under Weapons even though the catalog treats it as a Tool.
    Katana: "Weapons/Katana",
    // The wiki pluralizes the placeable trap pages; the catalog uses the singular in-game label.
    "Alert Trip Mine": "Tools/Alert_Trip_Mines",
    "Concertina Trip Mine": "Tools/Concertina_Trip_Mines",
    "Poison Trip Mine": "Tools/Poison_Trip_Mines",
  },
  traits: {},
  consumables: {
    // Duplicate of the TOOLS entry "Choke Bombs" — see KNOWN_CATALOG_DUPLICATES.
    "Choke Bomb": null,
  },
};

/**
 * Catalog entries that have no wiki page of their own because they duplicate another entry.
 * These are skipped deliberately (no request spent, not counted as failures) and reported in the
 * run summary so the duplication stays visible rather than looking like a scrape bug.
 */
export const KNOWN_CATALOG_DUPLICATES = {
  "Winfield M1873": 'stale pre-1896 name; the post-rename entry "Ranger 73" covers this weapon',
  "Winfield M1873C": 'stale pre-1896 name; the post-rename entry "Frontier 73C" is already in the catalog',
  "Choke Bomb": 'duplicates the TOOLS entry "Choke Bombs", which maps to Tools/Choke_Bombs',
};

/**
 * Resolve a catalog item to its wiki page path (relative to /wiki/, category segment included),
 * or null when the item is a known duplicate with no page of its own.
 */
export function resolveWikiPath(category, name) {
  const overrides = WIKI_TITLE_OVERRIDES[category];
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, name)) {
    return overrides[name];
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
      // Catalog tuples are id-first ([id, name, ...]) since the stable-id
      // refactor; the display name (row[1]) drives the wiki URL and slug.
      const name = row[1];
      items.push({ category, name, slug: slugify(name), wikiPath: resolveWikiPath(category, name) });
    }
  }
  return items;
}

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
