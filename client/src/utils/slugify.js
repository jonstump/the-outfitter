// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape), ADR-0005 (shared wiki client)
// Implements: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback"
//
// THE canonical slug derivation for the asset-path contract
// `client/public/images/{category}/{slug}.{ext}`, keyed by catalog item display name
// ("Nagant M1895" -> "nagant-m1895").
//
// That contract has two ends, and they must compute the same string or the art silently
// disappears:
//
//   writer — scripts/lib/wiki.mjs decides the filename the scrape writes to disk
//   reader — ItemThumb.jsx decides the URL the browser requests
//
// They used to carry a copy each, and the copies had already drifted: the client neither
// stripped diacritics nor dropped apostrophes, so "Hunter's Respite" would have been written
// as hunters-respite.png and requested as hunter-s-respite.png (issue #119). Nothing catches
// that at runtime — ItemThumb's onError chain walks every known extension and then renders
// the SVG fallback, which is indistinguishable from "not scraped yet". ADR-0005 named this
// exact failure mode when it required the shared wiki client.
//
// This module is the one definition. It lives on the CLIENT side of the tree on purpose:
// scripts/ may import from client/src/, but the client must never import from scripts/ —
// nothing under scripts/ may end up in the browser bundle. Keep it dependency-free so the
// scrape's plain-node import stays trivial.
//
// Changing this function renames every asset the scrape writes AND every URL the app
// requests. The two move together only because they share this definition; a change here is
// still a re-scrape or a rename of the committed files.

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
