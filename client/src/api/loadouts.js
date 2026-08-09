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
