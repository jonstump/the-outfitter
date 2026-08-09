import { CONS, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";

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
    return { i: indexOfItem(WEAPONS, w[0]), a: Number.isInteger(w[1]) ? w[1] : -1 };
  };
  const equip = (d.e || [])
    .filter((e) => e && (e[0] === "T" || e[0] === "C") && (e[0] === "T" ? TOOL_BY_ID : CONS_BY_ID).has(e[1]))
    .slice(0, 8)
    .map((e) => ({ t: e[0], i: indexOfItem(e[0] === "T" ? TOOLS : CONS, e[1]) }));

  return {
    weapons: [0, 1].map(slotWeapon),
    equip,
    // Traits are stored by stable catalog id (see catalog.js) — pass the ids
    // straight through rather than re-mapping to current array positions.
    traits: (d.tr || []).filter((id) => TRAIT_BY_ID.has(id)),
    name: d.n || "",
    blocked: Math.min(Math.max(Number(d.b) || 0, 0), 8),
  };
}

// Legacy pre-versioning encoding: items referenced by raw array index, e.g.
// { w: [[3,-1],null], e: [["T",1]], tr: [0], n: "x", b: 0 } with no `v` field.
// Array position was load-bearing then. The migration key to the current catalog
// is the array order as it stood before any data-accuracy reorder landed (no
// reorder has been merged between that format and this change, so positions
// still line up). Kept deliberately conservative: out-of-range values are
// dropped rather than remapped.
const LEGACY_COUNTS = { w: WEAPONS.length, eT: TOOLS.length, eC: CONS.length, tr: TRAITS.length };

// Legacy encodings reference traits by array position; translate to the stable
// catalog id the store now keys on (see catalog.js's trait tuple shape).
function fromLegacy(d) {
  const slotWeapon = (k) => {
    const w = d.w && d.w[k];
    if (!w || !inRange(w[0], LEGACY_COUNTS.w)) return null;
    return { i: w[0], a: inRange(w[1], 5) ? w[1] : -1 };
  };
  const equip = (d.e || [])
    .filter((e) => e && (e[0] === "T" || e[0] === "C"))
    .filter((e) => inRange(e[1], e[0] === "T" ? LEGACY_COUNTS.eT : LEGACY_COUNTS.eC))
    .slice(0, 8)
    .map((e) => ({ t: e[0], i: e[1] }));

  return {
    weapons: [0, 1].map(slotWeapon),
    equip,
    traits: (d.tr || [])
      .filter((i) => inRange(i, LEGACY_COUNTS.tr))
      .filter((i) => TRAITS[i])
      .map((i) => TRAITS[i][0]),
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
