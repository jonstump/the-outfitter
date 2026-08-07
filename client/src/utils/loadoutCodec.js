import { CONS, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";

export const LS_CUR = "hunt-outfitter-current";

export function emptyLoadout() {
  return { weapons: [null, null], equip: [], traits: [], blocked: 0, name: "" };
}

// loadout -> compact wire shape, e.g. for localStorage / share links / saved records
export function toData(loadout) {
  return {
    w: loadout.weapons.map((w) => (w ? [w.i, w.a] : null)),
    e: loadout.equip.map((e) => [e.t, e.i]),
    tr: loadout.traits,
    n: loadout.name,
    b: loadout.blocked,
  };
}

// compact wire shape -> loadout, dropping anything that no longer resolves against the catalog
export function fromData(d) {
  return {
    weapons: [0, 1].map((k) => (d.w && d.w[k] && WEAPONS[d.w[k][0]] ? { i: d.w[k][0], a: d.w[k][1] } : null)),
    equip: (d.e || [])
      .filter((e) => (e[0] === "T" ? TOOLS[e[1]] : CONS[e[1]]))
      .slice(0, 8)
      .map((e) => ({ t: e[0], i: e[1] })),
    traits: (d.tr || []).filter((i) => TRAITS[i]),
    name: d.n || "",
    blocked: Math.min(Math.max(d.b || 0, 0), 8),
  };
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
