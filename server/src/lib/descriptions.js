// Governing: ADR-0006 (list filing model), ADR-0007 (dataset carries descriptions),
// SPEC-0003 REQ "Lists Carry an Editable Description", SPEC-0003 REQ "Loadouts Carry a
// Description of Their Own", SPEC-0003 Security Requirements ("Request Body Size Limits")
//
// TWO records carry a description — a list and a loadout — and they mean different things by
// it. A list's null is "inherit the hunter's lore"; a loadout's null is simply "no note". What
// they share is the wire discipline: presence of the key is the instruction, the text is stored
// verbatim, and the same cap governs both. That shared half lives here rather than in either
// route, because SPEC-0003's whole risk register on this field is about the three states being
// collapsed to two, and two hand-written copies of the check is how the copies come to disagree.

/**
 * The cap on STORED description text, in code points.
 *
 * SPEC-0003's Security Requirements ask for a named constant of at least 1000 characters. The
 * floor is not arbitrary: the hunters dataset's longest description is 404 ("The Night Seer"),
 * and that text is what a user starts from when they edit a LIST — the only description the app
 * seeds from the dataset — so a cap that could not hold it would reject the default the
 * application itself offered.
 *
 * It governs stored text only. A description resolved live from the dataset is never written to
 * a record and is therefore never measured here, so a future scrape producing longer prose
 * cannot retroactively invalidate a stored record or fail a read.
 */
export const DESCRIPTION_MAX_CHARS = 1000;

/**
 * How many characters a description is, in the unit its own rejection message names.
 *
 * `String.prototype.length` counts UTF-16 CODE UNITS, which charges two for every emoji and
 * every other non-BMP glyph — so a 501-emoji note would be refused by a message that claims a
 * 1000-character limit. That fails closed, but it fails closed while saying something untrue,
 * and the user cannot act on it. Spreading iterates by code point instead, which is the unit a
 * person counting what they typed is counting.
 *
 * Code points, not grapheme clusters: a flag or a family emoji is still several. Segmenting
 * properly would need `Intl.Segmenter` and would make the cap depend on the ICU data the
 * runtime happens to carry, which is a worse trade for a courtesy limit. What matters is that
 * the number is bounded and the message is honest about what it counted.
 *
 * The storage consequence is checked, not assumed: 1000 code points is at most 4000 bytes of
 * UTF-8, well inside the 64kb request-body limit set in index.js.
 */
export const charCount = (s) => [...s].length;

/**
 * Validate a caller-supplied description and answer with the value to store.
 *
 * Called ONLY when the key is present in the body — "omitted" is a third answer that means
 * "leave the field alone", and it is the caller's job to check for the key before asking.
 * Folding that check in here would make an omitted key indistinguishable from `null`, which is
 * the exact collapse this requirement exists to prevent.
 *
 * The text is stored VERBATIM: no trim. Trimming would silently turn a whitespace-only
 * description into the empty state, which is a state change the user did not ask for. The cap
 * therefore governs exactly what is stored.
 *
 * Writes its own 400 onto `res` and answers `{ ok: false }`, so a handler reads as a straight
 * line of guards rather than a nest of error shapes.
 */
export function validateDescription(description, res) {
  if (description === null) return { ok: true, value: null };
  if (typeof description !== "string") {
    res.status(400).json({ error: "description must be a string or null" });
    return { ok: false };
  }
  if (charCount(description) > DESCRIPTION_MAX_CHARS) {
    // The rejected text is NOT echoed back. It is user prose, one of whose two sources was
    // scraped off-origin, and an error body is the easiest place for it to end up somewhere it
    // was never rendered as text — a log aggregator, a bug report, a toast built by
    // concatenation. The cap is the only thing the caller needs told.
    res.status(400).json({ error: `description must be at most ${DESCRIPTION_MAX_CHARS} characters` });
    return { ok: false };
  }
  return { ok: true, value: description };
}
