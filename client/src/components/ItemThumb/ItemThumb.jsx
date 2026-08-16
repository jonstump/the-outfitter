import { useState } from "react";
import { slugify } from "../../utils/slugify.js";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Implements: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"
//
// Shared render primitive for all four category call sites (WeaponSlot, EquipmentSlot,
// TraitsPanel, PickerRow). Renders the scraped/self-hosted photo when one exists at
// /images/{category}/{slug}.{ext} (see shared contract with issue #7's scrape script), and falls
// back to the item's SVG icon (from catalog.js) the moment every known extension has failed to
// load. `category` is undefined for callers that have no scraped-image tier yet (there are none
// today, but this keeps the component usable that way) — in that case it renders the SVG
// immediately without attempting a network request.
//
// Deliberately NOT the literal `IMAGES` per-item manifest design.md sketches: guessing the URL
// from the item's name + trying known extensions means the scrape script (client/public/images/)
// can add, replace, or re-extension images without any code change here ever being required to
// pick them up. See the longer note in client/src/data/catalog.js.

// `png` leads because the committed scrape tree is all avif/png (zero jpg/jpeg/webp as of
// #391's audit) — every other order costs two wasted requests (each a 200 carrying the SPA's
// index document, per server/src/index.js's static-then-catch-all ordering, not a 404) before
// reaching the extension that actually exists. The rest of the chain stays: it exists so the
// scrape can re-extension its output without a code change here (see the file-level note above).
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

// Hunter portraits never reach this: HunterPortrait always calls ItemThumb with `sources`
// (its own AVIF candidate list, derived in data/hunters.js), and candidateSources() below
// returns `sources` before category-derived extensions are ever consulted. A former
// `EXTENSIONS_BY_CATEGORY` per-category ordering hint lived here for that case and was dead
// code — removed by #391 rather than kept describing traffic that cannot occur.
export function extensionsFor(category) {
  return IMAGE_EXTENSIONS;
}

// Re-exported, not redefined. This component is the READER end of the asset-path contract;
// scripts/lib/wiki.mjs is the writer. Both now import client/src/utils/slugify.js, because
// the two local copies that used to live here and there had already drifted on apostrophes
// and diacritics (issue #119). Callers that imported `slugify` from this module keep working.
export { slugify };

/**
 * Candidate URLs to try, in order, before giving up and rendering the SVG.
 *
 * Derived from `category` + `name` for items — one URL per known extension, which is the
 * arrangement that keeps the scrape free to re-extension its output. Callers that already
 * KNOW their URLs pass `sources` instead: hunter portraits derive theirs from the dataset's
 * own slug (SPEC-0003 "Hunter Dataset Consumption Contract"). Same fallback machinery,
 * different candidates — which is the point of pulling it out here rather than growing a
 * second component.
 *
 * That list is ONE candidate long for portraits since #148, and the generality still earns
 * its keep: it is the same `onError` walk the item extension chain rides, and a single
 * candidate is the degenerate case of it rather than a second code path.
 *
 * An empty result means "go straight to the SVG": no category, or a caller that knows
 * there is no asset to ask for. Neither issues a network request.
 */
function candidateSources({ sources, category, name }) {
  if (sources) return sources;
  if (!category) return [];
  return extensionsFor(category).map((ext) => `/images/${category}/${slugify(name)}.${ext}`);
}

/**
 * `alt` defaults to `name`, which is right for every item call site — the thumb is the only
 * thing identifying that row. Pass `alt=""` where the name is already visible adjacent to
 * the image, so assistive tech does not announce it twice. An empty alt makes the SVG
 * fallback decorative too, rather than leaving it labelled with a raw internal id.
 *
 * `loading="lazy"` is opt-in via `loading`. The picker renders 242 tiles, and SPEC-0003
 * requires bytes fetched to be proportional to what was scrolled to; item rows are few
 * enough that eager loading is still the better default there.
 */
export default function ItemThumb({
  category,
  name,
  alt,
  svgPath,
  svgFill = "#8a6f42",
  className,
  sources,
  loading,
}) {
  const label = alt === undefined ? name : alt;
  const decorative = label === "";
  const [srcIndex, setSrcIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);

  const candidates = candidateSources({ sources, category, name });

  // How far the chain has walked is state ABOUT a particular candidate list, so it has to be
  // discarded when that list changes. Without this, a component instance reused at a stable
  // JSX position — `ExpandedList`'s header art as the open list switches, or the create-form
  // preview across successive picks — carries one subject's exhausted chain onto the next,
  // and a hunter whose portrait exists renders the silhouette because the PREVIOUS hunter's
  // portrait failed.
  //
  // Reset during render rather than in an effect: an effect would paint one frame from the
  // stale index first, which is the flash of a wrong portrait. This is React's documented
  // "adjust state when a prop changes" pattern. Kept here rather than pushed onto callers as
  // a `key` so the invariant holds for every call site, including ones not yet written.
  const candidateKey = candidates.join("|");
  const [renderedKey, setRenderedKey] = useState(candidateKey);
  if (renderedKey !== candidateKey) {
    setRenderedKey(candidateKey);
    setSrcIndex(0);
    setImageFailed(false);
  }

  const tryImage = !imageFailed && srcIndex < candidates.length;

  return (
    <span className={`item-thumb${className ? ` ${className}` : ""}`}>
      {tryImage ? (
        <img
          src={candidates[srcIndex]}
          alt={label}
          // Governing: SPEC-0006 REQ "Items Are Rearranged by Direct Manipulation".
          // Images are natively draggable in HTML, and a press-then-move on the
          // thumbnail starts an HTML5 drag that fires pointercancel and ends the
          // pointer gesture before pointerup — the equipment tile's grab-and-drop
          // never completes (issue #302, Defect A). All callers sit inside controls
          // that own their gestures, so no thumbnail is ever a drag source.
          draggable={false}
          {...(loading ? { loading } : {})}
          onError={() => {
            if (srcIndex < candidates.length - 1) setSrcIndex((i) => i + 1);
            else setImageFailed(true);
          }}
        />
      ) : (
        <svg
          viewBox="0 0 96 40"
          {...(decorative ? { "aria-hidden": "true" } : { role: "img", "aria-label": label })}
        >
          <path d={svgPath} fill={svgFill} />
        </svg>
      )}
    </span>
  );
}
