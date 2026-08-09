const BASE = "/api/loadouts";
const TOKEN_KEY = "hunt-outfitter-token";

// Per-browser anonymous identifier sent with every request (issue #17): loadouts
// are scoped server-side to this value, so two different browsers never see or
// overwrite each other's saves. No login needed for a fan tool — the token is
// just an ownership boundary.
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
    // localStorage unavailable (private mode) — the server falls back to its
    // anonymous shared scope for requests without a token.
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

export function upsertLoadout(name, data) {
  return fetch(BASE, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name, data }),
  }).then(asJson);
}

export function deleteLoadout(id) {
  return fetch(`${BASE}/${id}`, { method: "DELETE", headers: headers() }).then(asJson);
}
