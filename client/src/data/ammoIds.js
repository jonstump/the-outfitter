// Governing: ADR-0014, SPEC-0010 REQ "Every Legacy Ammo Selection Migrates to the Round It Named", issue #339
//
// A saved ammo selection persists as a BARE INDEX into `AMMO[ammoClass]` (see the WIRE-FORMAT GATE
// comment above `AMMO` in catalog.js). The only thing that ever said what index 1 of `medium` meant
// was the current contents of that array — once the pool changes, the mapping is gone and cannot be
// recovered from the repository. catalog.js records the Frontier 73C incident this caused: a
// corrected `ammoClass` silently turned a saved Spitzer (worth 60) into a High Velocity (worth 13)
// with no error shown.
//
// This module freezes today's `AMMO` — the contents pinned by catalog.test.js's WIRE-FORMAT GATE
// test as of issue #339 — as a committed, literal index-to-id table, in the same shape
// loadoutCodec.js already uses for `LEGACY_TRAIT_IDS` / `legacyId()`. It is deliberately NOT computed
// from the live `AMMO` object: the whole point is that this table keeps naming the round a legacy
// index meant even after `AMMO` itself changes (see #340, which will do exactly that).
//
// Id convention (ADR-0014): `ammo-{ammoClass}-{slugified round name}`, matching the slug-style ids
// catalog.js already uses for weapons/tools/cons/traits (see that file's header comment) and the
// canonical slug derivation in client/src/utils/slugify.js. Ammo rows don't carry ids of their own
// in `AMMO` yet, so this table is also where those ids are first minted — one per row, all 31, plus
// both currently-empty pools (`special`, `none`) so a stored index against either still resolves to
// `null` rather than to undefined behaviour.
//
// This table is a SNAPSHOT, not a live view. It MUST NOT be edited to track future changes to `AMMO`
// — a later insert/remove/reorder in `AMMO` (gated by the same WIRE-FORMAT GATE comment) does not
// touch this file. A deliberate correction to the snapshot itself (a mistake in the id minted below)
// is allowed, but the commit message must say so explicitly, the same discipline
// loadoutCodec.js's "CHANGING THIS PIN MEANS CHANGING HISTORY" note requires for the trait table.
//
// NOTE ON SCOPE: this file is intentionally not imported anywhere in production code yet. Wiring the
// resolver below into the decoder (`fromData`, `fromLegacy`, `boundedAmmo`, etc. in
// loadoutCodec.js) is issue #343's job, not this one's — see issue #339.
export const LEGACY_AMMO_IDS = {
  compact: [
    "ammo-compact-fmj",
    "ammo-compact-high-velocity",
    "ammo-compact-dumdum",
    "ammo-compact-incendiary",
    "ammo-compact-poison",
  ],
  medium: [
    "ammo-medium-fmj",
    "ammo-medium-spitzer",
    "ammo-medium-dumdum",
    "ammo-medium-incendiary",
    "ammo-medium-poison",
  ],
  long: [
    "ammo-long-fmj",
    "ammo-long-spitzer",
    "ammo-long-dumdum",
    "ammo-long-incendiary",
  ],
  slong: [
    "ammo-slong-fmj",
    "ammo-slong-spitzer",
    "ammo-slong-incendiary",
  ],
  shotgun: [
    "ammo-shotgun-slug",
    "ammo-shotgun-flechette",
    "ammo-shotgun-penny-shot",
    "ammo-shotgun-dragon-breath",
    "ammo-shotgun-starshell",
  ],
  xbow: [
    "ammo-xbow-explosive-bolt",
    "ammo-xbow-shot-bolt",
    "ammo-xbow-poison-bolt",
  ],
  hxbow: [
    "ammo-hxbow-chaos-bolt",
    "ammo-hxbow-concertina-bolt",
    "ammo-hxbow-choke-bolt",
  ],
  bow: [
    "ammo-bow-frag-arrow",
    "ammo-bow-concertina-arrow",
    "ammo-bow-poison-arrow",
  ],
  // Empty by fact, same as AMMO.special in catalog.js — a stored index against this class still
  // needs to resolve to null rather than hitting undefined behaviour (e.g. array-out-of-bounds on a
  // table that was never given a slot for this class at all).
  special: [],
  none: [],
};

/**
 * Resolve a legacy `(ammoClass, index)` ammo selection to the stable id of the round it named,
 * against the frozen snapshot above — never against the live `AMMO` object.
 *
 * Pure. Never throws. Returns `null` for:
 *   - an ammoClass the frozen table has no entry for
 *   - an index that is not a non-negative integer (negative, fractional, NaN, etc.)
 *   - an index at or beyond the frozen pool's length for that class (including every index
 *     against the two empty pools, `special` and `none`)
 *
 * Governing: SPEC-0010 REQ "Every Legacy Ammo Selection Migrates to the Round It Named" — "An index
 * that cannot be resolved SHALL decode to 'no round chosen'. It MUST NOT decode to a different
 * round, and MUST NOT throw."
 */
export function legacyAmmoId(ammoClass, index) {
  const table = LEGACY_AMMO_IDS[ammoClass];
  if (!table) return null;
  if (!Number.isInteger(index) || index < 0 || index >= table.length) return null;
  return table[index] ?? null;
}
