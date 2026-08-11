import { AMMO, CONS, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";
import { TRAIT_MAX } from "./calc.js";

export const LS_CUR = "hunt-outfitter-current";

// Wire format version. Bump when toData()'s shape changes so fromData() can
// migrate old encodings instead of misreading them (see issue #26 — the previous
// format referenced catalog items by raw array index, which silently remapped
// saved loadouts whenever the catalog was reordered or edited).
export const FORMAT_VERSION = 1;

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
  return { weapons: [null, null], equip: [], traits: [], blocked: 0, name: "" };
}

// loadout -> compact wire shape, e.g. for localStorage / share links / saved records.
// Items are referenced by stable catalog id (see the catalog.js header) rather than
// array position, and the envelope carries a format version so future format changes
// have an explicit migration path instead of silent corruption.
export function toData(loadout) {
  return {
    v: FORMAT_VERSION,
    w: loadout.weapons.map((w) => (w ? [WEAPONS[w.i][0], w.a] : null)),
    e: loadout.equip.map((e) => [e.t, e.t === "T" ? TOOLS[e.i][0] : CONS[e.i][0]]),
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
    if (!w || !WEAPON_BY_ID.has(w[0])) return null;
    const i = indexOfItem(WEAPONS, w[0]);
    return { i, a: boundedAmmo(i, w[1]) };
  };
  const equip = (d.e || [])
    .filter((e) => e && (e[0] === "T" || e[0] === "C") && (e[0] === "T" ? TOOL_BY_ID : CONS_BY_ID).has(e[1]))
    .slice(0, 8)
    .map((e) => ({ t: e[0], i: indexOfItem(e[0] === "T" ? TOOLS : CONS, e[1]) }));

  return {
    weapons: [0, 1].map(slotWeapon),
    equip,
    // Traits are stored by stable catalog id (see catalog.js) — pass the ids
    // straight through rather than re-mapping to current array positions, then
    // clamp to the cap (see boundedTraits; fromLegacy clamps the same way).
    traits: boundedTraits((d.tr || []).filter((id) => TRAIT_BY_ID.has(id))),
    name: d.n || "",
    blocked: Math.min(Math.max(Number(d.b) || 0, 0), 8),
  };
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
    const id = legacyId(LEGACY_WEAPON_IDS, w[0]);
    if (!id || !WEAPON_BY_ID.has(id)) return null;
    const i = indexOfItem(WEAPONS, id);
    return { i, a: boundedAmmo(i, w[1]) };
  };
  const equip = (d.e || [])
    .filter((e) => e && (e[0] === "T" || e[0] === "C"))
    .map((e) => resolveLegacyEquip(e[0], e[1]))
    .filter(Boolean)
    .slice(0, 8);

  return {
    weapons: [0, 1].map(slotWeapon),
    equip,
    // Legacy encodings reference traits by array position; translate to the stable
    // catalog id the store now keys on (see catalog.js's trait tuple shape), then clamp
    // to the cap — AFTER the translation, so the fifteen counted are fifteen that survived.
    traits: boundedTraits(
      (d.tr || [])
        .map((i) => legacyId(LEGACY_TRAIT_IDS, i))
        .filter((id) => id && TRAIT_BY_ID.has(id))
    ),
    name: d.n || "",
    blocked: Math.min(Math.max(Number(d.b) || 0, 0), 8),
  };
}

// Wire-format decoders, oldest to newest. fromData() picks the newest decoder
// whose version entry matches, so a future FORMAT_VERSION bump only needs a new
// decoder added here — older records keep migrating instead of silently dropping.
const DECODERS = [
  { v: FORMAT_VERSION, decode: fromV1 },
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
