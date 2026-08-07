const BASE = "/api/loadouts";

async function asJson(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function getLoadouts() {
  return fetch(BASE).then(asJson);
}

export function upsertLoadout(name, data) {
  return fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, data }),
  }).then(asJson);
}

export function deleteLoadout(id) {
  return fetch(`${BASE}/${id}`, { method: "DELETE" }).then(asJson);
}
