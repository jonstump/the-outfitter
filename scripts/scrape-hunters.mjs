#!/usr/bin/env node
// Governing: ADR-0007 (Scrape the Full Hunter Roster into a Generated Dataset with Two-Size
// Portraits), ADR-0005 (generated-committed data, revision provenance, shared wiki client),
// ADR-0002 (offline, self-hosted, ethical scrape)
// Implements: SPEC-0004 REQ "Offline, Human-Invoked Scrape", REQ "One Visit Per Hunter Page Yields
// Both Payloads", REQ "Generated, Committed Dataset File", REQ "Two Portrait Sizes Per Hunter",
// REQ "Portrait Payload Budget", REQ "Consumption Contract Compatibility", REQ "Names-Only Mode",
// REQ "Error Handling Standards", REQ "Image Processing Dependency Is Development-Only"
//
// scripts/scrape-hunters.mjs
//
// Offline, on-demand scrape of huntshowdown.wiki.gg for the hunter roster. Like scrape-images.mjs
// this is a standalone tool, NOT part of the app's runtime or build path. Invoke it deliberately:
//
//   node scripts/scrape-hunters.mjs [options]
//
//   --names-only        Write hunters.json only; touch nothing under client/public/images/hunters/.
//                       Runs without `sharp` installed (SPEC-0004 REQ "Names-Only Mode").
//   --delay-ms=1500     Minimum delay between requests to the wiki (default: 1500ms)
//   --force             Re-encode portraits that already exist on disk
//   --dry-run           Resolve the roster and check robots.txt, but fetch no hunter page and
//                       write no file
//   --limit=N           Stop after N hunter pages (development aid, not a production mode)
//   --out=PATH          Override the dataset path (defaults to client/src/data/hunters.json)
//
// ---------------------------------------------------------------------------------------------
// WHAT THE WIKI ACTUALLY SERVES
//
// design.md lists this as the open question most likely to force a spec revision: "a consistent
// infobox image, or something that varies by page?" The answer, established by inspecting the live
// site, is that hunter pages come in exactly two shapes, both driven by the DRUID infobox
// extension, and that a third source — the roster gallery — is authoritative for display names.
//
//   1. SINGLE-VARIANT pages (e.g. Hunters/Caitlyn_Hammond) carry one `druid-main-image` with a
//      `druid-main-image-caption` (the description) and a flat `druid-data-Source`.
//
//   2. MULTI-VARIANT pages (e.g. Hunters/The_Revenant, Hunters/Union_Suit) are tabbed. Every
//      per-variant value — portrait, caption, Source — is a `druid-toggleable-data` /
//      `druid-main-images-file` div keyed by `data-druid-tab-key="<variant>"`. A progression
//      hunter's Rookie/Survivor/Veteran are three tabs on one page.
//
// Three consequences shaped this parser, and each is a trap the obvious implementation falls into:
//
//   * og:image IS WRONG ON MULTI-VARIANT PAGES. scrape-images.mjs prefers og:image because for an
//     item page it is the stable, skin-independent location. Here it names only the *first* tab's
//     art: Hunters/Bad_Hand advertises `Hunter_The_Revenant.png`. Trusting it would silently give
//     several hundred hunters a sibling's face — a failure no test that only checks "an image was
//     written" would ever catch. og:image is therefore used ONLY as a last-resort fallback for a
//     single-variant page whose infobox could not be parsed.
//
//   * ROSTER LINKS ARE REDIRECT TITLES. /wiki/Hunters/Bad_Hand redirects to Hunters/The_Revenant.
//     The canonical title comes from `wgPageName` in the page's own RLCONF blob, never from the
//     URL we asked for.
//
//   * /wiki/File: IS ROBOTS-DISALLOWED. The infobox links its art as /wiki/File:Hunter_X.png, which
//     robots.txt forbids. The bytes live at /images/Hunter_X.png, which is allowed, so the direct
//     media URL is derived from the file name rather than by following the File: link.
//
// ENTRY GRANULARITY. One dataset entry per *variant*, which is what ADR-0007 and design.md assume
// ("three entries, which is what the wiki lists"). The roster gallery at /wiki/Hunters is fetched
// once and supplies the wiki's own qualified display name ("Union Suit: Red Drawers", where the tab
// key alone is just "Red Drawers"). Gallery entries and page variants are joined on the underlying
// image file name, which both sides expose and which survives display-name edits. Variants the
// gallery omits still make the dataset under a name constructed from the page title and tab key —
// the page, not the gallery, is authoritative for what exists.
//
// ID STABILITY. Ids derive from the portrait file name (`Hunter_Union_Suit_Red.png` ->
// `union-suit-red`), not from the display name, because SPEC-0004 requires a renamed hunter to keep
// its id and change only its `name`. A name-derived id would re-key on every rename and orphan the
// `hunterId` references SPEC-0003 stores in user data. Any existing hunters.json is additionally
// read back and its ids preserved by portrait join, so the guarantee holds even if a file is
// renamed on the wiki. Hunters with no portrait at all fall back to a name-derived id; that is the
// one case where a rename can re-key, and it is recorded in the run summary.
//
// Error handling (SPEC-0004 "Error Handling Standards") mirrors scrape-images.mjs: sentinel classes
// from the shared client, per-hunter try/catch so one failure never aborts the run, structured
// key-value logging, and a per-run summary of succeeded/failed/skipped with reasons.
//
// Shared wiki client (ADR-0005/ADR-0007): slug derivation, robots.txt fetching and evaluation, the
// rate limiter, the user agent, and the sentinel error classes are imported from scripts/lib/wiki.mjs
// and defined nowhere here.

import { mkdir, writeFile, readFile, access, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_DELAY_MS,
  ImageAssetNotFoundError,
  ItemPageNotFoundError,
  NetworkFailureError,
  RateLimiter,
  RobotsDisallowedError,
  ScrapeError,
  USER_AGENT,
  WIKI_ORIGIN,
  fetchRobotsTxt,
  isAllowedByRobots,
  slugify,
} from "./lib/wiki.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

export const HUNTERS_DATA_PATH = path.join(REPO_ROOT, "client", "src", "data", "hunters.json");
export const HUNTERS_IMAGES_ROOT = path.join(REPO_ROOT, "client", "public", "images", "hunters");

/** The roster index page. One fetch yields every hunter's page link and the wiki's own labels. */
export const ROSTER_PATH = "Hunters";

// ---------------------------------------------------------------------------
// Portrait sizing and budgets (SPEC-0004 REQ "Two Portrait Sizes Per Hunter", REQ "Portrait
// Payload Budget"). These are the numbers ADR-0007 deliberately left to the spec, so they live
// as named constants here rather than inline — moving one is a spec edit, not a code hunt.
// ---------------------------------------------------------------------------

export const PORTRAIT_SIZES = [
  { name: "thumb", width: 192, maxBytes: 15 * 1024 },
  { name: "full", width: 320, maxBytes: 25 * 1024 },
];

/** Total committed portrait payload ceiling, across every hunter and both sizes. */
export const TOTAL_BUDGET_BYTES = 12 * 1024 * 1024;

/**
 * AVIF quality.
 *
 * design.md leaves this open ("do the budgets survive contact with real art, and at what AVIF
 * quality setting?"). Measured against a real portrait (Hunter_The_Revenant.png, 384×256 PNG,
 * 58 KB) the answer is that the budgets are not close to binding:
 *
 *   q=40  192px 2.4 KB   320px 4.1 KB
 *   q=70  192px 4.6 KB   320px 8.8 KB     <- chosen
 *   q=80  192px 5.4 KB   320px 10.8 KB
 *
 * against per-asset budgets of 15 KB and 25 KB. 70 buys visibly better fidelity than the quality
 * a bytes-first choice would pick while still leaving roughly 3× headroom on every asset, so a
 * busier-than-average portrait has room to be larger without failing its hunter.
 */
export const AVIF_QUALITY = 70;

// ---------------------------------------------------------------------------
// Sentinel errors specific to this payload. The shared client owns the ones every scrape needs;
// SPEC-0004 adds "budget exceeded" to the list of modes callers must tell apart.
// ---------------------------------------------------------------------------

/** A generated asset exceeded its per-asset budget, or the run would exceed the total ceiling. */
export class BudgetExceededError extends ScrapeError {}

/** The image-processing library is required for this mode but could not be loaded. */
export class ImageProcessingUnavailableError extends ScrapeError {}

// ---------------------------------------------------------------------------
// Parsing helpers.
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

/**
 * Decode the HTML entities MediaWiki actually emits.
 *
 * Non-breaking spaces are folded to ordinary ones. The wiki writes `Source: The Revenant&#160;DLC`,
 * and a U+00A0 surviving into `source` would make the stored string compare unequal to the visually
 * identical text anyone would type when checking or correcting a mapping.
 */
export function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hx) => String.fromCodePoint(parseInt(hx, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : whole;
    })
    .replace(/ /g, " ");
}

/**
 * Strip tags and normalise whitespace — the text a reader would see.
 *
 * Meaningful `alt` text is kept, because on this wiki an icon is sometimes the only place a value
 * is stated. `Source` for a Blood Bonds hunter is literally `900 <img alt="Blood Bonds">`: drop the
 * alt and the field reads "900", which is not merely lossy but unclassifiable — 24% of the roster
 * landed with `acquisition: null` before this.
 *
 * Filename-shaped alts are excluded. MediaWiki gives `/wiki/File:`-linked images an alt of the raw
 * file name ("Event Icon Harvest of Ghosts.png"), which is markup noise rather than content, and
 * splicing it in would corrupt the verbatim `source` this dataset is supposed to preserve.
 */
export function stripTags(html) {
  const withAltText = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = tag.match(/\balt="([^"]*)"/i) || tag.match(/\balt='([^']*)'/i);
    if (!alt) return " ";
    const text = alt[1].trim();
    if (!text || /\.(png|jpe?g|gif|svg|webp|avif)$/i.test(text)) return " ";
    return ` ${text} `;
  });

  return decodeEntities(withAltText.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull a value out of the page's RLCONF blob.
 *
 * This is where the canonical page title and the current revision id live. Reading them from
 * RLCONF rather than from the URL is what makes redirects (Hunters/Bad_Hand -> Hunters/The_Revenant)
 * resolve to one identity instead of two.
 */
export function readRlconf(html, key) {
  const numeric = html.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
  if (numeric) return Number(numeric[1]);
  const str = html.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (str) return decodeEntities(str[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  return null;
}

/** The wiki namespaces hunter pages under "Hunters/"; the display title drops that segment. */
export function pageTitleToDisplay(pageTitle) {
  const withoutNamespace = String(pageTitle || "").replace(/^Hunters\//, "");
  return withoutNamespace.replace(/_/g, " ").trim();
}

/**
 * Derive the portrait slug from the wiki's image file name.
 *
 * "Hunter_Union_Suit_Red.png" -> "union-suit-red". The "Hunter_" prefix is uniform across the
 * roster and carries no information; dropping it keeps the on-disk names readable. slugify() is
 * the shared derivation, so the asset path stays on the same contract every other image obeys.
 */
export function portraitSlugFromFile(fileName) {
  if (!fileName) return null;
  const base = String(fileName)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/^Hunter[_ ]/i, "")
    .replace(/_/g, " ");
  const slug = slugify(decodeEntities(base));
  return slug || null;
}

/** The wiki serves original media at /images/<File_Name>; /wiki/File: is robots-disallowed. */
export function buildMediaUrl(fileName) {
  return `${WIKI_ORIGIN}/images/${encodeURIComponent(String(fileName).replace(/ /g, "_"))}`;
}

export function buildWikiPageUrl(wikiPath) {
  const encoded = String(wikiPath)
    .split("/")
    .map((segment) => encodeURIComponent(segment.trim().replace(/\s+/g, "_")))
    .join("/");
  return `${WIKI_ORIGIN}/wiki/${encoded}`;
}

// ---------------------------------------------------------------------------
// Roster page parsing.
// ---------------------------------------------------------------------------

/**
 * Parse the roster gallery at /wiki/Hunters.
 *
 * Returns one record per gallery box that names a hunter page: { label, wikiPath, file }. Boxes
 * that link a bare File: (the four generic free-hunter portraits, which have no page and no name)
 * are deliberately dropped — they are art, not selectable identities.
 *
 * `label` is the wiki's own qualified display name and is preferred over anything this script
 * could construct; `file` is the join key to a page variant.
 */
export function parseRoster(html) {
  const entries = [];
  const seen = new Set();
  const boxes = html.match(/<li class="gallerybox"[\s\S]*?<\/li>/g) || [];

  for (const box of boxes) {
    const link = box.match(/<div class="gallerytext">[\s\S]*?<a href="\/wiki\/([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;

    const wikiPath = decodeURIComponent(link[1]);
    if (!/^Hunters\//.test(wikiPath)) continue;

    const label = stripTags(link[2]);
    if (!label) continue;

    const img = box.match(/<img[^>]+src="\/images\/thumb\/([^/"]+)\//) || box.match(/<img[^>]+src="\/images\/([^/"?]+)/);
    const file = img ? decodeURIComponent(img[1]) : null;

    const key = `${wikiPath} ${label}`;
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({ label, wikiPath, file });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Hunter page parsing — the DRUID infobox, in both of its shapes.
// ---------------------------------------------------------------------------

/** Isolate the infobox so page-body galleries and "Related Skins" art can never be mistaken for it. */
function extractInfobox(html) {
  const start = html.search(/<div class="druid-infobox[^"]*"/);
  if (start === -1) return null;
  const end = html.indexOf('<div id="toc"', start);
  const printFooter = html.indexOf("printfooter", start);
  const stop = [end, printFooter, html.length].filter((n) => n > 0).sort((a, b) => a - b)[0];
  return html.slice(start, stop);
}

/** Collect `data-druid-tab-key`-keyed values from a container, in document order. */
function collectTabbed(container, pattern) {
  const out = [];
  const re = new RegExp(pattern, "g");
  let m;
  while ((m = re.exec(container)) !== null) out.push(m);
  return out;
}

/**
 * Read a caption out of a variant segment.
 *
 * The closing `</div>` is optional on purpose. Segments are cut at the next sibling marker, and
 * because the caption is the last element in a segment, that cut consumes its closing tag — a
 * regex requiring `</div>` silently returns null for the LAST variant on every page, which is the
 * kind of off-by-one that produces a dataset that looks fine until you read the final row.
 */
function extractCaption(segment, className) {
  const m = segment.match(new RegExp(`<div class="${className}">([\\s\\S]*?)(?:</div>|$)`));
  return m ? stripTags(m[1]) || null : null;
}

/**
 * Extract every variant a hunter page defines.
 *
 * Returns [{ tabKey, file, description }] — one record per variant, in the order the wiki lists
 * them. A single-variant page yields exactly one record with `tabKey` null.
 */
export function parseVariants(html) {
  const box = extractInfobox(html);
  if (!box) return [];

  // Shape 2: tabbed. Each variant's art and caption live in one druid-main-images-file div.
  const files = collectTabbed(
    box,
    '<div class="druid-main-images-file[^"]*"[^>]*data-druid-tab-key="([^"]*)"[^>]*>([\\s\\S]*?)(?=<div class="druid-main-images-file|<\\/div>\\s*<\\/div>\\s*<\\/div>)'
  );
  if (files.length > 0) {
    return files.map((m) => {
      const tabKey = decodeEntities(m[1]).trim();
      const segment = m[2];
      const fileMatch =
        segment.match(/href="\/wiki\/File:([^"?#]+)"/) ||
        segment.match(/<img[^>]+src="\/images\/thumb\/([^/"]+)\//);
      return {
        tabKey,
        file: fileMatch ? decodeURIComponent(fileMatch[1]) : null,
        description: extractCaption(segment, "druid-main-images-caption"),
      };
    });
  }

  // Shape 1: single. One druid-main-image, no tab keys anywhere.
  const single = box.match(/<div class="druid-main-image">([\s\S]*?)<\/div>\s*<\/div>/);
  if (single) {
    const segment = single[1];
    const fileMatch =
      segment.match(/href="\/wiki\/File:([^"?#]+)"/) ||
      segment.match(/<img[^>]+src="\/images\/thumb\/([^/"]+)\//);
    return [
      {
        tabKey: null,
        file: fileMatch ? decodeURIComponent(fileMatch[1]) : null,
        description: extractCaption(segment, "druid-main-image-caption"),
      },
    ];
  }

  // An infobox with no art at all still defines a hunter — SPEC-0004 requires it to reach the
  // dataset so the picker can list it.
  return [{ tabKey: null, file: null, description: null }];
}

/**
 * Extract the infobox's `Source` row as a tabKey -> verbatim string map.
 *
 * The `null` key carries a single-variant page's flat value. A page with no Source row at all
 * (Hunters/Union_Suit has none) yields an empty map, which SPEC-0004 requires to produce
 * `source: null, acquisition: null` rather than dropping the hunter.
 */
export function parseSources(html) {
  const box = extractInfobox(html);
  if (!box) return {};

  const rowStart = box.search(/<div class="druid-row druid-row-Source"/);
  if (rowStart === -1) return {};
  const rest = box.slice(rowStart);
  const rowEnd = rest.search(/<div class="druid-row druid-row-(?!Source)/);
  const row = rowEnd === -1 ? rest : rest.slice(0, rowEnd);

  const sources = {};
  const tabbed = collectTabbed(
    row,
    '<div class="druid-toggleable-data[^"]*"[^>]*data-druid-tab-key="([^"]*)"[^>]*>([\\s\\S]*?)(?=<div class="druid-toggleable-data|<\\/div>\\s*<\\/div>)'
  );
  if (tabbed.length > 0) {
    for (const m of tabbed) {
      const value = stripTags(m[2]);
      if (value) sources[decodeEntities(m[1]).trim()] = value;
    }
    return sources;
  }

  const flat = row.match(/<div class="druid-data[^"]*">([\s\S]*?)<\/div>\s*<\/div>/);
  const value = flat ? stripTags(flat[1]) : "";
  if (value) sources[""] = value;
  return sources;
}

// ---------------------------------------------------------------------------
// Acquisition normalisation (SPEC-0004 REQ "Generated, Committed Dataset File").
//
// `source` is what the wiki asserts and cannot be wrong; `acquisition` is derived and can be.
// Storing both means a miscategorisation is fixed by re-deriving from disk rather than by
// re-scraping every page — which is why the rules live here as data and the raw string is kept.
//
// Order matters: the first matching rule wins, so the specific patterns precede the general ones
// ("Soul Survivor" before the bare event match, "Dark Tribute" before "Tribute").
// ---------------------------------------------------------------------------

export const ACQUISITION_RULES = [
  [/\bsoul\s*survivor\b/i, "soul-survivor"],
  [/\bdark\s*tribute\b/i, "dark-tribute"],
  [/\bblood\s*bonds?\b/i, "blood-bonds"],
  [/\bhunt\s*dollars?\b/i, "hunt-dollars"],
  [/\btwitch\b/i, "twitch-drop"],
  [/\bmythic\b/i, "mythic"],
  [/\bprestige\b/i, "prestige"],
  [/\bbloodline\b/i, "bloodline"],
  // "Halloween Questline", "Vengeance of the Skinned Questline" — the wiki's own wording for what
  // SPEC-0004 calls a story challenge.
  [/\bstory\b|\bchallenge\b|\bquestline\b/i, "story-challenge"],
  [/\bdlc\b/i, "dlc"],
  [/\bevent\b/i, "event"],
  [/\bprogression\b/i, "progression"],
  [/\bfree\b/i, "free"],
];

/** Map a verbatim `Source` string onto SPEC-0004's closed acquisition vocabulary, or null. */
export function normaliseAcquisition(source) {
  if (!source) return null;
  for (const [pattern, value] of ACQUISITION_RULES) {
    if (pattern.test(source)) return value;
  }
  return null;
}

/**
 * Whether the hunter can still be acquired.
 *
 * SPEC-0004 keeps this separate from `acquisition` because "how was this obtained" and "can I
 * still get it" are different questions. The wiki publishes no explicit field for it, so it is
 * derived: mythic hunters are permanently unobtainable; everything with a recognised acquisition
 * is assumed obtainable; an unparseable Source yields null rather than a guess, so the picker can
 * tell "known to be available" from "unknown".
 */
export function deriveObtainable(acquisition) {
  if (acquisition === null) return null;
  if (acquisition === "mythic") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Structured logging + per-run summary (SPEC-0004 "Error Handling Standards").
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

export function formatSummary(summary, extra = {}) {
  const lines = [
    `scrape-hunters summary: ${summary.succeeded.length} succeeded, ${summary.failed.length} failed, ${summary.skipped.length} skipped`,
  ];
  if (extra.entries !== undefined) lines.push(`  dataset entries: ${extra.entries}`);
  if (extra.assetBytes !== undefined) {
    lines.push(
      `  portrait payload: ${(extra.assetBytes / 1024 / 1024).toFixed(2)} MB of ${(TOTAL_BUDGET_BYTES / 1024 / 1024).toFixed(0)} MB budget`
    );
  }
  if (extra.unmappedSources?.length) {
    lines.push(`  UNMAPPED Source values (acquisition=null), ${extra.unmappedSources.length} distinct:`);
    for (const s of extra.unmappedSources) lines.push(`    - ${s}`);
  }
  for (const f of summary.failed) lines.push(`  FAILED  ${f.hunter}: ${f.reason}`);
  for (const s of summary.skipped) lines.push(`  SKIPPED ${s.hunter}: ${s.reason}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Image processing. Imported lazily and only when portraits are actually being produced, so
// names-only mode runs on a machine where `sharp` cannot be installed (SPEC-0004 REQ "Image
// Processing Dependency Is Development-Only").
// ---------------------------------------------------------------------------

export async function loadImageProcessor(importFn = (m) => import(m)) {
  try {
    const mod = await importFn("sharp");
    return mod.default ?? mod;
  } catch (err) {
    throw new ImageProcessingUnavailableError(
      `sharp is required for portrait processing but could not be loaded: ${err.message}. ` +
        `Run with --names-only to produce the dataset without portraits.`,
      { cause: err }
    );
  }
}

/**
 * Encode both portrait sizes from one source buffer.
 *
 * Returns [{ name, width, bytes, buffer }]. Throws BudgetExceededError if either size lands over
 * its per-asset budget — SPEC-0004 requires the oversized file NOT to be written, so the budget is
 * checked before anything reaches disk. A source narrower than a target width is re-encoded at its
 * native width rather than upscaled.
 */
export async function encodePortraits(sourceBuffer, sharp, { hunter, url, quality = AVIF_QUALITY } = {}) {
  const meta = await sharp(sourceBuffer).metadata();
  const sourceWidth = meta.width || 0;
  const encoded = [];

  for (const size of PORTRAIT_SIZES) {
    const targetWidth = sourceWidth > 0 ? Math.min(size.width, sourceWidth) : size.width;
    const buffer = await sharp(sourceBuffer)
      .resize({ width: targetWidth, withoutEnlargement: true })
      .avif({ quality })
      .toBuffer();

    if (buffer.length > size.maxBytes) {
      throw new BudgetExceededError(
        `portrait "${size.name}" for "${hunter}" is ${buffer.length} bytes, over the ${size.maxBytes}-byte budget`,
        { item: hunter, url }
      );
    }
    encoded.push({ name: size.name, width: targetWidth, bytes: buffer.length, buffer });
  }

  return encoded;
}

/** Asset path for a portrait slug and size — derivable by consumers without a manifest. */
export function portraitAssetPath(imagesRoot, slug, sizeName) {
  return path.join(imagesRoot, sizeName === "full" ? `${slug}.avif` : `${slug}-${sizeName}.avif`);
}

// ---------------------------------------------------------------------------
// Per-hunter scrape. One page fetch yields every variant's dataset row and portrait.
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
 * Fetch, encode and write one variant's two portrait sizes.
 *
 * All-or-nothing on disk. `encodePortraits` encodes and budget-checks both sizes before either is
 * written, and if the second write fails the first is removed again — so a variant never leaves a
 * half-written pair behind. Callers isolate this per variant so one variant's failure cannot
 * discard a sibling's work.
 *
 * Returns { assets, bytes, skipped }. Throws a sentinel with hunter/url context on failure.
 */
export async function producePortrait({ variant, name, portrait }, deps) {
  const {
    fetchFn,
    rateLimiter,
    robotsGroups,
    userAgent = USER_AGENT,
    imagesRoot = HUNTERS_IMAGES_ROOT,
    fsMkdir = mkdir,
    fsWriteFile = writeFile,
    fsAccess = access,
    fsUnlink = unlink,
    sharp = null,
    force = false,
    log = logStructured,
  } = deps;

  const fullPath = portraitAssetPath(imagesRoot, portrait, "full");
  if (!force && (await pathExists(fsAccess, fullPath))) {
    log({ level: "info", event: "portrait-skipped", hunter: name, portrait, reason: "already on disk" });
    return { assets: [], bytes: 0, skipped: true };
  }

  const mediaUrl = buildMediaUrl(variant.file);
  const mediaPath = new URL(mediaUrl).pathname;
  if (!isAllowedByRobots(robotsGroups, userAgent, mediaPath)) {
    throw new RobotsDisallowedError(`robots.txt disallows fetching portrait for "${name}" at ${mediaPath}`, {
      item: name,
      url: mediaUrl,
    });
  }

  await rateLimiter.wait();

  let imageRes;
  try {
    imageRes = await fetchFn(mediaUrl, { headers: { "User-Agent": userAgent } });
  } catch (err) {
    throw new NetworkFailureError(`network failure fetching portrait for "${name}" at ${mediaUrl}: ${err.message}`, {
      cause: err,
      item: name,
      url: mediaUrl,
    });
  }
  if (!imageRes.ok) {
    if (imageRes.status === 404) {
      throw new ImageAssetNotFoundError(`portrait asset not found for "${name}": HTTP 404 at ${mediaUrl}`, {
        item: name,
        url: mediaUrl,
      });
    }
    throw new NetworkFailureError(`failed to fetch portrait for "${name}": HTTP ${imageRes.status} at ${mediaUrl}`, {
      item: name,
      url: mediaUrl,
    });
  }

  let sourceBuffer;
  try {
    sourceBuffer = Buffer.from(await imageRes.arrayBuffer());
  } catch (err) {
    throw new NetworkFailureError(`failed to read portrait bytes for "${name}" at ${mediaUrl}: ${err.message}`, {
      cause: err,
      item: name,
      url: mediaUrl,
    });
  }

  // Throws BudgetExceededError before returning, so an over-budget size never reaches disk.
  const encodedSizes = await encodePortraits(sourceBuffer, sharp, { hunter: name, url: mediaUrl });

  const assets = [];
  const written = [];
  let bytes = 0;

  try {
    await fsMkdir(imagesRoot, { recursive: true });
    for (const encoded of encodedSizes) {
      const destPath = portraitAssetPath(imagesRoot, portrait, encoded.name);
      await fsWriteFile(destPath, encoded.buffer);
      written.push(destPath);
      assets.push({ path: destPath, size: encoded.name, bytes: encoded.bytes });
      bytes += encoded.bytes;
    }
  } catch (err) {
    // Roll back this variant's partial pair; a lone thumbnail with no full size is exactly the
    // uncataloged orphan this function exists to prevent.
    await Promise.all(written.map((p) => Promise.resolve(fsUnlink(p)).catch(() => {})));
    throw new ScrapeError(`failed to write portrait for "${name}" to ${imagesRoot}: ${err.message}`, {
      cause: err,
      item: name,
      url: mediaUrl,
    });
  }

  return { assets, bytes, skipped: false };
}

/**
 * Scrape one hunter page.
 *
 * Returns { entries, assets, bytes, failures } where `entries` is one dataset row per variant that
 * succeeded. Page-level failures (fetch, 404) throw a sentinel and runScrape catches per page;
 * per-variant portrait failures are isolated and reported in `failures` without discarding the
 * variants that did succeed.
 */
export async function scrapeHunterPage(target, deps) {
  const {
    fetchFn,
    rateLimiter,
    robotsGroups,
    userAgent = USER_AGENT,
    imagesRoot = HUNTERS_IMAGES_ROOT,
    fsMkdir = mkdir,
    fsWriteFile = writeFile,
    fsAccess = access,
    fsUnlink = unlink,
    sharp = null,
    namesOnly = false,
    force = false,
    dryRun = false,
    ingestedAt,
    labelsByFile = new Map(),
    idsByPortrait = new Map(),
    seenCanonical = null,
    log = logStructured,
  } = deps;

  const { wikiPath } = target;
  const pageUrl = buildWikiPageUrl(wikiPath);
  const pagePath = new URL(pageUrl).pathname;

  if (!isAllowedByRobots(robotsGroups, userAgent, pagePath)) {
    throw new RobotsDisallowedError(`robots.txt disallows fetching hunter page at ${pagePath}`, {
      item: wikiPath,
      url: pageUrl,
    });
  }

  await rateLimiter.wait();

  let pageRes;
  try {
    pageRes = await fetchFn(pageUrl, { headers: { "User-Agent": userAgent } });
  } catch (err) {
    throw new NetworkFailureError(`network failure fetching hunter page "${wikiPath}" at ${pageUrl}: ${err.message}`, {
      cause: err,
      item: wikiPath,
      url: pageUrl,
    });
  }
  if (!pageRes.ok) {
    if (pageRes.status === 404) {
      throw new ItemPageNotFoundError(`hunter page not found for "${wikiPath}": HTTP 404 at ${pageUrl}`, {
        item: wikiPath,
        url: pageUrl,
      });
    }
    throw new NetworkFailureError(`failed to fetch hunter page for "${wikiPath}": HTTP ${pageRes.status} at ${pageUrl}`, {
      item: wikiPath,
      url: pageUrl,
    });
  }

  const html = await pageRes.text();

  // Canonical identity, not the URL we asked for: roster links are frequently redirects.
  const canonicalPage = readRlconf(html, "wgPageName") || wikiPath;
  const revision = readRlconf(html, "wgCurRevisionId") ?? readRlconf(html, "wgRevisionId");
  const pageTitle = pageTitleToDisplay(canonicalPage);

  // The roster gallery lists some hunters under BOTH a redirect title and their canonical one —
  // "Bad Hand" and "The Revenant" are two boxes resolving to one page. Deduping on the requested
  // path cannot catch that, because the two paths are genuinely different; only the canonical name
  // the page reports can. Without this, every such page emits its full variant set twice and the
  // dataset carries duplicate ids, which breaks the "a hunterId reference is unambiguous"
  // guarantee SPEC-0003 depends on.
  if (seenCanonical) {
    if (seenCanonical.has(canonicalPage)) {
      return { entries: [], assets: [], bytes: 0, failures: [], pageTitle, revision, canonicalPage, duplicate: true };
    }
    seenCanonical.add(canonicalPage);
  }

  const variants = parseVariants(html);
  const sources = parseSources(html);

  const entries = [];
  const assets = [];
  const failures = [];
  let bytes = 0;

  for (const variant of variants) {
    // The gallery's qualified label ("Union Suit: Red Drawers") beats anything constructible here.
    // Falling back: "<page title>: <tab key>", collapsing to the page title when the tab names the
    // page itself (Hunters/The_Revenant's first tab is "The Revenant").
    const galleryLabel = variant.file ? labelsByFile.get(variant.file) : null;
    const name =
      galleryLabel ||
      (variant.tabKey && variant.tabKey !== pageTitle ? `${pageTitle}: ${variant.tabKey}` : pageTitle);

    const portrait = portraitSlugFromFile(variant.file);
    const source = sources[variant.tabKey ?? ""] ?? sources[""] ?? null;
    const acquisition = normaliseAcquisition(source);

    // Portrait-derived id survives a display-name change; the name-derived fallback does not, and
    // only applies to hunters with no art at all.
    const derivedId = portrait || slugify(name);
    const id = (portrait && idsByPortrait.get(portrait)) || derivedId;

    const entry = {
      id,
      name,
      description: variant.description || null,
      portrait,
      source,
      acquisition,
      obtainable: deriveObtainable(acquisition),
      sourceRevision: revision === null ? null : String(revision),
      ingestedAt,
    };

    // No portrait work to do: the entry stands on its own. SPEC-0004 requires a hunter with no
    // usable portrait to appear in the dataset regardless, so this is a success, not a failure.
    if (namesOnly || dryRun || !variant.file || !portrait) {
      entries.push(entry);
      continue;
    }

    // Isolated per variant. A tabbed page holds several independent hunters, and one of them
    // busting its byte budget is no reason to discard the siblings that encoded cleanly — nor to
    // leave their already-written art on disk with no dataset row pointing at it, which is what
    // letting this throw out of the whole page used to do.
    try {
      const produced = await producePortrait(
        { variant, name, portrait },
        {
          fetchFn,
          rateLimiter,
          robotsGroups,
          userAgent,
          imagesRoot,
          fsMkdir,
          fsWriteFile,
          fsAccess,
          fsUnlink,
          sharp,
          force,
          log,
        }
      );
      assets.push(...produced.assets);
      bytes += produced.bytes;
      entries.push(entry);
    } catch (err) {
      // SPEC-0004: an over-budget asset "SHALL fail that hunter with a recorded reason rather than
      // being written". Failing the hunter means no dataset row — a row here would misrepresent a
      // budget failure as a hunter that merely has no art.
      failures.push({
        hunter: name,
        portrait,
        errorType: err.name,
        reason: err.message,
        url: err.url,
      });
      log({
        level: "error",
        event: "variant-failed",
        hunter: name,
        portrait,
        errorType: err.name,
        reason: err.message,
        url: err.url,
      });
    }
  }

  return { entries, assets, bytes, failures, pageTitle, revision, canonicalPage, duplicate: false };
}

// ---------------------------------------------------------------------------
// Run orchestration.
// ---------------------------------------------------------------------------

/** Read back an existing dataset so ids survive a wiki-side rename. Absent file is not an error. */
export async function readExistingIds(datasetPath, fsReadFile = readFile) {
  try {
    const raw = await fsReadFile(datasetPath, "utf8");
    const parsed = JSON.parse(raw);
    const map = new Map();
    for (const entry of Array.isArray(parsed) ? parsed : []) {
      if (entry?.portrait && entry?.id) map.set(entry.portrait, entry.id);
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function runScrape(options = {}, deps = {}) {
  const {
    delayMs = DEFAULT_DELAY_MS,
    namesOnly = false,
    force = false,
    dryRun = false,
    limit = Infinity,
    datasetPath = HUNTERS_DATA_PATH,
    imagesRoot = HUNTERS_IMAGES_ROOT,
    // Injectable so the ceiling can be exercised without a 12 MB fixture. The per-asset budgets
    // reject long before the total is reachable at real sizes, which is exactly why the total
    // needs its own test rather than being assumed to work.
    totalBudgetBytes = TOTAL_BUDGET_BYTES,
  } = options;
  const {
    fetchFn,
    userAgent = USER_AGENT,
    log = logStructured,
    fsWriteFile = writeFile,
    fsMkdir = mkdir,
    fsReadFile = readFile,
    sharpLoader = loadImageProcessor,
    now = () => new Date().toISOString(),
  } = deps;

  const summary = createSummary();
  const ingestedAt = now();

  // robots.txt is a run-level gate: unreadable means stop, never "assume permitted".
  let robotsGroups;
  try {
    robotsGroups = await fetchRobotsTxt(fetchFn, userAgent);
  } catch (err) {
    log({ level: "error", event: "robots-fetch-failed", reason: err.message });
    throw err;
  }

  const rateLimiter = new RateLimiter(delayMs, deps.rateLimiterOptions);

  // sharp is loaded once, up front, and only when portraits are actually being produced — a
  // missing native dependency should fail before 200 pages are fetched, not after.
  let sharp = null;
  if (!namesOnly && !dryRun) sharp = await sharpLoader();

  // One fetch for the whole roster.
  const rosterUrl = buildWikiPageUrl(ROSTER_PATH);
  if (!isAllowedByRobots(robotsGroups, userAgent, new URL(rosterUrl).pathname)) {
    throw new RobotsDisallowedError(`robots.txt disallows fetching the roster at ${rosterUrl}`, { url: rosterUrl });
  }
  await rateLimiter.wait();
  let rosterRes;
  try {
    rosterRes = await fetchFn(rosterUrl, { headers: { "User-Agent": userAgent } });
  } catch (err) {
    throw new NetworkFailureError(`network failure fetching roster at ${rosterUrl}: ${err.message}`, {
      cause: err,
      url: rosterUrl,
    });
  }
  if (!rosterRes.ok) {
    throw new NetworkFailureError(`failed to fetch roster: HTTP ${rosterRes.status} at ${rosterUrl}`, { url: rosterUrl });
  }
  const rosterEntries = parseRoster(await rosterRes.text());

  const labelsByFile = new Map();
  for (const entry of rosterEntries) {
    if (entry.file && !labelsByFile.has(entry.file)) labelsByFile.set(entry.file, entry.label);
  }

  const pages = [...new Set(rosterEntries.map((e) => e.wikiPath))].slice(0, limit);
  log({
    level: "info",
    event: "roster-parsed",
    galleryEntries: rosterEntries.length,
    distinctPages: pages.length,
    url: rosterUrl,
  });

  const idsByPortrait = await readExistingIds(datasetPath, fsReadFile);

  const allEntries = [];
  const unmappedSources = new Set();
  const seenCanonical = new Set();
  let totalBytes = 0;

  for (const wikiPath of pages) {
    try {
      const result = await scrapeHunterPage(
        { wikiPath },
        {
          fetchFn,
          rateLimiter,
          robotsGroups,
          userAgent,
          imagesRoot,
          fsMkdir,
          fsWriteFile,
          fsAccess: deps.fsAccess,
          fsUnlink: deps.fsUnlink,
          sharp,
          namesOnly,
          force,
          dryRun,
          ingestedAt,
          labelsByFile,
          idsByPortrait,
          seenCanonical,
          log,
        }
      );

      if (result.duplicate) {
        recordResult(summary, {
          status: "skipped",
          hunter: result.pageTitle || wikiPath,
          wikiPath,
          reason: `redirects to "${result.canonicalPage}", already scraped`,
        });
        log({ level: "info", event: "page-duplicate", hunter: wikiPath, canonical: result.canonicalPage });
        continue;
      }

      for (const entry of result.entries) {
        allEntries.push(entry);
        if (entry.source && entry.acquisition === null) unmappedSources.add(entry.source);
      }

      // Variants that failed their portrait stage are individually failed hunters, not a failed
      // page — the page itself parsed, and its other variants are in the dataset.
      for (const failure of result.failures ?? []) {
        recordResult(summary, { status: "failed", wikiPath, ...failure });
      }

      totalBytes += result.bytes;

      // The total ceiling is checked as the run proceeds so it fails before committing a set that
      // breaches it, rather than after every page has been fetched.
      if (!namesOnly && !dryRun && totalBytes > totalBudgetBytes) {
        throw new BudgetExceededError(
          `portrait payload reached ${totalBytes} bytes, over the ${totalBudgetBytes}-byte total ceiling`,
          { item: wikiPath }
        );
      }

      recordResult(summary, {
        status: "succeeded",
        hunter: result.pageTitle || wikiPath,
        wikiPath,
        variants: result.entries.length,
        assets: result.assets.length,
      });
      log({
        level: "info",
        event: "page-succeeded",
        hunter: result.pageTitle || wikiPath,
        variants: result.entries.length,
        assets: result.assets.length,
        revision: result.revision,
      });
    } catch (err) {
      // A breached total ceiling is a run-level failure, not a per-page one: continuing would
      // write more of exactly the thing the budget forbids.
      if (err instanceof BudgetExceededError && /total ceiling/.test(err.message)) {
        log({ level: "error", event: "total-budget-exceeded", reason: err.message });
        throw err;
      }
      recordResult(summary, {
        status: "failed",
        hunter: wikiPath,
        wikiPath,
        errorType: err.name,
        reason: err.message,
      });
      log({
        level: "error",
        event: "page-failed",
        hunter: wikiPath,
        errorType: err.name,
        reason: err.message,
        url: err.url,
      });
    }
  }

  // Stable ordering by id keeps the committed diff readable across runs.
  allEntries.sort((a, b) => a.id.localeCompare(b.id));

  if (!dryRun) {
    try {
      await fsMkdir(path.dirname(datasetPath), { recursive: true });
      await fsWriteFile(datasetPath, `${JSON.stringify(allEntries, null, 2)}\n`, "utf8");
    } catch (err) {
      throw new ScrapeError(`failed to write dataset to ${datasetPath}: ${err.message}`, { cause: err });
    }
  }

  log({
    level: "info",
    event: "run-summary",
    succeeded: summary.succeeded.length,
    failed: summary.failed.length,
    skipped: summary.skipped.length,
    entries: allEntries.length,
    assetBytes: totalBytes,
    unmappedSources: unmappedSources.size,
  });

  return { summary, entries: allEntries, assetBytes: totalBytes, unmappedSources: [...unmappedSources].sort() };
}

// ---------------------------------------------------------------------------
// CLI entrypoint. Only runs when executed directly, never on import.
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = { delayMs: DEFAULT_DELAY_MS, namesOnly: false, force: false, dryRun: false, limit: Infinity };
  for (const arg of argv) {
    if (arg === "--names-only") options.namesOnly = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--delay-ms=")) {
      const parsed = Number(arg.slice("--delay-ms=".length));
      if (Number.isFinite(parsed) && parsed >= 0) options.delayMs = parsed;
    } else if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (Number.isFinite(parsed) && parsed > 0) options.limit = parsed;
    } else if (arg.startsWith("--out=")) {
      options.datasetPath = path.resolve(arg.slice("--out=".length));
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(
    `scrape-hunters: starting — names-only=${options.namesOnly}, delay=${options.delayMs}ms, force=${options.force}, dry-run=${options.dryRun}`
  );
  console.log("scrape-hunters: manual, offline tool per ADR-0002/ADR-0007 — not run by build/dev/CI.");

  const result = await runScrape(options, { fetchFn: fetch });
  console.log(
    formatSummary(result.summary, {
      entries: result.entries.length,
      assetBytes: result.assetBytes,
      unmappedSources: result.unmappedSources,
    })
  );

  process.exitCode = result.summary.failed.length > 0 ? 1 : 0;
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((err) => {
    console.error(`scrape-hunters: fatal error: ${err.message}`);
    if (err.cause) console.error(`  caused by: ${err.cause.message || err.cause}`);
    process.exitCode = 1;
  });
}
