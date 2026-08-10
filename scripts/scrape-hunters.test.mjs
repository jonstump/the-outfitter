// Governing: ADR-0007 (Hunter Roster Dataset), ADR-0005 (shared wiki client)
// Implements: SPEC-0004 — every requirement's scenarios, exercised with an injected fetchFn.
//
// scripts/scrape-hunters.test.mjs
//
// These tests NEVER touch the network: every fetch is injected, so `npm test` and CI make zero
// requests to huntshowdown.wiki.gg. The HTML fixtures below are reduced from real pages captured
// while building the parser, preserving exactly the structure the parser keys on — both DRUID
// infobox shapes, the tabbed Source row, the redirect-bearing RLCONF blob, and the roster gallery.

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import {
  ACQUISITION_RULES,
  BudgetExceededError,
  ImageProcessingUnavailableError,
  PORTRAIT_SIZES,
  TOTAL_BUDGET_BYTES,
  buildMediaUrl,
  decodeEntities,
  deriveObtainable,
  encodePortraits,
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
  stripTags,
  readRlconf,
  runScrape,
  scrapeHunterPage,
} from "./scrape-hunters.mjs";

import { ItemPageNotFoundError, RateLimiter } from "./lib/wiki.mjs";

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

/** A sharp stand-in: records calls and returns buffers of a controllable size. */
function fakeSharp(bytesByWidth = { 192: 3000, 320: 6000 }, { sourceWidth = 384 } = {}) {
  const calls = [];
  const factory = () => {
    let width = null;
    const api = {
      metadata: async () => ({ width: sourceWidth, height: 256, format: "png" }),
      resize: (opts) => {
        width = opts.width;
        calls.push(opts);
        return api;
      },
      avif: () => api,
      toBuffer: async () => Buffer.alloc(bytesByWidth[width] ?? 1000),
    };
    return api;
  };
  factory.calls = calls;
  return factory;
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
    fsReadFile: async (p) => {
      if (!files.has(p)) throw new Error("ENOENT");
      return files.get(p);
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
  it("produces both sizes at the specified widths", async () => {
    const sharp = fakeSharp();
    const out = await encodePortraits(PNG_BYTES, sharp, { hunter: "X" });
    assert.deepEqual(
      out.map((o) => [o.name, o.width]),
      [["thumb", 192], ["full", 320]]
    );
  });

  it("does not upscale a source narrower than the target width", async () => {
    const sharp = fakeSharp({ 150: 900 }, { sourceWidth: 150 });
    const out = await encodePortraits(PNG_BYTES, sharp, { hunter: "Tiny" });
    assert.deepEqual(out.map((o) => o.width), [150, 150]);
  });

  it("rejects an oversized asset rather than returning it to be written", async () => {
    const sharp = fakeSharp({ 192: 99_000, 320: 6000 });
    await assert.rejects(
      () => encodePortraits(PNG_BYTES, sharp, { hunter: "Chonk" }),
      (err) => err instanceof BudgetExceededError && /thumb.*99000.*15360/s.test(err.message)
    );
  });

  it("holds the thumbnail to a smaller budget than the full size", () => {
    const [thumb, full] = PORTRAIT_SIZES;
    assert.ok(thumb.maxBytes < full.maxBytes);
    assert.ok(thumb.width < full.width);
  });

  it("names assets so both URLs derive from the slug with no manifest", () => {
    assert.equal(portraitAssetPath("/i", "bad-hand", "full"), "/i/bad-hand.avif");
    assert.equal(portraitAssetPath("/i", "bad-hand", "thumb"), "/i/bad-hand-thumb.avif");
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

  it("writes both sizes per variant when portraits are enabled", async () => {
    const fs = memoryFs();
    const result = await scrapeHunterPage({ wikiPath: "Hunters/Caitlyn_Hammond" }, pageDeps(fs));

    assert.deepEqual([...fs.files.keys()].sort(), [
      "/images/hunters/caitlyn-hammond-thumb.avif",
      "/images/hunters/caitlyn-hammond.avif",
    ]);
    assert.equal(result.bytes, 9000);
  });

  it("writes nothing under the images root in names-only mode", async () => {
    const fs = memoryFs();
    await scrapeHunterPage({ wikiPath: "Hunters/Caitlyn_Hammond" }, pageDeps({ ...fs, namesOnly: true, sharp: null }));
    assert.equal(fs.files.size, 0);
  });

  it("does not write an oversized asset — the budget is checked before disk", async () => {
    const fs = memoryFs();
    await assert.rejects(
      () => scrapeHunterPage({ wikiPath: "Hunters/Caitlyn_Hammond" }, pageDeps({ ...fs, sharp: fakeSharp({ 192: 99_000, 320: 6000 }) })),
      BudgetExceededError
    );
    assert.equal(fs.files.size, 0, "no partial write survived the rejection");
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
    assert.equal(forced.assets.length, 2);
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

  it("reports budget use and unmapped sources in the summary", () => {
    const text = formatSummary(
      { succeeded: [{ hunter: "A" }], failed: [{ hunter: "B", reason: "404" }], skipped: [] },
      { entries: 3, assetBytes: 2 * 1024 * 1024, unmappedSources: ["Mystery Source"] }
    );
    assert.match(text, /1 succeeded, 1 failed/);
    assert.match(text, /2\.00 MB of 12 MB budget/);
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
