import { AMMO, CONS, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";
import { TRAIT_MAX } from "./calc.js";

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
export const FORMAT_VERSION = 3;

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
 * The traits a decoded loadout is allowed to keep: the first TRAIT_MAX that survive
 * catalog resolution.
 *
 * Governing: ADR-0012 (fifteen-trait cap), SPEC-0003 REQ "A Loadout Holds At Most Fifteen Traits"
 *
 * Decode clamps rather than throws, for the reason boundedAmmo above states: the store
 * subscriber persists a decoded loadout BEFORE it is rendered, so a decoder that refused an
 * over-cap list would write the record it rejects and then fail on it on every later visit
 * (issue #201). Clamping keeps the record loadable and self-correcting — a stored twenty-trait
 * loadout decodes to fifteen and the next save writes fifteen back.
 *
 * It takes the FIRST surviving ids so decoding is deterministic, and it is applied AFTER each
 * decoder's own resolution step (id filter in v1, positional translation in legacy) so the cap
 * counts traits the loadout actually holds rather than entries that were about to be dropped.
 *
 * Both decoders call this. A bound carried by one decoder and not the other is the defect PR
 * #203 had to fix for the ammo index, and is the reason this lives in one function.
 */
function boundedTraits(ids) {
  return ids.slice(0, TRAIT_MAX);
}

export function emptyLoadout() {
  // Governing: ADR-0009 (fixed eight-cell sparse grid, `null` = empty),
  // SPEC-0006 REQ "Equipment Occupies a Fixed Eight-Cell Grid".
  // Malformed decodes land here as the well-formed empty grid rather than throwing.
  return { weapons: [null, null], equip: Array(8).fill(null), traits: [], blocked: [], name: "" };
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
    w: loadout.weapons.map((w) => (w ? [WEAPONS[w.i][0], w.a, w.d === true] : null)),
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
    equip: [...equip, ...Array(8 - equip.length).fill(null)].slice(0, 8),
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
// pool (loadoutSlice's slotMax), and the data-accuracy update moved items between the
// two — the beetles out of Tools, Choke Bomb's duplicate out of Consumables. What the
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
    return { i, a: boundedAmmo(i, w[1]) };
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
    equip: [...equip, ...Array(8 - equip.length).fill(null)].slice(0, 8),
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

  return {
    weapons,
    equip,
    traits: boundedTraits((Array.isArray(d.tr) ? d.tr : []).filter((id) => TRAIT_BY_ID.has(id))),
    name: d.n || "",
    // Blocked cells travel as their own array. Malformed values decay to none at
    // all (the well-formed empty grid, not an exception), and out-of-range indices
    // are dropped rather than clamped — a clamp would move the block the record
    // actually declared.
    blocked: Array.isArray(d.b) ? d.b.filter((c) => Number.isInteger(c) && c >= 0 && c < 8) : [],
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

  return {
    weapons,
    equip,
    traits: boundedTraits((Array.isArray(d.tr) ? d.tr : []).filter((id) => TRAIT_BY_ID.has(id))),
    name: d.n || "",
    // Blocked cells travel as their own array. Malformed values decay to none at
    // all (the well-formed empty grid, not an exception), and out-of-range indices
    // are dropped rather than clamped — a clamp would move the block the record
    // actually declared.
    blocked: Array.isArray(d.b) ? d.b.filter((c) => Number.isInteger(c) && c >= 0 && c < 8) : [],
  };
}

// Wire-format decoders, oldest to newest. fromData() picks the newest decoder
// whose version entry matches, so a future FORMAT_VERSION bump only needs a new
// decoder added here — older records keep migrating instead of silently dropping.
const DECODERS = [
  { v: 3, decode: fromV3 },
  { v: 2, decode: fromV2 },
  { v: 1, decode: fromV1 },
  // Legacy (unversioned) records are the fallback — anything unrecognized routes
  // here, and fromLegacy's bounds checks safely drop what it can't place.
  { v: null, decode: fromLegacy },
];

// compact wire shape -> loadout, dropping anything that no longer resolves against the catalog
export function fromData(d) {
  if (!d || typeof d !== "object") return emptyLoadout();
  const decoder = DECODERS.find((x) => x.v !== null && d.v === x.v) || DECODERS.find((x) => x.v === null);
  return decoder.decode(d);
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

export function readStoredLoadout() {
  try {
    const raw = localStorage.getItem(LS_CUR);
    if (!raw) return null;
    return fromData(JSON.parse(raw));
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

export function readHashLoadout() {
  const m = location.hash.match(/#L=([A-Za-z0-9+/=]+)/);
  if (!m) return null;
  try {
    return fromData(JSON.parse(atob(m[1])));
  } catch {
    return null;
  }
}

export function encodeShareUrl(loadout) {
  const code = btoa(JSON.stringify(toData(loadout)));
  try {
    history.replaceState(null, "", "#L=" + code);
  } catch {
    // history API unavailable — the hash still gets set on location by callers reading location.href
  }
  return location.origin + location.pathname + "#L=" + code;
}
