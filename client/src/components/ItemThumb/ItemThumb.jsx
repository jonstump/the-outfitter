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

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

// Hunter portraits are AVIF and only AVIF: SPEC-0004's scrape encodes both sizes with no format
// fallback chain, so every other extension is a guaranteed 404 for this category.
//
// This is a per-CATEGORY ordering hint, not the per-item `IMAGES` manifest the note above rejects
// — it says nothing about which hunters exist, and the scrape can still add, replace or remove
// assets with no change here. The ordering earns its keep: the picker renders the full roster, so
// a shared chain would cost either one wasted request per item image (avif first) or several per
// portrait (avif last). Neither is acceptable at roster scale, and a category split costs nothing.
const EXTENSIONS_BY_CATEGORY = { hunters: ["avif"] };

export function extensionsFor(category) {
  return EXTENSIONS_BY_CATEGORY[category] ?? IMAGE_EXTENSIONS;
}

// Re-exported, not redefined. This component is the READER end of the asset-path contract;
// scripts/lib/wiki.mjs is the writer. Both now import client/src/utils/slugify.js, because
// the two local copies that used to live here and there had already drifted on apostrophes
// and diacritics (issue #119). Callers that imported `slugify` from this module keep working.
export { slugify };

/**
 * `alt` defaults to `name`, which is right for every item call site — the thumb is the only
 * thing identifying that row. Pass `alt=""` where the name is already visible adjacent to
 * the image, so assistive tech does not announce it twice. An empty alt makes the SVG
 * fallback decorative too, rather than leaving it labelled with a raw internal id.
 */
export default function ItemThumb({ category, name, alt, svgPath, svgFill = "#8a6f42", className }) {
  const label = alt === undefined ? name : alt;
  const decorative = label === "";
  const [extIndex, setExtIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);

  const extensions = extensionsFor(category);
  const tryImage = Boolean(category) && !imageFailed && extIndex < extensions.length;

  return (
    <span className={`item-thumb${className ? ` ${className}` : ""}`}>
      {tryImage ? (
        <img
          src={`/images/${category}/${slugify(name)}.${extensions[extIndex]}`}
          alt={label}
          onError={() => {
            if (extIndex < extensions.length - 1) setExtIndex((i) => i + 1);
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
