// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
// Hunter Portraits), SPEC-0003 REQ "Lists Are Visually Distinguishable Independent of
// Portrait and Name"
//
// The client end of the accent contract. The SERVER owns assignment — see
// `nextAccent()` in server/src/routes/loadoutLists.js, which is authoritative and runs
// against the owner's persisted lists. This module owns two client concerns the server
// cannot have: mapping a stored hex onto the CSS custom property that renders it, and
// previewing the accent a not-yet-created list will receive.
//
// Why map hex -> custom property rather than writing the hex into a style attribute:
// SPEC-0003 requires the palette be "exposed as CSS custom properties in global.css" and
// forbids ad-hoc colour values. Rendering `var(--list-accent-3)` means the stylesheet
// stays the single place a palette value is written, so a future re-tune is a one-file
// change and a stored value that is NOT in the palette degrades to a neutral border
// instead of painting an unvetted colour that may fail SC 1.4.11.
//
// The palette separates by HUE, not luminance (olive vs teal is 1.02:1). Everything that
// renders an accent must therefore also render the list name — the accent is never the
// sole differentiator. See design.md "Accent palette: six fixed values".

export const LIST_ACCENTS = [
  { value: "#b04a3e", name: "Clay", cssVar: "--list-accent-1" },
  { value: "#7a8a4e", name: "Olive", cssVar: "--list-accent-2" },
  { value: "#5a6e96", name: "Slate", cssVar: "--list-accent-3" },
  { value: "#5e8a8a", name: "Teal", cssVar: "--list-accent-4" },
  { value: "#8a5e86", name: "Plum", cssVar: "--list-accent-5" },
  { value: "#a3703e", name: "Amber", cssVar: "--list-accent-6" },
];

/** The six palette hex values, in assignment order. Mirrors the server's ACCENT_PALETTE. */
export const ACCENT_VALUES = LIST_ACCENTS.map((a) => a.value);

const BY_VALUE = new Map(LIST_ACCENTS.map((a) => [a.value, a]));

/**
 * Resolve a stored accent to the CSS value that paints it.
 *
 * An unknown or absent accent resolves to `var(--border)` — the neutral the Unassigned
 * card already uses. A list whose accent cannot be resolved is still perfectly usable;
 * its name remains its identity, which is exactly what the spec says the name is for.
 */
export function accentVar(accent) {
  const entry = BY_VALUE.get(accent);
  return entry ? `var(${entry.cssVar})` : "var(--border)";
}

/** Human-readable name for a stored accent, for accessible labels. Null when unknown. */
export function accentName(accent) {
  return BY_VALUE.get(accent)?.name ?? null;
}

/**
 * Preview the accent the server will assign to the next list.
 *
 * Least-used-first among the lists already held, ties broken by palette order — the same
 * rule server-side. Duplicates are permitted by design once every value is in use, so this
 * never runs out of answers.
 *
 * NO LONGER PREVIEW-ONLY, and that has a consequence worth stating (#135). The create form
 * SEEDS its accent picker from this and always sends the result on the POST, so the server's
 * own least-used branch (`nextAccent` in server/src/routes/loadoutLists.js) is no longer
 * reachable from any client path. It stays, and stays tested, because the endpoint is public
 * and documents `accent` as optional — and because the server reads the owner's persisted
 * lists while this reads whatever the browser happens to hold, which is the weaker of the two
 * answers. The note beside `nextAccent` records the same thing from the other end.
 */
export function previewNextAccent(lists = []) {
  const counts = new Map(ACCENT_VALUES.map((c) => [c, 0]));
  for (const l of lists) {
    if (counts.has(l?.accent)) counts.set(l.accent, counts.get(l.accent) + 1);
  }
  let best = ACCENT_VALUES[0];
  let bestN = Infinity;
  for (const c of ACCENT_VALUES) {
    if (counts.get(c) < bestN) {
      bestN = counts.get(c);
      best = c;
    }
  }
  return best;
}
