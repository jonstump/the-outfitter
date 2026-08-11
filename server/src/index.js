import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { loadoutsRouter } from "./routes/loadouts.js";
import { loadoutListsRouter } from "./routes/loadoutLists.js";
import { hunterFavoritesRouter } from "./routes/hunterFavorites.js";
import { trustProxySetting } from "./lib/trustProxy.js";
import { db } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4100;

const app = express();

// Governing: issue #199, SPEC-0003 REQ "Rate Limiting" (this setting decides what `req.ip`
// resolves to, and `req.ip` is the key the spec'd budgets are counted against).
//
// Which peers this server believes `X-Forwarded-*` from — a property of the DEPLOYMENT,
// so it is configured rather than hardcoded. `TRUST_PROXY` names the front-facing proxy
// ("loopback", an address, a CIDR, a comma-separated list, or a hop count); unset means
// nothing is in front and no forwarded header is believed.
//
// Deployment note, because it cuts the other way and no test can catch it: this also
// governs `req.protocol`, which isSameOrigin() below compares against the browser's Origin.
// Behind a proxy that terminates TLS, leaving this unset makes the API answer 403 to every
// write from its own client. See README "Reverse proxies and TRUST_PROXY".
//
// This was `1`, which reads as "one proxy hop" but compiles to a predicate that ignores
// the peer address entirely — so on the two documented topologies with no proxy
// (docker-compose's published port, the Procfile VM) any client could set its own
// `X-Forwarded-For` and land in a fresh rate-limit bucket per request. See
// lib/trustProxy.js for the full reasoning, and note that `req.ip` — what both limiters
// in lib/ownership.js key on — is governed by this setting.
app.set("trust proxy", trustProxySetting(process.env));

// The app is designed as a single origin serving both the API and the built
// client (see README). In dev, Vite's proxy forwards /api to this server with a
// browser-like Origin header; allowing only localhost dev origins keeps a
// third-party site from scripting the API on a visitor's behalf (issue #30).
// Set CORS_ORIGIN to name ADDITIONAL, genuinely cross-origin callers.
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.push("http://127.0.0.1:5173", "http://localhost:5173");
}

/**
 * Is `origin` this very server, as the client addressed it?
 *
 * THE ASSUMPTION THIS REPLACES WAS WRONG, and it took the deployed site down. The
 * previous code read "no Origin header (curl, same-origin fetch, same-server static)
 * is always fine" — true as far as it goes, but it treated the ABSENCE of the header
 * as the test for same-origin. A browser attaches `Origin` to plenty of same-origin
 * requests:
 *
 *   - any request whose method is not GET/HEAD — so every save, every list write and
 *     every favorite carries `Origin: <this site>`; and
 *   - any request made in CORS mode, whatever the method. Vite stamps `crossorigin`
 *     on the entry bundle it writes into index.html, so the app's OWN `/assets/*.js`
 *     and `/assets/*.css` are fetched in CORS mode and carry the header too.
 *
 * On a deployment whose host is not in `allowedOrigins` (the default list is localhost
 * only), that made the server answer 403 to its own JavaScript. The page then rendered
 * as an empty `<div id="root">` — a blank screen whose only symptom is a 403 in the
 * console. `Vary: Origin` splits the 200 and the 403 into separate cache entries, which
 * is why it looked intermittent rather than simply broken.
 *
 * Same-origin is therefore matched HERE, against the request, rather than by hoping the
 * deployment host was configured into an env var. It needs no configuration and cannot
 * drift when the app moves hosts.
 */
function isSameOrigin(req, origin) {
  const host = clientFacingHost(req);
  return Boolean(host) && origin === `${req.protocol}://${host}`;
}

/**
 * The authority the CLIENT addressed, which is not always the one this process received.
 *
 * `req.protocol` already resolves through express's trust-proxy gate (X-Forwarded-Proto).
 * The host half has to be done by hand, and neither obvious shortcut is correct:
 *
 *   - `req.get("host")` alone is a raw header passthrough. It ignores X-Forwarded-Host and
 *     is unaffected by `trust proxy`. It happens to work on Render, which forwards the
 *     original Host unchanged — but an nginx hop added in front without an explicit
 *     `proxy_set_header Host $host;` rewrites Host to the upstream address by default, and
 *     the same-origin check would start refusing all legitimate traffic. That is this
 *     file's original outage, re-entered through a different door (PR #189 review).
 *   - `req.hostname` consults X-Forwarded-Host under the trust gate, which is the half the
 *     first option misses — but it STRIPS THE PORT, and a port is part of an origin. A
 *     browser on http://localhost:4100 (the single-process run the README documents) sends
 *     `Origin: http://localhost:4100`; comparing that against a portless `http://localhost`
 *     never matches, so swapping one shortcut for the other trades a hypothetical outage
 *     for a guaranteed one.
 *
 * So: X-Forwarded-Host when a trusted proxy set it, raw Host otherwise, port preserved
 * either way. The trust gate is express's own — the identical predicate behind
 * `req.protocol` — rather than a second, hand-rolled notion of which peers to believe.
 */
function clientFacingHost(req) {
  const forwarded = req.get("x-forwarded-host");
  const trust = req.app.get("trust proxy fn");
  if (forwarded && trust && trust(req.socket.remoteAddress, 0)) {
    // A chain of proxies appends to this header; the client addressed the first entry.
    return forwarded.split(",")[0].trim();
  }
  return req.get("host");
}

// Scoped to /api, not the whole app. Access control on the JSON API is the only thing
// this policy was ever meant to express; leaving it mounted app-wide is what allowed an
// API rule to refuse a static asset and blank the page. Static delivery below is now out
// of its reach entirely, so no future CORS change can take the client down again.
const corsPolicy = cors((req, callback) => {
  const origin = req.get("origin");
  if (!origin || isSameOrigin(req, origin) || allowedOrigins.includes(origin)) {
    return callback(null, { origin: true });
  }
  return callback(new Error("CORS origin not allowed"));
});
app.use("/api", corsPolicy);

// Explicit body-size cap (SPEC-0003 Security Requirements). express.json() defaults to
// 100kb implicitly; stating it means the limit is a decision on the record rather than a
// framework default that could shift under an upgrade. Loadout and list payloads are
// small — this is generous.
app.use(express.json({ limit: "64kb" }));

app.use("/api/loadouts", loadoutsRouter);
app.use("/api/loadout-lists", loadoutListsRouter);
// Governing: SPEC-0003 REQ "Favorite Hunters". Token-scoped like everything above it; the
// 64kb body cap already declared covers it, and both writes address the hunter in the path
// rather than the body, so neither carries one worth capping separately.
app.use("/api/hunter-favorites", hunterFavoritesRouter);

// Lightweight liveness endpoint for orchestrators/load balancers (issue #31).
app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

if (process.env.NODE_ENV === "production") {
  const clientDist = path.join(__dirname, "..", "..", "client", "dist");
  app.use(express.static(clientDist));
  // SPA fallback for deep links/refreshes. Registered as a plain middleware, not a
  // route pattern, so it behaves identically on Express 4 (where `/{*splat}`
  // wildcards were parsed as literals and matched nothing) and Express 5 (where
  // Express 4's bare `*` throws at startup). /healthz is registered above, so a
  // liveness probe is never shadowed by this fallback.
  app.use((_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Final error handler (issue #18): async route failures and CORS rejections land
// here as a clean 500/403 instead of an unhandled rejection crashing the process.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err && err.message === "CORS origin not allowed") {
    return res.status(403).json({ error: "origin not allowed" });
  }
  console.error("Unhandled server error:", err);
  res.status(500).json({ error: "internal server error" });
});

app.listen(PORT, () => {
  console.log(`The Outfitter server listening on http://localhost:${PORT}`);
});
