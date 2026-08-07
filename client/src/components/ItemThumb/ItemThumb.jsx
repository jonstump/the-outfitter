import { useState } from "react";

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

export function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

export default function ItemThumb({ category, name, svgPath, svgFill = "#8a6f42", className }) {
  const [extIndex, setExtIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);

  const tryImage = Boolean(category) && !imageFailed && extIndex < IMAGE_EXTENSIONS.length;

  return (
    <span className={`item-thumb${className ? ` ${className}` : ""}`}>
      {tryImage ? (
        <img
          src={`/images/${category}/${slugify(name)}.${IMAGE_EXTENSIONS[extIndex]}`}
          alt={name}
          onError={() => {
            if (extIndex < IMAGE_EXTENSIONS.length - 1) setExtIndex((i) => i + 1);
            else setImageFailed(true);
          }}
        />
      ) : (
        <svg viewBox="0 0 96 40" role="img" aria-label={name}>
          <path d={svgPath} fill={svgFill} />
        </svg>
      )}
    </span>
  );
}
