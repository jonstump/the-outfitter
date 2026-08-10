const TOKEN_KEY = "hunt-outfitter-token";

// API base. Defaults to the same-origin /api path (the app's intended
// single-process deploy model). Set VITE_API_URL at build time to deploy the
// client and server as separate origins (see README "Deployment").
const BASE = (import.meta.env && import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/$/, "")
  : "") + "/api/loadouts";

// Per-browser anonymous identifier sent with every request (issue #17). It
// identifies the browser to the API, which scopes saved loadouts per token
// server-side, so different browsers never see or overwrite each other's saves.
function clientToken() {
  try {
    let token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      token =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : "t-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  } catch {
    // localStorage unavailable (private mode) — send no token; the server's
    // per-request anonymous scope isolates the request.
    return "";
  }
}

const headers = () => ({ "Content-Type": "application/json", "x-loadout-token": clientToken() });

async function asJson(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function getLoadouts() {
  return fetch(BASE, { headers: headers() }).then(asJson);
}

// Governing: ADR-0006, SPEC-0003 REQ "Loadouts Are Filed into Lists by Nullable Reference"
//
// `listId` rides on the request envelope alongside `name`, never inside `data`. Omitting
// it leaves an existing loadout's filing untouched; passing null files it to Unassigned.
export function upsertLoadout(name, data, listId) {
  const body = listId === undefined ? { name, data } : { name, data, listId };
  return fetch(BASE, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  }).then(asJson);
}

/** Move a loadout between lists. `listId: null` moves it to Unassigned. */
export function moveLoadout(id, listId) {
  return fetch(`${BASE}/${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ listId }),
  }).then(asJson);
}

export function deleteLoadout(id) {
  return fetch(`${BASE}/${id}`, { method: "DELETE", headers: headers() }).then(asJson);
}

// ---------------------------------------------------------------------------
// Loadout lists (SPEC-0003). Same token header, same scoping rules — a list is
// only ever visible to the browser that created it.
// ---------------------------------------------------------------------------

const LISTS_BASE = (import.meta.env && import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/$/, "")
  : "") + "/api/loadout-lists";

export function getLists() {
  return fetch(LISTS_BASE, { headers: headers() }).then(asJson);
}

export function createList({ name, hunterId = null }) {
  return fetch(LISTS_BASE, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name, hunterId }),
  }).then(asJson);
}

export function updateList(id, patch) {
  return fetch(`${LISTS_BASE}/${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(patch),
  }).then(asJson);
}

/** Retire a list. The server drops its loadouts into Unassigned; it never deletes them. */
export function retireList(id) {
  return fetch(`${LISTS_BASE}/${id}`, { method: "DELETE", headers: headers() }).then(asJson);
}
