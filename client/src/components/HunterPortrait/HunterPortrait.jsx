// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
// Hunter Portraits), ADR-0007 (as amended 2026-08-10), ADR-0002 (self-hosted imagery),
// SPEC-0003 REQ "Hunter Dataset Consumption Contract", SPEC-0004 REQ "Consumption Contract
// Compatibility"
//
// The single place a hunter's likeness is rendered — list cards, expanded headers, and
// picker tiles all come through here, so the fallback ladder is defined once.
//
// The ladder, in order:
//   1. the hunter's portrait         (one asset, derived from the `portrait` slug alone)
//   2. the deterministic silhouette  (hunterThumb, issue #100 — SPEC-0001's placeholder tier)
//
// TWO RUNGS, NOT THREE (#148). There used to be a middle rung: request the size suited to
// the context, fall back to the OTHER size, and only then the silhouette. ADR-0007's
// 2026-08-10 amendment collapsed the two sizes into one trimmed portrait, so there is no
// other size to fall back to and no `size` prop to pick between them. The prop is gone
// rather than ignored — SPEC-0003 requires that no call site be able to ask for a size.
//
// Step 1 is `sources` handed to ItemThumb, which already owns the `<img onError>` walk.
// Step 2 is its existing SVG tier. Nothing new was invented for portraits; the chain was
// widened from "try each extension" to "try each candidate URL", and a one-candidate list
// walks it exactly as a two-candidate one did.
//
// Portraits are trimmed to their own subject, so they VARY in dimensions and aspect ratio
// between hunters (SPEC-0003). Nothing here states a size: every surface sizes its own box
// in CSS and lets `object-fit: cover` do the fitting, which is what lets this component be
// the same component in a 154×220 card and a 96px picker tile.
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
 * @param alt       "" where the list name is visibly adjacent, so it is announced once
 * @param lazy      defer the fetch until the image nears the viewport (default true)
 *
 * There is deliberately no `size`: a hunter has one portrait, and every surface scales it
 * with `object-fit: cover` rather than asking for a variant.
 *
 * Returns null when there is no hunter at all — a list that never claimed an identity has
 * none to depict, and the caller renders its name monogram instead. That is a different
 * state from "hunter we cannot resolve", which does render the neutral silhouette.
 */
export default function HunterPortrait({ hunterId, alt = "", lazy = true, className }) {
  if (!hunterId) return null;

  return (
    <ItemThumb
      // `name` is the hunter id: unused for the URL (sources wins) but it is what an
      // explicit non-empty alt would otherwise fall back to, and it keeps the element
      // identifiable in tests and the DOM.
      name={hunterId}
      alt={alt}
      sources={portraitSources(hunterId)}
      svgPath={hunterThumb(hunterId)}
      className={className}
      loading={lazy ? "lazy" : undefined}
    />
  );
}
