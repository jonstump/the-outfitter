import { AMMO, CONS, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";
import { legacyAmmoId } from "../data/ammoIds.js";
// Governing: ADR-0024 ("loadable, not legal"), issue #472. The decoder no longer
// enforces game-rule caps (TRAIT_MAX, slotMax, the four-per-category consumable cap)
// — see `boundedTraits` and `boundedEquip` below for the contract and the reasoning.
// Those constants and predicates still live in `calc.js`, where the reducer and the
// live UI (the only places rule enforcement belongs) consume them.

export const LS_CUR = "hunt-outfitter-current";

// Wire format version. Bump when toData()'s shape changes so fromData() can
// migrate old encodings instead of misreading them (see issue #26 — the previous
// format referenced catalog items by raw array index, which silently remapped
// saved loadouts whenever the catalog was reordered or edited).
//
// Version 2 (ADR-0009): `e` is a fixed eight-element array where index IS the cell
// and `null` IS an empty cell, and `b` is an array of blocked cell indices rather
// than a count of trailing blocked cells. Version 1 records keep decoding — they
// were packed (insertion order) with a trailing blocked COUNt, and the v1->v2 lift
// below places each packed item in the cell it rendered in.
//
// Version 3 (ADR-0023): the weapon entry gains a third element, the dual-wield pair
// flag — [weaponId, ammoIndex, d]. Version 2 records keep decoding; a pair is
// expressible only from version 3 on.
//
// Version 4 (ADR-0014, SPEC-0010, issues #342/#343/#345): the ammo element becomes a
// two-slot array of stable ids rather than a bare index — [weaponId, [ammoId0, ammoId1],
// d]. Each slot is an id (the `ammo-{class}-{name}` slug) or null for an explicitly empty
// slot. Versions 1-3 keep decoding through the frozen index-to-id table (issue #339,
// client/src/data/ammoIds.js) — legacy resolution was live for two releases (#343) before
// this version started writing ids directly (#345), specifically so the server's version-4
// validator could deploy ahead of any client emitting it.
//
// Known, closed-off defect (issue #351): `frontier-73c` moved from `medium` to `compact`
// in commit `e9b2c1d` without a FORMAT_VERSION bump. A saved ammo selection is a bare
// integer index into `AMMO[ammoClass]`, so a record written before the move that carries
// `["frontier-73c", 1]` silently re-resolves to `compact[1]` (High Velocity, $13) instead
// of `medium[1]` (Spitzer, $60). The unversioned LEGACY half is repaired by
// `remapFrontierAmmo` below — unversioned records necessarily carry the pre-change
// catalog bundle, so the era is deterministic. The v1 and v2 halves are PERMANENTLY
// AMBIGUOUS and cannot be repaired: `toData` always stamps `v: FORMAT_VERSION` and the
// store subscriber persists every decoded loadout before it renders, so any legacy record
// opened even once since the version-2 bump is now an unmarked v2 record carrying
// `["frontier-73c", 1]`, indistinguishable from a native v2 record that legitimately
// means High Velocity. Do not attempt a blanket remap of all `["frontier-73c", 1]`
// selections — post-`e9b2c1d` records legitimately mean High Velocity.
export const FORMAT_VERSION = 4;

// Stable catalog id lookup: id -> tuple (tuple[0] is the id, name is tuple[1]).
const WEAPON_BY_ID = new Map(WEAPONS.map((t) => [t[0], t]));
const TOOL_BY_ID = new Map(TOOLS.map((t) => [t[0], t]));
const CONS_BY_ID = new Map(CONS.map((t) => [t[0], t]));
const TRAIT_BY_ID = new Map(TRAITS.map((t) => [t[0], t]));

function indexOfItem(list, id) {
  return list.findIndex((t) => t[0] === id);
}

function inRange(value, n) {
  return Number.isInteger(value) && value >= 0 && value < n;
}

/**
 * The ammo variant index a weapon actually has, or -1 for "no variant selected".
 *
 * Governing: issue #201.
 *
 * `a` is used as an index into `AMMO[pool]` at render time (WeaponsPanel/WeaponSlot) and at
 * cost time (utils/calc.js). An index past the end of that weapon's variant list makes both
 * read `[1]` off `undefined`, which throws — and because the store subscriber persists to
 * localStorage during the same dispatch that decoded it, the poisoned value is written
 * BEFORE the render that throws on it. Every later visit reads it back and blanks the app
 * again, with no hash and no in-app way out. So a decoder is the right place to stop it:
 * nothing downstream can persist what never decodes.
 *
 * It cannot be bounded by a constant. The pools have different lengths and `special`
 * (Dolch 96, Nitro Express) is empty, so the legacy decoder's fixed `5` still admitted a
 * crashing value for those two weapons — the same bug, one weapon class narrower. Bound it
 * against the pool the weapon in that slot actually draws from, and both decoders are
 * correct for every weapon.
 */
function boundedAmmo(weaponIndex, value) {
  const variants = AMMO[WEAPONS[weaponIndex][4]] || [];
  return inRange(value, variants.length) ? value : -1;
}

/**
 * The traits a decoded loadout is allowed to keep: the ids that survive catalog
 * resolution, with duplicates collapsed.
 *
 * Governing: ADR-0024 ("loadable, not legal"), issue #472.
 *
 * Decode no longer clamps a decoded trait list to `TRAIT_MAX`. The fifteen-trait cap
 * is a game rule, and per ADR-0024's contract the decoder MUST NOT enforce a game-rule
 * cap — that is the reducer and the UI's job, at the point of a live user action where
 * the player can see and choose to fix an over-cap record rather than have it silently
 * rewritten underneath them. The trait panel's over-capacity warning
 * (`traitOverCapacity` in `calc.js`, consumed by `TraitsPanel.jsx`) is what makes an
 * over-cap decode VISIBLE rather than silently wrong, exactly the way the equipment
 * panel's `equipOverCapacity` warning (PR #416) already does for the equipment grid.
 *
 * Decode clamps rather than throws, for the reason boundedAmmo above states: the store
 * subscriber persists a decoded loadout BEFORE it is rendered, so a decoder that
 * refused an over-cap list would write the record it rejects and then fail on it on
 * every later visit (issue #201). The dedupe still happens — a decoded loadout must
 * not carry duplicate ids, which is a syntactic repair (issue #357), not a rule cap.
 *
 * It takes the surviving ids in the order the decoder's own resolution step produces
 * them (id filter in v1, positional translation in legacy), so the list is stable and
 * deterministic.
 *
 * Governing: issue #357. Duplicate trait ids are collapsed, so the decoder does not
 * hand the rest of the system a list of fifteen copies of one trait that inflates
 * `upTotal` (which charges per copy). The manual UI already guards against re-adding a
 * present trait (`addTrait`); this only matters for hand-crafted or tampered records,
 * but the decoder is the single chokepoint every decode path shares, so fixing it here
 * covers all three decoders at once.
 *
 * Both decoders call this. A bound carried by one decoder and not the other is the defect PR
 * #203 had to fix for the ammo index, and is the reason this lives in one function.
 */
function boundedTraits(ids) {
  return [...new Set(ids)];
}

/**
 * The blocked-cell list a decoded loadout is allowed to keep: in-range integers,
 * each appearing once.
 *
 * Governing: ADR-0009, SPEC-0006 REQ "Version 1 Records Migrate Losslessly" —
 * "Decoding SHALL be total: ... no input SHALL produce a blocked list containing a
 * duplicate or an out-of-range index." The out-of-range half was already enforced;
 * the DUPLICATE half was not, and a record carrying nine copies of `0` decoded to a
 * nine-element blocked list. That was silent until `boundedEquip` started dividing
 * the grid by it: `8 - blocked.length` went negative, and a loop that drops items
 * until the count falls below a negative bound never terminates. Deduplicating here
 * closes the spec gap and removes the negative bound at its source, rather than
 * bounding the loop that tripped over it.
 */
function boundedBlocked(b) {
  if (!Array.isArray(b)) return [];
  return [...new Set(b.filter((c) => Number.isInteger(c) && c >= 0 && c < 8))];
}

/**
 * The equipment grid a decoded loadout is allowed to keep: resolved items and
 * preserved holes, with NO cap-driven eviction.
 *
 * Governing: ADR-0024 ("loadable, not legal"), issue #472.
 *
 * Decode no longer clamps a decoded equipment grid to `slotMax` (8 minus blocked
 * cells) or to ADR-0015's four-per-cap-category consumable ceiling. Both are game
 * rules, and per ADR-0024's contract the decoder MUST NOT enforce a game-rule cap —
 * that is the reducer and the UI's job, at the point of a live user action where the
 * player can see and choose to fix an over-cap record rather than have it silently
 * rewritten underneath them. The equipment panel's over-capacity warning
 * (`equipOverCapacity` in `calc.js`, consumed by `EquipmentPanel.jsx` via
 * `selectEquipOverCapacity`) already reads whatever the store holds regardless of how
 * it got there, so an over-cap decoded grid is already VISIBLE rather than silently
 * wrong — the clamp was redundant with that warning, not a prerequisite for it.
 *
 * The function preserves the structural, non-rule half of what it always did: it
 * resolves items against the catalog and preserves holes (a `null` cell stays a hole,
 * rather than being repacked). The eviction loop that used to call `dropLast` until
 * `equipOverCapacity` reported the grid was back within capacity is removed entirely.
 *
 * Decode clamps rather than throws, for the same reason `boundedTraits` does: the
 * store subscriber persists a decoded loadout BEFORE it renders, so a decoder that
 * refused an over-cap grid would write the record it rejects and then fail on it on
 * every later visit (issue #201). Degrading to absence (holes) is just as loadable
 * as clamping to a maximum, so nothing about avoiding the #201 hazard requires
 * clamping specifically.
 *
 * Compatibility note (ADR-0024): a record that was already clamped by a prior
 * decode-then-resave cycle under the old (clamping) code cannot have its dropped data
 * restored — this change only stops FUTURE clamping, it does not un-lose data a
 * prior decode already dropped. No action needed; don't be surprised if an existing
 * test fixture that was already trimmed stays trimmed.
 */
function boundedEquip(equip, blocked) {
  const result = [...equip];
  // Governing: ADR-0024, issue #472, item 4. An occupied-and-blocked cell resolves to a
  // hole (blocked wins) — the item is dropped, not the block. This matches how blocking
  // already refuses to apply to an occupied cell elsewhere in the interactive UI, and it
  // is the deterministic resolution both ends of the wire format now agree on. The server
  // resolves the same overlap in `isValidData` before storing, so a stored record should
  // never carry one — but the decoder resolves it again here as defence in depth, the
  // same way `boundedBlocked` deduplicates even though the server already does.
  const blockedSet = new Set(Array.isArray(blocked) ? blocked : []);
  for (const k of blockedSet) {
    if (Number.isInteger(k) && k >= 0 && k < result.length) result[k] = null;
  }
  return result;
}

export function emptyLoadout() {
  // Governing: ADR-0009 (fixed eight-cell sparse grid, `null` = empty),
  // SPEC-0006 REQ "Equipment Occupies a Fixed Eight-Cell Grid".
  // Malformed decodes land here as the well-formed empty grid rather than throwing.
  // `ammoIds` is issue #343's resolved-id-per-weapon-slot field — see withDecodeNotices.
  return {
    weapons: [null, null],
    equip: Array(8).fill(null),
    traits: [],
    blocked: [],
    name: "",
    decodeNotices: [],
    ammoIds: [null, null],
  };
}

// Governing: ADR-0014, SPEC-0010 REQ "Wire Format Version 4 References Rounds by Stable
// Id", REQ "A Weapon Holds Up to Two Independently Chosen Rounds", issue #345.
//
// Loadout STATE already carries ammo as stable ids (`weapons[k].ammo`, #344's "switch the
// readers" change) — a two-element array, one entry per slot, each an id or null. Now that
// FORMAT_VERSION is 4, the wire carries exactly that shape verbatim: no index translation,
// no live-pool lookup, no Frontier-73C-style hazard, because the wire finally names the
// round directly instead of a position. Sanitized to exactly two entries defensively — a
// decoder-produced loadout can still reach `toData` with no `.ammo` at all (the Katana
// promotion in `promoteToWeaponSlots` builds `{i, a}` by design, #330), and that degrades
// to two explicit empty slots rather than throwing.
function wireAmmo(w) {
  return [w.ammo?.[0] ?? null, w.ammo?.[1] ?? null];
}

// loadout -> compact wire shape, e.g. for localStorage / share links / saved records.
// Items are referenced by stable catalog id (see the catalog.js header) rather than
// array position, and the envelope carries a format version so future format changes
// have an explicit migration path instead of silent corruption.
//
// Governing: ADR-0009, SPEC-0006 REQ "Wire Format Version 2 Encodes Cell Position".
// `e` is written in CELL ORDER so v2 preserves both positions and empty cells; a
// hole in the grid — a `null` cell — survives the round trip as a `null` entry.
export function toData(loadout) {
  const equip = Array(8).fill(null);
  loadout.equip.forEach((e, k) => {
    if (e) equip[k] = [e.t, e.t === "T" ? TOOLS[e.i][0] : CONS[e.i][0]];
  });
  return {
    v: FORMAT_VERSION,
    // Governing: ADR-0023, SPEC-0009 REQ "Wire Format Version 3 Encodes the Pair Flag".
    // Version 3 writes the pair flag as the third element. #331 guarantees every weapon
    // in STATE carries a boolean `d`, and the serialized byte at index 2 MUST be a boolean
    // — `undefined` would become `null` in the array and the server's version-3 validator
    // (isIslandV3) rejects that. A d-less weapon can still legitimately reach `toData`
    // from a decoder-produced loadout (e.g. the Katana promotion, which builds `{i, a}`
    // by design — #330), so the undefined case is normalized here rather than shipped.
    w: loadout.weapons.map((w) => (w ? [WEAPONS[w.i][0], wireAmmo(w), w.d === true] : null)),
    e: equip,
    tr: loadout.traits,
    n: loadout.name,
    b: loadout.blocked,
  };
}

// Current wire format (v = FORMAT_VERSION): resolve stable ids, dropping anything
// that no longer exists in the catalog.
function fromV1(d) {
  const slotWeapon = (k) => {
    const w = d.w && d.w[k];
    if (!w) return null;
    // Aliased before the lookup, not after: the lookup is exactly what fails for a retired id. (#243)
    const id = aliasWeaponId(w[0]);
    if (!WEAPON_BY_ID.has(id)) return null;
    const i = indexOfItem(WEAPONS, id);
    return { i, a: boundedAmmo(i, w[1]) };
  };
  const raw = (d.e || []).filter((e) => e && (e[0] === "T" || e[0] === "C"));
  const equip = raw
    .filter((e) => (e[0] === "T" ? TOOL_BY_ID : CONS_BY_ID).has(e[1]))
    .slice(0, 8)
    .map((e) => ({ t: e[0], i: indexOfItem(e[0] === "T" ? TOOLS : CONS, e[1]) }));

  // Read from `raw`, before the filter above discards it: the filter is exactly what would drop a
  // promoted id, so the promotion has to see the entry the filter is about to remove. (#156)
  const weapons = [0, 1].map(slotWeapon);
  promoteToWeaponSlots(
    weapons,
    raw.filter((e) => e[0] === "T" && PROMOTED_TO_WEAPON.has(e[1])).map((e) => e[1])
  );

  return {
    weapons,
    // v1's packed array IS its cell order — the cells these items rendered in. The
    // fixed-width grid keeps that order and pads the rest with the well-formed
    // empty holes of the sparse model (ADR-0009, SPEC-0006 REQ "Version 1 Records
    // Migrate Losslessly"). Trailing holes are stripped so `Block 7` cannot block a
    // cell that is empty anyway.
    equip: boundedEquip([...equip, ...Array(8 - equip.length).fill(null)].slice(0, 8), v1BlockedCells(d.b)),
    // Traits are stored by stable catalog id (see catalog.js) — pass the ids
    // straight through rather than re-mapping to current array positions, then
    // clamp to the cap (see boundedTraits; fromLegacy clamps the same way).
    traits: boundedTraits((Array.isArray(d.tr) ? d.tr : []).filter((id) => TRAIT_BY_ID.has(id))),
    name: d.n || "",
    // Governing: SPEC-0006 REQ "Version 1 Records Migrate Losslessly". A v1
    // blocked COUNT `b: N` means the LAST N cells were blocked (rendering-packed
    // loadouts fill from the front); it lifts to the last N cell indices. Missing
    // or malformed counts lift to no blocked cells rather than throwing.
    blocked: v1BlockedCells(d.b),
  };
}

// v1's blocked count -> the v2 array of cell indices it meant.
//
// The count's semantics were "trailing cells unavailable", so N lifts to the
// HIGHEST-NUMBERED N cells — [8-N..7]. Anything that does not look like a count
// lifts to no blocked cells; a malformed record must still produce the well-formed
// empty grid, not an exception (SPEC-0006 REQ "Version 1 Records Migrate Losslessly").
function v1BlockedCells(b) {
  if (typeof b === "number" && Number.isInteger(b) && b >= 0 && b <= 8) {
    return Array.from({ length: b }, (_, k) => 8 - b + k);
  }
  return [];
}

// Legacy pre-versioning encoding: items referenced by raw array index, e.g.
// { w: [[3,-1],null], e: [["T",1]], tr: [0], n: "x", b: 0 } with no `v` field.
//
// Array position was load-bearing then, so the decoder needs the catalog order as
// it stood while that format was live — NOT today's order. This used to read the
// live arrays directly, on the stated assumption that "no reorder has been merged
// between that format and this change, so positions still line up." That assumption
// expired the moment a row was deleted from the middle of one: commit e0076d3 dropped
// the Electric Lamp from TOOLS position 9, sliding legacy positions 9-17 down one, so
// a legacy record meaning Spyglass came back as Decoys (issue #68). Nothing caught it,
// because nothing could — the contract lived in a comment.
//
// The tables below are that contract, frozen. They are a historical record of the
// pre-versioning catalog and MUST NOT be re-sorted or trimmed to match edits to
// catalog.js; deleting or reordering a live catalog row is now free, because these
// resolve through stable ids rather than through whatever the live arrays hold.
// `null` means the item left the game entirely and has no current id to resolve to.
//
// Reconstructed from catalog.js at 2a6bd05^, the last commit before the versioned
// format landed.
//
// Exported for the colocated test, which asserts every non-null entry still resolves
// against the live catalog. That assertion is the enforcement the old comment lacked:
// retiring a catalog row now fails a test until whoever retired it says here what the
// legacy slot should do — resolve to a replacement id, or `null` to drop.
export const LEGACY_WEAPON_IDS = [
  "nagant-m1895", "caldwell-conversion-pistol", "scottfield-model-3", "bornheim-no-3",
  "caldwell-pax", "hand-crossbow", "cavalry-saber", "combat-axe", "railroad-hammer",
  "lemat-mark-ii", "sparks-pistol", "caldwell-conversion-uppercut", "nagant-officer-carbine",
  "hunting-bow", "dolch-96", "springfield-1866", "winfield-m1873c", "winfield-m1873",
  "romero-77", "crossbow", "frontier-73c", "bomb-lance", "caldwell-rival-78",
  "vetterli-71-karabiner", "specter-1882", "slate", "sparks-lrr", "martini-henry-ic1",
  "winfield-1876-centennial", "berthier-1892", "drilling", "krag-m1894",
  "mosin-nagant-m1891", "lebel-1886", "crown-king-auto-5", "mosin-nagant-avtomat",
  "nitro-express",
];

export const LEGACY_TOOL_IDS = [
  "first-aid-kit", "knife", "heavy-knife", "dusters", "throwing-knives", "throwing-axes",
  "katana", "flare-pistol", "fusees",
  // Electric Lamp — removed from the game in e0076d3. This is the deletion that broke
  // the old positional decoder; holding the slot is what keeps everything after it honest.
  null,
  "spyglass", "decoys", "blank-fire-decoys", "decoy-fuses", "alert-trip-mine",
  "concertina-trip-mine", "poison-trip-mine", "quad-derringer",
  // Choke Beetle / Stalker Beetle sat in Tools then and are Consumables now (issue #38).
  // resolveLegacyEquip() looks the id up in both categories, so these come back as the
  // items they always were rather than being dropped.
  "choke-beetle", "stalker-beetle",
];

export const LEGACY_CONS_IDS = [
  "vitality-shot", "regeneration-shot", "stamina-shot", "antidote-shot", "dynamite-stick",
  "dynamite-bundle", "big-dynamite-bundle", "frag-bomb", "sticky-bomb", "fire-bomb",
  "liquid-fire-bomb", "hive-bomb", "chaos-bomb",
  // "Choke Bomb" was a Consumables duplicate of the "Choke Bombs" tool and was deleted
  // from CONS in issue #67. Same item, so the legacy slot resolves to the surviving
  // tool id — not a reuse of the retired `choke-bomb` id, which stays retired.
  "choke-bombs",
  "flash-bomb", "concertina-bomb",
];

export const LEGACY_TRAIT_IDS = [
  "quartermaster", "fanning", "levering", "doctor", "physician", "packmule", "frontiersman",
  "greyhound", "kiteskin", "lightfoot", "pitcher", "bulletgrubber",
  // "Iron Repeater" was merged into Iron Eye in Update 1.15 — edited in place in the
  // live catalog, so this position always meant the trait that is Iron Eye today.
  "iron-eye",
  "bolt-thrower", "serpent", "ghoul", "determination", "resilience", "salveskin",
  "necromancer", "beastface", "hundred-hands", "steady-aim", "silent-killer", "vulture",
  "whispersmith",
  // "Poison Sense" was renamed to Pain Sense in Update 2.1, likewise in place.
  "pain-sense",
  "conduit", "magpie", "ambidextrous", "dauntless", "vigilant",
];

// legacy array position -> the id it referred to, or null if that position is not one
// the format ever had, or names something the catalog no longer carries.
function legacyId(table, index) {
  if (!inRange(index, table.length)) return null;
  return table[index] ?? null;
}

/**
 * Ids that were equipment when older records were written and are weapons now.
 *
 * Governing: #156. The Katana was a Tool and is a size-2 melee weapon.
 *
 * This is a DIFFERENT kind of move from the tools-to-consumables crossing that `resolveLegacyEquip`
 * below handles, and the difference is why it needs its own step. Tools and Consumables share one
 * equipment pool, so an id found on the other shelf restores into the same slot at the same cost —
 * "what the record meant is the item, not the shelf it sat on". A weapon does not share that pool:
 * it occupies one of two weapon slots and spends `capMax()`'s size budget instead of one of the
 * eight equipment cells. Restoring the item therefore means moving it to a different kind of slot,
 * not looking it up in a second map.
 *
 * Both decoders route through here, because #156's hazard is not legacy-only: `fromV1` filters
 * equipment through `TOOL_BY_ID`, so a CURRENT-format record carrying `["T","katana"]` would be
 * dropped just as silently as `LEGACY_TOOL_IDS[6]` would.
 */
/**
 * Retired weapon ids, mapped to the row that now carries the same gun.
 *
 * Governing: #243. `winfield-m1873c` was the pre-1896 name for the weapon the wiki now calls Frontier
 * 73C, and `frontier-73c` already existed alongside it — two rows, one gun, and the stale one had no
 * page of its own to scrape.
 *
 * Deleting a row is normally free, because both decoders resolve through stable ids rather than array
 * positions. It was NOT free here: `LEGACY_WEAPON_IDS[16]` names this id, so removing the row would
 * have made a pre-versioning loadout resolve it to nothing and drop the weapon — rather than landing
 * on the identical gun sitting two rows away. That is the silent remap the frozen table exists to
 * prevent, arriving through the other door.
 *
 * Applied in BOTH decoders, and #243 only asked for `fromLegacy`. `toData` writes
 * `WEAPONS[w.i][0]`, so any loadout saved while the duplicate was still selectable carries
 * `"winfield-m1873c"` in the CURRENT format too, and `fromV1` would have dropped it just as quietly.
 * Same shape of miss as the Katana's (#156), one issue later.
 *
 * Safe as a pure id substitution because the two rows agree on everything a decoded weapon carries
 * beyond identity: both are size 3, both draw from `compact`, so a stored ammo index stays in range
 * and keeps meaning the same round. An alias between rows with different ammo pools would need the
 * index remapped, not just the id — see the wire-format gate in catalog.js.
 */
export const RETIRED_WEAPON_ALIASES = Object.freeze({ "winfield-m1873c": "frontier-73c" });

/** A stored weapon id resolved through the alias table above. Unknown ids pass through unchanged. */
function aliasWeaponId(id) {
  return Object.prototype.hasOwnProperty.call(RETIRED_WEAPON_ALIASES, id) ? RETIRED_WEAPON_ALIASES[id] : id;
}

export const PROMOTED_TO_WEAPON = new Set(["katana"]);

/**
 * Move promoted ids into free weapon slots, mutating `weapons` in place.
 *
 * Best-effort by necessity: a loadout that already carries two weapons has nowhere to put a third,
 * and no encoding can express one. That case drops the item, which is the same outcome as before this
 * migration existed and strictly better than the alternative for every other case.
 *
 * Deliberately does NOT check the size budget. `fromV1` has never enforced `capMax` on decode — a
 * weapon whose size grew already decodes over budget — and refusing here would make a record
 * unloadable rather than self-correcting, which is the failure #201 established the decoder must
 * avoid: the store persists a decoded loadout before rendering it.
 */
function promoteToWeaponSlots(weapons, ids) {
  for (const id of ids) {
    if (!WEAPON_BY_ID.has(id)) continue;
    const i = indexOfItem(WEAPONS, id);
    // Already carried as a weapon — a record saved after the migration, whose stale equipment entry
    // must not produce a duplicate.
    if (weapons.some((w) => w && w.i === i)) continue;
    const free = weapons.findIndex((w) => w === null);
    if (free === -1) continue;
    weapons[free] = { i, a: boundedAmmo(i, -1) };
  }
}

// Resolve a legacy equipment slot to its current { t, i }.
//
// The lookup crosses categories on purpose. Tools and Consumables share one equipment
// slot array, and the data-accuracy update moved items between the two — the beetles
// out of Tools, Choke Bomb's duplicate out of Consumables. What the
// record meant is the item, not the shelf it sat on, so an id found in the other
// category is a correct restore rather than a swap. Anything that resolves to no id at
// all is dropped, never remapped to a neighbouring position.
function resolveLegacyEquip(t, index) {
  const id = legacyId(t === "T" ? LEGACY_TOOL_IDS : LEGACY_CONS_IDS, index);
  if (!id) return null;
  if (TOOL_BY_ID.has(id)) return { t: "T", i: indexOfItem(TOOLS, id) };
  if (CONS_BY_ID.has(id)) return { t: "C", i: indexOfItem(CONS, id) };
  return null;
}

// Governing: issue #351. Era-scoped ammo remap for `frontier-73c` in unversioned legacy
// records only. The weapon's `ammoClass` moved from `medium` to `compact` (commit
// `e9b2c1d`) without a FORMAT_VERSION bump, so a legacy ammo index was written against
// the pre-change `medium` pool. Translate the index by round NAME: find the round at
// the legacy index in `medium`, then find that round's index in the current `compact`
// pool. Rounds that exist in both pools (FMJ, Dumdum, Incendiary, Poison) keep their
// selection; Spitzer (`medium[1]`) has no equivalent in `compact`, so it decodes to -1
// (no variant) rather than silently re-pointing to High Velocity.
//
// The remap is a no-op for any weapon other than `frontier-73c`, and for any index that
// is out of range (boundedAmmo below still clamps the final value).
const FRONTIER_73C_LEGACY_AMMO_CLASS = "medium";
// Mechanical fix, not a decode-logic change (issue #340): AMMO rows gained a stable `id` at
// position 0, shifting round NAME from [0] to [1] (cost moved to [2]) — see the AMMO tuple shape
// note in catalog.js's header. This function's name-based matching has to read the new position or
// every match silently fails (comparing one pool's id string against another pool's, which can
// never be equal), which is exactly the "unavoidable case" #340's scope note asks to flag: what
// index a legacy selection resolves to is unchanged, only where the name lives within the tuple.
function remapFrontierAmmo(weaponIndex, legacyAmmoIndex) {
  if (WEAPONS[weaponIndex][0] !== "frontier-73c") return legacyAmmoIndex;
  const legacyPool = AMMO[FRONTIER_73C_LEGACY_AMMO_CLASS] || [];
  if (!inRange(legacyAmmoIndex, legacyPool.length)) return legacyAmmoIndex;
  const roundName = legacyPool[legacyAmmoIndex][1];
  const currentPool = AMMO[WEAPONS[weaponIndex][4]] || [];
  const currentIdx = currentPool.findIndex((v) => v[1] === roundName);
  return currentIdx >= 0 ? currentIdx : -1;
}

function fromLegacy(d) {
  const slotWeapon = (k) => {
    const w = d.w && d.w[k];
    if (!w) return null;
    // Index -> frozen id -> alias, in that order. The frozen table records what the slot MEANT; the
    // alias records where that item lives now. Collapsing the two would mean editing the frozen
    // table, which is the one thing it must never be. (#243)
    const id = aliasWeaponId(legacyId(LEGACY_WEAPON_IDS, w[0]));
    if (!id || !WEAPON_BY_ID.has(id)) return null;
    const i = indexOfItem(WEAPONS, id);
    // Governing: issue #351. `frontier-73c` moved from `medium` to `compact` in `e9b2c1d`
    // without a FORMAT_VERSION bump, so a saved ammo index for this weapon in an
    // UNVERSIONED legacy record was written against the pre-change `medium` pool, and
    // reading it against the post-change `compact` pool silently re-points index 1 from
    // Spitzer ($60) to High Velocity ($13). This era remap restores the user's selection
    // by translating the legacy `medium` index to its equivalent in the current `compact`
    // pool, matched by round NAME. Index 1 (Spitzer) has no equivalent in `compact` —
    // there is no way to carry a round the current pool does not list — so it decodes to
    // -1 (no variant) rather than to a different round at a different price. The remap
    // applies ONLY to unversioned legacy records, which necessarily carry the pre-change
    // catalog bundle; v1/v2 records are permanently ambiguous and cannot be repaired
    // (see the header note above).
    return { i, a: boundedAmmo(i, remapFrontierAmmo(i, w[1])) };
  };
  const raw = (d.e || []).filter((e) => e && (e[0] === "T" || e[0] === "C"));
  const equip = raw
    .map((e) => resolveLegacyEquip(e[0], e[1]))
    .filter(Boolean)
    .slice(0, 8);

  // The legacy index has to be translated to an id first — LEGACY_TOOL_IDS[6] is "katana" — which is
  // why this cannot reuse `resolveLegacyEquip`: that helper returns null for a promoted id, and null
  // is indistinguishable from a slot that legitimately resolves to nothing. (#156)
  const weapons = [0, 1].map(slotWeapon);
  promoteToWeaponSlots(
    weapons,
    raw
      .filter((e) => e[0] === "T")
      .map((e) => legacyId(LEGACY_TOOL_IDS, e[1]))
      .filter((id) => id && PROMOTED_TO_WEAPON.has(id))
  );

  return {
    weapons,
    // Pre-versioning encodings were packed the same way v1 was, and they decode to
    // v1 semantics first, so the lift is the same one: fixed-width grid in the order
    // the record carried, holes padded behind it, and the blocked count lifted to the
    // cells the count meant. (SPEC-0006 REQ "Version 1 Records Migrate Losslessly",
    // applied to the legacy shape through the shared v1 semantics.)
    equip: boundedEquip([...equip, ...Array(8 - equip.length).fill(null)].slice(0, 8), v1BlockedCells(d.b)),
    // Legacy encodings reference traits by array position; translate to the stable
    // catalog id the store now keys on (see catalog.js's trait tuple shape), then clamp
    // to the cap — AFTER the translation, so the fifteen counted are fifteen that survived.
    traits: boundedTraits(
      (Array.isArray(d.tr) ? d.tr : [])
        .map((i) => legacyId(LEGACY_TRAIT_IDS, i))
        .filter((id) => id && TRAIT_BY_ID.has(id))
    ),
    name: d.n || "",
    blocked: v1BlockedCells(d.b),
  };
}

// Version 2 (ADR-0009): cell-position wire format. `e` is exactly eight entries,
// index IS the cell and `null` IS an empty cell; `b` is an array of blocked cell
// indices. Items resolve by stable id, dropped atoms leave their cell as a hole
// rather than closing it up, and malformed input decays to the empty grid.
function fromV2(d) {
  const slotWeapon = (k) => {
    const w = d.w && d.w[k];
    if (!w) return null;
    const id = aliasWeaponId(w[0]);
    if (!WEAPON_BY_ID.has(id)) return null;
    const i = indexOfItem(WEAPONS, id);
    return { i, a: boundedAmmo(i, w[1]) };
  };
  const empty = Array(8).fill(null);
  const raw = d.e || [];
  const equip = Array.isArray(raw)
    ? empty.map((_, k) => {
        if (!(k in raw)) return null; // a sparse input hole stays a cell hole
        const entry = raw[k];
        if (!entry || !Array.isArray(entry) || (entry[0] !== "T" && entry[0] !== "C")) return null;
        const byId = entry[0] === "T" ? TOOL_BY_ID : CONS_BY_ID;
        if (!byId.has(entry[1])) return null; // leaves a hole; later cells must not shift
        return { t: entry[0], i: indexOfItem(entry[0] === "T" ? TOOLS : CONS, entry[1]) };
      })
    : empty;

  const weapons = [0, 1].map(slotWeapon);
  // The promotion reads back over the RAW entries; a malformed `e` (not an array)
  // simply promotes nothing — the empty grid, not an exception.
  const rawEntries = Array.isArray(raw) ? raw : [];
  promoteToWeaponSlots(
    weapons,
    rawEntries.filter((e) => e && e[0] === "T" && PROMOTED_TO_WEAPON.has(e[1])).map((e) => e[1])
  );

  const blocked = boundedBlocked(d.b);

  return {
    weapons,
    equip: boundedEquip(equip, blocked),
    traits: boundedTraits((Array.isArray(d.tr) ? d.tr : []).filter((id) => TRAIT_BY_ID.has(id))),
    name: d.n || "",
    // Blocked cells travel as their own array. Malformed values decay to none at
    // all (the well-formed empty grid, not an exception), and out-of-range indices
    // are dropped rather than clamped — a clamp would move the block the record
    // actually declared.
    blocked,
  };
}

// Version 3 (ADR-0023): exactly Version 2, plus the dual-wield pair flag as a
// THIRD element on each weapon entry — `[weaponId, ammoIndex, d]`. `d` is a boolean:
// true marks the entry as a dual-wielded pair, and anything else decodes to false.
//
// The flag is decoded verbatim, never inferred. No record older than version 3 can
// express a pair, and nothing about a v2/v1/legacy record (not a duplicated weapon,
// not a size) is a signal of one, so the older decoders leave `d` absent entirely.
// Malformed input still decays to the well-formed empty grid rather than throwing.
//
// Governing: ADR-0023 (the pair flag is the third element), SPEC-0009 REQ "Version 2
// and Version 1 Records Continue to Decode" (selection is by declared version).
function fromV3(d) {
  const slotWeapon = (k) => {
    const w = d.w && d.w[k];
    if (!w) return null;
    const id = aliasWeaponId(w[0]);
    if (!WEAPON_BY_ID.has(id)) return null;
    const i = indexOfItem(WEAPONS, id);
    return { i, a: boundedAmmo(i, w[1]), d: w[2] === true };
  };
  const empty = Array(8).fill(null);
  const raw = d.e || [];
  const equip = Array.isArray(raw)
    ? empty.map((_, k) => {
        if (!(k in raw)) return null; // a sparse input hole stays a cell hole
        const entry = raw[k];
        if (!entry || !Array.isArray(entry) || (entry[0] !== "T" && entry[0] !== "C")) return null;
        const byId = entry[0] === "T" ? TOOL_BY_ID : CONS_BY_ID;
        if (!byId.has(entry[1])) return null; // leaves a hole; later cells must not shift
        return { t: entry[0], i: indexOfItem(entry[0] === "T" ? TOOLS : CONS, entry[1]) };
      })
    : empty;

  const weapons = [0, 1].map(slotWeapon);
  // The promotion reads back over the RAW entries; a malformed `e` (not an array)
  // simply promotes nothing — the empty grid, not an exception.
  const rawEntries = Array.isArray(raw) ? raw : [];
  promoteToWeaponSlots(
    weapons,
    rawEntries.filter((e) => e && e[0] === "T" && PROMOTED_TO_WEAPON.has(e[1])).map((e) => e[1])
  );

  const v3blocked = boundedBlocked(d.b);

  return {
    weapons,
    equip: boundedEquip(equip, v3blocked),
    traits: boundedTraits((Array.isArray(d.tr) ? d.tr : []).filter((id) => TRAIT_BY_ID.has(id))),
    name: d.n || "",
    // Blocked cells travel as their own array. Malformed values decay to none at
    // all (the well-formed empty grid, not an exception), and out-of-range indices
    // are dropped rather than clamped — a clamp would move the block the record
    // actually declared.
    blocked: v3blocked,
  };
}

// Version 4 (SPEC-0010): exactly Version 3's shape, except the ammo element is a stable
// catalog id (string) rather than a live-pool index — the type change #342's server
// validator (isIslandV4) already accepts. FORMAT_VERSION stays at 3; this client does not
// WRITE version 4 yet (that is #345's job — toData() is untouched by this story).
//
// There is no old-model index to populate `a` with here, and `a` MUST stay an integer:
// loadoutSlice.js's isValidLoadoutShape() asserts `Number.isInteger(w.a)` on every weapon
// slot, so writing a string id into `a` would make setLoadout() throw the instant a
// version-4 record reached the store. `a` therefore stays -1 for every version-4 entry —
// exactly the existing "no variant selected" value every other decoder already uses — and
// withDecodeNotices()'s post-pass below is what actually carries the id forward, in the
// new `result.ammoIds` field. Switching the READERS that consume `a` (WeaponSlot, calc.js's
// totalCost) over to `ammoIds` is migration step 5 (design.md), not this decoder's job.
//
// SPEC-0010's own wire-format requirement describes a version-4 weapon carrying its "ammo
// SELECTIONS" (plural) and includes a two-round encode/decode scenario. That is NOT what
// this decoder implements: #342's already-merged, already-deployed-assumption isIslandV4
// validates a weapon entry as exactly `[weaponRef, oneAmmoId, dualFlag]` — one ammo id, not
// two. Building a decoder for a two-id shape here would produce payloads the live server
// rejects the moment #345 tries to encode one. This decoder matches what #342 actually
// shipped; representing a second ammo slot on the wire needs a coordinated client+server
// change (a widened version 4, or a version 5) and is out of scope for #343 — flagged here,
// and in this PR's body, for whoever picks up the second ammo control story (#346/#347).
//
// Governing: ADR-0014, SPEC-0010 REQ "Wire Format Version 4 References Rounds by Stable Id", issue #343
function fromV4(d) {
  const slotWeapon = (k) => {
    const w = d.w && d.w[k];
    if (!w) return null;
    const id = aliasWeaponId(w[0]);
    if (!WEAPON_BY_ID.has(id)) return null;
    const i = indexOfItem(WEAPONS, id);
    // Version 4's ammo element is the two-slot id array directly (issue #345 widened it
    // from #342/#343's single-id placeholder before anything had ever written v4) — no
    // index, no frozen-table resolution, no live-pool lookup. A malformed entry (not an
    // array) degrades to two explicit empty slots rather than throwing; `ammo` is set
    // directly on the decoded weapon rather than through the `.a` + top-level `ammoIds`
    // bridge withDecodeNotices() below builds for v1/v2/v3/legacy — that bridge exists
    // specifically because those versions have no id to give a decoder in the first
    // place, which is no longer true here.
    const slots = Array.isArray(w[1]) ? w[1] : [null, null];
    return { i, ammo: [slots[0] ?? null, slots[1] ?? null], d: w[2] === true };
  };
  const empty = Array(8).fill(null);
  const raw = d.e || [];
  const equip = Array.isArray(raw)
    ? empty.map((_, k) => {
        if (!(k in raw)) return null; // a sparse input hole stays a cell hole
        const entry = raw[k];
        if (!entry || !Array.isArray(entry) || (entry[0] !== "T" && entry[0] !== "C")) return null;
        const byId = entry[0] === "T" ? TOOL_BY_ID : CONS_BY_ID;
        if (!byId.has(entry[1])) return null; // leaves a hole; later cells must not shift
        return { t: entry[0], i: indexOfItem(entry[0] === "T" ? TOOLS : CONS, entry[1]) };
      })
    : empty;

  const weapons = [0, 1].map(slotWeapon);
  // The promotion reads back over the RAW entries; a malformed `e` (not an array)
  // simply promotes nothing — the empty grid, not an exception.
  const rawEntries = Array.isArray(raw) ? raw : [];
  promoteToWeaponSlots(
    weapons,
    rawEntries.filter((e) => e && e[0] === "T" && PROMOTED_TO_WEAPON.has(e[1])).map((e) => e[1])
  );

  const v4blocked = boundedBlocked(d.b);

  return {
    weapons,
    equip: boundedEquip(equip, v4blocked),
    traits: boundedTraits((Array.isArray(d.tr) ? d.tr : []).filter((id) => TRAIT_BY_ID.has(id))),
    name: d.n || "",
    blocked: v4blocked,
  };
}

// Wire-format decoders, oldest to newest. fromData() picks the decoder whose
// version entry matches the record's declared `v`, so a future FORMAT_VERSION bump
// only needs a new decoder added here — older records keep migrating instead of
// silently dropping.
const DECODERS = [
  { v: 4, decode: fromV4 },
  { v: 3, decode: fromV3 },
  { v: 2, decode: fromV2 },
  { v: 1, decode: fromV1 },
];

// The highest known wire-format version. A record declaring a higher `v` was
// written by a newer client and cannot be decoded by this bundle — fromData
// returns a "cannot decode" result rather than routing it through a decoder
// that would misread its shape (issue #360).
const MAX_KNOWN_VERSION = 4;

// compact wire shape -> loadout, dropping anything that no longer resolves against the catalog.
//
// Governing: issue #26 (created the version envelope), issue #360 (unknown versions
// must not fall through to the legacy positional decoder), issue #359 (surface a
// notice when a decoded ammo selection was silently dropped).
//
// Selection is by declared version, never by shape. Three cases:
//   1. `v` matches a known decoder → decode through it.
//   2. `v` is absent (undefined/null) → genuine pre-versioning legacy record → fromLegacy.
//   3. `v` is a number higher than any known version, or a non-matching type (e.g. "2")
//      → a record from a newer or malformed client → return `{ ok: false }` so callers
//        can surface a message instead of silently fabricating data.
//
// Before this fix, case 3 fell through to fromLegacy, which reads item references as
// raw array positions — so a crafted `{v: 99, w: [[20, 1]], ...}` fabricated a real
// weapon (Frontier 73C, $13) from a bare integer. Worse, once `FORMAT_VERSION` bumps
// to 4, every old-client client opening a v4 share link would decode it through
// fromLegacy and persist the fabricated result to localStorage, silently overwriting
// the reader's own stored build (issue #201's persistence-before-render hazard).
export function fromData(d) {
  if (!d || typeof d !== "object") return emptyLoadout();
  // Case 2: genuine legacy records carry no `v` field (or explicitly null).
  if (d.v === undefined || d.v === null) return withDecodeNotices(fromLegacy(d), d);
  // Case 1: a known version with a matching decoder.
  const decoder = DECODERS.find((x) => d.v === x.v);
  if (decoder) return withDecodeNotices(decoder.decode(d), d);
  // Case 3: a version this client does not know, or a malformed `v` type. There is no
  // decoded `weapons` array to compare notices against, so this case skips
  // withDecodeNotices entirely.
  return { ok: false, v: d.v };
}

// Governing: issue #359. Detect ammo selections that were valid when the record was
// written but no longer resolve (the pool shrank, e.g. dolch-96/nitro-express moved
// to the empty `special` pool). The decoders correctly clamp to -1 via boundedAmmo,
// but nothing told the player their saved choice vanished and the cost silently dropped.
// This post-pass compares the raw record's ammo indices against the decoded values:
// a raw index >= 0 that decoded to -1 means the selection was dropped because the pool
// can no longer hold it — distinct from a raw -1 (no selection was ever made).
//
// Governing: ADR-0014, SPEC-0010 REQ "Every Legacy Ammo Selection Migrates to the Round
// It Named", issue #339/#343/#345. Also resolves `ammoIds` — the round each PRE-V4 weapon
// slot's ammo selection actually NAMES, by stable catalog id, for the legacy-decoder
// bridge `normalizeWeaponAmmo` (loadoutSlice.js) reads.
//
// For a version-4 entry, `rawAmmo` is the two-slot id array (issue #345), and `fromV4`
// already set `decoded.ammo` directly from it — there is nothing to bridge, and "dropped"
// is not decode-time detectable for id-based ammo the way it was for a bare index (an id
// that no longer resolves degrades at the point of USE, via `ammoRoundFor` in
// itemStats.js, not at decode time). Both the notice check and `ammoIds` are skipped for
// these entries.
//
// For every version before 4, `rawAmmo` is a bare index and there is no id on the wire at
// all — it has to be resolved. This intentionally resolves `decoded.a` (the ALREADY
// clamped, and for fromLegacy's frontier-73c case ALREADY remapped, index — see
// remapFrontierAmmo above) against the FROZEN `LEGACY_AMMO_IDS` snapshot
// (client/src/data/ammoIds.js), not the raw wire value and not the LIVE `AMMO` pool:
//   - Resolving the raw value would relive the frontier-73c hazard for every OTHER
//     reclassified weapon this decoder doesn't special-case — `decoded.a` already carries
//     whatever remap the decoder itself applied, so resolving THAT keeps this in lockstep
//     with `a`'s own validity check instead of a second, independent (and possibly
//     disagreeing) one.
//   - Resolving against the LIVE pool is exactly the bug this migration exists to close
//     (the Frontier 73C incident: a corrected `ammoClass` silently re-pointing a stored
//     index at a different round with no error). It is also observably wrong for the
//     opposite direction — the `special` pool was empty when this table was frozen and has
//     nine rows today (#340); a decoded `dolch-96` at index 2 legitimately resolves via the
//     LIVE pool (see loadoutCodec.test.js's issue #359 block, pinned intentionally), but no
//     genuine historical record could have MEANT anything at that index while the pool it
//     drew from was empty. The frozen table correctly resolves that case to null — "no
//     round chosen" is the honest answer, not a fabricated one — while `a` (unchanged by
//     this story) keeps working exactly as the pinned regression test requires.
//
// `ammoIds` is a NEW, additive field for pre-v4 entries, not a change to
// `weapons[k].a` — every existing v1/v2/v3/legacy decoder test asserts `.a` via `toEqual`,
// and #343's acceptance criteria requires those to pass unmodified.
function withDecodeNotices(result, d) {
  const notices = [];
  const ammoIds = [null, null];
  if (Array.isArray(d.w)) {
    for (let k = 0; k < d.w.length && k < 2; k++) {
      const entry = d.w[k];
      if (!entry || !Array.isArray(entry)) continue;
      const rawAmmo = entry[1];
      const decoded = result.weapons[k];
      if (!decoded || Array.isArray(rawAmmo)) continue;
      if (rawAmmo >= 0 && decoded.a === -1) {
        notices.push({ kind: "ammo-dropped", slot: k });
      }
      ammoIds[k] = legacyAmmoId(WEAPONS[decoded.i][4], decoded.a);
    }
  }
  result.decodeNotices = notices;
  result.ammoIds = ammoIds;
  return result;
}

/**
 * Shared by vitest helpers and decode paths that need a known cell-ordered grid:
 * the eight-cell sparse array with `null` holes.
 *
 * Governing: ADR-0009. Kept beside `emptyLoadout` so the shape lives in one place.
 */
export function emptyEquipGrid() {
  return Array(8).fill(null);
}

/**
 * Whether a `fromData` result is an undecodable record (a version the client does
 * not know). Callers use this to surface a message instead of feeding the result
 * to `setLoadout`, which would throw on the missing `weapons` field.
 *
 * Governing: issue #360.
 */
export function isUndecodable(result) {
  return result !== null && typeof result === "object" && result.ok === false;
}

export function readStoredLoadout() {
  try {
    const raw = localStorage.getItem(LS_CUR);
    if (!raw) return null;
    const result = fromData(JSON.parse(raw));
    // Governing: issue #360. An undecodable record (unknown version) must not be
    // fed to setLoadout — it has no weapons/equip/traits. Return null so the caller
    // starts fresh rather than crashing or persisting a fabricated loadout.
    if (isUndecodable(result)) return null;
    return result;
  } catch {
    return null;
  }
}

export function writeStoredLoadout(loadout) {
  try {
    localStorage.setItem(LS_CUR, JSON.stringify(toData(loadout)));
  } catch {
    // localStorage unavailable (private mode, quota) — silently skip persistence
  }
}

/**
 * Discard the persisted in-progress build and any share fragment addressing it.
 *
 * Governing: issue #201. The recovery path for a build the app cannot render — the state
 * and the link that seeded it are both dropped, so the reload that follows starts empty
 * rather than re-reading the same bad record. Only the current build is touched: saved
 * loadouts live server-side and are none of this function's business.
 */
export function clearStoredLoadout() {
  try {
    localStorage.removeItem(LS_CUR);
  } catch {
    // localStorage unavailable — nothing persisted, so nothing to clear
  }
  try {
    history.replaceState(null, "", location.pathname + location.search);
  } catch {
    // history API unavailable — the reload will still drop the state above
  }
}

// Governing: item 4 of the 2026-08-16 feedback batch ("I want to use share codes"). This
// is the decode half of a loadout CODE — the bare base64 payload, with no URL or "#L="
// marker around it. ActionsPanel's "Load" (paste-a-code) is the only caller now; the
// share-LINK feature this was originally factored out of (a URL carrying the same code
// in its `#L=` hash, decoded once on page load) was removed outright rather than kept
// around unreachable — see git history for `encodeShareUrl`/`readHashLoadout` if the URL
// form is ever wanted back. The app has no live users yet, so there was nothing an old
// shared link needed to keep working for.
//
// Reuses `fromData`, so it inherits ADR-0024's decoder contract for free: a malformed or
// unrecognized-version code degrades to `null` (caller starts fresh) rather than throwing
// or fabricating a loadout, and a well-formed-but-rule-violating one (too many traits, an
// over-cap equipment loadout from an older, looser build of the app) still loads — the
// same "loadable, not legal" contract every other decode path in this app already follows.
export function decodeShareCode(code) {
  if (!code) return null;
  try {
    // Governing: issue #358. Share codes may carry non-Latin-1 characters in the loadout
    // name (emoji, CJK, Cyrillic, etc.). `btoa` throws on code points above U+00FF, so the
    // encoder now encodes the JSON as UTF-8 before base64. Old share codes produced by the
    // raw-Latin-1 `btoa(JSON.stringify(...))` path are a strict subset of the new path for
    // plain-ASCII names, so they decode correctly through the safe path. If the safe decode
    // fails, fall back to the legacy raw `atob` path so a genuinely old link still loads
    // rather than silently returning null.
    const safe = decodeBase64Utf8(code);
    const result = fromData(JSON.parse(safe));
    // Governing: issue #360. An undecodable record (unknown version) must not be
    // fed to setLoadout — return null so the caller starts fresh instead of
    // fabricating data or persisting a corrupted loadout to localStorage.
    if (isUndecodable(result)) return null;
    return result;
  } catch {
    try {
      const result = fromData(JSON.parse(atob(code)));
      if (isUndecodable(result)) return null;
      return result;
    } catch {
      return null;
    }
  }
}

// Governing: item 4 of the 2026-08-16 feedback batch. A user pasting a code might still
// have an OLD share link's URL or "#L=..." fragment sitting in their clipboard from
// before the share-link feature was removed — accepting those alongside a bare code costs
// nothing and means "paste whatever you copied" stays true rather than "paste exactly the
// substring we wanted," which is not a distinction a user pasting a code back in has any
// reason to know or care about.
//
// Returns null for anything that is clearly not a code attempt — empty input, or text
// that contains no "#L=" marker and does not look like base64 — rather than handing
// `decodeShareCode` a string that could only ever fail there too. Keeping that boundary at
// extraction, not decode, is purely about where the "not a code at all" outcome is
// decided; the caller-visible result (null) is identical either way.
export function extractShareCode(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/#L=([A-Za-z0-9+/=]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9+/=]+$/.test(trimmed) ? trimmed : null;
}

// Governing: issue #358. `btoa` throws `InvalidCharacterError` on any code point above
// U+00FF, so a loadout named with an emoji or CJK/Cyrillic/Greek characters made the
// share code's encoder throw uncaught. Encode the JSON string as UTF-8 bytes before
// base64 to handle the full Unicode range.
// The symmetric decode tries UTF-8-safe decoding first, falling back to raw `atob` for
// legacy codes produced before this change (the raw-Latin-1 path is a subset of the
// UTF-8 path for plain-ASCII content, so old codes round-trip correctly either way).
function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeBase64Utf8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // `fatal: true` is load-bearing: without it, TextDecoder silently substitutes U+FFFD
  // for invalid byte sequences instead of throwing, so a legacy Latin-1 share code
  // containing an accented character (e.g. "Café", raw-btoa'd pre-#358) would "succeed"
  // here as mangled text instead of throwing and letting decodeShareCode's catch fall
  // through to the legacy atob path that decodes it correctly.
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

// Governing: item 4 of the 2026-08-16 feedback batch ("I want to use share codes"). The
// bare code, with no URL around it — the encode half of `decodeShareCode` above. The
// share-LINK feature this once also fed (a URL carrying the same code in its "#L=" hash)
// was removed outright; see the note on `decodeShareCode` above for why.
export function encodeShareCode(loadout) {
  // Governing: issue #358. UTF-8-safe base64 so non-Latin-1 names don't throw.
  return encodeBase64Utf8(JSON.stringify(toData(loadout)));
}
