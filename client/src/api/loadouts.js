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

// Governing: SPEC-0005 REQ "Authenticated Loopback Boundary", issue #513.
//
// The desktop host (desktop/preload.js) exposes the per-launch secret via
// contextBridge as window.__DESKTOP_SECRET__. In the browser-hosted (non-desktop)
// deployment this global is never set, so the header is simply omitted there —
// the server's secret-check middleware only exists in the desktop composition.
const headers = () => {
  const h = { "Content-Type": "application/json", "x-loadout-token": clientToken() };
  if (typeof window !== "undefined" && window.__DESKTOP_SECRET__) {
    h["x-desktop-secret"] = window.__DESKTOP_SECRET__;
  }
  return h;
};

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
//
// NO `description` KEY, deliberately, and this is the client half of a decision rather than
// an oversight. SPEC-0003's HTTP API section says POST "SHALL accept an optional
// `description`" — that is normative on the SERVER, so the branch stays there — but the
// description editor lives on a SAVED card, so there is no surface in this app from which a
// user can write one before the loadout exists. Sending the key here with nothing to put in
// it could only ever send a wrong value: the save path's nearest string is `data.n`, and a
// re-save that quietly overwrote the user's note with the build's inner name is precisely
// the bug the omission prevents. The key set is asserted in the panel's tests.
// Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List" — `id` is
// an addressing argument on the request, naming the record a loaded loadout writes back
// to. It is included ONLY when `savedId` is set, and never as null or undefined: key
// presence is meaningful to this API, so an absent key and a null key mean different things.
export function upsertLoadout(name, data, listId, savedId) {
  const body = { name, data };
  if (listId !== undefined) body.listId = listId;
  if (savedId) body.id = savedId;
  return fetch(BASE, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  }).then(asJson);
}

// Governing: ADR-0006 (list filing model), SPEC-0003 REQ "Loadouts Carry a Description of
// Their Own"
//
// PATCH speaks in KEYS, not in values. The server reads `"listId" in body` and
// `"description" in body`, so a key that is present and null is an instruction ("file into
// Unassigned", "clear the note") while an absent key means "leave that field alone".
//
// That makes `undefined` the one value that must never be handed to JSON.stringify here: it
// deletes its own key on the way out, turning a reset into a body the server rejects for
// carrying no instruction at all. Each wrapper below therefore builds its object with
// exactly the keys it means, and `describeLoadout` refuses undefined outright rather than
// letting it disappear silently between here and the wire.
function patchLoadout(id, patch) {
  return fetch(`${BASE}/${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(patch),
  }).then(asJson);
}

/** Move a loadout between lists. `listId: null` moves it to Unassigned. */
export function moveLoadout(id, listId) {
  // Guarded for the reason spelled out above, and for the same reason `describeLoadout` is:
  // `{ listId: undefined }` serialises to `{}`, which the server rejects for carrying no
  // instruction at all. A caller that reached here with undefined believes it is filing the
  // loadout somewhere; a 400 with a message about a missing key is not the answer, and the
  // invariant is not worth arguing for on one of the two writers only.
  if (listId !== null && typeof listId !== "string") {
    throw new TypeError("listId must be a string or null");
  }
  // No `description` key: a move must not disturb what the user wrote about the loadout,
  // and the omission is what says so.
  return patchLoadout(id, { listId });
}

// Governing: ADR-0006, SPEC-0003 REQ "Loadouts Within a List Have a User-Chosen Order"
//
// One request per completed drag, not one per displaced card — `order` is the FULL ordered
// id list for one list (or Unassigned, `listId: null`), and the server rejects anything that
// isn't exactly the set of loadouts already filed there (see loadouts.js POST /reorder). The
// guards here mirror `moveLoadout`'s: a caller with the wrong shape is wrong about something,
// and a 400 whose message blames a key it never meant to omit is not the same bug reported
// back honestly.
export function reorderLoadouts(listId, order) {
  if (listId !== null && typeof listId !== "string") {
    throw new TypeError("listId must be a string or null");
  }
  if (!Array.isArray(order) || order.some((id) => typeof id !== "string")) {
    throw new TypeError("order must be an array of loadout id strings");
  }
  return fetch(`${BASE}/reorder`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ listId, order }),
  }).then(asJson);
}

/**
 * Set a loadout's description — the user's own note about the build.
 *
 * Nothing is inherited into this field (that is the LIST's description, which draws on its
 * hunter), so `null` and `""` both simply clear it. The wrapper still refuses `undefined`
 * outright: it would vanish in JSON.stringify and turn a clear into a body the server rejects
 * for carrying no instruction at all.
 */
export function describeLoadout(id, description) {
  if (description !== null && typeof description !== "string") {
    throw new TypeError("description must be a string or null");
  }
  // No `listId` key: describing a loadout never re-files it.
  return patchLoadout(id, { description });
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

// Governing: ADR-0006, SPEC-0003 REQ "Lists Are Visually Distinguishable Independent of
// Portrait and Name"
//
// `accent` is OMITTED from the body when the caller has none, never sent as null. The server
// resolves `accent ?? nextAccent(ownedBy(...))`, so absence is the instruction that means
// "assign least-used" — and a literal null would take the same branch today only by accident
// of `??`, while being rejected outright the day the validator tightens to `isAccent(null)`.
// The two branches of the requirement are an absent key and a present palette value; this
// function speaks in exactly those terms (#135).
export function createList({ name, hunterId = null, accent = null }) {
  const body = accent === null ? { name, hunterId } : { name, hunterId, accent };
  return fetch(LISTS_BASE, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  }).then(asJson);
}

export function updateList(id, patch) {
  return fetch(`${LISTS_BASE}/${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(patch),
  }).then(asJson);
}

/**
 * Set a list's description.
 *
 * Governing: ADR-0007 (dataset carries descriptions), SPEC-0003 REQ "Lists Carry an Editable
 * Description".
 *
 * THIS is the description with an inherited default. `null` restores it — the list hunter's
 * text, resolved at render time and never written here, which is why restoring is a write of
 * null and not a write of the hunter's prose. `""` stores the deliberately-blank state, which
 * renders as nothing and does NOT re-inherit.
 *
 * Its own function rather than `updateList(id, { description })` at each call site, for the
 * reason the loadout's has one: `undefined` deletes its own key inside JSON.stringify, so a
 * restore built from a variable that happened to be undefined would silently become a request
 * that changes nothing at all. Refused here, where the value is still visible.
 */
export function describeList(id, description) {
  if (description !== null && typeof description !== "string") {
    throw new TypeError("description must be a string or null");
  }
  // Exactly one key: describing a list must not restate its name, hunter or accent.
  return updateList(id, { description });
}

/** Retire a list. The server drops its loadouts into Unassigned; it never deletes them. */
export function retireList(id) {
  return fetch(`${LISTS_BASE}/${id}`, { method: "DELETE", headers: headers() }).then(asJson);
}

// ---------------------------------------------------------------------------
// Favorite hunters (SPEC-0003 REQ "Favorite Hunters"). Same token header, same
// scoping rules again — a favorite is only ever visible to the browser that made it.
//
// The hunter is addressed in the PATH, which is what makes both writes idempotent:
// PUT twice is one favorite, DELETE on a hunter that was never favorited succeeds.
// Retrying either after a flaky network is therefore always safe.
//
// Note what is NOT here: nothing sends the "favorites only" toggle. That is a view
// preference, client state under the same rule as the selected list and the sort
// order, and it never reaches the server.
// ---------------------------------------------------------------------------

const FAVORITES_BASE = (import.meta.env && import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/$/, "")
  : "") + "/api/hunter-favorites";

/** The caller's favorites, as full records. An empty array is the ordinary fresh state. */
export function getFavorites() {
  return fetch(FAVORITES_BASE, { headers: headers() }).then(asJson);
}

export function favoriteHunter(hunterId) {
  return fetch(`${FAVORITES_BASE}/${encodeURIComponent(hunterId)}`, {
    method: "PUT",
    headers: headers(),
  }).then(asJson);
}

export function unfavoriteHunter(hunterId) {
  return fetch(`${FAVORITES_BASE}/${encodeURIComponent(hunterId)}`, {
    method: "DELETE",
    headers: headers(),
  }).then(asJson);
}
