// Governing: ADR-0007 (as amended 2026-08-10), ADR-0005 (shared wiki client)
// Implements: SPEC-0004 — every requirement's scenarios, exercised with an injected fetchFn.
//
// scripts/scrape-hunters.test.mjs
//
// These tests NEVER touch the network: every fetch is injected, so `npm test` and CI make zero
// requests to huntshowdown.wiki.gg. The HTML fixtures below are reduced from real pages captured
// while building the parser, preserving exactly the structure the parser keys on — both DRUID
// infobox shapes, the tabbed Source row, the redirect-bearing RLCONF blob, and the roster gallery.
//
// Image behaviour is covered twice on purpose. `fakeSharp` drives the orchestration tests — budget
// gates, disk state, failure isolation — because those care about control flow, not pixels. The
// "trimming against real images" block below drives REAL sharp against generated PNGs, because
// SPEC-0004's trimming requirement is a claim about pixels, and a fake that answers whatever the
// implementation asks it would confirm the implementation rather than the requirement.

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import {
  ACQUISITION_RULES,
  BudgetExceededError,
  ImageProcessingUnavailableError,
  PORTRAIT_MAX_BYTES,
  PortraitSourceUnusableError,
  TOTAL_BUDGET_BYTES,
  buildMediaUrl,
  decodeEntities,
  deriveObtainable,
  encodePortrait,
  findAlphaBoundingBox,
  formatSummary,
  loadImageProcessor,
  normaliseAcquisition,
  pageTitleToDisplay,
  parseArgs,
  parseRoster,
  parseSources,
  parseVariants,
  portraitAssetPath,
  portraitSlugFromFile,
  readExistingIds,
  removeStaleAssets,
  stripTags,
  readRlconf,
  runScrape,
  scrapeHunterPage,
} from "./scrape-hunters.mjs";

import { ImageAssetNotFoundError, ItemPageNotFoundError, RateLimiter } from "./lib/wiki.mjs";

/**
 * Real sharp, if it is installed.
 *
 * SPEC-0004 REQ "Image Processing Dependency Is Development-Only" allows a contributor to work
 * without it, so the pixel-level block skips rather than fails when it is absent. Every other test
 * in this file runs regardless — which is what keeps names-only mode honestly covered.
 */
const realSharp = await import("sharp")
  .then((m) => m.default ?? m)
  .catch(() => null);

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const ROBOTS = `
User-agent: *
Disallow: /wiki/File:
Disallow: /wiki/Special:

User-agent: ClaudeBot
Disallow: /
`;

function galleryBox(label, wikiPath, file) {
  return `<li class="gallerybox" style="width: 197px"><div style="width: 197px">
    <div class="thumb"><div><a href="/wiki/${wikiPath}" title="${label}"><img alt="${label}" src="/images/thumb/${file}/192px-${file}?abc123" width="192" height="128" data-file-width="384" data-file-height="256" /></a></div></div>
    <div class="gallerytext"><b><a href="/wiki/${wikiPath}" title="${wikiPath.replace(/_/g, " ")}">${label}</a></b></div>
  </div></li>`;
}

const ROSTER_HTML = `<html><body><h2>List of all Hunters</h2>
<ul class="gallery">
  ${galleryBox("Antonia Higuera: Rookie", "Hunters/Antonia_Higuera", "Hunter_Antonia_Higuera_Rookie.png")}
  ${galleryBox("Antonia Higuera: Survivor", "Hunters/Antonia_Higuera", "Hunter_Antonia_Higuera_Survivor.png")}
  ${galleryBox("Caitlyn Hammond", "Hunters/Caitlyn_Hammond", "Hunter_Caitlyn_Hammond.png")}
  ${galleryBox("Bad Hand", "Hunters/Bad_Hand", "Hunter_Bad_Hand.png")}
  <li class="gallerybox"><div><div class="thumb"><div><a href="/wiki/File:Hunter_Free_1.png" class="image"><img alt="Hunter Free 1.png" src="/images/thumb/Hunter_Free_1.png/192px-Hunter_Free_1.png" /></a></div></div>
  <div class="gallerytext"></div></div></li>
</ul></body></html>`;

/** Multi-variant page, reached through a redirect, with a per-tab Source row. */
const MULTI_VARIANT_HTML = `<html><head>
<meta property="og:image" content="https://huntshowdown.wiki.gg/images/Hunter_The_Revenant.png?7a72d6">
<script>RLCONF={"wgPageName":"Hunters/The_Revenant","wgTitle":"Hunters/The Revenant","wgCurRevisionId":13632,"wgRevisionId":13632,"wgRedirectedFrom":"Hunters/Bad_Hand"};</script>
</head><body><div class="mw-parser-output">
<div class="druid-infobox druid-container druid-container-example-2" id="druid-container-1">
<div><div class="druid-title">
<div class="druid-toggleable-data druid-toggleable focused" data-druid="1-1" data-druid-tab-key="The Revenant">The Revenant</div>
<div class="druid-toggleable-data druid-toggleable" data-druid="1-2" data-druid-tab-key="Bad Hand">Bad Hand</div>
</div></div>
<div class="druid-section-container"><div class="druid-main-images">
<div class="druid-main-images-files">
<div class="druid-main-images-file druid-toggleable focused" data-druid="1-1" data-druid-tab-key="The Revenant"><a href="/wiki/File:Hunter_The_Revenant.png" class="image"><img alt="Hunter The Revenant.png" src="/images/thumb/Hunter_The_Revenant.png/256px-Hunter_The_Revenant.png?7a72d6" /></a><div class="druid-main-images-caption">John Robertson wanted to be remarkable; to either be a hero or die as one.</div></div>
<div class="druid-main-images-file druid-toggleable" data-druid="1-2" data-druid-tab-key="Bad Hand"><a href="/wiki/File:Hunter_Bad_Hand.png" class="image"><img alt="Hunter Bad Hand.png" src="/images/thumb/Hunter_Bad_Hand.png/256px-Hunter_Bad_Hand.png?f06b5e" /></a><div class="druid-main-images-caption">Bad at faro and worse at poker, John Robertson wanted glory.</div></div>
</div></div></div>
<div class="druid-section-container">
<div class="druid-row druid-row-Source" data-druid-section-row="Intro"><div class="druid-label druid-label-Source">Source</div><div class="druid-data">
<div class="druid-toggleable-data druid-toggleable druid-toggleable-data-nonempty focused" data-druid="1-1" data-druid-tab-key="The Revenant"><a href="/wiki/DLC/The_Revenant">The Revenant&#160;DLC</a></div>
<div class="druid-toggleable-data druid-toggleable druid-toggleable-data-nonempty" data-druid="1-2" data-druid-tab-key="Bad Hand"><a href="/wiki/Dark_Tribute">Dark Tribute</a></div>
</div></div>
<div class="druid-row druid-row-Update" data-druid-section-row="Intro"><div class="druid-label druid-label-Update">Update</div><div class="druid-data"><div class="druid-toggleable-data" data-druid-tab-key="Bad Hand"><a href="/wiki/Update/1.7.2">Update 1.7.2</a></div></div></div>
</div></div>
<div id="toc" class="toc"></div>
<h2>Related Skins</h2><ul><li><a href="/wiki/Weapons/Uppercut">Snake Eyes</a></li></ul>
</div></body></html>`;

/** Single-variant page: one druid-main-image, flat Source, no tab keys anywhere. */
const SINGLE_VARIANT_HTML = `<html><head>
<meta property="og:image" content="https://huntshowdown.wiki.gg/images/Hunter_Caitlyn_Hammond.png?ac3091">
<script>RLCONF={"wgPageName":"Hunters/Caitlyn_Hammond","wgTitle":"Hunters/Caitlyn Hammond","wgCurRevisionId":15840,"wgRevisionId":15840};</script>
</head><body><div class="mw-parser-output">
<div class="druid-infobox druid-container" id="druid-container-1"><div><div class="druid-title">Caitlyn Hammond</div></div>
<div class="druid-section-container"><div class="druid-main-image"><a href="/wiki/File:Hunter_Caitlyn_Hammond.png" class="image"><img alt="Hunter Caitlyn Hammond.png" src="/images/thumb/Hunter_Caitlyn_Hammond.png/256px-Hunter_Caitlyn_Hammond.png?ac3091" /></a><div class="druid-main-image-caption">Hammond was the black sheep of her family.</div></div></div>
<div class="druid-section-container"><div class="druid-row druid-row-Source" data-druid-section-row="Intro"><div class="druid-label druid-label-Source">Source</div><div class="druid-data druid-data-Source druid-data-nonempty">
<a href="/wiki/Bloodline" title="Bloodline">Bloodline</a> Rank 67</div></div></div></div>
<div id="toc" class="toc"></div>
</div></body></html>`;

/** Progression page: three tabs, one page. */
const PROGRESSION_HTML = `<html><head>
<script>RLCONF={"wgPageName":"Hunters/Antonia_Higuera","wgCurRevisionId":13636,"wgRevisionId":13636};</script>
</head><body><div class="mw-parser-output">
<div class="druid-infobox druid-container" id="druid-container-1">
<div class="druid-section-container"><div class="druid-main-images"><div class="druid-main-images-files">
<div class="druid-main-images-file" data-druid-tab-key="Rookie"><a href="/wiki/File:Hunter_Antonia_Higuera_Rookie.png"><img src="/images/thumb/Hunter_Antonia_Higuera_Rookie.png/256px-x.png" /></a><div class="druid-main-images-caption">Antonia learned quickly that supplies could make or break a Hunt.</div></div>
<div class="druid-main-images-file" data-druid-tab-key="Survivor"><a href="/wiki/File:Hunter_Antonia_Higuera_Survivor.png"><img src="/images/thumb/Hunter_Antonia_Higuera_Survivor.png/256px-x.png" /></a><div class="druid-main-images-caption">Between the abandoned train cars and hidden rooms.</div></div>
<div class="druid-main-images-file" data-druid-tab-key="Veteran"><a href="/wiki/File:Hunter_Antonia_Higuera_Veteran.png"><img src="/images/thumb/Hunter_Antonia_Higuera_Veteran.png/256px-x.png" /></a><div class="druid-main-images-caption">Antonia knows she can find impossible advantages.</div></div>
</div></div></div>
<div class="druid-section-container"><div class="druid-row druid-row-Source"><div class="druid-label druid-label-Source">Source</div><div class="druid-data">
<div class="druid-toggleable-data druid-toggleable-data-nonempty" data-druid-tab-key="Rookie"><a href="/wiki/Bloodline">Bloodline</a> Rank 5</div>
<div class="druid-toggleable-data druid-toggleable-data-nonempty" data-druid-tab-key="Survivor">Hunter Progression</div>
<div class="druid-toggleable-data druid-toggleable-data-nonempty" data-druid-tab-key="Veteran">Hunter Progression</div>
</div></div></div></div>
<div id="toc" class="toc"></div>
</div></body></html>`;

/** A page whose infobox has no Source row and no art at all. */
const NO_SOURCE_NO_ART_HTML = `<html><head>
<script>RLCONF={"wgPageName":"Hunters/Mystery_Man","wgCurRevisionId":42,"wgRevisionId":42};</script>
</head><body><div class="mw-parser-output">
<div class="druid-infobox druid-container"><div><div class="druid-title">Mystery Man</div></div>
<div class="druid-section-container"><div class="druid-row druid-row-Update"><div class="druid-label druid-label-Update">Update</div><div class="druid-data druid-data-Update">Update 2.4</div></div></div></div>
<div id="toc" class="toc"></div>
</div></body></html>`;

// ---------------------------------------------------------------------------
// Test doubles.
// ---------------------------------------------------------------------------

/** A rate limiter that never actually sleeps, so the suite runs instantly. */
function instantRateLimiter() {
  let t = 0;
  return new RateLimiter(0, { now: () => (t += 1000), sleep: async () => {} });
}

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function response(body, { status = 200, contentType = "text/html" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => (typeof body === "string" ? body : body.toString("utf8")),
    arrayBuffer: async () => (Buffer.isBuffer(body) ? body : Buffer.from(String(body))),
  };
}

/** Route fetches by URL against a fixture table; unknown URLs 404. */
function makeFetch(routes, { calls } = {}) {
  return async (url) => {
    if (calls) calls.push(url);
    for (const [pattern, value] of routes) {
      if (typeof pattern === "string" ? url === pattern : pattern.test(url)) {
        return typeof value === "function" ? value(url) : value;
      }
    }
    return response("not found", { status: 404 });
  };
}

const DEFAULT_ROUTES = [
  [/robots\.txt$/, () => response(ROBOTS)],
  [/\/wiki\/Hunters$/, () => response(ROSTER_HTML)],
  [/\/wiki\/Hunters\/Bad_Hand$/, () => response(MULTI_VARIANT_HTML)],
  [/\/wiki\/Hunters\/Caitlyn_Hammond$/, () => response(SINGLE_VARIANT_HTML)],
  [/\/wiki\/Hunters\/Antonia_Higuera$/, () => response(PROGRESSION_HTML)],
  [/\/images\/Hunter_[^/]+\.png$/, () => response(PNG_BYTES, { contentType: "image/png" })],
];

/**
 * A sharp stand-in for the orchestration tests.
 *
 * It answers `metadata()`, serves raw pixels for the bounding-box scan, records `extract()`, and
 * returns an encoded buffer of a controllable size. `box: null` produces a fully transparent
 * source; `hasAlpha: false` produces one with no alpha channel at all.
 */
function fakeSharp({
  width = 384,
  height = 256,
  hasAlpha = true,
  box = { left: 90, top: 13, width: 207, height: 230 },
  bytes = 8000,
} = {}) {
  const extracts = [];
  const factory = () => {
    let raw = false;
    const api = {
      metadata: async () => ({
        width,
        height,
        format: "png",
        hasAlpha,
        channels: hasAlpha ? 4 : 3,
      }),
      raw: () => {
        raw = true;
        return api;
      },
      extract: (opts) => {
        extracts.push(opts);
        return api;
      },
      avif: () => api,
      toBuffer: async (opts) => {
        if (raw && opts?.resolveWithObject) {
          const channels = hasAlpha ? 4 : 3;
          const data = Buffer.alloc(width * height * channels);
          if (hasAlpha && box) {
            for (let y = box.top; y < box.top + box.height; y += 1) {
              for (let x = box.left; x < box.left + box.width; x += 1) {
                data[(y * width + x) * channels + channels - 1] = 255;
              }
            }
          }
          return { data, info: { width, height, channels } };
        }
        return Buffer.alloc(typeof bytes === "function" ? bytes() : bytes);
      },
    };
    return api;
  };
  factory.extracts = extracts;
  return factory;
}

/**
 * A fakeSharp whose behaviour changes per variant, for the tabbed-page isolation tests.
 *
 * `metadata()` opens each variant's encode exactly once, so it — and nothing else — advances the
 * sequence. Every later pipeline object in that variant's encode (the `.raw()` bounding-box scan
 * and the `.extract().avif()` pass) delegates to the config metadata() selected, which is what a
 * naive per-object closure gets wrong: `encodePortrait` calls the factory three times per variant.
 */
function sequencedSharp(configs) {
  let idx = -1;
  let current = fakeSharp(configs[0]);
  return (buf) => ({
    metadata: async (...args) => {
      idx = Math.min(idx + 1, configs.length - 1);
      current = fakeSharp(configs[idx]);
      return current(buf).metadata(...args);
    },
    raw: () => current(buf).raw(),
    extract: (opts) => current(buf).extract(opts),
    avif: (opts) => current(buf).avif(opts),
    toBuffer: (opts) => current(buf).toBuffer(opts),
  });
}

function memoryFs() {
  const files = new Map();
  return {
    files,
    fsMkdir: async () => {},
    fsWriteFile: async (p, data) => {
      files.set(p, data);
    },
    fsAccess: async (p) => {
      if (!files.has(p)) throw new Error("ENOENT");
    },
    // Defined so a rollback path can never fall through to the real filesystem.
    fsUnlink: async (p) => {
      files.delete(p);
    },
    fsReadFile: async (p) => {
      if (!files.has(p)) throw new Error("ENOENT");
      return files.get(p);
    },
    fsReaddir: async (dir) => {
      const prefix = `${dir.replace(/\/$/, "")}/`;
      const names = [...files.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
        .map((p) => p.slice(prefix.length));
      if (names.length === 0 && ![...files.keys()].some((p) => p.startsWith(prefix))) {
        throw new Error("ENOENT");
      }
      return names;
    },
  };
}

function baseDeps(overrides = {}) {
  const fs = memoryFs();
  return {
    fetchFn: makeFetch(DEFAULT_ROUTES),
    log: () => {},
    sharpLoader: async () => fakeSharp(),
    now: () => "2026-08-10T00:00:00.000Z",
    rateLimiterOptions: { now: (() => { let t = 0; return () => (t += 1000); })(), sleep: async () => {} },
    ...fs,
    ...overrides,
  };
}

const RUN_OPTS = { datasetPath: "/data/hunters.json", imagesRoot: "/images/hunters", delayMs: 0 };

// ---------------------------------------------------------------------------

describe("parsing helpers", () => {
  it("decodes the entities MediaWiki actually emits", () => {
    assert.equal(decodeEntities("The Revenant&#160;DLC"), "The Revenant DLC");
    assert.equal(decodeEntities("Butcher&#039;s Cleaver"), "Butcher's Cleaver");
    assert.equal(decodeEntities("Devil&#39;s Trail &amp; more"), "Devil's Trail & more");
  });

  it("reads canonical identity from RLCONF rather than the requested URL", () => {
    // Hunters/Bad_Hand is a redirect; the page it lands on is what the dataset must key on.
    assert.equal(readRlconf(MULTI_VARIANT_HTML, "wgPageName"), "Hunters/The_Revenant");
    assert.equal(readRlconf(MULTI_VARIANT_HTML, "wgCurRevisionId"), 13632);
    assert.equal(readRlconf(MULTI_VARIANT_HTML, "wgNotAKey"), null);
  });

  it("strips the Hunters/ namespace from the display title", () => {
    assert.equal(pageTitleToDisplay("Hunters/The_Revenant"), "The Revenant");
    assert.equal(pageTitleToDisplay("Hunters/Caitlyn_Hammond"), "Caitlyn Hammond");
  });

  it("derives a portrait slug from the wiki file name, dropping the uniform Hunter_ prefix", () => {
    assert.equal(portraitSlugFromFile("Hunter_Union_Suit_Red.png"), "union-suit-red");
    assert.equal(portraitSlugFromFile("Hunter_Antonia_Higuera_Rookie.png"), "antonia-higuera-rookie");
    assert.equal(portraitSlugFromFile(null), null);
  });

  it("drops filename-shaped alt text, which is markup noise rather than content", () => {
    // MediaWiki alts a /wiki/File:-linked image with its raw file name. Splicing that into a
    // verbatim `source` would corrupt the one field the dataset promises not to get wrong.
    const text = stripTags('<img alt="Event Icon Harvest of Ghosts.png" src="/x.png" /> Harvest of Ghosts');
    assert.equal(text, "Harvest of Ghosts");
  });

  it("builds media URLs under /images/, never /wiki/File: which robots.txt disallows", () => {
    const url = buildMediaUrl("Hunter_Bad_Hand.png");
    assert.match(url, /\/images\/Hunter_Bad_Hand\.png$/);
    assert.doesNotMatch(url, /File:/);
  });
});

describe("roster parsing", () => {
  it("returns one entry per gallery box that names a hunter page", () => {
    const entries = parseRoster(ROSTER_HTML);
    assert.equal(entries.length, 4);
    assert.deepEqual(entries[0], {
      label: "Antonia Higuera: Rookie",
      wikiPath: "Hunters/Antonia_Higuera",
      file: "Hunter_Antonia_Higuera_Rookie.png",
    });
  });

  it("drops bare File: boxes, which are art with no hunter identity behind them", () => {
    const entries = parseRoster(ROSTER_HTML);
    assert.ok(entries.every((e) => !/File:/.test(e.wikiPath)));
    assert.ok(entries.every((e) => e.label));
  });

  it("keeps distinct variants that share one page", () => {
    const entries = parseRoster(ROSTER_HTML).filter((e) => e.wikiPath === "Hunters/Antonia_Higuera");
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((e) => e.label),
      ["Antonia Higuera: Rookie", "Antonia Higuera: Survivor"]
    );
  });
});

describe("variant parsing — both infobox shapes", () => {
  it("reads every tab of a multi-variant page, with its own art and description", () => {
    const variants = parseVariants(MULTI_VARIANT_HTML);
    assert.equal(variants.length, 2);
    assert.deepEqual(
      variants.map((v) => v.tabKey),
      ["The Revenant", "Bad Hand"]
    );
    assert.equal(variants[0].file, "Hunter_The_Revenant.png");
    assert.equal(variants[1].file, "Hunter_Bad_Hand.png");
  });

  it("reads the LAST variant's description, which the segment cut would otherwise swallow", () => {
    // Regression guard: a caption regex requiring a closing </div> returns null for the final
    // variant on every page, producing a dataset that looks fine until you read the last row.
    const variants = parseVariants(MULTI_VARIANT_HTML);
    assert.match(variants.at(-1).description, /Bad at faro and worse at poker/);
    assert.match(parseVariants(PROGRESSION_HTML).at(-1).description, /impossible advantages/);
    assert.match(parseVariants(SINGLE_VARIANT_HTML).at(-1).description, /black sheep of her family/);
  });

  it("never takes og:image, which names the wrong hunter on a multi-variant page", () => {
    // Hunters/Bad_Hand's og:image is Hunter_The_Revenant.png. A parser trusting it gives several
    // hundred hunters a sibling's face, and no "an image was written" assertion would catch it.
    const badHand = parseVariants(MULTI_VARIANT_HTML).find((v) => v.tabKey === "Bad Hand");
    assert.equal(badHand.file, "Hunter_Bad_Hand.png");
  });

  it("reads a single-variant page as exactly one variant with a null tab key", () => {
    const variants = parseVariants(SINGLE_VARIANT_HTML);
    assert.equal(variants.length, 1);
    assert.equal(variants[0].tabKey, null);
    assert.equal(variants[0].file, "Hunter_Caitlyn_Hammond.png");
  });

  it("reads a progression page as three variants of one page", () => {
    const variants = parseVariants(PROGRESSION_HTML);
    assert.deepEqual(
      variants.map((v) => v.tabKey),
      ["Rookie", "Survivor", "Veteran"]
    );
  });

  it("yields a variant even when the infobox carries no art", () => {
    const variants = parseVariants(NO_SOURCE_NO_ART_HTML);
    assert.equal(variants.length, 1);
    assert.equal(variants[0].file, null);
  });
});

describe("Source parsing", () => {
  it("maps each tab to its own verbatim Source", () => {
    assert.deepEqual(parseSources(MULTI_VARIANT_HTML), {
      "The Revenant": "The Revenant DLC",
      "Bad Hand": "Dark Tribute",
    });
  });

  it("reads a flat Source under the empty key on a single-variant page", () => {
    assert.deepEqual(parseSources(SINGLE_VARIANT_HTML), { "": "Bloodline Rank 67" });
  });

  it("does not bleed the following row into the Source value", () => {
    const sources = parseSources(MULTI_VARIANT_HTML);
    assert.ok(!Object.values(sources).some((v) => /Update/.test(v)));
  });

  it("returns an empty map when the infobox has no Source row", () => {
    assert.deepEqual(parseSources(NO_SOURCE_NO_ART_HTML), {});
  });
});

describe("acquisition normalisation", () => {
  it("maps the wiki's own strings onto the closed vocabulary", () => {
    assert.equal(normaliseAcquisition("The Revenant DLC"), "dlc");
    assert.equal(normaliseAcquisition("Dark Tribute"), "dark-tribute");
    assert.equal(normaliseAcquisition("Bloodline Rank 67"), "bloodline");
    assert.equal(normaliseAcquisition("Hunter Progression"), "progression");
    assert.equal(normaliseAcquisition("Soul Survivor"), "soul-survivor");
  });

  it("prefers the specific rule over the general one", () => {
    // "Dark Tribute" must not fall through to a bare tribute/event match, and a Soul Survivor
    // event must not be classified as a generic event.
    assert.equal(normaliseAcquisition("Dark Tribute"), "dark-tribute");
    assert.equal(normaliseAcquisition("Soul Survivor Event"), "soul-survivor");
  });

  it("classifies a price whose currency is only stated by an icon", () => {
    // The wiki writes Source as `900 <img alt="Blood Bonds">`. Losing the alt leaves "900",
    // which is unclassifiable — this was 24% of the roster before alt text was preserved.
    const source = stripTags('900 <a href="/wiki/Blood_Bonds"><img alt="Blood Bonds" src="/images/x.png" /></a>');
    assert.equal(source, "900 Blood Bonds");
    assert.equal(normaliseAcquisition(source), "blood-bonds");
  });

  it("reads the wiki's 'Questline' wording as a story challenge", () => {
    assert.equal(normaliseAcquisition("Halloween Questline"), "story-challenge");
    assert.equal(normaliseAcquisition("Vengeance of the Skinned Questline"), "story-challenge");
  });

  it("returns null rather than guessing on an unrecognised Source", () => {
    assert.equal(normaliseAcquisition("Something Entirely New"), null);
    assert.equal(normaliseAcquisition(null), null);
  });

  it("every rule maps to a value SPEC-0004 permits", () => {
    const allowed = new Set([
      "free", "hunt-dollars", "soul-survivor", "dark-tribute", "blood-bonds", "dlc", "event",
      "mythic", "story-challenge", "twitch-drop", "bloodline", "prestige", "progression",
    ]);
    for (const [, value] of ACQUISITION_RULES) assert.ok(allowed.has(value), `${value} not in spec vocabulary`);
  });

  it("separates 'how was it obtained' from 'can I still get it'", () => {
    assert.equal(deriveObtainable("mythic"), false);
    assert.equal(deriveObtainable("dlc"), true);
    assert.equal(deriveObtainable(null), null);
  });
});

describe("portrait encoding and budgets", () => {
  it("emits exactly one asset, at the trimmed bounding box, with no resize step", async () => {
    const sharp = fakeSharp({ box: { left: 90, top: 13, width: 207, height: 230 } });
    const out = await encodePortrait(PNG_BYTES, sharp, { hunter: "X" });

    assert.equal(out.width, 207);
    assert.equal(out.height, 230);
    assert.equal(out.trimmed, true);
    // The absence is the assertion: a `resize` on the pipeline would be an upscale or a downscale,
    // and SPEC-0004 forbids both. `fakeSharp` has no resize() at all, so a reintroduced call throws.
    assert.deepEqual(sharp.extracts, [{ left: 90, top: 13, width: 207, height: 230 }]);
  });

  it("finds the smallest rectangle containing every pixel with alpha above zero", async () => {
    const sharp = fakeSharp({ width: 40, height: 30, box: { left: 4, top: 6, width: 11, height: 9 } });
    assert.deepEqual(await findAlphaBoundingBox(PNG_BYTES, sharp), {
      left: 4,
      top: 6,
      width: 11,
      height: 9,
    });
  });

  it("encodes a source with no alpha channel untrimmed at native resolution", async () => {
    // SPEC-0004: "the hunter SHALL NOT be failed on that basis". There is no transparent margin to
    // remove, and the hunter still needs a portrait.
    const sharp = fakeSharp({ hasAlpha: false, width: 384, height: 256 });
    const out = await encodePortrait(PNG_BYTES, sharp, { hunter: "Opaque" });

    assert.equal(out.trimmed, false);
    assert.equal(out.width, 384);
    assert.equal(out.height, 256);
    assert.deepEqual(sharp.extracts, [], "an alpha-less source is never extracted");
  });

  it("fails a fully transparent source with its own sentinel, not a missing-asset one", async () => {
    const sharp = fakeSharp({ box: null });
    await assert.rejects(
      () => encodePortrait(PNG_BYTES, sharp, { hunter: "Ghost", url: "https://x/y.png" }),
      (err) => {
        // Distinguishability is the requirement: "the art is missing" and "the art is present and
        // unusable" send a maintainer in opposite directions.
        assert.ok(err instanceof PortraitSourceUnusableError, `got ${err.name}`);
        assert.ok(!(err instanceof ImageAssetNotFoundError), "must not be a missing-asset error");
        assert.match(err.message, /fully transparent/);
        assert.equal(err.item, "Ghost");
        return true;
      }
    );
  });

  it("rejects an oversized asset rather than returning it to be written", async () => {
    const sharp = fakeSharp({ bytes: 99_000 });
    await assert.rejects(
      () => encodePortrait(PNG_BYTES, sharp, { hunter: "Chonk" }),
      (err) => err instanceof BudgetExceededError && /Chonk.*99000.*25600/s.test(err.message)
    );
  });

  it("holds the per-asset ceiling at the 25 KB SPEC-0004 specifies", () => {
    assert.equal(PORTRAIT_MAX_BYTES, 25 * 1024);
  });

  it("names the asset so its URL derives from the slug alone, with no size segment", () => {
    assert.equal(portraitAssetPath("/i", "bad-hand"), "/i/bad-hand.avif");
    assert.doesNotMatch(portraitAssetPath("/i", "bad-hand"), /-thumb|-full|\d+px/);
  });
});

describe("trimming against real images", { skip: realSharp ? false : "sharp is not installed" }, () => {
  /** A transparent canvas with one opaque rectangle at a known offset. */
  async function canvasWithSubject({ width, height, left, top, boxWidth, boxHeight, alpha = 255 }) {
    const channels = 4;
    const data = Buffer.alloc(width * height * channels);
    for (let y = top; y < top + boxHeight; y += 1) {
      for (let x = left; x < left + boxWidth; x += 1) {
        const i = (y * width + x) * channels;
        data[i] = 200;
        data[i + 1] = 60;
        data[i + 2] = 40;
        data[i + 3] = alpha;
      }
    }
    return realSharp(data, { raw: { width, height, channels } }).png().toBuffer();
  }

  it("trims transparent margin down to the subject's exact bounding box", async () => {
    const src = await canvasWithSubject({
      width: 384, height: 256, left: 90, top: 13, boxWidth: 207, boxHeight: 230,
    });
    const out = await encodePortrait(src, realSharp, { hunter: "Trimmed" });
    const meta = await realSharp(out.buffer).metadata();

    assert.equal(meta.width, 207);
    assert.equal(meta.height, 230);
    // "no larger than the source in either dimension, strictly smaller in every dimension that
    // carried margin" — both dimensions carried margin here.
    assert.ok(meta.width < 384 && meta.height < 256);
  });

  it("keeps an antialiased edge pixel, which sharp's default threshold would shave off", async () => {
    // The requirement is alpha > 0, not alpha > some-default. A one-pixel border at alpha 1 is
    // subject: with sharp's own trim threshold it disappears, and the silhouette quietly shrinks by
    // an amount that depends on the encoder version rather than on the image.
    const width = 40;
    const height = 40;
    const channels = 4;
    const data = Buffer.alloc(width * height * channels);
    const setAlpha = (x, y, a) => {
      data[(y * width + x) * channels + 3] = a;
    };
    for (let y = 10; y < 30; y += 1) for (let x = 10; x < 30; x += 1) setAlpha(x, y, 255);
    // A single near-transparent pixel outside the solid block, still part of the subject.
    setAlpha(5, 8, 1);
    const src = await realSharp(data, { raw: { width, height, channels } }).png().toBuffer();

    assert.deepEqual(await findAlphaBoundingBox(src, realSharp), {
      left: 5,
      top: 8,
      width: 25,
      height: 22,
    });
  });

  it("retains the alpha channel through the AVIF encode", async () => {
    const src = await canvasWithSubject({
      width: 64, height: 64, left: 8, top: 8, boxWidth: 32, boxHeight: 24, alpha: 128,
    });
    const out = await encodePortrait(src, realSharp, { hunter: "Translucent" });
    const meta = await realSharp(out.buffer).metadata();

    assert.equal(meta.format, "heif");
    assert.equal(meta.hasAlpha, true, "a portrait must composite onto the page, not onto a box");
  });

  it("writes a small subject at native size rather than upscaling it to a surface's needs", async () => {
    // A picker tile wants 192px at 2× and the list card wants 440px of subject height. Neither is
    // manufactured: SPEC-0004 records the shortfall as a source-resolution ceiling.
    const src = await canvasWithSubject({
      width: 384, height: 256, left: 100, top: 30, boxWidth: 178, boxHeight: 204,
    });
    const out = await encodePortrait(src, realSharp, { hunter: "Narrow" });
    const meta = await realSharp(out.buffer).metadata();

    assert.equal(meta.width, 178);
    assert.equal(meta.height, 204);
    assert.ok(meta.height < 440, "the fixture is below the card's 2x requirement, as every hunter is");
  });

  it("gives different hunters different dimensions and aspect ratios", async () => {
    const wide = await encodePortrait(
      await canvasWithSubject({ width: 384, height: 256, left: 25, top: 26, boxWidth: 334, boxHeight: 204 }),
      realSharp,
      { hunter: "Wide" }
    );
    const tall = await encodePortrait(
      await canvasWithSubject({ width: 384, height: 256, left: 100, top: 0, boxWidth: 178, boxHeight: 256 }),
      realSharp,
      { hunter: "Tall" }
    );

    assert.notDeepEqual([wide.width, wide.height], [tall.width, tall.height]);
    assert.notEqual(wide.width / wide.height, tall.width / tall.height);
  });

  it("fails a genuinely all-transparent PNG with the unusable-source sentinel", async () => {
    const src = await realSharp(Buffer.alloc(32 * 32 * 4), { raw: { width: 32, height: 32, channels: 4 } })
      .png()
      .toBuffer();
    await assert.rejects(
      () => encodePortrait(src, realSharp, { hunter: "Ghost" }),
      PortraitSourceUnusableError
    );
  });

  it("encodes an alpha-less source untrimmed rather than failing it", async () => {
    const src = await realSharp({
      create: { width: 120, height: 90, channels: 3, background: { r: 30, g: 90, b: 140 } },
    })
      .png()
      .toBuffer();
    const out = await encodePortrait(src, realSharp, { hunter: "Opaque" });
    const meta = await realSharp(out.buffer).metadata();

    assert.equal(out.trimmed, false);
    assert.equal(meta.width, 120);
    assert.equal(meta.height, 90);
  });
});

describe("stale asset removal", () => {
  it("removes what the dataset does not claim and reports the count", async () => {
    const fs = memoryFs();
    for (const name of ["a.avif", "a-thumb.avif", "b.avif", "b-thumb.avif", "notes.txt"]) {
      fs.files.set(`/images/hunters/${name}`, Buffer.alloc(1));
    }

    const result = await removeStaleAssets({
      imagesRoot: "/images/hunters",
      keepFiles: new Set(["a.avif", "b.avif"]),
      ...fs,
      log: () => {},
    });

    assert.equal(result.removed, 2);
    assert.deepEqual(result.files.sort(), ["a-thumb.avif", "b-thumb.avif"]);
    assert.ok(fs.files.has("/images/hunters/notes.txt"), "non-avif files are left alone");
  });

  it("reports zero on an already-clean directory", async () => {
    const fs = memoryFs();
    fs.files.set("/images/hunters/a.avif", Buffer.alloc(1));
    const result = await removeStaleAssets({
      imagesRoot: "/images/hunters",
      keepFiles: new Set(["a.avif"]),
      ...fs,
      log: () => {},
    });
    assert.equal(result.removed, 0);
  });

  it("treats an absent images directory as nothing to remove, not an error", async () => {
    const result = await removeStaleAssets({
      imagesRoot: "/nope",
      keepFiles: new Set(),
      fsReaddir: async () => {
        throw new Error("ENOENT");
      },
      fsUnlink: async () => {},
      log: () => {},
    });
    assert.deepEqual(result, { removed: 0, files: [] });
  });

  it("logs an unlink failure and keeps going rather than discarding the run", async () => {
    const events = [];
    const result = await removeStaleAssets({
      imagesRoot: "/images/hunters",
      keepFiles: new Set(),
      fsReaddir: async () => ["locked.avif", "free.avif"],
      fsUnlink: async (p) => {
        if (p.includes("locked")) throw new Error("EPERM");
      },
      log: (e) => events.push(e),
    });

    assert.deepEqual(result.files, ["free.avif"]);
    assert.ok(events.some((e) => e.event === "stale-asset-remove-failed" && /EPERM/.test(e.reason)));
  });
});

describe("scrapeHunterPage", () => {
  const pageDeps = (overrides = {}) => {
    const fs = memoryFs();
    return {
      fetchFn: makeFetch(DEFAULT_ROUTES),
      rateLimiter: instantRateLimiter(),
      robotsGroups: [],
      imagesRoot: "/images/hunters",
      sharp: fakeSharp(),
      ingestedAt: "2026-08-10T00:00:00.000Z",
      log: () => {},
      ...fs,
      ...overrides,
    };
  };

  it("derives one dataset row per variant from a single page fetch", async () => {
    const calls = [];
    const deps = pageDeps({ fetchFn: makeFetch(DEFAULT_ROUTES, { calls }), namesOnly: true });
    const result = await scrapeHunterPage({ wikiPath: "Hunters/Bad_Hand" }, deps);

    assert.equal(result.entries.length, 2);
    assert.equal(calls.filter((u) => /\/wiki\//.test(u)).length, 1, "page fetched exactly once");
  });

  it("attaches provenance from the page it actually landed on", async () => {
    const result = await scrapeHunterPage({ wikiPath: "Hunters/Bad_Hand" }, pageDeps({ namesOnly: true }));
    for (const entry of result.entries) {
      assert.equal(entry.sourceRevision, "13632");
      assert.equal(entry.ingestedAt, "2026-08-10T00:00:00.000Z");
    }
  });

  it("gives each variant its own portrait, description and source", async () => {
    const result = await scrapeHunterPage({ wikiPath: "Hunters/Bad_Hand" }, pageDeps({ namesOnly: true }));
    const byId = Object.fromEntries(result.entries.map((e) => [e.id, e]));

    assert.equal(byId["the-revenant"].source, "The Revenant DLC");
    assert.equal(byId["the-revenant"].acquisition, "dlc");
    assert.equal(byId["bad-hand"].source, "Dark Tribute");
    assert.equal(byId["bad-hand"].acquisition, "dark-tribute");
    assert.match(byId["bad-hand"].description, /Bad at faro/);
  });

  it("prefers the roster's qualified label over a constructed name", async () => {
    const labelsByFile = new Map([["Hunter_Bad_Hand.png", "Bad Hand"]]);
    const result = await scrapeHunterPage({ wikiPath: "Hunters/Bad_Hand" }, pageDeps({ namesOnly: true, labelsByFile }));
    assert.equal(result.entries.find((e) => e.id === "bad-hand").name, "Bad Hand");
  });

  it("constructs a name for a variant the roster gallery omits", async () => {
    const result = await scrapeHunterPage({ wikiPath: "Hunters/Antonia_Higuera" }, pageDeps({ namesOnly: true }));
    assert.deepEqual(
      result.entries.map((e) => e.name),
      ["Antonia Higuera: Rookie", "Antonia Higuera: Survivor", "Antonia Higuera: Veteran"]
    );
  });

  it("writes a hunter with no portrait into the dataset anyway", async () => {
    const routes = [[/robots\.txt$/, () => response(ROBOTS)], [/Mystery_Man$/, () => response(NO_SOURCE_NO_ART_HTML)]];
    const result = await scrapeHunterPage({ wikiPath: "Hunters/Mystery_Man" }, pageDeps({ fetchFn: makeFetch(routes) }));

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].name, "Mystery Man");
    assert.equal(result.entries[0].portrait, null);
    assert.equal(result.entries[0].source, null);
    assert.equal(result.entries[0].acquisition, null);
    assert.equal(result.assets.length, 0);
  });

  it("writes exactly one asset per variant, with no second size on disk", async () => {
    const fs = memoryFs();
    const result = await scrapeHunterPage({ wikiPath: "Hunters/Caitlyn_Hammond" }, pageDeps(fs));

    assert.deepEqual([...fs.files.keys()], ["/images/hunters/caitlyn-hammond.avif"]);
    assert.equal(result.assets.length, 1);
    assert.equal(result.bytes, 8000);
    assert.deepEqual(
      [result.assets[0].width, result.assets[0].height],
      [207, 230],
      "the asset is the trimmed bounding box, not a target width"
    );
  });

  it("writes nothing under the images root in names-only mode", async () => {
    const fs = memoryFs();
    await scrapeHunterPage({ wikiPath: "Hunters/Caitlyn_Hammond" }, pageDeps({ ...fs, namesOnly: true, sharp: null }));
    assert.equal(fs.files.size, 0);
  });

  it("does not write an oversized asset — the budget is checked before disk", async () => {
    const fs = memoryFs();
    const result = await scrapeHunterPage(
      { wikiPath: "Hunters/Caitlyn_Hammond" },
      pageDeps({ ...fs, sharp: fakeSharp({ bytes: 99_000 }) })
    );

    assert.equal(fs.files.size, 0, "nothing was written");
    // The hunter is failed, not silently downgraded to "has no art" — a dataset row here would
    // misrepresent a budget failure as a missing portrait.
    assert.deepEqual(result.entries, []);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].errorType, "BudgetExceededError");
    assert.match(result.failures[0].reason, /99000.*25600/s);
  });

  it("fails only the variant whose source is unusable, keeping its siblings", async () => {
    const fs = memoryFs();
    // First variant has a subject; the second is transparent end to end.
    const sharp = sequencedSharp([
      { box: { left: 10, top: 10, width: 100, height: 100 }, bytes: 3000 },
      { box: null },
    ]);

    const result = await scrapeHunterPage({ wikiPath: "Hunters/Bad_Hand" }, pageDeps({ ...fs, sharp }));

    assert.deepEqual(result.entries.map((e) => e.id), ["the-revenant"]);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].errorType, "PortraitSourceUnusableError");
    assert.equal(result.failures[0].portrait, "bad-hand");

    // Every file on disk is claimed by an entry — no orphans.
    assert.deepEqual([...fs.files.keys()], ["/images/hunters/the-revenant.avif"]);
  });

  it("leaves no orphaned art when a later variant on a tabbed page busts its budget", async () => {
    // The regression: portraits are written variant by variant, so an earlier variant's file was
    // already on disk when a later one threw — and the throw discarded the whole page's entries.
    // That left committed AVIFs with no dataset row pointing at them, invisible in review because
    // a reviewer sees a filename, not a catalogue.
    const fs = memoryFs();
    // First variant encodes small; second blows its budget.
    const sharp = sequencedSharp([{ bytes: 3000 }, { bytes: 99_000 }]);

    const result = await scrapeHunterPage({ wikiPath: "Hunters/Bad_Hand" }, pageDeps({ ...fs, sharp }));

    assert.deepEqual(result.entries.map((e) => e.id), ["the-revenant"]);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].errorType, "BudgetExceededError");
    assert.equal(result.failures[0].portrait, "bad-hand");

    const cataloged = new Set(result.entries.map((e) => `${e.portrait}.avif`));
    for (const p of fs.files.keys()) {
      assert.ok(cataloged.has(p.split("/").pop()), `${p} is on disk but in no dataset entry`);
    }
    assert.ok(![...fs.files.keys()].some((p) => p.includes("bad-hand")), "failed variant wrote nothing");
  });

  it("leaves nothing behind when the write itself fails", async () => {
    const fs = memoryFs();
    const fsWriteFile = async (p, data) => {
      // Simulate a truncated write: bytes land, then the call fails.
      fs.files.set(p, data);
      throw new Error("ENOSPC");
    };

    const result = await scrapeHunterPage(
      { wikiPath: "Hunters/Caitlyn_Hammond" },
      pageDeps({ ...fs, fsWriteFile })
    );

    assert.equal(fs.files.size, 0, "the partial file was removed again");
    assert.equal(result.failures.length, 1);
    assert.deepEqual(result.entries, []);
  });

  it("raises a page-not-found sentinel, distinct from a missing portrait", async () => {
    await assert.rejects(
      () => scrapeHunterPage({ wikiPath: "Hunters/Nobody" }, pageDeps()),
      ItemPageNotFoundError
    );
  });

  it("refuses to fetch a page robots.txt disallows", async () => {
    await assert.rejects(
      () => scrapeHunterPage({ wikiPath: "Hunters/Bad_Hand" }, pageDeps({ robotsGroups: [{ userAgents: ["*"], rules: [{ type: "disallow", path: "/wiki/" }] }] })),
      /robots\.txt disallows/
    );
  });

  it("skips re-encoding a portrait already on disk unless forced", async () => {
    const fs = memoryFs();
    fs.files.set("/images/hunters/caitlyn-hammond.avif", Buffer.alloc(10));
    const result = await scrapeHunterPage({ wikiPath: "Hunters/Caitlyn_Hammond" }, pageDeps(fs));
    assert.equal(result.assets.length, 0);

    const forced = await scrapeHunterPage({ wikiPath: "Hunters/Caitlyn_Hammond" }, pageDeps({ ...fs, force: true }));
    assert.equal(forced.assets.length, 1);
  });
});

describe("runScrape", () => {
  it("aborts before any hunter page when robots.txt cannot be fetched", async () => {
    const calls = [];
    const fetchFn = makeFetch([[/robots\.txt$/, () => response("boom", { status: 500 })]], { calls });
    await assert.rejects(() => runScrape(RUN_OPTS, baseDeps({ fetchFn })), /robots\.txt/);
    assert.deepEqual(calls.filter((u) => /\/wiki\//.test(u)), [], "no wiki page was fetched");
  });

  it("fetches the roster once and each hunter page once", async () => {
    const calls = [];
    await runScrape({ ...RUN_OPTS, namesOnly: true }, baseDeps({ fetchFn: makeFetch(DEFAULT_ROUTES, { calls }) }));
    const pageCalls = calls.filter((u) => /\/wiki\/Hunters\//.test(u));
    assert.equal(new Set(pageCalls).size, pageCalls.length, "no page fetched twice");
    assert.equal(calls.filter((u) => /\/wiki\/Hunters$/.test(u)).length, 1);
  });

  it("writes the dataset sorted by id", async () => {
    const deps = baseDeps();
    const result = await runScrape({ ...RUN_OPTS, namesOnly: true }, deps);
    const written = JSON.parse(deps.files.get("/data/hunters.json"));
    assert.deepEqual(written.map((e) => e.id), [...written.map((e) => e.id)].sort());
    assert.equal(written.length, result.entries.length);
  });

  it("carries every field SPEC-0004 requires on every entry", async () => {
    const { entries } = await runScrape({ ...RUN_OPTS, namesOnly: true }, baseDeps());
    assert.ok(entries.length > 0);
    for (const entry of entries) {
      for (const field of ["id", "name", "description", "portrait", "source", "acquisition", "obtainable", "sourceRevision", "ingestedAt"]) {
        assert.ok(field in entry, `${entry.id} missing ${field}`);
      }
      assert.ok(entry.sourceRevision, `${entry.id} has no revision`);
      assert.ok(entry.ingestedAt, `${entry.id} has no ingestedAt`);
    }
  });

  it("keeps ids identical across an unchanged re-run", async () => {
    const first = await runScrape({ ...RUN_OPTS, namesOnly: true }, baseDeps());
    const second = await runScrape({ ...RUN_OPTS, namesOnly: true }, baseDeps());
    assert.deepEqual(first.entries.map((e) => e.id), second.entries.map((e) => e.id));
  });

  it("keeps a renamed hunter's id and updates only its name", async () => {
    const deps = baseDeps();
    // A prior run recorded this portrait under a legacy id.
    deps.files.set(
      "/data/hunters.json",
      JSON.stringify([{ id: "legacy-caitlyn", name: "Old Name", portrait: "caitlyn-hammond" }])
    );

    const { entries } = await runScrape({ ...RUN_OPTS, namesOnly: true }, deps);
    const entry = entries.find((e) => e.portrait === "caitlyn-hammond");
    assert.equal(entry.id, "legacy-caitlyn", "id survived");
    assert.equal(entry.name, "Caitlyn Hammond", "name refreshed");
  });

  it("emits each hunter once when the roster lists a redirect alongside its canonical title", async () => {
    // "Bad Hand" and "The Revenant" are two gallery boxes resolving to one page. Deduping on the
    // requested path cannot catch this — the paths genuinely differ — so it keys on wgPageName.
    const routes = [
      [/robots\.txt$/, () => response(ROBOTS)],
      [
        /\/wiki\/Hunters$/,
        () =>
          response(`<html><body><ul class="gallery">
            ${galleryBox("Bad Hand", "Hunters/Bad_Hand", "Hunter_Bad_Hand.png")}
            ${galleryBox("The Revenant", "Hunters/The_Revenant", "Hunter_The_Revenant.png")}
          </ul></body></html>`),
      ],
      [/\/wiki\/Hunters\/(Bad_Hand|The_Revenant)$/, () => response(MULTI_VARIANT_HTML)],
    ];

    const { entries, summary } = await runScrape(
      { ...RUN_OPTS, namesOnly: true },
      baseDeps({ fetchFn: makeFetch(routes) })
    );

    assert.equal(new Set(entries.map((e) => e.id)).size, entries.length, "no duplicate ids");
    assert.deepEqual(entries.map((e) => e.id).sort(), ["bad-hand", "the-revenant"]);
    assert.equal(summary.skipped.length, 1);
    assert.match(summary.skipped[0].reason, /already scraped/);
  });

  it("keeps ids unique across the whole dataset", async () => {
    const { entries } = await runScrape({ ...RUN_OPTS, namesOnly: true }, baseDeps());
    assert.equal(new Set(entries.map((e) => e.id)).size, entries.length);
  });

  it("keeps going when one hunter's page 404s, and records why", async () => {
    const routes = DEFAULT_ROUTES.map(([p, v]) =>
      String(p).includes("Caitlyn") ? [p, () => response("gone", { status: 404 })] : [p, v]
    );
    const { summary, entries } = await runScrape({ ...RUN_OPTS, namesOnly: true }, baseDeps({ fetchFn: makeFetch(routes) }));

    assert.equal(summary.failed.length, 1);
    assert.equal(summary.failed[0].errorType, "ItemPageNotFoundError");
    assert.match(summary.failed[0].reason, /404/);
    assert.ok(summary.succeeded.length >= 2, "other hunters still scraped");
    assert.ok(entries.some((e) => e.id === "bad-hand"), "surviving hunters still reached the dataset");
  });

  it("reports Source values it could not classify so they can be re-derived from disk", async () => {
    const odd = SINGLE_VARIANT_HTML.replace(
      '<a href="/wiki/Bloodline" title="Bloodline">Bloodline</a> Rank 67',
      "Ancient Whispers Programme"
    );
    const routes = DEFAULT_ROUTES.map(([p, v]) => (String(p).includes("Caitlyn") ? [p, () => response(odd)] : [p, v]));
    const { unmappedSources, entries } = await runScrape({ ...RUN_OPTS, namesOnly: true }, baseDeps({ fetchFn: makeFetch(routes) }));

    assert.deepEqual(unmappedSources, ["Ancient Whispers Programme"]);
    const entry = entries.find((e) => e.portrait === "caitlyn-hammond");
    assert.equal(entry.source, "Ancient Whispers Programme", "verbatim source kept");
    assert.equal(entry.acquisition, null, "hunter not dropped");
  });

  it("creates no image files in names-only mode, and needs no image library", async () => {
    const deps = baseDeps({
      sharpLoader: async () => {
        throw new Error("sharp must not be loaded in names-only mode");
      },
    });
    await runScrape({ ...RUN_OPTS, namesOnly: true }, deps);
    assert.deepEqual([...deps.files.keys()], ["/data/hunters.json"]);
  });

  it("adds portraits on a later full run without disturbing existing ids", async () => {
    const deps = baseDeps();
    const namesOnly = await runScrape({ ...RUN_OPTS, namesOnly: true }, deps);
    const full = await runScrape(RUN_OPTS, deps);

    assert.deepEqual(namesOnly.entries.map((e) => e.id), full.entries.map((e) => e.id));
    assert.ok([...deps.files.keys()].some((k) => k.endsWith(".avif")));
  });

  it("deletes the previous pipeline's size variants and reports how many went", async () => {
    // The state this run actually meets on disk: 242 hunters' worth of `-thumb` companions that
    // the single-asset pipeline never emits. A run that only overwrote would leave them forever,
    // and SPEC-0004's payload scenarios could never fail.
    const deps = baseDeps();
    for (const slug of ["bad-hand", "the-revenant", "caitlyn-hammond"]) {
      deps.files.set(`/images/hunters/${slug}-thumb.avif`, Buffer.alloc(4000));
      deps.files.set(`/images/hunters/${slug}.avif`, Buffer.alloc(8000));
    }

    const result = await runScrape(RUN_OPTS, deps);

    assert.equal(result.staleRemoved, 3);
    const onDisk = [...deps.files.keys()].filter((p) => p.endsWith(".avif"));
    assert.deepEqual(onDisk.filter((p) => p.includes("-thumb")), [], "no stale variant survives");
    // Exactly one asset per hunter that has one, and every one of them is claimed by an entry.
    const claimed = new Set(
      result.entries.filter((e) => e.portrait).map((e) => `/images/hunters/${e.portrait}.avif`)
    );
    assert.deepEqual(onDisk.sort(), [...claimed].sort());
  });

  it("reports zero removed on a second consecutive run", async () => {
    const deps = baseDeps();
    deps.files.set("/images/hunters/bad-hand-thumb.avif", Buffer.alloc(4000));

    const first = await runScrape(RUN_OPTS, deps);
    assert.ok(first.staleRemoved > 0);

    const second = await runScrape(RUN_OPTS, deps);
    assert.equal(second.staleRemoved, 0, "a clean directory stays clean");
  });

  it("deletes nothing in names-only or dry-run mode", async () => {
    const namesOnlyDeps = baseDeps();
    namesOnlyDeps.files.set("/images/hunters/bad-hand-thumb.avif", Buffer.alloc(4000));
    const namesOnly = await runScrape({ ...RUN_OPTS, namesOnly: true }, namesOnlyDeps);
    assert.equal(namesOnly.staleRemoved, 0);
    assert.ok(namesOnlyDeps.files.has("/images/hunters/bad-hand-thumb.avif"));

    const dryDeps = baseDeps();
    dryDeps.files.set("/images/hunters/bad-hand-thumb.avif", Buffer.alloc(4000));
    const dry = await runScrape({ ...RUN_OPTS, dryRun: true }, dryDeps);
    assert.equal(dry.staleRemoved, 0);
    assert.ok(dryDeps.files.has("/images/hunters/bad-hand-thumb.avif"));
  });

  it("does not sweep on a --limit run, whose dataset covers only a slice of the roster", async () => {
    // Sweeping against a partial dataset would delete the art of every hunter past the limit,
    // turning a development aid into a destructive one.
    const deps = baseDeps();
    deps.files.set("/images/hunters/somebody-else.avif", Buffer.alloc(8000));

    const result = await runScrape({ ...RUN_OPTS, limit: 1 }, deps);

    assert.equal(result.staleRemoved, 0);
    assert.ok(deps.files.has("/images/hunters/somebody-else.avif"));
  });

  it("fails the run when the accumulating payload breaches the total ceiling", async () => {
    // Every asset here is comfortably inside its per-asset budget — which is the whole point.
    // Per-asset compliance says nothing about aggregate weight, so the total needs its own gate.
    const deps = baseDeps();
    await assert.rejects(
      () => runScrape({ ...RUN_OPTS, totalBudgetBytes: 10_000 }, deps),
      (err) => err instanceof BudgetExceededError && /total ceiling/.test(err.message)
    );
  });

  it("reports the projected total and the ceiling when it fails", async () => {
    const deps = baseDeps();
    await assert.rejects(
      () => runScrape({ ...RUN_OPTS, totalBudgetBytes: 10_000 }, deps),
      (err) => /reached \d+ bytes, over the 10000-byte total ceiling/.test(err.message)
    );
  });

  it("holds the shipped ceiling at the 12 MB SPEC-0004 specifies", () => {
    assert.equal(TOTAL_BUDGET_BYTES, 12 * 1024 * 1024);
  });

  it("surfaces a missing image library before spending a single page fetch", async () => {
    const calls = [];
    const deps = baseDeps({
      fetchFn: makeFetch(DEFAULT_ROUTES, { calls }),
      sharpLoader: async () => {
        throw new ImageProcessingUnavailableError("sharp not installed");
      },
    });
    await assert.rejects(() => runScrape(RUN_OPTS, deps), ImageProcessingUnavailableError);
    assert.deepEqual(calls.filter((u) => /\/wiki\//.test(u)), []);
  });
});

describe("CLI surface", () => {
  it("parses the documented flags", () => {
    const opts = parseArgs(["--names-only", "--force", "--delay-ms=250", "--limit=3"]);
    assert.equal(opts.namesOnly, true);
    assert.equal(opts.force, true);
    assert.equal(opts.delayMs, 250);
    assert.equal(opts.limit, 3);
  });

  it("defaults to a full, rate-limited, non-forcing run", () => {
    const opts = parseArgs([]);
    assert.equal(opts.namesOnly, false);
    assert.equal(opts.force, false);
    assert.equal(opts.dryRun, false);
    assert.ok(opts.delayMs > 0, "never defaults to hammering the wiki");
  });

  it("ignores nonsense values rather than adopting them", () => {
    assert.ok(parseArgs(["--delay-ms=-5"]).delayMs > 0);
    assert.equal(parseArgs(["--limit=nope"]).limit, Infinity);
  });

  it("reports budget use, stale removals and unmapped sources in the summary", () => {
    const text = formatSummary(
      { succeeded: [{ hunter: "A" }], failed: [{ hunter: "B", reason: "404" }], skipped: [] },
      { entries: 3, assetBytes: 2 * 1024 * 1024, staleRemoved: 242, unmappedSources: ["Mystery Source"] }
    );
    assert.match(text, /1 succeeded, 1 failed/);
    assert.match(text, /2\.00 MB of 12 MB budget/);
    assert.match(text, /stale assets removed: 242/);
    assert.match(text, /Mystery Source/);
    assert.match(text, /FAILED\s+B: 404/);
  });
});

describe("image processing dependency", () => {
  it("wraps a load failure in a sentinel that names the escape hatch", async () => {
    await assert.rejects(
      () => loadImageProcessor(async () => {
        throw new Error("Cannot find module 'sharp'");
      }),
      (err) => err instanceof ImageProcessingUnavailableError && /--names-only/.test(err.message)
    );
  });

  it("unwraps a default export", async () => {
    const fake = { default: () => "processor" };
    assert.equal(await loadImageProcessor(async () => fake), fake.default);
  });
});

describe("readExistingIds", () => {
  it("returns an empty map when no dataset exists yet", async () => {
    assert.equal((await readExistingIds("/nope.json", async () => { throw new Error("ENOENT"); })).size, 0);
  });

  it("survives a corrupt dataset rather than aborting the run", async () => {
    assert.equal((await readExistingIds("/x.json", async () => "{not json")).size, 0);
  });

  it("keys ids by portrait slug", async () => {
    const map = await readExistingIds("/x.json", async () =>
      JSON.stringify([{ id: "a", portrait: "p-a" }, { id: "b", portrait: null }])
    );
    assert.equal(map.get("p-a"), "a");
    assert.equal(map.size, 1);
  });
});
