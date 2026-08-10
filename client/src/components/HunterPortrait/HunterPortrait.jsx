// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
// Hunter Portraits), ADR-0007 (Scrape the Full Hunter Roster into a Generated Dataset),
// ADR-0002 (self-hosted imagery), SPEC-0003 REQ "Hunter Dataset Consumption Contract"
//
// The single place a hunter's likeness is rendered — list cards, expanded headers, and
// picker tiles all come through here, so the fallback ladder is defined once.
//
// The ladder, in order:
//   1. the requested size            (thumb for cards and tiles, full for an expanded header)
//   2. the other size                (a too-large image is a cost; an empty tile is a defect)
//   3. the deterministic silhouette  (hunterThumb, issue #100 — SPEC-0001's placeholder tier)
//
// Steps 1 and 2 are `sources` handed to ItemThumb, which already owns the `<img onError>`
// walk. Step 3 is its existing SVG tier. Nothing new was invented for portraits; the chain
// was widened from "try each extension" to "try each candidate URL".
//
// Two cases skip the network entirely, and both are specified rather than defensive:
// a hunterId absent from the dataset, and a dataset entry with no `portrait` slug. There
// is no path to derive in either case, so `portraitSources` returns nothing and the
// silhouette renders on the first paint. The list stays fully usable either way — it is
// identified by its own name and accent, neither of which depends on the roster.

import ItemThumb from "../ItemThumb/ItemThumb.jsx";
import { hunterThumb } from "../../data/catalog.js";
import { portraitSources } from "../../data/hunters.js";

/**
 * @param hunterId  the list's stored hunter reference; may be null, or absent from the dataset
 * @param size      "thumb" (default) or "full"
 * @param alt       "" where the list name is visibly adjacent, so it is announced once
 * @param lazy      defer the fetch until the image nears the viewport (default true)
 *
 * Returns null when there is no hunter at all — a list that never claimed an identity has
 * none to depict, and the caller renders its name monogram instead. That is a different
 * state from "hunter we cannot resolve", which does render the neutral silhouette.
 */
export default function HunterPortrait({ hunterId, size = "thumb", alt = "", lazy = true, className }) {
  if (!hunterId) return null;

  return (
    <ItemThumb
      // `name` is the hunter id: unused for the URL (sources wins) but it is what an
      // explicit non-empty alt would otherwise fall back to, and it keeps the element
      // identifiable in tests and the DOM.
      name={hunterId}
      alt={alt}
      sources={portraitSources(hunterId, size)}
      svgPath={hunterThumb(hunterId)}
      className={className}
      loading={lazy ? "lazy" : undefined}
    />
  );
}
